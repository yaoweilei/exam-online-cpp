#include <drogon/HttpAppFramework.h>

#include "application/services/AuthService.h"
#include "application/services/OAuthService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 22：第三方 OAuth 路由（Google / Apple）
//   GET /api/v2/auth/oauth/{provider}/start          → 302 跳转到授权页（mock 模式直接到 callback）
//   GET /api/v2/auth/oauth/{provider}/callback       → 完成登录，写 token cookie 并 302 回 /
//
// 权限：公开访问；FeatureFlag oauth_extra（system-only，由后端在 Service 层兜底）
//
// mock 模式回调可通过 ?mock_email=&mock_sub=&mock_name= 自定义身份；
// 生产环境应在 appsettings 配置 client_id/secret/redirect_uri 并把 mock=false
// ---------------------------------------------------------------------------
namespace
{
HttpResponsePtr redirectTo(const std::string &url)
{
    auto resp = HttpResponse::newRedirectionResponse(url);
    return resp;
}
}  // namespace

void registerOAuthRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/auth/oauth/{1}/start",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &provider) {
            handleRequest(req, std::move(callback), [&]() -> HttpResponsePtr {
                requireFeature(*ctx.featureFlagService, "oauth_extra", "");
                if (!ctx.oauthService->isProviderEnabled(provider))
                    throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                                "未启用的 OAuth 提供方：" + provider,
                                                drogon::k503ServiceUnavailable);
                const auto state = ctx.oauthService->issueState(provider);
                const auto url = ctx.oauthService->buildAuthorizationUrl(provider, state);
                return redirectTo(url);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/auth/oauth/{1}/callback",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &provider) {
            handleRequest(req, std::move(callback), [&]() -> HttpResponsePtr {
                requireFeature(*ctx.featureFlagService, "oauth_extra", "");
                const auto code = req->getParameter("code");
                const auto state = req->getParameter("state");
                const auto mockEmail = req->getParameter("mock_email");
                const auto mockSub = req->getParameter("mock_sub");
                const auto mockName = req->getParameter("mock_name");
                const auto result =
                    ctx.oauthService->handleCallback(provider, code, state, mockEmail, mockSub, mockName);
                const auto token = ctx.authService->createSessionForUser(result.user);
                // 写 cookie + 重定向回首页（前端会读取 cookie 调用 /verify 拉取 session）
                auto resp = redirectTo("/");
                drogon::Cookie cookie("token", token);
                cookie.setPath("/");
                cookie.setHttpOnly(false);
                resp->addCookie(std::move(cookie));
                return resp;
            });
        },
        {Get});
}
}  // namespace transport::routes
