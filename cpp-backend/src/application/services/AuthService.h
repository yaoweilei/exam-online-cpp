#pragma once

#include <chrono>
#include <mutex>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "common/AppException.h"
#include "common/RequestId.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class AuthService
{
  public:
    explicit AuthService(infrastructure::storage::UserRepository &repository) : repository_(repository) {}

    Json::Value login(const std::string &username, const std::string &password)
    {
        auto user = repository_.findUserByUsername(username);
        if (user.isNull() || !repository_.verifyPassword(user, password))
        {
            throw common::AppException("INVALID_CREDENTIALS", "Username or password is invalid", drogon::k401Unauthorized);
        }

        const auto token = common::generateRequestId();
        const auto expiresAt = common::nowIso8601();
        {
            std::scoped_lock lock(mutex_);
            sessions_[token] = Session{
                .userId = user.get("id", "").asString(),
                .username = user.get("username", "").asString(),
                .roles = user["roles"],
                .expiresAt = std::chrono::system_clock::now() + std::chrono::hours(24 * 7),
                .expiresAtIso = expiresAt};
        }

        Json::Value out(Json::objectValue);
        out["user_id"] = user.get("id", "").asString();
        out["username"] = user.get("username", "").asString();
        out["roles"] = user["roles"];
        out["token"] = token;
        return out;
    }

    Json::Value registerUser(const std::string &username, const std::string &password, const std::string &email)
    {
        auto user = repository_.createUser(username, password, email);
        Json::Value out(Json::objectValue);
        out["user_id"] = user.get("id", "").asString();
        out["username"] = user.get("username", "").asString();
        out["roles"] = user["roles"];
        return out;
    }

    bool logout(const std::string &token)
    {
        std::scoped_lock lock(mutex_);
        return sessions_.erase(token) > 0;
    }

    Json::Value verify(const std::string &token)
    {
        std::scoped_lock lock(mutex_);
        auto it = sessions_.find(token);
        if (it == sessions_.end())
        {
            throw common::AppException("TOKEN_INVALID", "Token is invalid", drogon::k401Unauthorized);
        }
        if (std::chrono::system_clock::now() > it->second.expiresAt)
        {
            sessions_.erase(it);
            throw common::AppException("TOKEN_EXPIRED", "Token has expired", drogon::k401Unauthorized);
        }

        Json::Value out(Json::objectValue);
        out["user_id"] = it->second.userId;
        out["username"] = it->second.username;
        out["expires_at"] = it->second.expiresAtIso;
        out["roles"] = it->second.roles;
        return out;
    }

  private:
    struct Session
    {
        std::string userId;
        std::string username;
        Json::Value roles{Json::arrayValue};
        std::chrono::system_clock::time_point expiresAt;
        std::string expiresAtIso;
    };

    infrastructure::storage::UserRepository &repository_;
    std::unordered_map<std::string, Session> sessions_;
    std::mutex mutex_;
};
}  // namespace application::services
