#pragma once

#include <string>

#include <json/json.h>

#include "infrastructure/storage/BookmarkRepository.h"

namespace application::services
{
class BookmarkService
{
  public:
    explicit BookmarkService(infrastructure::storage::BookmarkRepository &repository) : repository_(repository) {}

    Json::Value getBookmarks(const std::string &userId) const
    {
        return repository_.loadBookmarks(userId);
    }

    Json::Value addExamBookmark(const std::string &userId, const std::string &examId)
    {
        repository_.addExamBookmark(userId, examId);
        return repository_.loadBookmarks(userId);
    }

    Json::Value removeExamBookmark(const std::string &userId, const std::string &examId)
    {
        repository_.removeExamBookmark(userId, examId);
        return repository_.loadBookmarks(userId);
    }

  private:
    infrastructure::storage::BookmarkRepository &repository_;
};
}  // namespace application::services
