#pragma once

#include <filesystem>
#include <shared_mutex>
#include <string>

#include <drogon/utils/Utilities.h>
#include <json/json.h>

#include "WalStore.h"

namespace infrastructure::storage
{
class UserRepository
{
  public:
    explicit UserRepository(std::filesystem::path userRootDir);

    void ensureBaseline();

    Json::Value users() const;
    Json::Value roles() const;

    Json::Value findUserByUsername(const std::string &username) const;
    Json::Value findUserByEmail(const std::string &email) const;
    Json::Value findUserByLoginId(const std::string &loginId) const;
    Json::Value findUserById(const std::string &userId) const;
    Json::Value findUserByPhone(const std::string &phone) const;
    Json::Value findUserByOpenid(const std::string &openid) const;
    Json::Value findUserByReferralCode(const std::string &referralCode) const;

    Json::Value usersByRole(const std::string &roleId) const;

    Json::Value createUser(const std::string &username,
                           const std::string &password,
                           const std::string &email,
                           const std::string &referralCode = "");

    Json::Value createDevelopmentUser(const std::string &loginId);

    bool verifyPassword(const Json::Value &user, const std::string &password) const;

    Json::Value bindPhone(const std::string &userId, const std::string &phone);
    Json::Value bindEmail(const std::string &userId, const std::string &email);

    Json::Value createPhoneUser(const std::string &phone, const std::string &referralCode = "");

    Json::Value claimReferral(const std::string &userId, const std::string &referralCode);

    bool grantReferralRewardIfPending(const std::string &userId,
                                      const std::string &trigger,
                                      int rewardCredits = 0,
                                      const std::string &rewardRecipientUserId = "");

    Json::Value upsertWechatUser(const std::string &openid,
                                 const std::string &nickname,
                                 const std::string &avatarUrl,
                                 const std::string &loginIdHint = "");

    static std::string hashPassword(const std::string &password)
    {
        return drogon::utils::getSha256(password);
    }

  private:
    static Json::Value defaultRolesMap();
    static Json::Value normalizeUser(const Json::Value &input);
    static std::string normalizeReferralCode(std::string referralCode);
    static std::string normalizeReferralRewardStatus(const std::string &status);
    static Json::Value findUserByReferralCodeUnlocked(const Json::Value &usersJson,
                                                      const std::string &referralCode);
    static std::string generateReferralCode(const Json::Value &usersJson, const std::string &seed);
    static std::string buildReferralPrefix(const std::string &seed);
    static std::string legacyReferralCode(const std::string &userId, const std::string &username);
    static Json::Value mergeRoleDefinition(const Json::Value &baseline,
                                           const Json::Value &incoming,
                                           const std::string &roleId);
    static Json::Value normalizeRolesArray(const Json::Value &roles);
    static void appendUniqueStrings(Json::Value &target, const Json::Value &values);
    static void appendUniqueRole(Json::Value &target, const std::string &role);
    static std::string normalizeRoleId(const std::string &roleId);
    static std::string normalizeStatus(const std::string &status);
    static std::string normalizeScopeType(const std::string &scopeType);
    static std::string normalizeOrganizationType(const std::string &organizationType,
                                                 const std::string &scopeType);
    static bool containsUsername(const Json::Value &usersJson, const std::string &username);
    static bool matchesLoginId(const Json::Value &user, const std::string &loginId);
    static std::string uniqueStorageKey(const Json::Value &usersJson, const std::string &base);
    static std::string uniqueUsernameForBase(const Json::Value &usersJson, const std::string &base);
    static std::string nextPersonalMemberNo(const Json::Value &usersJson);
    static Json::Value developmentRolesForLoginId(const std::string &loginId);
    static std::string padSerial(int value, int width);
    static std::string sanitizeIdentifier(const std::string &value);
    static std::string sanitizePhone(const std::string &phone);
    static int extractPrefixedSerial(const std::string &value, const std::string &prefix);
    static std::string generateUserId();

    template <typename Func>
    static void forEachUserValue(const Json::Value &usersJson, Func visitor)
    {
        if (usersJson.isArray())
        {
            for (const auto &entry : usersJson)
            {
                if (entry.isObject())
                {
                    visitor(entry);
                }
            }
            return;
        }
        if (!usersJson.isObject())
        {
            return;
        }
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto &entry = usersJson[name];
            if (name == "users" && entry.isArray())
            {
                for (const auto &legacyEntry : entry)
                {
                    if (legacyEntry.isObject())
                    {
                        visitor(legacyEntry);
                    }
                }
                continue;
            }
            if (entry.isObject())
            {
                visitor(entry);
            }
        }
    }

    template <typename Func>
    static void forEachUserValue(Json::Value &usersJson, Func visitor)
    {
        if (usersJson.isArray())
        {
            for (auto &entry : usersJson)
            {
                if (entry.isObject())
                {
                    visitor(entry);
                }
            }
            return;
        }
        if (!usersJson.isObject())
        {
            return;
        }
        for (const auto &name : usersJson.getMemberNames())
        {
            auto &entry = usersJson[name];
            if (name == "users" && entry.isArray())
            {
                for (auto &legacyEntry : entry)
                {
                    if (legacyEntry.isObject())
                    {
                        visitor(legacyEntry);
                    }
                }
                continue;
            }
            if (entry.isObject())
            {
                visitor(entry);
            }
        }
    }

    std::filesystem::path userRootDir_;
    std::filesystem::path usersFile_;
    std::filesystem::path rolesFile_;
    mutable std::shared_mutex mutex_;
    WalStore wal_;
    std::size_t recoveredEvents_{0};
};
}  // namespace infrastructure::storage
