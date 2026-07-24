#include <algorithm>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
Json::Value recentItemFromScore(const std::string &userId, const std::string &examId, const Json::Value &score)
{
    Json::Value item(Json::objectValue);
    item["user_id"] = userId;
    item["exam_id"] = examId;
    item["status"] = "submitted";
    item["total_questions"] = score.get("total_questions", 0);
    item["answered_count"] = score.get("total_questions", 0).asInt() - score.get("unanswered_count", 0).asInt();
    item["correct_count"] = score.get("correct_count", 0);
    item["wrong_count"] = score.get("wrong_count", 0);
    item["score"] = score.get("score", 0.0);
    item["completion"] = score.get("completion", 0.0);
    return item;
}
}  // namespace

void registerAnswerRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/answers/submit",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                auto userId = body.get("user_id", "guest").asString();
                const auto examId = requireString(body, "exam_id");
                const auto answers = body.get("answers", Json::Value(Json::objectValue));
                const auto submissionId = body.get("submission_id", "").asString();
                const auto attemptId = body.get("attempt_id", "").asString();
                const auto exam = ctx.examService->getExam(examId);
                auto score = ctx.answerService->calculateScore(examId, answers, exam);
                if (userId == "guest" && readToken(req, &body).empty()) return common::ok(req, score);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto sessionUserId = session.get("user_id", session.get("id", "")).asString();
                if (userId.empty() || userId == "guest") userId = sessionUserId;
                requireDataOwnerOrAdmin(session, userId, "只能提交当前登录账号的答案");
                score["exam_mode"] = body.get("exam_mode", "practice").asString();
                if (ctx.attemptTimerService != nullptr)
                {
                    const auto timer = ctx.attemptTimerService->get(userId);
                    if (timer.isObject() && timer.get("exam_id", "").asString() == examId)
                    {
                        score["elapsed_seconds"] = timer.get("elapsed_seconds", 0);
                    }
                }
                const auto savedAttempt = ctx.answerService->save(userId, examId, answers, score, submissionId);
                if (savedAttempt.get("idempotent_replay", false).asBool())
                {
                    auto replayScore = savedAttempt.get("statistics", score);
                    replayScore["idempotent_replay"] = true;
                    replayScore["attempt_id"] = attemptId;
                    replayScore["attempt_status"] = "submitted";
                    return common::ok(req, replayScore);
                }
                if (ctx.recentLearningRepository != nullptr)
                {
                    ctx.recentLearningRepository->upsert(userId, recentItemFromScore(userId, examId, score));
                }
                // 业务功能 1：评分完成后自动把错题写入错题本（容错：失败不影响主流程）
                if (ctx.wrongQuestionService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("wrong_questions", userId)))
                {
                    try
                    {
                        ctx.wrongQuestionService->recordFromScore(userId, examId, exam, score);
                    }
                    catch (...)
                    {
                        // 错题本写入异常不应阻断答题提交
                    }
                }
                // 业务功能 2：累计当日学习数据 + 推进连续天数（容错）
                if (ctx.streakService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("streak", userId)))
                {
                    try
                    {
                        const int totalQ = score.get("total_questions", 0).asInt();
                        const int correct = score.get("correct_count", 0).asInt();
                        ctx.streakService->recordActivity(userId, totalQ, correct);
                    }
                    catch (...)
                    {
                        // 学习连续天数写入异常不应阻断答题提交
                    }
                }
                // 业务功能 4：提交后清除该用户的草稿（容错；仅在同一试卷时才清）
                if (ctx.draftService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("resume_draft", userId)))
                {
                    try
                    {
                        ctx.draftService->markSubmitted(userId, examId, attemptId);
                        const auto current = ctx.draftService->get(userId);
                        if (current.isObject() && current.get("exam_id", "").asString() == examId)
                        {
                            ctx.draftService->clear(userId);
                        }
                    }
                    catch (...)
                    {
                        // 草稿清除异常不应阻断答题提交
                    }
                }
                // 业务功能 3：提交后清除答题计时（仅在同一试卷时才清）
                if (ctx.attemptTimerService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("exam_timer", userId)))
                {
                    try
                    {
                        const auto current = ctx.attemptTimerService->get(userId);
                        if (current.isObject() && current.get("exam_id", "").asString() == examId)
                        {
                            ctx.attemptTimerService->clear(userId);
                        }
                    }
                    catch (...)
                    {
                        // 计时清理异常不应阻断答题提交
                    }
                }
                // 业务功能 7：错题同时入 SRS 复习卡（幂等）
                if (ctx.srsService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("srs", userId)))
                {
                    try
                    {
                        ctx.srsService->ingestWrongFromScore(userId, examId, exam, score);
                    }
                    catch (...)
                    {
                        // SRS 入卡异常不应阻断答题提交
                    }
                }
                auto submittedScore = score;
                submittedScore["attempt_id"] = attemptId;
                submittedScore["attempt_status"] = "submitted";
                return common::ok(req, submittedScore);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/answers/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                Json::Value out(Json::objectValue);
                out["answers"] = ctx.answerService->load(userId, examId);
                return common::ok(req, out);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/answers/{1}/{2}/attempts",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int limit = readBoundedIntParameter(req, "limit", 20, 1, 50);
                return common::ok(req, ctx.answerService->attempts(userId, examId, limit));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/progress/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                return common::ok(req, ctx.answerService->progress(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/progress/{1}/exams",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                return common::ok(req, ctx.answerService->examProgress(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
