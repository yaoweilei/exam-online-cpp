#include "InstitutionService.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <set>
#include <sstream>
#include <unordered_map>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
std::vector<std::string> collectStudentIds(const Json::Value &classes)
{
    std::set<std::string> ids;
    for (const auto &c : classes)
    {
        for (const auto &sid : c["student_ids"])
        {
            if (!sid.asString().empty())
            {
                ids.insert(sid.asString());
            }
        }
    }
    return {ids.begin(), ids.end()};
}

std::vector<std::string> splitLines(const std::string &raw)
{
    std::vector<std::string> lines;
    std::istringstream in(raw);
    std::string line;
    while (std::getline(in, line))
    {
        if (!line.empty() && line.back() == '\r')
        {
            line.pop_back();
        }
        if (!line.empty())
        {
            lines.push_back(line);
        }
    }
    return lines;
}
}  // namespace

InstitutionService::InstitutionService(infrastructure::storage::ClassroomRepository &classroomRepository,
                                       infrastructure::storage::AssignmentRepository &assignmentRepository,
                                       infrastructure::storage::AnswerRepository &answerRepository,
                                       infrastructure::storage::UserRepository &userRepository,
                                       infrastructure::storage::ProfileRepository &profileRepository,
                                       infrastructure::storage::OrganizationRepository &organizationRepository,
                                       infrastructure::storage::ExamRepository &examRepository,
                                       std::filesystem::path systemDir)
    : classroomRepository_(classroomRepository),
      assignmentRepository_(assignmentRepository),
      answerRepository_(answerRepository),
      userRepository_(userRepository),
      profileRepository_(profileRepository),
      organizationRepository_(organizationRepository),
      examRepository_(examRepository),
      plansFile_(std::move(systemDir) / "institution_plans.json")
{
}

Json::Value InstitutionService::plans() const
{
    if (!std::filesystem::exists(plansFile_))
    {
        Json::Value fallback(Json::objectValue);
        fallback["currency"] = "CNY";
        fallback["plans"] = Json::Value(Json::arrayValue);
        return fallback;
    }
    return infrastructure::storage::readJsonFile(plansFile_);
}

Json::Value InstitutionService::dashboard(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    if (!canTeach(roles))
    {
        throw common::AppException("FORBIDDEN", "需要教师或机构管理员权限", drogon::k403Forbidden);
    }
    const auto classes = visibleClassrooms(userId, roles, orgId);
    const auto studentIds = collectStudentIds(classes);
    const auto activePlan = activePlanForOrg(orgId);
    const auto features = activePlan.get("features", Json::Value(Json::objectValue));

    Json::Value out(Json::objectValue);
    out["classes"] = classes;
    out["seat_summary"] = buildSeatSummary(orgId, classes);
    out["plan_catalog"] = plans();
    out["active_institution_plan"] = activePlan;
    out["capabilities"] = features;
    out["locked_features"] = Json::Value(Json::arrayValue);
    out["teacher_effectiveness"] = featureEnabledForOrg(orgId, "teacher_effectiveness")
        ? buildTeacherEffectiveness(classes)
        : Json::Value(Json::arrayValue);
    if (!featureEnabledForOrg(orgId, "teacher_effectiveness"))
    {
        out["locked_features"].append("teacher_effectiveness");
    }
    out["audit_log_summary"] = featureEnabledForOrg(orgId, "audit_logs")
        ? buildAuditSummary(orgId)
        : Json::Value(Json::arrayValue);

    Json::Value assignments(Json::arrayValue);
    int assignmentCount = 0;
    int completedAssignments = 0;
    double scoreSum = 0.0;
    int scoreCount = 0;
    Json::Value risks(Json::arrayValue);
    Json::Value ranking(Json::arrayValue);

    for (const auto &c : classes)
    {
        const auto classAssignments = assignmentRepository_.listByClass(c.get("class_id", "").asString());
        for (const auto &assignment : classAssignments)
        {
            ++assignmentCount;
            auto progress = buildAssignmentProgress(c, assignment);
            completedAssignments += progress.get("submitted_count", 0).asInt();
            if (progress.get("average_score", -1.0).asDouble() >= 0)
            {
                scoreSum += progress["average_score"].asDouble();
                ++scoreCount;
            }
            assignments.append(progress);
        }
    }

    for (const auto &studentId : studentIds)
    {
        const auto answers = answerRepository_.listUserAnswers(studentId);
        double studentScore = 0.0;
        int studentScoreCount = 0;
        for (const auto &answer : answers)
        {
            const auto score = readScorePercent(answer);
            if (score >= 0)
            {
                studentScore += score;
                ++studentScoreCount;
            }
        }
        Json::Value rank(Json::objectValue);
        rank["student"] = buildMemberView(studentId);
        rank["average_score"] = studentScoreCount == 0 ? -1.0 : studentScore / studentScoreCount;
        rank["attempt_count"] = static_cast<Json::Int>(answers.size());
        ranking.append(rank);
        if (featureEnabledForOrg(orgId, "renewal_risk"))
        {
            risks.append(renewalRisk(studentId, answers));
        }
    }
    if (!featureEnabledForOrg(orgId, "renewal_risk"))
    {
        out["locked_features"].append("renewal_risk");
    }

    out["assignments"] = assignments;
    out["student_ranking"] = ranking;
    out["renewal_risks"] = risks;
    out["summary"]["class_count"] = static_cast<Json::Int>(classes.size());
    out["summary"]["student_count"] = static_cast<Json::Int>(studentIds.size());
    out["summary"]["assignment_count"] = assignmentCount;
    out["summary"]["submitted_assignment_count"] = completedAssignments;
    out["summary"]["average_assignment_score"] = scoreCount == 0 ? -1.0 : scoreSum / scoreCount;
    return out;
}

Json::Value InstitutionService::classGradebook(const std::string &userId,
                                               const Json::Value &roles,
                                               const std::string &classId) const
{
    const auto classroom = classroomRepository_.get(classId);
    if (classroom.isNull())
    {
        throw common::AppException("NOT_FOUND", "班级不存在", drogon::k404NotFound);
    }
    if (!canManageInstitution(roles) &&
        classroom.get("teacher_user_id", "").asString() != userId &&
        !stringArrayContains(classroom["assistant_ids"], userId) &&
        !stringArrayContains(classroom["advisor_ids"], userId))
    {
        throw common::AppException("FORBIDDEN", "无权查看该班级成绩册", drogon::k403Forbidden);
    }

    Json::Value out(Json::objectValue);
    out["classroom"] = classroom;
    out["assignments"] = Json::arrayValue;
    out["students"] = Json::arrayValue;
    const auto assignments = assignmentRepository_.listByClass(classId);
    for (const auto &assignment : assignments)
    {
        out["assignments"].append(buildAssignmentProgress(classroom, assignment));
    }
    for (const auto &sid : classroom["student_ids"])
    {
        Json::Value row(Json::objectValue);
        const auto studentId = sid.asString();
        row["student"] = buildMemberView(studentId);
        row["answers"] = summarizeStudentAnswers(studentId);
        row["weaknesses"] = buildWeaknessSummary(answerRepository_.listUserAnswers(studentId));
        row["renewal_risk"] = renewalRisk(studentId, answerRepository_.listUserAnswers(studentId));
        out["students"].append(row);
    }
    return out;
}

Json::Value InstitutionService::studentProfile(const std::string &viewerUserId,
                                               const Json::Value &roles,
                                               const std::string &studentId) const
{
    if (!canViewStudent(viewerUserId, roles, studentId))
    {
        throw common::AppException("FORBIDDEN", "无权查看该学员档案", drogon::k403Forbidden);
    }
    const auto answers = answerRepository_.listUserAnswers(studentId);
    Json::Value out(Json::objectValue);
    out["student"] = buildMemberView(studentId);
    out["learning_record"] = summarizeStudentAnswers(studentId);
    out["weaknesses"] = buildWeaknessSummary(answers);
    out["renewal_risk"] = renewalRisk(studentId, answers);
    out["teacher_notes"] = profileRepository_.loadProfile(studentId).get("teacher_notes", Json::Value(Json::arrayValue));
    out["recommended_homework"] = Json::arrayValue;
    for (const auto &weakness : out["weaknesses"])
    {
        Json::Value item(Json::objectValue);
        item["title"] = "针对 " + weakness.get("label", "薄弱项").asString() + " 的专项复习";
        item["reason"] = weakness.get("reason", "近期错误较多").asString();
        out["recommended_homework"].append(item);
    }
    return out;
}

Json::Value InstitutionService::lessonPrep(const std::string &userId,
                                           const Json::Value &roles,
                                           const Json::Value &payload) const
{
    if (!canTeach(roles))
    {
        throw common::AppException("FORBIDDEN", "需要教师或机构管理员权限", drogon::k403Forbidden);
    }
    const auto orgId = payload.get("org_id", "").asString();
    requireInstitutionFeature(orgId, "lesson_prep", "当前机构套餐未开通备课组卷");
    Json::Value out(Json::objectValue);
    out["created_by"] = userId;
    out["mode"] = payload.get("mode", "handout").asString();
    out["hide_answers"] = payload.get("hide_answers", true).asBool();
    out["projection_mode"] = payload.get("projection_mode", false).asBool();
    out["print_layout"] = payload.get("print_layout", "A4").asString();
    out["question_set"] = buildQuestionSet(payload);
    out["export_handouts_enabled"] = featureEnabledForOrg(orgId, "export_handouts");
    out["export_hints"] = Json::arrayValue;
    out["export_hints"].append("可在前端按 hide_answers 生成讲义版或答案版");
    out["export_hints"].append("课堂投屏模式建议只显示题干、选项和计时器");
    if (out["export_handouts_enabled"].asBool())
    {
        out["handout_html"] = buildHandoutHtml(out);
    }
    return out;
}

Json::Value InstitutionService::bulkImportPreview(const std::string & /*userId*/,
                                                  const Json::Value &roles,
                                                  const std::string &orgId,
                                                  const std::string &rawText) const
{
    if (!canManageInstitution(roles))
    {
        throw common::AppException("FORBIDDEN", "需要机构管理员权限", drogon::k403Forbidden);
    }
    requireInstitutionFeature(orgId, "bulk_import", "当前机构套餐未开通批量导入");
    Json::Value out(Json::objectValue);
    out["org_id"] = orgId;
    out["rows"] = Json::arrayValue;
    int valid = 0;
    int invalid = 0;
    for (const auto &line : splitLines(rawText))
    {
        Json::Value row(Json::objectValue);
        row["raw"] = line;
        std::vector<std::string> cells;
        std::stringstream ss(line);
        std::string cell;
        while (std::getline(ss, cell, ','))
        {
            cells.push_back(cell);
        }
        row["name"] = cells.size() > 0 ? cells[0] : "";
        row["email"] = cells.size() > 1 ? cells[1] : "";
        row["phone"] = cells.size() > 2 ? cells[2] : "";
        row["role"] = cells.size() > 3 ? normalizeRoleLabel(cells[3]) : "student";
        row["valid"] = !row["name"].asString().empty() && (!row["email"].asString().empty() || !row["phone"].asString().empty());
        row["action"] = "preview_only";
        row["message"] = row["valid"].asBool() ? "可导入" : "缺少姓名或联系方式";
        valid += row["valid"].asBool() ? 1 : 0;
        invalid += row["valid"].asBool() ? 0 : 1;
        out["rows"].append(row);
    }
    out["summary"]["valid_count"] = valid;
    out["summary"]["invalid_count"] = invalid;
    out["summary"]["total"] = valid + invalid;
    return out;
}

bool InstitutionService::canManageInstitution(const Json::Value &roles) const
{
    return stringArrayContains(roles, "orgAdmin") || stringArrayContains(roles, "systemAdmin") || stringArrayContains(roles, "superAdmin");
}

bool InstitutionService::canTeach(const Json::Value &roles) const
{
    return canManageInstitution(roles) || stringArrayContains(roles, "teacher") || stringArrayContains(roles, "reviewer");
}

bool InstitutionService::canViewStudent(const std::string &viewerUserId,
                                        const Json::Value &roles,
                                        const std::string &studentId) const
{
    if (viewerUserId == studentId || canManageInstitution(roles))
    {
        return true;
    }
    const auto classes = classroomRepository_.listForUser(viewerUserId);
    for (const auto &c : classes)
    {
        if ((c.get("teacher_user_id", "").asString() == viewerUserId ||
             stringArrayContains(c["assistant_ids"], viewerUserId) ||
             stringArrayContains(c["advisor_ids"], viewerUserId)) &&
            stringArrayContains(c["student_ids"], studentId))
        {
            return true;
        }
    }
    return false;
}

Json::Value InstitutionService::activePlanForOrg(const std::string &orgId) const
{
    const auto catalog = plans();
    const auto planList = catalog["plans"];
    std::string planId = "standard";
    if (!orgId.empty())
    {
        const auto org = organizationRepository_.findOrganization(orgId);
        const auto subscription = org.get("subscription", Json::Value(Json::objectValue));
        planId = subscription.get("institution_plan", subscription.get("plan_id", subscription.get("plan", "standard"))).asString();
        if (planId == "free")
        {
            planId = "starter";
        }
        else if (planId == "pro")
        {
            planId = "standard";
        }
        else if (planId == "ultra")
        {
            planId = "professional";
        }
    }
    if (planList.isArray())
    {
        for (const auto &plan : planList)
        {
            if (plan.get("id", "").asString() == planId)
            {
                return plan;
            }
        }
        for (const auto &plan : planList)
        {
            if (plan.get("id", "").asString() == "standard")
            {
                return plan;
            }
        }
        if (!planList.empty())
        {
            return planList[0];
        }
    }
    Json::Value fallback(Json::objectValue);
    fallback["id"] = "standard";
    fallback["name"] = "标准版";
    fallback["features"]["classrooms"] = true;
    fallback["features"]["assignments"] = true;
    fallback["features"]["auto_grading"] = true;
    fallback["features"]["gradebook"] = true;
    fallback["features"]["student_profiles"] = true;
    return fallback;
}

bool InstitutionService::featureEnabledForOrg(const std::string &orgId, const std::string &featureKey) const
{
    const auto plan = activePlanForOrg(orgId);
    return plan["features"].get(featureKey, false).asBool();
}

void InstitutionService::requireInstitutionFeature(const std::string &orgId,
                                                   const std::string &featureKey,
                                                   const std::string &message) const
{
    if (!featureEnabledForOrg(orgId, featureKey))
    {
        throw common::AppException("INSTITUTION_FEATURE_NOT_INCLUDED", message, drogon::k403Forbidden);
    }
}

Json::Value InstitutionService::visibleClassrooms(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    const auto all = canManageInstitution(roles) ? classroomRepository_.list() : classroomRepository_.listForUser(userId);
    if (orgId.empty())
    {
        return all;
    }
    Json::Value out(Json::arrayValue);
    for (const auto &c : all)
    {
        if (c.get("org_id", "").asString() == orgId)
        {
            out.append(c);
        }
    }
    return out;
}

Json::Value InstitutionService::buildMemberView(const std::string &userId) const
{
    const auto user = userRepository_.findUserById(userId);
    const auto profile = profileRepository_.loadProfile(userId);
    Json::Value out(Json::objectValue);
    out["id"] = userId;
    out["username"] = user.get("username", "").asString();
    out["display_name"] = profile.get("display_name", user.get("username", userId)).asString();
    out["member_no"] = user.get("member_no", "").asString();
    out["email"] = user.get("email", "").asString();
    out["phone"] = user.get("phone", "").asString();
    out["roles"] = user.get("roles", Json::Value(Json::arrayValue));
    out["plan"] = profile.get("plan", "free").asString();
    out["plan_status"] = profile.get("plan_status", "active").asString();
    out["plan_expires_at"] = profile.get("plan_expires_at", "").asString();
    return out;
}

Json::Value InstitutionService::buildAssignmentProgress(const Json::Value &classroom, const Json::Value &assignment) const
{
    Json::Value out = assignment;
    const auto examId = assignment.get("exam_id", "").asString();
    int studentCount = 0;
    int submitted = 0;
    double scoreSum = 0.0;
    int scoreCount = 0;
    Json::Value rows(Json::arrayValue);
    for (const auto &sid : classroom["student_ids"])
    {
        const auto studentId = sid.asString();
        if (studentId.empty())
        {
            continue;
        }
        ++studentCount;
        const auto answer = answerRepository_.loadAnswer(studentId, examId);
        Json::Value row(Json::objectValue);
        row["student"] = buildMemberView(studentId);
        row["submitted"] = !answer.empty() && answer.isObject() && answer.isMember("saved_at");
        row["saved_at"] = answerSavedAt(answer);
        row["score"] = readScorePercent(answer);
        if (row["submitted"].asBool())
        {
            ++submitted;
        }
        if (row["score"].asDouble() >= 0)
        {
            scoreSum += row["score"].asDouble();
            ++scoreCount;
        }
        rows.append(row);
    }
    out["student_count"] = studentCount;
    out["submitted_count"] = submitted;
    out["missing_count"] = studentCount - submitted;
    out["completion_rate"] = studentCount == 0 ? 0.0 : static_cast<double>(submitted) / studentCount;
    out["average_score"] = scoreCount == 0 ? -1.0 : scoreSum / scoreCount;
    out["students"] = rows;
    return out;
}

Json::Value InstitutionService::summarizeStudentAnswers(const std::string &studentId) const
{
    const auto answers = answerRepository_.listUserAnswers(studentId);
    Json::Value out(Json::objectValue);
    out["attempt_count"] = static_cast<Json::Int>(answers.size());
    out["items"] = Json::arrayValue;
    double scoreSum = 0.0;
    int scoreCount = 0;
    std::string latest;
    for (const auto &answer : answers)
    {
        Json::Value item(Json::objectValue);
        item["exam_id"] = answer.get("exam_id", "").asString();
        item["saved_at"] = answerSavedAt(answer);
        item["score"] = readScorePercent(answer);
        item["correct"] = readCorrectCount(answer);
        item["total"] = readTotalCount(answer);
        if (item["score"].asDouble() >= 0)
        {
            scoreSum += item["score"].asDouble();
            ++scoreCount;
        }
        if (item["saved_at"].asString() > latest)
        {
            latest = item["saved_at"].asString();
        }
        out["items"].append(item);
    }
    out["average_score"] = scoreCount == 0 ? -1.0 : scoreSum / scoreCount;
    out["latest_activity_at"] = latest;
    return out;
}

Json::Value InstitutionService::buildWeaknessSummary(const std::vector<Json::Value> &answers) const
{
    Json::Value out(Json::arrayValue);
    int lowScore = 0;
    int missingScore = 0;
    int totalWrong = 0;
    for (const auto &answer : answers)
    {
        const auto score = readScorePercent(answer);
        if (score >= 0 && score < 60.0)
        {
            ++lowScore;
        }
        if (score < 0)
        {
            ++missingScore;
        }
        const auto total = readTotalCount(answer);
        const auto correct = readCorrectCount(answer);
        if (total > 0 && correct >= 0)
        {
            totalWrong += std::max(0, total - correct);
        }
    }
    if (lowScore > 0)
    {
        Json::Value item(Json::objectValue);
        item["label"] = "低分试卷";
        item["count"] = lowScore;
        item["reason"] = "近期存在低于 60% 的练习记录";
        out.append(item);
    }
    if (totalWrong > 0)
    {
        Json::Value item(Json::objectValue);
        item["label"] = "错题累计";
        item["count"] = totalWrong;
        item["reason"] = "累计错误题数偏高，建议安排错题复盘";
        out.append(item);
    }
    if (missingScore > 0)
    {
        Json::Value item(Json::objectValue);
        item["label"] = "未形成分数";
        item["count"] = missingScore;
        item["reason"] = "部分记录缺少可计算分数";
        out.append(item);
    }
    return out;
}

Json::Value InstitutionService::renewalRisk(const std::string &studentId, const std::vector<Json::Value> &answers) const
{
    const auto profile = profileRepository_.loadProfile(studentId);
    std::string latest;
    for (const auto &answer : answers)
    {
        latest = std::max(latest, answerSavedAt(answer));
    }
    const auto inactiveDays = latest.empty() ? 999 : daysSince(latest);
    const auto expiresAt = profile.get("plan_expires_at", "").asString();
    Json::Value out(Json::objectValue);
    out["student"] = buildMemberView(studentId);
    out["inactive_days"] = inactiveDays;
    out["plan_expires_at"] = expiresAt;
    out["level"] = "low";
    out["reason"] = "学习活跃正常";
    if (inactiveDays >= 14)
    {
        out["level"] = "high";
        out["reason"] = "超过 14 天没有练习记录";
    }
    else if (inactiveDays >= 7)
    {
        out["level"] = "medium";
        out["reason"] = "超过 7 天没有练习记录";
    }
    if (!expiresAt.empty() && daysSince(expiresAt) >= -7)
    {
        out["level"] = out["level"].asString() == "high" ? "high" : "medium";
        out["reason"] = "套餐临近到期或已到期";
    }
    return out;
}

Json::Value InstitutionService::buildSeatSummary(const std::string &orgId, const Json::Value &classes) const
{
    Json::Value out(Json::objectValue);
    out["org_id"] = orgId;
    out["used_seats"] = static_cast<Json::Int>(collectStudentIds(classes).size());
    out["member_count"] = orgId.empty() ? out["used_seats"].asInt() : organizationRepository_.memberCount(orgId);
    out["purchased_seats"] = 0;
    if (!orgId.empty())
    {
        const auto org = organizationRepository_.findOrganization(orgId);
        const auto sub = org.get("subscription", Json::Value(Json::objectValue));
        out["purchased_seats"] = sub.get("seats", 0).asInt();
        out["plan"] = sub.get("plan", org.get("plan", "free")).asString();
        out["status"] = sub.get("status", org.get("status", "active")).asString();
    }
    out["available_seats"] = out["purchased_seats"].asInt() > 0
        ? std::max(0, out["purchased_seats"].asInt() - out["used_seats"].asInt())
        : 0;
    return out;
}

Json::Value InstitutionService::buildTeacherEffectiveness(const Json::Value &classes) const
{
    std::unordered_map<std::string, Json::Value> byTeacher;
    for (const auto &c : classes)
    {
        const auto teacherId = c.get("teacher_user_id", "").asString();
        if (teacherId.empty())
        {
            continue;
        }
        auto &row = byTeacher[teacherId];
        if (row.isNull())
        {
            row = Json::Value(Json::objectValue);
            row["teacher"] = buildMemberView(teacherId);
            row["class_count"] = 0;
            row["student_count"] = 0;
            row["assignment_count"] = 0;
        }
        row["class_count"] = row["class_count"].asInt() + 1;
        row["student_count"] = row["student_count"].asInt() + static_cast<int>(c["student_ids"].size());
        row["assignment_count"] = row["assignment_count"].asInt() + static_cast<int>(assignmentRepository_.listByClass(c.get("class_id", "").asString()).size());
    }
    Json::Value out(Json::arrayValue);
    for (auto &[_, row] : byTeacher)
    {
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::buildQuestionSet(const Json::Value &payload) const
{
    Json::Value out(Json::arrayValue);
    const auto examId = payload.get("exam_id", "").asString();
    const auto limit = std::max(1, payload.get("limit", 20).asInt());
    if (!examId.empty())
    {
        const auto exam = examRepository_.getExamById(examId);
        const auto sections = exam["exam_info"]["sections"];
        int added = 0;
        for (const auto &section : sections)
        {
            for (const auto &q : section["questions"])
            {
                if (added >= limit)
                {
                    break;
                }
                Json::Value item(Json::objectValue);
                item["exam_id"] = examId;
                item["section"] = section.get("name", section.get("type", "")).asString();
                item["question_id"] = q.get("id", q.get("question_id", "")).asString();
                item["question_number"] = q.get("question_number", q.get("number", "")).asString();
                item["type"] = q.get("type", section.get("type", "")).asString();
                out.append(item);
                ++added;
            }
        }
    }
    return out;
}

Json::Value InstitutionService::buildAuditSummary(const std::string &orgId) const
{
    Json::Value out(Json::arrayValue);
    if (orgId.empty())
    {
        return out;
    }
    const auto org = organizationRepository_.findOrganization(orgId);
    const auto logs = org.get("audit_logs", Json::Value(Json::arrayValue));
    if (!logs.isArray())
    {
        return out;
    }
    int count = 0;
    for (Json::ArrayIndex i = logs.size(); i > 0 && count < 10; --i, ++count)
    {
        out.append(logs[i - 1]);
    }
    return out;
}

std::string InstitutionService::buildHandoutHtml(const Json::Value &lessonPrep)
{
    std::ostringstream html;
    html << "<!doctype html><html><head><meta charset=\"utf-8\"><title>课堂讲义</title>"
         << "<style>body{font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;padding:32px;}li{margin:8px 0;}.meta{color:#666;font-size:13px;}</style>"
         << "</head><body><h1>课堂讲义</h1><div class=\"meta\">模式："
         << lessonPrep.get("mode", "handout").asString()
         << " / 隐藏答案：" << (lessonPrep.get("hide_answers", true).asBool() ? "是" : "否")
         << "</div><ol>";
    for (const auto &q : lessonPrep["question_set"])
    {
        html << "<li>"
             << q.get("exam_id", "").asString()
             << " / " << q.get("section", "").asString()
             << " / " << q.get("question_number", q.get("question_id", "")).asString()
             << "</li>";
    }
    html << "</ol></body></html>";
    return html.str();
}

double InstitutionService::readScorePercent(const Json::Value &answer)
{
    const auto stats = answer["statistics"];
    if (stats.isMember("score_percent"))
    {
        return stats["score_percent"].asDouble();
    }
    if (stats.isMember("accuracy"))
    {
        const auto accuracy = stats["accuracy"].asDouble();
        return accuracy <= 1.0 ? accuracy * 100.0 : accuracy;
    }
    const auto total = readTotalCount(answer);
    const auto correct = readCorrectCount(answer);
    if (total > 0 && correct >= 0)
    {
        return static_cast<double>(correct) * 100.0 / total;
    }
    return -1.0;
}

int InstitutionService::readCorrectCount(const Json::Value &answer)
{
    const auto stats = answer["statistics"];
    if (stats.isMember("correct"))
    {
        return stats["correct"].asInt();
    }
    if (stats.isMember("correct_count"))
    {
        return stats["correct_count"].asInt();
    }
    return -1;
}

int InstitutionService::readTotalCount(const Json::Value &answer)
{
    const auto stats = answer["statistics"];
    if (stats.isMember("total"))
    {
        return stats["total"].asInt();
    }
    if (stats.isMember("total_count"))
    {
        return stats["total_count"].asInt();
    }
    return -1;
}

std::string InstitutionService::answerSavedAt(const Json::Value &answer)
{
    return answer.get("saved_at", answer.get("updated_at", "")).asString();
}

bool InstitutionService::stringArrayContains(const Json::Value &array, const std::string &value)
{
    if (!array.isArray())
    {
        return false;
    }
    for (const auto &item : array)
    {
        if (item.asString() == value)
        {
            return true;
        }
    }
    return false;
}

void InstitutionService::appendUnique(Json::Value &array, const std::string &value)
{
    if (value.empty())
    {
        return;
    }
    if (!array.isArray())
    {
        array = Json::Value(Json::arrayValue);
    }
    if (!stringArrayContains(array, value))
    {
        array.append(value);
    }
}

std::string InstitutionService::normalizeRoleLabel(const std::string &role)
{
    if (role == "teacher" || role == "assistant" || role == "advisor" || role == "parent")
    {
        return role;
    }
    return "student";
}

std::string InstitutionService::todayDate()
{
    return common::nowIso8601().substr(0, 10);
}

int InstitutionService::daysSince(const std::string &isoDate)
{
    if (isoDate.size() < 10)
    {
        return 999;
    }
    try
    {
        const std::chrono::year_month_day then{
            std::chrono::year{std::stoi(isoDate.substr(0, 4))},
            std::chrono::month{static_cast<unsigned>(std::stoi(isoDate.substr(5, 2)))},
            std::chrono::day{static_cast<unsigned>(std::stoi(isoDate.substr(8, 2)))}};
        const std::chrono::year_month_day today{
            std::chrono::year{std::stoi(todayDate().substr(0, 4))},
            std::chrono::month{static_cast<unsigned>(std::stoi(todayDate().substr(5, 2)))},
            std::chrono::day{static_cast<unsigned>(std::stoi(todayDate().substr(8, 2)))}};
        return static_cast<int>((std::chrono::sys_days{today} - std::chrono::sys_days{then}).count());
    }
    catch (...)
    {
        return 999;
    }
}
}  // namespace application::services
