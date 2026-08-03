#include "AssignmentService.h"

#include <chrono>
#include <ctime>
#include <iomanip>
#include <optional>
#include <set>
#include <sstream>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"

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

std::optional<std::chrono::system_clock::time_point> parseIsoTime(const std::string &value)
{
    if (value.empty())
    {
        return std::nullopt;
    }
    std::tm tm{};
    std::istringstream stream(value.size() == 10 ? value + "T23:59:59" : value.substr(0, 19));
    stream >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
    if (stream.fail())
    {
        return std::nullopt;
    }
    tm.tm_isdst = 0;
#ifdef _WIN32
    const auto raw = _mkgmtime(&tm);
#else
    const auto raw = timegm(&tm);
#endif
    if (raw == static_cast<std::time_t>(-1))
    {
        return std::nullopt;
    }
    return std::chrono::system_clock::from_time_t(raw);
}

Json::Value normalizeReminderHours(const Json::Value &value)
{
    Json::Value normalized(Json::arrayValue);
    std::set<int> unique;
    if (!value.isNull())
    {
        if (!value.isArray() || value.empty() || value.size() > 3)
        {
            throw common::AppException(
                "VALIDATION_ERROR",
                "auto_reminder_hours_before 必须包含 1 到 3 个提醒时间",
                drogon::k422UnprocessableEntity);
        }
        for (const auto &item : value)
        {
            if (!item.isIntegral())
            {
                throw common::AppException(
                    "VALIDATION_ERROR",
                    "自动催交时间必须为整数小时",
                    drogon::k422UnprocessableEntity);
            }
            const int hours = item.asInt();
            if (hours < 1 || hours > 168)
            {
                throw common::AppException(
                    "VALIDATION_ERROR",
                    "自动催交时间必须在截止前 1 到 168 小时之间",
                    drogon::k422UnprocessableEntity);
            }
            unique.insert(hours);
        }
    }
    if (unique.empty())
    {
        unique.insert(24);
    }
    for (auto it = unique.rbegin(); it != unique.rend(); ++it)
    {
        normalized.append(*it);
    }
    return normalized;
}

Json::Value storedReminderHours(const Json::Value &assignment)
{
    try
    {
        return normalizeReminderHours(
            assignment.get("auto_reminder_hours_before", Json::Value(Json::nullValue)));
    }
    catch (...)
    {
        Json::Value fallback(Json::arrayValue);
        fallback.append(24);
        return fallback;
    }
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
    if (payload.isMember("due_at") && !payload["due_at"].isString())
    {
        throw common::AppException("VALIDATION_ERROR", "due_at 必须是字符串", drogon::k422UnprocessableEntity);
    }
    if (payload.isMember("auto_reminder_enabled") && !payload["auto_reminder_enabled"].isBool())
    {
        throw common::AppException(
            "VALIDATION_ERROR",
            "auto_reminder_enabled 必须是布尔值",
            drogon::k422UnprocessableEntity);
    }
    const auto dueAt = payload.get("due_at", "").asString();
    if (!dueAt.empty() && !parseIsoTime(dueAt))
    {
        throw common::AppException("VALIDATION_ERROR", "due_at 不是有效日期时间", drogon::k422UnprocessableEntity);
    }
    const bool autoReminderEnabled = payload.isMember("auto_reminder_enabled")
                                         ? payload["auto_reminder_enabled"].asBool()
                                         : !dueAt.empty();
    if (autoReminderEnabled && dueAt.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "开启自动催交前请先设置截止时间", drogon::k422UnprocessableEntity);
    }
    entry["due_at"] = dueAt;
    entry["auto_reminder_enabled"] = autoReminderEnabled;
    entry["auto_reminder_hours_before"] = normalizeReminderHours(
        payload.get("auto_reminder_hours_before", Json::Value(Json::nullValue)));
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

Json::Value AssignmentService::getAssignmentForStudent(const std::string &assignmentId,
                                                       const std::string &userId) const
{
    return sanitizeAssignmentForStudent(getAssignment(assignmentId), userId);
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

Json::Value AssignmentService::reviewSubmission(const std::string &assignmentId,
	                                              const std::string &studentId,
	                                              const std::string &reviewedBy,
	                                              const Json::Value &payload)
{
	getAssignment(assignmentId);
	Json::Value review(Json::objectValue);
	review["action"] = payload.get("action", "reviewed").asString();
	review["comment"] = payload.get("comment", "").asString();
	review["reviewed_by"] = reviewedBy;
	if (payload.isMember("manual_score")) review["manual_score"] = payload["manual_score"].asDouble();
	const auto saved = assignmentRepository_.reviewSubmission(assignmentId, studentId, review);
	if (saved.isNull())
	{
		throw common::AppException("SUBMISSION_NOT_FOUND", "作业提交不存在", drogon::k404NotFound);
	}
	return saved;
}

Json::Value AssignmentService::remindAssignment(const std::string &assignmentId,
                                                const std::string &createdBy,
                                                const Json::Value &payload)
{
    const auto assignment = getAssignment(assignmentId);
    const auto group = getLearningGroup(assignment.get("organization_id", "").asString(), assignmentLearningGroupId(assignment));
    Json::Value reminder(Json::objectValue);
    reminder["created_by"] = createdBy;
    reminder["message"] = payload["message"].asString();
    reminder["idempotency_key"] = payload["idempotency_key"].asString();
    reminder["source"] = payload.get("source", "manual").asString();
    if (payload.isMember("hours_before"))
    {
        reminder["hours_before"] = payload["hours_before"].asInt();
    }
    reminder["target_student_ids"] = Json::Value(Json::arrayValue);
    const auto validStudents = studentIdsForLearningGroup(group);
    const std::set<std::string> validStudentSet(validStudents.begin(), validStudents.end());
    if (payload.isMember("student_ids") && payload["student_ids"].isArray())
    {
        std::set<std::string> targets;
        for (const auto &studentIdValue : payload["student_ids"])
        {
            const auto studentId = studentIdValue.asString();
            if (validStudentSet.count(studentId) > 0)
            {
                targets.insert(studentId);
            }
        }
        for (const auto &studentId : targets)
        {
            reminder["target_student_ids"].append(studentId);
        }
    }
    else
    {
        const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
        for (const auto &studentId : validStudents)
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

Json::Value AssignmentService::runAutomaticReminderJobs(const std::string &nowIso)
{
    const auto effectiveNow = nowIso.empty() ? common::nowIso8601() : nowIso;
    const auto now = parseIsoTime(effectiveNow);
    if (!now)
    {
        throw common::AppException("VALIDATION_ERROR", "自动催交任务时间无效", drogon::k422UnprocessableEntity);
    }

    Json::Value result(Json::objectValue);
    result["run_at"] = effectiveNow;
    result["scanned"] = 0;
    result["eligible"] = 0;
    result["reminders_created"] = 0;
    result["targets"] = 0;
    result["skipped_invalid_due_at"] = 0;
    result["failed"] = 0;
    result["deliveries"] = Json::Value(Json::arrayValue);

    for (const auto &assignment : assignmentRepository_.listAll())
    {
        result["scanned"] = result["scanned"].asInt() + 1;
        const auto dueAt = assignment.get("due_at", "").asString();
        const bool enabled = assignment.get("auto_reminder_enabled", !dueAt.empty()).asBool();
        if (!enabled || dueAt.empty())
        {
            continue;
        }
        const auto due = parseIsoTime(dueAt);
        if (!due)
        {
            result["skipped_invalid_due_at"] = result["skipped_invalid_due_at"].asInt() + 1;
            continue;
        }
        if (*now >= *due)
        {
            continue;
        }

        try
        {
            const auto group = getLearningGroup(
                assignment.get("organization_id", "").asString(),
                assignmentLearningGroupId(assignment));
            const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
            Json::Value missingStudentIds(Json::arrayValue);
            for (const auto &studentId : studentIdsForLearningGroup(group))
            {
                if (!submissions.isMember(studentId))
                {
                    missingStudentIds.append(studentId);
                }
            }
            if (missingStudentIds.empty())
            {
                continue;
            }

            for (const auto &hoursValue : storedReminderHours(assignment))
            {
                const int hoursBefore = hoursValue.asInt();
                const auto windowStarts = *due - std::chrono::hours(hoursBefore);
                if (*now < windowStarts)
                {
                    continue;
                }
                result["eligible"] = result["eligible"].asInt() + 1;
                Json::Value payload(Json::objectValue);
                payload["message"] = "作业《" + assignment.get("title", "未命名作业").asString() +
                                     "》将在 " + std::to_string(hoursBefore) + " 小时内截止，请及时完成。";
                payload["idempotency_key"] = "auto:" +
                                             assignment.get("assignment_id", "").asString() + ":" +
                                             dueAt + ":" + std::to_string(hoursBefore);
                payload["student_ids"] = missingStudentIds;
                payload["source"] = "automatic";
                payload["hours_before"] = hoursBefore;
                const auto reminder = remindAssignment(
                    assignment.get("assignment_id", "").asString(),
                    "system",
                    payload);
                if (reminder.get("idempotent_replay", false).asBool())
                {
                    continue;
                }
                const auto targetCount = static_cast<int>(
                    reminder.get("target_student_ids", Json::Value(Json::arrayValue)).size());
                result["reminders_created"] = result["reminders_created"].asInt() + 1;
                result["targets"] = result["targets"].asInt() + targetCount;
                Json::Value delivery(Json::objectValue);
                delivery["organization_id"] = assignment.get("organization_id", "");
                delivery["assignment_id"] = assignment.get("assignment_id", "");
                delivery["reminder_id"] = reminder.get("reminder_id", "");
                delivery["hours_before"] = hoursBefore;
                delivery["target_count"] = targetCount;
                result["deliveries"].append(delivery);
            }
        }
        catch (...)
        {
            result["failed"] = result["failed"].asInt() + 1;
        }
    }
    return result;
}

Json::Value AssignmentService::updateAssignment(const std::string &assignmentId, const Json::Value &patch)
{
    const auto current = getAssignment(assignmentId);
    Json::Value safePatch = patch;
    if (patch.isMember("due_at"))
    {
        if (!patch["due_at"].isString())
        {
            throw common::AppException("VALIDATION_ERROR", "due_at 必须是字符串", drogon::k422UnprocessableEntity);
        }
        const auto dueAt = patch["due_at"].asString();
        if (!dueAt.empty() && !parseIsoTime(dueAt))
        {
            throw common::AppException("VALIDATION_ERROR", "due_at 不是有效日期时间", drogon::k422UnprocessableEntity);
        }
    }
    if (patch.isMember("auto_reminder_enabled") && !patch["auto_reminder_enabled"].isBool())
    {
        throw common::AppException("VALIDATION_ERROR", "auto_reminder_enabled 必须是布尔值", drogon::k422UnprocessableEntity);
    }
    if (patch.isMember("auto_reminder_hours_before"))
    {
        safePatch["auto_reminder_hours_before"] = normalizeReminderHours(patch["auto_reminder_hours_before"]);
    }
    const auto finalDueAt = safePatch.get("due_at", current.get("due_at", "")).asString();
    const bool finalEnabled = safePatch.get(
        "auto_reminder_enabled",
        current.get("auto_reminder_enabled", !finalDueAt.empty())).asBool();
    if (finalEnabled && finalDueAt.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "开启自动催交前请先设置截止时间", drogon::k422UnprocessableEntity);
    }
    if (!assignmentRepository_.update(assignmentId, safePatch))
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
    Json::Value ownReminders(Json::arrayValue);
    for (const auto &reminder : assignment.get("reminders", Json::Value(Json::arrayValue)))
    {
        bool targeted = false;
        for (const auto &studentId : reminder.get("target_student_ids", Json::Value(Json::arrayValue)))
        {
            if (studentId.asString() == userId)
            {
                targeted = true;
                break;
            }
        }
        if (!targeted)
        {
            continue;
        }
        Json::Value safeReminder(Json::objectValue);
        safeReminder["reminder_id"] = reminder.get("reminder_id", "");
        safeReminder["message"] = reminder.get("message", "");
        safeReminder["created_at"] = reminder.get("created_at", "");
        safeReminder["source"] = reminder.get("source", "manual");
        if (reminder.isMember("hours_before"))
        {
            safeReminder["hours_before"] = reminder["hours_before"];
        }
        ownReminders.append(safeReminder);
    }
    assignment["own_reminders"] = ownReminders;
    assignment.removeMember("submissions");
    assignment.removeMember("reminders");
    return assignment;
}
}  // namespace application::services
