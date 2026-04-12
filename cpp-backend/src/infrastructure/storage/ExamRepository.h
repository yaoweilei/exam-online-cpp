#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <optional>
#include <regex>
#include <shared_mutex>
#include <unordered_map>
#include <vector>

#include <json/json.h>

#include "JsonIo.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "domain/Models.h"

namespace infrastructure::storage
{
class ExamRepository
{
  public:
    explicit ExamRepository(std::filesystem::path rootDir)
        : rootDir_(std::move(rootDir)),
          indexFile_(rootDir_ / ".exam_index.json")
    {
        rebuildIndex();
    }

    void rebuildIndex()
    {
        std::unique_lock lock(mutex_);
        exams_.clear();
        fileIndex_.clear();
        examCache_.clear();

        static const std::regex examFilePattern(R"(N[1-5]_\d{4}_\d{2}\.json)");
        if (!std::filesystem::exists(rootDir_))
        {
            return;
        }

        for (const auto &entry : std::filesystem::recursive_directory_iterator(rootDir_))
        {
            if (!entry.is_regular_file())
            {
                continue;
            }
            const auto fileName = entry.path().filename().string();
            if (!std::regex_match(fileName, examFilePattern))
            {
                continue;
            }

            auto summary = parseSummary(entry.path());
            if (!summary.has_value())
            {
                continue;
            }

            exams_.push_back(summary.value());
            fileIndex_[summary->id] = entry.path();
        }

        Json::Value indexPayload(Json::objectValue);
        indexPayload["updated_at"] = common::nowIso8601();
        indexPayload["count"] = static_cast<int>(exams_.size());
        indexPayload["items"] = Json::arrayValue;
        for (const auto &item : exams_)
        {
            auto row = item.toJson();
            row["path"] = fileIndex_[item.id].string();
            indexPayload["items"].append(row);
        }
        writeJsonFileAtomic(indexFile_, indexPayload);
    }

    std::vector<domain::ExamSummary> listExams() const
    {
        std::shared_lock lock(mutex_);
        return exams_;
    }

    Json::Value getExamById(const std::string &examId)
    {
        {
            std::shared_lock lock(mutex_);
            auto itCache = examCache_.find(examId);
            if (itCache != examCache_.end())
            {
                return itCache->second;
            }
        }

        std::filesystem::path path;
        {
            std::shared_lock lock(mutex_);
            auto it = fileIndex_.find(examId);
            if (it == fileIndex_.end())
            {
                throw common::AppException("EXAM_NOT_FOUND", "Exam not found: " + examId, drogon::k404NotFound);
            }
            path = it->second;
        }

        const auto exam = readJsonFile(path);
        {
            std::unique_lock lock(mutex_);
            examCache_[examId] = exam;
        }
        return exam;
    }

    void saveExam(const std::string &examId, const Json::Value &payload)
    {
        auto path = rootDir_ / (examId + ".json");
        const auto level = lowerLevelFromExamId(examId);
        if (!level.empty())
        {
            path = rootDir_ / level / (examId + ".json");
        }
        writeJsonFileAtomic(path, payload);
        rebuildIndex();
    }

    void deleteExam(const std::string &examId)
    {
        std::filesystem::path path;
        {
            std::shared_lock lock(mutex_);
            auto it = fileIndex_.find(examId);
            if (it == fileIndex_.end())
            {
                throw common::AppException("EXAM_NOT_FOUND", "Exam not found: " + examId, drogon::k404NotFound);
            }
            path = it->second;
        }
        std::filesystem::remove(path);
        rebuildIndex();
    }

  private:
    static std::string lowerLevelFromExamId(const std::string &examId)
    {
        if (examId.size() < 2 || examId[0] != 'N')
        {
            return {};
        }
        std::string level;
        level.push_back('n');
        level.push_back(examId[1]);
        return level;
    }

    std::optional<domain::ExamSummary> parseSummary(const std::filesystem::path &path) const
    {
        try
        {
            auto json = readJsonFile(path);
            const auto examId = path.stem().string();
            const auto parts = splitExamId(examId);
            if (parts.size() < 3)
            {
                return std::nullopt;
            }

            domain::ExamSummary summary;
            summary.id = examId;
            summary.level = parts[0];
            summary.year = parts[1];
            summary.session = parts[2];
            summary.display = summary.year + "_" + summary.session;

            const auto examInfo = json["exam_info"];
            summary.title = examInfo.get("title", examId).asString();
            summary.checked = examInfo.get("checked", false).asBool();
            summary.questionCount = countQuestions(examInfo);
            summary.accessLevel = normalizeAccessLevel(examInfo.get("access_level", "free").asString());
            return summary;
        }
        catch (...)
        {
            return std::nullopt;
        }
    }

    static int countQuestions(const Json::Value &examInfo)
    {
        int count = 0;
        for (const auto &section : examInfo["sections"])
        {
            if (section.isMember("questions") && section["questions"].isArray())
            {
                count += static_cast<int>(section["questions"].size());
            }
            for (const auto &passage : section["passages"])
            {
                count += static_cast<int>(passage["questions"].size());
            }
        }
        return count;
    }

    static std::vector<std::string> splitExamId(const std::string &examId)
    {
        std::vector<std::string> result;
        std::string token;
        for (char c : examId)
        {
            if (c == '_')
            {
                if (!token.empty())
                {
                    result.push_back(token);
                    token.clear();
                }
                continue;
            }
            token.push_back(c);
        }
        if (!token.empty())
        {
            result.push_back(token);
        }
        return result;
    }

    static std::string normalizeAccessLevel(const std::string &accessLevel)
    {
        if (accessLevel == "premium")
        {
            return "pro";
        }
        if (accessLevel == "free" || accessLevel == "pro" || accessLevel == "ultra")
        {
            return accessLevel;
        }
        return "free";
    }

  private:
    std::filesystem::path rootDir_;
    std::filesystem::path indexFile_;
    mutable std::shared_mutex mutex_;
    std::vector<domain::ExamSummary> exams_;
    std::unordered_map<std::string, std::filesystem::path> fileIndex_;
    std::unordered_map<std::string, Json::Value> examCache_;
};
}  // namespace infrastructure::storage
