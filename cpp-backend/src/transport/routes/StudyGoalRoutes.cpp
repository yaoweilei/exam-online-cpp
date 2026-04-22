#include <drogon/HttpAppFramework.h>

#include "application/services/StudyGoalService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 18：备考目标 / 倒计时 路由
//   GET    /api/v2/me/study-goals
//   POST   /api/v2/me/study-goals
//   PATCH  /api/v2/me/study-goals/{goalId}
//   DELETE /api/v2/me/study-goals/{goalId}
//
// 权限：登录；FeatureFlag study_goal
// ---------------------------------------------------------------------------
void registerStudyGoalRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/me/study-goals",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "study_goal", userId);
                return common::ok(req, ctx.studyGoalService->list(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/me/study-goals",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "study_goal", userId);
                const auto body = parseJsonBody(req);
                return common::ok(req, ctx.studyGoalService->create(userId, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/me/study-goals/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &goalId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "study_goal", userId);
                const auto body = parseJsonBody(req);
                return common::ok(req, ctx.studyGoalService->update(userId, goalId, body));
            });
        },
        {Patch});

    app().registerHandler(
        "/api/v2/me/study-goals/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &goalId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "study_goal", userId);
                Json::Value out(Json::objectValue);
                out["removed"] = ctx.studyGoalService->remove(userId, goalId);
                return common::ok(req, out);
            });
        },
        {Delete});
}
}  // namespace transport::routes
