#include <cmath>
#include <string>
#include <unordered_set>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

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

int parseQuestionNo(const std::string &questionId)
{
    std::string digits;
    for (const auto ch : questionId)
    {
        if (ch >= '0' && ch <= '9')
        {
            digits.push_back(ch);
        }
    }
    if (digits.empty())
    {
        return 0;
    }
    try
    {
        return std::stoi(digits);
    }
    catch (...)
    {
        return 0;
    }
}

Json::Value filterScoreForAssignment(const Json::Value &score, const Json::Value &assignment)
{
    std::unordered_set<std::string> selectedIds;
    if (assignment.isMember("question_ids") && assignment["question_ids"].isArray())
    {
        for (const auto &id : assignment["question_ids"])
        {
            const auto value = id.asString();
            if (!value.empty())
            {
                selectedIds.insert(value);
            }
        }
    }
    const int start = assignment.get("question_start", 0).asInt();
    const int end = assignment.get("question_end", 0).asInt();
    if (selectedIds.empty() && start <= 0 && end <= 0)
    {
        return score;
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
        const auto questionId = row.get("question_id", "").asString();
        bool include = selectedIds.count(questionId) > 0 || selectedIds.count(key) > 0;
        if (!include && (start > 0 || end > 0))
        {
            const int no = parseQuestionNo(questionId);
            include = no > 0 && (start <= 0 || no >= start) && (end <= 0 || no <= end);
        }
        if (!include)
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
        filtered["assignment_scope_warning"] = "指定题目范围没有匹配到可评分题目，已保留整卷评分";
        return filtered;
    }
    filtered["results"] = results;
    filtered["total_questions"] = total;
    filtered["correct_count"] = correct;
    filtered["wrong_count"] = wrong;
    filtered["unanswered_count"] = unanswered;
    filtered["score"] = total > 0 ? std::round(static_cast<double>(correct) * 10000.0 / total) / 100.0 : 0.0;
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
                return common::ok(
                    req,
                    ctx.assignmentService->createAssignment(organizationId, learningGroupId, userId, body),
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
                return common::ok(req, ctx.assignmentService->listAssignmentsByLearningGroup(organizationId, learningGroupId));
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
                    const auto submissions = assignment.get("submissions", Json::Value(Json::objectValue));
                    assignment["own_submission"] = submissions.get(userId, Json::Value(Json::nullValue));
                    assignment.removeMember("submissions");
                    assignment.removeMember("reminders");
                }
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
                score = filterScoreForAssignment(score, assignment);
                ctx.answerService->save(userId, examId, answers, score);
                const auto submission = ctx.assignmentService->submitAssignment(assignmentId, userId, answers, score);
                Json::Value out(Json::objectValue);
                out["assignment_id"] = assignmentId;
                out["submission"] = submission;
                out["score"] = score;
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
                return common::ok(req, ctx.assignmentService->updateAssignment(assignmentId, body));
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
