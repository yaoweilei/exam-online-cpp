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
        : organizationsFile_(std::move(userRootDir) / "organizations.json"),
          membershipsFile_(organizationsFile_.parent_path() / "memberships.json")
    {
        ensureBaseline();
    }

    Json::Value allOrganizationsArray() const
    {
        std::shared_lock lock(mutex_);
        Json::Value out(Json::arrayValue);
        const auto organizations = readOrganizationsUnlocked();
        for (const auto &organizationId : organizations.getMemberNames())
        {
            out.append(normalizeOrganization(organizations[organizationId], organizationId));
        }
        return out;
    }

    Json::Value listOrganizationsForUser(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        const auto organizations = readOrganizationsUnlocked();
        const auto memberships = readMembershipsUnlocked();

        Json::Value out(Json::arrayValue);
        std::unordered_set<std::string> seen;
        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("user_id", "").asString() != userId)
            {
                continue;
            }

            const auto scopeId = membership.get("scope_id", "").asString();
            if (scopeId.empty() || seen.contains(scopeId) || !organizations.isMember(scopeId))
            {
                continue;
            }
            seen.insert(scopeId);
            out.append(normalizeOrganization(organizations[scopeId], scopeId));
        }
        return out;
    }

    Json::Value findOrganization(const std::string &organizationId) const
    {
        std::shared_lock lock(mutex_);
        const auto organizations = readOrganizationsUnlocked();
        if (!organizations.isMember(organizationId))
        {
            return Json::Value(Json::nullValue);
        }
        return normalizeOrganization(organizations[organizationId], organizationId);
    }

    Json::Value upsertOrganization(const Json::Value &organization)
    {
        const auto organizationId = organization.get("organization_id", organization.get("scope_id", "")).asString();
        if (organizationId.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Missing organization_id", drogon::k422UnprocessableEntity);
        }

        std::unique_lock lock(mutex_);
        auto organizations = readOrganizationsUnlocked();
        auto normalized = normalizeOrganization(organization, organizationId);
        normalized["updated_at"] = common::nowIso8601();
        if (!organizations.isMember(organizationId))
        {
            normalized["created_at"] = normalized.get("created_at", common::nowIso8601()).asString();
        }
        else if (!normalized.isMember("created_at") || normalized["created_at"].asString().empty())
        {
            normalized["created_at"] = organizations[organizationId].get("created_at", common::nowIso8601()).asString();
        }
        organizations[organizationId] = normalized;
        writeJsonFileAtomic(organizationsFile_, organizations);
        return normalized;
    }

    Json::Value listMembershipsForUser(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        const auto memberships = readMembershipsUnlocked();
        Json::Value out(Json::arrayValue);
        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("user_id", "").asString() == userId)
            {
                out.append(membership);
            }
        }
        return out;
    }

    Json::Value listMembershipsForScope(const std::string &scopeId) const
    {
        std::shared_lock lock(mutex_);
        const auto memberships = readMembershipsUnlocked();
        Json::Value out(Json::arrayValue);
        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("scope_id", "").asString() == scopeId)
            {
                out.append(membership);
            }
        }
        return out;
    }

    Json::Value findMembership(const std::string &userId, const std::string &scopeId) const
    {
        std::shared_lock lock(mutex_);
        const auto memberships = readMembershipsUnlocked();
        const auto compositeId = membershipStorageKey(userId, scopeId);
        if (memberships.isMember(compositeId))
        {
            return normalizeMembership(memberships[compositeId]);
        }

        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("user_id", "").asString() == userId && membership.get("scope_id", "").asString() == scopeId)
            {
                return membership;
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value upsertMembership(const Json::Value &membership)
    {
        const auto userId = membership.get("user_id", "").asString();
        const auto scopeId = membership.get("scope_id", "").asString();
        if (userId.empty() || scopeId.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Membership requires user_id and scope_id", drogon::k422UnprocessableEntity);
        }

        std::unique_lock lock(mutex_);
        auto memberships = readMembershipsUnlocked();
        const auto key = membershipStorageKey(userId, scopeId);
        auto normalized = normalizeMembership(membership, key);
        const auto currentMembershipId = normalized.get("membership_id", "").asString();
        if (currentMembershipId.empty() || currentMembershipId == key)
        {
            normalized["membership_id"] = common::generateOpaqueId("mem_");
        }
        memberships[key] = normalized;
        writeJsonFileAtomic(membershipsFile_, memberships);
        return memberships[key];
    }

    void removeMembership(const std::string &userId, const std::string &scopeId)
    {
        std::unique_lock lock(mutex_);
        auto memberships = readMembershipsUnlocked();
        const auto key = membershipStorageKey(userId, scopeId);
        if (memberships.isMember(key))
        {
            memberships.removeMember(key);
            writeJsonFileAtomic(membershipsFile_, memberships);
            return;
        }

        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("user_id", "").asString() == userId && membership.get("scope_id", "").asString() == scopeId)
            {
                memberships.removeMember(membershipId);
                writeJsonFileAtomic(membershipsFile_, memberships);
                return;
            }
        }
    }

    int memberCount(const std::string &scopeId) const
    {
        std::shared_lock lock(mutex_);
        const auto memberships = readMembershipsUnlocked();
        int count = 0;
        for (const auto &membershipId : memberships.getMemberNames())
        {
            const auto membership = normalizeMembership(memberships[membershipId]);
            if (membership.get("scope_id", "").asString() == scopeId)
            {
                ++count;
            }
        }
        return count;
    }

  private:
    void ensureBaseline()
    {
        std::unique_lock lock(mutex_);
        if (!std::filesystem::exists(organizationsFile_))
        {
            writeJsonFileAtomic(organizationsFile_, Json::Value(Json::objectValue));
        }
        if (!std::filesystem::exists(membershipsFile_))
        {
            writeJsonFileAtomic(membershipsFile_, Json::Value(Json::objectValue));
        }
    }

    Json::Value readOrganizationsUnlocked() const
    {
        if (!std::filesystem::exists(organizationsFile_))
        {
            return Json::Value(Json::objectValue);
        }
        return readJsonFile(organizationsFile_);
    }

    Json::Value readMembershipsUnlocked() const
    {
        if (!std::filesystem::exists(membershipsFile_))
        {
            return Json::Value(Json::objectValue);
        }
        return readJsonFile(membershipsFile_);
    }

    static std::string membershipStorageKey(const std::string &userId, const std::string &scopeId)
    {
        return scopeId + ":" + userId;
    }

    static Json::Value normalizeOrganization(const Json::Value &input, const std::string &organizationId = "")
    {
        Json::Value organization = input.isObject() ? input : Json::Value(Json::objectValue);
        const auto scopeId = organizationId.empty() ? organization.get("organization_id", organization.get("scope_id", "")).asString() : organizationId;
        if (scopeId.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Organization requires organization_id", drogon::k422UnprocessableEntity);
        }

        organization["organization_id"] = scopeId;
        organization["scope_type"] = "organization";
        organization["scope_id"] = scopeId;
        organization["name"] = organization.get("name", scopeId).asString();

        const auto organizationType = organization.get("organization_type", "business").asString();
        organization["organization_type"] = (organizationType == "school") ? "school" : "business";
        organization["created_by"] = organization.get("created_by", "").asString();
        organization["created_at"] = organization.get("created_at", common::nowIso8601()).asString();
        organization["updated_at"] = organization.get("updated_at", organization["created_at"].asString()).asString();

        Json::Value subscription = organization.get("subscription", Json::Value(Json::objectValue));
        subscription["scope_type"] = "organization";
        subscription["scope_id"] = scopeId;
        subscription["organization_type"] = organization["organization_type"].asString();
        subscription["plan"] = subscription.get("plan", organization.get("plan", "free")).asString();
        subscription["status"] = subscription.get("status", organization.get("status", "active")).asString();
        subscription["expires_at"] = subscription.get("expires_at", organization.get("expires_at", "")).asString();
        subscription["seats"] = subscription.get("seats", organization.get("seats", 0)).asInt();
        if (!subscription.isMember("entitlements") || !subscription["entitlements"].isArray())
        {
            subscription["entitlements"] = Json::arrayValue;
        }
        if (!subscription.isMember("accessible_levels") || !subscription["accessible_levels"].isArray())
        {
            subscription["accessible_levels"] = Json::arrayValue;
        }
        organization["subscription"] = subscription;
        return organization;
    }

    static Json::Value normalizeMembership(const Json::Value &input, const std::string &membershipId = "")
    {
        Json::Value membership = input.isObject() ? input : Json::Value(Json::objectValue);
        const std::string scopeType = membership.get("scope_type", "organization").asString() == "personal" ? "personal" : "organization";
        const auto userId = membership.get("user_id", "").asString();
        const auto scopeId = membership.get("scope_id", "").asString();
        if (userId.empty() || scopeId.empty())
        {
            throw common::AppException("VALIDATION_ERROR", "Membership requires user_id and scope_id", drogon::k422UnprocessableEntity);
        }

        membership["membership_id"] = membership.get(
            "membership_id",
            membershipId.empty() ? Json::Value("") : Json::Value(membershipId)).asString();
        membership["user_id"] = userId;
        membership["scope_type"] = scopeType;
        membership["scope_id"] = scopeId;

        if (scopeType == "organization")
        {
            const auto organizationType = membership.get("organization_type", "business").asString();
            membership["organization_type"] = (organizationType == "school") ? "school" : "business";
        }
        else
        {
            membership["organization_type"] = "";
        }

        membership["member_no"] = membership.get("member_no", membership.get("student_no", membership.get("employee_no", ""))).asString();
        membership["student_no"] = membership.get("student_no", "").asString();
        membership["employee_no"] = membership.get("employee_no", "").asString();

        if (scopeType == "organization" && membership["organization_type"].asString() == "school" && membership["student_no"].asString().empty())
        {
            membership["student_no"] = membership["member_no"].asString();
        }
        if (scopeType == "organization" && membership["organization_type"].asString() == "business" && membership["employee_no"].asString().empty())
        {
            membership["employee_no"] = membership["member_no"].asString();
        }

        Json::Value roles(Json::arrayValue);
        if (membership["roles"].isString())
        {
            appendUniqueRole(roles, membership["roles"].asString());
        }
        else if (membership["roles"].isArray())
        {
            for (const auto &role : membership["roles"])
            {
                appendUniqueRole(roles, role.asString());
            }
        }
        if (roles.empty())
        {
            roles.append("student");
        }
        membership["roles"] = roles;
        membership["joined_at"] = membership.get("joined_at", common::nowIso8601()).asString();
        return membership;
    }

    static void appendUniqueRole(Json::Value &roles, const std::string &role)
    {
        const auto normalized = normalizeRole(role);
        if (normalized.empty())
        {
            return;
        }
        for (const auto &item : roles)
        {
            if (item.asString() == normalized)
            {
                return;
            }
        }
        roles.append(normalized);
    }

    static std::string normalizeRole(const std::string &role)
    {
        if (role == "user")
        {
            return "student";
        }
        if (role == "admin")
        {
            return "systemAdmin";
        }
        if (role == "academicAdmin")
        {
            return "orgAdmin";
        }
        if (role == "guest" || role == "student" || role == "teacher" || role == "reviewer" || role == "orgAdmin" ||
            role == "systemAdmin" || role == "superAdmin")
        {
            return role;
        }
        return "";
    }

    std::filesystem::path organizationsFile_;
    std::filesystem::path membershipsFile_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage