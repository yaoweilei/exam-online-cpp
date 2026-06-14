#include "PaymentService.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <iomanip>
#include <memory>
#include <optional>
#include <random>
#include <sstream>

#include <drogon/HttpClient.h>
#include <drogon/utils/Utilities.h>
#include <openssl/hmac.h>

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

    std::string orderId;
    std::string providerPaymentId;
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
    }
    else
    {
        const auto secret = env("PAYMENT_GENERIC_WEBHOOK_SECRET");
        if (secret.empty() || payload.get("secret", "").asString() != secret)
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
    }

    if (orderId.empty())
    {
        throw common::AppException("PAYMENT_WEBHOOK_ORDER_MISSING", "Webhook did not include order id", drogon::k422UnprocessableEntity);
    }
    const auto paidOrder = markOrderPaidUnlocked(orders, ledger, orderId, providerPaymentId, payload);
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
        provider["configured"] = false;
        provider["message"] = "WeChat Pay requires merchant id, API v3 key, private key/certificate serial, and platform certificate verification before live order creation.";
        return provider;
    }
    if (providerName == "alipay")
    {
        provider["configured"] = false;
        provider["message"] = "Alipay requires app id, merchant private key, Alipay public key, gateway, and RSA2 signing before live order creation.";
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
    return hasAnyRole(roles, {"systemAdmin", "superAdmin"});
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
}  // namespace application::services
