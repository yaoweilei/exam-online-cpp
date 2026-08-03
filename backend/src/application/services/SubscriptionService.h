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
;

    Json::Value currentSubscription(const std::string &userId) const;

    Json::Value subscriptionForUser(const std::string &userId) const;

    Json::Value subscriptionForOrganization(const std::string &organizationId) const;

    Json::Value updateUserSubscription(const std::string &userId, const Json::Value &patch);

    Json::Value updateOrganizationSubscription(const std::string &organizationId, const Json::Value &patch);

    void requireAccess(const std::string &userId, const std::string &examAccessLevel) const;

    bool hasEntitlement(const std::string &userId, const std::string &entitlementKey) const;

    void requireEntitlement(const std::string &userId,
                            const std::string &entitlementKey,
                            const std::string &errorMessage = "") const;

    bool isPremium(const std::string &userId) const;

    void grantPremium(const std::string &userId, const std::string &expiresAt);

  private:
    void settleReferralReward(const std::string &userId, const Json::Value &subscription);

    static Json::Value buildSubscription(const std::string &scopeType,
                                         const std::string &scopeId,
                                         const std::string &organizationType,
                                         const std::string &plan,
                                         const std::string &status,
                                         const std::string &expiresAt,
                                         int seats);

    static Json::Value entitlementsForPlan(const std::string &plan, const std::string &scopeType);

    static Json::Value entitlementAccessForPlan(const std::string &plan, const std::string &scopeType);

    static Json::Value accessibleLevelsForPlan(const std::string &plan);

    static std::string minimumPlanForEntitlement(const std::string &entitlementKey);

    static int defaultSeatsForPlan(const std::string &plan);

    static bool contains(const Json::Value &values, const std::string &expected);

    static bool isActive(const std::string &status, const std::string &expiresAt);

    static bool qualifiesForReferralReward(const Json::Value &subscription);

    static std::string normalizePlan(const std::string &plan);

    static std::string normalizeStatus(const std::string &status);

    infrastructure::storage::ProfileRepository &profileRepository_;
    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    int referralRewardCredits_;
};
}  // namespace application::services
