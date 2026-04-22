#include "ClassroomService.h"

#include <drogon/HttpTypes.h>

#include "common/AppException.h"

namespace application::services
{

ClassroomService::ClassroomService(infrastructure::storage::ClassroomRepository &classroomRepo,
                                   infrastructure::storage::AssignmentRepository &assignmentRepo)
    : classroomRepo_(classroomRepo), assignmentRepo_(assignmentRepo)
{
}

Json::Value ClassroomService::createClassroom(const std::string &teacherUserId,
                                              const std::string &orgId,
                                              const std::string &name,
                                              const std::string &description)
{
    if (teacherUserId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "缺少 teacher_user_id", drogon::k422UnprocessableEntity);
    }
    if (name.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "班级名称不能为空", drogon::k422UnprocessableEntity);
    }
    Json::Value entry(Json::objectValue);
    entry["teacher_user_id"] = teacherUserId;
    entry["org_id"] = orgId;
    entry["name"] = name;
    entry["description"] = description;
    entry["student_ids"] = Json::Value(Json::arrayValue);
    return classroomRepo_.create(entry);
}

Json::Value ClassroomService::listMyClassrooms(const std::string &userId) const
{
    Json::Value out(Json::objectValue);
    out["items"] = classroomRepo_.listForUser(userId);
    return out;
}

Json::Value ClassroomService::getClassroom(const std::string &classId) const
{
    auto v = classroomRepo_.get(classId);
    if (v.isNull())
    {
        throw common::AppException("NOT_FOUND", "班级不存在", drogon::k404NotFound);
    }
    return v;
}

Json::Value ClassroomService::updateClassroom(const std::string &classId, const Json::Value &patch)
{
    if (!classroomRepo_.update(classId, patch))
    {
        throw common::AppException("NOT_FOUND", "班级不存在", drogon::k404NotFound);
    }
    return classroomRepo_.get(classId);
}

Json::Value ClassroomService::removeClassroom(const std::string &classId)
{
    const bool ok = classroomRepo_.remove(classId);
    if (!ok)
    {
        throw common::AppException("NOT_FOUND", "班级不存在", drogon::k404NotFound);
    }
    Json::Value out(Json::objectValue);
    out["removed"] = true;
    out["class_id"] = classId;
    return out;
}

Json::Value ClassroomService::addMembers(const std::string &classId,
                                         const std::vector<std::string> &userIds)
{
    Json::Value out(Json::objectValue);
    out["class_id"] = classId;
    out["student_ids"] = classroomRepo_.addMembers(classId, userIds);
    return out;
}

Json::Value ClassroomService::removeMember(const std::string &classId, const std::string &userId)
{
    const bool ok = classroomRepo_.removeMember(classId, userId);
    Json::Value out(Json::objectValue);
    out["removed"] = ok;
    out["class_id"] = classId;
    out["user_id"] = userId;
    return out;
}

Json::Value ClassroomService::createAssignment(const std::string &classId,
                                               const std::string &createdBy,
                                               const std::string &examId,
                                               const std::string &title,
                                               const std::string &description,
                                               const std::string &dueAt)
{
    if (classId.empty() || examId.empty() || title.empty())
    {
        throw common::AppException(
            "VALIDATION_ERROR", "class_id / exam_id / title 不能为空", drogon::k422UnprocessableEntity);
    }
    // 班级必须存在，避免悬挂作业
    if (classroomRepo_.get(classId).isNull())
    {
        throw common::AppException("NOT_FOUND", "班级不存在", drogon::k404NotFound);
    }
    Json::Value entry(Json::objectValue);
    entry["class_id"] = classId;
    entry["created_by"] = createdBy;
    entry["exam_id"] = examId;
    entry["title"] = title;
    entry["description"] = description;
    entry["due_at"] = dueAt;
    return assignmentRepo_.create(entry);
}

Json::Value ClassroomService::listAssignmentsByClass(const std::string &classId) const
{
    Json::Value out(Json::objectValue);
    out["items"] = assignmentRepo_.listByClass(classId);
    return out;
}

Json::Value ClassroomService::listMyAssignments(const std::string &userId) const
{
    // 先找出所有相关班级 id
    auto classes = classroomRepo_.listForUser(userId);
    std::vector<std::string> classIds;
    classIds.reserve(classes.size());
    for (const auto &c : classes)
    {
        classIds.push_back(c.get("class_id", "").asString());
    }
    Json::Value out(Json::objectValue);
    out["items"] = assignmentRepo_.listByClasses(classIds);
    return out;
}

Json::Value ClassroomService::updateAssignment(const std::string &assignmentId, const Json::Value &patch)
{
    if (!assignmentRepo_.update(assignmentId, patch))
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    return assignmentRepo_.get(assignmentId);
}

Json::Value ClassroomService::removeAssignment(const std::string &assignmentId)
{
    const bool ok = assignmentRepo_.remove(assignmentId);
    if (!ok)
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    Json::Value out(Json::objectValue);
    out["removed"] = true;
    out["assignment_id"] = assignmentId;
    return out;
}

bool ClassroomService::isClassMember(const std::string &classId, const std::string &userId) const
{
    auto c = classroomRepo_.get(classId);
    if (c.isNull())
    {
        return false;
    }
    if (c.get("teacher_user_id", "").asString() == userId)
    {
        return true;
    }
    if (c.isMember("student_ids") && c["student_ids"].isArray())
    {
        for (const auto &sid : c["student_ids"])
        {
            if (sid.asString() == userId)
            {
                return true;
            }
        }
    }
    return false;
}

}  // namespace application::services
