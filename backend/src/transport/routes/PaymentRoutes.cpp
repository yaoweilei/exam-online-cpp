#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
Json::Value parseRawJsonBody(const HttpRequestPtr &req)
{
    auto json = req->getJsonObject();
    if (json)
    {
        return *json;
    }
    return Json::Value(Json::objectValue);
}
}  // namespace

void registerPaymentRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/payments/orders",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                return common::ok(
                    req,
                    ctx.paymentService->createOrder(session.get("user_id", "").asString(), body),
                    "payment_order_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/payments/orders/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string orderId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(
                    req,
                    ctx.paymentService->getOrder(
                        session.get("user_id", "").asString(),
                        session["roles"],
                        orderId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/payments/ledger",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(
                    req,
                    ctx.paymentService->listLedger(
                        session.get("user_id", "").asString(),
                        session["roles"],
                        req->getParameter("user_id")));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/payments/refunds",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                return common::ok(
                    req,
                    ctx.paymentService->requestRefund(
                        session.get("user_id", "").asString(),
                        session["roles"],
                        body),
                    "payment_refund_requested");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/payments/webhooks/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string provider) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(
                    req,
                    ctx.paymentService->handleWebhook(
                        provider,
                        std::string(req->body()),
                        parseRawJsonBody(req),
                        req->getHeader("Stripe-Signature")),
                    "payment_webhook_accepted");
            });
        },
        {Post});
}
}  // namespace transport::routes
