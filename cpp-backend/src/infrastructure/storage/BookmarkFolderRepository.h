#pragma once

// 收藏夹/分类 Repository（业务功能 8）
// - 文件：data/user/bookmark_folders/{userId}.json
//   结构: { user_id, folders: [ { folder_id, name, color, exam_ids:[...],
//                                  created_at, updated_at } ] }
// - 与现有 BookmarkRepository（扁平 exams 数组）解耦：分类是叠加层
//   一份 examId 可同时属于多个文件夹

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class BookmarkFolderRepository
{
  public:
    explicit BookmarkFolderRepository(std::filesystem::path userRootDir);

    // 列出该用户全部文件夹
    Json::Value list(const std::string &userId) const;

    // 创建文件夹
    Json::Value create(const std::string &userId, const std::string &name, const std::string &color);

    // 更新（仅允许 name / color）
    bool update(const std::string &userId, const std::string &folderId, const Json::Value &patch);

    // 删除文件夹
    bool remove(const std::string &userId, const std::string &folderId);

    // 把 examId 加入文件夹（去重）
    bool addExam(const std::string &userId, const std::string &folderId, const std::string &examId);

    // 从文件夹移除 examId
    bool removeExam(const std::string &userId, const std::string &folderId, const std::string &examId);

  private:
    std::filesystem::path filePath(const std::string &userId) const;

    std::filesystem::path folderDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
