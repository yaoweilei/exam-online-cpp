#pragma once

// 作业 Repository（业务功能 6）
// - 文件：data/system/assignments.json
//   结构: { "assignments": [ { assignment_id, class_id, exam_id, title,
//                               description, due_at, created_at, created_by } ] }

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class AssignmentRepository
{
  public:
    explicit AssignmentRepository(std::filesystem::path systemDir);

    Json::Value create(const Json::Value &item);

    // 按 classId 列表（教师/学生看班级作业）
    Json::Value listByClass(const std::string &classId) const;

    // 按多个 classId 批量列出（学生汇总「我的作业」时用）
    Json::Value listByClasses(const std::vector<std::string> &classIds) const;

    Json::Value get(const std::string &assignmentId) const;

    bool update(const std::string &assignmentId, const Json::Value &patch);

    bool remove(const std::string &assignmentId);

  private:
    std::filesystem::path filePath_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
