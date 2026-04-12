#pragma once

#include <algorithm>
#include <chrono>
#include <string>
#include <vector>

#include <json/json.h>

#include "common/AppException.h"
#include "infrastructure/storage/ProfileRepository.h"

namespace application::services
{
class SubscriptionService
{
  public:
    explicit SubscriptionService(infrastructure::storage::ProfileRepository &profileRepository)
        : profileRepository_(profileRepository)
    {
    }

    void requireAccess(const std::string &userId, const std::string &examAccessLevel) const
    {
        const auto requiredPlan = normalizePlan(examAccessLevel);
        if (requiredPlan == "free")
        {
            return;
        }

        const auto subscription = currentSubscription(userId);
        if (!isAccessible(subscription, requiredPlan))
        {
            throw common::AppException(
                "EXAM_ACCESS_DENIED",
                "This exam requires a higher subscription plan",
                drogon::k403Forbidden);
        }
    }

    Json::Value currentSubscription(const std::string &userId) const
    {
        const auto profile = profileRepository_.loadProfile(userId);
        const auto plan = normalizePlan(profile.get("plan", "free").asString());
        const auto expiresAt = profile.get("plan_expires_at", "").asString();
        const auto status = normalizeStatus(profile.get("plan_status", "active").asString(), expiresAt);

        Json::Value out(Json::objectValue);
        out["scope_type"] = profile.get("scope_type", "personal").asString();
        out["scope_id"] = profile.get("scope_id", userId).asString();
        out["organization_type"] = profile.get("organization_type", "").asString();
        out["plan"] = plan;
        out["status"] = status;
        out["expires_at"] = expiresAt;
        out["entitlements"] = entitlementsFor(plan);
        out["accessible_levels"] = accessibleLevelsFor(plan);
        out["is_active"] = isActiveStatus(status);
        return out;
    }

    bool hasPlanAtLeast(const std::string &userId, const std::string &requiredPlan) const
    {
        return isAccessible(currentSubscription(userId), normalizePlan(requiredPlan));
    }

    Json::Value grantSubscription(
        const std::string &userId,
        const std::string &plan,
        const std::string &expiresAt,
        const std::string &status = "active")
    {
        auto profile = profileRepository_.loadProfile(userId);
        profile["plan"] = normalizePlan(plan);
        profile["plan_status"] = normalizeStatus(status, expiresAt);
        profile["plan_expires_at"] = expiresAt;
        profileRepository_.saveProfile(userId, profile);
        return currentSubscription(userId);
    }

    bool isPremium(const std::string &userId) const
    {
        return hasPlanAtLeast(userId, "pro");
    }

  private:
    static bool isAccessible(const Json::Value &subscription, const std::string &requiredPlan)
    {
        if (!isActiveStatus(subscription.get("status", "active").asString()))
        {
            return false;
        }
        return planRank(subscription.get("plan", "free").asString()) >= planRank(requiredPlan);
    }

    static bool isActiveStatus(const std::string &status)
    {
        return status == "active" || status == "trial";
    }

    static int planRank(const std::string &plan)
    {
        const auto normalized = normalizePlan(plan);
        if (normalized == "ultra")
        {
            return 2;
        }
        if (normalized == "pro")
        {
            return 1;
        }
        return 0;
    }

    static std::string normalizePlan(const std::string &plan)
    {
        if (plan == "premium")
        {
            return "pro";
        }
        if (plan == "pro" || plan == "ultra" || plan == "free")
        {
            return plan;
        }
        return "free";
    }

    static std::string normalizeStatus(const std::string &status, const std::string &expiresAt)
    {
        std::string normalized = status;
        if (normalized != "active" && normalized != "trial" && normalized != "expired" && normalized != "canceled")
        {
            normalized = "active";
        }
        if (!expiresAt.empty())
        {
            const auto expiryDate = expiresAt.size() >= 10 ? expiresAt.substr(0, 10) : expiresAt;
            if (!expiryDate.empty() && expiryDate < currentIso8601Date())
            {
                normalized = "expired";
            }
        }
        return normalized;
    }

    static Json::Value entitlementsFor(const std::string &plan)
    {
        Json::Value entitlements(Json::arrayValue);
        for (const auto &item : entitlementList(plan))
        {
            entitlements.append(item);
        }
        return entitlements;
    }

    static Json::Value accessibleLevelsFor(const std::string &plan)
    {
        Json::Value levels(Json::arrayValue);
        levels.append("free");
        if (planRank(plan) >= 1)
        {
            levels.append("pro");
        }
        if (planRank(plan) >= 2)
        {
            levels.append("ultra");
        }
        return levels;
    }

    static std::vector<std::string> entitlementList(const std::string &plan)
    {
        std::vector<std::string> entitlements = {
            "exam.free",
            "profile.basic",
            "progress.basic"};
        if (planRank(plan) >= 1)
        {
            entitlements.push_back("exam.pro");
            entitlements.push_back("bookmark");
            entitlements.push_back("weak_points");
            entitlements.push_back("recommendation");
        }
        if (planRank(plan) >= 2)
        {
            entitlements.push_back("exam.ultra");
            entitlements.push_back("analysis.advanced");
            entitlements.push_back("training.specialized");
            entitlements.push_back("export");
        }
        return entitlements;
    }

    static std::string currentIso8601Date()
    {
        using namespace std::chrono;
        const auto now = system_clock::now();
        const auto t = system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        gmtime_s(&tm, &t);
#else
        gmtime_r(&t, &tm);
#endif
        char buf[11];
        std::strftime(buf, sizeof(buf), "%Y-%m-%d", &tm);
        return buf;
    }

    infrastructure::storage::ProfileRepository &profileRepository_;
};
}  // namespace application::services
