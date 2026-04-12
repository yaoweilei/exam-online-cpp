#pragma once

#include <chrono>
#include <mutex>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "common/AppException.h"
#include "common/RequestId.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class AuthService
{
  public:
    explicit AuthService(infrastructure::storage::UserRepository &repository,
                        infrastructure::storage::ProfileRepository &profileRepository)
        : repository_(repository), profileRepository_(profileRepository)
    {
    }

    Json::Value login(const std::string &username, const std::string &password)
    {
        auto user = repository_.findUserByUsername(username);
        if (user.isNull() || !repository_.verifyPassword(user, password))
        {
            throw common::AppException("INVALID_CREDENTIALS", "Username or password is invalid", drogon::k401Unauthorized);
        }

        return createSessionPayload(user);
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

    Json::Value loginViaUser(const Json::Value &user)
    {
        return createSessionPayload(user);
    }

    // Called after WeChat OAuth2 callback completes; creates a session for the user.
    std::string createSessionForUser(const Json::Value &user)
    {
        return createSessionPayload(user).get("token", "").asString();
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
    Json::Value createSessionPayload(const Json::Value &user)
    {
        const auto token = common::generateRequestId();
        const auto expiresAt = std::chrono::system_clock::now() + std::chrono::hours(24 * 7);
        {
            std::scoped_lock lock(mutex_);
            sessions_[token] = Session{
                .userId = user.get("id", "").asString(),
                .username = user.get("username", "").asString(),
                .roles = user["roles"],
                .expiresAt = expiresAt,
                .expiresAtIso = formatTime(expiresAt)};
        }

        profileRepository_.updateStreak(user.get("id", "").asString());

        Json::Value out(Json::objectValue);
        out["user_id"] = user.get("id", "").asString();
        out["username"] = user.get("username", "").asString();
        out["roles"] = user["roles"];
        out["token"] = token;
        out["expires_at"] = formatTime(expiresAt);
        return out;
    }

    static std::string formatTime(const std::chrono::system_clock::time_point &timePoint)
    {
        const auto t = std::chrono::system_clock::to_time_t(timePoint);
        std::tm tm{};
#ifdef _WIN32
        gmtime_s(&tm, &t);
#else
        gmtime_r(&t, &tm);
#endif
        char buf[25];
        std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
        return buf;
    }

    struct Session
    {
        std::string userId;
        std::string username;
        Json::Value roles{Json::arrayValue};
        std::chrono::system_clock::time_point expiresAt;
        std::string expiresAtIso;
    };

    infrastructure::storage::UserRepository &repository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    std::unordered_map<std::string, Session> sessions_;
    std::mutex mutex_;
};
}  // namespace application::services
