#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 10：用户数据导出 路由
//   GET /api/v2/data-export/{userId}    →  完整 JSON 快照
//
// 权限：登录 + 本人或 superAdmin；功能开关 data_export
// ---------------------------------------------------------------------------

namespace
{
// 本人或 superAdmin
void requireSelfOrSuperAdmin(const Json::Value &session, const std::string &userId)
{
    const auto sid = session.get("user_id", session.get("id", "")).asString();
    if (sid == userId) return;
    if (hasAnyRole(session.get("roles", Json::Value(Json::arrayValue)), {"superAdmin"}))
    {
        return;
    }
    throw common::AppException("FORBIDDEN", "只能导出自己的数据", drogon::k403Forbidden);
}
}  // namespace

void registerDataExportRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/data-export/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireSelfOrSuperAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "data_export", userId);
                return common::ok(req, ctx.dataExportService->exportUserData(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
