#pragma once

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
            users["guest"]["username"] = "guest";
            users["guest"]["password_hash"] = hashPassword("guest");
            users["guest"]["password_algo"] = "sha256";
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
        if (roles.isMember("roles") && roles["roles"].isArray())
        {
            Json::Value normalized(Json::objectValue);
            for (const auto &role : roles["roles"])
            {
                const auto id = role.get("id", "").asString();
                if (id.empty())
                {
                    continue;
                }
                normalized[id]["id"] = id;
                normalized[id]["name"] = role.get("name", id).asString();
                normalized[id]["description"] = role.get("description", "").asString();
                normalized[id]["permissions"] = Json::arrayValue;
                for (const auto &p : role["privileges"])
                {
                    normalized[id]["permissions"].append(p.asString());
                }
                for (const auto &p : role["permissions"])
                {
                    normalized[id]["permissions"].append(p.asString());
                }
            }
            if (!normalized.isMember("guest"))
            {
                normalized["guest"]["id"] = "guest";
                normalized["guest"]["name"] = "guest";
                normalized["guest"]["description"] = "Guest";
                normalized["guest"]["permissions"] = Json::arrayValue;
                normalized["guest"]["permissions"].append("view_exams");
                normalized["guest"]["permissions"].append("submit_answers");
            }
            wal_.append("roles_normalized", normalized);
            writeJsonFileAtomic(rolesFile_, normalized);
        }
    }

    Json::Value users() const
    {
        std::shared_lock lock(mutex_);
        return readJsonFile(usersFile_);
    }

    Json::Value roles() const
    {
        std::shared_lock lock(mutex_);
        return readJsonFile(rolesFile_);
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
        for (const auto &name : usersJson.getMemberNames())
        {
            const auto &user = usersJson[name];
            bool matched = false;
            for (const auto &role : user["roles"])
            {
                if (role.asString() == roleId)
                {
                    matched = true;
                    break;
                }
            }
            if (roleId == "guest" && user["roles"].empty())
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
        if (usersJson.isMember(username))
        {
            throw common::AppException("USER_EXISTS", "Username already exists", drogon::k400BadRequest);
        }

        const auto userId = "user_" + std::to_string(usersJson.size() + 1);
        usersJson[username]["id"] = userId;
        usersJson[username]["username"] = username;
        usersJson[username]["password_hash"] = hashPassword(password);
        usersJson[username]["password_algo"] = "sha256";
        usersJson[username]["email"] = email;
        usersJson[username]["roles"] = Json::arrayValue;
        usersJson[username]["roles"].append("user");
        usersJson[username]["created_at"] = common::nowIso8601();

        wal_.append("user_created", usersJson[username]);
        writeJsonFileAtomic(usersFile_, usersJson);
        return usersJson[username];
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

    static std::string hashPassword(const std::string &password)
    {
        return drogon::utils::getSha256(password);
    }

  private:
    static Json::Value defaultRolesMap()
    {
        Json::Value roles(Json::objectValue);
        roles["guest"]["id"] = "guest";
        roles["guest"]["name"] = "guest";
        roles["guest"]["description"] = "Guest user";
        roles["guest"]["permissions"] = Json::arrayValue;
        roles["guest"]["permissions"].append("view_exams");
        roles["guest"]["permissions"].append("submit_answers");

        roles["user"]["id"] = "user";
        roles["user"]["name"] = "user";
        roles["user"]["description"] = "Default user";
        roles["user"]["permissions"] = Json::arrayValue;
        roles["user"]["permissions"].append("view_exams");
        roles["user"]["permissions"].append("submit_answers");
        roles["user"]["permissions"].append("save_progress");

        roles["admin"]["id"] = "admin";
        roles["admin"]["name"] = "admin";
        roles["admin"]["description"] = "System admin";
        roles["admin"]["permissions"] = Json::arrayValue;
        roles["admin"]["permissions"].append("*");
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
