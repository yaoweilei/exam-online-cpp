#include <drogon/HttpAppFramework.h>

#include "application/services/SubscriptionService.h"
#include "application/services/StudyGoalService.h"
#include "common/AppException.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 18：备考目标 / 倒计时 路由
//   GET    /api/v1/me/study-goals
//   POST   /api/v1/me/study-goals
//   PATCH  /api/v1/me/study-goals/{goalId}
//   DELETE /api/v1/me/study-goals/{goalId}
//
// 权限：登录；FeatureFlag study_goal
// ---------------------------------------------------------------------------
void registerStudyGoalRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/study-goals",
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
        "/api/v1/me/study-goals",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "study_goal", userId);
                const auto subscription = ctx.subscriptionService
                                              ? ctx.subscriptionService->currentSubscription(userId)
                                              : Json::Value(Json::objectValue);
                const auto effectivePlan = subscription.get(
                    "effective_plan", subscription.get("plan", "free")).asString();
                const auto currentGoals = ctx.studyGoalService->list(userId);
                if (effectivePlan != "ultra" &&
                    currentGoals.get("items", Json::Value(Json::arrayValue)).size() >= 2)
                {
                    throw common::AppException(
                        "STUDY_GOAL_LIMIT_REACHED",
                        "当前套餐最多可设置 2 个目标；请先删除一个目标或升级 ULTRA",
                        drogon::k403Forbidden);
                }
                const auto body = parseJsonBody(req);
                return common::ok(req, ctx.studyGoalService->create(userId, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/me/study-goals/{1}",
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
        "/api/v1/me/study-goals/{1}",
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
