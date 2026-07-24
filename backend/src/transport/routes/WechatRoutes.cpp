#include <drogon/HttpAppFramework.h>
#include <drogon/HttpResponse.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerWechatRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/auth/wechat/qrcode",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.wechatService->generateQrcode());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/auth/wechat/authorize",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.wechatService->generateMobileAuthorization());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/auth/wechat/callback",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() -> HttpResponsePtr {
                const auto code = req->getParameter("code");
                const auto state = req->getParameter("state");
                if (code.empty() || state.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing code or state",
                                               k422UnprocessableEntity);
                }
                const auto isMobile = ctx.wechatService->isMobileState(state);
                const auto token = ctx.wechatService->handleCallback(code, state);
                if (isMobile)
                {
                    auto resp = HttpResponse::newRedirectionResponse("/");
                    drogon::Cookie cookie("token", token);
                    cookie.setPath("/");
                    cookie.setHttpOnly(false);
                    resp->addCookie(std::move(cookie));
                    return resp;
                }
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k200OK);
                resp->setContentTypeCode(CT_TEXT_HTML);
                resp->setBody("<html><body><script>window.close();</script>"
                              "<p>Login successful. You may close this window.</p></body></html>");
                return resp;
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/auth/wechat/poll",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto state = req->getParameter("state");
                if (state.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing state parameter",
                                               k422UnprocessableEntity);
                }
                return common::ok(req, ctx.wechatService->poll(state));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/auth/wechat/bind",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto code = requireString(body, "code");
                return common::ok(req,
                    ctx.wechatService->bindToUser(session.get("user_id", "").asString(), code),
                    "wechat_bound");
            });
        },
        {Post});
}
}  // namespace transport::routes
