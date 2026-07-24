#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerAuthRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/auth/login",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto username = requireString(body, "username");
                const auto password = body.get("password", "").asString();
                return common::ok(req, ctx.authService->login(username, password));
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
                return common::ok(req, ctx.authService->registerUser(username, password, email, referralCode));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/password/change",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto currentPassword = body.get("current_password", "").asString();
                const auto newPassword = requireString(body, "new_password");
                return common::ok(req,
                    ctx.authService->changePassword(
                        session.get("user_id", "").asString(),
                        currentPassword,
                        newPassword),
                    "password_changed");
            });
        },
        {Post});

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
                return common::ok(req, ctx.authService->sendPasswordResetCode(loginId), "code_sent");
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
                return common::ok(req, ctx.authService->resetPassword(loginId, code, newPassword));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/logout",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto token = requireString(body, "token");
                Json::Value out(Json::objectValue);
                out["success"] = ctx.authService->logout(token);
                return common::ok(req, out);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/verify",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto token = req->getParameter("token");
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
