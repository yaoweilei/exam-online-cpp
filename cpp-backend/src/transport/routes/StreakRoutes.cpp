#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 学习连续天数 / 每日目标 路由（业务功能 2）
//   GET /api/v2/streaks/{userId}/summary           当前连续天数 + 今日目标进度
//   GET /api/v2/streaks/{userId}/heatmap?days=90   最近 N 天热力图
//   PUT /api/v2/streaks/{userId}/goal              修改每日目标，body: { daily_questions }
// ---------------------------------------------------------------------------
void registerStreakRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/streaks/{1}/summary",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "streak", userId);
                return common::ok(req, ctx.streakService->summary(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/streaks/{1}/heatmap",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "streak", userId);
                int days = 90;  // 默认 90 天
                const auto raw = req->getParameter("days");
                if (!raw.empty())
                {
                    try { days = std::stoi(raw); } catch (...) {}
                }
                return common::ok(req, ctx.streakService->heatmap(userId, days));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/streaks/{1}/goal",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "streak", userId);
                const auto body = parseJsonBody(req);
                int q = 30;
                if (body.isMember("daily_questions") && body["daily_questions"].isIntegral())
                {
                    q = body["daily_questions"].asInt();
                }
                return common::ok(req, ctx.streakService->updateDailyGoal(userId, q));
            });
        },
        {Put});
}
}  // namespace transport::routes
