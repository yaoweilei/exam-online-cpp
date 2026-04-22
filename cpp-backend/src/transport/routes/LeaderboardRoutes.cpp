#include <drogon/HttpAppFramework.h>

#include "application/services/LeaderboardService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 21：排行榜路由
//   GET /api/v2/leaderboard?period=week|month|all&limit=20&force=1
// 权限：登录 + FeatureFlag leaderboard
// ---------------------------------------------------------------------------
void registerLeaderboardRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/leaderboard",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "leaderboard", userId);
                const auto period = req->getParameter("period");
                const auto limit = std::atoi(req->getParameter("limit").c_str());
                const bool force = req->getParameter("force") == "1";
                return common::ok(req, ctx.leaderboardService->get(period, limit, force));
            });
        },
        {Get});
}
}  // namespace transport::routes
