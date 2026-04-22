#pragma once

// 班级 Repository（业务功能 6）
// - 文件：data/system/classrooms.json
//   结构: { "classrooms": [ { class_id, name, description, org_id, teacher_user_id,
//                              student_ids: [...], created_at, updated_at } ] }
// - 单文件 + 互斥锁，MVP 规模够用

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class ClassroomRepository
{
  public:
    explicit ClassroomRepository(std::filesystem::path systemDir);

    // 创建班级，返回入库后对象（含 class_id / created_at）
    Json::Value create(const Json::Value &item);

    // 列出全部班级（管理员/筛选时用）
    Json::Value list() const;

    // 列出与某用户相关的班级（teacher_user_id == userId 或 student_ids 包含 userId）
    Json::Value listForUser(const std::string &userId) const;

    // 单个班级详情，找不到返回 Json::nullValue
    Json::Value get(const std::string &classId) const;

    // 局部更新（仅允许 name / description / student_ids）
    bool update(const std::string &classId, const Json::Value &patch);

    // 删除班级
    bool remove(const std::string &classId);

    // 添加学生（去重），返回最终学生数组
    Json::Value addMembers(const std::string &classId, const std::vector<std::string> &userIds);

    // 移除单个学生
    bool removeMember(const std::string &classId, const std::string &userId);

  private:
    std::filesystem::path filePath_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
