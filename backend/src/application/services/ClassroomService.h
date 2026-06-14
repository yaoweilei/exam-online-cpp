#pragma once

// 班级与作业 Service（业务功能 6）
//   - 班级：教师/管理员创建并管理学生
//   - 作业：班级内布置基于 examId(paperId) 的练习/测验
// 权限边界由 Routes 控制，Service 只做数据校验与编排

#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/ClassroomRepository.h"

namespace application::services
{
class ClassroomService
{
  public:
    ClassroomService(infrastructure::storage::ClassroomRepository &classroomRepo,
                     infrastructure::storage::AssignmentRepository &assignmentRepo);

    // ---------------- 班级 ----------------
    // 创建：teacherUserId 为创建者；name 必填
    Json::Value createClassroom(const std::string &teacherUserId,
                                const std::string &orgId,
                                const std::string &name,
                                const std::string &description);

    // 我的班级：作为教师或学生
    Json::Value listMyClassrooms(const std::string &userId) const;

    Json::Value getClassroom(const std::string &classId) const;

    Json::Value updateClassroom(const std::string &classId, const Json::Value &patch);

    Json::Value removeClassroom(const std::string &classId);

    Json::Value addMembers(const std::string &classId, const std::vector<std::string> &userIds);

    Json::Value removeMember(const std::string &classId, const std::string &userId);

    // ---------------- 作业 ----------------
    Json::Value createAssignment(const std::string &classId,
                                 const std::string &createdBy,
                                 const std::string &examId,
                                 const std::string &title,
                                 const std::string &description,
                                 const std::string &dueAt);

    Json::Value listAssignmentsByClass(const std::string &classId) const;

    // 我的作业：聚合我所在班级（作为学生或教师）的全部作业
    Json::Value listMyAssignments(const std::string &userId) const;

    Json::Value updateAssignment(const std::string &assignmentId, const Json::Value &patch);

    Json::Value removeAssignment(const std::string &assignmentId);

    // 工具：判断 userId 是否为某班级的教师或学生
    bool isClassMember(const std::string &classId, const std::string &userId) const;

  private:
    infrastructure::storage::ClassroomRepository &classroomRepo_;
    infrastructure::storage::AssignmentRepository &assignmentRepo_;
};
}  // namespace application::services
