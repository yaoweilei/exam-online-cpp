#pragma once

// 收藏夹/分类 Service（业务功能 8）

#include <string>

#include <json/json.h>

#include "infrastructure/storage/BookmarkFolderRepository.h"

namespace application::services
{
class BookmarkFolderService
{
  public:
    explicit BookmarkFolderService(infrastructure::storage::BookmarkFolderRepository &repo);

    Json::Value list(const std::string &userId) const;

    Json::Value create(const std::string &userId, const std::string &name, const std::string &color);

    Json::Value update(const std::string &userId, const std::string &folderId, const Json::Value &patch);

    Json::Value remove(const std::string &userId, const std::string &folderId);

    Json::Value addExam(const std::string &userId, const std::string &folderId, const std::string &examId);

    Json::Value removeExam(const std::string &userId, const std::string &folderId, const std::string &examId);

  private:
    infrastructure::storage::BookmarkFolderRepository &repo_;
};
}  // namespace application::services
