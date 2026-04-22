#include <drogon/HttpAppFramework.h>

#include "application/services/ExplanationService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 20：题目讲解附件路由
//   GET    /api/v2/explanations/{examId}                          整卷讲解索引
//   GET    /api/v2/explanations/{examId}/{questionId}             单题讲解列表
//   POST   /api/v2/explanations/{examId}/{questionId}             新增讲解（教师/管理员）
//   DELETE /api/v2/explanations/{examId}/{questionId}/{expId}     删除讲解（作者或管理员）
//
// 权限：登录 + FeatureFlag question_explanations
//   - 写操作要求 teacher/reviewer/orgAdmin/systemAdmin/superAdmin
// ---------------------------------------------------------------------------
void registerExplanationRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/explanations/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_explanations", userId);
                return common::ok(req, ctx.explanationService->listForExam(examId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/explanations/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &examId,
              const std::string &questionId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_explanations", userId);
                return common::ok(req, ctx.explanationService->listForQuestion(examId, questionId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/explanations/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &examId,
              const std::string &questionId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_explanations", userId);
                requireRole(session,
                            {"teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"},
                            "仅教师/管理员可新增讲解");
                const auto authorName = session.get("display_name", session.get("username", "")).asString();
                const auto body = parseJsonBody(req);
                return common::ok(
                    req, ctx.explanationService->addExplanation(examId, questionId, userId, authorName, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/explanations/{1}/{2}/{3}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &examId,
              const std::string &questionId,
              const std::string &explanationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_explanations", userId);
                // 简化：仅允许 teacher/reviewer/orgAdmin/systemAdmin/superAdmin 删除
                requireRole(session,
                            {"teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"},
                            "仅教师/管理员可删除讲解");
                Json::Value out(Json::objectValue);
                out["removed"] = ctx.explanationService->removeExplanation(examId, questionId, explanationId);
                return common::ok(req, out);
            });
        },
        {Delete});
}
}  // namespace transport::routes
