#pragma once

#include <algorithm>
#include <cctype>
#include <string>
#include <unordered_set>
#include <vector>

#include <json/json.h>

#include "common/AppException.h"
#include "application/services/SubscriptionService.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class UserService
{
  public:
    explicit UserService(
        infrastructure::storage::UserRepository &repository,
        infrastructure::storage::ProfileRepository &profileRepository,
                infrastructure::storage::OrganizationRepository &organizationRepository,
        SubscriptionService &subscriptionService)
;

    Json::Value getUser(const std::string &userId) const;

    Json::Value usersByRole(const std::string &roleId) const;

    Json::Value searchUsers(const std::string &query, std::size_t limit = 12) const;

    Json::Value allRoles() const;

    Json::Value permissions(const std::string &userId) const;

    Json::Value context(const std::string &userId) const;

    Json::Value claimReferral(const std::string &userId, const std::string &referralCode) const;

  private:
    Json::Value requireUser(const std::string &userId) const;

    static bool hasAnyRole(const Json::Value &userRoles, const std::vector<std::string> &requiredRoles);

    static bool hasEntitlement(const Json::Value &entitlements, const std::string &required);

    Json::Value buildUserView(const Json::Value &user) const;

    static Json::Value buildProfileView(const Json::Value &profile, const Json::Value &subscription);

    static Json::Value buildBalance(const Json::Value &profile);

    static Json::Value buildReferralView(const Json::Value &user);

    Json::Value resolveMembership(const std::string &userId, const Json::Value &user, const Json::Value &profile) const;

    static Json::Value effectiveRoles(const Json::Value &baseRoles, const Json::Value &membershipRoles);

    static void appendUniqueRoles(Json::Value &target, const Json::Value &source);

    static Json::Value visibleFeatures(const Json::Value &userRoles, const Json::Value &subscription);

    static Json::Value visibleSections(const Json::Value &userRoles, const Json::Value &subscription);

    static std::string normalizeSearchText(const std::string &value);

    static int scoreSearchField(const std::string &field,
                                const std::string &needle,
                                const int exactScore,
                                const int prefixScore,
                                const int containsScore);

    static int scoreUserSearchMatch(const Json::Value &user, const Json::Value &profile, const std::string &needle);

  private:
    infrastructure::storage::UserRepository &repository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
        infrastructure::storage::OrganizationRepository &organizationRepository_;
    SubscriptionService &subscriptionService_;
};
}  // namespace application::services
