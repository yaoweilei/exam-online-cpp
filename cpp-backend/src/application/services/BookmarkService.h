#pragma once

#include <string>

#include <json/json.h>

#include "infrastructure/storage/BookmarkRepository.h"

namespace application::services
{
class BookmarkService
{
  public:
    explicit BookmarkService(infrastructure::storage::BookmarkRepository &repository);

    Json::Value getBookmarks(const std::string &userId) const;

    Json::Value addExamBookmark(const std::string &userId, const std::string &examId);

    Json::Value removeExamBookmark(const std::string &userId, const std::string &examId);

  private:
    infrastructure::storage::BookmarkRepository &repository_;
};
}  // namespace application::services
