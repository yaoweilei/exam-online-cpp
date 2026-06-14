#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 11：管理员统计 路由
//   GET /api/v1/admin/statistics/overview    →  全站聚合
//
// 权限：登录 + superAdmin；功能开关 admin_dashboard（用 actor 自身 userId 校验）
// ---------------------------------------------------------------------------

void registerAdminStatisticsRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/admin/statistics/overview",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "admin_dashboard", actorId);
                return common::ok(req, ctx.adminStatisticsService->overview());
            });
        },
        {Get});
}
}  // namespace transport::routes
