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
#include "application/services/NotificationService.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/SessionRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class AuthService
{
  public:
    explicit AuthService(infrastructure::storage::UserRepository &repository,
                        infrastructure::storage::ProfileRepository &profileRepository,
                        bool developmentMode = false,
                        infrastructure::storage::SessionRepository *sessionRepository = nullptr,
                        EmailService *emailService = nullptr,
                        SmsService *smsService = nullptr)
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

    void requirePasswordReauthentication(const std::string &userId, const std::string &password) const;

    int revokeSessionsForUser(const std::string &userId, const std::string &keepToken = "");

    Json::Value changePassword(const std::string &userId,
                               const std::string &currentPassword,
                               const std::string &newPassword);

    Json::Value deactivateAccount(const std::string &userId, const std::string &reason);

    Json::Value sendPasswordResetCode(const std::string &loginId);

    Json::Value resetPassword(const std::string &loginId,
                              const std::string &code,
                              const std::string &newPassword);

  private:
    static bool allowsDevelopmentEmptyPassword(const Json::Value &user);

    static void validatePasswordPolicy(const std::string &password);

    static std::string toIso8601(std::chrono::system_clock::time_point timePoint);

    static std::string generateSixDigitCode();

    struct Session
    {
        std::string userId;
        std::string username;
        Json::Value roles{Json::arrayValue};
        std::chrono::system_clock::time_point expiresAt;
        std::string expiresAtIso;
    };

    struct PasswordResetCode
    {
        std::string userId;
        std::string code;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    static std::int64_t toEpochMillis(std::chrono::system_clock::time_point timePoint);

    static std::chrono::system_clock::time_point fromEpochMillis(std::int64_t epochMillis);

    static Json::Value sessionToJson(const Session &session);

    static Session sessionFromJson(const Json::Value &value);

    infrastructure::storage::UserRepository &repository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    infrastructure::storage::SessionRepository *sessionRepository_{nullptr};
    EmailService *emailService_{nullptr};
    SmsService *smsService_{nullptr};
    bool developmentMode_{false};
    std::unordered_map<std::string, Session> sessions_;
    std::unordered_map<std::string, PasswordResetCode> passwordResetCodes_;
    std::mutex mutex_;
};
}  // namespace application::services
