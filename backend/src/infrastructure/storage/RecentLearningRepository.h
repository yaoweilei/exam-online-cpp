#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class RecentLearningRepository
{
  public:
    explicit RecentLearningRepository(std::filesystem::path userRootDir)
        : recentDir_(std::move(userRootDir) / "recent_learning")
    {
        std::filesystem::create_directories(recentDir_);
    }

    Json::Value list(const std::string &userId, int limit = 10) const
    {
        const auto path = filePath(userId);
        std::shared_lock lock(mutex_);
        if (!std::filesystem::exists(path))
        {
            Json::Value out(Json::objectValue);
            out["user_id"] = userId;
            out["items"] = Json::arrayValue;
            return out;
        }
        auto doc = readJsonFile(path);
        if (!doc["items"].isArray())
        {
            doc["items"] = Json::arrayValue;
        }
        if (limit > 0 && doc["items"].size() > static_cast<Json::ArrayIndex>(limit))
        {
            Json::Value trimmed(Json::arrayValue);
            for (Json::ArrayIndex i = 0; i < static_cast<Json::ArrayIndex>(limit); ++i)
            {
                trimmed.append(doc["items"][i]);
            }
            doc["items"] = trimmed;
        }
        return doc;
    }

    Json::Value upsert(const std::string &userId, Json::Value item)
    {
        std::unique_lock lock(mutex_);
        const auto path = filePath(userId);
        auto doc = std::filesystem::exists(path) ? readJsonFile(path) : Json::Value(Json::objectValue);
        if (!doc.isObject())
        {
            doc = Json::Value(Json::objectValue);
        }
        if (!doc["items"].isArray())
        {
            doc["items"] = Json::arrayValue;
        }

        const auto examId = item.get("exam_id", "").asString();
        const auto now = common::nowIso8601();
        item["user_id"] = userId;
        item["updated_at"] = now;
        if (!item.isMember("created_at") || item["created_at"].asString().empty())
        {
            item["created_at"] = now;
        }

        Json::Value next(Json::arrayValue);
        next.append(item);
        for (const auto &existing : doc["items"])
        {
            if (!examId.empty() && existing.get("exam_id", "").asString() == examId)
            {
                continue;
            }
            if (next.size() >= 10)
            {
                break;
            }
            next.append(existing);
        }

        doc["user_id"] = userId;
        doc["items"] = next;
        doc["updated_at"] = now;
        writeJsonFileAtomic(path, doc);
        return doc;
    }

  private:
    std::filesystem::path filePath(const std::string &userId) const
    {
        return recentDir_ / (userId + ".json");
    }

    std::filesystem::path recentDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
