#pragma once

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_set>

#include <json/json.h>

#include "JsonIo.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class OrganizationRepository
{
  public:
    explicit OrganizationRepository(std::filesystem::path userRootDir)
;

    Json::Value allOrganizationsArray() const;

    Json::Value listOrganizationsForUser(const std::string &userId) const;

    Json::Value findOrganization(const std::string &organizationId) const;

    Json::Value upsertOrganization(const Json::Value &organization);

    Json::Value listMembershipsForUser(const std::string &userId) const;

    Json::Value listMembershipsForScope(const std::string &scopeId) const;

    Json::Value findMembership(const std::string &userId, const std::string &scopeId) const;

    Json::Value upsertMembership(const Json::Value &membership);

    void removeMembership(const std::string &userId, const std::string &scopeId);

    int memberCount(const std::string &scopeId) const;

  private:
    void ensureBaseline();

    Json::Value readOrganizationsUnlocked() const;

    Json::Value readMembershipsUnlocked() const;

    static std::string membershipStorageKey(const std::string &userId, const std::string &scopeId);

    static Json::Value normalizeOrganization(const Json::Value &input, const std::string &organizationId = "");

    static Json::Value normalizeMembership(const Json::Value &input, const std::string &membershipId = "");

    static void appendUniqueRole(Json::Value &roles, const std::string &role);

    static std::string normalizeRole(const std::string &role);

    std::filesystem::path organizationsFile_;
    std::filesystem::path membershipsFile_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
