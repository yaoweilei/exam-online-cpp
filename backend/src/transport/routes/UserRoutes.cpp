#include <algorithm>
#include <cstddef>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
Json::Value buildOrganizationUserSearchView(const Json::Value &user)
{
    Json::Value out(Json::objectValue);
    for (const auto *field : {
             "id", "user_id", "username", "display_name", "displayName",
             "avatar_url", "avatar", "status", "roles", "role_ids", "roleIds"})
    {
        if (user.isMember(field))
        {
            out[field] = user[field];
        }
    }
    return out;
}
}  // namespace

void registerUserRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/users/search",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"orgAdmin", "superAdmin"},
                            "You do not have permission to search users");

                const auto query = req->getParameter("q");
                if (query.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing query parameter: q",
                                               k422UnprocessableEntity);
                }

                const auto limit = static_cast<std::size_t>(
                    readBoundedIntParameter(req, "limit", 12, 1, 50));

                auto results = ctx.userService->searchUsers(query, limit);
                if (!hasAnyRole(session["roles"], {"superAdmin"}))
                {
                    Json::Value sanitized(Json::arrayValue);
                    for (const auto &user : results)
                    {
                        sanitized.append(buildOrganizationUserSearchView(user));
                    }
                    results = std::move(sanitized);
                }

                return common::ok(req, results);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/users/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
				const auto session = requireSession(*ctx.authService, req);
				requireDataOwnerOrAdmin(session, userId, "无权查看其他用户资料");
                return common::ok(req, ctx.userService->getUser(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/users/by-role/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string roleId) {
            handleRequest(req, std::move(callback), [&]() {
				const auto session = requireSession(*ctx.authService, req);
				requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.userService->usersByRole(roleId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/users/{1}/permissions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
				const auto session = requireSession(*ctx.authService, req);
				requireDataOwnerOrAdmin(session, userId, "无权查看其他用户权限");
                return common::ok(req, ctx.userService->permissions(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/roles",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
				const auto session = requireSession(*ctx.authService, req);
				requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.userService->allRoles());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/role-templates",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.userService->platformRoleTemplates());
            });
        }, {Get});

    app().registerHandler(
        "/api/v1/admin/role-templates/{1}/preview",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string roleId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.userService->previewRoleTemplate(roleId, body));
            });
        }, {Post});

    app().registerHandler(
        "/api/v1/admin/role-templates/{1}",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string roleId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                if (requireBoundedString(body, "confirmation", 1, 30) != "确认修改角色模板")
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改角色模板”确认此操作", k422UnprocessableEntity);
                requirePasswordReauthentication(*ctx.authService, session, body);
                const auto result = ctx.userService->updateRoleTemplate(roleId, body);
                Json::Value details(Json::objectValue); details["role_id"] = roleId; details["diff"] = result["diff"];
                ctx.auditLogService->record("role_template.updated", session.get("user_id", "").asString(), "修改全局角色模板", details);
				Json::Value response = result;
				int revokedSessions = 0;
				for (const auto &user : ctx.userService->usersByRole(roleId))
				{
					revokedSessions += ctx.authService->revokeSessionsForUser(user.get("user_id", user.get("id", "")).asString());
				}
				response["revoked_sessions"] = revokedSessions;
				return common::ok(req, response, "role_template_updated");
            });
        }, {Put});

    app().registerHandler(
        "/api/v1/admin/users/{1}/platform-access",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                Json::Value empty(Json::objectValue);
                return common::ok(req, ctx.userService->previewPlatformAccess(userId, empty));
            });
        }, {Get});

    app().registerHandler(
        "/api/v1/admin/users/{1}/platform-access/preview",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.userService->previewPlatformAccess(userId, body));
            });
        }, {Post});

    app().registerHandler(
        "/api/v1/admin/users/{1}/platform-access",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                if (requireBoundedString(body, "confirmation", 1, 30) != "确认修改平台权限")
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改平台权限”确认此操作", k422UnprocessableEntity);
                requirePasswordReauthentication(*ctx.authService, session, body);
                const auto actorId = session.get("user_id", "").asString();
                const auto result = ctx.userService->updatePlatformAccess(actorId, userId, body);
                Json::Value details(Json::objectValue); details["target_user_id"] = userId; details["diff"] = result["diff"];
                ctx.auditLogService->record("platform_access.updated", actorId, "修改成员平台权限", details);
                Json::Value response = result;
                response["revoked_sessions"] = ctx.authService->revokeSessionsForUser(userId, actorId == userId ? session.get("token", "").asString() : "");
                return common::ok(req, response, "platform_access_updated");
            });
        }, {Put});
}
}  // namespace transport::routes
