#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
std::string clientKey(const HttpRequestPtr &req)
{
    return req->peerAddr().toIp();
}

std::string userAgent(const HttpRequestPtr &req)
{
    constexpr std::size_t maxLength = 512;
    const auto value = req->getHeader("User-Agent");
    return value.size() <= maxLength ? value : value.substr(0, maxLength);
}

HttpResponsePtr sessionResponse(const HttpRequestPtr &req,
                                Json::Value data,
                                const std::string &message,
                                bool secureCookies)
{
    const auto token = data.get("token", "").asString();
    if (secureCookies)
    {
        data.removeMember("token");
    }
    auto response = common::ok(req, data, message);
    if (!token.empty())
    {
        addSessionCookie(response, token, secureCookies);
    }
    return response;
}
}  // namespace

void registerAuthRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/auth/login",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto username = requireString(body, "username");
                const auto password = body.get("password", "").asString();
                return sessionResponse(
                    req,
                    ctx.authService->login(username, password, clientKey(req), userAgent(req)),
                    "ok",
                    ctx.secureCookies);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/register",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto username = requireString(body, "username");
                const auto password = requireString(body, "password");
                const auto email = body.get("email", "").asString();
                const auto referralCode = body.get("referral_code", body.get("ref", "")).asString();
                return sessionResponse(
                    req,
                    ctx.authService->registerUser(
                        username,
                        password,
                        email,
                        referralCode,
                        clientKey(req),
                        userAgent(req)),
                    "ok",
                    ctx.secureCookies);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/password/change",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto token = readToken(req, &body);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto currentPassword = body.get("current_password", "").asString();
                const auto newPassword = requireString(body, "new_password");
                auto result = ctx.authService->changePassword(
                        session.get("user_id", "").asString(),
                        currentPassword,
                        newPassword);
                result["revoked_sessions"] = ctx.authService->revokeSessionsForUser(
                    session.get("user_id", "").asString(),
                    token);
                return common::ok(req,
                    result,
                    "password_changed");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/sessions",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto token = readToken(req);
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(
                    req,
                    ctx.authService->sessionsForUser(
                        session.get("user_id", "").asString(),
                        token));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/auth/sessions/revoke-others",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto token = readToken(req, &body);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                Json::Value out(Json::objectValue);
                out["revoked_sessions"] = ctx.authService->revokeSessionsForUser(userId, token);
                ctx.auditLogService->record(
                    "account.sessions.revoked_others",
                    userId,
                    "退出其他登录设备",
                    out);
                return common::ok(req, out, "other_sessions_revoked");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/sessions/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string sessionId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto token = readToken(req, &body);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                if (!ctx.authService->revokeSessionForUser(userId, sessionId, token))
                {
                    throw common::AppException(
                        "SESSION_NOT_REVOCABLE",
                        "当前会话不能在这里退出，或该会话已经失效",
                        k409Conflict);
                }
                Json::Value out(Json::objectValue);
                out["session_id"] = sessionId;
                out["revoked"] = true;
                ctx.auditLogService->record(
                    "account.session.revoked",
                    userId,
                    "退出指定登录设备",
                    out);
                return common::ok(req, out, "session_revoked");
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/auth/account/delete",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto confirmation = requireString(body, "confirmation");
                if (confirmation != "注销账号")
                {
                    throw common::AppException("CONFIRMATION_REQUIRED", "Type 注销账号 to confirm account deletion", k422UnprocessableEntity);
                }
                const auto phone = requireString(body, "phone");
                const auto phoneCode = requireString(body, "phone_code");
                ctx.phoneService->verifyCurrentPhoneCode(
                    session.get("user_id", "").asString(),
                    phone,
                    phoneCode);
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                const auto reason = body.get("reason", "user_requested").asString();
                const auto result = ctx.authService->deactivateAccount(actorId, reason);
                Json::Value details(Json::objectValue);
                details["reason"] = reason;
                ctx.auditLogService->record(
                    "account.deactivated",
                    actorId,
                    "注销账号",
                    details);
                return common::ok(req,
                    result,
                    "account_deactivated");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/password/reset/send-code",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto loginId = requireString(body, "login_id");
                return common::ok(
                    req,
                    ctx.authService->sendPasswordResetCode(loginId, clientKey(req)),
                    "code_sent");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/password/reset",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto loginId = requireString(body, "login_id");
                const auto code = requireString(body, "code");
                const auto newPassword = requireString(body, "new_password");
                return sessionResponse(
                    req,
                    ctx.authService->resetPassword(loginId, code, newPassword),
                    "ok",
                    ctx.secureCookies);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/logout",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto token = readToken(req, &body);
                if (token.empty())
                {
                    throw common::AppException(
                        "AUTH_REQUIRED",
                        "请先登录",
                        k401Unauthorized);
                }
                Json::Value out(Json::objectValue);
                out["success"] = ctx.authService->logout(token);
                auto response = common::ok(req, out);
                clearSessionCookie(response, ctx.secureCookies);
                return response;
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/verify",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto token = readToken(req);
                if (token.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing token parameter", k422UnprocessableEntity);
                }
                return common::ok(req, ctx.authService->verify(token));
            });
        },
        {Get});
}
}  // namespace transport::routes
