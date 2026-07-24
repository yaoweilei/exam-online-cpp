#include <algorithm>
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

Json::Value paymentFilters(const HttpRequestPtr &req)
{
    Json::Value filters(Json::objectValue);
    for (const auto *key : {"status", "provider", "scope_type", "user_id", "order_id", "q", "sort", "order"})
        filters[key] = req->getParameter(key);
    try { filters["page"] = std::max(1, std::stoi(req->getParameter("page"))); } catch (...) { filters["page"] = 1; }
    try { filters["page_size"] = std::clamp(std::stoi(req->getParameter("page_size")), 1, 100); } catch (...) { filters["page_size"] = 20; }
    return filters;
}
}  // namespace

void registerPaymentRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/payments/pricing",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.paymentService->getPricingConfig());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/payments/pricing",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
				if (requireBoundedString(body, "confirmation", 1, 30) != "确认修改套餐价格")
					throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改套餐价格”确认此操作", k422UnprocessableEntity);
				requirePasswordReauthentication(*ctx.authService, session, body);
				auto pricingPayload = body;
				pricingPayload.removeMember("token");
				pricingPayload.removeMember("confirmation");
				pricingPayload.removeMember("reauth_password");
				const auto result = ctx.paymentService->updatePricingConfig(pricingPayload);
				Json::Value details(Json::objectValue);
				details["default_provider"] = result.get("default_provider", "");
				ctx.auditLogService->record("payment.pricing.updated", session.get("user_id", "").asString(), "修改套餐价格配置", details);
				Json::Value response = result;
				response["revoked_sessions"] = ctx.authService->revokeSessionsForUser(session.get("user_id", "").asString(), session.get("token", "").asString());
                return common::ok(
                    req,
					response,
                    "payment_pricing_updated");
            });
        },
        {Put});

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
        "/api/v1/admin/payments/organization-orders",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                if (requireBoundedString(body, "confirmation", 1, 30) != "确认创建扩席订单")
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认创建扩席订单”确认此操作", drogon::k422UnprocessableEntity);
                requirePasswordReauthentication(*ctx.authService, session, body);
                const auto order = ctx.paymentService->createOrganizationOrder(
                    session.get("user_id", "").asString(), requireBoundedString(body, "organization_id", 1, 120), body);
                Json::Value details(Json::objectValue);
                details["order_id"] = order.get("id", "");
                details["organization_id"] = order.get("organization_id", "");
                details["amount_cents"] = order.get("amount_cents", 0);
                ctx.auditLogService->record("payment.organization_order.created", session.get("user_id", "").asString(), "创建机构扩席订单", details);
                return common::ok(req, order, "organization_payment_order_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/admin/payments/orders",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.paymentService->listOrders(paymentFilters(req)));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/payments/refunds",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.paymentService->listRefunds(paymentFilters(req)));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/payments/ledger",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.paymentService->listAllLedger(paymentFilters(req)));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/payments/reconciliation",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                return common::ok(req, ctx.paymentService->reconciliation());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/admin/payments/refunds/{1}/status",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string refundId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin"}, "需要超级管理员权限");
                if (requireBoundedString(body, "confirmation", 1, 30) != "确认更新退款")
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认更新退款”确认此操作", drogon::k422UnprocessableEntity);
                requirePasswordReauthentication(*ctx.authService, session, body);
                const auto result = ctx.paymentService->updateRefundStatus(
                    refundId, requireBoundedString(body, "status", 1, 40), session.get("user_id", "").asString(), body);
                Json::Value details(Json::objectValue);
                details["refund_id"] = refundId;
                details["status"] = result.get("status", "");
                ctx.auditLogService->record("payment.refund.status_updated", session.get("user_id", "").asString(), "更新退款状态", details);
                Json::Value response = result;
                response["revoked_sessions"] = ctx.authService->revokeSessionsForUser(session.get("user_id", "").asString(), session.get("token", "").asString());
                return common::ok(req, response, "payment_refund_status_updated");
            });
        },
        {Patch});

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
                const auto confirmation = requireBoundedString(body, "confirmation", 1, 20);
                if (confirmation != "确认退款")
                {
                    throw common::AppException(
                        "CONFIRMATION_REQUIRED",
                        "请输入“确认退款”确认此操作",
                        drogon::k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                requireBoundedString(body, "idempotency_key", 8, 120);
                const auto actorId = session.get("user_id", session.get("id", "")).asString();
                const auto refund = ctx.paymentService->requestRefund(
                    actorId,
                    session["roles"],
                    body);
                if (!refund.get("idempotent_replay", false).asBool())
                {
                    Json::Value details(Json::objectValue);
                    details["refund_id"] = refund.get("id", "");
                    details["order_id"] = refund.get("order_id", "");
                    details["amount_cents"] = refund.get("amount_cents", 0);
                    details["currency"] = refund.get("currency", "");
                    details["status"] = refund.get("status", "");
                    ctx.auditLogService->record(
                        "payment.refund.requested",
                        actorId,
                        "发起支付退款",
                        details);
                }
                Json::Value response = refund;
                response["revoked_sessions"] = ctx.authService->revokeSessionsForUser(
                    actorId,
                    session.get("token", "").asString());
                return common::ok(
                    req,
                    response,
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
                        req->getHeader("Stripe-Signature").empty() ? req->getHeader("X-Payment-Signature") : req->getHeader("Stripe-Signature")),
                    "payment_webhook_accepted");
            });
        },
        {Post});
}
}  // namespace transport::routes
