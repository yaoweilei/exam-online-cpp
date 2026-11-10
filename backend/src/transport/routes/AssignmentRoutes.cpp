#include <cmath>
#include <string>
#include <unordered_set>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"
#include "application/services/AssignmentScope.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
void requireLearningGroupStaffOrAdmin(const AppContext &ctx,
                                      const Json::Value &session,
                                      const std::string &organizationId,
                                      const std::string &learningGroupId)
{
    if (hasAnyRole(session["roles"], {"superAdmin"}))
    {
        return;
    }
    const auto userId = session.get("user_id", session.get("id", "")).asString();
    if (ctx.organizationService->canManageOrganization(userId, session["roles"], organizationId))
    {
        return;
    }
    if (!ctx.assignmentService->isLearningGroupStaff(organizationId, learningGroupId, userId))
    {
        throw common::AppException("FORBIDDEN", "仅学习组老师、助教或机构管理员可执行此操作", drogon::k403Forbidden);
    }
}

Json::Value filterScoreForAssignment(const Json::Value &score, const Json::Value &assignment, const Json::Value &exam)
{
    std::unordered_set<std::string> selectedIds;
    for (const auto &id : application::services::resolveAssignmentQuestionKeys(exam, assignment))
    {
        selectedIds.insert(id.asString());
    }

    Json::Value filtered = score;
    Json::Value results(Json::objectValue);
    int total = 0;
    int correct = 0;
    int wrong = 0;
    int unanswered = 0;
    for (const auto &key : score["results"].getMemberNames())
    {
        const auto row = score["results"][key];
        if (!selectedIds.contains(key))
        {
            continue;
        }
        results[key] = row;
        ++total;
        const auto status = row.get("status", "").asString();
        if (status == "correct") ++correct;
        else if (status == "wrong") ++wrong;
        else ++unanswered;
    }
    if (total == 0)
    {
        // A valid writing-only scope is submitted for teacher review. It must
        // neither acquire an unrelated whole-paper score nor be rejected.
        filtered["requires_manual_review"] = true;
    }
    filtered["results"] = results;
    filtered["total_questions"] = total;
    filtered["correct_count"] = correct;
    filtered["wrong_count"] = wrong;
    filtered["unanswered_count"] = unanswered;
    filtered["score"] = total > 0 ? std::round(static_cast<double>(correct) * 10000.0 / total) / 100.0 : -1.0;
    filtered["accuracy"] = (correct + wrong) > 0 ? std::round(static_cast<double>(correct) * 10000.0 / (correct + wrong)) / 100.0 : 0.0;
    filtered["completion"] = total > 0 ? std::round(static_cast<double>(correct + wrong) * 10000.0 / total) / 100.0 : 0.0;
    filtered["assignment_scope_applied"] = true;
    return filtered;
}
}  // namespace

void registerAssignmentRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups/{2}/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                requireLearningGroupStaffOrAdmin(ctx, session, organizationId, learningGroupId);
                auto payload = body;
                payload["question_ids"] = application::services::resolveAssignmentQuestionKeys(
                    ctx.examService->getExam(body.get("exam_id", "").asString()), body);
                return common::ok(
                    req,
                    ctx.assignmentService->createAssignment(organizationId, learningGroupId, userId, payload),
                    "assignment_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups/{2}/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                if (!ctx.assignmentService->isLearningGroupMember(organizationId, learningGroupId, userId) &&
                    !ctx.organizationService->canManageOrganization(userId, session["roles"], organizationId) &&
                    !hasAnyRole(session["roles"], {"superAdmin"}))
                {
                    throw common::AppException("FORBIDDEN", "无权查看该学习组作业", drogon::k403Forbidden);
                }
                auto result=ctx.assignmentService->listAssignmentsByLearningGroup(organizationId, learningGroupId);
                if (!ctx.assignmentService->isLearningGroupStaff(organizationId,learningGroupId,userId) &&
                    !ctx.organizationService->canManageOrganization(userId,session["roles"],organizationId) && !hasAnyRole(session["roles"],{"superAdmin"})) {
                    Json::Value safe(Json::arrayValue);
                    for (const auto &assignment : result["items"]) if (application::services::assignmentTargetsStudent(assignment,userId))
                        safe.append(ctx.assignmentService->getAssignmentForStudent(assignment["assignment_id"].asString(),userId));
                    result["items"]=safe;
                }
                return common::ok(req, result);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/assignments/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                const auto organizationId = assignment.get("organization_id", "").asString();
                const auto learningGroupId = assignment.get("learning_group_id", assignment.get("group_id", "")).asString();
                if (!ctx.assignmentService->isLearningGroupMember(organizationId, learningGroupId, userId) &&
                    !ctx.organizationService->canManageOrganization(userId, session["roles"], organizationId) &&
                    !hasAnyRole(session["roles"], {"superAdmin"}))
                {
                    throw common::AppException("FORBIDDEN", "无权查看该作业", drogon::k403Forbidden);
                }
                if (!ctx.assignmentService->isLearningGroupStaff(organizationId, learningGroupId, userId) &&
                    !ctx.organizationService->canManageOrganization(userId, session["roles"], organizationId) &&
                    !hasAnyRole(session["roles"], {"superAdmin"}))
                {
                    assignment = ctx.assignmentService->getAssignmentForStudent(assignmentId, userId);
                }
                assignment["question_ids"] = application::services::resolveAssignmentQuestionKeys(
                    ctx.examService->getExam(assignment.get("exam_id", "").asString()), assignment);
                return common::ok(req, assignment);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/assignments/{1}/submit",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                const auto examId = assignment.get("exam_id", "").asString();
                const auto answers = body.get("answers", Json::Value(Json::objectValue));
                const auto exam = ctx.examService->getExam(examId);
                auto score = ctx.answerService->calculateScore(examId, answers, exam);
                score = filterScoreForAssignment(score, assignment, exam);
                const auto receipt = body.get("submission_id", "").asString();
                if (receipt.size() > 120) throw common::AppException("VALIDATION_ERROR", "提交标识过长", k422UnprocessableEntity);
                const auto submission = ctx.assignmentService->submitAssignment(assignmentId, userId, answers, score, receipt);
                ctx.answerService->save(userId, examId, submission["answers"], submission["score"], submission["submission_id"].asString());
                Json::Value out(Json::objectValue);
                out["assignment_id"] = assignmentId;
                out["submission"] = submission;
                out["score"] = submission["score"];
                return common::ok(req, out);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/assignments/{1}/submissions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                requireLearningGroupStaffOrAdmin(
                    ctx,
                    session,
                    assignment.get("organization_id", "").asString(),
                    assignment.get("learning_group_id", assignment.get("group_id", "")).asString());
                return common::ok(req, ctx.assignmentService->assignmentSubmissions(assignmentId));
            });
        },
        {Get});

	app().registerHandler(
		"/api/v1/assignments/{1}/submissions/{2}/review",
		[ctx](const HttpRequestPtr &req,
		      std::function<void(const HttpResponsePtr &)> &&callback,
		      std::string assignmentId,
		      std::string studentId) {
			handleRequest(req, std::move(callback), [&]() {
				const auto body = parseJsonBody(req);
				const auto session = requireSession(*ctx.authService, req, &body);
				const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
				requireLearningGroupStaffOrAdmin(
					ctx,
					session,
					assignment.get("organization_id", "").asString(),
					assignment.get("learning_group_id", assignment.get("group_id", "")).asString());
				const auto action = body.get("action", "reviewed").asString();
				if (action != "reviewed" && action != "returned")
				{
					throw common::AppException("VALIDATION_ERROR", "action 必须是 reviewed 或 returned", k422UnprocessableEntity);
				}
				const auto comment = body.get("comment", "").asString();
				if (comment.size() > 1000 || (action == "returned" && comment.empty()))
				{
					throw common::AppException("VALIDATION_ERROR", "退回重做必须填写评语，且评语不能超过 1000 字", k422UnprocessableEntity);
				}
				if (body.isMember("manual_score"))
				{
					const auto score = body["manual_score"].asDouble();
					if (!body["manual_score"].isNumeric() || score < 0.0 || score > 100.0)
					{
						throw common::AppException("VALIDATION_ERROR", "manual_score 必须在 0 到 100 之间", k422UnprocessableEntity);
					}
				}
				const auto actorId = session.get("user_id", session.get("id", "")).asString();
				const auto submission = ctx.assignmentService->reviewSubmission(assignmentId, studentId, actorId, body);
				Json::Value details(Json::objectValue);
				details["assignment_id"] = assignmentId;
				details["student_id"] = studentId;
				details["action"] = action;
				ctx.auditLogService->record(
					action == "returned" ? "assignment.submission.returned" : "assignment.submission.reviewed",
					actorId,
					action == "returned" ? "退回作业重做" : "批改作业提交",
					details,
					assignment.get("organization_id", "").asString());
				return common::ok(req, submission, action == "returned" ? "submission_returned" : "submission_reviewed");
			});
		},
		{Post, Patch});

	app().registerHandler(
		"/api/v1/assignments/{1}/reminders",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireBoundedString(body, "message", 1, 500);
                requireBoundedString(body, "idempotency_key", 8, 120);
                const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                requireLearningGroupStaffOrAdmin(
                    ctx,
                    session,
                    assignment.get("organization_id", "").asString(),
                    assignment.get("learning_group_id", assignment.get("group_id", "")).asString());
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                const auto reminder = ctx.assignmentService->remindAssignment(assignmentId, actorId, body);
                if (!reminder.get("idempotent_replay", false).asBool())
                {
                    Json::Value details(Json::objectValue);
                    details["assignment_id"] = assignmentId;
                    details["reminder_id"] = reminder.get("reminder_id", "");
                    details["target_count"] = reminder.get("target_student_ids", Json::Value(Json::arrayValue)).size();
                    ctx.auditLogService->record(
                        "assignment.reminder.sent",
                        actorId,
                        "发送作业催交提醒",
                        details,
                        assignment.get("organization_id", "").asString());
                }
                return common::ok(req, reminder);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/assignments/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                requireLearningGroupStaffOrAdmin(
                    ctx,
                    session,
                    assignment.get("organization_id", "").asString(),
                    assignment.get("learning_group_id", assignment.get("group_id", "")).asString());
                auto patch = body;
                if (body.isMember("exam_id") || body.isMember("question_ids") ||
                    body.isMember("question_start") || body.isMember("question_end"))
                {
                    auto scoped = assignment;
                    for (const auto &field : body.getMemberNames()) scoped[field] = body[field];
                    if (!body.isMember("question_ids")) scoped["question_ids"] = Json::Value(Json::arrayValue);
                    if (body.isMember("exam_id") && body["exam_id"] != assignment["exam_id"])
                    {
                        if (!body.isMember("question_start")) scoped["question_start"] = 0;
                        if (!body.isMember("question_end")) scoped["question_end"] = 0;
                        patch["question_start"] = scoped["question_start"];
                        patch["question_end"] = scoped["question_end"];
                    }
                    patch["question_ids"] = application::services::resolveAssignmentQuestionKeys(
                        ctx.examService->getExam(scoped.get("exam_id", "").asString()), scoped);
                }
                const auto updated = ctx.assignmentService->updateAssignment(assignmentId, patch);
                if (body.isMember("auto_reminder_enabled") || body.isMember("auto_reminder_hours_before"))
                {
                    Json::Value details(Json::objectValue);
                    details["assignment_id"] = assignmentId;
                    details["enabled"] = updated.get("auto_reminder_enabled", false);
                    details["hours_before"] = updated.get(
                        "auto_reminder_hours_before",
                        Json::Value(Json::arrayValue));
                    ctx.auditLogService->record(
                        "assignment.auto_reminder.updated",
                        session.get("user_id", session.get("id", "")).asString(),
                        "更新作业自动催交规则",
                        details,
                        assignment.get("organization_id", "").asString());
                }
                return common::ok(req, updated);
            });
        },
        {Patch});

    app().registerHandler(
        "/api/v1/assignments/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto assignment = ctx.assignmentService->getAssignment(assignmentId);
                requireLearningGroupStaffOrAdmin(
                    ctx,
                    session,
                    assignment.get("organization_id", "").asString(),
                    assignment.get("learning_group_id", assignment.get("group_id", "")).asString());
                return common::ok(req, ctx.assignmentService->removeAssignment(assignmentId));
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/me/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(req, ctx.assignmentService->listMyAssignments(userId, session["roles"]));
            });
        },
        {Get});
}
}  // namespace transport::routes
