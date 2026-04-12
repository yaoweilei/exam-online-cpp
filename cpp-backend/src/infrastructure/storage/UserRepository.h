#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <drogon/utils/Utilities.h>
#include <json/json.h>

#include "JsonIo.h"
#include "WalStore.h"
#include "common/AppException.h"
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

        auto usersJson = std::filesystem::exists(usersFile_) ? readJsonFile(usersFile_) : defaultUsers();
        usersJson = normalizeUsers(usersJson);
        writeJsonFileAtomic(usersFile_, usersJson);

        auto rolesJson = std::filesystem::exists(rolesFile_) ? readJsonFile(rolesFile_) : defaultRolesMap();
        rolesJson = normalizeRoles(rolesJson);
        wal_.append("roles_normalized", rolesJson);
        writeJsonFileAtomic(rolesFile_, rolesJson);
    }

    Json::Value users() const
    {
        std::shared_lock lock(mutex_);
        return normalizeUsers(readJsonFile(usersFile_));
    }

    Json::Value roles() const
    {
        std::shared_lock lock(mutex_);
        return normalizeRoles(readJsonFile(rolesFile_));
    }

    Json::Value findUserByUsername(const std::string &username) const
    {
        auto usersJson = users();
        if (!usersJson.isMember(username))
        {
            return Json::Value(Json::nullValue);
        }
        return usersJson[username];
    }

    Json::Value findUserById(const std::string &userId) const
    {
        auto usersJson = users();
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto &user = usersJson[name];
            if (user.get("id", "").asString() == userId)
            {
                return user;
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value usersByRole(const std::string &roleId) const
    {
        auto usersJson = users();
        Json::Value result(Json::arrayValue);
        const auto normalizedRoleId = normalizeRoleId(roleId);
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto &user = usersJson[name];
            bool matched = false;
            for (const auto &role : user["roles"])
            {
                if (normalizeRoleId(role.asString()) == normalizedRoleId)
                {
                    matched = true;
                    break;
                }
            }
            if (normalizedRoleId == "guest" && user["roles"].empty())
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
        auto usersJson = normalizeUsers(readJsonFile(usersFile_));
        if (usersJson.isMember(username))
        {
            throw common::AppException("USER_EXISTS", "Username already exists", drogon::k400BadRequest);
        }

        const auto userId = "user_" + std::to_string(usersJson.size() + 1);
        Json::Value user(Json::objectValue);
        user["id"] = userId;
        user["username"] = username;
        user["password_hash"] = hashPassword(password);
        user["password_algo"] = "sha256";
        user["email"] = email;
        user["phone"] = "";
        user["phone_verified"] = false;
        user["roles"] = Json::arrayValue;
        user["roles"].append("student");
        user["scope_type"] = "personal";
        user["scope_id"] = userId;
        user["organization_type"] = "";
        user["status"] = "active";
        user["created_at"] = common::nowIso8601();

        usersJson[username] = user;
        wal_.append("user_created", user);
        writeJsonFileAtomic(usersFile_, usersJson);
        return user;
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

    Json::Value bindPhone(const std::string &userId, const std::string &phone)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = normalizeUsers(readJsonFile(usersFile_));
        for (auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("id", "").asString() == userId)
            {
                usersJson[name]["phone"] = phone;
                usersJson[name]["phone_verified"] = true;
                wal_.append("phone_bound", usersJson[name]);
                writeJsonFileAtomic(usersFile_, usersJson);
                return usersJson[name];
            }
        }
        throw common::AppException("USER_NOT_FOUND", "User not found: " + userId, drogon::k404NotFound);
    }

    Json::Value findUserByPhone(const std::string &phone) const
    {
        auto usersJson = users();
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("phone", "").asString() == phone)
            {
                return usersJson[name];
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value ensurePhoneUser(const std::string &phone)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = normalizeUsers(readJsonFile(usersFile_));
        for (auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("phone", "").asString() == phone)
            {
                return usersJson[name];
            }
        }

        std::string usernameBase = "phone_" + sanitizeDigits(phone);
        if (usernameBase == "phone_")
        {
            usernameBase = "phone_user";
        }
        std::string username = usernameBase;
        size_t suffix = 1;
        while (usersJson.isMember(username))
        {
            username = usernameBase + "_" + std::to_string(++suffix);
        }

        const auto userId = "phone_" + std::to_string(usersJson.size() + 1);
        Json::Value user(Json::objectValue);
        user["id"] = userId;
        user["username"] = username;
        user["password_hash"] = "";
        user["password_algo"] = "phone";
        user["email"] = "";
        user["phone"] = phone;
        user["phone_verified"] = true;
        user["roles"] = Json::arrayValue;
        user["roles"].append("student");
        user["scope_type"] = "personal";
        user["scope_id"] = userId;
        user["organization_type"] = "";
        user["status"] = "active";
        user["created_at"] = common::nowIso8601();

        usersJson[username] = user;
        wal_.append("phone_user_created", user);
        writeJsonFileAtomic(usersFile_, usersJson);
        return user;
    }

    Json::Value findUserByOpenid(const std::string &openid) const
    {
        auto usersJson = users();
        for (const auto &name : usersJson.getMemberNames())
        {
            if (usersJson[name].get("wechat_openid", "").asString() == openid)
            {
                return usersJson[name];
            }
        }
        return Json::Value(Json::nullValue);
    }

    Json::Value upsertWechatUser(const std::string &openid, const std::string &nickname, const std::string &avatarUrl)
    {
        std::unique_lock lock(mutex_);
        auto usersJson = normalizeUsers(readJsonFile(usersFile_));

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
                wal_.append("wechat_user_updated", usersJson[name]);
                writeJsonFileAtomic(usersFile_, usersJson);
                return usersJson[name];
            }
        }

        const auto userId = "wx_" + openid.substr(0, std::min(openid.size(), static_cast<size_t>(12)));
        std::string username = "wx_user_" + std::to_string(usersJson.size() + 1);
        Json::Value user(Json::objectValue);
        user["id"] = userId;
        user["username"] = username;
        user["password_hash"] = "";
        user["password_algo"] = "wechat";
        user["email"] = "";
        user["phone"] = "";
        user["phone_verified"] = false;
        user["wechat_openid"] = openid;
        user["wechat_nickname"] = nickname;
        user["wechat_avatar"] = avatarUrl;
        user["roles"] = Json::arrayValue;
        user["roles"].append("student");
        user["scope_type"] = "personal";
        user["scope_id"] = userId;
        user["organization_type"] = "";
        user["status"] = "active";
        user["created_at"] = common::nowIso8601();

        usersJson[username] = user;
        wal_.append("wechat_user_created", user);
        writeJsonFileAtomic(usersFile_, usersJson);
        return user;
    }

    static std::string hashPassword(const std::string &password)
    {
        return drogon::utils::getSha256(password);
    }

  private:
    static Json::Value defaultUsers()
    {
        Json::Value users(Json::objectValue);
        users["guest"] = guestUser();
        return users;
    }

    static Json::Value guestUser()
    {
        Json::Value user(Json::objectValue);
        user["id"] = "guest";
        user["username"] = "guest";
        user["password_hash"] = hashPassword("guest");
        user["password_algo"] = "sha256";
        user["email"] = "";
        user["phone"] = "";
        user["phone_verified"] = false;
        user["roles"] = Json::arrayValue;
        user["roles"].append("guest");
        user["scope_type"] = "personal";
        user["scope_id"] = "guest";
        user["organization_type"] = "";
        user["status"] = "active";
        user["created_at"] = common::nowIso8601();
        return user;
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
        if (roleId == "academic" || roleId == "academicAdmin")
        {
            return "orgAdmin";
        }
        return roleId;
    }

    static Json::Value normalizeRolesArray(const Json::Value &roles)
    {
        Json::Value normalized(Json::arrayValue);
        std::unordered_set<std::string> seen;
        if (roles.isArray())
        {
            for (const auto &role : roles)
            {
                const auto normalizedRole = normalizeRoleId(role.asString());
                if (normalizedRole.empty() || seen.count(normalizedRole) > 0)
                {
                    continue;
                }
                normalized.append(normalizedRole);
                seen.insert(normalizedRole);
            }
        }
        if (normalized.empty())
        {
            normalized.append("guest");
        }
        return normalized;
    }

    static Json::Value normalizeUsers(const Json::Value &users)
    {
        Json::Value normalized(Json::objectValue);
        if (!users.isObject())
        {
            normalized["guest"] = guestUser();
            return normalized;
        }

        for (const auto &username : users.getMemberNames())
        {
            const auto &rawUser = users[username];
            const auto key = rawUser.get("username", username).asString().empty()
                                 ? username
                                 : rawUser.get("username", username).asString();
            normalized[key] = normalizeUser(rawUser, key);
        }

        if (!normalized.isMember("guest"))
        {
            normalized["guest"] = guestUser();
        }
        return normalized;
    }

    static Json::Value normalizeUser(const Json::Value &rawUser, const std::string &username)
    {
        Json::Value user(rawUser.isObject() ? rawUser : Json::Value(Json::objectValue));
        const auto userId = user.get("id", username).asString().empty() ? username : user.get("id", username).asString();
        user["id"] = userId;
        user["username"] = username;
        user["email"] = user.get("email", "").asString();
        user["phone"] = user.get("phone", "").asString();
        user["phone_verified"] = user.get("phone_verified", false).asBool();
        user["password_hash"] = user.get("password_hash", "").asString();
        user["password_algo"] = user.get("password_algo", "sha256").asString();
        user["roles"] = normalizeRolesArray(user["roles"]);
        user["scope_type"] = user.get("scope_type", "personal").asString();
        user["scope_id"] = user.get("scope_id", userId).asString();
        user["organization_type"] = user.get("organization_type", "").asString();
        user["status"] = user.get("status", "active").asString();
        user["created_at"] = user.get("created_at", "").asString();
        return user;
    }

    static Json::Value normalizeRoles(const Json::Value &roles)
    {
        Json::Value normalized = defaultRolesMap();

        auto copyRole = [&](const std::string &id, const Json::Value &role) {
            if (id.empty())
            {
                return;
            }
            const auto normalizedId = normalizeRoleId(id);
            Json::Value &target = normalized[normalizedId];
            target["id"] = normalizedId;
            const auto fallbackName = target.isMember("name") ? target["name"].asString() : normalizedId;
            const auto fallbackDescription = target.isMember("description") ? target["description"].asString() : "";
            target["name"] = role.get("name", fallbackName).asString();
            target["description"] = role.get("description", fallbackDescription).asString();
            target["permissions"] = Json::arrayValue;

            std::unordered_set<std::string> seen;
            for (const auto &p : target["permissions"])
            {
                seen.insert(p.asString());
            }
            for (const auto &p : role["privileges"])
            {
                const auto permission = p.asString();
                if (!permission.empty() && seen.insert(permission).second)
                {
                    target["permissions"].append(permission);
                }
            }
            for (const auto &p : role["permissions"])
            {
                const auto permission = p.asString();
                if (!permission.empty() && seen.insert(permission).second)
                {
                    target["permissions"].append(permission);
                }
            }
            if (target["permissions"].empty())
            {
                target["permissions"] = role["permissions"];
            }
        };

        if (roles.isMember("roles") && roles["roles"].isArray())
        {
            for (const auto &role : roles["roles"])
            {
                copyRole(role.get("id", "").asString(), role);
            }
        }
        else if (roles.isObject())
        {
            for (const auto &roleId : roles.getMemberNames())
            {
                copyRole(roleId, roles[roleId]);
            }
        }

        return normalized;
    }

    static std::string sanitizeDigits(const std::string &value)
    {
        std::string sanitized;
        for (const char ch : value)
        {
            if (ch >= '0' && ch <= '9')
            {
                sanitized.push_back(ch);
            }
        }
        return sanitized;
    }

    static Json::Value defaultRolesMap()
    {
        Json::Value roles(Json::objectValue);

        roles["guest"]["id"] = "guest";
        roles["guest"]["name"] = "访客";
        roles["guest"]["description"] = "未登录用户，仅可浏览公开内容";
        roles["guest"]["permissions"] = Json::arrayValue;
        roles["guest"]["permissions"].append("view_exams");
        roles["guest"]["permissions"].append("submit_answers");

        roles["student"]["id"] = "student";
        roles["student"]["name"] = "学生";
        roles["student"]["description"] = "个人学习用户";
        roles["student"]["permissions"] = Json::arrayValue;
        roles["student"]["permissions"].append("view_exams");
        roles["student"]["permissions"].append("submit_answers");
        roles["student"]["permissions"].append("save_progress");

        roles["teacher"]["id"] = "teacher";
        roles["teacher"]["name"] = "教师";
        roles["teacher"]["description"] = "题库与教学内容维护";
        roles["teacher"]["permissions"] = Json::arrayValue;
        roles["teacher"]["permissions"].append("edit_exam");
        roles["teacher"]["permissions"].append("submit_for_review");

        roles["reviewer"]["id"] = "reviewer";
        roles["reviewer"]["name"] = "阅卷";
        roles["reviewer"]["description"] = "阅卷与审核";
        roles["reviewer"]["permissions"] = Json::arrayValue;
        roles["reviewer"]["permissions"].append("review_exam");
        roles["reviewer"]["permissions"].append("score_exam");

        roles["orgAdmin"]["id"] = "orgAdmin";
        roles["orgAdmin"]["name"] = "组织管理员";
        roles["orgAdmin"]["description"] = "组织空间内的成员与资源管理";
        roles["orgAdmin"]["permissions"] = Json::arrayValue;
        roles["orgAdmin"]["permissions"].append("manage_members");
        roles["orgAdmin"]["permissions"].append("manage_assignments");

        roles["systemAdmin"]["id"] = "systemAdmin";
        roles["systemAdmin"]["name"] = "系统管理员";
        roles["systemAdmin"]["description"] = "平台级系统管理";
        roles["systemAdmin"]["permissions"] = Json::arrayValue;
        roles["systemAdmin"]["permissions"].append("manage_users");
        roles["systemAdmin"]["permissions"].append("manage_roles");
        roles["systemAdmin"]["permissions"].append("manage_content");

        roles["superAdmin"]["id"] = "superAdmin";
        roles["superAdmin"]["name"] = "超级管理员";
        roles["superAdmin"]["description"] = "最高权限";
        roles["superAdmin"]["permissions"] = Json::arrayValue;
        roles["superAdmin"]["permissions"].append("*");

        return roles;
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
