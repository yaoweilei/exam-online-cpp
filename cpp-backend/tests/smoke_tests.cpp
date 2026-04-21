#include <cassert>
#include <chrono>
#include <filesystem>
#include <functional>
#include <string>
#include <system_error>
#include <vector>

#include "application/services/ContactChangeChallengeService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/PhoneService.h"
#include "application/services/SubscriptionService.h"
#include "common/RequestId.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace
{
class ScopedTempDir
{
  public:
    ScopedTempDir()
        : path_(std::filesystem::temp_directory_path() /
                ("exam_online_cpp_smoke_" +
                 std::to_string(std::chrono::steady_clock::now().time_since_epoch().count())))
    {
        std::filesystem::create_directories(path_);
    }

    ~ScopedTempDir()
    {
        std::error_code errorCode;
        std::filesystem::remove_all(path_, errorCode);
    }

    const std::filesystem::path &path() const
    {
        return path_;
    }

  private:
    std::filesystem::path path_;
};

class RecordingEmailService final : public application::services::EmailService
{
  public:
    application::services::DeliveryResult send(const application::services::EmailMessage &message) override
    {
        messages.push_back(message);
        return application::services::DeliveryResult{.delivered = true, .provider = "test-email", .providerMessageId = "ok"};
    }

    std::vector<application::services::EmailMessage> messages;
};

class RecordingSmsService final : public application::services::SmsService
{
  public:
    application::services::DeliveryResult send(const application::services::SmsMessage &message) override
    {
        messages.push_back(message);
        return application::services::DeliveryResult{.delivered = true, .provider = "test-sms", .providerMessageId = "ok"};
    }

    std::vector<application::services::SmsMessage> messages;
};

std::string extractSixDigitCode(const std::string &message)
{
    std::string digits;
    for (const char ch : message)
    {
        if (ch >= '0' && ch <= '9')
        {
            digits.push_back(ch);
            if (digits.size() == 6)
            {
                return digits;
            }
        }
        else
        {
            digits.clear();
        }
    }
    return {};
}

void expectAppException(const std::string &expectedCode, const std::function<void()> &action)
{
    try
    {
        action();
        assert(false && "Expected AppException");
    }
    catch (const common::AppException &error)
    {
        assert(error.code() == expectedCode);
    }
}

void testRequestIdsRemainUnique()
{
    const auto id1 = common::generateRequestId();
    const auto id2 = common::generateRequestId();
    assert(!id1.empty());
    assert(!id2.empty());
    assert(id1 != id2);
}

void testReferralRewardSettlesOnActivePaidSubscription()
{
    constexpr int rewardCredits = 25;
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(profileRepository, organizationRepository, userRepository, rewardCredits);

    const auto referrer = userRepository.createUser("referrer_smoke", "secret", "referrer@example.com");
    const auto referralCode = referrer.get("referral_code", "").asString();
    const auto referrerUserId = referrer.get("id", "").asString();
    assert(!referralCode.empty());
    assert(!referrerUserId.empty());

    const auto referred = userRepository.createUser("referred_smoke", "secret", "referred@example.com", referralCode);
    const auto referredUserId = referred.get("id", "").asString();
    assert(!referredUserId.empty());
    assert(userRepository.findUserById(referredUserId).get("referral_reward_status", "none").asString() == "pending");
    assert(profileRepository.loadProfile(referrerUserId).get("credits", 0).asInt() == 0);

    Json::Value trialPatch(Json::objectValue);
    trialPatch["plan"] = "pro";
    trialPatch["status"] = "trial";
    subscriptionService.updateUserSubscription(referredUserId, trialPatch);
    assert(userRepository.findUserById(referredUserId).get("referral_reward_status", "none").asString() == "pending");
    assert(profileRepository.loadProfile(referrerUserId).get("credits", 0).asInt() == 0);

    Json::Value activePatch(Json::objectValue);
    activePatch["plan"] = "pro";
    activePatch["status"] = "active";
    const auto subscription = subscriptionService.updateUserSubscription(referredUserId, activePatch);
    assert(subscription.get("plan", "free").asString() == "pro");
    assert(subscription.get("status", "active").asString() == "active");

    const auto settledUser = userRepository.findUserById(referredUserId);
    assert(settledUser.get("referral_reward_status", "none").asString() == "granted");
    assert(settledUser.get("referral_reward_trigger", "").asString() == "subscription.activated");
    assert(!settledUser.get("referral_reward_granted_at", "").asString().empty());
    assert(settledUser.get("referral_reward_credit_amount", 0).asInt() == rewardCredits);
    assert(settledUser.get("referral_reward_credit_recipient_user_id", "").asString() == referrerUserId);

    const auto rewardedReferrerProfile = profileRepository.loadProfile(referrerUserId);
    assert(rewardedReferrerProfile.get("credits", 0).asInt() == rewardCredits);
    assert(rewardedReferrerProfile.get("last_credit_reason", "").asString() == "referral.subscription.activated");
    assert(rewardedReferrerProfile["credit_awards"].isObject());
    assert(rewardedReferrerProfile["credit_awards"].isMember("referral:" + referredUserId + ":subscription.activated"));

    subscriptionService.updateUserSubscription(referredUserId, activePatch);
    assert(profileRepository.loadProfile(referrerUserId).get("credits", 0).asInt() == rewardCredits);
}

void testEmailRebindNotifiesPreviouslyVerifiedAddress()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    RecordingEmailService emailService;
    RecordingSmsService smsService;
    application::services::ContactChangeChallengeService contactChangeChallengeService(userRepository, emailService, smsService);
    application::services::EmailVerificationService verificationService(userRepository, emailService, contactChangeChallengeService);

    const auto createdUser = userRepository.createUser("email_notify_smoke", "secret", "old@example.com");
    const auto userId = createdUser.get("id", "").asString();
    assert(!userId.empty());

    userRepository.bindEmail(userId, "old@example.com");
    userRepository.bindPhone(userId, "+8613800138000");
    verificationService.sendVerificationCode("new@example.com");
    const auto code = extractSixDigitCode(emailService.messages.front().textBody);
    assert(code.size() == 6);

    expectAppException("CONTACT_CHANGE_CONFIRMATION_REQUIRED", [&]() {
        (void)verificationService.verifyAndBind(userId, "new@example.com", code);
    });

    contactChangeChallengeService.sendChallengeCode(userId, "phone");
    const auto challengeCode = extractSixDigitCode(smsService.messages.front().body);
    assert(challengeCode.size() == 6);

    const auto reboundUser = verificationService.verifyAndBind(userId, "new@example.com", code, "phone", challengeCode);
    assert(reboundUser.get("email", "").asString() == "new@example.com");
    assert(reboundUser.get("email_verified", false).asBool());
    assert(emailService.messages.size() == 2);
    assert(emailService.messages[1].toAddress == "old@example.com");
    assert(emailService.messages[1].subject == "Exam Online 邮箱变更提醒");
    assert(emailService.messages[1].textBody.find("new@example.com") != std::string::npos);
}

void testPhoneRebindNotifiesPreviouslyVerifiedNumber()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    RecordingSmsService smsService;
    RecordingEmailService emailService;
    application::services::ContactChangeChallengeService contactChangeChallengeService(userRepository, emailService, smsService);
    application::services::PhoneService phoneService(userRepository, smsService, contactChangeChallengeService);

    const auto createdUser = userRepository.createPhoneUser("+8613800138000");
    const auto userId = createdUser.get("id", "").asString();
    assert(!userId.empty());

    userRepository.bindEmail(userId, "old@example.com");

    phoneService.sendVerificationCode("+8613900139000");
    const auto code = extractSixDigitCode(smsService.messages.front().body);
    assert(code.size() == 6);

    contactChangeChallengeService.sendChallengeCode(userId, "email");
    const auto challengeCode = extractSixDigitCode(emailService.messages.front().textBody);
    assert(challengeCode.size() == 6);

    const auto reboundUser = phoneService.verifyAndBind(userId, "+8613900139000", code, "", "email", challengeCode);
    assert(reboundUser.get("phone", "").asString() == "+8613900139000");
    assert(reboundUser.get("phone_verified", false).asBool());
    assert(smsService.messages.size() == 2);
    assert(smsService.messages[1].to == "+8613800138000");
    assert(smsService.messages[1].body.find("+8613900139000") != std::string::npos);
}
}  // namespace

int main()
{
    testRequestIdsRemainUnique();
    testReferralRewardSettlesOnActivePaidSubscription();
    testEmailRebindNotifiesPreviouslyVerifiedAddress();
    testPhoneRebindNotifiesPreviouslyVerifiedNumber();
    return 0;
}
