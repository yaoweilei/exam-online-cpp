#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 功能开关路由（横切基础设施）
//   GET    /api/v1/feature-flags/registry              所有可用 flag 元信息（公开）
//   GET    /api/v1/me/feature-flags                    当前登录用户的解析结果
//   PUT    /api/v1/me/feature-flags                    用户自助修改可覆盖项
//                                                      body: { "<key>": { enabled, lock? } | null }
//   PUT    /api/v1/admin/feature-flags/system          超管修改 system 默认（需 superAdmin 角色）
//   PUT    /api/v1/admin/feature-flags/orgs/{orgId}    组织 owner / 超管修改 org 覆盖
// ---------------------------------------------------------------------------
void registerFeatureFlagRoutes(const AppContext &ctx)
{
    // 注册表（公开，前端启动时也可拉一次以渲染管理界面）
    app().registerHandler(
        "/api/v1/feature-flags/registry",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                Json::Value out(Json::objectValue);
                out["registry"] = ctx.featureFlagService->listRegistry();
                return common::ok(req, out);
            });
        },
        {Get});

    // 当前用户的最终结果
    app().registerHandler(
        "/api/v1/me/feature-flags",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                Json::Value out(Json::objectValue);
                out["flags"] = ctx.featureFlagService->resolveAll(userId);
                return common::ok(req, out);
            });
        },
        {Get});

    // 用户自助修改
    app().registerHandler(
        "/api/v1/me/feature-flags",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                ctx.featureFlagService->updateUserFlags(userId, body);
                Json::Value out(Json::objectValue);
                out["flags"] = ctx.featureFlagService->resolveAll(userId);
                return common::ok(req, out);
            });
        },
        {Put});

    // 超管修改 system
    app().registerHandler(
        "/api/v1/admin/feature-flags/system",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                Json::Value out(Json::objectValue);
                out["flags"] = ctx.featureFlagService->systemSnapshot();
                return common::ok(req, out);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/feature-flags/system",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                const auto confirmation = requireBoundedString(body, "confirmation", 1, 30);
                if (confirmation != "确认修改系统开关")
                {
                    throw common::AppException(
                        "CONFIRMATION_REQUIRED",
                        "请输入“确认修改系统开关”确认此操作",
                        drogon::k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                Json::Value out(Json::objectValue);
                out["flags"] = ctx.featureFlagService->updateSystemFlags(body);
                Json::Value changes(Json::objectValue);
                for (const auto &key : body.getMemberNames())
                {
                    if (key != "token" && key != "confirmation" && key != "reauth_password") changes[key] = body[key];
                }
                ctx.auditLogService->record(
                    "feature_flags.system.updated",
                    session.get("user_id", session.get("id", "")).asString(),
                    "修改系统功能开关",
                    changes);
                out["revoked_sessions"] = ctx.authService->revokeSessionsForUser(
                    session.get("user_id", session.get("id", "")).asString(),
                    session.get("token", "").asString());
                return common::ok(req, out);
            });
        },
        {Put});

    // 组织级修改：org owner 或 superAdmin
    app().registerHandler(
        "/api/v1/admin/feature-flags/orgs/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string orgId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"orgAdmin", "superAdmin"}, "需要组织管理员权限");
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                if (!ctx.organizationService->canManageOrganization(actorId, session["roles"], orgId))
                {
                    throw common::AppException(
                        "ORGANIZATION_ACCESS_DENIED",
                        "不能修改不属于你的机构",
                        drogon::k403Forbidden);
                }
                const auto confirmation = requireBoundedString(body, "confirmation", 1, 30);
                if (confirmation != "确认修改机构开关")
                {
                    throw common::AppException(
                        "CONFIRMATION_REQUIRED",
                        "请输入“确认修改机构开关”确认此操作",
                        drogon::k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                Json::Value out(Json::objectValue);
                out["flags"] = ctx.featureFlagService->updateOrgFlags(orgId, body);
                Json::Value changes(Json::objectValue);
                for (const auto &key : body.getMemberNames())
                {
                    if (key != "token" && key != "confirmation" && key != "reauth_password") changes[key] = body[key];
                }
                ctx.auditLogService->record(
                    "feature_flags.organization.updated",
                    actorId,
                    "修改机构功能开关",
                    changes,
                    orgId);
                out["revoked_sessions"] = ctx.authService->revokeSessionsForUser(
                    actorId,
                    session.get("token", "").asString());
                return common::ok(req, out);
            });
        },
        {Put});
}
}  // namespace transport::routes
