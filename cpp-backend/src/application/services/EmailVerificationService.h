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
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class EmailVerificationService
{
  public:
    explicit EmailVerificationService(infrastructure::storage::UserRepository &userRepository,
                                                                            EmailService &emailService,
                                                                            ContactChangeChallengeService &contactChangeChallengeService)
;

    void sendVerificationCode(const std::string &email);

    Json::Value verifyAndBind(const std::string &userId,
                              const std::string &email,
                              const std::string &code,
                              const std::string &changeChallengeChannel = "",
                              const std::string &changeChallengeCode = "");

  private:
    void notifyPreviousEmailIfChanged(const std::string &previousEmail,
                                      bool previousEmailVerified,
                                      const std::string &newEmail);

    static std::string generateCode();

    static void validateEmailFormat(const std::string &email);

    struct PendingCode
    {
        std::string code;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    infrastructure::storage::UserRepository &userRepository_;
    EmailService &emailService_;
    ContactChangeChallengeService &contactChangeChallengeService_;
    std::unordered_map<std::string, PendingCode> pending_;
    std::mutex mutex_;
};
}  // namespace application::services
