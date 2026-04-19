#pragma once

#include <chrono>
#include <iomanip>
#include <mutex>
#include <sstream>
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
                        infrastructure::storage::ProfileRepository &profileRepository,
                        bool developmentMode = false)
        : repository_(repository), profileRepository_(profileRepository), developmentMode_(developmentMode)
    {
    }

    Json::Value login(const std::string &username, const std::string &password)
    {
        auto user = repository_.findUserByLoginId(username);
        if (user.isNull() && developmentMode_ && password.empty())
        {
            user = repository_.createDevelopmentUser(username);
        }

        if (user.isNull())
        {
            throw common::AppException("INVALID_CREDENTIALS", "Username or password is invalid", drogon::k401Unauthorized);
        }

        const auto allowEmptyPassword = developmentMode_ && password.empty() && allowsDevelopmentEmptyPassword(user);
        if (!allowEmptyPassword && !repository_.verifyPassword(user, password))
        {
            throw common::AppException("INVALID_CREDENTIALS", "Username or password is invalid", drogon::k401Unauthorized);
        }

        const auto token = createSessionForUser(user);
        auto out = verify(token);
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

    // Called after WeChat OAuth2 callback completes; creates a session for the user.
    std::string createSessionForUser(const Json::Value &user)
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
                .expiresAtIso = toIso8601(expiresAt)};
        }
        profileRepository_.updateStreak(user.get("id", "").asString());
        return token;
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
        static bool allowsDevelopmentEmptyPassword(const Json::Value &user)
        {
                const auto algo = user.get("password_algo", "").asString();
                return algo == "wechat" || algo == "dev-empty" || !user.get("dev_login_id", "").asString().empty();
        }

    static std::string toIso8601(std::chrono::system_clock::time_point timePoint)
    {
        using namespace std::chrono;
        const auto secondsPart = time_point_cast<std::chrono::seconds>(timePoint);
        const auto ms = duration_cast<milliseconds>(timePoint - secondsPart).count();
        const auto timeValue = system_clock::to_time_t(timePoint);

        std::tm tm{};
#ifdef _WIN32
        gmtime_s(&tm, &timeValue);
#else
        gmtime_r(&timeValue, &tm);
#endif

        std::ostringstream oss;
        oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S")
            << "." << std::setw(3) << std::setfill('0') << ms
            << "Z";
        return oss.str();
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
    bool developmentMode_{false};
    std::unordered_map<std::string, Session> sessions_;
    std::mutex mutex_;
};
}  // namespace application::services
