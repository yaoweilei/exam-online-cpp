#pragma once

#include <chrono>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "ContactChangeChallengeService.h"
#include "NotificationService.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class PhoneService
{
  public:
    explicit PhoneService(infrastructure::storage::UserRepository &userRepository,
                                                    SmsService &smsService,
                                                    ContactChangeChallengeService &contactChangeChallengeService)
;

    // Step 1: generate + send a 6-digit code.
    // Rate-limited: one code per phone per 60 seconds.
    void sendVerificationCode(const std::string &phone);

    // Step 2: verify the code and either bind an existing user or create/login a phone user.
    Json::Value verifyAndBind(const std::string &userId,
                              const std::string &phone,
                              const std::string &code,
                              const std::string &referralCode = "",
                              const std::string &changeChallengeChannel = "",
                              const std::string &changeChallengeCode = "");

  private:
    void notifyPreviousPhoneIfChanged(const std::string &previousPhone,
                                      bool previousPhoneVerified,
                                      const std::string &newPhone);

    static std::string generateCode();

    static void validatePhoneFormat(const std::string &phone);

    struct PendingCode
    {
        std::string code;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    infrastructure::storage::UserRepository &userRepository_;
    SmsService &smsService_;
    ContactChangeChallengeService &contactChangeChallengeService_;
    std::unordered_map<std::string, PendingCode> pending_;
    std::mutex mutex_;
};
}  // namespace application::services
