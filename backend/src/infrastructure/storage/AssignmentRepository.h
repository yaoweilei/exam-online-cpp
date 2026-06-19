#pragma once

// 作业 Repository（业务功能 6）
// - 文件：data/system/assignments.json
//   结构: { "assignments": [ { assignment_id, organization_id, learning_group_id, exam_id, title,
//                               description, due_at, created_at, created_by,
//                               question_ids, question_start, question_end,
//                               submissions, reminders } ] }

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

    // 按 learningGroupId 列表（教师/学生看学习组作业）
    Json::Value listByLearningGroup(const std::string &learningGroupId) const;

    // 按多个 learningGroupId 批量列出（学生汇总「我的作业」时用）
    Json::Value listByLearningGroups(const std::vector<std::string> &learningGroupIds) const;

    Json::Value get(const std::string &assignmentId) const;

    Json::Value submit(const std::string &assignmentId, const std::string &studentId, const Json::Value &submission);

    Json::Value listSubmissions(const std::string &assignmentId) const;

    Json::Value addReminder(const std::string &assignmentId, const Json::Value &reminder);

    bool update(const std::string &assignmentId, const Json::Value &patch);

    bool remove(const std::string &assignmentId);

  private:
    std::filesystem::path filePath_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
