#include "AssignmentService.h"

#include <set>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"

namespace application::services
{
namespace
{
Json::Value findLearningGroup(const Json::Value &groups, const std::string &learningGroupId)
{
    if (!groups.isArray() || learningGroupId.empty())
    {
        return Json::Value(Json::nullValue);
    }
    for (const auto &group : groups)
    {
        if (group.get("learning_group_id", "").asString() == learningGroupId ||
            group.get("group_id", "").asString() == learningGroupId ||
            group.get("id", "").asString() == learningGroupId)
        {
            return group;
        }
    }
    return Json::Value(Json::nullValue);
}
}  // namespace

AssignmentService::AssignmentService(infrastructure::storage::AssignmentRepository &assignmentRepository,
                                     infrastructure::storage::OrganizationRepository &organizationRepository)
    : assignmentRepository_(assignmentRepository),
      organizationRepository_(organizationRepository)
{
}

Json::Value AssignmentService::createAssignment(const std::string &organizationId,
                                                const std::string &learningGroupId,
                                                const std::string &createdBy,
                                                const Json::Value &payload)
{
    const auto organization = requireOrganization(organizationId);
    const auto group = requireLearningGroup(organization, learningGroupId);
    const auto examId = payload.get("exam_id", "").asString();
    const auto title = payload.get("title", "").asString();
    if (examId.empty() || title.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "exam_id / title 不能为空", drogon::k422UnprocessableEntity);
    }

    Json::Value entry(Json::objectValue);
    entry["organization_id"] = organizationId;
    entry["learning_group_id"] = group.get("learning_group_id", learningGroupId).asString();
    entry["group_id"] = entry["learning_group_id"].asString();
    entry["learning_group_name"] = group.get("name", "").asString();
    entry["created_by"] = createdBy;
    entry["exam_id"] = examId;
    entry["title"] = title;
    entry["description"] = payload.get("description", "").asString();
    entry["due_at"] = payload.get("due_at", "").asString();
    entry["question_ids"] = payload.get("question_ids", Json::Value(Json::arrayValue));
    if (!entry["question_ids"].isArray())
    {
        entry["question_ids"] = Json::Value(Json::arrayValue);
    }
    entry["question_start"] = payload.get("question_start", 0).asInt();
    entry["question_end"] = payload.get("question_end", 0).asInt();
    entry["submissions"] = Json::Value(Json::objectValue);
    entry["reminders"] = Json::Value(Json::arrayValue);
    return assignmentRepository_.create(entry);
}

Json::Value AssignmentService::listAssignmentsByLearningGroup(const std::string &organizationId,
                                                              const std::string &learningGroupId) const
{
    requireLearningGroup(requireOrganization(organizationId), learningGroupId);
    Json::Value out(Json::objectValue);
    out["items"] = assignmentRepository_.listByLearningGroup(learningGroupId);
    return out;
}

Json::Value AssignmentService::listMyAssignments(const std::string &userId, const Json::Value &roles) const
{
    std::vector<std::string> groupIds;
    const auto organizations = hasRole(roles, "superAdmin")
                                   ? organizationRepository_.allOrganizationsArray()
                                   : organizationRepository_.listOrganizationsForUser(userId);
    for (const auto &organization : organizations)
    {
        for (const auto &group : organization.get("learning_groups", Json::Value(Json::arrayValue)))
        {
            if (isLearningGroupMember(organization.get("organization_id", "").asString(),
                                      group.get("learning_group_id", "").asString(),
                                      userId) ||
                hasRole(roles, "superAdmin"))
            {
                groupIds.push_back(group.get("learning_group_id", "").asString());
            }
        }
    }

    Json::Value items = assignmentRepository_.listByLearningGroups(groupIds);
    Json::Value safeItems(Json::arrayValue);
    for (auto assignment : items)
    {
        const auto organizationId = assignment.get("organization_id", "").asString();
        const auto learningGroupId = assignmentLearningGroupId(assignment);
        if (!isLearningGroupStaff(organizationId, learningGroupId, userId) && !hasRole(roles, "orgAdmin") && !hasRole(roles, "superAdmin"))
        {
            assignment = sanitizeAssignmentForStudent(assignment, userId);
        }
        safeItems.append(assignment);
    }
    Json::Value out(Json::objectValue);
    out["items"] = safeItems;
    return out;
}

Json::Value AssignmentService::getAssignment(const std::string &assignmentId) const
{
    auto assignment = assignmentRepository_.get(assignmentId);
    if (assignment.isNull())
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    return assignment;
}

Json::Value AssignmentService::submitAssignment(const std::string &assignmentId,
                                                const std::string &studentId,
                                                const Json::Value &answers,
                                                const Json::Value &score)
{
    const auto assignment = getAssignment(assignmentId);
    const auto organizationId = assignment.get("organization_id", "").asString();
    const auto learningGroupId = assignmentLearningGroupId(assignment);
    const auto group = getLearningGroup(organizationId, learningGroupId);
    bool isStudent = false;
    for (const auto &enrollment : group.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (enrollment.get("user_id", "").asString() == studentId &&
            enrollment.get("role", "student").asString() == "student" &&
            enrollment.get("status", "active").asString() == "active")
        {
            isStudent = true;
            break;
        }
    }
    if (!isStudent)
    {
        throw common::AppException("FORBIDDEN", "只有学习组学员可以提交该作业", drogon::k403Forbidden);
    }

    Json::Value submission(Json::objectValue);
    submission["answers"] = answers;
    submission["score"] = score;
    submission["status"] = "submitted";
    return assignmentRepository_.submit(assignmentId, studentId, submission);
}

Json::Value AssignmentService::assignmentSubmissions(const std::string &assignmentId) const
{
    Json::Value out(Json::objectValue);
    const auto assignment = getAssignment(assignmentId);
    out["assignment"] = assignment;
    out["learning_group"] = getLearningGroup(assignment.get("organization_id", "").asString(), assignmentLearningGroupId(assignment));
    out["submissions"] = assignmentRepository_.listSubmissions(assignmentId);
    return out;
}

Json::Value AssignmentService::remindAssignment(const std::string &assignmentId,
                                                const std::string &createdBy,
                                                const Json::Value &payload)
{
    const auto assignment = getAssignment(assignmentId);
    const auto group = getLearningGroup(assignment.get("organization_id", "").asString(), assignmentLearningGroupId(assignment));
    Json::Value reminder(Json::objectValue);
    reminder["created_by"] = createdBy;
    reminder["message"] = payload.get("message", "请按时完成作业").asString();
    reminder["target_student_ids"] = Json::Value(Json::arrayValue);
    if (payload.isMember("student_ids") && payload["student_ids"].isArray())
    {
        reminder["target_student_ids"] = payload["student_ids"];
    }
    else
    {
        const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
        for (const auto &studentId : studentIdsForLearningGroup(group))
        {
            if (!submissions.isMember(studentId))
            {
                reminder["target_student_ids"].append(studentId);
            }
        }
    }
    const auto saved = assignmentRepository_.addReminder(assignmentId, reminder);
    if (saved.isNull())
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    return saved;
}

Json::Value AssignmentService::updateAssignment(const std::string &assignmentId, const Json::Value &patch)
{
    if (!assignmentRepository_.update(assignmentId, patch))
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    return assignmentRepository_.get(assignmentId);
}

Json::Value AssignmentService::removeAssignment(const std::string &assignmentId)
{
    const bool ok = assignmentRepository_.remove(assignmentId);
    if (!ok)
    {
        throw common::AppException("NOT_FOUND", "作业不存在", drogon::k404NotFound);
    }
    Json::Value out(Json::objectValue);
    out["removed"] = true;
    out["assignment_id"] = assignmentId;
    return out;
}

bool AssignmentService::isLearningGroupMember(const std::string &organizationId,
                                              const std::string &learningGroupId,
                                              const std::string &userId) const
{
    if (userId.empty())
    {
        return false;
    }
    const auto group = findLearningGroup(requireOrganization(organizationId).get("learning_groups", Json::Value(Json::arrayValue)), learningGroupId);
    if (group.isNull())
    {
        return false;
    }
    for (const auto &enrollment : group.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (enrollment.get("user_id", "").asString() == userId &&
            enrollment.get("status", "active").asString() == "active")
        {
            return true;
        }
    }
    return false;
}

bool AssignmentService::isLearningGroupStaff(const std::string &organizationId,
                                             const std::string &learningGroupId,
                                             const std::string &userId) const
{
    if (userId.empty())
    {
        return false;
    }
    const auto group = findLearningGroup(requireOrganization(organizationId).get("learning_groups", Json::Value(Json::arrayValue)), learningGroupId);
    if (group.isNull())
    {
        return false;
    }
    for (const auto &enrollment : group.get("enrollments", Json::Value(Json::arrayValue)))
    {
        const auto role = enrollment.get("role", "").asString();
        if (enrollment.get("user_id", "").asString() == userId &&
            enrollment.get("status", "active").asString() == "active" &&
            (role == "teacher" || role == "assistant"))
        {
            return true;
        }
    }
    const auto membership = organizationRepository_.findMembership(userId, organizationId);
    return hasRole(membership["roles"], "orgAdmin");
}

Json::Value AssignmentService::getLearningGroup(const std::string &organizationId, const std::string &learningGroupId) const
{
    return requireLearningGroup(requireOrganization(organizationId), learningGroupId);
}

std::vector<std::string> AssignmentService::studentIdsForLearningGroup(const Json::Value &learningGroup)
{
    std::set<std::string> ids;
    for (const auto &enrollment : learningGroup.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (enrollment.get("role", "student").asString() == "student" &&
            enrollment.get("status", "active").asString() == "active")
        {
            const auto userId = enrollment.get("user_id", "").asString();
            if (!userId.empty())
            {
                ids.insert(userId);
            }
        }
    }
    return {ids.begin(), ids.end()};
}

Json::Value AssignmentService::requireOrganization(const std::string &organizationId) const
{
    const auto organization = organizationRepository_.findOrganization(organizationId);
    if (organization.isNull())
    {
        throw common::AppException("ORGANIZATION_NOT_FOUND", "机构不存在", drogon::k404NotFound);
    }
    return organization;
}

Json::Value AssignmentService::requireLearningGroup(const Json::Value &organization, const std::string &learningGroupId) const
{
    const auto group = findLearningGroup(organization.get("learning_groups", Json::Value(Json::arrayValue)), learningGroupId);
    if (group.isNull())
    {
        throw common::AppException("LEARNING_GROUP_NOT_FOUND", "学习组不存在", drogon::k404NotFound);
    }
    return group;
}

bool AssignmentService::hasRole(const Json::Value &roles, const std::string &role)
{
    if (!roles.isArray())
    {
        return false;
    }
    for (const auto &item : roles)
    {
        if (item.asString() == role)
        {
            return true;
        }
    }
    return false;
}

std::string AssignmentService::assignmentLearningGroupId(const Json::Value &assignment)
{
    return assignment.get("learning_group_id", assignment.get("group_id", "")).asString();
}

Json::Value AssignmentService::sanitizeAssignmentForStudent(Json::Value assignment, const std::string &userId)
{
    const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
    assignment["own_submission"] = submissions.get(userId, Json::Value(Json::nullValue));
    assignment.removeMember("submissions");
    assignment.removeMember("reminders");
    return assignment;
}
}  // namespace application::services
