#pragma once

#include "infrastructure/storage/OrganizationRepository.h"

namespace application::services
{
inline const Json::Value &effectiveLessonAttendance(const Json::Value &lesson)
{
    return lesson["corrected_attendance"].isArray() ? lesson["corrected_attendance"] : lesson["attendance"];
}
inline bool institutionHasRole(const Json::Value &roles, const std::string &role)
{
    for (const auto &value : roles) if (value.isString() && value.asString() == role) return true;
    return false;
}

inline Json::Value activeInstitutionMembership(
    const infrastructure::storage::OrganizationRepository &repository,
    const std::string &userId, const std::string &organizationId)
{
    const auto organization = repository.findOrganization(organizationId);
    const auto membership = repository.findMembership(userId, organizationId);
    if (organization.isNull() || membership.isNull() ||
        organization.get("status", "active").asString() != "active" ||
        membership.get("status", "active").asString() != "active") return Json::nullValue;
    return membership;
}

// Institution roles are evaluated for the requested organization, never added
// to the platform session (which would grant unrelated administrative access).
inline Json::Value institutionRolesForOrganization(
    const infrastructure::storage::OrganizationRepository &repository,
    const std::string &userId, const Json::Value &platformRoles,
    const std::string &organizationId)
{
    if (institutionHasRole(platformRoles, "superAdmin")) return platformRoles;
    const auto membership = activeInstitutionMembership(repository, userId, organizationId);
    Json::Value roles(Json::arrayValue);
    if (membership.isNull()) return roles;
    for (const auto &role : platformRoles)
        if (role.asString() != "orgAdmin") roles.append(role);
    for (const auto &role : membership["roles"])
        if (!institutionHasRole(roles, role.asString())) roles.append(role);
    return roles;
}
}
