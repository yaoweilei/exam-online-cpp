#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerMeRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/message-reads",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.profileService->messageReads(session.get("user_id", "").asString()));
            });
        }, {Get});

    app().registerHandler(
        "/api/v1/me/message-reads",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto ids = body["ids"];
                if (!ids.isArray() || ids.empty() || ids.size() > 200)
                    throw common::AppException("INVALID_INPUT", "一次可标记 1 至 200 条消息", k400BadRequest);
                for (const auto &id : ids)
                    if (!id.isString() || id.asString().empty() || id.asString().size() > 256)
                        throw common::AppException("INVALID_INPUT", "消息标识无效", k400BadRequest);
                return common::ok(req, ctx.profileService->markMessagesRead(session.get("user_id", "").asString(), ids));
            });
        }, {Post});

    app().registerHandler(
        "/api/v1/me",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.userService->getUser(session.get("user_id", "").asString()));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/context",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                auto context = ctx.userService->context(session.get("user_id", "").asString());
                context["session"] = session;
                return common::ok(req, context);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/organization",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                auto context = ctx.userService->selectOrganization(
                    session.get("user_id", "").asString(), requireString(body, "organization_id"));
                context["session"] = session;
                return common::ok(req, context);
            });
        },
        {Put});

    app().registerHandler(
        "/api/v1/me/invitations",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req,
                    ctx.organizationService->listPendingInvitationsForUser(session.get("user_id", "").asString()));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/referral/claim",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto referralCode = requireString(body, "referral_code");
                return common::ok(req,
                    ctx.userService->claimReferral(session.get("user_id", "").asString(), referralCode),
                    "referral_claimed");
            });
        },
        {Post});
}
}  // namespace transport::routes
