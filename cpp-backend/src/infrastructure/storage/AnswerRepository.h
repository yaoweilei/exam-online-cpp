#pragma once

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

    void saveAnswer(const std::string &userId,
                    const std::string &examId,
                    const Json::Value &answers,
                    const Json::Value &statistics)
    {
        std::unique_lock lock(mutex_);
        const auto userDir = answersRootDir_ / userId;
        std::filesystem::create_directories(userDir);

        Json::Value payload(Json::objectValue);
        payload["user_id"] = userId;
        payload["exam_id"] = examId;
        payload["answers"] = answers;
        payload["statistics"] = statistics;
        payload["saved_at"] = common::nowIso8601();

        wal_.append("answer_saved", payload);
        writeJsonFileAtomic(userDir / (examId + ".json"), payload);
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

    std::filesystem::path rootDir() const
    {
        return answersRootDir_;
    }

  private:
    std::filesystem::path answersRootDir_;
    mutable std::shared_mutex mutex_;
    WalStore wal_;
    size_t recoveredEvents_{0};
};
}  // namespace infrastructure::storage
