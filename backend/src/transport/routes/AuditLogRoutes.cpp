#include <optional>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "application/services/AuditLogService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 15：审计日志可视化 路由
//   GET /api/v1/admin/audit-logs           查询日志
//     query: org_id?, actor_id?, action?, since?, until?, limit?, offset?
//   GET /api/v1/admin/audit-logs/actions   去重 action 列表（用于筛选下拉）
//
// 权限：登录 + (superAdmin | orgAdmin)；FeatureFlag audit_log_viewer
//   - orgAdmin：强制 org_id 限制为其所属组织（任一），传别的会被忽略覆盖
// ---------------------------------------------------------------------------

namespace
{
std::optional<std::string> getOpt(const drogon::HttpRequestPtr &req, const std::string &key)
{
    const auto v = req->getParameter(key);
    if (v.empty()) return std::nullopt;
    return v;
}

// 取 actor 第一个所属 org，用于 orgAdmin 强制注入（委托给 service）
std::string firstOrgIdOf(application::services::AuditLogService &svc, const std::string &userId)
{
    return svc.firstOrgIdOfUser(userId);
}
}  // namespace

void registerAuditLogRoutes(const AppContext &ctx)
{
    // 查询日志
    app().registerHandler(
        "/api/v1/admin/audit-logs",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session,
                            {"superAdmin", "orgAdmin"},
                            "需要超级管理员或组织管理员权限");
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "audit_log_viewer", actorId);

                const bool isSuper = hasAnyRole(session.get("roles", Json::Value(Json::arrayValue)), {"superAdmin"});

                application::services::AuditLogQuery q;
                q.actorId = getOpt(req, "actor_id");
                q.action = getOpt(req, "action");
                q.since = getOpt(req, "since");
                q.until = getOpt(req, "until");
                q.limit = readBoundedIntParameter(req, "limit", 50, 1, 200);
                q.offset = readBoundedIntParameter(req, "offset", 0, 0, 1000000);
                if (isSuper)
                {
                    q.orgId = getOpt(req, "org_id");
                }
                else
                {
                    // orgAdmin 强制限定到自己的组织
                    const auto myOrg = firstOrgIdOf(*ctx.auditLogService, actorId);
                    if (myOrg.empty())
                    {
                        throw common::AppException("FORBIDDEN", "未找到所属组织", drogon::k403Forbidden);
                    }
                    q.orgId = myOrg;
                }

                return common::ok(req, ctx.auditLogService->query(q));
            });
        },
        {Get});

    // 去重 action 列表
    app().registerHandler(
        "/api/v1/admin/audit-logs/actions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session,
                            {"superAdmin", "orgAdmin"},
                            "需要超级管理员或组织管理员权限");
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "audit_log_viewer", actorId);

                const bool isSuper = hasAnyRole(session.get("roles", Json::Value(Json::arrayValue)), {"superAdmin"});
                std::optional<std::string> orgId;
                if (isSuper)
                {
                    orgId = getOpt(req, "org_id");
                }
                else
                {
                    const auto myOrg = firstOrgIdOf(*ctx.auditLogService, actorId);
                    if (myOrg.empty())
                    {
                        throw common::AppException("FORBIDDEN", "未找到所属组织", drogon::k403Forbidden);
                    }
                    orgId = myOrg;
                }
                return common::ok(req, ctx.auditLogService->listActions(orgId));
            });
        },
        {Get});
}
}  // namespace transport::routes
