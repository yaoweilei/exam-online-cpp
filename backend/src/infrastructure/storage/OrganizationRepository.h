#pragma once

#include <filesystem>
#include <functional>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include <json/json.h>

#include "JsonIo.h"
#include "SqliteJsonStore.h"
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

    Json::Value allOrganizationsArray(bool includeArchived = false) const;

    Json::Value listOrganizationsForUser(const std::string &userId) const;

    Json::Value findOrganization(const std::string &organizationId, bool includeArchived = false) const;

    Json::Value upsertOrganization(const Json::Value &organization);
    Json::Value updateOrganization(const std::string &organizationId, const std::function<void(Json::Value &)> &update, bool includeArchived = false);

    Json::Value listMembershipsForUser(const std::string &userId) const;

    Json::Value listMembershipsForScope(const std::string &scopeId) const;

    Json::Value findMembership(const std::string &userId, const std::string &scopeId) const;

    Json::Value upsertMembership(const Json::Value &membership);

    void removeMembership(const std::string &userId, const std::string &scopeId);

    std::size_t organizationCount() const;

    int memberCount(const std::string &scopeId) const;

    int billableMemberCount(const std::string &scopeId) const;

    static bool membershipUsesPaidSeat(const Json::Value &membership);

    std::unordered_map<std::string, int> memberCounts() const;

    std::unordered_map<std::string, int> billableMemberCounts() const;

  private:
    void ensureBaseline();

    void writeOrganizationsUnlocked(const Json::Value &organizations);
    void writeMembershipsUnlocked(const Json::Value &memberships);

    static std::string membershipStorageKey(const std::string &userId, const std::string &scopeId);

    static Json::Value normalizeOrganization(const Json::Value &input, const std::string &organizationId = "");

    static Json::Value normalizeMembership(const Json::Value &input, const std::string &membershipId = "");

    static void appendUniqueRole(Json::Value &roles, const std::string &role);

    static std::string normalizeRole(const std::string &role);

    std::filesystem::path organizationsFile_;
    std::filesystem::path membershipsFile_;
    mutable std::shared_mutex mutex_;
    SqliteJsonStore sqliteStore_;
    Json::Value organizationsCache_{Json::objectValue};
    Json::Value membershipsCache_{Json::objectValue};
};
}  // namespace infrastructure::storage
