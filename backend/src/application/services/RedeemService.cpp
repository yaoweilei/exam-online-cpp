#include "RedeemService.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <optional>
#include <sstream>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
Json::Value defaultCatalog()
{
    Json::Value codes(Json::arrayValue);

    Json::Value welcome(Json::objectValue);
    welcome["code"] = "WELCOME-100";
    welcome["title"] = "新用户学习积分包";
    welcome["kind"] = "credits";
    welcome["credits"] = 100;
    welcome["description"] = "兑换后增加 100 学习积分。";
    welcome["enabled"] = true;
    codes.append(welcome);

    Json::Value pro(Json::objectValue);
    pro["code"] = "EJU-PRO-30";
    pro["title"] = "EJU Pro 30 天体验卡";
    pro["kind"] = "subscription";
    pro["plan"] = "pro";
    pro["days"] = 30;
    pro["description"] = "兑换后开通或顺延 Pro 套餐 30 天。";
    pro["enabled"] = true;
    codes.append(pro);

    Json::Value ultra(Json::objectValue);
    ultra["code"] = "EJU-ULTRA-30";
    ultra["title"] = "EJU Ultra 30 天体验卡";
    ultra["kind"] = "subscription";
    ultra["plan"] = "ultra";
    ultra["days"] = 30;
    ultra["description"] = "兑换后开通或顺延 Ultra 套餐 30 天。";
    ultra["enabled"] = true;
    codes.append(ultra);

    return codes;
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
    out << static_cast<int>(ymd.year()) << '-';
    if (static_cast<unsigned>(ymd.month()) < 10)
    {
        out << '0';
    }
    out << static_cast<unsigned>(ymd.month()) << '-';
    if (static_cast<unsigned>(ymd.day()) < 10)
    {
        out << '0';
    }
    out << static_cast<unsigned>(ymd.day());
    return out.str();
}

Json::Value readRedemptions(const Json::Value &profile)
{
    const auto &redemptions = profile["redeemed_codes"];
    return redemptions.isObject() ? redemptions : Json::Value(Json::objectValue);
}
}  // namespace

RedeemService::RedeemService(std::filesystem::path systemDir,
                             infrastructure::storage::ProfileRepository &profileRepository,
                             SubscriptionService &subscriptionService)
    : catalogFile_(std::move(systemDir) / "redeem_codes.json"),
      profileRepository_(profileRepository),
      subscriptionService_(subscriptionService)
{
}

Json::Value RedeemService::walletForUser(const std::string &userId) const
{
    return buildWalletView(userId, profileRepository_.loadProfile(userId));
}

Json::Value RedeemService::redeemCode(const std::string &userId, const std::string &rawCode)
{
    const auto normalizedCode = normalizeCode(rawCode);
    if (normalizedCode.empty())
    {
        throw common::AppException("REDEEM_CODE_REQUIRED", "Redeem code is required", drogon::k422UnprocessableEntity);
    }

    const auto codeEntry = findCode(normalizedCode);
    if (codeEntry.isNull())
    {
        throw common::AppException("REDEEM_CODE_INVALID", "Redeem code is invalid", drogon::k404NotFound);
    }
    if (!isCodeEnabled(codeEntry))
    {
        throw common::AppException("REDEEM_CODE_DISABLED", "Redeem code is disabled", drogon::k409Conflict);
    }
    if (isExpired(codeEntry))
    {
        throw common::AppException("REDEEM_CODE_EXPIRED", "Redeem code has expired", drogon::k409Conflict);
    }

    auto profile = profileRepository_.loadProfile(userId);
    auto redemptions = readRedemptions(profile);
    if (redemptions.isMember(normalizedCode))
    {
        throw common::AppException("REDEEM_CODE_ALREADY_USED", "Redeem code has already been used", drogon::k409Conflict);
    }

    Json::Value effect(Json::objectValue);
    const auto kind = readCodeKind(codeEntry);
    if (kind == "subscription")
    {
        const auto plan = codeEntry.get("plan", "pro").asString();
        const auto days = std::max(1, codeEntry.get("days", 30).asInt());
        const auto expiresAt = nextExpiryDate(profile.get("plan_expires_at", profile.get("plan_expires", "")).asString(), days);
        Json::Value patch(Json::objectValue);
        patch["plan"] = plan;
        patch["status"] = "active";
        patch["expires_at"] = expiresAt;
        effect["subscription"] = subscriptionService_.updateUserSubscription(userId, patch);
        effect["plan"] = plan;
        effect["days"] = days;
        effect["expires_at"] = expiresAt;
        profile = profileRepository_.loadProfile(userId);
        redemptions = readRedemptions(profile);
    }
    else if (kind == "credits")
    {
        const auto credits = codeEntry.get("credits", 0).asInt();
        if (credits <= 0)
        {
            throw common::AppException("REDEEM_CODE_INVALID", "Credit redeem code has no positive credit amount", drogon::k422UnprocessableEntity);
        }
        profile["credits"] = profile.get("credits", 0).asInt() + credits;
        profile["credits_updated_at"] = common::nowIso8601();
        profile["last_credit_reason"] = "redeem.code";
        if (!profile.isMember("credit_awards") || !profile["credit_awards"].isObject())
        {
            profile["credit_awards"] = Json::Value(Json::objectValue);
        }
        Json::Value award(Json::objectValue);
        award["amount"] = credits;
        award["reason"] = "redeem.code";
        award["granted_at"] = profile["credits_updated_at"].asString();
        profile["credit_awards"]["redeem:" + normalizedCode] = award;
        effect["credits"] = credits;
    }
    else
    {
        effect["coupon"] = true;
    }

    auto record = buildRedemptionRecord(codeEntry, normalizedCode, effect);
    record["effect_summary"] = effectSummary(codeEntry, effect);
    redemptions[normalizedCode] = record;
    profile["redeemed_codes"] = redemptions;
    profileRepository_.saveProfile(userId, profile);

    Json::Value out(Json::objectValue);
    out["redemption"] = record;
    out["wallet"] = walletForUser(userId);
    return out;
}

Json::Value RedeemService::loadCatalog() const
{
    if (!std::filesystem::exists(catalogFile_))
    {
        return defaultCatalog();
    }
    auto root = infrastructure::storage::readJsonFile(catalogFile_);
    if (root.isArray())
    {
        return root;
    }
    if (root.isObject() && root["codes"].isArray())
    {
        return root["codes"];
    }
    throw common::AppException("REDEEM_CATALOG_INVALID", "Redeem code catalog must be an array or an object with codes[]", drogon::k500InternalServerError);
}

Json::Value RedeemService::findCode(const std::string &normalizedCode) const
{
    const auto catalog = loadCatalog();
    for (const auto &entry : catalog)
    {
        if (!entry.isObject())
        {
            continue;
        }
        if (normalizeCode(entry.get("code", "").asString()) == normalizedCode)
        {
            return entry;
        }
    }
    return Json::Value(Json::nullValue);
}

Json::Value RedeemService::buildWalletView(const std::string &userId, const Json::Value &profile) const
{
    Json::Value out(Json::objectValue);
    Json::Value balance(Json::objectValue);
    balance["credits"] = profile.get("credits", 0).asInt();
    balance["updated_at"] = profile.get("credits_updated_at", "").asString();
    balance["updatedAt"] = balance["updated_at"].asString();
    out["balance"] = balance;
    out["subscription"] = subscriptionService_.currentSubscription(userId);

    Json::Value coupons(Json::arrayValue);
    const auto redemptions = readRedemptions(profile);
    for (const auto &key : redemptions.getMemberNames())
    {
        coupons.append(redemptions[key]);
    }
    out["coupons"] = coupons;
    out["coupon_count"] = static_cast<Json::UInt64>(coupons.size());
    out["couponCount"] = out["coupon_count"];
    return out;
}

Json::Value RedeemService::buildRedemptionRecord(const Json::Value &codeEntry,
                                                 const std::string &normalizedCode,
                                                 const Json::Value &effect) const
{
    Json::Value record(Json::objectValue);
    record["id"] = "red_" + normalizedCode;
    record["code"] = codeEntry.get("code", normalizedCode).asString();
    record["normalized_code"] = normalizedCode;
    record["title"] = codeEntry.get("title", "兑换卡券").asString();
    record["kind"] = readCodeKind(codeEntry);
    record["description"] = codeEntry.get("description", "").asString();
    record["status"] = "used";
    record["redeemed_at"] = common::nowIso8601();
    record["redeemedAt"] = record["redeemed_at"].asString();
    record["effect"] = effect;
    return record;
}

std::string RedeemService::normalizeCode(const std::string &raw)
{
    std::string normalized;
    normalized.reserve(raw.size());
    for (const auto ch : raw)
    {
        const auto uch = static_cast<unsigned char>(ch);
        if (std::isalnum(uch))
        {
            normalized.push_back(static_cast<char>(std::toupper(uch)));
        }
    }
    return normalized;
}

std::string RedeemService::readCodeKind(const Json::Value &entry)
{
    const auto kind = entry.get("kind", entry.get("type", "credits")).asString();
    if (kind == "subscription" || kind == "credits" || kind == "coupon")
    {
        return kind;
    }
    return "credits";
}

bool RedeemService::isCodeEnabled(const Json::Value &entry)
{
    return entry.get("enabled", true).asBool();
}

bool RedeemService::isExpired(const Json::Value &entry)
{
    const auto expiresAt = entry.get("expires_at", entry.get("expiresAt", "")).asString();
    if (expiresAt.empty())
    {
        return false;
    }
    return expiresAt.substr(0, 10) < common::nowIso8601().substr(0, 10);
}

std::string RedeemService::nextExpiryDate(const std::string &currentExpiresAt, int days)
{
    const auto today = parseDate(common::nowIso8601().substr(0, 10)).value();
    auto base = today;
    if (const auto current = parseDate(currentExpiresAt); current.has_value() && *current > today)
    {
        base = *current;
    }
    return formatDate(base + std::chrono::days{days});
}

std::string RedeemService::effectSummary(const Json::Value &entry, const Json::Value &effect)
{
    const auto kind = readCodeKind(entry);
    if (kind == "subscription")
    {
        return "已开通 " + effect.get("plan", "pro").asString() + " 套餐，有效期至 " + effect.get("expires_at", "").asString();
    }
    if (kind == "credits")
    {
        return "已到账 " + std::to_string(effect.get("credits", 0).asInt()) + " 学习积分";
    }
    return "已加入卡券包";
}
}  // namespace application::services
