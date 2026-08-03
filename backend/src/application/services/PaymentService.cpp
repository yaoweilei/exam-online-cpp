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
#include <set>
#include <sstream>

#include <drogon/HttpClient.h>
#include <drogon/utils/Utilities.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/pem.h>
#include <openssl/sha.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "application/services/NotificationService.h"
#include "infrastructure/storage/JsonIo.h"
#include "infrastructure/storage/UserRepository.h"

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

std::string isoAfterMinutes(int minutes)
{
    const auto target = std::chrono::system_clock::now() + std::chrono::minutes{minutes};
    const auto timeValue = std::chrono::system_clock::to_time_t(target);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &timeValue);
#else
    gmtime_r(&timeValue, &tm);
#endif
    std::ostringstream out;
    out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S") << ".000Z";
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

std::string runtimeEnvironmentValue(const char *name, const std::string &fallback = "")
{
    const char *value = std::getenv(name);
    return value && *value ? std::string(value) : fallback;
}

bool isProductionPaymentPolicyEnabled()
{
    const auto appEnv = runtimeEnvironmentValue("APP_ENV", "development");
    return appEnv != "development" && appEnv != "dev" && appEnv != "local";
}

std::string primaryPaymentProvider()
{
    return runtimeEnvironmentValue("PAYMENT_PRIMARY_PROVIDER", "stripe");
}

void applyPaymentProviderPolicy(Json::Value &config)
{
    if (!isProductionPaymentPolicyEnabled()) return;
    const auto provider = primaryPaymentProvider();
    config["default_provider"] = provider;
    config["providers"] = Json::arrayValue;
    config["providers"].append(provider);
}

void requirePaymentProviderEnabled(const std::string &provider)
{
    if (isProductionPaymentPolicyEnabled() && provider != primaryPaymentProvider())
    {
        throw common::AppException(
            "PAYMENT_PROVIDER_DISABLED",
            "The selected payment provider is not enabled in this environment",
            drogon::k422UnprocessableEntity);
    }
}

Json::Value defaultPricingConfig()
{
    Json::Value config(Json::objectValue);
    config["version"] = 4;
    config["default_currency"] = "cny";
    config["default_provider"] = "wechat";
    config["providers"] = Json::arrayValue;
    config["providers"].append("wechat");
    config["providers"].append("alipay");
    config["providers"].append("stripe");
    config["renewal"]["reminder_days"].append(7);
    config["renewal"]["reminder_days"].append(3);
    config["renewal"]["reminder_days"].append(1);
    config["renewal"]["price_change_notice_days"] = 7;
    config["renewal"]["grace_period_days"] = 7;

    auto &personal = config["catalogs"]["personal"];
    personal["durations"].append(30);
    personal["durations"].append(90);
    personal["durations"].append(365);
    personal["recommended_plan"] = "pro";
    personal["recommended_duration_days"] = 365;
    personal["prices_cents"]["cny"]["pro"]["30"] = 1900;
    personal["prices_cents"]["cny"]["pro"]["90"] = 4900;
    personal["prices_cents"]["cny"]["pro"]["365"] = 15900;
    personal["prices_cents"]["cny"]["ultra"]["30"] = 3900;
    personal["prices_cents"]["cny"]["ultra"]["90"] = 9900;
    personal["prices_cents"]["cny"]["ultra"]["365"] = 29900;
    personal["prices_cents"]["usd"]["pro"]["30"] = 399;
    personal["prices_cents"]["usd"]["pro"]["90"] = 999;
    personal["prices_cents"]["usd"]["pro"]["365"] = 2999;
    personal["prices_cents"]["usd"]["ultra"]["30"] = 699;
    personal["prices_cents"]["usd"]["ultra"]["90"] = 1799;
    personal["prices_cents"]["usd"]["ultra"]["365"] = 4999;
    const auto appendOffer = [](Json::Value &catalog,
                                const std::string &id,
                                const std::string &label,
                                int discountPercent) {
        Json::Value offer(Json::objectValue);
        offer["id"] = id;
        offer["kind"] = id;
        offer["label"] = label;
        offer["enabled"] = false;
        offer["discount_percent"] = discountPercent;
        offer["starts_at"] = "";
        offer["ends_at"] = "";
        catalog["offers"].append(offer);
    };
    appendOffer(personal, "first_purchase", "个人首购优惠", 20);
    appendOffer(personal, "renewal", "个人续费优惠", 10);
    appendOffer(personal, "campaign", "个人限时活动", 15);

    auto &organization = config["catalogs"]["organization"];
    organization["durations"].append(30);
    organization["durations"].append(365);
    organization["recommended_plan"] = "ultra";
    organization["recommended_duration_days"] = 365;
    organization["custom_quote_min_seats"] = 200;
    organization["plans"]["pro"]["minimum_seats"] = 20;
    organization["plans"]["ultra"]["minimum_seats"] = 30;
    organization["prices_cents"]["cny"]["pro"]["30"] = 1500;
    organization["prices_cents"]["cny"]["pro"]["365"] = 11900;
    organization["prices_cents"]["cny"]["ultra"]["30"] = 2900;
    organization["prices_cents"]["cny"]["ultra"]["365"] = 22900;
    organization["prices_cents"]["usd"]["pro"]["30"] = 299;
    organization["prices_cents"]["usd"]["pro"]["365"] = 1999;
    organization["prices_cents"]["usd"]["ultra"]["30"] = 499;
    organization["prices_cents"]["usd"]["ultra"]["365"] = 3799;
    appendOffer(organization, "first_purchase", "机构首购优惠", 10);
    appendOffer(organization, "renewal", "机构续费优惠", 5);
    appendOffer(organization, "campaign", "机构限时活动", 10);

    const auto appendTier = [&](int minSeats, int maxSeats, int proYearCents, int ultraYearCents) {
        Json::Value tier(Json::objectValue);
        tier["min_seats"] = minSeats;
        tier["max_seats"] = maxSeats;
        tier["prices_cents"]["cny"]["pro"]["365"] = proYearCents;
        tier["prices_cents"]["cny"]["ultra"]["365"] = ultraYearCents;
        organization["seat_tiers"].append(tier);
    };
    appendTier(20, 29, 11900, 0);
    appendTier(30, 49, 11900, 22900);
    appendTier(50, 99, 10900, 21900);
    appendTier(100, 199, 9900, 20900);

    // v1 compatibility aliases: old clients treat the root matrix as personal pricing.
    config["durations"] = personal["durations"];
    config["prices_cents"] = personal["prices_cents"];
    config["updated_at"] = "";
    applyPaymentProviderPolicy(config);
    return config;
}

int readPriceCents(const Json::Value &pricing,
                   const std::string &scopeType,
                   const std::string &currency,
                   const std::string &plan,
                   int days,
                   int seats)
{
    const auto key = std::to_string(days);
    const auto scope = scopeType == "organization" ? "organization" : "personal";
    auto amount = pricing["catalogs"][scope]["prices_cents"][currency][plan].get(key, 0).asInt();
    if (scopeType == "organization" && days == 365)
    {
        for (const auto &tier : pricing["catalogs"]["organization"]["seat_tiers"])
        {
            const auto minSeats = tier.get("min_seats", 0).asInt();
            const auto maxSeats = tier.get("max_seats", 0).asInt();
            if (seats >= minSeats && seats <= maxSeats)
            {
                const auto tierAmount = tier["prices_cents"][currency][plan].get(key, amount).asInt();
                if (tierAmount > 0)
                {
                    amount = tierAmount;
                }
                break;
            }
        }
    }
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

std::string normalizeOfferTimestamp(const Json::Value &value)
{
    if (!value.isString())
    {
        return "";
    }
    const auto timestamp = value.asString();
    if (timestamp.empty())
    {
        return "";
    }
    if (timestamp.size() < 20 || timestamp.size() > 40 || timestamp[4] != '-' ||
        timestamp[7] != '-' || timestamp[10] != 'T' || timestamp.back() != 'Z')
    {
        return "";
    }
    return timestamp;
}

bool hasSettledOrder(const Json::Value &orders,
                     const std::string &scopeType,
                     const std::string &scopeId)
{
    for (const auto &order : orders)
    {
        const auto pricingScope = order.get(
            "pricing_scope",
            order.get("scope_type", "user").asString() == "organization" ? "organization" : "personal").asString();
        const auto orderScopeId = order.get("scope_id", order.get("user_id", "")).asString();
        const auto status = order.get("status", "").asString();
        if (pricingScope == scopeType && orderScopeId == scopeId &&
            (status == "paid" || status == "partially_refunded" || status == "refunded"))
        {
            return true;
        }
    }
    return false;
}

bool isPaidSubscriptionActive(const Json::Value &subscription)
{
    const auto plan = subscription.get("plan", "free").asString();
    const auto status = subscription.get("status", "active").asString();
    return subscription.get("is_active", false).asBool() &&
           (plan == "pro" || plan == "ultra") &&
           (status == "active" || status == "trial");
}

Json::Value buildPriceQuote(const Json::Value &pricing,
                            const Json::Value &orders,
                            const Json::Value &subscription,
                            const std::string &scopeType,
                            const std::string &scopeId,
                            const std::string &plan,
                            int days,
                            const std::string &currency,
                            int seats)
{
    const auto baseUnitPrice = readPriceCents(pricing, scopeType, currency, plan, days, seats);
    const auto now = common::nowIso8601();
    const bool firstPurchase = !hasSettledOrder(orders, scopeType, scopeId);
    const bool renewal = isPaidSubscriptionActive(subscription);
    Json::Value selectedOffer;
    int selectedDiscount = 0;
    for (const auto &offer : pricing["catalogs"][scopeType]["offers"])
    {
        if (!offer.get("enabled", false).asBool())
        {
            continue;
        }
        const auto discount = offer.get("discount_percent", 0).asInt();
        if (discount <= selectedDiscount || discount <= 0 || discount > 90)
        {
            continue;
        }
        const auto startsAt = offer.get("starts_at", "").asString();
        const auto endsAt = offer.get("ends_at", "").asString();
        if ((!startsAt.empty() && now < startsAt) || (!endsAt.empty() && now >= endsAt))
        {
            continue;
        }
        const auto kind = offer.get("kind", offer.get("id", "")).asString();
        if ((kind == "first_purchase" && !firstPurchase) ||
            (kind == "renewal" && !renewal))
        {
            continue;
        }
        if (kind != "first_purchase" && kind != "renewal" && kind != "campaign")
        {
            continue;
        }
        selectedOffer = offer;
        selectedDiscount = discount;
    }

    const auto unitPrice = baseUnitPrice <= 0
                               ? 0
                               : static_cast<int>(std::max<long long>(
                                     1,
                                     (static_cast<long long>(baseUnitPrice) * (100 - selectedDiscount) + 50) / 100));
    const auto baseAmount = static_cast<Json::Int64>(baseUnitPrice) * seats;
    const auto amount = static_cast<Json::Int64>(unitPrice) * seats;
    Json::Value quote(Json::objectValue);
    quote["scope_type"] = scopeType;
    quote["scope_id"] = scopeId;
    quote["plan"] = plan;
    quote["days"] = days;
    quote["seats"] = seats;
    quote["currency"] = currency;
    quote["base_unit_price_cents"] = baseUnitPrice;
    quote["unit_price_cents"] = unitPrice;
    quote["base_amount_cents"] = baseAmount;
    quote["amount_cents"] = amount;
    quote["discount_cents"] = baseAmount - amount;
    quote["first_purchase_eligible"] = firstPurchase;
    quote["renewal_eligible"] = renewal;
    quote["quoted_at"] = now;
    quote["offer"] = selectedOffer.isNull() ? Json::Value(Json::nullValue) : selectedOffer;
    return quote;
}

Json::Value normalizePricingConfig(const Json::Value &payload)
{
    auto config = defaultPricingConfig();
    const auto catalogs = payload.get("catalogs", Json::Value(Json::objectValue));
    const auto personalSource = catalogs["personal"].isObject()
                                    ? catalogs["personal"]
                                    : payload;
    const auto organizationSource = catalogs["organization"].isObject()
                                        ? catalogs["organization"]
                                        : Json::Value(Json::objectValue);
    for (const auto &currency : {"cny", "usd"})
    {
        for (const auto &plan : {"pro", "ultra"})
        {
            for (const auto days : {30, 90, 365})
            {
                const auto key = std::to_string(days);
                config["catalogs"]["personal"]["prices_cents"][currency][plan][key] = normalizePriceCents(
                    personalSource["prices_cents"][currency][plan][key],
                    config["catalogs"]["personal"]["prices_cents"][currency][plan][key].asInt());
            }
            for (const auto days : {30, 365})
            {
                const auto key = std::to_string(days);
                config["catalogs"]["organization"]["prices_cents"][currency][plan][key] = normalizePriceCents(
                    organizationSource["prices_cents"][currency][plan][key],
                    config["catalogs"]["organization"]["prices_cents"][currency][plan][key].asInt());
            }
        }
    }

    for (const auto &plan : {"pro", "ultra"})
    {
        const auto fallback = config["catalogs"]["organization"]["plans"][plan]["minimum_seats"].asInt();
        const auto requested = organizationSource["plans"][plan].get("minimum_seats", fallback).asInt();
        config["catalogs"]["organization"]["plans"][plan]["minimum_seats"] = std::clamp(requested, 1, 100000);
    }
    const auto customQuoteFallback = config["catalogs"]["organization"]["custom_quote_min_seats"].asInt();
    config["catalogs"]["organization"]["custom_quote_min_seats"] = std::clamp(
        organizationSource.get("custom_quote_min_seats", customQuoteFallback).asInt(), 2, 100000);

    if (organizationSource["seat_tiers"].isArray())
    {
        auto &tiers = config["catalogs"]["organization"]["seat_tiers"];
        const auto limit = std::min(tiers.size(), organizationSource["seat_tiers"].size());
        for (Json::ArrayIndex index = 0; index < limit; ++index)
        {
            const auto &sourceTier = organizationSource["seat_tiers"][index];
            for (const auto &plan : {"pro", "ultra"})
            {
                tiers[index]["prices_cents"]["cny"][plan]["365"] = normalizePriceCents(
                    sourceTier["prices_cents"]["cny"][plan]["365"],
                    tiers[index]["prices_cents"]["cny"][plan]["365"].asInt());
            }
        }
    }

    for (const auto &scope : {"personal", "organization"})
    {
        const auto &source = scope == std::string("personal") ? personalSource : organizationSource;
        const auto sourceOffers = source.get("offers", Json::Value(Json::arrayValue));
        auto &offers = config["catalogs"][scope]["offers"];
        for (Json::ArrayIndex index = 0; index < offers.size(); ++index)
        {
            const auto id = offers[index].get("id", "").asString();
            Json::Value sourceOffer;
            for (const auto &candidate : sourceOffers)
            {
                if (candidate.get("id", candidate.get("kind", "")).asString() == id)
                {
                    sourceOffer = candidate;
                    break;
                }
            }
            if (sourceOffer.isNull())
            {
                continue;
            }
            const auto startsAt = normalizeOfferTimestamp(sourceOffer["starts_at"]);
            const auto endsAt = normalizeOfferTimestamp(sourceOffer["ends_at"]);
            offers[index]["enabled"] = sourceOffer.get("enabled", false).asBool();
            offers[index]["discount_percent"] = std::clamp(
                sourceOffer.get("discount_percent", offers[index]["discount_percent"]).asInt(), 0, 90);
            offers[index]["starts_at"] = startsAt;
            offers[index]["ends_at"] = endsAt;
            if (!startsAt.empty() && !endsAt.empty() && startsAt >= endsAt)
            {
                offers[index]["enabled"] = false;
            }
        }
    }

    const auto defaultProvider = payload.get("default_provider", config["default_provider"].asString()).asString();
    config["default_provider"] = (defaultProvider == "alipay" || defaultProvider == "stripe") ? defaultProvider : "wechat";
    const auto renewalSource = payload.get("renewal", Json::Value(Json::objectValue));
    if (renewalSource["reminder_days"].isArray())
    {
        std::set<int> reminderDays;
        for (const auto &value : renewalSource["reminder_days"])
        {
            reminderDays.insert(std::clamp(value.asInt(), 1, 30));
        }
        if (!reminderDays.empty())
        {
            config["renewal"]["reminder_days"] = Json::arrayValue;
            for (auto it = reminderDays.rbegin(); it != reminderDays.rend(); ++it)
            {
                config["renewal"]["reminder_days"].append(*it);
            }
        }
    }
    config["renewal"]["price_change_notice_days"] = std::clamp(
        renewalSource.get("price_change_notice_days", config["renewal"]["price_change_notice_days"]).asInt(), 1, 30);
    config["renewal"]["grace_period_days"] = std::clamp(
        renewalSource.get("grace_period_days", config["renewal"]["grace_period_days"]).asInt(), 0, 30);
    config["durations"] = config["catalogs"]["personal"]["durations"];
    config["prices_cents"] = config["catalogs"]["personal"]["prices_cents"];
    config["updated_at"] = common::nowIso8601();
    applyPaymentProviderPolicy(config);
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
                               SubscriptionService &subscriptionService,
                               infrastructure::storage::UserRepository *userRepository,
                               EmailService *emailService)
    : paymentsDir_(std::move(userRootDir) / "payments"),
      ordersFile_(paymentsDir_ / "orders.json"),
      ledgerFile_(paymentsDir_ / "ledger.json"),
      refundsFile_(paymentsDir_ / "refunds.json"),
      webhookEventsFile_(paymentsDir_ / "webhook_events.json"),
      pricingFile_(paymentsDir_ / "pricing.json"),
      sqliteStore_(paymentsDir_ / "payments.sqlite3"),
      subscriptionService_(subscriptionService),
      userRepository_(userRepository),
      emailService_(emailService)
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
    const auto provider = normalizeProvider(payload.get(
        "provider",
        isProductionPaymentPolicyEnabled() ? primaryPaymentProvider() : std::string("wechat")).asString());
    requirePaymentProviderEnabled(provider);
    const auto subscription = subscriptionService_.subscriptionForUser(userId);
    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();
    const auto quote = buildPriceQuote(
        loadPricingConfig(), orders, subscription, "personal", userId, plan, days, currency, 1);
    const auto amountCents = quote.get("amount_cents", 0).asInt();
    if (amountCents <= 0)
    {
        throw common::AppException("PAYMENT_PRICE_INVALID", "No price configured for this plan", drogon::k422UnprocessableEntity);
    }

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
    order["base_amount_cents"] = quote.get("base_amount_cents", amountCents);
    order["discount_cents"] = quote.get("discount_cents", 0);
    order["offer"] = quote["offer"];
    order["pricing_quoted_at"] = quote.get("quoted_at", nowIso());
    order["pricing_scope"] = "personal";
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
    const auto requestedDays = payload.get("days", 30).asInt();
    if (requestedDays != 30 && requestedDays != 365)
    {
        throw common::AppException(
            "PAYMENT_DURATION_INVALID",
            "机构套餐仅支持 30 天月付或 365 天年付",
            drogon::k422UnprocessableEntity);
    }
    const auto days = requestedDays;
    const auto seats = std::clamp(payload.get("seats", 1).asInt(), 1, 100000);
    const auto currency = normalizeCurrency(payload.get("currency", "cny").asString());
    const auto provider = normalizeProvider(payload.get(
        "provider",
        isProductionPaymentPolicyEnabled() ? primaryPaymentProvider() : std::string("wechat")).asString());
    requirePaymentProviderEnabled(provider);
    const auto minimumSeats = minimumOrganizationSeats(plan);
    if (seats < minimumSeats)
    {
        throw common::AppException(
            "PAYMENT_MINIMUM_SEATS",
            plan == "ultra" ? "机构 ULTRA 最低购买 30 席" : "机构 PRO 最低购买 20 席",
            drogon::k422UnprocessableEntity);
    }
    if (seats >= customQuoteMinimumSeats())
    {
        throw common::AppException(
            "PAYMENT_CUSTOM_QUOTE_REQUIRED",
            "200 席及以上需要联系企业销售获取定制报价",
            drogon::k422UnprocessableEntity);
    }
    const auto unitPrice = priceCents("organization", plan, days, currency, seats);
    if (unitPrice <= 0 || static_cast<long long>(unitPrice) * seats > 999999999LL)
    {
        throw common::AppException("PAYMENT_PRICE_INVALID", "Organization order price is invalid", drogon::k422UnprocessableEntity);
    }

    // Validate the organization before persisting or contacting a payment provider.
    const auto subscription = subscriptionService_.subscriptionForOrganization(organizationId);
    std::unique_lock lock(mutex_);
    auto orders = loadOrders();
    auto ledger = loadLedger();
    const auto quote = buildPriceQuote(
        loadPricingConfig(), orders, subscription, "organization", organizationId, plan, days, currency, seats);
    const auto discountedUnitPrice = quote.get("unit_price_cents", 0).asInt();
    if (discountedUnitPrice <= 0 ||
        static_cast<long long>(discountedUnitPrice) * seats > 999999999LL)
    {
        throw common::AppException("PAYMENT_PRICE_INVALID", "Organization order price is invalid", drogon::k422UnprocessableEntity);
    }
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
    order["base_unit_price_cents"] = quote.get("base_unit_price_cents", unitPrice);
    order["unit_price_cents"] = discountedUnitPrice;
    order["base_amount_cents"] = quote.get("base_amount_cents", unitPrice * seats);
    order["discount_cents"] = quote.get("discount_cents", 0);
    order["offer"] = quote["offer"];
    order["pricing_quoted_at"] = quote.get("quoted_at", nowIso());
    order["pricing_scope"] = "organization";
    order["minimum_seats"] = minimumSeats;
    order["amount_cents"] = discountedUnitPrice * seats;
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

Json::Value PaymentService::quote(const std::string &actorId,
                                  const Json::Value &roles,
                                  const Json::Value &payload) const
{
    const auto scopeType = payload.get("scope_type", "personal").asString() == "organization"
                               ? std::string("organization")
                               : std::string("personal");
    if (scopeType == "organization" && !hasAnyRole(roles, {"superAdmin"}))
    {
        throw common::AppException("FORBIDDEN", "需要超级管理员权限", drogon::k403Forbidden);
    }
    const auto scopeId = scopeType == "organization"
                             ? payload.get("organization_id", "").asString()
                             : actorId;
    if (scopeId.empty())
    {
        throw common::AppException(
            "PAYMENT_ORGANIZATION_REQUIRED",
            "organization_id is required",
            drogon::k422UnprocessableEntity);
    }
    const auto plan = normalizePlan(payload.get("plan", "pro").asString());
    if (plan == "free")
    {
        throw common::AppException(
            "PAYMENT_PLAN_INVALID",
            "Paid quote requires pro or ultra plan",
            drogon::k422UnprocessableEntity);
    }
    const auto requestedDays = payload.get("days", 30).asInt();
    const auto days = scopeType == "organization" ? requestedDays : normalizeDays(requestedDays);
    if (scopeType == "organization" && days != 30 && days != 365)
    {
        throw common::AppException(
            "PAYMENT_DURATION_INVALID",
            "机构套餐仅支持 30 天月付或 365 天年付",
            drogon::k422UnprocessableEntity);
    }
    const auto currency = normalizeCurrency(payload.get("currency", "cny").asString());
    const auto seats = scopeType == "organization"
                           ? std::clamp(payload.get("seats", 1).asInt(), 1, 100000)
                           : 1;
    if (scopeType == "organization")
    {
        const auto minimumSeats = minimumOrganizationSeats(plan);
        if (seats < minimumSeats)
        {
            throw common::AppException(
                "PAYMENT_MINIMUM_SEATS",
                plan == "ultra" ? "机构 ULTRA 最低购买 30 席" : "机构 PRO 最低购买 20 席",
                drogon::k422UnprocessableEntity);
        }
        if (seats >= customQuoteMinimumSeats())
        {
            throw common::AppException(
                "PAYMENT_CUSTOM_QUOTE_REQUIRED",
                "200 席及以上需要联系企业销售获取定制报价",
                drogon::k422UnprocessableEntity);
        }
    }
    const auto subscription = scopeType == "organization"
                                  ? subscriptionService_.subscriptionForOrganization(scopeId)
                                  : subscriptionService_.subscriptionForUser(actorId);
    std::scoped_lock lock(mutex_);
    const auto result = buildPriceQuote(
        loadPricingConfig(), loadOrders(), subscription, scopeType, scopeId, plan, days, currency, seats);
    if (result.get("amount_cents", 0).asInt64() <= 0 ||
        result.get("amount_cents", 0).asInt64() > 999999999LL)
    {
        throw common::AppException(
            "PAYMENT_PRICE_INVALID",
            "No price configured for this plan",
            drogon::k422UnprocessableEntity);
    }
    return result;
}

Json::Value PaymentService::getAutoRenewal(const std::string &actorId,
                                           const std::string &scopeType,
                                           const std::string &scopeId) const
{
    const auto normalizedScope = scopeType == "organization" ? std::string("organization") : std::string("personal");
    const auto normalizedScopeId = normalizedScope == "organization" ? scopeId : actorId;
    if (normalizedScopeId.empty() || (normalizedScope == "personal" && scopeId != actorId))
    {
        throw common::AppException("FORBIDDEN", "无权查看该自动续费设置", drogon::k403Forbidden);
    }
    const auto subscription = normalizedScope == "organization"
                                  ? subscriptionService_.subscriptionForOrganization(normalizedScopeId)
                                  : subscriptionService_.subscriptionForUser(actorId);
    std::scoped_lock lock(mutex_);
    const auto key = normalizedScope + ":" + normalizedScopeId;
    auto renewal = sqliteStore_.get("payment_auto_renewals", key);
    if (renewal.isNull())
    {
        renewal = Json::Value(Json::objectValue);
        renewal["id"] = key;
        renewal["scope_type"] = normalizedScope;
        renewal["scope_id"] = normalizedScopeId;
        renewal["enabled"] = false;
        renewal["status"] = "disabled";
        renewal["currency"] = "cny";
        renewal["provider"] = loadPricingConfig().get("default_provider", "wechat");
        renewal["plan"] = subscription.get("plan", "free");
        renewal["days"] = normalizedScope == "organization" ? 365 : 365;
        renewal["seats"] = subscription.get("seats", 1);
        renewal["price_snapshot_cents"] = 0;
        renewal["consent_at"] = "";
        renewal["updated_at"] = "";
        renewal["provider_mandate_id"] = "";
    }

    const auto pricing = loadPricingConfig();
    const auto enabled = renewal.get("enabled", false).asBool();
    const auto mandateId = renewal.get("provider_mandate_id", "").asString();
    renewal["charge_ready"] = enabled && !mandateId.empty();
    renewal["subscription"] = subscription;
    renewal["reminder_schedule"] = Json::arrayValue;
    renewal["notices"] = Json::arrayValue;
    renewal["price_change_notice"] = Json::Value(Json::nullValue);

    const auto renewalStatus = renewal.get("status", "disabled").asString();
    if (renewalStatus == "payment_failed_grace")
    {
        Json::Value notice(Json::objectValue);
        notice["type"] = "renewal_payment_failed";
        notice["level"] = "warning";
        notice["title"] = "自动续费扣款失败";
        notice["message"] = "当前处于宽限期，请更新支付方式；下一次重试日期为 " +
                            renewal.get("next_retry_at", "待确认").asString() + "。";
        renewal["notices"].append(notice);
    }
    else if (renewalStatus == "awaiting_provider_callback")
    {
        Json::Value notice(Json::objectValue);
        notice["type"] = "renewal_payment_processing";
        notice["level"] = "info";
        notice["title"] = "自动续费扣款处理中";
        notice["message"] = "已向支付渠道提交扣款请求，正在等待渠道回调，请勿重复操作。";
        renewal["notices"].append(notice);
    }
    else if (renewalStatus == "grace_expired")
    {
        Json::Value notice(Json::objectValue);
        notice["type"] = "renewal_grace_expired";
        notice["level"] = "warning";
        notice["title"] = "自动续费宽限期已结束";
        notice["message"] = "自动续费已停止，历史数据仍会保留，可重新购买套餐。";
        renewal["notices"].append(notice);
    }

    if (enabled)
    {
        const auto plan = normalizePlan(renewal.get("plan", subscription.get("plan", "free")).asString());
        const auto days = normalizedScope == "organization"
                              ? renewal.get("days", 365).asInt()
                              : normalizeDays(renewal.get("days", 365).asInt());
        const auto seats = normalizedScope == "organization"
                               ? std::max(1, renewal.get("seats", subscription.get("seats", 1)).asInt())
                               : 1;
        const auto currency = normalizeCurrency(renewal.get("currency", "cny").asString());
        bool canQuote = true;
        if (normalizedScope == "organization")
        {
            const auto minimumSeats = pricing["catalogs"]["organization"]["plans"][plan]
                                          .get("minimum_seats", plan == "ultra" ? 30 : 20)
                                          .asInt();
            const auto customQuoteMinSeats = pricing["catalogs"]["organization"]
                                                 .get("custom_quote_min_seats", 200)
                                                 .asInt();
            canQuote = seats >= minimumSeats && seats < customQuoteMinSeats;
            if (!canQuote)
            {
                Json::Value notice(Json::objectValue);
                notice["type"] = "renewal_review_required";
                notice["level"] = "warning";
                notice["title"] = seats >= customQuoteMinSeats ? "下期续费需要企业定制报价" : "当前席位不满足套餐续费门槛";
                notice["message"] = seats >= customQuoteMinSeats
                                        ? "当前席位已达到定制报价门槛，请在到期前联系平台确认下期合同。"
                                        : "请先调整机构席位或套餐，再重新确认自动续费授权。";
                renewal["notices"].append(notice);
            }
        }
        if (canQuote)
        {
            const auto currentQuote = buildPriceQuote(
                pricing, loadOrders(), subscription, normalizedScope, normalizedScopeId, plan, days, currency, seats);
            renewal["current_quote"] = currentQuote;
            const auto snapshot = renewal.get("price_snapshot_cents", currentQuote.get("amount_cents", 0)).asInt64();
            const auto currentAmount = currentQuote.get("amount_cents", 0).asInt64();
            if (snapshot > 0 && currentAmount > 0 && snapshot != currentAmount)
            {
                Json::Value notice(Json::objectValue);
                notice["type"] = "renewal_price_changed";
                notice["level"] = currentAmount > snapshot ? "warning" : "info";
                notice["title"] = currentAmount > snapshot ? "下期续费价格将上涨" : "下期续费价格已降低";
                notice["previous_amount_cents"] = snapshot;
                notice["current_amount_cents"] = currentAmount;
                notice["notice_before_days"] = pricing["renewal"].get("price_change_notice_days", 7);
                notice["message"] = "价格变化不影响当前已支付周期，续费前可随时关闭自动续费。";
                renewal["price_change_notice"] = notice;
                renewal["notices"].append(notice);
            }
        }
    }

    const auto expiry = parseDate(subscription.get("expires_at", "").asString());
    if (expiry.has_value())
    {
        const auto today = parseDate(common::nowIso8601().substr(0, 10)).value();
        const auto daysRemaining = static_cast<int>((*expiry - today).count());
        renewal["next_charge_at"] = formatDate(*expiry);
        renewal["days_until_renewal"] = daysRemaining;
        int maxReminderDays = 0;
        for (const auto &value : pricing["renewal"]["reminder_days"])
        {
            const auto daysBefore = value.asInt();
            maxReminderDays = std::max(maxReminderDays, daysBefore);
            Json::Value scheduled(Json::objectValue);
            scheduled["days_before"] = daysBefore;
            scheduled["scheduled_for"] = formatDate(*expiry - std::chrono::days{daysBefore});
            renewal["reminder_schedule"].append(scheduled);
        }
        if (enabled && daysRemaining >= 0 && daysRemaining <= maxReminderDays)
        {
            Json::Value notice(Json::objectValue);
            notice["type"] = "renewal_due";
            notice["level"] = daysRemaining <= 1 ? "warning" : "info";
            notice["title"] = "自动续费即将到期扣款";
            notice["days_remaining"] = daysRemaining;
            notice["message"] = "请确认支付方式和下期价格；关闭自动续费不会影响当前周期权益。";
            renewal["notices"].append(notice);
        }
    }
    renewal["grace_period_days"] = pricing["renewal"].get("grace_period_days", 7);
    renewal["price_change_notice_days"] = pricing["renewal"].get("price_change_notice_days", 7);
    return renewal;
}

Json::Value PaymentService::updateAutoRenewal(const std::string &actorId,
                                              const std::string &scopeType,
                                              const std::string &scopeId,
                                              const Json::Value &payload)
{
    std::scoped_lock workflowLock(renewalWorkflowMutex_);
    const auto normalizedScope = scopeType == "organization" ? std::string("organization") : std::string("personal");
    const auto normalizedScopeId = normalizedScope == "organization" ? scopeId : actorId;
    if (normalizedScopeId.empty() || (normalizedScope == "personal" && scopeId != actorId))
    {
        throw common::AppException("FORBIDDEN", "无权修改该自动续费设置", drogon::k403Forbidden);
    }
    const auto subscription = normalizedScope == "organization"
                                  ? subscriptionService_.subscriptionForOrganization(normalizedScopeId)
                                  : subscriptionService_.subscriptionForUser(actorId);
    const auto enabled = payload.get("enabled", false).asBool();
    if (enabled && (!subscription.get("is_active", false).asBool() ||
                    normalizePlan(subscription.get("plan", "free").asString()) == "free"))
    {
        throw common::AppException(
            "AUTO_RENEWAL_SUBSCRIPTION_REQUIRED",
            "只有当前有效的 PRO 或 ULTRA 套餐可以开启自动续费",
            drogon::k422UnprocessableEntity);
    }

    const auto key = normalizedScope + ":" + normalizedScopeId;
    const auto now = nowIso();
    {
        std::unique_lock lock(mutex_);
        auto renewal = sqliteStore_.get("payment_auto_renewals", key);
        if (renewal.isNull())
        {
            renewal = Json::Value(Json::objectValue);
            renewal["id"] = key;
            renewal["created_at"] = now;
            renewal["provider_mandate_id"] = "";
        }
        renewal["scope_type"] = normalizedScope;
        renewal["scope_id"] = normalizedScopeId;
        renewal["enabled"] = enabled;
        renewal["status"] = enabled ? "pending_provider_authorization" : "disabled";
        renewal["actor_id"] = actorId;
        renewal["updated_at"] = now;
        renewal["notify_in_app"] = true;
        renewal["notify_email"] = payload.get("notify_email", true).asBool();
        if (enabled)
        {
            const auto pricing = loadPricingConfig();
            const auto plan = normalizePlan(subscription.get("plan", "free").asString());
            const auto days = normalizedScope == "organization"
                                  ? payload.get("days", 365).asInt()
                                  : normalizeDays(payload.get("days", 365).asInt());
            if (normalizedScope == "organization" && days != 30 && days != 365)
            {
                throw common::AppException(
                    "PAYMENT_DURATION_INVALID",
                    "机构套餐仅支持 30 天月付或 365 天年付",
                    drogon::k422UnprocessableEntity);
            }
            const auto seats = normalizedScope == "organization"
                                   ? std::max(1, subscription.get("seats", 1).asInt())
                                   : 1;
            if (normalizedScope == "organization")
            {
                const auto minimumSeats = pricing["catalogs"]["organization"]["plans"][plan]
                                              .get("minimum_seats", plan == "ultra" ? 30 : 20)
                                              .asInt();
                const auto customQuoteMinSeats = pricing["catalogs"]["organization"]
                                                     .get("custom_quote_min_seats", 200)
                                                     .asInt();
                if (seats < minimumSeats)
                {
                    throw common::AppException(
                        "PAYMENT_MINIMUM_SEATS",
                        "当前机构席位数低于该套餐的最低购买席位",
                        drogon::k422UnprocessableEntity);
                }
                if (seats >= customQuoteMinSeats)
                {
                    throw common::AppException(
                        "PAYMENT_CUSTOM_QUOTE_REQUIRED",
                        "该席位规模需要联系平台获取企业定制报价",
                        drogon::k422UnprocessableEntity);
                }
            }
            const auto currency = normalizeCurrency(payload.get("currency", "cny").asString());
            const auto provider = normalizeProvider(payload.get("provider", pricing.get("default_provider", "wechat")).asString());
            requirePaymentProviderEnabled(provider);
            const auto quote = buildPriceQuote(
                pricing, loadOrders(), subscription, normalizedScope, normalizedScopeId, plan, days, currency, seats);
            if (quote.get("amount_cents", 0).asInt64() <= 0 ||
                quote.get("amount_cents", 0).asInt64() > 999999999LL)
            {
                throw common::AppException("PAYMENT_PRICE_INVALID", "自动续费价格无效", drogon::k422UnprocessableEntity);
            }
            renewal["plan"] = plan;
            renewal["days"] = days;
            renewal["seats"] = seats;
            renewal["currency"] = currency;
            renewal["provider"] = provider;
            renewal["price_snapshot_cents"] = quote.get("amount_cents", 0);
            renewal["unit_price_snapshot_cents"] = quote.get("unit_price_cents", 0);
            renewal["price_config_version"] = pricing.get("version", 0);
            renewal["price_config_updated_at"] = pricing.get("updated_at", "");
            renewal["next_charge_at"] = subscription.get("expires_at", "");
            renewal["consent_at"] = now;
        }
        else
        {
            renewal["disabled_at"] = now;
        }
        sqliteStore_.upsert("payment_auto_renewals", key, renewal);
    }
    return getAutoRenewal(actorId, normalizedScope, normalizedScopeId);
}

Json::Value PaymentService::enqueueNotification(const Json::Value &renewal,
                                                const std::string &dedupeKey,
                                                const std::string &type,
                                                const std::string &title,
                                                const std::string &message,
                                                const std::string &level)
{
    const auto notificationId = "ntf_" + sha256Hex(dedupeKey).substr(0, 24);
    auto notification = sqliteStore_.get("payment_notifications", notificationId);
    if (notification.isNull())
    {
        notification = Json::Value(Json::objectValue);
        notification["id"] = notificationId;
        notification["dedupe_key"] = dedupeKey;
        notification["user_id"] = renewal.get("actor_id", renewal.get("scope_id", "")).asString();
        notification["scope_type"] = renewal.get("scope_type", "personal");
        notification["scope_id"] = renewal.get("scope_id", "");
        notification["type"] = type;
        notification["level"] = level;
        notification["title"] = title;
        notification["message"] = message;
        notification["created_at"] = nowIso();
        notification["read_at"] = "";
        notification["delivery"]["in_app"]["status"] = "delivered";
        notification["delivery"]["in_app"]["delivered_at"] = notification["created_at"];
        notification["delivery"]["email"]["status"] = renewal.get("notify_email", true).asBool() ? "pending" : "skipped";
        notification["delivery"]["email"]["attempts"] = 0;
        notification["delivery"]["email"]["next_attempt_at"] = "";
        notification["updated_at"] = notification["created_at"];
        // Persist the outbox row before contacting the provider. If the process
        // stops during delivery, the scheduled worker can recover this entry.
        sqliteStore_.upsert("payment_notifications", notificationId, notification);
    }

    const auto emailStatus = notification["delivery"]["email"].get("status", "skipped").asString();
    if (renewal.get("notify_email", true).asBool() && emailStatus == "pending")
    {
        deliverNotificationEmail(notification);
    }
    notification["updated_at"] = nowIso();
    sqliteStore_.upsert("payment_notifications", notificationId, notification);
    return notification;
}

Json::Value PaymentService::deliverNotificationEmail(Json::Value &notification)
{
    constexpr int maxAttempts = 3;
    const auto previousAttempts = notification["delivery"]["email"].get("attempts", 0).asInt();
    Json::Value result(Json::objectValue);
    result["attempted"] = false;
    result["delivered"] = false;
    result["retry_scheduled"] = false;
    result["dead_letter"] = false;
    if (previousAttempts >= maxAttempts)
    {
        notification["delivery"]["email"]["status"] = "dead_letter";
        notification["delivery"]["email"]["next_attempt_at"] = "";
        result["dead_letter"] = true;
        return result;
    }

    const auto attemptedAt = nowIso();
    const auto attempts = previousAttempts + 1;
    notification["delivery"]["email"]["attempts"] = attempts;
    notification["delivery"]["email"]["last_attempt_at"] = attemptedAt;
    notification["delivery"]["email"]["next_attempt_at"] = "";
    result["attempted"] = true;

    const auto userId = notification.get("user_id", "").asString();
    const auto user = userRepository_ ? userRepository_->findUserById(userId) : Json::Value(Json::nullValue);
    const auto address = user.get("email", "").asString();
    if (!emailService_ || address.empty() || !user.get("email_verified", false).asBool())
    {
        notification["delivery"]["email"]["status"] = "skipped";
        notification["delivery"]["email"]["error"] = "用户没有已验证邮箱或邮件服务不可用";
        notification["updated_at"] = attemptedAt;
        result["skipped"] = true;
        return result;
    }

    EmailMessage email;
    email.toAddress = address;
    email.subject = "Exam Online：" + notification.get("title", "续费通知").asString();
    email.textBody = notification.get("message", "").asString() +
                     "\n\n可登录 Exam Online 查看订阅与自动续费设置。";
    const auto delivery = emailService_->send(email);
    notification["delivery"]["email"]["provider"] = delivery.provider;
    notification["delivery"]["email"]["provider_message_id"] = delivery.providerMessageId;
    notification["delivery"]["email"]["error"] =
        delivery.delivered || !delivery.errorMessage.empty()
            ? delivery.errorMessage
            : "邮件服务返回投递失败";
    if (delivery.delivered)
    {
        notification["delivery"]["email"]["status"] = "delivered";
        notification["delivery"]["email"]["delivered_at"] = attemptedAt;
        notification["delivery"]["email"]["next_attempt_at"] = "";
        result["delivered"] = true;
    }
    else if (attempts >= maxAttempts)
    {
        notification["delivery"]["email"]["status"] = "dead_letter";
        notification["delivery"]["email"]["next_attempt_at"] = "";
        result["dead_letter"] = true;
    }
    else
    {
        const int retryDelayMinutes = attempts == 1 ? 15 : 60;
        notification["delivery"]["email"]["status"] = "retry_scheduled";
        notification["delivery"]["email"]["next_attempt_at"] = isoAfterMinutes(retryDelayMinutes);
        result["retry_scheduled"] = true;
    }
    notification["updated_at"] = attemptedAt;
    return result;
}

Json::Value PaymentService::processNotificationDeliveries(bool force)
{
    Json::Value summary(Json::objectValue);
    summary["scanned"] = 0;
    summary["attempted"] = 0;
    summary["delivered"] = 0;
    summary["retry_scheduled"] = 0;
    summary["dead_letter"] = 0;
    const auto now = nowIso();
    for (auto notification : sqliteStore_.list("payment_notifications"))
    {
        const auto status = notification["delivery"]["email"].get("status", "skipped").asString();
        if (status != "pending" && status != "failed" && status != "retry_scheduled")
        {
            continue;
        }
        summary["scanned"] = summary["scanned"].asInt() + 1;
        const auto nextAttemptAt = notification["delivery"]["email"].get("next_attempt_at", "").asString();
        if (!force && !nextAttemptAt.empty() && nextAttemptAt > now)
        {
            continue;
        }
        const auto delivery = deliverNotificationEmail(notification);
        sqliteStore_.upsert(
            "payment_notifications",
            notification.get("id", "").asString(),
            notification);
        if (delivery.get("attempted", false).asBool())
        {
            summary["attempted"] = summary["attempted"].asInt() + 1;
        }
        if (delivery.get("delivered", false).asBool())
        {
            summary["delivered"] = summary["delivered"].asInt() + 1;
        }
        if (delivery.get("retry_scheduled", false).asBool())
        {
            summary["retry_scheduled"] = summary["retry_scheduled"].asInt() + 1;
        }
        if (delivery.get("dead_letter", false).asBool())
        {
            summary["dead_letter"] = summary["dead_letter"].asInt() + 1;
        }
    }
    return summary;
}

Json::Value PaymentService::listNotifications(const std::string &userId,
                                              bool unreadOnly,
                                              int page,
                                              int pageSize) const
{
    const auto all = sqliteStore_.list("payment_notifications");
    Json::Value filtered(Json::arrayValue);
    for (Json::ArrayIndex index = all.size(); index > 0; --index)
    {
        const auto &item = all[index - 1];
        if (item.get("user_id", "").asString() != userId)
        {
            continue;
        }
        if (unreadOnly && !item.get("read_at", "").asString().empty())
        {
            continue;
        }
        filtered.append(item);
    }
    const auto safePage = std::max(1, page);
    const auto safePageSize = std::clamp(pageSize, 1, 100);
    const auto total = static_cast<int>(filtered.size());
    const auto start = std::min(total, (safePage - 1) * safePageSize);
    const auto end = std::min(total, start + safePageSize);
    Json::Value items(Json::arrayValue);
    for (int index = start; index < end; ++index)
    {
        items.append(filtered[static_cast<Json::ArrayIndex>(index)]);
    }
    Json::Value result(Json::objectValue);
    result["items"] = items;
    result["page"] = safePage;
    result["page_size"] = safePageSize;
    result["total"] = total;
    result["pages"] = std::max(1, (total + safePageSize - 1) / safePageSize);
    int unread = 0;
    for (const auto &item : all)
    {
        if (item.get("user_id", "").asString() == userId &&
            item.get("read_at", "").asString().empty())
        {
            ++unread;
        }
    }
    result["unread_count"] = unread;
    return result;
}

Json::Value PaymentService::markNotificationRead(const std::string &userId,
                                                 const std::string &notificationId)
{
    auto notification = sqliteStore_.get("payment_notifications", notificationId);
    if (notification.isNull())
    {
        throw common::AppException("NOTIFICATION_NOT_FOUND", "通知不存在", drogon::k404NotFound);
    }
    if (notification.get("user_id", "").asString() != userId)
    {
        throw common::AppException("FORBIDDEN", "无权修改该通知", drogon::k403Forbidden);
    }
    if (notification.get("read_at", "").asString().empty())
    {
        notification["read_at"] = nowIso();
        notification["updated_at"] = notification["read_at"];
        sqliteStore_.upsert("payment_notifications", notificationId, notification);
    }
    return notification;
}

Json::Value PaymentService::markAllNotificationsRead(const std::string &userId)
{
    int updated = 0;
    for (auto notification : sqliteStore_.list("payment_notifications"))
    {
        if (notification.get("user_id", "").asString() != userId ||
            !notification.get("read_at", "").asString().empty())
        {
            continue;
        }
        notification["read_at"] = nowIso();
        notification["updated_at"] = notification["read_at"];
        sqliteStore_.upsert("payment_notifications", notification.get("id", "").asString(), notification);
        ++updated;
    }
    Json::Value result(Json::objectValue);
    result["updated"] = updated;
    result["unread_count"] = 0;
    return result;
}

Json::Value PaymentService::createRenewalAttempt(Json::Value &renewal,
                                                 const std::string &asOfDate)
{
    if (renewal.get("status", "").asString() == "awaiting_provider_callback" &&
        renewal.get("last_charge_requested_on", "").asString() == asOfDate)
    {
        Json::Value replay(Json::objectValue);
        replay["created"] = false;
        replay["idempotent_replay"] = true;
        return replay;
    }
    const auto cycle = renewal.get("next_charge_at", asOfDate).asString();
    const auto requestCount = renewal.get("charge_request_count", 0).asInt() + 1;
    const auto attemptId = "rna_" + sha256Hex(
        renewal.get("id", "").asString() + ":" + cycle + ":" + std::to_string(requestCount)).substr(0, 24);
    auto attempt = sqliteStore_.get("payment_renewal_attempts", attemptId);
    if (!attempt.isNull())
    {
        attempt["created"] = false;
        attempt["idempotent_replay"] = true;
        return attempt;
    }
    attempt = Json::Value(Json::objectValue);
    attempt["id"] = attemptId;
    attempt["renewal_id"] = renewal.get("id", "");
    attempt["scope_type"] = renewal.get("scope_type", "personal");
    attempt["scope_id"] = renewal.get("scope_id", "");
    attempt["actor_id"] = renewal.get("actor_id", "");
    attempt["provider"] = renewal.get("provider", "");
    attempt["cycle_date"] = cycle;
    attempt["request_number"] = requestCount;
    attempt["status"] = "awaiting_provider_callback";
    attempt["created_at"] = nowIso();
    attempt["updated_at"] = attempt["created_at"];
    attempt["created"] = true;
    sqliteStore_.upsert("payment_renewal_attempts", attemptId, attempt);
    renewal["charge_request_count"] = requestCount;
    renewal["last_charge_requested_at"] = nowIso();
    renewal["last_charge_requested_on"] = asOfDate;
    renewal["status"] = "awaiting_provider_callback";
    renewal["current_attempt_id"] = attemptId;
    renewal["updated_at"] = nowIso();
    sqliteStore_.upsert("payment_auto_renewals", renewal.get("id", "").asString(), renewal);
    return attempt;
}

Json::Value PaymentService::runRenewalJobs(const std::string &asOfDate,
                                           bool forceNotificationRetries)
{
    std::scoped_lock workflowLock(renewalWorkflowMutex_);
    const auto runDate = asOfDate.empty() ? common::nowIso8601().substr(0, 10) : asOfDate;
    const auto parsedRunDate = parseDate(runDate);
    if (!parsedRunDate.has_value())
    {
        throw common::AppException("RENEWAL_JOB_DATE_INVALID", "as_of_date 必须为 YYYY-MM-DD", drogon::k422UnprocessableEntity);
    }
    Json::Value summary(Json::objectValue);
    summary["run_at"] = nowIso();
    summary["as_of_date"] = runDate;
    summary["scanned"] = 0;
    summary["reminders_enqueued"] = 0;
    summary["price_changes_enqueued"] = 0;
    summary["charge_requests_created"] = 0;
    summary["authorization_required"] = 0;
    summary["grace_expired"] = 0;

    for (auto renewal : sqliteStore_.list("payment_auto_renewals"))
    {
        if (!renewal.get("enabled", false).asBool())
        {
            continue;
        }
        summary["scanned"] = summary["scanned"].asInt() + 1;
        const auto actorId = renewal.get("actor_id", renewal.get("scope_id", "")).asString();
        const auto scopeType = renewal.get("scope_type", "personal").asString();
        const auto scopeId = renewal.get("scope_id", "").asString();
        Json::Value view;
        try
        {
            view = getAutoRenewal(actorId, scopeType, scopeId);
        }
        catch (...)
        {
            continue;
        }
        const auto subscription = view["subscription"];
        const auto expiryText = subscription.get("expires_at", renewal.get("next_charge_at", "")).asString();
        const auto expiry = parseDate(expiryText);
        if (!expiry.has_value())
        {
            continue;
        }

        for (const auto &notice : view["notices"])
        {
            if (notice.get("type", "").asString() != "renewal_price_changed")
            {
                continue;
            }
            enqueueNotification(
                renewal,
                renewal.get("id", "").asString() + ":price:" +
                    std::to_string(notice.get("previous_amount_cents", 0).asInt64()) + ":" +
                    std::to_string(notice.get("current_amount_cents", 0).asInt64()),
                "renewal_price_changed",
                notice.get("title", "下期续费价格发生变化").asString(),
                notice.get("message", "价格变化不影响当前周期。").asString(),
                notice.get("level", "warning").asString());
            summary["price_changes_enqueued"] = summary["price_changes_enqueued"].asInt() + 1;
        }

        for (const auto &schedule : view["reminder_schedule"])
        {
            if (schedule.get("scheduled_for", "").asString() != runDate)
            {
                continue;
            }
            const auto daysBefore = schedule.get("days_before", 0).asInt();
            enqueueNotification(
                renewal,
                renewal.get("id", "").asString() + ":reminder:" + expiryText + ":" + std::to_string(daysBefore),
                "renewal_due",
                "自动续费还有 " + std::to_string(daysBefore) + " 天",
                "请确认支付方式和下期价格；关闭自动续费不会影响当前周期权益。",
                daysBefore <= 1 ? "warning" : "info");
            summary["reminders_enqueued"] = summary["reminders_enqueued"].asInt() + 1;
        }

        const auto graceExpires = parseDate(renewal.get("grace_expires_at", "").asString());
        if (renewal.get("status", "").asString() == "payment_failed_grace" && graceExpires.has_value())
        {
            if (*parsedRunDate > *graceExpires)
            {
                renewal["enabled"] = false;
                renewal["status"] = "grace_expired";
                renewal["disabled_at"] = nowIso();
                renewal["updated_at"] = renewal["disabled_at"];
                sqliteStore_.upsert("payment_auto_renewals", renewal.get("id", "").asString(), renewal);
                enqueueNotification(
                    renewal,
                    renewal.get("id", "").asString() + ":grace_expired:" + renewal.get("grace_expires_at", "").asString(),
                    "renewal_grace_expired",
                    "自动续费宽限期已结束",
                    "自动续费已停止。历史数据仍会保留，可随时重新购买套餐。",
                    "warning");
                summary["grace_expired"] = summary["grace_expired"].asInt() + 1;
                continue;
            }
            const auto nextRetry = parseDate(renewal.get("next_retry_at", "").asString());
            if (view.get("charge_ready", false).asBool() && nextRetry.has_value() && *parsedRunDate >= *nextRetry)
            {
                const auto attempt = createRenewalAttempt(renewal, runDate);
                if (attempt.get("created", false).asBool())
                {
                    summary["charge_requests_created"] = summary["charge_requests_created"].asInt() + 1;
                }
            }
            continue;
        }

        if (*parsedRunDate < *expiry)
        {
            continue;
        }
        if (!view.get("charge_ready", false).asBool())
        {
            enqueueNotification(
                renewal,
                renewal.get("id", "").asString() + ":authorization_required:" + expiryText,
                "renewal_authorization_required",
                "自动续费仍需完成支付渠道签约",
                "当前授权尚未取得支付渠道扣款凭证，本周期不会自动扣款，请完成签约或手动续费。",
                "warning");
            summary["authorization_required"] = summary["authorization_required"].asInt() + 1;
            continue;
        }
        const auto attempt = createRenewalAttempt(renewal, runDate);
        if (attempt.get("created", false).asBool())
        {
            summary["charge_requests_created"] = summary["charge_requests_created"].asInt() + 1;
        }
    }
    const auto deliverySummary = processNotificationDeliveries(forceNotificationRetries);
    summary["notification_delivery"] = deliverySummary;
    sqliteStore_.upsert("payment_job_state", "renewal", summary);
    return summary;
}

Json::Value PaymentService::renewalOperations() const
{
    Json::Value result(Json::objectValue);
    result["last_run"] = sqliteStore_.get("payment_job_state", "renewal");
    result["agreements_total"] = static_cast<Json::UInt64>(sqliteStore_.count("payment_auto_renewals"));
    result["attempts_total"] = static_cast<Json::UInt64>(sqliteStore_.count("payment_renewal_attempts"));
    result["notifications_total"] = static_cast<Json::UInt64>(sqliteStore_.count("payment_notifications"));
    result["email_delivery_counts"] = Json::Value(Json::objectValue);
    for (const auto &notification : sqliteStore_.list("payment_notifications"))
    {
        const auto status = notification["delivery"]["email"].get("status", "skipped").asString();
        result["email_delivery_counts"][status] =
            result["email_delivery_counts"].get(status, 0).asInt() + 1;
    }
    result["status_counts"] = Json::Value(Json::objectValue);
    for (const auto &renewal : sqliteStore_.list("payment_auto_renewals"))
    {
        const auto status = renewal.get("status", "disabled").asString();
        result["status_counts"][status] = result["status_counts"].get(status, 0).asInt() + 1;
    }
    result["recent_attempts"] = Json::Value(Json::arrayValue);
    const auto attempts = sqliteStore_.list("payment_renewal_attempts", 20, 0);
    for (Json::ArrayIndex index = attempts.size(); index > 0; --index)
    {
        result["recent_attempts"].append(attempts[index - 1]);
    }
    return result;
}

Json::Value PaymentService::settleRenewalSuccessUnlocked(Json::Value &renewal,
                                                        const std::string &provider,
                                                        const std::string &providerPaymentId,
                                                        const std::string &eventId,
                                                        const Json::Value &providerEvent)
{
    auto orders = loadOrders();
    auto ledger = loadLedger();
    const auto scopeType = renewal.get("scope_type", "personal").asString();
    const auto scopeId = renewal.get("scope_id", "").asString();
    const auto actorId = renewal.get("actor_id", scopeId).asString();
    const auto subscription = scopeType == "organization"
                                  ? subscriptionService_.subscriptionForOrganization(scopeId)
                                  : subscriptionService_.subscriptionForUser(scopeId);
    const auto pricing = loadPricingConfig();
    const auto plan = normalizePlan(renewal.get("plan", subscription.get("plan", "free")).asString());
    const auto days = renewal.get("days", 365).asInt();
    const auto seats = scopeType == "organization" ? renewal.get("seats", subscription.get("seats", 1)).asInt() : 1;
    const auto currency = normalizeCurrency(renewal.get("currency", "cny").asString());
    const auto quote = buildPriceQuote(pricing, orders, subscription, scopeType, scopeId, plan, days, currency, seats);

    Json::Value order(Json::objectValue);
    order["id"] = makeId("pay");
    order["user_id"] = actorId;
    order["actor_id"] = actorId;
    order["scope_type"] = scopeType == "organization" ? "organization" : "user";
    order["scope_id"] = scopeId;
    if (scopeType == "organization") order["organization_id"] = scopeId;
    order["pricing_scope"] = scopeType;
    order["provider"] = provider;
    order["status"] = "pending";
    order["plan"] = plan;
    order["days"] = days;
    order["seats"] = seats;
    order["currency"] = currency;
    order["base_unit_price_cents"] = quote.get("base_unit_price_cents", quote.get("amount_cents", 0));
    order["unit_price_cents"] = quote.get("unit_price_cents", quote.get("amount_cents", 0));
    order["base_amount_cents"] = quote.get("base_amount_cents", quote.get("amount_cents", 0));
    order["amount_cents"] = quote.get("amount_cents", 0);
    order["discount_cents"] = quote.get("discount_cents", 0);
    order["offer"] = quote["offer"];
    order["pricing_quoted_at"] = quote.get("quoted_at", nowIso());
    order["amount"] = order["amount_cents"].asInt() / 100.0;
    order["description"] = "自动续费：" + plan + " 套餐 " + std::to_string(days) + " 天";
    order["created_at"] = nowIso();
    order["updated_at"] = order["created_at"];
    order["metadata"]["auto_renewal"] = true;
    order["metadata"]["auto_renewal_id"] = renewal.get("id", "");
    order["metadata"]["provider_event_id"] = eventId;
    orders.append(order);
    appendLedgerEntry(ledger, actorId, order["id"].asString(), "order.created", order["amount_cents"].asInt(), currency, "创建自动续费订单");
    auto paid = markOrderPaidUnlocked(orders, ledger, order["id"].asString(), providerPaymentId, providerEvent);
    saveOrders(orders);
    saveLedger(ledger);
    renewal["status"] = "active";
    renewal["last_paid_at"] = nowIso();
    renewal["last_payment_order_id"] = paid.get("id", "");
    renewal["last_provider_event_id"] = eventId;
    renewal["next_charge_at"] = paid["subscription"].get("expires_at", "");
    renewal["price_snapshot_cents"] = quote.get("amount_cents", 0);
    renewal["unit_price_snapshot_cents"] = quote.get("unit_price_cents", 0);
    renewal["failure_count"] = 0;
    renewal["grace_started_at"] = "";
    renewal["grace_expires_at"] = "";
    renewal["next_retry_at"] = "";
    renewal["current_attempt_id"] = "";
    renewal["updated_at"] = nowIso();
    sqliteStore_.upsert("payment_auto_renewals", renewal.get("id", "").asString(), renewal);
    return paid;
}

Json::Value PaymentService::handleAutoRenewalWebhook(const std::string &provider,
                                                     const std::string &rawBody,
                                                     const Json::Value &payload,
                                                     const std::string &signatureHeader)
{
    std::scoped_lock workflowLock(renewalWorkflowMutex_);
    const auto normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider == "stripe" && !verifyStripeSignature(rawBody, signatureHeader))
    {
        throw common::AppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Stripe webhook signature is invalid", drogon::k401Unauthorized);
    }
    if (normalizedProvider != "stripe")
    {
        const auto secret = normalizedProvider == "wechat"
                                ? env("WECHAT_PAY_WEBHOOK_SECRET", env("PAYMENT_GENERIC_WEBHOOK_SECRET"))
                                : env("ALIPAY_WEBHOOK_SECRET", env("PAYMENT_GENERIC_WEBHOOK_SECRET"));
        if (secret.empty() ||
            (!signatureHeader.empty() && !verifyGenericHmacSignature(rawBody, signatureHeader, secret)) ||
            (signatureHeader.empty() && payload.get("secret", "").asString() != secret))
        {
            throw common::AppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Payment webhook signature is invalid", drogon::k401Unauthorized);
        }
    }

    const auto object = normalizedProvider == "stripe" ? payload["data"]["object"] : payload;
    const auto metadata = object.isMember("metadata") ? object["metadata"] : payload["metadata"];
    const auto scopeType = metadata.get("scope_type", payload.get("scope_type", "personal")).asString() == "organization"
                               ? std::string("organization")
                               : std::string("personal");
    const auto scopeId = metadata.get("scope_id", payload.get("scope_id", "")).asString();
    if (scopeId.empty())
    {
        throw common::AppException("AUTO_RENEWAL_SCOPE_REQUIRED", "续费回调缺少 scope_id", drogon::k422UnprocessableEntity);
    }
    const auto key = scopeType + ":" + scopeId;
    auto renewal = sqliteStore_.get("payment_auto_renewals", key);
    if (renewal.isNull())
    {
        throw common::AppException("AUTO_RENEWAL_NOT_FOUND", "自动续费授权不存在", drogon::k404NotFound);
    }
    const auto eventType = payload.get("type", payload.get("event_type", "")).asString();
    const auto eventId = payload.get("id", payload.get("event_id", "")).asString();
    if (eventId.empty())
    {
        throw common::AppException("PAYMENT_WEBHOOK_EVENT_ID_REQUIRED", "续费回调缺少事件 ID", drogon::k422UnprocessableEntity);
    }
    const auto existingEvent = sqliteStore_.get("payment_renewal_webhooks", eventId);
    if (!existingEvent.isNull())
    {
        Json::Value duplicate = existingEvent;
        duplicate["duplicate"] = true;
        duplicate["ignored"] = true;
        return duplicate;
    }

    std::string outcome;
    if (eventType == "setup_intent.succeeded" || eventType == "mandate.active" ||
        payload.get("status", "").asString() == "authorized")
    {
        outcome = "authorized";
    }
    else if (eventType.find("failed") != std::string::npos ||
             payload.get("status", "").asString() == "failed")
    {
        outcome = "failed";
    }
    else if (eventType == "invoice.paid" || eventType == "payment_intent.succeeded" ||
             payload.get("status", "").asString() == "paid" ||
             payload.get("status", "").asString() == "success")
    {
        outcome = "succeeded";
    }
    else
    {
        outcome = "ignored";
    }

    Json::Value result(Json::objectValue);
    result["event_id"] = eventId;
    result["provider"] = normalizedProvider;
    result["outcome"] = outcome;
    if (outcome == "authorized")
    {
        renewal["provider_mandate_id"] = object.get("mandate", object.get("id", "")).asString();
        renewal["status"] = "active";
        renewal["provider_authorized_at"] = nowIso();
        renewal["updated_at"] = renewal["provider_authorized_at"];
        sqliteStore_.upsert("payment_auto_renewals", key, renewal);
        result["renewal"] = getAutoRenewal(renewal.get("actor_id", scopeId).asString(), scopeType, scopeId);
        enqueueNotification(
            renewal,
            key + ":provider_authorized:" + renewal.get("provider_mandate_id", "").asString(),
            "renewal_provider_authorized",
            "自动续费渠道签约已完成",
            "支付渠道已确认周期扣款协议，后续将在到期前按设置提醒。",
            "info");
    }
    else if (outcome == "failed")
    {
        const auto today = parseDate(common::nowIso8601().substr(0, 10)).value();
        const auto pricing = loadPricingConfig();
        const auto graceDays = pricing["renewal"].get("grace_period_days", 7).asInt();
        const auto failureCount = renewal.get("failure_count", 0).asInt() + 1;
        const int retryOffset = failureCount <= 1 ? 1 : failureCount == 2 ? 3 : 7;
        renewal["status"] = "payment_failed_grace";
        renewal["failure_count"] = failureCount;
        renewal["last_failed_at"] = nowIso();
        renewal["last_failure_reason"] = object["last_payment_error"].get(
            "message",
            payload.get("failure_reason", "支付渠道扣款失败")).asString();
        if (renewal.get("grace_started_at", "").asString().empty())
        {
            renewal["grace_started_at"] = nowIso();
            renewal["grace_expires_at"] = formatDate(today + std::chrono::days{graceDays});
        }
        const auto graceExpiry = parseDate(renewal.get("grace_expires_at", "").asString()).value();
        renewal["next_retry_at"] = formatDate(std::min(today + std::chrono::days{retryOffset}, graceExpiry));
        renewal["updated_at"] = nowIso();
        sqliteStore_.upsert("payment_auto_renewals", key, renewal);
        Json::Value attempt(Json::objectValue);
        attempt["id"] = renewal.get("current_attempt_id", "rna_" + sha256Hex(eventId).substr(0, 24));
        attempt["renewal_id"] = key;
        attempt["scope_type"] = scopeType;
        attempt["scope_id"] = scopeId;
        attempt["provider"] = normalizedProvider;
        attempt["status"] = "failed";
        attempt["failure_reason"] = renewal["last_failure_reason"];
        attempt["provider_event_id"] = eventId;
        attempt["updated_at"] = nowIso();
        sqliteStore_.upsert("payment_renewal_attempts", attempt["id"].asString(), attempt);
        result["renewal"] = getAutoRenewal(renewal.get("actor_id", scopeId).asString(), scopeType, scopeId);
        enqueueNotification(
            renewal,
            key + ":payment_failed:" + std::to_string(failureCount) + ":" + renewal.get("next_charge_at", "").asString(),
            "renewal_payment_failed",
            "自动续费扣款失败",
            "套餐已进入 " + std::to_string(graceDays) + " 天宽限期，请更新支付方式。系统将在 " +
                renewal.get("next_retry_at", "").asString() + " 再次尝试。",
            "warning");
    }
    else if (outcome == "succeeded")
    {
        const auto paymentId = object.get("payment_intent", object.get("id", payload.get("provider_payment_id", ""))).asString();
        std::unique_lock lock(mutex_);
        const auto paid = settleRenewalSuccessUnlocked(
            renewal, normalizedProvider, paymentId, eventId, payload);
        lock.unlock();
        result["order"] = paid;
        result["renewal"] = getAutoRenewal(renewal.get("actor_id", scopeId).asString(), scopeType, scopeId);
        enqueueNotification(
            renewal,
            key + ":payment_succeeded:" + eventId,
            "renewal_payment_succeeded",
            "自动续费成功",
            "下期套餐权益已生效，可在支付流水中查看续费订单。",
            "info");
    }
    else
    {
        result["ignored"] = true;
    }
    Json::Value storedEvent = result;
    storedEvent["processed_at"] = nowIso();
    sqliteStore_.upsert("payment_renewal_webhooks", eventId, storedEvent);
    return result;
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
    std::int64_t signedAt = 0;
    try
    {
        std::size_t consumed = 0;
        signedAt = std::stoll(timestamp, &consumed);
        if (consumed != timestamp.size())
        {
            return false;
        }
    }
    catch (...)
    {
        return false;
    }

    int toleranceSeconds = 300;
    try
    {
        toleranceSeconds = std::clamp(
            std::stoi(env("STRIPE_WEBHOOK_TOLERANCE_SECONDS", "300")),
            30,
            900);
    }
    catch (...)
    {
        return false;
    }
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                         std::chrono::system_clock::now().time_since_epoch())
                         .count();
    if (std::llabs(now - signedAt) > toleranceSeconds)
    {
        return false;
    }

    const auto expected = hmacSha256Hex(secret, timestamp + "." + rawBody);
    return expected.size() == signature.size() &&
           CRYPTO_memcmp(expected.data(), signature.data(), expected.size()) == 0;
}

bool PaymentService::verifyGenericHmacSignature(const std::string &rawBody,
                                                const std::string &signatureHeader,
                                                const std::string &secret) const
{
    const auto expected = hmacSha256Hex(secret, rawBody);
    const auto candidate = signatureHeader.rfind("sha256=", 0) == 0
                               ? signatureHeader.substr(7)
                               : signatureHeader;
    return expected.size() == candidate.size() &&
           CRYPTO_memcmp(expected.data(), candidate.data(), expected.size()) == 0;
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

int PaymentService::priceCents(const std::string &scopeType,
                               const std::string &plan,
                               int days,
                               const std::string &currency,
                               int seats) const
{
    const auto pricing = loadPricingConfig();
    const auto configured = readPriceCents(pricing, scopeType, currency, plan, days, seats);
    if (configured > 0)
    {
        return configured;
    }
    const auto fallback = defaultPricingConfig();
    return readPriceCents(fallback, scopeType, currency, plan, days, seats);
}

int PaymentService::minimumOrganizationSeats(const std::string &plan) const
{
    const auto pricing = loadPricingConfig();
    return pricing["catalogs"]["organization"]["plans"][plan].get(
        "minimum_seats", plan == "ultra" ? 30 : 20).asInt();
}

int PaymentService::customQuoteMinimumSeats() const
{
    const auto pricing = loadPricingConfig();
    return pricing["catalogs"]["organization"].get("custom_quote_min_seats", 200).asInt();
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
