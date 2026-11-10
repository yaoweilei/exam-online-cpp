#include "InstitutionService.h"
#include "InstitutionAccess.h"
#include "AssignmentScope.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include <algorithm>
#include <chrono>
#include <map>
#include <set>
#include <regex>
#include <drogon/HttpTypes.h>

namespace application::services
{
namespace
{
using JsonArray = Json::Value;
std::string field(const Json::Value &body, const char *key, const std::string &fallback = "", size_t max = 500)
{
    if (!body.isMember(key)) return fallback;
    if (!body[key].isString() || body[key].asString().size() > max)
        throw common::AppException("VALIDATION_ERROR", std::string(key) + " 格式或长度不正确", drogon::k422UnprocessableEntity);
    return body[key].asString();
}
void invalid(const std::string &message)
{
    throw common::AppException("VALIDATION_ERROR", message, drogon::k422UnprocessableEntity);
}
std::string utcTime(const std::string &value)
{
    static const std::regex pattern(R"(^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$)");
    if (!std::regex_match(value, pattern)) invalid("请提供有效的日期时间");
    const auto year = std::stoi(value.substr(0, 4)), month = std::stoi(value.substr(5, 2)), day = std::stoi(value.substr(8, 2));
    if (!std::chrono::year_month_day{std::chrono::year{year}, std::chrono::month{static_cast<unsigned>(month)}, std::chrono::day{static_cast<unsigned>(day)}}.ok() ||
        std::stoi(value.substr(11, 2)) > 23 || std::stoi(value.substr(14, 2)) > 59 || std::stoi(value.substr(17, 2)) > 59)
        invalid("日期时间不正确");
    return value.substr(0, 19) + (value.size() == 20 ? ".000Z" : value.substr(19));
}
JsonArray array(const Json::Value &value) { return value.isArray() ? value : JsonArray(Json::arrayValue); }
Json::Value find(const Json::Value &items, const char *key, const std::string &id)
{
    for (const auto &item : items) if (item.get(key, "").asString() == id) return item;
    return Json::nullValue;
}
bool enrolled(const Json::Value &group, const std::string &id, const std::string &role = "")
{
    for (const auto &entry : group["enrollments"])
        if (entry.get("status", "active").asString() == "active" && entry.get("user_id", "").asString() == id &&
            (role.empty() || entry.get("role", "student").asString() == role)) return true;
    return false;
}
std::set<std::string> participants(const Json::Value &group, const Json::Value &lesson = Json::Value(Json::nullValue))
{
    std::set<std::string> result;
    for (const auto &entry : group["enrollments"])
        if (entry.get("status", "active").asString() == "active")
        {
            const auto id = entry.get("user_id", "").asString();
            if (entry.get("role", "student").asString() == "student" && lesson["student_ids"].isArray())
            {
                bool selected = false; for (const auto &student : lesson["student_ids"]) if (student.asString() == id) selected = true;
                if (!selected) continue;
            }
            result.insert(id);
        }
    return result;
}
void appendBounded(Json::Value &items, const Json::Value &item)
{
    items = array(items); items.append(item);
    // Business records/ledger are never truncated; only notification previews use this bound.
    if (items.size() > 2000) { Json::Value kept(Json::arrayValue); for (Json::ArrayIndex i = items.size() - 2000; i < items.size(); ++i) kept.append(items[i]); items = kept; }
}
}

bool InstitutionService::canFollowStudent(const std::string &userId, const Json::Value &roles,
                                         const std::string &orgId, const std::string &studentId) const
{
    if (orgId.empty() || activeInstitutionMembership(organizationRepository_, studentId, orgId).isNull()) return false;
    const auto effective = institutionRolesForOrganization(organizationRepository_, userId, roles, orgId);
    if (canManageInstitution(effective)) return true;
    for (const auto &group : visibleLearningGroups(userId, roles, orgId))
        if (enrolled(group, studentId, "student") && (enrolled(group, userId, "teacher") || enrolled(group, userId, "assistant"))) return true;
    return false;
}

Json::Value InstitutionService::followups(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    if (orgId.empty() || !canAccessTeaching(userId, roles, orgId))
        throw common::AppException("FORBIDDEN", "无权查看该机构跟进", drogon::k403Forbidden);
    const auto org = organizationRepository_.findOrganization(orgId);
    Json::Value out(Json::objectValue); out["items"] = Json::arrayValue; out["staff"] = Json::arrayValue; out["students"] = Json::arrayValue;
    const auto groups = visibleLearningGroups(userId, roles, orgId);
    const bool manager = canManageInstitution(institutionRolesForOrganization(organizationRepository_, userId, roles, orgId));
    for (const auto &item : array(org["followups"]))
        if (canFollowStudent(userId, roles, orgId, item.get("student_id", "").asString()))
        {
            auto row = item; row["student"] = buildMemberView(item["student_id"].asString());
            row["owner"] = buildMemberView(item.get("owner_id", "").asString()); out["items"].append(row);
        }
    for (const auto &member : organizationRepository_.listMembershipsForScope(orgId))
    {
        const auto id = member["user_id"].asString();
        if (member.get("status", "active").asString() == "active" && institutionHasRole(member["roles"], "student"))
        {
            bool visible = manager;
            for (const auto &group : groups) if (enrolled(group, id, "student")) visible = true;
            if (visible) { auto student = buildMemberView(id); if (featureEnabledForOrg(orgId, "renewal_risk")) student["activity_risk"] = renewalRisk(id, answerRepository_.listUserAnswers(id), orgId); out["students"].append(student); }
        }
        if (member.get("status", "active").asString() == "active" &&
            (institutionHasRole(member["roles"], "teacher") || institutionHasRole(member["roles"], "assistant") || institutionHasRole(member["roles"], "orgAdmin")))
            out["staff"].append(buildMemberView(member["user_id"].asString()));
    }
    Json::Value organizations(Json::arrayValue); organizations.append(org);
    out["course_packages"] = buildCoursePackageSummary(organizations, groups, userId, roles);
    out["assignments"] = Json::arrayValue;
    for (const auto &group : groups)
        for (const auto &assignment : assignmentRepository_.listByLearningGroup(group.get("learning_group_id", "").asString()))
            out["assignments"].append(buildAssignmentProgress(group, assignment));
    return out;
}

Json::Value InstitutionService::saveFollowup(const std::string &userId, const Json::Value &roles,
                                            const std::string &orgId, const Json::Value &payload)
{
    const auto studentId = field(payload, "student_id"), id = field(payload, "followup_id");
    if (!canFollowStudent(userId, roles, orgId, studentId))
        throw common::AppException("FORBIDDEN", "无权跟进该机构学员", drogon::k403Forbidden);
    const auto ownerId = field(payload, "owner_id", userId);
    if (!canFollowStudent(ownerId, userRepository_.effectivePlatformRoles(ownerId), orgId, studentId))
        invalid("负责人必须是负责该学员的机构职员");
    const auto text = field(payload, "text", "", 2000), status = field(payload, "status", "pending");
    const auto result = field(payload, "result", "", 2000), next = field(payload, "next_at");
    if (text.empty()) invalid("请填写跟进内容");
    if (status != "pending" && status != "contacted" && status != "completed") invalid("跟进状态不正确");
    if (status == "completed" && result.empty()) invalid("完成跟进时请填写处理结果");
    if (!next.empty()) utcTime(next);
    Json::Value saved;
    organizationRepository_.updateOrganization(orgId, [&](Json::Value &org) {
        auto records = array(org["followups"]); auto existing = find(records, "followup_id", id);
        if (!id.empty() && (existing.isNull() || existing.get("student_id", "").asString() != studentId))
            invalid("跟进记录不存在或不属于该学员");
        saved = existing.isNull() ? Json::Value(Json::objectValue) : existing;
        if (!existing.isNull())
        {
            Json::Value change(Json::objectValue); change["status"] = existing["status"]; change["text"] = existing["text"];
            change["result"] = existing["result"]; change["owner_id"] = existing["owner_id"]; change["next_at"] = existing["next_at"];
            change["changed_at"] = common::nowIso8601(); change["changed_by"] = userId;
            saved["history"] = array(saved["history"]); saved["history"].append(change);
        }
        saved["followup_id"] = id.empty() ? common::generateOpaqueId("fu_") : id;
        saved["organization_id"] = orgId; saved["student_id"] = studentId; saved["owner_id"] = ownerId;
        saved["text"] = text; saved["status"] = status; saved["result"] = result; saved["next_at"] = next;
        saved["created_at"] = saved.get("created_at", common::nowIso8601()); saved["created_by"] = saved.get("created_by", userId);
        saved["updated_at"] = common::nowIso8601(); saved["updated_by"] = userId;
        bool replaced = false; for (auto &row : records) if (row["followup_id"] == saved["followup_id"]) { row = saved; replaced = true; break; }
        if (!replaced) records.append(saved); org["followups"] = records;
        Json::Value details(Json::objectValue); details["student_id"] = studentId; details["followup_id"] = saved["followup_id"]; details["status"] = status;
        org = appendOrganizationAuditEntry(org, userId, "institution.followup.saved", "保存学员跟进", details);
    });
    return saved;
}

Json::Value InstitutionService::lessons(const std::string &userId, const Json::Value &roles,
                                       const std::string &orgId, const std::string &groupId) const
{
    const auto groups = visibleLearningGroups(userId, roles, orgId);
    auto group = find(groups, "learning_group_id", groupId);
    if (group.isNull() || !(canManageInstitution(institutionRolesForOrganization(organizationRepository_, userId, roles, orgId)) ||
        enrolled(group, userId, "teacher") || enrolled(group, userId, "assistant")))
        throw common::AppException("FORBIDDEN", "无权管理这个班级的课次", drogon::k403Forbidden);
    const auto org = organizationRepository_.findOrganization(orgId);
    Json::Value out(Json::objectValue); out["items"] = Json::arrayValue; out["students"] = Json::arrayValue; out["course_packages"] = Json::arrayValue; out["assignments"] = Json::arrayValue;
    out["group"] = group; out["organization_name"] = org.get("name", "");
    out["can_correct_settlement"] = canManageInstitution(institutionRolesForOrganization(organizationRepository_,userId,roles,orgId));
    out["relationship_groups"]=Json::arrayValue; out["relationship_staff"]=Json::arrayValue;
    if (out["can_correct_settlement"].asBool()) {
        for (const auto &g:array(org["learning_groups"])) if (g.get("status","active").asString()=="active") { Json::Value row; row["id"]=g["learning_group_id"]; row["name"]=g["name"]; out["relationship_groups"].append(row); }
        for (const auto &member:organizationRepository_.listMembershipsForScope(orgId)) if (member.get("status","active").asString()=="active"&&(institutionHasRole(member["roles"],"teacher")||institutionHasRole(member["roles"],"assistant")||institutionHasRole(member["roles"],"orgAdmin"))) out["relationship_staff"].append(buildMemberView(member["user_id"].asString()));
    }
    for (const auto &assignment : assignmentRepository_.listByLearningGroup(groupId))
    {
        Json::Value row(Json::objectValue); row["assignment_id"] = assignment["assignment_id"];
        row["title"] = assignment["title"]; row["exam_id"] = assignment["exam_id"]; out["assignments"].append(row);
    }
    for (const auto &lesson : array(org["lessons"])) if (lesson.get("group_id", "").asString() == groupId) out["items"].append(lesson);
    std::set<std::string> students;
    for (const auto &studentId : learningGroupStudentIds(group)) students.insert(studentId);
    for (const auto &lesson : out["items"]) for (const auto &entry : array(effectiveLessonAttendance(lesson))) students.insert(entry["student_id"].asString());
    const auto currentStudents=learningGroupStudentIds(group);
    for (const auto &studentId : students) { auto view=buildMemberView(studentId); view["historical_only"]=std::find(currentStudents.begin(),currentStudents.end(),studentId)==currentStudents.end(); out["students"].append(view); }
    for (const auto &package : array(org["course_packages"]))
        if (package.get("record_type", "assignment").asString() == "assignment" && students.contains(package.get("student_id", "").asString()))
            out["course_packages"].append(package);
    return out;
}

Json::Value InstitutionService::saveLesson(const std::string &userId, const Json::Value &roles,
                                          const std::string &orgId, const std::string &groupId, const Json::Value &payload)
{
    lessons(userId, roles, orgId, groupId); // Check staff scope before entering the repository write lock.
    Json::Value saved;
    organizationRepository_.updateOrganization(orgId, [&](Json::Value &org) { saved=applyLesson(userId,orgId,groupId,org,payload); });
    return saved;
}

Json::Value InstitutionService::applyLesson(const std::string &userId,const std::string &orgId,const std::string &groupId,Json::Value &org,const Json::Value &payload)
{
    const auto requestedId = field(payload, "lesson_id"), start = utcTime(field(payload, "starts_at")), end = utcTime(field(payload, "ends_at"));
    if (start >= end) invalid("结束时间必须晚于开始时间");
    const auto title = field(payload, "title", "", 120), feedback = field(payload, "feedback", "", 2000);
    const auto status = field(payload, "status", "scheduled");
    if (status != "scheduled" && status != "cancelled" && status != "completed") invalid("课次状态不正确");
    if (title.empty()) invalid("请填写课次标题");
    Json::Value saved;
        auto records = array(org["lessons"]); auto existing = find(records, "lesson_id", requestedId);
        const auto group = find(array(org["learning_groups"]), "learning_group_id", groupId);
        if (group.isNull()) invalid("班级不存在");
        if (!requestedId.empty() && (existing.isNull() || existing.get("group_id", "").asString() != groupId)) invalid("课次不存在");
        if (existing.get("status", "").asString() == "completed")
        {
            if (status == "completed") { return existing; } // Idempotent: never debit twice.
            invalid("已结算课次不能直接修改，请保留原始扣课记录");
        }
        const auto assignmentId = field(payload, "assignment_id", existing.get("assignment_id", "").asString());
        if (!assignmentId.empty())
        {
            const auto assignment = assignmentRepository_.get(assignmentId);
            if (assignment.isNull() || assignment.get("learning_group_id", "").asString() != groupId || assignment.get("organization_id", "").asString() != orgId)
                invalid("课后作业必须属于本机构的当前班级");
        }
        auto selectedStudents = payload.isMember("student_ids") ? array(payload["student_ids"]) : existing["student_ids"];
        if (!selectedStudents.isArray())
        {
            selectedStudents = Json::arrayValue; for (const auto &id : learningGroupStudentIds(group)) selectedStudents.append(id);
        }
        std::set<std::string> selected;
        for (const auto &id : selectedStudents)
            if (!id.isString() || !enrolled(group, id.asString(), "student") || !selected.insert(id.asString()).second) invalid("授课学员不属于班级或重复");
        if (selected.empty() && status != "cancelled") invalid("请至少选择一位授课学员");
        const auto makeupFor = field(payload, "makeup_for", existing.get("makeup_for", "").asString());
        if (!makeupFor.empty())
        {
            const auto original = find(records, "lesson_id", makeupFor);
            if (original.isNull() || original.get("group_id", "").asString() != groupId || original.get("status", "").asString() != "completed")
                invalid("补课需要关联本班已完成的原课次");
        }
        Json::Value candidate; candidate["student_ids"] = selectedStudents;
        if (status != "cancelled")
        {
            const auto ids = participants(group, candidate);
            const auto overlaps = [&](const Json::Value &other, const Json::Value &otherGroup) {
                if (other.get("status", "").asString() == "cancelled" || other.get("status", "").asString() == "no_show") return false;
                const auto rawStart = other.get("starts_at", "").asString(), rawEnd = other.get("ends_at", "").asString();
                if (rawStart.empty() || rawEnd.empty()) return false;
                std::string otherStart, otherEnd;
                try { otherStart = utcTime(rawStart); otherEnd = utcTime(rawEnd); } catch (...) { return false; }
                if (!(start < otherEnd && end > otherStart)) return false;
                const auto otherIds = participants(otherGroup, other);
                for (const auto &participant : ids) if (otherIds.contains(participant)) return true;
                return false;
            };
            for (const auto &other : records)
                if (other.get("lesson_id", "").asString() != requestedId && overlaps(other, find(array(org["learning_groups"]), "learning_group_id", other.get("group_id", "").asString())))
                    throw common::AppException("SCHEDULE_CONFLICT", "该时段老师或学员已有课程，请调整时间", drogon::k409Conflict);
            for (const auto &otherGroup : array(org["learning_groups"]))
            {
                bool hasLessons = false;
                for (const auto &row : records) if (row.get("group_id", "") == otherGroup["learning_group_id"]) hasLessons = true;
                if (!hasLessons && otherGroup["learning_group_id"].asString() != groupId && overlaps(otherGroup, otherGroup))
                    throw common::AppException("SCHEDULE_CONFLICT", "该时段已有班级排课，请调整时间", drogon::k409Conflict);
            }
        }
        saved = existing.isNull() ? Json::Value(Json::objectValue) : existing;
        if (!existing.isNull())
        {
            auto snapshot = existing; snapshot.removeMember("history"); snapshot["changed_by"] = userId; snapshot["changed_at"] = common::nowIso8601();
            saved["history"] = array(saved["history"]); saved["history"].append(snapshot);
        }
        saved["lesson_id"] = requestedId.empty() ? common::generateOpaqueId("lesson_") : requestedId;
        saved["organization_id"] = orgId; saved["group_id"] = groupId; saved["title"] = title;
        saved["starts_at"] = start; saved["ends_at"] = end; saved["status"] = status; saved["feedback"] = feedback;
        saved["teacher_ids"] = Json::arrayValue; for (const auto &staff : learningGroupStaffIds(group)) saved["teacher_ids"].append(staff);
        saved["student_ids"] = selectedStudents; saved["makeup_for"] = makeupFor; saved["assignment_id"] = assignmentId;
        saved["created_at"] = saved.get("created_at", common::nowIso8601()); saved["created_by"] = saved.get("created_by", userId);
        saved["updated_at"] = common::nowIso8601(); saved["updated_by"] = userId;
        if (status == "completed")
        {
            if (existing.get("status", "").asString() == "cancelled") invalid("已取消的课次不能直接结算");
            auto packages = array(org["course_packages"]), ledger = array(org["lesson_ledger"]);
            const auto attendance = array(payload["attendance"]); std::set<std::string> seen;
            for (const auto &entry : attendance)
            {
                const auto studentId = field(entry, "student_id"), attendanceStatus = field(entry, "status", "present");
                if (!selected.contains(studentId) || !seen.insert(studentId).second) invalid("出勤学员重复或不属于本课次");
                if (attendanceStatus != "present" && attendanceStatus != "absent" && attendanceStatus != "leave" && attendanceStatus != "makeup") invalid("出勤状态不正确");
                if (!entry["charge"].isInt() || entry["charge"].asInt() < 0 || entry["charge"].asInt() > 10) invalid("每人扣课次数应为 0～10 的整数");
                const int charge = entry["charge"].asInt(); const auto packageId = field(entry, "course_package_id");
                if (!charge) continue;
                bool foundPackage = false;
                for (auto &package : packages) if (package.get("course_package_id", "").asString() == packageId)
                {
                    foundPackage = true;
                    if (package.get("record_type", "assignment").asString() != "assignment" || package.get("student_id", "").asString() != studentId)
                        invalid("请选择该学员的课时账户，不能从课程模板或他人账户扣课");
                    const auto expiry = package.get("expires_at", "").asString();
                    if (package.get("status", "active").asString() != "active" || (!expiry.empty() && (expiry.size() == 10 ? daysSince(expiry) > 0 : utcTime(expiry) < common::nowIso8601())))
                        invalid("课时账户已停用或到期");
                    const int remaining = package.get("remaining_lessons", 0).asInt();
                    if (remaining < charge) invalid("课时余额不足，请先分配或调整课时");
                    package["remaining_lessons"] = remaining - charge; package["used_lessons"] = package.get("used_lessons", 0).asInt() + charge;
                    package["updated_at"] = common::nowIso8601(); if (remaining == charge) package["status"] = "depleted";
                    Json::Value change(Json::objectValue); change["ledger_id"] = common::generateOpaqueId("ll_");
                    change["student_id"] = studentId; change["course_package_id"] = packageId; change["lesson_id"] = saved["lesson_id"];
                    change["lesson_title"] = title; change["change"] = -charge; change["balance_after"] = remaining - charge;
                    change["created_at"] = common::nowIso8601(); change["created_by"] = userId; ledger.append(change);
                    break;
                }
                if (!foundPackage) invalid("请选择有效的学员课时账户");
            }
            for (const auto &studentId : selected) if (!seen.contains(studentId)) invalid("请确认本课次全部学员的出勤和扣课");
            saved["attendance"] = attendance; saved["completed_at"] = common::nowIso8601();
            org["course_packages"] = packages; org["lesson_ledger"] = ledger;
        }
        bool replaced = false; for (auto &row : records) if (row["lesson_id"] == saved["lesson_id"]) { row = saved; replaced = true; break; }
        if (!replaced) records.append(saved); org["lessons"] = records;
        Json::Value notice(Json::objectValue); notice["id"] = common::generateOpaqueId("course_"); notice["lesson_id"] = saved["lesson_id"];
        notice["title"] = status == "completed" ? "课程已完成" : status == "cancelled" ? "课程已取消" : existing.isNull() ? "新增课程安排" : "课程安排已更新";
        notice["message"] = title + " · " + start; notice["created_at"] = common::nowIso8601(); notice["recipients"] = Json::arrayValue;
        for (const auto &participant : participants(group, saved)) notice["recipients"].append(participant);
        appendBounded(org["course_notifications"], notice);
        Json::Value details(Json::objectValue); details["lesson_id"] = saved["lesson_id"]; details["group_id"] = groupId; details["status"] = status;
        org = appendOrganizationAuditEntry(org, userId, "institution.lesson.saved", status == "completed" ? "完成课次并结算课时" : "保存课次安排", details);
    return saved;
}

Json::Value InstitutionService::myCourses(const std::string &userId) const
{
    Json::Value out(Json::objectValue);
    for (const auto *key : {"groups", "lessons", "course_packages", "ledger", "notifications", "past_assignments"}) out[key] = Json::arrayValue;
    for (const auto &org : organizationRepository_.listOrganizationsForUser(userId))
    {
        const auto orgId = org["organization_id"].asString();
        if (activeInstitutionMembership(organizationRepository_, userId, orgId).isNull()) continue;
        std::set<std::string> groupIds;
        for (const auto &group : array(org["learning_groups"])) if (std::any_of(group["enrollments"].begin(),group["enrollments"].end(),[&](const Json::Value &entry){return entry.get("user_id","").asString()==userId&&entry.get("role","student").asString()=="student";}))
        {
            const auto groupId = group["learning_group_id"].asString(); groupIds.insert(groupId);
            if (!enrolled(group,userId,"student")) for (const auto &assignment:assignmentRepository_.listByLearningGroup(groupId)) {
                const auto submission=assignment["submissions"][userId]; if (!submission.isObject()||submission.get("submitted_at","").asString().empty()) continue;
                Json::Value past; past["assignment_id"]=assignment["assignment_id"]; past["title"]=assignment["title"]; past["group_name"]=group["name"]; past["organization_name"]=org["name"];
                for (const auto *key:{"submitted_at","score","manual_score","teacher_comment","review_status","reviewed_at"}) if (submission.isMember(key)) past[key]=submission[key];
                out["past_assignments"].append(past);
            }
            Json::Value row(Json::objectValue); row["group_id"] = groupId; row["name"] = group["name"];
            row["organization_id"] = orgId; row["organization_name"] = org["name"]; row["teachers"] = Json::arrayValue;
            for (const auto &id : learningGroupStaffIds(group)) row["teachers"].append(buildMemberView(id));
            row["subject"] = group["subject"]; if (enrolled(group,userId,"student")) out["groups"].append(row);
            bool hasLessons = false;
            for (const auto &lesson : array(org["lessons"])) if (lesson.get("group_id", "").asString() == groupId)
            {
                hasLessons = true;
                if (!enrolled(group,userId,"student")&&lesson.get("status","").asString()!="completed") continue;
                if (lesson["student_ids"].isArray() && !stringArrayContains(lesson["student_ids"], userId)) continue;
                auto safe = lesson; safe.removeMember("attendance"); safe.removeMember("corrected_attendance"); safe.removeMember("attendance_corrections"); safe.removeMember("leave_requests"); safe.removeMember("history"); safe.removeMember("student_ids");
                const auto assignmentId = lesson.get("assignment_id", "").asString();
                const auto assignment = assignmentId.empty() ? Json::Value(Json::nullValue) : assignmentRepository_.get(assignmentId);
                if (enrolled(group,userId,"student") && !assignment.isNull() && assignmentTargetsStudent(assignment, userId) && assignment.get("learning_group_id", "").asString() == groupId && assignment.get("organization_id", "").asString() == orgId)
                {
                    safe["homework"]["assignment_id"] = assignment["assignment_id"]; safe["homework"]["title"] = assignment["title"]; safe["homework"]["exam_id"] = assignment["exam_id"];
                }
                for (const auto &request : array(lesson["leave_requests"])) if (request.get("student_id", "").asString() == userId) safe["own_leave_request"] = request;
                for (const auto &entry : array(effectiveLessonAttendance(lesson))) if (entry.get("student_id", "").asString() == userId) safe["own_attendance"] = entry;
                safe["own_attendance_corrections"]=Json::arrayValue;
                for (const auto &correction : array(lesson["attendance_corrections"])) for (const auto &change : array(correction["changes"])) if (change.get("student_id","").asString()==userId) {
                    Json::Value own(Json::objectValue); own["correction_id"]=correction["correction_id"]; own["created_at"]=correction["created_at"]; own["before"]=change["before"]; own["after"]=change["after"]; safe["own_attendance_corrections"].append(own);
                }
                safe["organization_name"] = org["name"]; safe["group_name"] = group["name"]; out["lessons"].append(safe);
            }
            if (!hasLessons && enrolled(group,userId,"student") && !group.get("starts_at", "").asString().empty())
            {
                auto legacy = row; legacy["lesson_id"] = "legacy:" + groupId; legacy["title"] = group["name"];
                legacy["starts_at"] = group["starts_at"]; legacy["ends_at"] = group["ends_at"]; legacy["status"] = group["status"];
                out["lessons"].append(legacy);
            }
        }
        for (const auto &package : array(org["course_packages"]))
            if (package.get("record_type", "assignment").asString() == "assignment" && package.get("student_id", "").asString() == userId)
            { auto safe = package; safe["organization_name"] = org["name"]; out["course_packages"].append(safe); }
        for (const auto &entry : array(org["lesson_ledger"])) if (entry.get("student_id", "").asString() == userId) out["ledger"].append(entry);
        for (const auto &notice : array(org["course_notifications"])) if (stringArrayContains(notice["recipients"], userId))
        {
            auto safe = notice; safe.removeMember("recipients"); safe["organization_id"] = orgId;
            const auto lesson = find(array(org["lessons"]), "lesson_id", notice.get("lesson_id", "").asString());
            safe["group_id"] = lesson.get("group_id", "");
            const auto group = find(array(org["learning_groups"]), "learning_group_id", safe["group_id"].asString());
            safe["staff_recipient"] = enrolled(group, userId, "teacher") || enrolled(group, userId, "assistant");
            out["notifications"].append(safe);
        }
    }
    return out;
}

Json::Value InstitutionService::requestLessonLeave(const std::string &userId, const std::string &orgId, const std::string &lessonId, const std::string &reason)
{
    if (reason.empty() || reason.size() > 500) invalid("请填写请假原因，最多 500 字节");
    if (activeInstitutionMembership(organizationRepository_, userId, orgId).isNull())
        throw common::AppException("FORBIDDEN", "无权访问这个机构课程", drogon::k403Forbidden);
    Json::Value saved;
    organizationRepository_.updateOrganization(orgId, [&](Json::Value &org) {
        auto records = array(org["lessons"]); auto lesson = find(records, "lesson_id", lessonId);
        const auto group = find(array(org["learning_groups"]), "learning_group_id", lesson.get("group_id", "").asString());
        if (lesson.isNull() || !enrolled(group, userId, "student") || (lesson["student_ids"].isArray() && !stringArrayContains(lesson["student_ids"], userId)))
            throw common::AppException("FORBIDDEN", "不能为他人的课次申请请假", drogon::k403Forbidden);
        if (lesson.get("status", "").asString() != "scheduled" || lesson.get("ends_at", "").asString() <= common::nowIso8601())
            invalid("该课次已结束或取消，不能再申请请假");
        auto requests = array(lesson["leave_requests"]); saved["student_id"] = userId; saved["reason"] = reason;
        saved["status"] = "requested"; saved["created_at"] = common::nowIso8601();
        bool replaced = false; for (auto &request : requests) if (request.get("student_id", "").asString() == userId) { request = saved; replaced = true; break; }
        if (!replaced) requests.append(saved); lesson["leave_requests"] = requests;
        for (auto &row : records) if (row["lesson_id"].asString() == lessonId) row = lesson;
        org["lessons"] = records;
        Json::Value notice; notice["id"] = common::generateOpaqueId("leave_"); notice["title"] = "学员申请请假";
        notice["message"] = lesson["title"].asString() + "：" + reason; notice["created_at"] = common::nowIso8601(); notice["lesson_id"] = lessonId; notice["recipients"] = Json::arrayValue;
        for (const auto &staff : learningGroupStaffIds(group)) notice["recipients"].append(staff);
        appendBounded(org["course_notifications"], notice);
    });
    return saved;
}
}
