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

    void addQuestionBookmark(const std::string &userId, Json::Value item)
    {
        std::unique_lock lock(mutex_);
        const auto path = bookmarkDir_ / (userId + ".json");
        auto bm = std::filesystem::exists(path) ? readJsonFile(path) : defaultBookmarks(userId);
        if (!bm["questions"].isArray())
        {
            bm["questions"] = Json::arrayValue;
        }

        const auto examId = item.get("exam_id", "").asString();
        const auto sectionIndex = item.get("section_index", 0).asInt();
        const auto questionId = item.get("question_id", "").asString();
        const auto now = common::nowIso8601();
        auto bookmarkId = item.get("bookmark_id", "").asString();
        if (bookmarkId.empty())
        {
            bookmarkId = makeQuestionBookmarkId(examId, sectionIndex, questionId);
        }

        item["bookmark_id"] = bookmarkId;
        item["updated_at"] = now;
        if (!item.isMember("created_at") || item["created_at"].asString().empty())
        {
            item["created_at"] = now;
        }

        Json::Value next(Json::arrayValue);
        bool replaced = false;
        for (const auto &existing : bm["questions"])
        {
            if (existing.get("bookmark_id", "").asString() == bookmarkId)
            {
                Json::Value merged = existing;
                for (const auto &name : item.getMemberNames())
                {
                    merged[name] = item[name];
                }
                if (!existing.get("created_at", "").asString().empty())
                {
                    merged["created_at"] = existing["created_at"];
                }
                next.append(merged);
                replaced = true;
            }
            else
            {
                next.append(existing);
            }
        }
        if (!replaced)
        {
            next.append(item);
        }

        bm["questions"] = next;
        bm["updated_at"] = now;
        writeJsonFileAtomic(path, bm);
    }

    void removeQuestionBookmark(const std::string &userId, const std::string &bookmarkId)
    {
        std::unique_lock lock(mutex_);
        const auto path = bookmarkDir_ / (userId + ".json");
        auto bm = std::filesystem::exists(path) ? readJsonFile(path) : defaultBookmarks(userId);

        Json::Value filtered(Json::arrayValue);
        for (const auto &item : bm["questions"])
        {
            if (item.get("bookmark_id", "").asString() != bookmarkId)
            {
                filtered.append(item);
            }
        }
        bm["questions"] = filtered;
        bm["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(path, bm);
    }

    bool clearQuestionFolder(const std::string &userId, const std::string &folderId)
    {
        std::unique_lock lock(mutex_);
        const auto path = bookmarkDir_ / (userId + ".json");
        if (!std::filesystem::exists(path) || folderId.empty())
        {
            return false;
        }

        auto bm = readJsonFile(path);
        if (!bm["questions"].isArray())
        {
            return false;
        }

        bool changed = false;
        for (auto &item : bm["questions"])
        {
            if (item.get("folder_id", "").asString() == folderId)
            {
                item["folder_id"] = "";
                changed = true;
            }
        }
        if (changed)
        {
            bm["updated_at"] = common::nowIso8601();
            writeJsonFileAtomic(path, bm);
        }
        return changed;
    }

  private:
    static std::string makeQuestionBookmarkId(const std::string &examId, int sectionIndex, const std::string &questionId)
    {
        auto raw = examId + "::" + std::to_string(sectionIndex) + "::" + questionId;
        std::replace(raw.begin(), raw.end(), '/', '_');
        std::replace(raw.begin(), raw.end(), '\\', '_');
        return raw;
    }

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
