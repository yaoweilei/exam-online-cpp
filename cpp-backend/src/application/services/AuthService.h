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
;

    Json::Value login(const std::string &username, const std::string &password);

    Json::Value registerUser(const std::string &username,
                             const std::string &password,
                             const std::string &email,
                             const std::string &referralCode = "");

    // Called after WeChat OAuth2 callback completes; creates a session for the user.
    std::string createSessionForUser(const Json::Value &user);

    bool logout(const std::string &token);

    Json::Value verify(const std::string &token);

  private:
        static bool allowsDevelopmentEmptyPassword(const Json::Value &user);

    static std::string toIso8601(std::chrono::system_clock::time_point timePoint);

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
