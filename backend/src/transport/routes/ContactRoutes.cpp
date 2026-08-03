#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerContactRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/auth/contact-change/send-code",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto channel = requireString(body, "channel");
                ctx.contactChangeChallengeService->sendChallengeCode(
                    session.get("user_id", "").asString(), channel);
                Json::Value out(Json::objectValue);
                out["channel"] = channel;
                return common::ok(req, out, "code_sent");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/phone/send-code",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto phone = requireString(body, "phone");
                auto out = ctx.phoneService->sendVerificationCode(phone);
                return common::ok(req, out, "code_sent");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/phone/verify",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto requestToken = readToken(req, &body);
                const auto session = requestToken.empty()
                                         ? Json::Value(Json::nullValue)
                                         : requireSession(*ctx.authService, req, &body);
                const auto userId = session.isNull() ? body.get("user_id", "guest").asString()
                                                    : session.get("user_id", "").asString();
                const auto phone = requireString(body, "phone");
                const auto code = requireString(body, "code");
                const auto changeChallengeChannel = body.get("change_challenge_channel", "").asString();
                const auto changeChallengeCode = body.get("change_challenge_code", "").asString();
                const auto referralCode = body.get("referral_code", body.get("ref", "")).asString();
                const auto user = ctx.phoneService->verifyAndBind(
                    userId, phone, code, referralCode, changeChallengeChannel, changeChallengeCode);
                if (!session.isNull())
                {
                    if (user.get("id", "").asString() != session.get("user_id", "").asString())
                    {
                        const auto token = ctx.authService->createSessionForUser(
                            user,
                            req->peerAddr().toIp(),
                            req->getHeader("User-Agent"));
                        auto out = ctx.authService->verify(token);
                        out["token"] = token;
                        out["switched_user"] = true;
                        if (ctx.secureCookies)
                        {
                            out.removeMember("token");
                        }
                        auto response = common::ok(req, out, "phone_verified");
                        addSessionCookie(response, token, ctx.secureCookies);
                        return response;
                    }
                    return common::ok(req,
                        ctx.userService->getUser(user.get("id", "").asString()),
                        "phone_verified");
                }
                const auto token = ctx.authService->createSessionForUser(
                    user,
                    req->peerAddr().toIp(),
                    req->getHeader("User-Agent"));
                auto out = ctx.authService->verify(token);
                out["token"] = token;
                if (ctx.secureCookies)
                {
                    out.removeMember("token");
                }
                auto response = common::ok(req, out);
                addSessionCookie(response, token, ctx.secureCookies);
                return response;
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/email/send-code",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                const auto email = requireString(body, "email");
                auto out = ctx.emailVerificationService->sendVerificationCode(email);
                return common::ok(req, out, "code_sent");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/auth/email/verify",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto email = requireString(body, "email");
                const auto code = requireString(body, "code");
                const auto changeChallengeChannel = body.get("change_challenge_channel", "").asString();
                const auto changeChallengeCode = body.get("change_challenge_code", "").asString();
                const auto user = ctx.emailVerificationService->verifyAndBind(
                    session.get("user_id", "").asString(), email, code,
                    changeChallengeChannel, changeChallengeCode);
                return common::ok(req,
                    ctx.userService->getUser(user.get("id", "").asString()),
                    "email_verified");
            });
        },
        {Post});
}
}  // namespace transport::routes
