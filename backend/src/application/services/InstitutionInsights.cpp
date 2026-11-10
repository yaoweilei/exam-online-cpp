#include "InstitutionService.h"
#include "InstitutionAccess.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <drogon/HttpTypes.h>

namespace application::services
{
namespace
{
Json::Value rows(const Json::Value &value) { return value.isArray() ? value : Json::Value(Json::arrayValue); }
void invalidInsight(const std::string &message) { throw common::AppException("VALIDATION_ERROR", message, drogon::k422UnprocessableEntity); }
std::string text(const Json::Value &value, const char *key, size_t limit = 120)
{
    if (!value.isMember(key)) return "";
    if (!value[key].isString() || value[key].asString().size() > limit) invalidInsight(std::string(key) + " 格式或长度不正确");
    return value[key].asString();
}
bool has(const Json::Value &values, const std::string &id) { for (const auto &value : rows(values)) if (value.isString() && value.asString() == id) return true; return false; }
std::string dayText(std::chrono::sys_days value)
{
    const std::chrono::year_month_day day(value); std::ostringstream out;
    out << int(day.year()) << '-' << std::setw(2) << std::setfill('0') << unsigned(day.month()) << '-' << std::setw(2) << unsigned(day.day()); return out.str();
}
std::chrono::sys_days parseDay(const std::string &value)
{
    if (!std::regex_match(value, std::regex(R"(^\d{4}-\d{2}-\d{2}$)"))) invalidInsight("日期应为 YYYY-MM-DD");
    const std::chrono::year_month_day date{std::chrono::year{std::stoi(value.substr(0,4))}, std::chrono::month{unsigned(std::stoi(value.substr(5,2)))}, std::chrono::day{unsigned(std::stoi(value.substr(8,2)))}};
    if (!date.ok()) invalidInsight("日期不正确"); return std::chrono::sys_days(date);
}
std::string insightDay(const std::string &value, const std::chrono::time_zone *zone)
{
    if (!zone || value.size() == 10) return value.size() >= 10 ? value.substr(0,10) : "";
    std::tm parts{}; std::istringstream input(value.substr(0,19)); input >> std::get_time(&parts,"%Y-%m-%dT%H:%M:%S");
    if (input.fail()) return "";
    const std::chrono::year_month_day day{std::chrono::year{parts.tm_year+1900},std::chrono::month{unsigned(parts.tm_mon+1)},std::chrono::day{unsigned(parts.tm_mday)}};
    if (!day.ok()) return "";
    auto instant = std::chrono::sys_days(day) + std::chrono::hours(parts.tm_hour) + std::chrono::minutes(parts.tm_min) + std::chrono::seconds(parts.tm_sec);
    // Stored timestamps normally use Z. Honor explicit offsets in legacy ISO records too.
    std::smatch offset;
    if (std::regex_search(value,offset,std::regex(R"(([+-])(\d{2}):(\d{2})$)")))
        instant -= std::chrono::minutes(std::stoi(offset[2])*60+std::stoi(offset[3])) * (offset[1]=="+" ? 1 : -1);
    const auto local = std::chrono::floor<std::chrono::days>(zone->to_local(instant));
    return dayText(std::chrono::sys_days(local.time_since_epoch()));
}
struct Window {
    std::string from, to, midpoint;
    const std::chrono::time_zone *zone = nullptr;
    std::string day(const std::string &value) const { return insightDay(value,zone); }
    bool includes(const std::string &value) const { const auto date=day(value); return !date.empty() && date >= from && date <= to; }
};
Window window(const Json::Value &filters, int days)
{
    const auto timezone = text(filters,"timezone",100);
    const std::chrono::time_zone *zone=nullptr;
    if (!timezone.empty()) { try { zone=std::chrono::locate_zone(timezone); } catch (...) { invalidInsight("时区不正确，请使用有效的 IANA 时区名称"); } }
    const auto now=std::chrono::system_clock::now();
    const auto today = zone ? std::chrono::sys_days(std::chrono::floor<std::chrono::days>(zone->to_local(now)).time_since_epoch()) : std::chrono::floor<std::chrono::days>(now);
    const auto from = text(filters,"from"), to = text(filters,"to");
    const auto first = from.empty() ? today - std::chrono::days(days - 1) : parseDay(from);
    const auto last = to.empty() ? today : parseDay(to);
    if (first > last || (last - first).count() > 1095) invalidInsight("请选择不超过三年的有效时间范围");
    return {dayText(first), dayText(last), dayText(first + (last - first + std::chrono::days(1)) / 2),zone};
}
std::string targetOf(const std::string &id, const Json::Value &exam)
{
    std::smatch match;
    if (std::regex_search(id, match, std::regex(R"((?:^|[-_])N([1-5])(?:[-_]|$))", std::regex::icase))) return "JLPT-N" + match[1].str();
    const auto info = exam["exam_info"];
    if (info.get("family", "").asString() == "eju" || id.rfind("EJU", 0) == 0)
        return "EJU-" + info.get("subject", "japanese").asString();
    const auto level = info.get("exam_level", "").asString();
    if (std::regex_match(level, std::regex("N[1-5]"))) return "JLPT-" + level;
    return "其他考试";
}
struct Count { int correct = 0, total = 0, attempts = 0; };
Json::Value countView(const Count &count)
{
    Json::Value out(Json::objectValue); out["correct"] = count.correct; out["questions"] = count.total; out["attempts"] = count.attempts;
    out["accuracy"] = count.total ? Json::Value(100.0 * count.correct / count.total) : Json::Value(Json::nullValue); return out;
}
}

Json::Value InstitutionService::learningProgress(const std::string &viewerId, const Json::Value &roles,
    const std::string &studentId, const std::string &orgId, const Json::Value &filters) const
{
    if (viewerId != studentId && (orgId.empty() || !canFollowStudent(viewerId, roles, orgId, studentId)))
        throw common::AppException("FORBIDDEN", "无权查看该学员的学习进步", drogon::k403Forbidden);
    const auto period = window(filters,90); auto target = text(filters,"target"), skill = text(filters,"skill");
    const auto history = answerRepository_.learningHistory(studentId);
    struct Sample { std::string day, target, skill, attempt; int correct, total; };
    std::vector<Sample> samples; std::set<std::string> targets, skills; std::map<std::string,Json::Value> exams;
    for (const auto &answer : history)
    {
        const auto id = answer.get("exam_id", "").asString(), date = answerSavedAt(answer);
        if (!period.includes(date)) continue;
        if (!exams.contains(id)) { try { exams[id] = examRepository_.getExamById(id); } catch (...) { exams[id] = Json::nullValue; } }
        const auto examTarget = targetOf(id,exams[id]); targets.insert(examTarget);
        std::map<std::string, Count> grouped;
        const auto results = answer["statistics"]["results"];
        for (const auto &key : results.getMemberNames())
        {
            const auto row = results[key]; const auto status = row.get("status", "").asString();
            if (status != "correct" && status != "wrong") continue;
            auto label = classifyAnswerRow(answer,row,key); if (label.empty()) label = "其他题型";
            ++grouped[label].total; if (status == "correct") ++grouped[label].correct;
        }
        const auto attempt = id + "|" + date + "|" + answer.get("submission_id", "").asString() + "|" + answer.get("attempt_id", "").asString();
        for (const auto &[label,count] : grouped) { skills.insert(label); samples.push_back({period.day(date),examTarget,label,attempt,count.correct,count.total}); }
    }
    if (target.empty() && !targets.empty()) target = *targets.begin();
    Count before,after,total; std::map<std::string,Count> daily;
    std::set<std::string> beforeAttempts,afterAttempts,totalAttempts;
    std::map<std::string,std::set<std::string>> dailyAttempts;
    for (const auto &sample : samples) if (sample.target == target && (skill.empty() || skill == sample.skill))
    {
        auto &part = sample.day < period.midpoint ? before : after;
        part.correct += sample.correct; part.total += sample.total;
        (sample.day < period.midpoint ? beforeAttempts : afterAttempts).insert(sample.attempt);
        auto &day = daily[sample.day]; day.correct += sample.correct; day.total += sample.total; dailyAttempts[sample.day].insert(sample.attempt);
        total.correct += sample.correct; total.total += sample.total; totalAttempts.insert(sample.attempt);
    }
    before.attempts = int(beforeAttempts.size()); after.attempts = int(afterAttempts.size()); total.attempts = int(totalAttempts.size());
    for (auto &[date,count] : daily) count.attempts = int(dailyAttempts[date].size());
    Json::Value out(Json::objectValue); out["from"] = period.from; out["to"] = period.to; out["midpoint"] = period.midpoint;
    out["timezone"] = period.zone ? std::string(period.zone->name()) : "UTC";
    out["target"] = target; out["skill"] = skill; out["targets"] = Json::arrayValue; out["skills"] = Json::arrayValue; out["daily"] = Json::arrayValue;
    for (const auto &value : targets) out["targets"].append(value); for (const auto &value : skills) out["skills"].append(value);
    for (const auto &[date,count] : daily) { auto row = countView(count); row["date"] = date; out["daily"].append(row); }
    out["before"] = countView(before); out["after"] = countView(after); out["total"] = countView(total);
    out["change_points"] = before.total && after.total ? Json::Value(100.0 * after.correct / after.total - 100.0 * before.correct / before.total) : Json::Value(Json::nullValue);
    out["sufficient"] = before.total >= 20 && after.total >= 20;
    out["note"] = "仅比较所选考试目标和题型的独立作答正确率；按时间中点分为前后两段。样本少于每段 20 题时仅作初步参考，试卷难度差异仍会影响结果。";
    return out;
}

Json::Value InstitutionService::operationalDashboard(const std::string &userId, const Json::Value &roles,
    const std::string &orgId, const Json::Value &filters) const
{
    if (orgId.empty() || !canAccessTeaching(userId, roles, orgId)) throw common::AppException("FORBIDDEN", "无权查看该机构教学看板", drogon::k403Forbidden);
    const auto period = window(filters,7); const auto now = common::nowIso8601();
    const auto org = organizationRepository_.findOrganization(orgId), groups = visibleLearningGroups(userId,roles,orgId);
    Json::Value out(Json::objectValue); out["from"] = period.from; out["to"] = period.to; out["timezone"] = period.zone ? std::string(period.zone->name()) : "UTC"; out["lessons"] = Json::arrayValue; out["followups"] = Json::arrayValue;
    int scheduled=0,completed=0,cancelled=0,overdue=0,present=0,attended=0,leave=0,absent=0,requests=0;
    for (const auto &group : groups)
    {
        const auto groupId = group["learning_group_id"].asString(); bool independent = false;
        Json::Value items(Json::arrayValue);
        for (const auto &lesson : rows(org["lessons"])) if (lesson.get("group_id", "").asString() == groupId) { independent = true; items.append(lesson); }
        if (!independent && !group.get("starts_at", "").asString().empty()) { auto item = group; item["title"] = group["name"]; item["legacy"] = true; items.append(item); }
        for (const auto &lesson : items)
        {
            if (!period.includes(lesson.get("starts_at", "").asString())) continue;
            const auto status = lesson.get("status", "scheduled").asString();
            Json::Value row(Json::objectValue); row["lesson_id"] = lesson.get("lesson_id", ""); row["group_id"] = groupId; row["group_name"] = group["name"];
            row["title"] = lesson.get("title",group["name"]); row["starts_at"] = lesson["starts_at"]; row["ends_at"] = lesson["ends_at"]; row["status"] = status;
            row["overdue"] = status != "completed" && status != "cancelled" && status != "archived" && !lesson.get("ends_at", "").asString().empty() && lesson["ends_at"].asString() < now;
            int rowPresent=0,rowLeave=0,rowAbsent=0;
            if (status == "cancelled") ++cancelled; else { ++scheduled; if (status == "completed") ++completed; }
            if (row["overdue"].asBool()) ++overdue;
            for (const auto &entry : rows(effectiveLessonAttendance(lesson))) { ++attended; const auto state = entry.get("status", "").asString(); if (state=="present") { ++present; ++rowPresent; } else if (state=="leave") { ++leave; ++rowLeave; } else { ++absent; ++rowAbsent; } }
            row["present"] = rowPresent; row["leave"] = rowLeave; row["absent"] = rowAbsent;
            row["leave_requests"] = status == "completed" || status == "cancelled" ? 0 : int(rows(lesson["leave_requests"]).size());
            requests += row["leave_requests"].asInt(); out["lessons"].append(row);
        }
    }
    std::set<std::string> students; for (const auto &group : groups) for (const auto &id : learningGroupStudentIds(group)) students.insert(id);
    const bool manager = canManageInstitution(institutionRolesForOrganization(organizationRepository_,userId,roles,orgId));
    for (const auto &item : rows(org["followups"])) if ((manager || students.contains(item.get("student_id", "").asString())) && item.get("status", "pending").asString() != "completed" && !item.get("next_at", "").asString().empty() && period.day(item["next_at"].asString()) <= period.to)
    { Json::Value row(Json::objectValue); row["student"] = buildMemberView(item["student_id"].asString()); row["owner"] = buildMemberView(item.get("owner_id", "").asString()); row["next_at"] = item["next_at"]; row["status"] = item["status"]; out["followups"].append(row); }
    out["summary"]["scheduled"] = scheduled; out["summary"]["completed"] = completed; out["summary"]["cancelled"] = cancelled; out["summary"]["overdue"] = overdue;
    out["summary"]["present"] = present; out["summary"]["attendance_samples"] = attended; out["summary"]["leave"] = leave; out["summary"]["absent"] = absent; out["summary"]["pending_leave"] = requests;
    out["summary"]["completion_rate"] = scheduled ? Json::Value(100.0*completed/scheduled) : Json::Value(Json::nullValue);
    out["summary"]["attendance_rate"] = attended ? Json::Value(100.0*present/attended) : Json::Value(Json::nullValue);
    out["note"] = "按授课开始日期统计，出勤率仅使用已记录考勤。未结算课次不推断出勤；待跟进包含所选结束日期前到期的未完成安排。";
    return out;
}

Json::Value InstitutionService::setupContext(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    if (orgId.empty() || !canManageInstitution(institutionRolesForOrganization(organizationRepository_,userId,roles,orgId)))
        throw common::AppException("FORBIDDEN", "需要该机构管理员权限", drogon::k403Forbidden);
    const auto org = organizationRepository_.findOrganization(orgId);
    Json::Value out(Json::objectValue); out["students"] = Json::arrayValue; out["teachers"] = Json::arrayValue; out["groups"] = rows(org["learning_groups"]); out["templates"] = Json::arrayValue;
    out["organization_name"] = org["name"]; out["last_setup_group_id"] = org.get("last_setup_group_id", "");
    for (const auto &member : organizationRepository_.listMembershipsForScope(orgId)) if (member.get("status", "active").asString() == "active")
    {
        if (institutionHasRole(member["roles"],"student")) out["students"].append(buildMemberView(member["user_id"].asString()));
        if (institutionHasRole(member["roles"],"teacher") || institutionHasRole(member["roles"],"orgAdmin")) out["teachers"].append(buildMemberView(member["user_id"].asString()));
    }
    for (auto package : rows(org["course_packages"])) if (package.get("record_type", "assignment").asString() == "template")
    { package["eligible"] = package.get("status", "active").asString() == "active" && package.get("total_lessons",0).asInt()>0 && (package.get("expires_at", "").asString().empty() || package["expires_at"].asString()>common::nowIso8601()); out["templates"].append(package); }
    return out;
}

Json::Value InstitutionService::setupCohort(const std::string &userId, const Json::Value &roles, const std::string &orgId, const Json::Value &payload)
{
    const auto context = setupContext(userId,roles,orgId);
    const auto title = text(payload,"name"), subject = text(payload,"subject"), templateId = text(payload,"template_id"), requestId = text(payload,"request_id");
    if (title.empty() || requestId.empty()) invalidInsight("请填写班级名称并提供提交标识");
    if (!payload["student_ids"].isArray() || payload["student_ids"].empty() || payload["student_ids"].size()>200 || !payload["teacher_ids"].isArray() || payload["teacher_ids"].empty() || payload["teacher_ids"].size()>20) invalidInsight("请至少选择一位学员和一位老师");
    std::set<std::string> selected;
    for (const auto *kind : {"student","teacher"}) for (const auto &id : payload[std::string(kind)+"_ids"])
    {
        bool valid=false; for (const auto &member : context[std::string(kind)+"s"]) if (id.isString() && member["id"] == id) valid=true;
        if (!valid || !selected.insert(id.asString()).second) invalidInsight("所选成员重复、角色不符或不属于当前机构");
    }
    Json::Value saved;
    organizationRepository_.updateOrganization(orgId,[&](Json::Value &org) {
        for (const auto &group : rows(org["learning_groups"])) if (group.get("setup_request_id", "").asString()==requestId) { saved=group; return; }
        Json::Value source(Json::nullValue); for (const auto &package : rows(org["course_packages"])) if (package.get("course_package_id", "").asString()==templateId) source=package;
        if (!templateId.empty() && (source.isNull() || source.get("record_type", "assignment").asString()!="template" || source.get("status", "active").asString()!="active" || source.get("total_lessons",0).asInt()<=0 || (!source.get("expires_at", "").asString().empty() && source["expires_at"].asString()<=common::nowIso8601()))) invalidInsight("请选择有效的课程模板");
        const auto id=common::generateOpaqueId("lg_"), now=common::nowIso8601(); saved=Json::objectValue;
        saved["learning_group_id"]=id; saved["group_id"]=id; saved["id"]=id; saved["organization_id"]=orgId; saved["name"]=title; saved["subject"]=subject;
        saved["type"]="class"; saved["status"]="active"; saved["created_by"]=userId; saved["created_at"]=now; saved["updated_at"]=now; saved["setup_request_id"]=requestId; saved["enrollments"]=Json::arrayValue;
        for (const auto *kind : {"student","teacher"}) for (const auto &memberId : payload[std::string(kind)+"_ids"])
        { Json::Value entry(Json::objectValue); entry["enrollment_id"]=common::generateOpaqueId("enr_"); entry["user_id"]=memberId; entry["role"]=kind; entry["status"]="active"; entry["organization_id"]=orgId; entry["learning_group_id"]=id; entry["created_at"]=now; saved["enrollments"].append(entry); }
        auto packages=rows(org["course_packages"]);
        if (!templateId.empty()) for (const auto &studentId : payload["student_ids"])
        {
            bool exists=false; for (const auto &package : packages) if (package.get("record_type", "assignment").asString()=="assignment" && package["student_id"]==studentId && package.get("template_id", "").asString()==templateId && package.get("status", "active").asString()=="active" && package.get("remaining_lessons",package.get("total_lessons",0).asInt()-package.get("used_lessons",0).asInt()).asInt()>0 && (package.get("expires_at", "").asString().empty() || package["expires_at"].asString()>now)) exists=true;
            if (exists) continue;
            auto account=source; const auto accountId=common::generateOpaqueId("acct_"); account["id"]=accountId; account["course_package_id"]=accountId; account["template_id"]=templateId; account["record_type"]="assignment"; account["student_id"]=studentId; account["organization_id"]=orgId;
            account["used_lessons"]=0; account["remaining_lessons"]=source["total_lessons"]; account["created_at"]=now; account["updated_at"]=now; account["created_by"]=userId; packages.append(account);
        }
        org["learning_groups"]=rows(org["learning_groups"]); org["learning_groups"].append(saved); org["course_packages"]=packages; org["last_setup_group_id"]=id;
        Json::Value details(Json::objectValue); details["group_id"]=id; details["students"]=payload["student_ids"].size(); details["teachers"]=payload["teacher_ids"].size();
        org=appendOrganizationAuditEntry(org,userId,"institution.setup.cohort","创建班级并关联授课与课时",details);
    });
    return saved;
}

Json::Value InstitutionService::reviewComments(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    if (orgId.empty() || !canAccessTeaching(userId,roles,orgId)) throw common::AppException("FORBIDDEN", "无权访问机构评语",drogon::k403Forbidden);
    Json::Value out(Json::objectValue); out["items"]=Json::arrayValue;
    for (const auto &row : rows(organizationRepository_.findOrganization(orgId)["review_comments"])) if (row.get("created_by", "").asString()==userId) out["items"].append(row);
    return out;
}
Json::Value InstitutionService::saveReviewComment(const std::string &userId,const Json::Value &roles,const std::string &orgId,const Json::Value &payload)
{
    reviewComments(userId,roles,orgId); const auto comment=text(payload,"text",1200), requested=text(payload,"comment_id"); const bool remove=payload.get("remove",false).asBool();
    if (!remove && comment.empty()) invalidInsight("请填写常用评语"); Json::Value saved;
    organizationRepository_.updateOrganization(orgId,[&](Json::Value &org) {
        auto items=rows(org["review_comments"]); Json::Value next(Json::arrayValue); bool found=false; int own=0;
        for (auto row : items) { if (row.get("created_by", "").asString()==userId) ++own; if (row.get("comment_id", "").asString()==requested && !requested.empty()) { if (row.get("created_by", "").asString()!=userId) throw common::AppException("FORBIDDEN","只能修改自己的常用评语",drogon::k403Forbidden); found=true; if (!remove) { row["text"]=comment; saved=row; next.append(row); } } else next.append(row); }
        if (!requested.empty() && !found) invalidInsight("常用评语不存在");
        if (requested.empty() && !remove) { if (own>=50) invalidInsight("每人最多保存 50 条常用评语"); saved["comment_id"]=common::generateOpaqueId("comment_"); saved["text"]=comment; saved["created_by"]=userId; saved["created_at"]=common::nowIso8601(); next.append(saved); }
        org["review_comments"]=next;
    }); return saved;
}

Json::Value InstitutionService::weaknessQuestions(const std::string &userId,const Json::Value &roles,const std::string &studentId,const std::string &orgId,const Json::Value &filters) const
{
    if (orgId.empty() || !canFollowStudent(userId,roles,orgId,studentId)) throw common::AppException("FORBIDDEN","无权为该学员选择作业",drogon::k403Forbidden);
    const auto skill=text(filters,"skill"), target=text(filters,"target"); Json::Value out(Json::objectValue); out["items"]=Json::arrayValue; out["groups"]=Json::arrayValue; out["student"]=buildMemberView(studentId);
    for (const auto &group : visibleLearningGroups(userId,roles,orgId)) if (learningGroupHasUserRole(group,studentId,{"student"})) { Json::Value row(Json::objectValue); row["group_id"]=group["learning_group_id"]; row["name"]=group["name"]; out["groups"].append(row); }
    int limit=200;
    for (const auto &answer : answerRepository_.listUserAnswers(studentId))
    {
        const auto examId=answer.get("exam_id", "").asString(); Json::Value exam; try { exam=examRepository_.getExamById(examId); } catch (...) { continue; }
        const auto examTarget=targetOf(examId,exam); if (!target.empty() && examTarget!=target) continue;
        const auto results=answer["statistics"]["results"];
        for (const auto &key : results.getMemberNames()) if (results[key].get("status", "").asString()=="wrong" && limit>0)
        {
            const auto label=classifyAnswerRow(answer,results[key],key); if (!skill.empty() && skill!=label) continue;
            try {
                Json::Value payload(Json::objectValue); payload["exam_id"]=examId; payload["question_ids"]=Json::arrayValue; payload["question_ids"].append(key); payload["limit"]=1;
                const auto questions=buildQuestionSet(payload); if (questions.empty()) continue;
                Json::Value row(Json::objectValue); row["exam_id"]=examId; row["exam_title"]=examDisplayName(examId); row["target"]=examTarget; row["skill"]=label;
                row["question_id"]=questions[0]["question_id"]; row["question"]=questions[0]["question"]; out["items"].append(row); --limit;
            } catch (...) {}
        }
    }
    out["limited"]=limit==0; return out;
}
}
