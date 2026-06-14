#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerRedeemRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/wallet",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.redeemService->walletForUser(session.get("user_id", "").asString()));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/redeem",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto code = requireString(body, "code");
                return common::ok(
                    req,
                    ctx.redeemService->redeemCode(session.get("user_id", "").asString(), code),
                    "redeemed");
            });
        },
        {Post});
}
}  // namespace transport::routes
