#include "PaymentService.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <fstream>
#include <functional>
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

Json::Value defaultPricingConfig()
{
    Json::Value config(Json::objectValue);
    config["version"] = 1;
    config["default_currency"] = "cny";
    config["default_provider"] = "wechat";
    config["durations"] = Json::arrayValue;
    config["durations"].append(30);
    config["durations"].append(90);
    config["durations"].append(365);
    config["providers"] = Json::arrayValue;
    config["providers"].append("wechat");
    config["providers"].append("alipay");
    config["providers"].append("stripe");

    Json::Value cny(Json::objectValue);
    cny["pro"]["30"] = 1290;
    cny["pro"]["90"] = 3870;
    cny["pro"]["365"] = 15480;
    cny["ultra"]["30"] = 3900;
    cny["ultra"]["90"] = 9900;
    cny["ultra"]["365"] = 29900;

    Json::Value usd(Json::objectValue);
    usd["pro"]["30"] = 399;
    usd["pro"]["90"] = 999;
    usd["pro"]["365"] = 2999;
    usd["ultra"]["30"] = 699;
    usd["ultra"]["90"] = 1799;
    usd["ultra"]["365"] = 4999;

    config["prices_cents"]["cny"] = cny;
    config["prices_cents"]["usd"] = usd;
    config["updated_at"] = "";
    return config;
}

int readPriceCents(const Json::Value &pricing,
                   const std::string &currency,
                   const std::string &plan,
                   int days)
{
    const auto key = std::to_string(days);
    const auto amount = pricing["prices_cents"][currency][plan].get(key, 0).asInt();
    return amount > 0 ? amount : 0;
}

int normalizePriceCents(const Json::Value &value, int fallback)
{
    if (!value.isInt() && !value.isUInt() && !value.isDouble())
    {
        return fallback;
    }
    const int amount = value.asInt();
    if (amount < 0)
    {
        return fallback;
    }
    if (amount > 99999999)
    {
        return 99999999;
    }
    return amount;
}

Json::Value normalizePricingConfig(const Json::Value &payload)
{
    auto config = defaultPricingConfig();
    const auto source = payload.isObject() && payload.isMember("prices_cents") ? payload : Json::Value(Json::objectValue);
    for (const auto &currency : {"cny", "usd"})
    {
        for (const auto &plan : {"pro", "ultra"})
        {
            for (const auto days : {30, 90, 365})
            {
                const auto key = std::to_string(days);
                config["prices_cents"][currency][plan][key] = normalizePriceCents(
                    source["prices_cents"][currency][plan][key],
                    config["prices_cents"][currency][plan][key].asInt());
            }
        }
    }

    const auto defaultProvider = payload.get("default_provider", config["default_provider"].asString()).asString();
    config["default_provider"] = (defaultProvider == "alipay" || defaultProvider == "stripe") ? defaultProvider : "wechat";
    config["updated_at"] = common::nowIso8601();
    return config;
}

Json::Value paginateRecords(const Json::Value &records, const Json::Value &filters)
{
    const auto status = filters.get("status", "").asString();
    const auto provider = filters.get("provider", "").asString();
    const auto scopeType = filters.get("scope_type", "").asString();
    const auto userId = filters.get("user_id", "").asString();
    const auto orderId = filters.get("order_id", "").asString();
    const auto query = filters.get("q", "").asString();
    const auto sortField = filters.get("sort", "created_at").asString();
    const bool ascending = filters.get("order", "desc").asString() == "asc";
    const int page = std::max(1, filters.get("page", 1).asInt());
    const int pageSize = std::clamp(filters.get("page_size", 20).asInt(), 1, 100);
    Json::Value matches(Json::arrayValue);
    for (const auto &record : records)
    {
        if (!status.empty() && record.get("status", "").asString() != status) continue;
        if (!provider.empty() && record.get("provider", "").asString() != provider) continue;
        if (!scopeType.empty() && record.get("scope_type", "user").asString() != scopeType) continue;
        if (!userId.empty() && record.get("user_id", "").asString() != userId) continue;
        if (!orderId.empty() && record.get("order_id", record.get("id", "")).asString() != orderId) continue;
        if (!query.empty())
        {
            Json::StreamWriterBuilder writer;
            writer["indentation"] = "";
            if (Json::writeString(writer, record).find(query) == std::string::npos) continue;
        }
        matches.append(record);
    }
    std::vector<Json::Value> sorted;
    sorted.reserve(matches.size());
    for (const auto &record : matches) sorted.push_back(record);
    const auto fieldValue = [&](const Json::Value &record) {
        if (sortField == "status") return record.get("status", "").asString();
        return record.get("created_at", record.get("updated_at", "")).asString();
    };
    std::stable_sort(sorted.begin(), sorted.end(), [&](const Json::Value &left, const Json::Value &right) {
        if (sortField == "amount")
        {
            const auto a = left.get("amount_cents", 0).asInt64(), b = right.get("amount_cents", 0).asInt64();
            return ascending ? a < b : a > b;
        }
        const auto a = fieldValue(left), b = fieldValue(right);
        return ascending ? a < b : a > b;
    });
    Json::Value items(Json::arrayValue);
    const int total = static_cast<int>(sorted.size());
    const int begin = (page - 1) * pageSize;
    for (int offset = 0; offset < pageSize && begin + offset < total; ++offset)
    {
        items.append(sorted[static_cast<std::size_t>(begin + offset)]);
    }
    Json::Value out(Json::objectValue);
    out["items"] = items;
    out["total"] = total;
    out["page"] = page;
    out["page_size"] = pageSize;
    out["pages"] = total == 0 ? 0 : (total + pageSize - 1) / pageSize;
    return out;
}

bool isSuccessfulRefundStatus(const std::string &status)
{
    return status == "succeeded" || status == "success" || status == "SUCCESS";
}
}  // namespace

PaymentService::PaymentService(std::filesystem::path userRootDir,
                               SubscriptionService &subscriptionService)
    : paymentsDir_(std::move(userRootDir) / "payments"),
      ordersFile_(paymentsDir_ / "orders.json"),
      ledgerFile_(paymentsDir_ / "ledger.json"),
      refundsFile_(paymentsDir_ / "refunds.json"),
      webhookEventsFile_(paymentsDir_ / "webhook_events.json"),
      pricingFile_(paymentsDir_ / "pricing.json"),
      sqliteStore_(paymentsDir_ / "payments.sqlite3"),
      subscriptionService_(subscriptionService)
{
    std::filesystem::create_directories(paymentsDir_);
    if (sqliteStore_.count("payment_orders") == 0 && std::filesystem::exists(ordersFile_)) sqliteStore_.replace("payment_orders", infrastructure::storage::readJsonFile(ordersFile_));
    if (sqliteStore_.count("payment_refunds") == 0 && std::filesystem::exists(refundsFile_)) sqliteStore_.replace("payment_refunds", infrastructure::storage::readJsonFile(refundsFile_));
    if (sqliteStore_.count("payment_ledger") == 0 && std::filesystem::exists(ledgerFile_)) sqliteStore_.replace("payment_ledger", infrastructure::storage::readJsonFile(ledgerFile_));
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
    const auto provider = normalizeProvider(payload.get("provider", "wechat").asString());
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
    order["scope_type"] = "user";
    order["scope_id"] = userId;
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

Json::Value PaymentService::createOrganizationOrder(const std::string &actorId,
                                                    const std::string &organizationId,
                                                    const Json::Value &payload)
{
    if (organizationId.empty())
    {
        throw common::AppException("PAYMENT_ORGANIZATION_REQUIRED", "organization_id is required", drogon::k422UnprocessableEntity);
    }
    const auto plan = normalizePlan(payload.get("plan", "pro").asString());
    if (plan == "free")
    {
        throw common::AppException("PAYMENT_PLAN_INVALID", "Paid order requires pro or ultra plan", drogon::k422UnprocessableEntity);
    }
    const auto days = normalizeDays(payload.get("days", 30).asInt());
    const auto seats = std::clamp(payload.get("seats", 1).asInt(), 1, 100000);
    const auto currency = normalizeCurrency(payload.get("currency", "cny").asString());
    const auto provider = normalizeProvider(payload.get("provider", "wechat").asString());
    const auto unitPrice = priceCents(plan, days, currency);
    if (unitPrice <= 0 || static_cast<long long>(unitPrice) * seats > 999999999LL)
    {
        throw common::AppException("PAYMENT_PRICE_INVALID", "Organization order price is invalid", drogon::k422UnprocessableEntity);
    }

    // Validate the organization before persisting or contacting a payment provider.
    subscriptionService_.subscriptionForOrganization(organizationId);
    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();
    Json::Value order(Json::objectValue);
    order["id"] = makeId("pay");
    order["user_id"] = actorId;
    order["actor_id"] = actorId;
    order["scope_type"] = "organization";
    order["scope_id"] = organizationId;
    order["organization_id"] = organizationId;
    order["provider"] = provider;
    order["status"] = "pending";
    order["plan"] = plan;
    order["days"] = days;
    order["seats"] = seats;
    order["currency"] = currency;
    order["unit_price_cents"] = unitPrice;
    order["amount_cents"] = unitPrice * seats;
    order["amount"] = order["amount_cents"].asInt() / 100.0;
    order["description"] = "机构扩席：" + plan + " 套餐 " + std::to_string(seats) + " 席 / " + std::to_string(days) + " 天";
    order["created_at"] = nowIso();
    order["updated_at"] = order["created_at"].asString();
    order["metadata"] = payload.get("metadata", Json::Value(Json::objectValue));
    order["metadata"]["organization_id"] = organizationId;
    order["provider_payload"] = buildProviderPayload(order);
    orders.append(order);
    appendLedgerEntry(ledger, actorId, order["id"].asString(), "order.created", order["amount_cents"].asInt(), currency, "创建机构扩席订单");
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

Json::Value PaymentService::listOrders(const Json::Value &filters) const
{
    std::scoped_lock lock(mutex_);
    return paginateRecords(loadOrders(), filters);
}

Json::Value PaymentService::listRefunds(const Json::Value &filters) const
{
    std::scoped_lock lock(mutex_);
    return paginateRecords(loadRefunds(), filters);
}

Json::Value PaymentService::listAllLedger(const Json::Value &filters) const
{
    std::scoped_lock lock(mutex_);
    return paginateRecords(loadLedger(), filters);
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
    const auto idempotencyKey = payload.get("idempotency_key", "").asString();
    for (const auto &existing : refunds)
    {
        if (existing.get("idempotency_key", "").asString() == idempotencyKey &&
            existing.get("requested_by", "").asString() == userId)
        {
            if (existing.get("order_id", "").asString() != orderId)
            {
                throw common::AppException(
                    "IDEMPOTENCY_KEY_REUSED",
                    "Idempotency key was already used for another refund",
                    drogon::k409Conflict);
            }
            Json::Value replay = existing;
            replay["idempotent_replay"] = true;
            return replay;
        }
    }
    const auto orderStatus = order.get("status", "").asString();
    if (orderStatus != "paid" && orderStatus != "partially_refunded")
    {
        throw common::AppException("PAYMENT_REFUND_NOT_ALLOWED", "Only paid orders can be refunded", drogon::k409Conflict);
    }

    const auto amount = payload.get("amount_cents", order.get("amount_cents", 0)).asInt();
    if (amount <= 0 || amount > order.get("amount_cents", 0).asInt())
    {
        throw common::AppException("PAYMENT_REFUND_AMOUNT_INVALID", "Refund amount is invalid", drogon::k422UnprocessableEntity);
    }
    int alreadyRefunded = 0;
    for (const auto &existing : refunds)
    {
        const auto status = existing.get("status", "").asString();
        if (existing.get("order_id", "").asString() == orderId &&
            status != "failed" && status != "rejected" && status != "cancelled")
        {
            alreadyRefunded += existing.get("amount_cents", 0).asInt();
        }
    }
    if (amount > order.get("amount_cents", 0).asInt() - alreadyRefunded)
    {
        throw common::AppException(
            "PAYMENT_REFUND_AMOUNT_EXCEEDED",
            "Refund amount exceeds the remaining refundable amount",
            drogon::k409Conflict);
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
    refund["requested_by"] = userId;
    refund["idempotency_key"] = idempotencyKey;
    refund["idempotent_replay"] = false;

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
                "&metadata[order_id]=" + urlEncode(orderId) +
                "&metadata[refund_id]=" + urlEncode(refund["id"].asString()));
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
        body["notify_url"] = env("WECHAT_PAY_REFUND_NOTIFY_URL", env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhooks/wechat");
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
    appendLedgerEntry(ledger, refund["user_id"].asString(), orderId, "refund.requested", -amount, refund["currency"].asString(), "退款申请");
    if (isSuccessfulRefundStatus(refund["status"].asString()))
    {
        settleSuccessfulRefundUnlocked(orders, refunds, ledger, refunds[refunds.size() - 1]);
        refund = refunds[refunds.size() - 1];
    }
    saveOrders(orders);
    saveRefunds(refunds);
    saveLedger(ledger);
    return refund;
}

Json::Value PaymentService::updateRefundStatus(const std::string &refundId,
                                               const std::string &status,
                                               const std::string &actorId,
                                               const Json::Value &payload)
{
    static const std::vector<std::string> allowed{
        "processing", "succeeded", "failed", "rejected", "cancelled", "requires_manual_review", "requires_provider_console"};
    if (std::find(allowed.begin(), allowed.end(), status) == allowed.end())
    {
        throw common::AppException("PAYMENT_REFUND_STATUS_INVALID", "Refund status is invalid", drogon::k422UnprocessableEntity);
    }
    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto refunds = loadRefunds();
    auto ledger = loadLedger();
    for (auto &refund : refunds)
    {
        if (refund.get("id", "").asString() != refundId) continue;
        const auto previous = refund.get("status", "requested").asString();
        if (previous == status) return refund;
        if (isSuccessfulRefundStatus(previous) || previous == "rejected" || previous == "cancelled")
        {
            throw common::AppException("PAYMENT_REFUND_STATUS_FINAL", "Refund is already in a final state", drogon::k409Conflict);
        }
        refund["status"] = status;
        refund["updated_at"] = nowIso();
        refund["processed_by"] = actorId;
        refund["processing_note"] = payload.get("note", "").asString();
        if (status == "succeeded")
        {
            settleSuccessfulRefundUnlocked(orders, refunds, ledger, refund);
        }
        else
        {
            appendLedgerEntry(ledger, refund.get("user_id", "").asString(), refund.get("order_id", "").asString(),
                              "refund." + status, 0, refund.get("currency", "cny").asString(), "退款状态更新");
        }
        saveOrders(orders);
        saveRefunds(refunds);
        saveLedger(ledger);
        return refund;
    }
    throw common::AppException("PAYMENT_REFUND_NOT_FOUND", "Refund not found", drogon::k404NotFound);
}

Json::Value PaymentService::reconciliation() const
{
    std::scoped_lock lock(mutex_);
    const auto orders = loadOrders();
    const auto refunds = loadRefunds();
    const auto ledger = loadLedger();
    Json::Value anomalies(Json::arrayValue);
    auto add = [&](const std::string &type, const std::string &severity, const std::string &orderId,
                   const std::string &refundId, const std::string &summary) {
        Json::Value item(Json::objectValue);
        item["id"] = type + ":" + (!refundId.empty() ? refundId : orderId);
        item["type"] = type;
        item["severity"] = severity;
        item["order_id"] = orderId;
        item["refund_id"] = refundId;
        item["summary"] = summary;
        anomalies.append(item);
    };
    for (const auto &order : orders)
    {
        const auto orderId = order.get("id", "").asString();
        bool paymentEntry = false;
        bool grantEntry = false;
        for (const auto &entry : ledger)
        {
            if (entry.get("order_id", "").asString() != orderId) continue;
            paymentEntry = paymentEntry || entry.get("type", "").asString() == "payment.succeeded";
            grantEntry = grantEntry || entry.get("type", "").asString() == "subscription.granted";
        }
        if (order.get("status", "").asString() == "paid" && !paymentEntry)
            add("paid_without_payment_ledger", "high", orderId, "", "订单已支付，但缺少支付成功流水");
        if (order.get("status", "").asString() == "paid" && (!grantEntry || !order.isMember("subscription")))
            add("paid_without_entitlement", "high", orderId, "", "订单已支付，但权益发放记录不完整");
        if (order.get("status", "").asString() == "pending" && order.get("provider_payment_id", "").asString().size() > 0)
            add("pending_with_provider_payment", "medium", orderId, "", "订单仍待支付，但已存在渠道支付号");
    }
    for (const auto &refund : refunds)
    {
        if (!isSuccessfulRefundStatus(refund.get("status", "").asString())) continue;
        bool successEntry = false;
        for (const auto &entry : ledger)
        {
            if (entry.get("order_id", "").asString() == refund.get("order_id", "").asString() &&
                entry.get("type", "").asString() == "refund.succeeded") successEntry = true;
        }
        if (!successEntry)
            add("refund_without_ledger", "high", refund.get("order_id", "").asString(), refund.get("id", "").asString(), "退款成功但缺少成功流水");
        if (refund.get("entitlement_reversal_status", "").asString() == "manual_required")
            add("entitlement_reversal_required", "high", refund.get("order_id", "").asString(), refund.get("id", "").asString(), "退款已完成，权益需要人工核对或回收");
    }
    for (const auto &entry : ledger)
    {
        const auto orderId = entry.get("order_id", "").asString();
        if (orderId.empty()) continue;
        bool found = false;
        for (const auto &order : orders) if (order.get("id", "").asString() == orderId) { found = true; break; }
        if (!found) add("orphan_ledger", "medium", orderId, "", "流水关联的订单不存在");
    }
    Json::Value out(Json::objectValue);
    out["items"] = anomalies;
    out["total"] = anomalies.size();
    out["generated_at"] = nowIso();
    return out;
}

Json::Value PaymentService::getPricingConfig() const
{
    std::scoped_lock lock(mutex_);
    const auto pricing = loadPricingConfig();
    if (!std::filesystem::exists(pricingFile_))
    {
        savePricingConfig(pricing);
    }
    return pricing;
}

Json::Value PaymentService::updatePricingConfig(const Json::Value &payload)
{
    std::scoped_lock lock(mutex_);
    const auto pricing = normalizePricingConfig(payload);
    savePricingConfig(pricing);
    return pricing;
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
    auto refunds = loadRefunds();
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
    bool refundEvent = false;
    if (normalizedProvider == "stripe")
    {
        const auto type = payload.get("type", "").asString();
        refundEvent = type.find("refund") != std::string::npos;
        if (refundEvent)
        {
            if (!eventId.empty() && hasProcessedWebhookEvent(webhookEvents, eventId))
            {
                Json::Value duplicate(Json::objectValue);
                duplicate["ignored"] = true;
                duplicate["duplicate"] = true;
                duplicate["event_id"] = eventId;
                return duplicate;
            }
            const auto result = updateRefundFromWebhookUnlocked(orders, refunds, ledger, normalizedProvider, payload, eventId);
            if (!eventId.empty()) rememberWebhookEvent(webhookEvents, eventId, normalizedProvider);
            saveOrders(orders);
            saveRefunds(refunds);
            saveLedger(ledger);
            infrastructure::storage::writeJsonFileAtomic(webhookEventsFile_, webhookEvents);
            return result;
        }
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
        refundEvent = payload.isMember("refund_id") || payload.isMember("out_refund_no") ||
                      payload.get("event_type", "").asString().find("refund") != std::string::npos;
        if (refundEvent)
        {
            eventId = payload.get("event_id", normalizedProvider + ":refund:" + payload.get("refund_id", payload.get("out_refund_no", "")).asString()).asString();
            if (!eventId.empty() && hasProcessedWebhookEvent(webhookEvents, eventId))
            {
                Json::Value duplicate(Json::objectValue);
                duplicate["ignored"] = true;
                duplicate["duplicate"] = true;
                duplicate["event_id"] = eventId;
                return duplicate;
            }
            const auto result = updateRefundFromWebhookUnlocked(orders, refunds, ledger, normalizedProvider, payload, eventId);
            if (!eventId.empty()) rememberWebhookEvent(webhookEvents, eventId, normalizedProvider);
            saveOrders(orders);
            saveRefunds(refunds);
            saveLedger(ledger);
            infrastructure::storage::writeJsonFileAtomic(webhookEventsFile_, webhookEvents);
            return result;
        }
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
    return sqliteStore_.list("payment_orders");
}

Json::Value PaymentService::loadLedger() const
{
    return sqliteStore_.list("payment_ledger");
}

Json::Value PaymentService::loadRefunds() const
{
    return sqliteStore_.list("payment_refunds");
}

Json::Value PaymentService::loadPricingConfig() const
{
    if (!std::filesystem::exists(pricingFile_))
    {
        return defaultPricingConfig();
    }
    auto data = infrastructure::storage::readJsonFile(pricingFile_);
    return data.isObject() ? normalizePricingConfig(data) : defaultPricingConfig();
}

void PaymentService::saveOrders(const Json::Value &orders) const
{
    sqliteStore_.replace("payment_orders", orders);
}

void PaymentService::saveLedger(const Json::Value &ledger) const
{
    sqliteStore_.replace("payment_ledger", ledger);
}

void PaymentService::saveRefunds(const Json::Value &refunds) const
{
    sqliteStore_.replace("payment_refunds", refunds);
}

void PaymentService::savePricingConfig(const Json::Value &pricing) const
{
    infrastructure::storage::writeJsonFileAtomic(pricingFile_, pricing);
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
    const auto providerName = order.get("provider", "wechat").asString();
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
        const auto currentStatus = order.get("status", "").asString();
        if (currentStatus == "paid" || currentStatus == "refunded" || currentStatus == "partially_refunded")
        {
            return order;
        }
        order["status"] = "paid";
        order["paid_at"] = nowIso();
        order["updated_at"] = order["paid_at"].asString();
        order["provider_payment_id"] = providerPaymentId;
        order["provider_payment_intent"] = providerPaymentId;
        order["provider_event"] = providerEvent;
        order["previous_subscription"] = currentEntitlementForOrder(order);
        order["subscription"] = grantEntitlementForOrder(order);
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

Json::Value PaymentService::updateRefundFromWebhookUnlocked(Json::Value &orders,
                                                            Json::Value &refunds,
                                                            Json::Value &ledger,
                                                            const std::string &provider,
                                                            const Json::Value &payload,
                                                            const std::string &eventId)
{
    const auto object = provider == "stripe" ? payload["data"]["object"] : payload;
    const auto externalId = object.get("id", object.get("refund_id", object.get("provider_refund_id", ""))).asString();
    const auto localId = object["metadata"].get("refund_id", object.get("out_refund_no", object.get("refund_id", ""))).asString();
    auto providerStatus = object.get("status", object.get("refund_status", "")).asString();
    std::string status = "processing";
    if (providerStatus == "succeeded" || providerStatus == "success" || providerStatus == "SUCCESS") status = "succeeded";
    else if (providerStatus == "failed" || providerStatus == "FAILED" || providerStatus == "CLOSED" || providerStatus == "ABNORMAL") status = "failed";

    for (auto &refund : refunds)
    {
        if ((!localId.empty() && refund.get("id", "").asString() == localId) ||
            (!externalId.empty() && refund.get("provider_reference", "").asString() == externalId))
        {
            const auto previous = refund.get("status", "requested").asString();
            refund["status"] = status;
            refund["provider_status"] = providerStatus;
            refund["provider_event"] = payload;
            refund["provider_event_id"] = eventId;
            refund["updated_at"] = nowIso();
            if (refund.get("provider_reference", "").asString().empty()) refund["provider_reference"] = externalId;
            if (status == "succeeded" && !isSuccessfulRefundStatus(previous))
                settleSuccessfulRefundUnlocked(orders, refunds, ledger, refund);
            else if (status != previous)
                appendLedgerEntry(ledger, refund.get("user_id", "").asString(), refund.get("order_id", "").asString(),
                                  "refund." + status, 0, refund.get("currency", "cny").asString(), "退款渠道回调");
            return refund;
        }
    }
    throw common::AppException("PAYMENT_REFUND_NOT_FOUND", "Webhook refund was not found", drogon::k404NotFound);
}

void PaymentService::settleSuccessfulRefundUnlocked(Json::Value &orders,
                                                    Json::Value &refunds,
                                                    Json::Value &ledger,
                                                    Json::Value &refund)
{
    const auto orderId = refund.get("order_id", "").asString();
    for (auto &order : orders)
    {
        if (order.get("id", "").asString() != orderId) continue;
        int succeededAmount = 0;
        for (const auto &item : refunds)
            if (item.get("order_id", "").asString() == orderId && isSuccessfulRefundStatus(item.get("status", "").asString()))
                succeededAmount += item.get("amount_cents", 0).asInt();
        const bool fullyRefunded = succeededAmount >= order.get("amount_cents", 0).asInt();
        order["status"] = fullyRefunded ? "refunded" : "partially_refunded";
        order["refunded_amount_cents"] = succeededAmount;
        order["updated_at"] = nowIso();
        refund["status"] = "succeeded";
        refund["updated_at"] = nowIso();
        if (fullyRefunded && order.isMember("previous_subscription") && order["previous_subscription"].isObject())
        {
            refund["entitlement_reversal"] = restoreEntitlementForOrder(order, order["previous_subscription"]);
            refund["entitlement_reversal_status"] = "succeeded";
            appendLedgerEntry(ledger, refund.get("user_id", "").asString(), orderId, "subscription.reversed", 0,
                              refund.get("currency", "cny").asString(), "退款后权益已回收");
        }
        else
        {
            refund["entitlement_reversal_status"] = "manual_required";
        }
        appendLedgerEntry(ledger, refund.get("user_id", "").asString(), orderId, "refund.succeeded",
                          -refund.get("amount_cents", 0).asInt(), refund.get("currency", "cny").asString(), "退款成功");
        return;
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

Json::Value PaymentService::currentEntitlementForOrder(const Json::Value &order) const
{
    if (order.get("scope_type", "user").asString() == "organization")
        return subscriptionService_.subscriptionForOrganization(order.get("scope_id", order.get("organization_id", "")).asString());
    return subscriptionService_.subscriptionForUser(order.get("scope_id", order.get("user_id", "")).asString());
}

Json::Value PaymentService::grantEntitlementForOrder(const Json::Value &order)
{
    const auto current = currentEntitlementForOrder(order);
    Json::Value patch(Json::objectValue);
    patch["plan"] = order.get("plan", "pro").asString();
    patch["status"] = "active";
    patch["expires_at"] = nextExpiryDate(current.get("expires_at", "").asString(), order.get("days", 30).asInt());
    if (order.get("scope_type", "user").asString() == "organization")
    {
        patch["seats"] = order.get("seats", current.get("seats", 1)).asInt();
        return subscriptionService_.updateOrganizationSubscription(order.get("scope_id", order.get("organization_id", "")).asString(), patch);
    }
    return subscriptionService_.updateUserSubscription(order.get("scope_id", order.get("user_id", "")).asString(), patch);
}

Json::Value PaymentService::restoreEntitlementForOrder(const Json::Value &order, const Json::Value &snapshot)
{
    Json::Value patch(Json::objectValue);
    patch["plan"] = snapshot.get("plan", "free").asString();
    patch["status"] = snapshot.get("status", "active").asString();
    patch["expires_at"] = snapshot.get("expires_at", "").asString();
    if (order.get("scope_type", "user").asString() == "organization")
    {
        patch["seats"] = snapshot.get("seats", 1).asInt();
        return subscriptionService_.updateOrganizationSubscription(order.get("scope_id", order.get("organization_id", "")).asString(), patch);
    }
    return subscriptionService_.updateUserSubscription(order.get("scope_id", order.get("user_id", "")).asString(), patch);
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
    return "wechat";
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

int PaymentService::priceCents(const std::string &plan, int days, const std::string &currency) const
{
    const auto pricing = loadPricingConfig();
    const auto configured = readPriceCents(pricing, currency, plan, days);
    if (configured > 0)
    {
        return configured;
    }
    const auto fallback = defaultPricingConfig();
    return readPriceCents(fallback, currency, plan, days);
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
    const auto notifyUrl = env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhooks/alipay";
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
    const auto notifyUrl = env("WECHAT_PAY_NOTIFY_URL", env("PUBLIC_WEB_BASE_URL", "http://127.0.0.1:8000") + "/api/v1/payments/webhooks/wechat");
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
