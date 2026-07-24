#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 学习连续天数 / 每日目标 路由（业务功能 2）
//   GET /api/v1/streaks/{userId}/summary           当前连续天数 + 今日目标进度
//   GET /api/v1/streaks/{userId}/heatmap?days=90   最近 N 天热力图
//   PUT /api/v1/streaks/{userId}/goal              修改每日目标，body: { daily_questions }
// ---------------------------------------------------------------------------
void registerStreakRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/streaks/{1}/summary",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "streak", userId);
                return common::ok(req, ctx.streakService->summary(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/streaks/{1}/heatmap",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "streak", userId);
                const int days = readBoundedIntParameter(req, "days", 90, 1, 365);
                return common::ok(req, ctx.streakService->heatmap(userId, days));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/streaks/{1}/goal",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "streak", userId);
                const int q = readBoundedIntField(body, "daily_questions", 30, 1, 500);
                return common::ok(req, ctx.streakService->updateDailyGoal(userId, q));
            });
        },
        {Put});
}
}  // namespace transport::routes
