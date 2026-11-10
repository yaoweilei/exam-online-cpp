#pragma once

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <set>
#include <string>
#include <vector>

#include <json/json.h>

#include "JsonIo.h"
#include "WalStore.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class AnswerRepository
{
  public:
    explicit AnswerRepository(std::filesystem::path userRootDir)
        : answersRootDir_(std::move(userRootDir) / "answers"),
          wal_(answersRootDir_ / "_wal.log", answersRootDir_ / "_wal.snapshot.json")
    {
        std::filesystem::create_directories(answersRootDir_);
        recoveredEvents_ = wal_.recover().size();
    }

    Json::Value saveAnswer(const std::string &userId,
                           const std::string &examId,
                           const Json::Value &answers,
                           const Json::Value &statistics,
                           const std::string &submissionId = "",
                           const std::string &attemptId = "")
    {
        std::unique_lock lock(mutex_);
        const auto userDir = answersRootDir_ / userId;
        std::filesystem::create_directories(userDir);

        std::string attemptKey;
        static constexpr char hex[] = "0123456789abcdef";
        for (const unsigned char c : attemptId) { attemptKey += hex[c >> 4]; attemptKey += hex[c & 15]; }
        const auto attemptPath = userDir / "_attempts" / examId / (attemptKey + ".json");
        if (!attemptId.empty() && std::filesystem::exists(attemptPath)) {
            auto replay = readJsonFile(attemptPath);
            replay["idempotent_replay"] = true;
            return replay;
        }

        const auto historyDir = userDir / "_history" / examId;
        const auto historyPath = submissionId.empty()
            ? std::filesystem::path{}
            : historyDir / (safeSegment(submissionId) + ".json");
        if (!submissionId.empty() && std::filesystem::exists(historyPath))
        {
            auto replay = readJsonFile(historyPath);
            replay["idempotent_replay"] = true;
            return replay;
        }

        Json::Value payload(Json::objectValue);
        payload["user_id"] = userId;
        payload["exam_id"] = examId;
        payload["answers"] = answers;
        payload["statistics"] = statistics;
        payload["saved_at"] = common::nowIso8601();
        payload["submission_id"] = submissionId;
        payload["attempt_id"] = attemptId;
        payload["idempotent_replay"] = false;

        wal_.append("answer_saved", payload);
        writeJsonFileAtomic(userDir / (examId + ".json"), payload);
        if (!submissionId.empty())
        {
            std::filesystem::create_directories(historyDir);
            writeJsonFileAtomic(historyPath, payload);
        }
        if (!attemptId.empty()) {
            std::filesystem::create_directories(attemptPath.parent_path());
            writeJsonFileAtomic(attemptPath, payload);
        }
        return payload;
    }

    Json::Value loadAnswer(const std::string &userId, const std::string &examId) const
    {
        std::shared_lock lock(mutex_);
        const auto path = answersRootDir_ / userId / (examId + ".json");
        if (!std::filesystem::exists(path))
        {
            return Json::Value(Json::objectValue);
        }
        return readJsonFile(path);
    }

    std::vector<Json::Value> listUserAnswers(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        std::vector<Json::Value> items;
        const auto userDir = answersRootDir_ / userId;
        if (!std::filesystem::exists(userDir))
        {
            return items;
        }

        for (const auto &entry : std::filesystem::directory_iterator(userDir))
        {
            if (!entry.is_regular_file() || entry.path().extension() != ".json")
            {
                continue;
            }
            try
            {
                items.push_back(readJsonFile(entry.path()));
            }
            catch (...)
            {
                continue;
            }
        }
        return items;
    }

    Json::Value listAttempts(const std::string &userId, const std::string &examId, int limit = 20) const
    {
        std::shared_lock lock(mutex_);
        Json::Value out(Json::arrayValue);
        const auto historyDir = answersRootDir_ / userId / "_history" / examId;
        if (!std::filesystem::exists(historyDir)) return out;
        std::vector<Json::Value> attempts;
        for (const auto &entry : std::filesystem::directory_iterator(historyDir))
        {
            if (!entry.is_regular_file() || entry.path().extension() != ".json") continue;
            try { attempts.push_back(readJsonFile(entry.path())); } catch (...) { }
        }
        std::sort(attempts.begin(), attempts.end(), [](const Json::Value &a, const Json::Value &b) {
            return a.get("saved_at", "").asString() > b.get("saved_at", "").asString();
        });
        for (int i = 0; i < static_cast<int>(attempts.size()) && i < limit; ++i) out.append(attempts[i]);
        return out;
    }

    std::vector<Json::Value> learningHistory(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        std::vector<Json::Value> out;
        std::set<std::string> seen;
        const auto userDir = answersRootDir_ / userId;
        const auto append = [&](const std::filesystem::path &path) {
            try {
                auto item = readJsonFile(path);
                const auto key = item.get("exam_id", "").asString() + "|" + item.get("saved_at", "").asString() + "|" +
                    item.get("submission_id", "").asString() + "|" + item.get("attempt_id", "").asString();
                if (item.isObject() && seen.insert(key).second) out.push_back(std::move(item));
            } catch (...) {}
        };
        if (!std::filesystem::exists(userDir)) return out;
        for (const auto &entry : std::filesystem::directory_iterator(userDir))
            if (entry.is_regular_file() && entry.path().extension() == ".json") append(entry.path());
        for (const auto *folder : {"_history", "_attempts"})
            if (std::filesystem::exists(userDir / folder))
                for (const auto &entry : std::filesystem::recursive_directory_iterator(userDir / folder))
                    if (entry.is_regular_file() && entry.path().extension() == ".json") append(entry.path());
        return out;
    }

    // One read lock covers the latest snapshots and both historical layouts.
    // Export reports damaged/unreadable records instead of silently calling it complete.
    Json::Value exportSnapshots(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        Json::Value out(Json::objectValue); out["latest"] = Json::objectValue; out["history"] = Json::arrayValue; out["warnings"] = Json::arrayValue;
        std::set<std::string> seen; int sources=0,duplicates=0;
        const auto userDir=answersRootDir_/userId;
        const auto warning = [&](const std::filesystem::path &path, const std::string &code) {
            Json::Value item(Json::objectValue); item["source"] = path.lexically_relative(userDir).generic_string(); item["code"]=code; out["warnings"].append(item);
        };
        const auto append = [&](const std::filesystem::path &path, bool latest) {
            if (std::filesystem::is_symlink(path)) { warning(path,"symlink_skipped"); return; }
            try {
                auto item=readJsonFile(path);
                if (!item.isObject() || (!item.get("user_id","").asString().empty() && item["user_id"].asString()!=userId)) { warning(path,"invalid_or_foreign_record"); return; }
                Json::StreamWriterBuilder writer; writer["indentation"]="";
                // Only discard identical copies. Legacy snapshots can reuse an attempt ID
                // or omit timestamps while still containing distinct answers.
                const auto key=item.get("exam_id",path.stem().string()).asString()+"|"+Json::writeString(writer,item);
                ++sources;
                if (latest) out["latest"][path.stem().string()]=item;
                if (seen.insert(key).second) out["history"].append(item); else ++duplicates;
            } catch (...) { warning(path,"unreadable_record"); }
        };
        std::error_code ec;
        if (std::filesystem::is_symlink(userDir,ec)) { warning(userDir,"symlink_skipped"); return out; }
        if (std::filesystem::exists(userDir,ec)) {
            for (std::filesystem::directory_iterator it(userDir,ec),end; !ec && it!=end; it.increment(ec)) {
                if (it->is_regular_file() && it->path().extension()==".json") append(it->path(),true);
            }
            if (ec) warning(userDir,"unreadable_directory");
            for (const auto *folder : {"_history","_attempts"}) {
                const auto dir=userDir/folder; ec.clear();
                if (std::filesystem::is_symlink(dir,ec)) { warning(dir,"symlink_skipped"); continue; }
                if (!std::filesystem::exists(dir,ec)) continue;
                for (std::filesystem::recursive_directory_iterator it(dir,ec),end; !ec && it!=end; it.increment(ec))
                    if (it->is_regular_file() && it->path().extension()==".json") append(it->path(),false);
                if (ec) warning(dir,"unreadable_directory");
            }
        } else if (ec) warning(userDir,"unreadable_directory");
        out["source_records"]=sources; out["duplicate_copies"]=duplicates;
        return out;
    }

    std::filesystem::path rootDir() const
    {
        return answersRootDir_;
    }

  private:
    static std::string safeSegment(const std::string &value)
    {
        std::string out;
        out.reserve(value.size());
        for (const unsigned char c : value)
        {
            out.push_back(std::isalnum(c) || c == '-' || c == '_' || c == '.' ? static_cast<char>(c) : '_');
        }
        return out;
    }

    std::filesystem::path answersRootDir_;
    mutable std::shared_mutex mutex_;
    WalStore wal_;
    size_t recoveredEvents_{0};
};
}  // namespace infrastructure::storage
