#pragma once

#include <filesystem>
#include <mutex>
#include <string>

#include <json/json.h>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class BookmarkRepository
{
  public:
    explicit BookmarkRepository(std::filesystem::path userRootDir)
        : bookmarkDir_(std::move(userRootDir) / "bookmarks")
    {
        std::filesystem::create_directories(bookmarkDir_);
    }

    Json::Value loadBookmarks(const std::string &userId) const
    {
        const auto path = bookmarkDir_ / (userId + ".json");
        std::shared_lock lock(mutex_);
        if (!std::filesystem::exists(path))
        {
            return defaultBookmarks(userId);
        }
        return readJsonFile(path);
    }

    void addExamBookmark(const std::string &userId, const std::string &examId)
    {
        std::unique_lock lock(mutex_);
        const auto path = bookmarkDir_ / (userId + ".json");
        auto bm = std::filesystem::exists(path) ? readJsonFile(path) : defaultBookmarks(userId);

        for (const auto &e : bm["exams"])
        {
            if (e.asString() == examId)
            {
                return;  // already bookmarked
            }
        }
        bm["exams"].append(examId);
        bm["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(path, bm);
    }

    void removeExamBookmark(const std::string &userId, const std::string &examId)
    {
        std::unique_lock lock(mutex_);
        const auto path = bookmarkDir_ / (userId + ".json");
        auto bm = std::filesystem::exists(path) ? readJsonFile(path) : defaultBookmarks(userId);

        Json::Value filtered(Json::arrayValue);
        for (const auto &e : bm["exams"])
        {
            if (e.asString() != examId)
            {
                filtered.append(e);
            }
        }
        bm["exams"] = filtered;
        bm["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(path, bm);
    }

  private:
    static Json::Value defaultBookmarks(const std::string &userId)
    {
        Json::Value bm(Json::objectValue);
        bm["user_id"] = userId;
        bm["exams"] = Json::arrayValue;
        bm["questions"] = Json::arrayValue;
        bm["updated_at"] = "";
        return bm;
    }

    std::filesystem::path bookmarkDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
