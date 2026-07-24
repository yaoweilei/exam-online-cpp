#pragma once

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
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
                           const std::string &submissionId = "")
    {
        std::unique_lock lock(mutex_);
        const auto userDir = answersRootDir_ / userId;
        std::filesystem::create_directories(userDir);

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
        payload["idempotent_replay"] = false;

        wal_.append("answer_saved", payload);
        writeJsonFileAtomic(userDir / (examId + ".json"), payload);
        if (!submissionId.empty())
        {
            std::filesystem::create_directories(historyDir);
            writeJsonFileAtomic(historyPath, payload);
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
