#pragma once

#include <string>

#include <json/json.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class SubscriptionService
{
  public:
    explicit SubscriptionService(infrastructure::storage::ProfileRepository &profileRepository,
                                                                 infrastructure::storage::OrganizationRepository &organizationRepository,
                                                                 infrastructure::storage::UserRepository &userRepository,
                                                                 int referralRewardCredits = 10)
                : profileRepository_(profileRepository),
                    organizationRepository_(organizationRepository),
                    userRepository_(userRepository),
                    referralRewardCredits_(referralRewardCredits < 0 ? 0 : referralRewardCredits)
    {
    }

    Json::Value currentSubscription(const std::string &userId) const
    {
        const auto profile = profileRepository_.loadProfile(userId);
        const auto scopeType = profile.get("scope_type", "personal").asString();
        const auto scopeId = profile.get("scope_id", userId).asString();
        if (scopeType == "organization" && !scopeId.empty() && scopeId != userId)
        {
            const auto membership = organizationRepository_.findMembership(userId, scopeId);
            if (!membership.isNull())
            {
                return subscriptionForOrganization(scopeId);
            }
        }
        return subscriptionForUser(userId);
    }

    Json::Value subscriptionForUser(const std::string &userId) const
    {
        const auto profile = profileRepository_.loadProfile(userId);
        return buildSubscription(
            "personal",
            userId,
            "",
            normalizePlan(profile.get("plan", "free").asString()),
            normalizeStatus(profile.get("plan_status", "active").asString()),
            profile.get("plan_expires_at", profile.get("plan_expires", "")).asString(),
            0);
    }

    Json::Value subscriptionForOrganization(const std::string &organizationId) const
    {
        const auto organization = organizationRepository_.findOrganization(organizationId);
        if (organization.isNull())
        {
            throw common::AppException("ORGANIZATION_NOT_FOUND", "Organization not found: " + organizationId, drogon::k404NotFound);
        }

        const auto subscription = organization.get("subscription", Json::Value(Json::objectValue));
        const auto plan = normalizePlan(subscription.get("plan", "free").asString());
        return buildSubscription(
            "organization",
            organizationId,
            organization.get("organization_type", "business").asString(),
            plan,
            normalizeStatus(subscription.get("status", "active").asString()),
            subscription.get("expires_at", "").asString(),
            subscription.get("seats", defaultSeatsForPlan(plan)).asInt());
    }

    Json::Value updateUserSubscription(const std::string &userId, const Json::Value &patch)
    {
        auto profile = profileRepository_.loadProfile(userId);
        profile["plan"] = normalizePlan(patch.get("plan", profile.get("plan", "free")).asString());
        profile["plan_status"] = normalizeStatus(patch.get("status", profile.get("plan_status", "active")).asString());
        profile["plan_expires_at"] = patch.get("expires_at", profile.get("plan_expires_at", "")).asString();
        profile["plan_expires"] = profile["plan_expires_at"].asString();
        profileRepository_.saveProfile(userId, profile);
        const auto subscription = subscriptionForUser(userId);
        settleReferralReward(userId, subscription);
        return subscription;
    }

    Json::Value updateOrganizationSubscription(const std::string &organizationId, const Json::Value &patch)
    {
        auto organization = organizationRepository_.findOrganization(organizationId);
        if (organization.isNull())
        {
            throw common::AppException("ORGANIZATION_NOT_FOUND", "Organization not found: " + organizationId, drogon::k404NotFound);
        }

        auto subscription = organization.get("subscription", Json::Value(Json::objectValue));
        subscription["plan"] = normalizePlan(patch.get("plan", subscription.get("plan", "free")).asString());
        subscription["status"] = normalizeStatus(patch.get("status", subscription.get("status", "active")).asString());
        subscription["expires_at"] = patch.get("expires_at", subscription.get("expires_at", "")).asString();
        subscription["seats"] = patch.get("seats", subscription.get("seats", defaultSeatsForPlan(subscription["plan"].asString()))).asInt();
        organization["subscription"] = subscription;
        organizationRepository_.upsertOrganization(organization);
        return subscriptionForOrganization(organizationId);
    }

    void requireAccess(const std::string &userId, const std::string &examAccessLevel) const
    {
        const auto normalizedAccessLevel = examAccessLevel == "premium" ? std::string("pro") : examAccessLevel;
        if (normalizedAccessLevel.empty() || normalizedAccessLevel == "free")
        {
            return;
        }

        const auto subscription = currentSubscription(userId);
        if (!subscription.get("is_active", false).asBool())
        {
            throw common::AppException(
                "EXAM_ACCESS_DENIED",
                "This exam requires an active subscription",
                drogon::k403Forbidden);
        }

        const auto plan = subscription.get("plan", "free").asString();
        if (normalizedAccessLevel == "pro" && (plan == "pro" || plan == "ultra"))
        {
            return;
        }

        if (normalizedAccessLevel == "ultra" && plan == "ultra")
        {
            return;
        }

        if (contains(subscription["accessible_levels"], normalizedAccessLevel) || contains(subscription["entitlements"], normalizedAccessLevel))
        {
            return;
        }

        throw common::AppException(
            "EXAM_ACCESS_DENIED",
            "This exam requires a higher subscription tier",
            drogon::k403Forbidden);
    }

    bool isPremium(const std::string &userId) const
    {
        const auto subscription = currentSubscription(userId);
        const auto plan = subscription.get("plan", "free").asString();
        return subscription.get("is_active", false).asBool() && (plan == "pro" || plan == "ultra");
    }

    void grantPremium(const std::string &userId, const std::string &expiresAt)
    {
        Json::Value patch(Json::objectValue);
        patch["plan"] = "pro";
        patch["status"] = "active";
        patch["expires_at"] = expiresAt;
        updateUserSubscription(userId, patch);
    }

  private:
    void settleReferralReward(const std::string &userId, const Json::Value &subscription)
    {
        if (!qualifiesForReferralReward(subscription))
        {
            return;
        }

        const auto referredUser = userRepository_.findUserById(userId);
        if (referredUser.isNull())
        {
            return;
        }

        const auto referrerUserId = referredUser.get("referred_by_user_id", "").asString();
        if (referrerUserId.empty() || referredUser.get("referral_reward_status", "none").asString() != "pending")
        {
            return;
        }

        const auto rewardCredits = referralRewardCredits_;
        const auto rewardKey = std::string("referral:") + userId + ":subscription.activated";
        profileRepository_.grantCreditsIfAbsent(referrerUserId, rewardKey, rewardCredits, "referral.subscription.activated");
        userRepository_.grantReferralRewardIfPending(userId, "subscription.activated", rewardCredits, referrerUserId);
    }

    static Json::Value buildSubscription(const std::string &scopeType,
                                         const std::string &scopeId,
                                         const std::string &organizationType,
                                         const std::string &plan,
                                         const std::string &status,
                                         const std::string &expiresAt,
                                         int seats)
    {
        Json::Value out(Json::objectValue);
        out["scope_type"] = scopeType;
        out["scope_id"] = scopeId;
        out["organization_type"] = scopeType == "organization" ? organizationType : "";
        out["plan"] = normalizePlan(plan);
        out["status"] = normalizeStatus(status);
        out["expires_at"] = expiresAt;
        out["entitlements"] = entitlementsForPlan(out["plan"].asString(), scopeType);
        out["accessible_levels"] = accessibleLevelsForPlan(out["plan"].asString());
        out["is_active"] = isActive(out["status"].asString(), expiresAt);
        if (scopeType == "organization")
        {
            out["seats"] = seats > 0 ? seats : defaultSeatsForPlan(out["plan"].asString());
        }
        return out;
    }

    static Json::Value entitlementsForPlan(const std::string &plan, const std::string &scopeType)
    {
        Json::Value entitlements(Json::arrayValue);
        if (plan == "pro" || plan == "ultra")
        {
            entitlements.append("bookmark");
            entitlements.append("weak_points");
            entitlements.append("recommendation");
        }
        if (plan == "ultra")
        {
            entitlements.append("training.specialized");
            entitlements.append("export");
            entitlements.append("organization.portal");
        }
        if (scopeType == "organization")
        {
            entitlements.append("organization.member_manage");
        }
        return entitlements;
    }

    static Json::Value accessibleLevelsForPlan(const std::string &plan)
    {
        Json::Value levels(Json::arrayValue);
        levels.append("N5");
        levels.append("N4");
        if (plan == "pro" || plan == "ultra")
        {
            levels.append("N3");
            levels.append("N2");
        }
        if (plan == "ultra")
        {
            levels.append("N1");
        }
        return levels;
    }

    static int defaultSeatsForPlan(const std::string &plan)
    {
        if (plan == "ultra")
        {
            return 100;
        }
        if (plan == "pro")
        {
            return 25;
        }
        return 5;
    }

    static bool contains(const Json::Value &values, const std::string &expected)
    {
        if (!values.isArray())
        {
            return false;
        }
        for (const auto &value : values)
        {
            if (value.asString() == expected)
            {
                return true;
            }
        }
        return false;
    }

    static bool isActive(const std::string &status, const std::string &expiresAt)
    {
        if (status != "active" && status != "trial")
        {
            return false;
        }
        if (expiresAt.empty())
        {
            return true;
        }

        if (expiresAt.size() <= 10)
        {
            return expiresAt >= common::nowIso8601().substr(0, 10);
        }
        return expiresAt >= common::nowIso8601();
    }

    static bool qualifiesForReferralReward(const Json::Value &subscription)
    {
        const auto plan = normalizePlan(subscription.get("plan", "free").asString());
        return subscription.get("status", "active").asString() == "active" && (plan == "pro" || plan == "ultra");
    }

    static std::string normalizePlan(const std::string &plan)
    {
        if (plan == "premium")
        {
            return "pro";
        }
        if (plan == "free" || plan == "pro" || plan == "ultra")
        {
            return plan;
        }
        return "free";
    }

    static std::string normalizeStatus(const std::string &status)
    {
        if (status == "active" || status == "trial" || status == "expired" || status == "canceled")
        {
            return status;
        }
        return "active";
    }

    infrastructure::storage::ProfileRepository &profileRepository_;
    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    int referralRewardCredits_;
};
}  // namespace application::services
