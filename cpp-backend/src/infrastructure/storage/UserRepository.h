#pragma once

#include <chrono>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <drogon/utils/Utilities.h>
#include <json/json.h>

#include "JsonIo.h"
#include "WalStore.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class UserRepository
{
  public:
    explicit UserRepository(std::filesystem::path userRootDir)
        : userRootDir_(std::move(userRootDir)),
          usersFile_(userRootDir_ / "users.json"),
          rolesFile_(userRootDir_ / "roles.json"),
          wal_(userRootDir_ / "_users.wal.log", userRootDir_ / "_users.wal.snapshot.json")
    {
        std::filesystem::create_directories(userRootDir_);
        recoveredEvents_ = wal_.recover().size();
        ensureBaseline();
    }

    void ensureBaseline()
    {
        std::unique_lock lock(mutex_);
        if (!std::filesystem::exists(usersFile_))
        {
            Json::Value users(Json::objectValue);
            users["guest"]["id"] = "guest";
            users["guest"]["user_id"] = "guest";
            users["guest"]["username"] = "guest";
            users["guest"]["password_hash"] = hashPassword("guest");
            users["guest"]["password_algo"] = "sha256";
            users["guest"]["status"] = "active";
            users["guest"]["email"] = "";
            users["guest"]["phone"] = "";
            users["guest"]["phone_verified"] = false;
            users["guest"]["member_no"] = "";
            users["guest"]["scope_type"] = "personal";
            users["guest"]["scope_id"] = "guest";
            users["guest"]["organization_type"] = "";
            users["guest"]["roles"] = Json::arrayValue;
            users["guest"]["roles"].append("guest");
            users["guest"]["created_at"] = common::nowIso8601();
            writeJsonFileAtomic(usersFile_, users);
        }

        if (!std::filesystem::exists(rolesFile_))
        {
            writeJsonFileAtomic(rolesFile_, defaultRolesMap());
            return;
        }

        auto roles = readJsonFile(rolesFile_);
        Json::Value normalized = defaultRolesMap();
        if (roles.isMember("roles") && roles["roles"].isArray())
        {
            for (const auto &role : roles["roles"])
            {
                const auto id = normalizeRoleId(role.get("id", "").asString());
                if (id.empty())
                {
                    continue;
                }
                normalized[id] = mergeRoleDefinition(normalized[id], role, id);
            }
        }
        else if (roles.isObject())
        {
            for (const auto &id : roles.getMemberNames())
            {
                const auto normalizedId = normalizeRoleId(id);
                if (normalizedId.empty())
                {
                    continue;
                }
                normalized[normalizedId] = mergeRoleDefinition(normalized[normalizedId], roles[id], normalizedId);
            }
        }

        wal_.append("roles_normalized", normalized);
        writeJsonFileAtomic(rolesFile_, normalized);
    }

    Json::Value users() const
    {
        std::shared_lock lock(mutex_);
        auto rawUsers = readJsonFile(usersFile_);
        Json::Value normalized(Json::objectValue);
        for (const auto &key : rawUsers.getMemberNames())
        {
            normalized[key] = normalizeUser(rawUsers[key]);
        }
        return normalized;
    }

    Json::Value roles() const
    {
        std::shared_lock lock(mutex_);
        auto rolesJson = readJsonFile(rolesFile_);
        Json::Value normalized = defaultRolesMap();
        for (const auto &id : rolesJson.getMemberNames())
        {
            const auto normalizedId = normalizeRoleId(id);
            if (normalizedId.empty())
            {
                continue;
            }
            normalized[normalizedId] = mergeRoleDefinition(normalized[normalizedId], rolesJson[id], normalizedId);
        }
        return normalized;
    }

    Json::Value findUserByUsername(const std::string &username) const
    {
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto user = normalizeUser(usersJson[name]);
            if (user.get("username", "").asString() == username)
            {
                return user;
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value findUserByLoginId(const std::string &loginId) const
    {
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto user = normalizeUser(usersJson[name]);
            if (matchesLoginId(user, loginId))
            {
                return user;
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value findUserById(const std::string &userId) const
    {
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto user = normalizeUser(usersJson[name]);
            if (user.get("id", "").asString() == userId)
            {
                return user;
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value usersByRole(const std::string &roleId) const
    {
        const auto normalizedRole = normalizeRoleId(roleId);
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        Json::Value result(Json::arrayValue);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto user = normalizeUser(usersJson[name]);
            bool matched = false;
            for (const auto &role : user["roles"])
            {
                if (normalizeRoleId(role.asString()) == normalizedRole)
                {
                    matched = true;
                    break;
                }
            }
            if (normalizedRole == "guest" && user["roles"].empty())
            {
                matched = true;
            }
            if (matched)
            {
                result.append(user);
            }
        }
        return result;
    }

    Json::Value createUser(const std::string &username, const std::string &password, const std::string &email)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        if (containsUsername(usersJson, username))
        {
            throw common::AppException("USER_EXISTS", "Username already exists", drogon::k400BadRequest);
        }

        const auto userId = generateUserId();
        const auto key = userId;
        usersJson[key]["id"] = userId;
        usersJson[key]["user_id"] = userId;
        usersJson[key]["username"] = username;
        usersJson[key]["member_no"] = nextPersonalMemberNo(usersJson);
        usersJson[key]["password_hash"] = hashPassword(password);
        usersJson[key]["password_algo"] = "sha256";
        usersJson[key]["email"] = email;
        usersJson[key]["phone"] = "";
        usersJson[key]["phone_verified"] = false;
        usersJson[key]["status"] = "active";
        usersJson[key]["scope_type"] = "personal";
        usersJson[key]["scope_id"] = userId;
        usersJson[key]["organization_type"] = "";
        usersJson[key]["roles"] = Json::arrayValue;
        usersJson[key]["roles"].append("student");
        usersJson[key]["created_at"] = common::nowIso8601();

        wal_.append("user_created", usersJson[key]);
        writeJsonFileAtomic(usersFile_, usersJson);
        return normalizeUser(usersJson[key]);
    }

    Json::Value createDevelopmentUser(const std::string &loginId)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto user = normalizeUser(usersJson[name]);
            if (matchesLoginId(user, loginId))
            {
                return user;
            }
        }

        const auto userId = generateUserId();
        const auto key = userId;
        const auto loginKey = sanitizeIdentifier(loginId);
        const auto username = uniqueUsernameForBase(usersJson, loginId.empty() ? ("wxdev_" + loginKey) : loginId);

        usersJson[key]["id"] = userId;
        usersJson[key]["user_id"] = userId;
        usersJson[key]["username"] = username;
        usersJson[key]["member_no"] = nextPersonalMemberNo(usersJson);
        usersJson[key]["password_hash"] = "";
        usersJson[key]["password_algo"] = "dev-empty";
        usersJson[key]["email"] = "";
        usersJson[key]["phone"] = "";
        usersJson[key]["phone_verified"] = false;
        usersJson[key]["wechat_openid"] = "stub_openid_" + loginKey;
        usersJson[key]["wechat_nickname"] = username;
        usersJson[key]["dev_login_id"] = loginId;
        usersJson[key]["status"] = "active";
        usersJson[key]["scope_type"] = "personal";
        usersJson[key]["scope_id"] = userId;
        usersJson[key]["organization_type"] = "";
        usersJson[key]["roles"] = Json::arrayValue;
        usersJson[key]["roles"].append("student");
        usersJson[key]["created_at"] = common::nowIso8601();

        wal_.append("development_user_created", usersJson[key]);
        writeJsonFileAtomic(usersFile_, usersJson);
        return normalizeUser(usersJson[key]);
    }

    bool verifyPassword(const Json::Value &user, const std::string &password) const
    {
        const auto algo = user.get("password_algo", "sha256").asString();
        if (algo == "sha256")
        {
            return user.get("password_hash", "").asString() == hashPassword(password);
        }
        if (algo == "plain")
        {
            return user.get("password", "").asString() == password;
        }
        return false;
    }

    // Bind (or update) a verified phone number to a user.
    Json::Value bindPhone(const std::string &userId, const std::string &phone)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("phone", "").asString() == phone && usersJson[name].get("id", "").asString() != userId)
            {
                throw common::AppException("PHONE_IN_USE", "Phone number is already bound to another user", drogon::k409Conflict);
            }
        }
        for (auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("id", "").asString() == userId)
            {
                usersJson[name]["phone"] = phone;
                usersJson[name]["phone_verified"] = true;
                wal_.append("phone_bound", usersJson[name]);
                writeJsonFileAtomic(usersFile_, usersJson);
                return normalizeUser(usersJson[name]);
            }
        }
        throw common::AppException("USER_NOT_FOUND", "User not found: " + userId, drogon::k404NotFound);
    }

    Json::Value findUserByPhone(const std::string &phone) const
    {
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("phone", "").asString() == phone)
            {
                return normalizeUser(usersJson[name]);
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value createPhoneUser(const std::string &phone)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("phone", "").asString() == phone)
            {
                return normalizeUser(usersJson[name]);
            }
        }

        const auto usernameBase = "phone_" + sanitizePhone(phone);
        const auto username = uniqueUsernameForBase(usersJson, usernameBase);
        const auto userId = generateUserId();
        const auto key = userId;
        usersJson[key]["id"] = userId;
        usersJson[key]["user_id"] = userId;
        usersJson[key]["username"] = username;
        usersJson[key]["member_no"] = nextPersonalMemberNo(usersJson);
        usersJson[key]["password_hash"] = "";
        usersJson[key]["password_algo"] = "phone";
        usersJson[key]["email"] = "";
        usersJson[key]["phone"] = phone;
        usersJson[key]["phone_verified"] = true;
        usersJson[key]["status"] = "active";
        usersJson[key]["scope_type"] = "personal";
        usersJson[key]["scope_id"] = userId;
        usersJson[key]["organization_type"] = "";
        usersJson[key]["roles"] = Json::arrayValue;
        usersJson[key]["roles"].append("student");
        usersJson[key]["created_at"] = common::nowIso8601();

        wal_.append("phone_user_created", usersJson[key]);
        writeJsonFileAtomic(usersFile_, usersJson);
        return normalizeUser(usersJson[key]);
    }

    // Find user by WeChat openid (returns null if not found).
    Json::Value findUserByOpenid(const std::string &openid) const
    {
        std::shared_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("wechat_openid", "").asString() == openid)
            {
                return normalizeUser(usersJson[name]);
            }
        }
        return Json::Value(Json::nullValue);
    }

    // Create or update a user by WeChat openid.
    Json::Value upsertWechatUser(const std::string &openid,
                                const std::string &nickname,
                                const std::string &avatarUrl,
                                const std::string &loginIdHint = "")
    {
        std::unique_lock lock(mutex_);
        auto usersJson = readJsonFile(usersFile_);

        // Search for existing user with this openid
        for (auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("wechat_openid", "").asString() == openid)
            {
                if (!nickname.empty())
                {
                    usersJson[name]["wechat_nickname"] = nickname;
                }
                if (!avatarUrl.empty())
                {
                    usersJson[name]["wechat_avatar"] = avatarUrl;
                }
                if (!loginIdHint.empty())
                {
                    usersJson[name]["dev_login_id"] = loginIdHint;
                }
                usersJson[name]["status"] = usersJson[name].get("status", "active").asString();
                if (usersJson[name]["roles"].empty())
                {
                    usersJson[name]["roles"] = Json::arrayValue;
                    usersJson[name]["roles"].append("student");
                }
                if (usersJson[name].get("member_no", "").asString().empty())
                {
                    usersJson[name]["member_no"] = nextPersonalMemberNo(usersJson);
                }
                wal_.append("wechat_user_updated", usersJson[name]);
                writeJsonFileAtomic(usersFile_, usersJson);
                return normalizeUser(usersJson[name]);
            }
        }

        // Create new user
        const auto userId = generateUserId();
        const auto usernameBase = loginIdHint.empty() ? ("wx_" + openid.substr(0, std::min(openid.size(), static_cast<size_t>(10)))) : loginIdHint;
        const auto username = uniqueUsernameForBase(usersJson, usernameBase);
        const auto key = userId;
        usersJson[key]["id"] = userId;
        usersJson[key]["user_id"] = userId;
        usersJson[key]["username"] = username;
        usersJson[key]["member_no"] = nextPersonalMemberNo(usersJson);
        usersJson[key]["password_hash"] = "";
        usersJson[key]["password_algo"] = "wechat";
        usersJson[key]["email"] = "";
        usersJson[key]["phone"] = "";
        usersJson[key]["phone_verified"] = false;
        usersJson[key]["wechat_openid"] = openid;
        usersJson[key]["wechat_nickname"] = nickname;
        usersJson[key]["wechat_avatar"] = avatarUrl;
        usersJson[key]["dev_login_id"] = loginIdHint;
        usersJson[key]["status"] = "active";
        usersJson[key]["scope_type"] = "personal";
        usersJson[key]["scope_id"] = userId;
        usersJson[key]["organization_type"] = "";
        usersJson[key]["roles"] = Json::arrayValue;
        usersJson[key]["roles"].append("student");
        usersJson[key]["created_at"] = common::nowIso8601();

        wal_.append("wechat_user_created", usersJson[key]);
        writeJsonFileAtomic(usersFile_, usersJson);
        return normalizeUser(usersJson[key]);
    }

    static std::string hashPassword(const std::string &password)
    {
        return drogon::utils::getSha256(password);
    }

  private:
    static Json::Value defaultRolesMap()
    {
        Json::Value roles(Json::objectValue);
        roles["guest"]["id"] = "guest";
        roles["guest"]["name"] = "访客";
        roles["guest"]["description"] = "未登录访客";
        roles["guest"]["permissions"] = Json::arrayValue;
        roles["guest"]["permissions"].append("view_exams");
        roles["guest"]["permissions"].append("submit_answers");

        roles["student"]["id"] = "student";
        roles["student"]["name"] = "学习者";
        roles["student"]["description"] = "默认业务角色";
        roles["student"]["permissions"] = Json::arrayValue;
        roles["student"]["permissions"].append("view_exams");
        roles["student"]["permissions"].append("submit_answers");
        roles["student"]["permissions"].append("save_progress");

        roles["teacher"]["id"] = "teacher";
        roles["teacher"]["name"] = "教师";
        roles["teacher"]["description"] = "题目与教学内容管理";
        roles["teacher"]["permissions"] = Json::arrayValue;
        roles["teacher"]["permissions"].append("question.manage");

        roles["reviewer"]["id"] = "reviewer";
        roles["reviewer"]["name"] = "阅卷员";
        roles["reviewer"]["description"] = "阅卷与审核";
        roles["reviewer"]["permissions"] = Json::arrayValue;
        roles["reviewer"]["permissions"].append("review.manage");

        roles["orgAdmin"]["id"] = "orgAdmin";
        roles["orgAdmin"]["name"] = "组织管理员";
        roles["orgAdmin"]["description"] = "组织成员与空间管理";
        roles["orgAdmin"]["permissions"] = Json::arrayValue;
        roles["orgAdmin"]["permissions"].append("organization.manage");

        roles["systemAdmin"]["id"] = "systemAdmin";
        roles["systemAdmin"]["name"] = "系统管理员";
        roles["systemAdmin"]["description"] = "系统运维管理";
        roles["systemAdmin"]["permissions"] = Json::arrayValue;
        roles["systemAdmin"]["permissions"].append("system.manage");

        roles["superAdmin"]["id"] = "superAdmin";
        roles["superAdmin"]["name"] = "超级管理员";
        roles["superAdmin"]["description"] = "平台全部权限";
        roles["superAdmin"]["permissions"] = Json::arrayValue;
        roles["superAdmin"]["permissions"].append("*");
        return roles;
    }

    static Json::Value normalizeUser(const Json::Value &input)
    {
        Json::Value user = input.isObject() ? input : Json::Value(Json::objectValue);
        const auto userId = user.get("id", user.get("user_id", "")).asString();
        user["id"] = userId;
        user["user_id"] = userId;
        user["username"] = user.get("username", "").asString();
        user["member_no"] = user.get("member_no", user.get("student_no", "")).asString();
        user["memberNo"] = user["member_no"].asString();
        user["student_no"] = user.get("student_no", "").asString();
        user["studentNo"] = user["student_no"].asString();
        user["employee_no"] = user.get("employee_no", "").asString();
        user["employeeNo"] = user["employee_no"].asString();
        user["dev_login_id"] = user.get("dev_login_id", "").asString();
        user["email"] = user.get("email", "").asString();
        user["phone"] = user.get("phone", "").asString();
        user["phone_verified"] = user.get("phone_verified", false).asBool();
        user["status"] = normalizeStatus(user.get("status", "active").asString());
        user["scope_type"] = normalizeScopeType(user.get("scope_type", "personal").asString());
        user["scope_id"] = user.get("scope_id", userId).asString();
        user["organization_type"] = normalizeOrganizationType(
            user.get("organization_type", user["scope_type"].asString() == "organization" ? "business" : "").asString(),
            user["scope_type"].asString());
        user["created_at"] = user.get("created_at", common::nowIso8601()).asString();
        user["roles"] = normalizeRolesArray(user["roles"]);
        return user;
    }

    static Json::Value mergeRoleDefinition(const Json::Value &baseline, const Json::Value &incoming, const std::string &roleId)
    {
        Json::Value merged = baseline.isObject() ? baseline : Json::Value(Json::objectValue);
        merged["id"] = roleId;
        merged["name"] = incoming.get("name", merged.get("name", roleId).asString()).asString();
        merged["description"] = incoming.get("description", merged.get("description", "").asString()).asString();

        Json::Value permissions(Json::arrayValue);
        appendUniqueStrings(permissions, merged["permissions"]);
        appendUniqueStrings(permissions, incoming["permissions"]);
        appendUniqueStrings(permissions, incoming["privileges"]);
        merged["permissions"] = permissions;
        return merged;
    }

    static Json::Value normalizeRolesArray(const Json::Value &roles)
    {
        Json::Value normalized(Json::arrayValue);

        if (roles.isString())
        {
            appendUniqueRole(normalized, normalizeRoleId(roles.asString()));
        }
        else if (roles.isArray())
        {
            for (const auto &role : roles)
            {
                appendUniqueRole(normalized, normalizeRoleId(role.asString()));
            }
        }

        if (normalized.empty())
        {
            normalized.append("student");
        }
        return normalized;
    }

    static void appendUniqueStrings(Json::Value &target, const Json::Value &values)
    {
        if (!values.isArray())
        {
            return;
        }
        for (const auto &value : values)
        {
            const auto item = value.asString();
            if (item.empty())
            {
                continue;
            }
            bool exists = false;
            for (const auto &current : target)
            {
                if (current.asString() == item)
                {
                    exists = true;
                    break;
                }
            }
            if (!exists)
            {
                target.append(item);
            }
        }
    }

    static void appendUniqueRole(Json::Value &target, const std::string &role)
    {
        if (role.empty())
        {
            return;
        }
        for (const auto &item : target)
        {
            if (item.asString() == role)
            {
                return;
            }
        }
        target.append(role);
    }

    static std::string normalizeRoleId(const std::string &roleId)
    {
        if (roleId == "user")
        {
            return "student";
        }
        if (roleId == "admin")
        {
            return "systemAdmin";
        }
        if (roleId == "academicAdmin")
        {
            return "orgAdmin";
        }
        if (roleId == "guest" || roleId == "student" || roleId == "teacher" || roleId == "reviewer" ||
            roleId == "orgAdmin" || roleId == "systemAdmin" || roleId == "superAdmin")
        {
            return roleId;
        }
        return "";
    }

    static std::string normalizeStatus(const std::string &status)
    {
        if (status == "active" || status == "disabled" || status == "pending")
        {
            return status;
        }
        return "active";
    }

    static std::string normalizeScopeType(const std::string &scopeType)
    {
        return scopeType == "organization" ? "organization" : "personal";
    }

    static std::string normalizeOrganizationType(const std::string &organizationType, const std::string &scopeType)
    {
        if (scopeType != "organization")
        {
            return "";
        }
        if (organizationType == "business" || organizationType == "school")
        {
            return organizationType;
        }
        return "business";
    }

    static bool containsUsername(const Json::Value &usersJson, const std::string &username)
    {
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("username", "").asString() == username)
            {
                return true;
            }
        }
        return false;
    }

    static bool matchesLoginId(const Json::Value &user, const std::string &loginId)
    {
        return user.get("username", "").asString() == loginId ||
               user.get("id", "").asString() == loginId ||
               user.get("user_id", "").asString() == loginId ||
             user.get("member_no", "").asString() == loginId ||
               user.get("student_no", "").asString() == loginId ||
             user.get("employee_no", "").asString() == loginId ||
               user.get("dev_login_id", "").asString() == loginId;
    }

    static std::string uniqueStorageKey(const Json::Value &usersJson, const std::string &base)
    {
        std::string key = base;
        int suffix = 1;
        while (usersJson.isMember(key))
        {
            key = base + "_" + std::to_string(suffix++);
        }
        return key;
    }

    static std::string uniqueUsernameForBase(const Json::Value &usersJson, const std::string &base)
    {
        std::string username = base;
        int suffix = 1;
        while (containsUsername(usersJson, username))
        {
            username = base + "_" + std::to_string(suffix++);
        }
        return username;
    }

    static std::string nextPersonalMemberNo(const Json::Value &usersJson)
    {
        int maxSerial = 0;
        for (const auto &name : usersJson.getMemberNames())
        {
            maxSerial = (std::max)(maxSerial, extractPrefixedSerial(usersJson[name].get("member_no", "").asString(), "MEM-"));
        }
        return "MEM-" + padSerial(maxSerial + 1, 6);
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

    static std::string sanitizeIdentifier(const std::string &value)
    {
        std::string out;
        for (const auto ch : value)
        {
            if ((ch >= '0' && ch <= '9') ||
                (ch >= 'a' && ch <= 'z') ||
                (ch >= 'A' && ch <= 'Z') ||
                ch == '_' || ch == '-')
            {
                out.push_back(ch);
            }
        }
        return out.empty() ? std::string("test") : out;
    }

    static std::string sanitizePhone(const std::string &phone)
    {
        std::string out;
        for (const auto c : phone)
        {
            if (c >= '0' && c <= '9')
            {
                out.push_back(c);
            }
        }
        return out.empty() ? std::string("user") : out;
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

    static std::string generateUserId()
    {
        return common::generateOpaqueId("usr_");
    }

  private:
    std::filesystem::path userRootDir_;
    std::filesystem::path usersFile_;
    std::filesystem::path rolesFile_;
    mutable std::shared_mutex mutex_;
    WalStore wal_;
    size_t recoveredEvents_{0};
};
}  // namespace infrastructure::storage
