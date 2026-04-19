#pragma once

#include <chrono>
#include <string>

#include <json/json.h>

#include "application/services/SubscriptionService.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class OrganizationService
{
  public:
    explicit OrganizationService(infrastructure::storage::OrganizationRepository &organizationRepository,
                                 infrastructure::storage::UserRepository &userRepository,
                                 SubscriptionService &subscriptionService)
        : organizationRepository_(organizationRepository),
          userRepository_(userRepository),
          subscriptionService_(subscriptionService)
    {
    }

    Json::Value listOrganizationsForUser(const std::string &userId, bool includeAll = false) const
    {
        const auto organizations = includeAll ? organizationRepository_.allOrganizationsArray()
                                              : organizationRepository_.listOrganizationsForUser(userId);
        Json::Value out(Json::arrayValue);
        for (const auto &organization : organizations)
        {
            out.append(enrichOrganization(organization));
        }
        return out;
    }

    Json::Value getOrganization(const std::string &organizationId) const
    {
        return enrichOrganization(requireOrganization(organizationId));
    }

    Json::Value createOrganization(const std::string &actorUserId, const Json::Value &payload)
    {
        const auto actor = userRepository_.findUserById(actorUserId);
        if (actor.isNull())
        {
            throw common::AppException("USER_NOT_FOUND", "User not found: " + actorUserId, drogon::k404NotFound);
        }

        const auto name = payload.get("name", "").asString();
        if (name.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Missing field: name", drogon::k422UnprocessableEntity);
        }

        const auto organizationType = normalizeOrganizationType(payload.get("organization_type", "").asString());
        if (organizationType.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "organization_type must be business or school", drogon::k422UnprocessableEntity);
        }

        const auto organizationId = payload.get("organization_id", "").asString().empty()
                                        ? generateOrganizationId()
                                        : payload.get("organization_id", "").asString();

        Json::Value organization(Json::objectValue);
        organization["organization_id"] = organizationId;
        organization["name"] = name;
        organization["organization_type"] = organizationType;
        organization["created_by"] = actorUserId;
        organization["created_at"] = common::nowIso8601();

        Json::Value subscription(Json::objectValue);
        subscription["plan"] = payload.get("plan", "free").asString();
        subscription["status"] = payload.get("status", "active").asString();
        subscription["expires_at"] = payload.get("expires_at", "").asString();
        subscription["seats"] = payload.get("seats", 0).asInt();
        organization["subscription"] = subscription;

        const auto savedOrganization = organizationRepository_.upsertOrganization(organization);

        Json::Value membership(Json::objectValue);
        membership["user_id"] = actorUserId;
        membership["scope_type"] = "organization";
        membership["scope_id"] = organizationId;
        membership["organization_type"] = organizationType;
        membership["roles"] = payload.isMember("owner_roles") ? payload["owner_roles"] : defaultOwnerRoles();
        membership = assignBusinessNumbers(savedOrganization, membership, Json::Value(Json::nullValue));
        organizationRepository_.upsertMembership(membership);

        return enrichOrganization(savedOrganization);
    }

    Json::Value listMembers(const std::string &organizationId) const
    {
        requireOrganization(organizationId);
        Json::Value out(Json::arrayValue);
        const auto members = organizationRepository_.listMembershipsForScope(organizationId);
        for (const auto &member : members)
        {
            out.append(enrichMembership(member));
        }
        return out;
    }

    Json::Value upsertMember(const std::string &organizationId, const Json::Value &payload)
    {
        const auto organization = requireOrganization(organizationId);
        const auto userId = payload.get("user_id", "").asString();
        if (userId.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Missing field: user_id", drogon::k422UnprocessableEntity);
        }

        const auto user = userRepository_.findUserById(userId);
        if (user.isNull())
        {
            throw common::AppException("USER_NOT_FOUND", "User not found: " + userId, drogon::k404NotFound);
        }

        const auto existing = organizationRepository_.findMembership(userId, organizationId);
        const auto subscription = subscriptionService_.subscriptionForOrganization(organizationId);
        const auto seats = subscription.get("seats", 0).asInt();
        if (existing.isNull() && seats > 0 && organizationRepository_.memberCount(organizationId) >= seats)
        {
            throw common::AppException("ORGANIZATION_SEATS_FULL", "Organization seat limit reached", drogon::k409Conflict);
        }

        Json::Value membership(Json::objectValue);
        membership["membership_id"] = existing.isNull() ? Json::Value(Json::nullValue) : existing.get("membership_id", "");
        membership["user_id"] = userId;
        membership["scope_type"] = "organization";
        membership["scope_id"] = organizationId;
        membership["organization_type"] = organization.get("organization_type", "business").asString();
        membership["roles"] = payload.isMember("roles") ? payload["roles"] : defaultMemberRoles();
        membership["joined_at"] = existing.isNull() ? common::nowIso8601() : existing.get("joined_at", common::nowIso8601()).asString();
        membership["member_no"] = payload.get("member_no", existing.get("member_no", "")).asString();
        membership["student_no"] = payload.get("student_no", existing.get("student_no", "")).asString();
        membership["employee_no"] = payload.get("employee_no", existing.get("employee_no", "")).asString();
        membership = assignBusinessNumbers(organization, membership, existing);

        return enrichMembership(organizationRepository_.upsertMembership(membership));
    }

    void removeMember(const std::string &organizationId, const std::string &userId)
    {
        requireOrganization(organizationId);
        organizationRepository_.removeMembership(userId, organizationId);
    }

    bool canAccessOrganization(const std::string &actorUserId, const Json::Value &actorRoles, const std::string &organizationId) const
    {
        if (hasPlatformRole(actorRoles))
        {
            return true;
        }
        return !organizationRepository_.findMembership(actorUserId, organizationId).isNull();
    }

    bool canManageOrganization(const std::string &actorUserId, const Json::Value &actorRoles, const std::string &organizationId) const
    {
        if (hasPlatformRole(actorRoles))
        {
            return true;
        }

        const auto membership = organizationRepository_.findMembership(actorUserId, organizationId);
        if (membership.isNull())
        {
            return false;
        }

        for (const auto &role : membership["roles"])
        {
            if (role.asString() == "orgAdmin")
            {
                return true;
            }
        }
        return false;
    }

  private:
    Json::Value requireOrganization(const std::string &organizationId) const
    {
        const auto organization = organizationRepository_.findOrganization(organizationId);
        if (organization.isNull())
        {
            throw common::AppException("ORGANIZATION_NOT_FOUND", "Organization not found: " + organizationId, drogon::k404NotFound);
        }
        return organization;
    }

    Json::Value enrichOrganization(Json::Value organization) const
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        organization["member_count"] = organizationRepository_.memberCount(organizationId);
        organization["subscription"] = subscriptionService_.subscriptionForOrganization(organizationId);
        organization["seats"] = organization["subscription"].get("seats", 0).asInt();
        return organization;
    }

    Json::Value enrichMembership(Json::Value membership) const
    {
        const auto user = userRepository_.findUserById(membership.get("user_id", "").asString());
        if (!user.isNull())
        {
            membership["username"] = user.get("username", "").asString();
            membership["status"] = user.get("status", "active").asString();
        }

        const auto organization = organizationRepository_.findOrganization(membership.get("scope_id", "").asString());
        if (!organization.isNull())
        {
            membership["organization_id"] = organization.get("organization_id", "").asString();
            membership["organization_name"] = organization.get("name", "").asString();
        }
        return membership;
    }

    Json::Value assignBusinessNumbers(const Json::Value &organization, Json::Value membership, const Json::Value &existing) const
    {
        const auto organizationId = organization.get("organization_id", "").asString();
        const auto organizationType = organization.get("organization_type", "business").asString();

        auto memberNo = membership.get("member_no", existing.get("member_no", "")).asString();
        auto studentNo = membership.get("student_no", existing.get("student_no", "")).asString();
        auto employeeNo = membership.get("employee_no", existing.get("employee_no", "")).asString();

        if (memberNo.empty())
        {
            memberNo = !studentNo.empty() ? studentNo : employeeNo;
        }
        if (memberNo.empty())
        {
            memberNo = nextOrganizationMemberNo(organizationId, organizationType);
        }

        membership["member_no"] = memberNo;
        if (organizationType == "school")
        {
            membership["student_no"] = studentNo.empty() ? memberNo : studentNo;
            membership["employee_no"] = "";
        }
        else
        {
            membership["employee_no"] = employeeNo.empty() ? memberNo : employeeNo;
            membership["student_no"] = "";
        }
        return membership;
    }

    std::string nextOrganizationMemberNo(const std::string &organizationId, const std::string &organizationType) const
    {
        const auto memberships = organizationRepository_.listMembershipsForScope(organizationId);
        int maxSerial = 0;
        const auto prefix = organizationType == "school" ? std::string("STU-") : std::string("EMP-");
        for (const auto &membership : memberships)
        {
            maxSerial = (std::max)(maxSerial, extractPrefixedSerial(membership.get("member_no", "").asString(), prefix));
            maxSerial = (std::max)(maxSerial, extractPrefixedSerial(membership.get("student_no", "").asString(), prefix));
            maxSerial = (std::max)(maxSerial, extractPrefixedSerial(membership.get("employee_no", "").asString(), prefix));
        }
        return prefix + padSerial(maxSerial + 1, 6);
    }

    static int extractPrefixedSerial(const std::string &value, const std::string &prefix)
    {
        if (value.rfind(prefix, 0) != 0)
        {
            return 0;
        }
        const auto serial = value.substr(prefix.size());
        if (serial.empty())
        {
            return 0;
        }
        for (const auto ch : serial)
        {
            if (ch < '0' || ch > '9')
            {
                return 0;
            }
        }
        return std::stoi(serial);
    }

    static std::string padSerial(int value, int width)
    {
        auto text = std::to_string(value);
        if (static_cast<int>(text.size()) >= width)
        {
            return text;
        }
        return std::string(static_cast<size_t>(width - text.size()), '0') + text;
    }

    static std::string normalizeOrganizationType(const std::string &organizationType)
    {
        if (organizationType == "business" || organizationType == "school")
        {
            return organizationType;
        }
        return "";
    }

    static Json::Value defaultOwnerRoles()
    {
        Json::Value roles(Json::arrayValue);
        roles.append("orgAdmin");
        return roles;
    }

    static Json::Value defaultMemberRoles()
    {
        Json::Value roles(Json::arrayValue);
        roles.append("student");
        return roles;
    }

    static std::string generateOrganizationId()
    {
        return common::generateOpaqueId("org_");
    }

    static bool hasPlatformRole(const Json::Value &roles)
    {
        for (const auto &role : roles)
        {
            const auto value = role.asString();
            if (value == "systemAdmin" || value == "superAdmin")
            {
                return true;
            }
        }
        return false;
    }

    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    SubscriptionService &subscriptionService_;
};
}  // namespace application::services