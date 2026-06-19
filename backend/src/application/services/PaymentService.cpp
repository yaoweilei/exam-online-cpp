#include "PaymentService.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <fstream>
#include <iomanip>
#include <memory>
#include <optional>
#include <random>
#include <sstream>

#include <drogon/HttpClient.h>
#include <drogon/utils/Utilities.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/pem.h>
#include <openssl/sha.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
Json::Value emptyArray()
{
    return Json::Value(Json::arrayValue);
}

std::optional<std::chrono::sys_days> parseDate(const std::string &value)
{
    if (value.size() < 10)
    {
        return std::nullopt;
    }
    try
    {
        const int year = std::stoi(value.substr(0, 4));
        const unsigned month = static_cast<unsigned>(std::stoi(value.substr(5, 2)));
        const unsigned day = static_cast<unsigned>(std::stoi(value.substr(8, 2)));
        const std::chrono::year_month_day ymd{
            std::chrono::year{year},
            std::chrono::month{month},
            std::chrono::day{day}};
        if (!ymd.ok())
        {
            return std::nullopt;
        }
        return std::chrono::sys_days{ymd};
    }
    catch (...)
    {
        return std::nullopt;
    }
}

std::string formatDate(const std::chrono::sys_days &date)
{
    const std::chrono::year_month_day ymd{date};
    std::ostringstream out;
    out << static_cast<int>(ymd.year()) << '-'
        << std::setw(2) << std::setfill('0') << static_cast<unsigned>(ymd.month()) << '-'
        << std::setw(2) << std::setfill('0') << static_cast<unsigned>(ymd.day());
    return out.str();
}

bool hasAnyRole(const Json::Value &roles, std::initializer_list<const char *> expected)
{
    for (const auto &role : roles)
    {
        const auto value = role.asString();
        for (const auto *candidate : expected)
        {
            if (value == candidate)
            {
                return true;
            }
        }
    }
    return false;
}
}  // namespace

PaymentService::PaymentService(std::filesystem::path userRootDir,
                               SubscriptionService &subscriptionService)
    : paymentsDir_(std::move(userRootDir) / "payments"),
      ordersFile_(paymentsDir_ / "orders.json"),
      ledgerFile_(paymentsDir_ / "ledger.json"),
      refundsFile_(paymentsDir_ / "refunds.json"),
      webhookEventsFile_(paymentsDir_ / "webhook_events.json"),
      subscriptionService_(subscriptionService)
{
    std::filesystem::create_directories(paymentsDir_);
}

Json::Value PaymentService::createOrder(const std::string &userId, const Json::Value &payload)
{
    const auto plan = normalizePlan(payload.get("plan", "pro").asString());
    if (plan == "free")
    {
        throw common::AppException("PAYMENT_PLAN_INVALID", "Paid order requires pro or ultra plan", drogon::k422UnprocessableEntity);
    }
    const auto days = normalizeDays(payload.get("days", 30).asInt());
    const auto currency = normalizeCurrency(payload.get("currency", "cny").asString());
    const auto provider = normalizeProvider(payload.get("provider", "stripe").asString());
    const auto amountCents = priceCents(plan, days, currency);
    if (amountCents <= 0)
    {
        throw common::AppException("PAYMENT_PRICE_INVALID", "No price configured for this plan", drogon::k422UnprocessableEntity);
    }

    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();

    Json::Value order(Json::objectValue);
    order["id"] = makeId("pay");
    order["user_id"] = userId;
    order["provider"] = provider;
    order["status"] = "pending";
    order["plan"] = plan;
    order["days"] = days;
    order["currency"] = currency;
    order["amount_cents"] = amountCents;
    order["amount"] = amountCents / 100.0;
    order["description"] = plan + " 套餐 " + std::to_string(days) + " 天";
    order["created_at"] = nowIso();
    order["updated_at"] = order["created_at"].asString();
    order["metadata"] = payload.get("metadata", Json::Value(Json::objectValue));
    order["provider_payload"] = buildProviderPayload(order);

    orders.append(order);
    appendLedgerEntry(ledger, userId, order["id"].asString(), "order.created", amountCents, currency, "创建支付订单");
    saveOrders(orders);
    saveLedger(ledger);
    return order;
}

Json::Value PaymentService::getOrder(const std::string &userId, const Json::Value &roles, const std::string &orderId) const
{
    std::scoped_lock lock(mutex_);
    const auto order = findOrderUnlocked(loadOrders(), orderId);
    if (order.isNull())
    {
        throw common::AppException("PAYMENT_ORDER_NOT_FOUND", "Payment order not found", drogon::k404NotFound);
    }
    if (!canAccessOrder(order, userId, roles))
    {
        throw common::AppException("FORBIDDEN", "You do not have access to this payment order", drogon::k403Forbidden);
    }
    return order;
}

Json::Value PaymentService::listLedger(const std::string &userId, const Json::Value &roles, const std::string &targetUserId) const
{
    const auto effectiveUserId = targetUserId.empty() ? userId : targetUserId;
    if (effectiveUserId != userId && !canManagePayments(roles))
    {
        throw common::AppException("FORBIDDEN", "You do not have access to this payment ledger", drogon::k403Forbidden);
    }
    std::scoped_lock lock(mutex_);
    const auto ledger = loadLedger();
    Json::Value out(Json::arrayValue);
    for (const auto &entry : ledger)
    {
        if (entry.get("user_id", "").asString() == effectiveUserId)
        {
            out.append(entry);
        }
    }
    return out;
}

Json::Value PaymentService::requestRefund(const std::string &userId, const Json::Value &roles, const Json::Value &payload)
{
    const auto orderId = payload.get("order_id", "").asString();
    if (orderId.empty())
    {
        throw common::AppException("PAYMENT_ORDER_REQUIRED", "order_id is required", drogon::k422UnprocessableEntity);
    }

    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();
    auto refunds = loadRefunds();
    auto order = findOrderUnlocked(orders, orderId);
    if (order.isNull())
    {
        throw common::AppException("PAYMENT_ORDER_NOT_FOUND", "Payment order not found", drogon::k404NotFound);
    }
    if (!canAccessOrder(order, userId, roles))
    {
        throw common::AppException("FORBIDDEN", "You do not have access to this payment order", drogon::k403Forbidden);
    }
    if (order.get("status", "").asString() != "paid")
    {
        throw common::AppException("PAYMENT_REFUND_NOT_ALLOWED", "Only paid orders can be refunded", drogon::k409Conflict);
    }

    const auto amount = payload.get("amount_cents", order.get("amount_cents", 0)).asInt();
    if (amount <= 0 || amount > order.get("amount_cents", 0).asInt())
    {
        throw common::AppException("PAYMENT_REFUND_AMOUNT_INVALID", "Refund amount is invalid", drogon::k422UnprocessableEntity);
    }

    Json::Value refund(Json::objectValue);
    refund["id"] = makeId("ref");
    refund["order_id"] = orderId;
    refund["user_id"] = order.get("user_id", "").asString();
    refund["provider"] = order.get("provider", "").asString();
    refund["amount_cents"] = amount;
    refund["currency"] = order.get("currency", "cny").asString();
    refund["reason"] = payload.get("reason", "user_requested").asString();
    refund["status"] = "requested";
    refund["created_at"] = nowIso();
    refund["provider_reference"] = "";

    if (order.get("provider", "").asString() == "stripe" && !env("STRIPE_SECRET_KEY").empty())
    {
        const auto paymentIntent = order.get("provider_payment_intent", "").asString();
        if (!paymentIntent.empty())
        {
            auto client = drogon::HttpClient::newHttpClient(env("STRIPE_API_BASE_URL", "https://api.stripe.com"));
            auto request = drogon::HttpRequest::newHttpRequest();
            request->setMethod(drogon::Post);
            request->setPath("/v1/refunds");
            request->setContentTypeString("application/x-www-form-urlencoded");
            request->addHeader("Authorization", "Bearer " + env("STRIPE_SECRET_KEY"));
            request->setBody(
                "payment_intent=" + urlEncode(paymentIntent) +
                "&amount=" + std::to_string(amount) +
                "&metadata[order_id]=" + urlEncode(orderId));
            const auto [result, response] = client->sendRequest(request);
            if (result == drogon::ReqResult::Ok && response && response->statusCode() >= drogon::k200OK && response->statusCode() < drogon::k300MultipleChoices)
            {
                const auto body = parseJsonOrNull(std::string(response->body()));
                refund["status"] = "succeeded";
                refund["provider_reference"] = body.get("id", "").asString();
            }
            else
            {
                refund["status"] = "requires_manual_review";
            }
        }
        else
        {
            refund["status"] = "requires_manual_review";
        }
    }
    else if (order.get("provider", "").asString() == "wechat" && !env("WECHAT_PAY_MCH_ID").empty())
    {
        Json::Value body(Json::objectValue);
        body["out_trade_no"] = orderId;
        body["out_refund_no"] = refund["id"].asString();
        body["reason"] = refund["reason"].asString();
        body["notify_url"] = env("WECHAT_PAY_REFUND_NOTIFY_URL", env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhook/wechat");
        body["amount"]["refund"] = amount;
        body["amount"]["total"] = order.get("amount_cents", 0).asInt();
        body["amount"]["currency"] = "CNY";
        Json::StreamWriterBuilder writer;
        writer["indentation"] = "";
        const auto rawBody = Json::writeString(writer, body);
        const auto path = "/v3/refund/domestic/refunds";
        const auto authorization = buildWechatAuthorization("POST", path, rawBody);
        if (!authorization.empty())
        {
            auto client = drogon::HttpClient::newHttpClient(env("WECHAT_PAY_API_BASE_URL", "https://api.mch.weixin.qq.com"));
            auto request = drogon::HttpRequest::newHttpRequest();
            request->setMethod(drogon::Post);
            request->setPath(path);
            request->setContentTypeCode(drogon::CT_APPLICATION_JSON);
            request->addHeader("Authorization", authorization);
            request->addHeader("Accept", "application/json");
            request->setBody(rawBody);
            const auto [result, response] = client->sendRequest(request);
            if (result == drogon::ReqResult::Ok && response)
            {
                const auto bodyJson = parseJsonOrNull(std::string(response->body()));
                if (response->statusCode() >= drogon::k200OK && response->statusCode() < drogon::k300MultipleChoices)
                {
                    refund["status"] = bodyJson.get("status", "processing").asString();
                    refund["provider_reference"] = bodyJson.get("refund_id", "").asString();
                    refund["provider_response"] = bodyJson;
                }
                else
                {
                    refund["status"] = "requires_manual_review";
                    refund["provider_response"] = bodyJson;
                }
            }
        }
        else
        {
            refund["status"] = "requires_provider_console";
        }
    }
    else if (order.get("provider", "").asString() == "alipay" && !env("ALIPAY_APP_ID").empty())
    {
        const auto privateKey = readTextFile(env("ALIPAY_PRIVATE_KEY_PATH"));
        if (!privateKey.empty())
        {
            const auto gatewayBase = env("ALIPAY_API_BASE_URL", "https://openapi.alipay.com");
            const auto gatewayPath = env("ALIPAY_API_PATH", "/gateway.do");
            std::ostringstream biz;
            biz << "{\"out_trade_no\":\"" << orderId
                << "\",\"refund_amount\":\"" << std::fixed << std::setprecision(2) << amount / 100.0
                << "\",\"refund_reason\":\"" << refund["reason"].asString()
                << "\",\"out_request_no\":\"" << refund["id"].asString() << "\"}";
            std::vector<std::pair<std::string, std::string>> params{
                {"app_id", env("ALIPAY_APP_ID")},
                {"biz_content", biz.str()},
                {"charset", "utf-8"},
                {"format", "JSON"},
                {"method", "alipay.trade.refund"},
                {"sign_type", "RSA2"},
                {"timestamp", alipayTimestamp()},
                {"version", "1.0"}};
            std::sort(params.begin(), params.end());
            std::ostringstream canonical;
            for (size_t i = 0; i < params.size(); ++i)
            {
                if (i > 0) canonical << '&';
                canonical << params[i].first << '=' << params[i].second;
            }
            const auto signature = rsaSha256Base64(privateKey, canonical.str());
            if (!signature.empty())
            {
                std::ostringstream body;
                for (size_t i = 0; i < params.size(); ++i)
                {
                    if (i > 0) body << '&';
                    body << params[i].first << '=' << urlEncode(params[i].second);
                }
                body << "&sign=" << urlEncode(signature);
                auto client = drogon::HttpClient::newHttpClient(gatewayBase);
                auto request = drogon::HttpRequest::newHttpRequest();
                request->setMethod(drogon::Post);
                request->setPath(gatewayPath);
                request->setContentTypeString("application/x-www-form-urlencoded");
                request->setBody(body.str());
                const auto [result, response] = client->sendRequest(request);
                if (result == drogon::ReqResult::Ok && response)
                {
                    const auto bodyJson = parseJsonOrNull(std::string(response->body()));
                    const auto refundResp = bodyJson["alipay_trade_refund_response"];
                    const auto code = refundResp.get("code", "").asString();
                    if (response->statusCode() >= drogon::k200OK && response->statusCode() < drogon::k300MultipleChoices && code == "10000")
                    {
                        refund["status"] = "succeeded";
                        refund["provider_reference"] = refundResp.get("trade_no", "").asString();
                        refund["provider_response"] = bodyJson;
                    }
                    else
                    {
                        refund["status"] = "requires_manual_review";
                        refund["provider_response"] = bodyJson;
                    }
                }
            }
        }
        else
        {
            refund["status"] = "requires_provider_console";
        }
    }
    else
    {
        refund["status"] = "requires_provider_console";
    }

    refunds.append(refund);
    appendLedgerEntry(ledger, refund["user_id"].asString(), orderId, "refund." + refund["status"].asString(), -amount, refund["currency"].asString(), "退款申请");
    saveRefunds(refunds);
    saveLedger(ledger);
    return refund;
}

Json::Value PaymentService::handleWebhook(const std::string &provider,
                                          const std::string &rawBody,
                                          const Json::Value &payload,
                                          const std::string &signatureHeader)
{
    const auto normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider == "stripe" && !verifyStripeSignature(rawBody, signatureHeader))
    {
        throw common::AppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Stripe webhook signature is invalid", drogon::k401Unauthorized);
    }

    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();
    auto webhookEvents = std::filesystem::exists(webhookEventsFile_)
                             ? infrastructure::storage::readJsonFile(webhookEventsFile_)
                             : Json::Value(Json::arrayValue);
    if (!webhookEvents.isArray())
    {
        webhookEvents = Json::Value(Json::arrayValue);
    }

    std::string orderId;
    std::string providerPaymentId;
    std::string eventId = payload.get("id", "").asString();
    if (normalizedProvider == "stripe")
    {
        const auto type = payload.get("type", "").asString();
        if (type != "checkout.session.completed" && type != "payment_intent.succeeded")
        {
            Json::Value ignored(Json::objectValue);
            ignored["ignored"] = true;
            ignored["provider"] = normalizedProvider;
            ignored["type"] = type;
            return ignored;
        }
        const auto object = payload["data"]["object"];
        orderId = object.get("client_reference_id", object["metadata"].get("order_id", "")).asString();
        providerPaymentId = object.get("payment_intent", object.get("id", "")).asString();
        if (eventId.empty())
        {
            eventId = "stripe:" + type + ":" + providerPaymentId;
        }
    }
    else
    {
        const auto secret = normalizedProvider == "wechat"
                                ? env("WECHAT_PAY_WEBHOOK_SECRET", env("PAYMENT_GENERIC_WEBHOOK_SECRET"))
                                : env("ALIPAY_WEBHOOK_SECRET", env("PAYMENT_GENERIC_WEBHOOK_SECRET"));
        if (!secret.empty() && !signatureHeader.empty())
        {
            if (!verifyGenericHmacSignature(rawBody, signatureHeader, secret))
            {
                throw common::AppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Payment webhook signature is invalid", drogon::k401Unauthorized);
            }
        }
        else if (secret.empty() || payload.get("secret", "").asString() != secret)
        {
            throw common::AppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Payment webhook secret is invalid", drogon::k401Unauthorized);
        }
        const auto status = payload.get("status", "").asString();
        if (status != "paid" && status != "success" && status != "TRADE_SUCCESS")
        {
            Json::Value ignored(Json::objectValue);
            ignored["ignored"] = true;
            ignored["provider"] = normalizedProvider;
            ignored["status"] = status;
            return ignored;
        }
        orderId = payload.get("order_id", payload.get("out_trade_no", "")).asString();
        providerPaymentId = payload.get("provider_payment_id", payload.get("trade_no", "")).asString();
        eventId = payload.get("event_id", normalizedProvider + ":" + orderId + ":" + providerPaymentId).asString();
    }

    if (orderId.empty())
    {
        throw common::AppException("PAYMENT_WEBHOOK_ORDER_MISSING", "Webhook did not include order id", drogon::k422UnprocessableEntity);
    }
    if (!eventId.empty() && hasProcessedWebhookEvent(webhookEvents, eventId))
    {
        Json::Value duplicate(Json::objectValue);
        duplicate["ignored"] = true;
        duplicate["duplicate"] = true;
        duplicate["provider"] = normalizedProvider;
        duplicate["event_id"] = eventId;
        duplicate["order_id"] = orderId;
        return duplicate;
    }
    const auto paidOrder = markOrderPaidUnlocked(orders, ledger, orderId, providerPaymentId, payload);
    if (!eventId.empty())
    {
        rememberWebhookEvent(webhookEvents, eventId, normalizedProvider);
        infrastructure::storage::writeJsonFileAtomic(webhookEventsFile_, webhookEvents);
    }
    saveOrders(orders);
    saveLedger(ledger);
    return paidOrder;
}

Json::Value PaymentService::loadOrders() const
{
    if (!std::filesystem::exists(ordersFile_))
    {
        return emptyArray();
    }
    auto data = infrastructure::storage::readJsonFile(ordersFile_);
    return data.isArray() ? data : emptyArray();
}

Json::Value PaymentService::loadLedger() const
{
    if (!std::filesystem::exists(ledgerFile_))
    {
        return emptyArray();
    }
    auto data = infrastructure::storage::readJsonFile(ledgerFile_);
    return data.isArray() ? data : emptyArray();
}

Json::Value PaymentService::loadRefunds() const
{
    if (!std::filesystem::exists(refundsFile_))
    {
        return emptyArray();
    }
    auto data = infrastructure::storage::readJsonFile(refundsFile_);
    return data.isArray() ? data : emptyArray();
}

void PaymentService::saveOrders(const Json::Value &orders) const
{
    infrastructure::storage::writeJsonFileAtomic(ordersFile_, orders);
}

void PaymentService::saveLedger(const Json::Value &ledger) const
{
    infrastructure::storage::writeJsonFileAtomic(ledgerFile_, ledger);
}

void PaymentService::saveRefunds(const Json::Value &refunds) const
{
    infrastructure::storage::writeJsonFileAtomic(refundsFile_, refunds);
}

Json::Value PaymentService::findOrderUnlocked(const Json::Value &orders, const std::string &orderId) const
{
    for (const auto &order : orders)
    {
        if (order.get("id", "").asString() == orderId)
        {
            return order;
        }
    }
    return Json::Value(Json::nullValue);
}

Json::Value PaymentService::buildStripeCheckoutSession(const Json::Value &order) const
{
    Json::Value provider(Json::objectValue);
    if (env("STRIPE_SECRET_KEY").empty())
    {
        provider["configured"] = false;
        provider["message"] = "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY.";
        return provider;
    }

    const auto baseUrl = env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000");
    const auto orderId = order.get("id", "").asString();
    const auto body =
        "mode=payment"
        "&client_reference_id=" + urlEncode(orderId) +
        "&success_url=" + urlEncode(baseUrl + "/?payment=success&order_id=" + orderId) +
        "&cancel_url=" + urlEncode(baseUrl + "/?payment=cancel&order_id=" + orderId) +
        "&line_items[0][quantity]=1"
        "&line_items[0][price_data][currency]=" + urlEncode(order.get("currency", "cny").asString()) +
        "&line_items[0][price_data][unit_amount]=" + std::to_string(order.get("amount_cents", 0).asInt()) +
        "&line_items[0][price_data][product_data][name]=" + urlEncode(order.get("description", "Exam Online subscription").asString()) +
        "&metadata[order_id]=" + urlEncode(orderId) +
        "&metadata[user_id]=" + urlEncode(order.get("user_id", "").asString()) +
        "&metadata[plan]=" + urlEncode(order.get("plan", "").asString()) +
        "&metadata[days]=" + std::to_string(order.get("days", 0).asInt());

    auto client = drogon::HttpClient::newHttpClient(env("STRIPE_API_BASE_URL", "https://api.stripe.com"));
    auto request = drogon::HttpRequest::newHttpRequest();
    request->setMethod(drogon::Post);
    request->setPath("/v1/checkout/sessions");
    request->setContentTypeString("application/x-www-form-urlencoded");
    request->addHeader("Authorization", "Bearer " + env("STRIPE_SECRET_KEY"));
    request->setBody(body);

    const auto [result, response] = client->sendRequest(request);
    if (result != drogon::ReqResult::Ok || !response)
    {
        provider["configured"] = true;
        provider["error"] = "Stripe request failed";
        return provider;
    }
    const auto payload = parseJsonOrNull(std::string(response->body()));
    if (response->statusCode() < drogon::k200OK || response->statusCode() >= drogon::k300MultipleChoices)
    {
        provider["configured"] = true;
        provider["error"] = payload["error"].get("message", "Stripe checkout session creation failed").asString();
        return provider;
    }

    provider["configured"] = true;
    provider["checkout_session_id"] = payload.get("id", "").asString();
    provider["payment_url"] = payload.get("url", "").asString();
    provider["publishable_key"] = env("STRIPE_PUBLISHABLE_KEY");
    return provider;
}

Json::Value PaymentService::buildProviderPayload(const Json::Value &order) const
{
    const auto providerName = order.get("provider", "stripe").asString();
    Json::Value provider(Json::objectValue);
    provider["provider"] = providerName;
    if (providerName == "stripe")
    {
        return buildStripeCheckoutSession(order);
    }
    if (providerName == "wechat")
    {
        return buildWechatNativePayOrder(order);
    }
    if (providerName == "alipay")
    {
        const auto paymentUrl = buildAlipayPagePayUrl(order);
        provider["configured"] = !paymentUrl.empty();
        provider["method"] = "page_pay";
        if (paymentUrl.empty())
        {
            provider["message"] = "Alipay is not configured. Set ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_PATH, ALIPAY_PUBLIC_KEY, and PUBLIC_WEB_BASE_URL.";
        }
        else
        {
            provider["payment_url"] = paymentUrl;
        }
        return provider;
    }
    provider["configured"] = false;
    provider["message"] = "Payment provider is not supported.";
    return provider;
}

Json::Value PaymentService::markOrderPaidUnlocked(Json::Value &orders,
                                                  Json::Value &ledger,
                                                  const std::string &orderId,
                                                  const std::string &providerPaymentId,
                                                  const Json::Value &providerEvent)
{
    for (auto &order : orders)
    {
        if (order.get("id", "").asString() != orderId)
        {
            continue;
        }
        if (order.get("status", "").asString() == "paid")
        {
            return order;
        }
        order["status"] = "paid";
        order["paid_at"] = nowIso();
        order["updated_at"] = order["paid_at"].asString();
        order["provider_payment_id"] = providerPaymentId;
        order["provider_payment_intent"] = providerPaymentId;
        order["provider_event"] = providerEvent;
        order["subscription"] = grantSubscriptionForOrder(order);
        appendLedgerEntry(
            ledger,
            order.get("user_id", "").asString(),
            orderId,
            "payment.succeeded",
            order.get("amount_cents", 0).asInt(),
            order.get("currency", "cny").asString(),
            "支付成功");
        appendLedgerEntry(
            ledger,
            order.get("user_id", "").asString(),
            orderId,
            "subscription.granted",
            0,
            order.get("currency", "cny").asString(),
            "套餐权益已发放");
        return order;
    }
    throw common::AppException("PAYMENT_ORDER_NOT_FOUND", "Payment order not found", drogon::k404NotFound);
}

Json::Value PaymentService::appendLedgerEntry(Json::Value &ledger,
                                              const std::string &userId,
                                              const std::string &orderId,
                                              const std::string &type,
                                              int amountCents,
                                              const std::string &currency,
                                              const std::string &summary) const
{
    Json::Value entry(Json::objectValue);
    entry["id"] = makeId("led");
    entry["user_id"] = userId;
    entry["order_id"] = orderId;
    entry["type"] = type;
    entry["amount_cents"] = amountCents;
    entry["currency"] = currency;
    entry["summary"] = summary;
    entry["created_at"] = nowIso();
    ledger.append(entry);
    return entry;
}

Json::Value PaymentService::grantSubscriptionForOrder(const Json::Value &order)
{
    const auto userId = order.get("user_id", "").asString();
    const auto current = subscriptionService_.subscriptionForUser(userId);
    Json::Value patch(Json::objectValue);
    patch["plan"] = order.get("plan", "pro").asString();
    patch["status"] = "active";
    patch["expires_at"] = nextExpiryDate(current.get("expires_at", "").asString(), order.get("days", 30).asInt());
    return subscriptionService_.updateUserSubscription(userId, patch);
}

bool PaymentService::canAccessOrder(const Json::Value &order, const std::string &userId, const Json::Value &roles) const
{
    return order.get("user_id", "").asString() == userId || canManagePayments(roles);
}

bool PaymentService::canManagePayments(const Json::Value &roles) const
{
    return hasAnyRole(roles, {"superAdmin"});
}

bool PaymentService::verifyStripeSignature(const std::string &rawBody, const std::string &signatureHeader) const
{
    const auto secret = env("STRIPE_WEBHOOK_SECRET");
    if (secret.empty())
    {
        return env("APP_ENV", "development") == "development";
    }
    const auto timestamp = readStripeSignaturePart(signatureHeader, "t");
    const auto signature = readStripeSignaturePart(signatureHeader, "v1");
    if (timestamp.empty() || signature.empty())
    {
        return false;
    }
    const auto expected = hmacSha256Hex(secret, timestamp + "." + rawBody);
    return expected == signature;
}

bool PaymentService::verifyGenericHmacSignature(const std::string &rawBody,
                                                const std::string &signatureHeader,
                                                const std::string &secret) const
{
    const auto expected = hmacSha256Hex(secret, rawBody);
    return signatureHeader == expected || signatureHeader == ("sha256=" + expected);
}

bool PaymentService::hasProcessedWebhookEvent(Json::Value &events, const std::string &eventId) const
{
    for (const auto &event : events)
    {
        if (event.get("event_id", "").asString() == eventId)
        {
            return true;
        }
    }
    return false;
}

void PaymentService::rememberWebhookEvent(Json::Value &events, const std::string &eventId, const std::string &provider) const
{
    Json::Value event(Json::objectValue);
    event["event_id"] = eventId;
    event["provider"] = provider;
    event["processed_at"] = nowIso();
    events.append(event);
    constexpr Json::ArrayIndex maxEvents = 1000;
    if (events.size() > maxEvents)
    {
        Json::Value trimmed(Json::arrayValue);
        for (Json::ArrayIndex i = events.size() - maxEvents; i < events.size(); ++i)
        {
            trimmed.append(events[i]);
        }
        events = trimmed;
    }
}

std::string PaymentService::normalizeProvider(const std::string &provider)
{
    std::string value = provider;
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    if (value == "stripe" || value == "wechat" || value == "alipay")
    {
        return value;
    }
    return "stripe";
}

std::string PaymentService::normalizePlan(const std::string &plan)
{
    if (plan == "ultra")
    {
        return "ultra";
    }
    if (plan == "free")
    {
        return "free";
    }
    return "pro";
}

std::string PaymentService::normalizeCurrency(const std::string &currency)
{
    std::string value = currency;
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    return value == "usd" ? "usd" : "cny";
}

int PaymentService::normalizeDays(int days)
{
    if (days >= 300)
    {
        return 365;
    }
    if (days >= 60)
    {
        return 90;
    }
    return 30;
}

int PaymentService::priceCents(const std::string &plan, int days, const std::string &currency)
{
    if (currency == "usd")
    {
        if (plan == "ultra")
        {
            return days == 365 ? 4999 : (days == 90 ? 1799 : 699);
        }
        return days == 365 ? 2999 : (days == 90 ? 999 : 399);
    }
    if (plan == "ultra")
    {
        return days == 365 ? 29900 : (days == 90 ? 9900 : 3900);
    }
    return days == 365 ? 15900 : (days == 90 ? 4900 : 1900);
}

std::string PaymentService::makeId(const std::string &prefix)
{
    static std::mt19937_64 rng{std::random_device{}()};
    std::ostringstream out;
    out << prefix << "_" << std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count()
        << "_" << std::hex << rng();
    return out.str();
}

std::string PaymentService::nowIso()
{
    return common::nowIso8601();
}

std::string PaymentService::nextExpiryDate(const std::string &currentExpiresAt, int days)
{
    const auto today = parseDate(common::nowIso8601().substr(0, 10)).value();
    auto base = today;
    if (const auto current = parseDate(currentExpiresAt); current.has_value() && *current > today)
    {
        base = *current;
    }
    return formatDate(base + std::chrono::days{days});
}

std::string PaymentService::env(const char *name, const std::string &fallback)
{
    const char *value = std::getenv(name);
    if (!value || std::string(value).empty())
    {
        return fallback;
    }
    return value;
}

std::string PaymentService::urlEncode(const std::string &value)
{
    return drogon::utils::urlEncode(value);
}

Json::Value PaymentService::parseJsonOrNull(const std::string &raw)
{
    if (raw.empty())
    {
        return Json::Value(Json::objectValue);
    }
    Json::CharReaderBuilder builder;
    builder["collectComments"] = false;
    std::string error;
    Json::Value value;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    if (!reader->parse(raw.data(), raw.data() + raw.size(), &value, &error))
    {
        return Json::Value(Json::objectValue);
    }
    return value;
}

std::string PaymentService::readStripeSignaturePart(const std::string &header, const std::string &key)
{
    const auto needle = key + "=";
    size_t start = 0;
    while (start < header.size())
    {
        const auto end = header.find(',', start);
        const auto part = header.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (part.rfind(needle, 0) == 0)
        {
            return part.substr(needle.size());
        }
        if (end == std::string::npos)
        {
            break;
        }
        start = end + 1;
    }
    return "";
}

std::string PaymentService::hmacSha256Hex(const std::string &secret, const std::string &payload)
{
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int len = 0;
    HMAC(
        EVP_sha256(),
        secret.data(),
        static_cast<int>(secret.size()),
        reinterpret_cast<const unsigned char *>(payload.data()),
        payload.size(),
        digest,
        &len);
    std::ostringstream out;
    for (unsigned int i = 0; i < len; ++i)
    {
        out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[i]);
    }
    return out.str();
}

std::string PaymentService::sha256Hex(const std::string &payload)
{
    unsigned char digest[SHA256_DIGEST_LENGTH]{};
    SHA256(reinterpret_cast<const unsigned char *>(payload.data()), payload.size(), digest);
    std::ostringstream out;
    for (unsigned char byte : digest)
    {
        out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
    }
    return out.str();
}

std::string PaymentService::readTextFile(const std::string &path)
{
    if (path.empty())
    {
        return "";
    }
    std::ifstream input(path, std::ios::binary);
    if (!input)
    {
        return "";
    }
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

std::string PaymentService::base64Encode(const unsigned char *data, size_t len)
{
    BIO *bio = BIO_new(BIO_s_mem());
    BIO *b64 = BIO_new(BIO_f_base64());
    if (!bio || !b64)
    {
        if (bio) BIO_free(bio);
        if (b64) BIO_free(b64);
        return "";
    }
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_push(b64, bio);
    BIO_write(bio, data, static_cast<int>(len));
    BIO_flush(bio);
    BUF_MEM *buffer = nullptr;
    BIO_get_mem_ptr(bio, &buffer);
    std::string out = buffer ? std::string(buffer->data, buffer->length) : "";
    BIO_free_all(bio);
    return out;
}

std::string PaymentService::rsaSha256Base64(const std::string &privateKeyPem, const std::string &payload)
{
    if (privateKeyPem.empty())
    {
        return "";
    }
    BIO *bio = BIO_new_mem_buf(privateKeyPem.data(), static_cast<int>(privateKeyPem.size()));
    if (!bio)
    {
        return "";
    }
    EVP_PKEY *key = PEM_read_bio_PrivateKey(bio, nullptr, nullptr, nullptr);
    BIO_free(bio);
    if (!key)
    {
        return "";
    }
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (!ctx)
    {
        EVP_PKEY_free(key);
        return "";
    }
    std::string signature;
    if (EVP_DigestSignInit(ctx, nullptr, EVP_sha256(), nullptr, key) == 1 &&
        EVP_DigestSignUpdate(ctx, payload.data(), payload.size()) == 1)
    {
        size_t sigLen = 0;
        if (EVP_DigestSignFinal(ctx, nullptr, &sigLen) == 1)
        {
            std::string bytes(sigLen, '\0');
            if (EVP_DigestSignFinal(ctx, reinterpret_cast<unsigned char *>(bytes.data()), &sigLen) == 1)
            {
                signature = base64Encode(reinterpret_cast<const unsigned char *>(bytes.data()), sigLen);
            }
        }
    }
    EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(key);
    return signature;
}

std::string PaymentService::alipayTimestamp()
{
    const auto now = std::chrono::system_clock::now();
    const std::time_t tt = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &tt);
#else
    localtime_r(&tt, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
    return buf;
}

std::string PaymentService::buildAlipayPagePayUrl(const Json::Value &order)
{
    const auto appId = env("ALIPAY_APP_ID");
    const auto privateKey = readTextFile(env("ALIPAY_PRIVATE_KEY_PATH"));
    if (appId.empty() || privateKey.empty())
    {
        return "";
    }
    const auto gateway = env("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do");
    const auto notifyUrl = env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhook/alipay";
    const auto returnUrl = env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/?payment=success&order_id=" + order.get("id", "").asString();
    std::ostringstream biz;
    biz << "{\"out_trade_no\":\"" << order.get("id", "").asString()
        << "\",\"product_code\":\"FAST_INSTANT_TRADE_PAY\""
        << ",\"total_amount\":\"" << std::fixed << std::setprecision(2) << order.get("amount_cents", 0).asInt() / 100.0
        << "\",\"subject\":\"" << order.get("description", "Exam Online subscription").asString() << "\"}";

    std::vector<std::pair<std::string, std::string>> params{
        {"app_id", appId},
        {"biz_content", biz.str()},
        {"charset", "utf-8"},
        {"format", "JSON"},
        {"method", "alipay.trade.page.pay"},
        {"notify_url", notifyUrl},
        {"return_url", returnUrl},
        {"sign_type", "RSA2"},
        {"timestamp", alipayTimestamp()},
        {"version", "1.0"}};
    std::sort(params.begin(), params.end());
    std::ostringstream canonical;
    for (size_t i = 0; i < params.size(); ++i)
    {
        if (i > 0) canonical << '&';
        canonical << params[i].first << '=' << params[i].second;
    }
    const auto signature = rsaSha256Base64(privateKey, canonical.str());
    if (signature.empty())
    {
        return "";
    }
    std::ostringstream url;
    url << gateway << '?';
    for (size_t i = 0; i < params.size(); ++i)
    {
        if (i > 0) url << '&';
        url << params[i].first << '=' << urlEncode(params[i].second);
    }
    url << "&sign=" << urlEncode(signature);
    return url.str();
}

std::string PaymentService::buildWechatAuthorization(const std::string &method,
                                                     const std::string &urlPath,
                                                     const std::string &body)
{
    const auto mchId = env("WECHAT_PAY_MCH_ID");
    const auto serialNo = env("WECHAT_PAY_CERT_SERIAL_NO");
    const auto privateKey = readTextFile(env("WECHAT_PAY_PRIVATE_KEY_PATH"));
    if (mchId.empty() || serialNo.empty() || privateKey.empty())
    {
        return "";
    }
    const auto timestamp = std::to_string(std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
    const auto nonce = makeId("nonce");
    const auto message = method + "\n" + urlPath + "\n" + timestamp + "\n" + nonce + "\n" + body + "\n";
    const auto signature = rsaSha256Base64(privateKey, message);
    if (signature.empty())
    {
        return "";
    }
    return "WECHATPAY2-SHA256-RSA2048 mchid=\"" + mchId +
           "\",nonce_str=\"" + nonce +
           "\",signature=\"" + signature +
           "\",timestamp=\"" + timestamp +
           "\",serial_no=\"" + serialNo + "\"";
}

Json::Value PaymentService::buildWechatNativePayOrder(const Json::Value &order)
{
    Json::Value provider(Json::objectValue);
    provider["provider"] = "wechat";
    const auto appId = env("WECHAT_PAY_APP_ID");
    const auto mchId = env("WECHAT_PAY_MCH_ID");
    const auto notifyUrl = env("WECHAT_PAY_NOTIFY_URL", env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhook/wechat");
    if (appId.empty() || mchId.empty() || env("WECHAT_PAY_CERT_SERIAL_NO").empty() || env("WECHAT_PAY_PRIVATE_KEY_PATH").empty())
    {
        provider["configured"] = false;
        provider["message"] = "WeChat Pay is not configured. Set WECHAT_PAY_APP_ID, WECHAT_PAY_MCH_ID, WECHAT_PAY_CERT_SERIAL_NO, and WECHAT_PAY_PRIVATE_KEY_PATH.";
        return provider;
    }

    Json::Value body(Json::objectValue);
    body["appid"] = appId;
    body["mchid"] = mchId;
    body["description"] = order.get("description", "Exam Online subscription").asString();
    body["out_trade_no"] = order.get("id", "").asString();
    body["notify_url"] = notifyUrl;
    body["amount"]["total"] = order.get("amount_cents", 0).asInt();
    body["amount"]["currency"] = "CNY";
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    const auto rawBody = Json::writeString(writer, body);
    const auto path = "/v3/pay/transactions/native";
    const auto authorization = buildWechatAuthorization("POST", path, rawBody);
    if (authorization.empty())
    {
        provider["configured"] = true;
        provider["error"] = "WeChat Pay signing failed";
        return provider;
    }

    auto client = drogon::HttpClient::newHttpClient(env("WECHAT_PAY_API_BASE_URL", "https://api.mch.weixin.qq.com"));
    auto request = drogon::HttpRequest::newHttpRequest();
    request->setMethod(drogon::Post);
    request->setPath(path);
    request->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    request->addHeader("Authorization", authorization);
    request->addHeader("Accept", "application/json");
    request->setBody(rawBody);
    const auto [result, response] = client->sendRequest(request);
    provider["configured"] = true;
    provider["method"] = "native";
    if (result != drogon::ReqResult::Ok || !response)
    {
        provider["error"] = "WeChat Pay request failed";
        return provider;
    }
    const auto payload = parseJsonOrNull(std::string(response->body()));
    if (response->statusCode() < drogon::k200OK || response->statusCode() >= drogon::k300MultipleChoices)
    {
        provider["error"] = payload.get("message", "WeChat Pay order creation failed").asString();
        return provider;
    }
    provider["payment_url"] = payload.get("code_url", "").asString();
    provider["code_url"] = payload.get("code_url", "").asString();
    return provider;
}
}  // namespace application::services
