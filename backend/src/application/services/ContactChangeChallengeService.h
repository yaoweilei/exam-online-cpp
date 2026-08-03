#pragma once

#include <algorithm>
#include <chrono>
#include <cctype>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "NotificationService.h"
#include "common/AppException.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class ContactChangeChallengeService
{
  public:
    ContactChangeChallengeService(infrastructure::storage::UserRepository &userRepository,
                                  EmailService &emailService,
                                  SmsService &smsService)
;

    void sendChallengeCode(const std::string &userId, const std::string &channel);

    void requireVerifiedChallengeIfNeeded(const Json::Value &currentUser,
                                          const std::string &contactKind,
                                          const std::string &nextValue,
                                          const std::string &challengeChannel,
                                          const std::string &challengeCode);

  private:
    struct PendingCode
    {
        std::string code;
        std::string destination;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
        int failedAttempts{0};
    };

    struct ChallengeTarget
    {
        std::string channel;
        std::string destination;
    };

    static std::string normalizeChannel(const std::string &channel);

    static std::string generateCode();

    static bool hasVerifiedEmail(const Json::Value &user);

    static bool hasVerifiedPhone(const Json::Value &user);

    static std::string currentContactValue(const Json::Value &user, const std::string &contactKind);

    static bool changeRequiresChallenge(const Json::Value &currentUser,
                                        const std::string &contactKind,
                                        const std::string &nextValue);

    static std::string challengeKey(const std::string &userId, const std::string &channel);

    static ChallengeTarget requireAvailableChannel(const Json::Value &currentUser, const std::string &channel);

    infrastructure::storage::UserRepository &userRepository_;
    EmailService &emailService_;
    SmsService &smsService_;
    std::unordered_map<std::string, PendingCode> pending_;
    std::mutex mutex_;
};
}  // namespace application::services
