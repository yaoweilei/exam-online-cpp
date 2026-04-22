#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 题目反馈/纠错 路由（业务功能 5）
//   POST   /api/v2/feedback                          用户提交（需登录 + 功能开关 question_feedback）
//                                                    body: { paper_id*, question_id*, exam_id?, category?, description? }
//   GET    /api/v2/feedback?paper_id=&status=        运营查看（需 superAdmin）
//   PATCH  /api/v2/feedback/{feedbackId}?paper_id=   运营更新 status / admin_note（需 superAdmin）
// ---------------------------------------------------------------------------
void registerFeedbackRoutes(const AppContext &ctx)
{
    // 提交
    app().registerHandler(
        "/api/v2/feedback",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_feedback", userId);

                // 服务端用 session 中的 userId 覆盖前端传入的，避免冒名提交
                Json::Value patched = body;
                patched["user_id"] = userId;
                return common::ok(req, ctx.feedbackService->submit(patched));
            });
        },
        {Post});

    // 列表（管理员）
    app().registerHandler(
        "/api/v2/feedback",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                const auto paperId = req->getParameter("paper_id");
                const auto status = req->getParameter("status");
                Json::Value out(Json::objectValue);
                out["items"] = ctx.feedbackService->list(paperId, status);
                return common::ok(req, out);
            });
        },
        {Get});

    // 更新（管理员）
    app().registerHandler(
        "/api/v2/feedback/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string feedbackId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                const auto paperId = req->getParameter("paper_id");
                return common::ok(req, ctx.feedbackService->update(paperId, feedbackId, body));
            });
        },
        {Patch});
}
}  // namespace transport::routes
