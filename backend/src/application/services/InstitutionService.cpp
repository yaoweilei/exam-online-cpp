#include "InstitutionService.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <sstream>
#include <unordered_map>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
std::vector<std::string> collectStudentIds(const Json::Value &learningGroups)
{
    std::set<std::string> ids;
    for (const auto &group : learningGroups)
    {
        for (const auto &enrollment : group.get("enrollments", Json::Value(Json::arrayValue)))
        {
            if (enrollment.get("role", "student").asString() != "student" ||
                enrollment.get("status", "active").asString() != "active")
            {
                continue;
            }
            const auto studentId = enrollment.get("user_id", "").asString();
            if (!studentId.empty())
            {
                ids.insert(studentId);
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

InstitutionService::InstitutionService(infrastructure::storage::AssignmentRepository &assignmentRepository,
                                       infrastructure::storage::AnswerRepository &answerRepository,
                                       infrastructure::storage::UserRepository &userRepository,
                                       infrastructure::storage::ProfileRepository &profileRepository,
                                       infrastructure::storage::OrganizationRepository &organizationRepository,
                                       infrastructure::storage::ExamRepository &examRepository,
                                       std::filesystem::path systemDir)
    : assignmentRepository_(assignmentRepository),
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
        fallback["version"] = 2;
        fallback["pricing_source"] = "payments.pricing.v2";
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
    const auto learningGroups = visibleLearningGroups(userId, roles, orgId);
    const auto studentIds = collectStudentIds(learningGroups);
    const auto activePlan = activePlanForOrg(orgId);
    auto features = activePlan.get("features", Json::Value(Json::objectValue));

    Json::Value out(Json::objectValue);
    out["learning_groups"] = learningGroups;
    out["seat_summary"] = buildSeatSummary(orgId, learningGroups);
    out["plan_catalog"] = plans();
    out["active_institution_plan"] = activePlan;
    out["capabilities"] = features;
    out["locked_features"] = Json::Value(Json::arrayValue);
    out["teacher_effectiveness"] = featureEnabledForOrg(orgId, "teacher_effectiveness")
        ? buildTeacherEffectiveness(learningGroups)
        : Json::Value(Json::arrayValue);
    out["class_average_trend"] = buildClassAverageTrend(learningGroups);
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
    struct SkillCounter { int total{0}; int wrong{0}; };
    std::map<std::string, SkillCounter> skillAggregate;

    for (const auto &group : learningGroups)
    {
        const auto groupAssignments = assignmentRepository_.listByLearningGroup(group.get("learning_group_id", group.get("group_id", "")).asString());
        for (const auto &assignment : groupAssignments)
        {
            ++assignmentCount;
            auto progress = buildAssignmentProgress(group, assignment);
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
            const auto results = answer["statistics"]["results"];
            for (const auto &key : results.getMemberNames())
            {
                const auto row = results[key];
                auto &counter = skillAggregate[classifyAnswerRow(answer, row, key)];
                ++counter.total;
                if (row.get("status", "").asString() == "wrong") ++counter.wrong;
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
    Json::Value skillWeaknesses(Json::arrayValue);
    for (const auto &[skill, counter] : skillAggregate)
    {
        Json::Value row(Json::objectValue); row["skill"] = skill; row["total_questions"] = counter.total;
        row["wrong_count"] = counter.wrong;
        row["error_rate"] = counter.total > 0 ? std::round(static_cast<double>(counter.wrong) * 10000.0 / counter.total) / 100.0 : 0.0;
        skillWeaknesses.append(row);
    }
    out["skill_weaknesses"] = skillWeaknesses;
    if (!featureEnabledForOrg(orgId, "renewal_risk"))
    {
        out["locked_features"].append("renewal_risk");
    }

    out["assignments"] = assignments;
    out["student_ranking"] = ranking;
    out["renewal_risks"] = risks;
    out["summary"]["learning_group_count"] = static_cast<Json::Int>(learningGroups.size());
    out["summary"]["student_count"] = static_cast<Json::Int>(studentIds.size());
    out["summary"]["assignment_count"] = assignmentCount;
    out["summary"]["submitted_assignment_count"] = completedAssignments;
    out["summary"]["average_assignment_score"] = scoreCount == 0 ? -1.0 : scoreSum / scoreCount;
    return out;
}

Json::Value InstitutionService::teachingWorkbench(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    if (!canTeach(roles))
    {
        throw common::AppException("FORBIDDEN", "需要教师、助教或机构管理员权限", drogon::k403Forbidden);
    }

    const auto learningGroups = visibleLearningGroups(userId, roles, orgId);
    const auto organizations = visibleOrganizations(userId, roles, orgId);
    const auto coursePackages = buildCoursePackageSummary(organizations, learningGroups, userId, roles);

    Json::Value out(Json::objectValue);
    out["organizations"] = organizations;
    out["learning_groups"] = learningGroups;
    out["schedule"] = buildScheduleSummary(learningGroups, userId, roles);
    out["course_packages"] = coursePackages;
    out["student_relationships"] = buildStudentRelationshipSummary(learningGroups, coursePackages);
    out["lesson_prep_plans"] = visibleLessonPrepPlans(userId, roles, organizations);
    return out;
}

Json::Value InstitutionService::learningGroupGradebook(const std::string &userId,
                                                       const Json::Value &roles,
                                                       const std::string &organizationId,
                                                       const std::string &learningGroupId) const
{
    const auto groups = visibleLearningGroups(userId, roles, organizationId);
    Json::Value learningGroup(Json::nullValue);
    for (const auto &group : groups)
    {
        if (group.get("learning_group_id", group.get("group_id", "")).asString() == learningGroupId)
        {
            learningGroup = group;
            break;
        }
    }
    if (learningGroup.isNull())
    {
        throw common::AppException("NOT_FOUND", "学习组不存在或无权查看", drogon::k404NotFound);
    }
    if (!canManageInstitution(roles) &&
        !learningGroupHasUserRole(learningGroup, userId, {"teacher", "assistant"}))
    {
        throw common::AppException("FORBIDDEN", "无权查看该学习组成绩册", drogon::k403Forbidden);
    }

    Json::Value out(Json::objectValue);
    out["learning_group"] = learningGroup;
    out["assignments"] = Json::arrayValue;
    out["students"] = Json::arrayValue;
    const auto assignments = assignmentRepository_.listByLearningGroup(learningGroupId);
    for (const auto &assignment : assignments)
    {
        out["assignments"].append(buildAssignmentProgress(learningGroup, assignment));
    }
    for (const auto &studentId : learningGroupStudentIds(learningGroup))
    {
        Json::Value row(Json::objectValue);
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
    out["wrong_trend"] = buildStudentWrongTrend(answers);
    out["writing_history"] = buildWritingHistory(answers);
    out["listening_weaknesses"] = buildListeningWeaknesses(answers);
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
    return buildLessonPrepView(userId, payload);
}

Json::Value InstitutionService::listLessonPrepPlans(const std::string &userId,
                                                    const Json::Value &roles,
                                                    const std::string &orgId) const
{
    if (!canTeach(roles))
    {
        throw common::AppException("FORBIDDEN", "需要教师、助教或机构管理员权限", drogon::k403Forbidden);
    }
    return visibleLessonPrepPlans(userId, roles, visibleOrganizations(userId, roles, orgId));
}

Json::Value InstitutionService::saveLessonPrepPlan(const std::string &userId,
                                                   const Json::Value &roles,
                                                   const Json::Value &payload)
{
    if (!canTeach(roles))
    {
        throw common::AppException("FORBIDDEN", "需要教师、助教或机构管理员权限", drogon::k403Forbidden);
    }
    const auto orgId = payload.get("org_id", "").asString();
    if (orgId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "org_id 不能为空", drogon::k422UnprocessableEntity);
    }
    requireInstitutionFeature(orgId, "lesson_prep", "当前机构套餐未开通备课方案保存");

    bool visible = false;
    for (const auto &organization : visibleOrganizations(userId, roles, orgId))
    {
        if (organization.get("organization_id", organization.get("scope_id", "")).asString() == orgId)
        {
            visible = true;
            break;
        }
    }
    if (!visible)
    {
        throw common::AppException("FORBIDDEN", "无权在该机构保存备课方案", drogon::k403Forbidden);
    }

    auto organization = organizationRepository_.findOrganization(orgId);
    if (organization.isNull())
    {
        throw common::AppException("NOT_FOUND", "机构不存在", drogon::k404NotFound);
    }
    auto plan = buildLessonPrepView(userId, payload);
    const auto planId = payload.get("lesson_prep_id", payload.get("id", "")).asString().empty()
                            ? common::generateOpaqueId("prep_")
                            : payload.get("lesson_prep_id", payload.get("id", "")).asString();
    const auto now = common::nowIso8601();
    plan["lesson_prep_id"] = planId;
    plan["id"] = planId;
    plan["org_id"] = orgId;
    plan["organization_id"] = orgId;
    plan["title"] = payload.get("title", payload.get("name", "课堂备课方案")).asString();
    plan["focus_keyword"] = payload.get("focus_keyword", payload.get("focus_type", "")).asString();
    plan["learning_group_id"] = payload.get("learning_group_id", "").asString();
    plan["updated_at"] = now;
    plan["created_at"] = payload.get("created_at", now).asString();

    organization = upsertLessonPrepPlan(organization, plan);
    organization = appendOrganizationAuditEntry(
        organization,
        userId,
        "lesson_prep.saved",
        "保存备课方案",
        [&] {
            Json::Value details(Json::objectValue);
            details["lesson_prep_id"] = planId;
            details["title"] = plan.get("title", "").asString();
            details["exam_id"] = plan.get("exam_id", "").asString();
            details["question_count"] = static_cast<Json::Int>(plan["question_set"].size());
            return details;
        }());
    organizationRepository_.upsertOrganization(organization);
    return plan;
}

Json::Value InstitutionService::buildLessonPrepView(const std::string &userId, const Json::Value &payload) const
{
    Json::Value out(Json::objectValue);
    const auto orgId = payload.get("org_id", "").asString();
    out["created_by"] = userId;
    out["exam_id"] = payload.get("exam_id", "").asString();
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
    return stringArrayContains(roles, "orgAdmin") || stringArrayContains(roles, "superAdmin");
}

bool InstitutionService::canTeach(const Json::Value &roles) const
{
    return canManageInstitution(roles) || stringArrayContains(roles, "teacher") || stringArrayContains(roles, "assistant");
}

bool InstitutionService::canViewStudent(const std::string &viewerUserId,
                                        const Json::Value &roles,
                                        const std::string &studentId) const
{
    if (viewerUserId == studentId || canManageInstitution(roles))
    {
        return true;
    }
    const auto groups = visibleLearningGroups(viewerUserId, roles, "");
    for (const auto &group : groups)
    {
        if (learningGroupHasUserRole(group, viewerUserId, {"teacher", "assistant"}) &&
            learningGroupHasUserRole(group, studentId, {"student"}))
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
    std::string planId = "pro";
    if (!orgId.empty())
    {
        const auto org = organizationRepository_.findOrganization(orgId);
        const auto subscription = org.get("subscription", Json::Value(Json::objectValue));
        planId = subscription.get("institution_plan", subscription.get("plan_id", subscription.get("plan", "pro"))).asString();
        if (planId == "starter")
        {
            planId = "free";
        }
        else if (planId == "small_class" || planId == "standard")
        {
            planId = "pro";
        }
        else if (planId == "professional" || planId == "campus")
        {
            planId = "ultra";
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
            if (plan.get("id", "").asString() == "pro")
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
    fallback["id"] = "pro";
    fallback["name"] = "机构 PRO";
    fallback["features"]["learning_groups"] = true;
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

Json::Value InstitutionService::visibleLearningGroups(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    const auto organizations = stringArrayContains(roles, "superAdmin")
                                   ? organizationRepository_.allOrganizationsArray()
                                   : organizationRepository_.listOrganizationsForUser(userId);
    Json::Value out(Json::arrayValue);
    for (const auto &organization : organizations)
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        if (!orgId.empty() && organizationId != orgId)
        {
            continue;
        }
        for (auto group : organization.get("learning_groups", Json::Value(Json::arrayValue)))
        {
            if (!canManageInstitution(roles) && !learningGroupHasUserRole(group, userId, {"student", "teacher", "assistant"}))
            {
                continue;
            }
            const auto groupId = group.get("learning_group_id", group.get("group_id", group.get("id", ""))).asString();
            group["organization_id"] = organizationId;
            group["org_id"] = organizationId;
            out.append(group);
        }
    }
    return out;
}

Json::Value InstitutionService::visibleOrganizations(const std::string &userId, const Json::Value &roles, const std::string &orgId) const
{
    const auto organizations = stringArrayContains(roles, "superAdmin")
                                   ? organizationRepository_.allOrganizationsArray()
                                   : organizationRepository_.listOrganizationsForUser(userId);
    Json::Value out(Json::arrayValue);
    for (const auto &organization : organizations)
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        if (!orgId.empty() && organizationId != orgId)
        {
            continue;
        }
        out.append(organization);
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

Json::Value InstitutionService::buildAssignmentProgress(const Json::Value &learningGroup, const Json::Value &assignment) const
{
    Json::Value out = assignment;
    const auto examId = assignment.get("exam_id", "").asString();
    int studentCount = 0;
	int submitted = 0;
	int pendingReview = 0;
    double scoreSum = 0.0;
    int scoreCount = 0;
    Json::Value rows(Json::arrayValue);
    const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
    for (const auto &studentId : learningGroupStudentIds(learningGroup))
    {
        if (studentId.empty())
        {
            continue;
        }
        ++studentCount;
        const auto submission = submissions.get(studentId, Json::Value(Json::objectValue));
        const auto answer = submission.isObject() && submission.isMember("score")
                                ? submission["score"]
                                : answerRepository_.loadAnswer(studentId, examId);
        Json::Value row(Json::objectValue);
        row["student"] = buildMemberView(studentId);
        row["submitted"] = submission.isObject() && submission.isMember("submitted_at");
        row["saved_at"] = submission.get("submitted_at", answerSavedAt(answer)).asString();
		row["score"] = submission.isMember("manual_score") ? submission["manual_score"].asDouble() : readScorePercent(answer);
		row["attempt_no"] = submission.get("attempt_no", 0).asInt();
		row["review_status"] = submission.get("review_status", submission.get("status", "")).asString();
		row["teacher_comment"] = submission.get("teacher_comment", "").asString();
		if (row["submitted"].asBool())
		{
			++submitted;
			if (row["review_status"].asString().empty() || row["review_status"].asString() == "submitted") ++pendingReview;
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
	out["pending_review_count"] = pendingReview;
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

Json::Value InstitutionService::buildCoursePackageSummary(const Json::Value &organizations,
                                                          const Json::Value &visibleLearningGroups,
                                                          const std::string &viewerUserId,
                                                          const Json::Value &roles) const
{
    std::set<std::string> visibleStudents;
    for (const auto &studentId : collectStudentIds(visibleLearningGroups))
    {
        visibleStudents.insert(studentId);
    }

    Json::Value out(Json::arrayValue);
    for (const auto &organization : organizations)
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        for (const auto &coursePackage : organization.get("course_packages", Json::Value(Json::arrayValue)))
        {
            const auto studentId = coursePackage.get("student_id", "").asString();
            if (!canManageInstitution(roles) && viewerUserId != studentId && !visibleStudents.contains(studentId))
            {
                continue;
            }
            Json::Value row = coursePackage;
            row["organization_id"] = organizationId;
            row["organization_name"] = organization.get("name", organizationId).asString();
            row["student"] = buildMemberView(studentId);
            const auto remaining = row.get("remaining_lessons", 0).asInt();
            const auto expiresAt = row.get("expires_at", "").asString();
            row["needs_attention"] = remaining <= 2 || (!expiresAt.empty() && daysSince(expiresAt) >= -14);
            if (remaining <= 0)
            {
                row["attention_reason"] = "课程包课时已用完";
            }
            else if (remaining <= 2)
            {
                row["attention_reason"] = "课程包剩余课时不足";
            }
            else if (!expiresAt.empty() && daysSince(expiresAt) >= -14)
            {
                row["attention_reason"] = "课程包临近到期";
            }
            else
            {
                row["attention_reason"] = "状态正常";
            }
            out.append(row);
        }
    }
    return out;
}

Json::Value InstitutionService::buildScheduleSummary(const Json::Value &visibleLearningGroups,
                                                     const std::string &viewerUserId,
                                                     const Json::Value &roles) const
{
    std::vector<Json::Value> items;
    for (const auto &group : visibleLearningGroups)
    {
        if (!canManageInstitution(roles) &&
            !learningGroupHasUserRole(group, viewerUserId, {"teacher", "assistant", "student"}))
        {
            continue;
        }
        Json::Value row(Json::objectValue);
        row["organization_id"] = group.get("organization_id", group.get("org_id", "")).asString();
        row["learning_group_id"] = group.get("learning_group_id", group.get("group_id", "")).asString();
        row["name"] = group.get("name", "").asString();
        row["type"] = group.get("type", "class").asString();
        row["subject"] = group.get("subject", "").asString();
        row["starts_at"] = group.get("starts_at", "").asString();
        row["ends_at"] = group.get("ends_at", "").asString();
        row["status"] = group.get("status", "active").asString();
        row["teacher_ids"] = Json::arrayValue;
        row["student_ids"] = Json::arrayValue;
        for (const auto &staffId : learningGroupStaffIds(group))
        {
            row["teacher_ids"].append(staffId);
        }
        for (const auto &studentId : learningGroupStudentIds(group))
        {
            row["student_ids"].append(studentId);
        }
        items.push_back(row);
    }

    std::sort(items.begin(), items.end(), [](const Json::Value &left, const Json::Value &right) {
        const auto leftTime = left.get("starts_at", "").asString();
        const auto rightTime = right.get("starts_at", "").asString();
        if (leftTime.empty() != rightTime.empty())
        {
            return !leftTime.empty();
        }
        if (leftTime != rightTime)
        {
            return leftTime < rightTime;
        }
        return left.get("name", "").asString() < right.get("name", "").asString();
    });

    Json::Value out(Json::arrayValue);
    for (const auto &item : items)
    {
        out.append(item);
    }
    return out;
}

Json::Value InstitutionService::buildStudentRelationshipSummary(const Json::Value &visibleLearningGroups,
                                                                const Json::Value &coursePackages) const
{
    std::unordered_map<std::string, Json::Value> byStudent;
    for (const auto &group : visibleLearningGroups)
    {
        for (const auto &studentId : learningGroupStudentIds(group))
        {
            auto &row = byStudent[studentId];
            if (row.isNull())
            {
                row = Json::Value(Json::objectValue);
                row["student"] = buildMemberView(studentId);
                row["learning_groups"] = Json::arrayValue;
                row["course_packages"] = Json::arrayValue;
                row["teacher_ids"] = Json::arrayValue;
            }
            Json::Value groupView(Json::objectValue);
            groupView["learning_group_id"] = group.get("learning_group_id", group.get("group_id", "")).asString();
            groupView["name"] = group.get("name", "").asString();
            groupView["type"] = group.get("type", "class").asString();
            groupView["subject"] = group.get("subject", "").asString();
            row["learning_groups"].append(groupView);
            for (const auto &staffId : learningGroupStaffIds(group))
            {
                appendUnique(row["teacher_ids"], staffId);
            }
        }
    }

    for (const auto &coursePackage : coursePackages)
    {
        const auto studentId = coursePackage.get("student_id", "").asString();
        if (studentId.empty())
        {
            continue;
        }
        auto &row = byStudent[studentId];
        if (row.isNull())
        {
            row = Json::Value(Json::objectValue);
            row["student"] = buildMemberView(studentId);
            row["learning_groups"] = Json::arrayValue;
            row["course_packages"] = Json::arrayValue;
            row["teacher_ids"] = Json::arrayValue;
        }
        row["course_packages"].append(coursePackage);
    }

    Json::Value out(Json::arrayValue);
    for (auto &[_, row] : byStudent)
    {
        row["relationship_count"] = static_cast<Json::Int>(row["learning_groups"].size());
        row["course_package_count"] = static_cast<Json::Int>(row["course_packages"].size());
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::visibleLessonPrepPlans(const std::string &userId,
                                                       const Json::Value &roles,
                                                       const Json::Value &organizations) const
{
    Json::Value out(Json::arrayValue);
    for (const auto &organization : organizations)
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        for (auto plan : organization.get("lesson_prep_plans", Json::Value(Json::arrayValue)))
        {
            if (!canManageInstitution(roles) && plan.get("created_by", "").asString() != userId)
            {
                continue;
            }
            plan["organization_id"] = organizationId;
            plan["organization_name"] = organization.get("name", organizationId).asString();
            out.append(plan);
        }
    }
    return out;
}

Json::Value InstitutionService::buildSeatSummary(const std::string &orgId, const Json::Value &learningGroups) const
{
    Json::Value out(Json::objectValue);
    out["org_id"] = orgId;
    out["used_seats"] = static_cast<Json::Int>(collectStudentIds(learningGroups).size());
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

Json::Value InstitutionService::buildTeacherEffectiveness(const Json::Value &learningGroups) const
{
    std::unordered_map<std::string, Json::Value> byTeacher;
    for (const auto &group : learningGroups)
    {
        const auto groupId = group.get("learning_group_id", group.get("group_id", "")).asString();
        const auto studentCount = static_cast<int>(learningGroupStudentIds(group).size());
        const auto assignmentCount = static_cast<int>(assignmentRepository_.listByLearningGroup(groupId).size());
        for (const auto &teacherId : learningGroupStaffIds(group))
        {
            if (teacherId.empty())
            {
                continue;
            }
            auto &row = byTeacher[teacherId];
            if (row.isNull())
            {
                row = Json::Value(Json::objectValue);
                row["teacher"] = buildMemberView(teacherId);
            row["learning_group_count"] = 0;
                row["student_count"] = 0;
                row["assignment_count"] = 0;
            }
            row["learning_group_count"] = row["learning_group_count"].asInt() + 1;
            row["student_count"] = row["student_count"].asInt() + studentCount;
            row["assignment_count"] = row["assignment_count"].asInt() + assignmentCount;
        }
    }
    Json::Value out(Json::arrayValue);
    for (auto &[_, row] : byTeacher)
    {
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::buildClassAverageTrend(const Json::Value &learningGroups) const
{
    Json::Value out(Json::arrayValue);
    for (const auto &group : learningGroups)
    {
        const auto groupId = group.get("learning_group_id", group.get("group_id", "")).asString();
        const auto assignments = assignmentRepository_.listByLearningGroup(groupId);
        for (const auto &assignment : assignments)
        {
            auto progress = buildAssignmentProgress(group, assignment);
            Json::Value row(Json::objectValue);
            row["learning_group_id"] = groupId;
            row["learning_group_name"] = group.get("name", groupId).asString();
            row["assignment_id"] = assignment.get("assignment_id", "").asString();
            row["assignment_title"] = assignment.get("title", "").asString();
            row["date"] = assignment.get("due_at", assignment.get("created_at", "")).asString();
            row["average_score"] = progress.get("average_score", -1.0).asDouble();
            row["submitted_count"] = progress.get("submitted_count", 0).asInt();
            row["student_count"] = progress.get("student_count", 0).asInt();
            out.append(row);
        }
    }
    return out;
}

Json::Value InstitutionService::buildSkillWeaknessSummary(const std::vector<std::string> &studentIds) const
{
    struct Counter
    {
        int total{0};
        int wrong{0};
    };
    std::map<std::string, Counter> aggregate;
    for (const auto &studentId : studentIds)
    {
        for (const auto &answer : answerRepository_.listUserAnswers(studentId))
        {
            const auto results = answer["statistics"]["results"];
            for (const auto &key : results.getMemberNames())
            {
                const auto row = results[key];
                const auto skill = classifyAnswerRow(answer, row, key);
                auto &counter = aggregate[skill];
                ++counter.total;
                if (row.get("status", "").asString() == "wrong")
                {
                    ++counter.wrong;
                }
            }
        }
    }
    Json::Value out(Json::arrayValue);
    for (const auto &[skill, counter] : aggregate)
    {
        Json::Value row(Json::objectValue);
        row["skill"] = skill;
        row["total_questions"] = counter.total;
        row["wrong_count"] = counter.wrong;
        row["error_rate"] = counter.total > 0 ? std::round(static_cast<double>(counter.wrong) * 10000.0 / counter.total) / 100.0 : 0.0;
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::buildStudentWrongTrend(const std::vector<Json::Value> &answers) const
{
    Json::Value out(Json::arrayValue);
    std::vector<Json::Value> sorted = answers;
    std::sort(sorted.begin(), sorted.end(), [](const Json::Value &a, const Json::Value &b) {
        return answerSavedAt(a) < answerSavedAt(b);
    });
    for (const auto &answer : sorted)
    {
        Json::Value row(Json::objectValue);
        row["exam_id"] = answer.get("exam_id", "").asString();
        row["exam_title"] = examDisplayName(row["exam_id"].asString());
        row["date"] = answerSavedAt(answer);
        row["wrong_count"] = answer["statistics"].get("wrong_count", std::max(0, readTotalCount(answer) - readCorrectCount(answer))).asInt();
        row["correct_count"] = readCorrectCount(answer);
        row["total_questions"] = readTotalCount(answer);
        row["score"] = readScorePercent(answer);
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::buildWritingHistory(const std::vector<Json::Value> &answers) const
{
    Json::Value out(Json::arrayValue);
    for (const auto &answer : answers)
    {
        bool hasWriting = false;
        const auto results = answer["statistics"]["results"];
        for (const auto &key : results.getMemberNames())
        {
            const auto skill = classifyAnswerRow(answer, results[key], key);
            if (skill == "作文")
            {
                hasWriting = true;
                break;
            }
        }
        const auto submitted = answer.get("answers", Json::Value(Json::objectValue));
        if (!hasWriting)
        {
            for (const auto &key : submitted.getMemberNames())
            {
                std::string lower = key;
                std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
                if (lower.find("writing") != std::string::npos || lower.find("essay") != std::string::npos)
                {
                    hasWriting = true;
                    break;
                }
            }
        }
        if (!hasWriting)
        {
            continue;
        }
        Json::Value row(Json::objectValue);
        row["exam_id"] = answer.get("exam_id", "").asString();
        row["exam_title"] = examDisplayName(row["exam_id"].asString());
        row["saved_at"] = answerSavedAt(answer);
        row["score"] = readScorePercent(answer);
        row["answer_count"] = static_cast<Json::Int>(submitted.size());
        out.append(row);
    }
    return out;
}

Json::Value InstitutionService::buildListeningWeaknesses(const std::vector<Json::Value> &answers) const
{
    struct Counter
    {
        int total{0};
        int wrong{0};
    };
    std::map<std::string, Counter> byExam;
    Counter all;
    for (const auto &answer : answers)
    {
        const auto results = answer["statistics"]["results"];
        for (const auto &key : results.getMemberNames())
        {
            const auto row = results[key];
            const auto skill = classifyAnswerRow(answer, row, key);
            if (skill != "听解" && skill != "读听解")
            {
                continue;
            }
            ++all.total;
            auto &examCounter = byExam[answer.get("exam_id", "").asString()];
            ++examCounter.total;
            if (row.get("status", "").asString() == "wrong")
            {
                ++all.wrong;
                ++examCounter.wrong;
            }
        }
    }
    Json::Value out(Json::objectValue);
    out["total_questions"] = all.total;
    out["wrong_count"] = all.wrong;
    out["error_rate"] = all.total > 0 ? std::round(static_cast<double>(all.wrong) * 10000.0 / all.total) / 100.0 : 0.0;
    out["items"] = Json::arrayValue;
    for (const auto &[examId, counter] : byExam)
    {
        Json::Value row(Json::objectValue);
        row["exam_id"] = examId;
        row["exam_title"] = examDisplayName(examId);
        row["total_questions"] = counter.total;
        row["wrong_count"] = counter.wrong;
        row["error_rate"] = counter.total > 0 ? std::round(static_cast<double>(counter.wrong) * 10000.0 / counter.total) / 100.0 : 0.0;
        out["items"].append(row);
    }
    return out;
}

Json::Value InstitutionService::buildQuestionSet(const Json::Value &payload) const
{
    Json::Value out(Json::arrayValue);
    const auto examId = payload.get("exam_id", "").asString();
    const auto limit = std::max(1, payload.get("limit", 20).asInt());
    auto focus = payload.get("focus_keyword", payload.get("focus_type", "")).asString();
    std::transform(focus.begin(), focus.end(), focus.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
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
                auto haystack = section.get("name", section.get("type", "")).asString() + " " +
                                section.get("section_type", "").asString() + " " +
                                q.get("type", section.get("type", "")).asString() + " " +
                                q.get("id", q.get("question_id", "")).asString();
                std::transform(haystack.begin(), haystack.end(), haystack.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
                if (!focus.empty() && haystack.find(focus) == std::string::npos)
                {
                    continue;
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

Json::Value InstitutionService::appendOrganizationAuditEntry(Json::Value organization,
                                                             const std::string &actorUserId,
                                                             const std::string &action,
                                                             const std::string &summary,
                                                             const Json::Value &details)
{
    Json::Value entry(Json::objectValue);
    entry["audit_id"] = common::generateOpaqueId("audit_");
    entry["action"] = action;
    entry["summary"] = summary;
    entry["actor_user_id"] = actorUserId;
    entry["actor_username"] = actorUserId;
    entry["created_at"] = common::nowIso8601();
    entry["details"] = details;

    Json::Value logs(Json::arrayValue);
    logs.append(entry);
    for (const auto &existing : organization.get("audit_logs", Json::Value(Json::arrayValue)))
    {
        if (logs.size() >= 80)
        {
            break;
        }
        logs.append(existing);
    }
    organization["audit_logs"] = logs;
    organization["updated_at"] = common::nowIso8601();
    return organization;
}

Json::Value InstitutionService::upsertLessonPrepPlan(Json::Value organization, const Json::Value &plan)
{
    const auto planId = plan.get("lesson_prep_id", plan.get("id", "")).asString();
    auto plans = organization.get("lesson_prep_plans", Json::Value(Json::arrayValue));
    if (!plans.isArray())
    {
        plans = Json::Value(Json::arrayValue);
    }

    bool replaced = false;
    for (Json::ArrayIndex index = 0; index < plans.size(); ++index)
    {
        if (plans[index].get("lesson_prep_id", plans[index].get("id", "")).asString() == planId)
        {
            const auto createdAt = plans[index].get("created_at", plan.get("created_at", common::nowIso8601()).asString()).asString();
            plans[index] = plan;
            plans[index]["created_at"] = createdAt;
            replaced = true;
            break;
        }
    }
    if (!replaced)
    {
        plans.append(plan);
    }
    organization["lesson_prep_plans"] = plans;
    organization["updated_at"] = common::nowIso8601();
    return organization;
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

std::string InstitutionService::classifyAnswerRow(const Json::Value &answer, const Json::Value &row, const std::string &resultKey) const
{
    const auto examId = answer.get("exam_id", "").asString();
    const auto questionId = row.get("question_id", "").asString();
    const int sectionIndex = row.get("section_index", -1).asInt();
    try
    {
        const auto exam = examRepository_.getExamById(examId);
        const auto sections = exam["exam_info"]["sections"];
        if (sectionIndex >= 0 && sections.isArray() && static_cast<Json::ArrayIndex>(sectionIndex) < sections.size())
        {
            const auto section = sections[static_cast<Json::ArrayIndex>(sectionIndex)];
            const auto sectionType = section.get("section_type", section.get("type", "")).asString();
            const auto sectionName = section.get("name", "").asString();
            const auto tags = section.get("tags", Json::Value(Json::arrayValue));
            auto hasTag = [&](const std::string &needle) {
                if (!tags.isArray())
                {
                    return false;
                }
                for (const auto &tag : tags)
                {
                    if (tag.asString().find(needle) != std::string::npos)
                    {
                        return true;
                    }
                }
                return false;
            };
            if (sectionType == "writing" || hasTag("writing") || sectionName.find("記述") != std::string::npos)
            {
                return "作文";
            }
            if (sectionType == "listening_reading" || hasTag("listening_reading") || sectionName.find("読聴") != std::string::npos)
            {
                return "读听解";
            }
            if (sectionType == "listening" || hasTag("listening") || sectionName.find("聴解") != std::string::npos)
            {
                return "听解";
            }
            if (sectionType == "reading" || hasTag("reading") || sectionName.find("読解") != std::string::npos)
            {
                return "读解";
            }
            if (sectionType == "grammar" || hasTag("grammar"))
            {
                return "语法";
            }
            if (sectionType == "vocabulary" || hasTag("vocab"))
            {
                return "词汇";
            }
        }
    }
    catch (...)
    {
        // Fall through to id-based inference.
    }
    std::string lower = resultKey + " " + questionId;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower.find("writing") != std::string::npos || lower.find("essay") != std::string::npos) return "作文";
    if (lower.find("listening_reading") != std::string::npos) return "读听解";
    if (lower.find("listen") != std::string::npos) return "听解";
    if (lower.find("reading") != std::string::npos) return "读解";
    if (lower.find("grammar") != std::string::npos) return "语法";
    if (lower.find("vocab") != std::string::npos) return "词汇";
    return "未分类";
}

std::string InstitutionService::examDisplayName(const std::string &examId) const
{
    try
    {
        const auto exam = examRepository_.getExamById(examId);
        return exam["exam_info"].get("title", exam.get("title", examId)).asString();
    }
    catch (...)
    {
        return examId;
    }
}

double InstitutionService::readScorePercent(const Json::Value &answer)
{
    const auto stats = answer["statistics"];
    if (answer.isMember("score"))
    {
        return answer["score"].asDouble();
    }
    if (answer.isMember("accuracy"))
    {
        const auto accuracy = answer["accuracy"].asDouble();
        return accuracy <= 1.0 ? accuracy * 100.0 : accuracy;
    }
    if (stats.isMember("score_percent"))
    {
        return stats["score_percent"].asDouble();
    }
    if (stats.isMember("score"))
    {
        return stats["score"].asDouble();
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
    if (answer.isMember("correct_count"))
    {
        return answer["correct_count"].asInt();
    }
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
    if (answer.isMember("total_questions"))
    {
        return answer["total_questions"].asInt();
    }
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

bool InstitutionService::isActiveEnrollment(const Json::Value &enrollment)
{
    return enrollment.get("status", "active").asString() == "active";
}

bool InstitutionService::learningGroupHasUserRole(const Json::Value &learningGroup,
                                                  const std::string &userId,
                                                  const std::vector<std::string> &roles)
{
    if (userId.empty())
    {
        return false;
    }
    for (const auto &enrollment : learningGroup.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (!isActiveEnrollment(enrollment) || enrollment.get("user_id", "").asString() != userId)
        {
            continue;
        }
        const auto role = enrollment.get("role", "student").asString();
        if (std::find(roles.begin(), roles.end(), role) != roles.end())
        {
            return true;
        }
    }
    return false;
}

std::vector<std::string> InstitutionService::learningGroupStudentIds(const Json::Value &learningGroup)
{
    std::set<std::string> ids;
    for (const auto &enrollment : learningGroup.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (!isActiveEnrollment(enrollment) || enrollment.get("role", "student").asString() != "student")
        {
            continue;
        }
        const auto userId = enrollment.get("user_id", "").asString();
        if (!userId.empty())
        {
            ids.insert(userId);
        }
    }
    return {ids.begin(), ids.end()};
}

std::vector<std::string> InstitutionService::learningGroupStaffIds(const Json::Value &learningGroup)
{
    std::set<std::string> ids;
    for (const auto &enrollment : learningGroup.get("enrollments", Json::Value(Json::arrayValue)))
    {
        if (!isActiveEnrollment(enrollment))
        {
            continue;
        }
        const auto role = enrollment.get("role", "").asString();
        if (role != "teacher" && role != "assistant")
        {
            continue;
        }
        const auto userId = enrollment.get("user_id", "").asString();
        if (!userId.empty())
        {
            ids.insert(userId);
        }
    }
    return {ids.begin(), ids.end()};
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
