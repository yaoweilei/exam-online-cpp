#include <drogon/HttpAppFramework.h>

#include <sstream>
#include <string>
#include <vector>

#include "application/services/SyncService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
// 把 "a,b,c" 拆成 vector
std::vector<std::string> splitCsv(const std::string &s)
{
    std::vector<std::string> out;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ','))
    {
        if (!item.empty()) out.push_back(item);
    }
    return out;
}
}  // namespace

// ---------------------------------------------------------------------------
// 业务功能 19：多端同步路由
//   GET  /api/v1/me/sync/state                            返回各模块 mtime
//   GET  /api/v1/me/sync/pull?modules=bookmarks,srs       拉取选定模块；缺省全部
//   POST /api/v1/me/sync/push                             上传本机模块快照，冲突时返回 conflicts
//   GET  /api/v1/me/sync/devices                          设备列表
//
// 权限：登录；FeatureFlag sync_devices
// ---------------------------------------------------------------------------
void registerSyncRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/sync/state",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "sync_devices", userId);
                return common::ok(req, ctx.syncService->state(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/sync/pull",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "sync_devices", userId);
                const auto modulesRaw = req->getParameter("modules");
                const auto mods = splitCsv(modulesRaw);
                return common::ok(req, ctx.syncService->pull(userId, mods));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/sync/push",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "sync_devices", userId);
                return common::ok(req, ctx.syncService->push(userId, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/me/sync/devices",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "sync_devices", userId);
                return common::ok(req, ctx.syncService->devices(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
