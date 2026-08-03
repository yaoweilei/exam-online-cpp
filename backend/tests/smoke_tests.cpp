#include <cassert>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

#include <drogon/utils/Utilities.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

#include "application/services/ContactChangeChallengeService.h"
#include "application/services/DraftService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/AnswerService.h"
#include "application/services/AssignmentService.h"
#include "application/services/AuthService.h"
#include "application/services/AuditLogService.h"
#include "application/services/OrganizationService.h"
#include "application/services/PaymentService.h"
#include "application/services/PhoneService.h"
#include "application/services/SubscriptionService.h"
#include "application/services/UserService.h"
#include "common/RequestId.h"
#include "common/AppException.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/AttemptTimerRepository.h"
#include "infrastructure/storage/DraftRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/SessionRepository.h"
#include "infrastructure/storage/UserRepository.h"
#include "infrastructure/storage/JsonIo.h"
#include "infrastructure/config/AppConfig.h"

namespace
{
class ScopedEnvironmentVariable
{
  public:
    ScopedEnvironmentVariable(std::string name, const std::string &value)
        : name_(std::move(name))
    {
        if (const char *existing = std::getenv(name_.c_str()))
        {
            previous_ = existing;
            hadPrevious_ = true;
        }
        set(value);
    }

    ~ScopedEnvironmentVariable()
    {
        if (hadPrevious_)
        {
            set(previous_);
        }
        else
        {
#ifdef _WIN32
            _putenv_s(name_.c_str(), "");
#else
            unsetenv(name_.c_str());
#endif
        }
    }

  private:
    void set(const std::string &value)
    {
#ifdef _WIN32
        _putenv_s(name_.c_str(), value.c_str());
#else
        setenv(name_.c_str(), value.c_str(), 1);
#endif
    }

    std::string name_;
    std::string previous_;
    bool hadPrevious_{false};
};

std::string hmacSha256HexForTest(const std::string &secret, const std::string &payload)
{
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    HMAC(
        EVP_sha256(),
        secret.data(),
        static_cast<int>(secret.size()),
        reinterpret_cast<const unsigned char *>(payload.data()),
        payload.size(),
        digest,
        &length);
    std::ostringstream out;
    for (unsigned int index = 0; index < length; ++index)
    {
        out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[index]);
    }
    return out.str();
}

void testProductionConfigurationFailsClosed()
{
    infrastructure::config::AppConfig config;
    config.appEnv = "production";
    config.publicWebBaseUrl = "http://example.test";
    config.emailProvider = "resend";
    config.emailApiKey = "test-email-key";
    config.emailFromAddress = "noreply@example.test";
    config.smsProvider = "twilio";
    config.smsAccountSid = "test-account";
    config.smsAuthToken = "test-token";
    config.smsFromNumber = "+10000000000";
    config.paymentPrimaryProvider = "stripe";
    config.stripeSecretKey = "sk_test_configuration";
    config.stripePublishableKey = "pk_test_configuration";
    config.stripeWebhookSecret = "whsec_test_configuration";
    bool rejectedInsecureUrl = false;
    try
    {
        infrastructure::config::validateAppConfig(config);
    }
    catch (const std::invalid_argument &)
    {
        rejectedInsecureUrl = true;
    }
    assert(rejectedInsecureUrl);

    config.publicWebBaseUrl = "https://example.test";
    infrastructure::config::validateAppConfig(config);

    config.paymentPrimaryProvider = "wechat";
    bool rejectedUnapprovedPaymentProvider = false;
    try
    {
        infrastructure::config::validateAppConfig(config);
    }
    catch (const std::invalid_argument &)
    {
        rejectedUnapprovedPaymentProvider = true;
    }
    assert(rejectedUnapprovedPaymentProvider);
    config.paymentPrimaryProvider = "stripe";

    config.smsAuthToken.clear();
    bool rejectedIncompleteProvider = false;
    try
    {
        infrastructure::config::validateAppConfig(config);
    }
    catch (const std::invalid_argument &)
    {
        rejectedIncompleteProvider = true;
    }
    assert(rejectedIncompleteProvider);
}

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

class FlakyEmailService final : public application::services::EmailService
{
  public:
    explicit FlakyEmailService(int failuresBeforeSuccess)
        : failuresBeforeSuccess_(failuresBeforeSuccess)
    {
    }

    application::services::DeliveryResult send(const application::services::EmailMessage &message) override
    {
        messages.push_back(message);
        if (static_cast<int>(messages.size()) <= failuresBeforeSuccess_)
        {
            return application::services::DeliveryResult{
                .delivered = false,
                .provider = "test-email",
                .errorMessage = "temporary provider failure"};
        }
        return application::services::DeliveryResult{
            .delivered = true,
            .provider = "test-email",
            .providerMessageId = "recovered"};
    }

    std::vector<application::services::EmailMessage> messages;

  private:
    int failuresBeforeSuccess_{0};
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

bool jsonArrayContains(const Json::Value &values, const std::string &expected)
{
    if (!values.isArray())
    {
        return false;
    }
    for (const auto &value : values)
    {
        if (value.asString() == expected)
        {
            return true;
        }
    }
    return false;
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

void testSubscriptionEntitlementsFollowPlanAndActiveStatus()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService service(
        profileRepository, organizationRepository, userRepository, 0);

    const auto user = userRepository.createUser(
        "subscription_entitlement_smoke", "secret", "subscription-entitlement@example.com");
    const auto userId = user.get("id", "").asString();

    const auto freeSubscription = service.subscriptionForUser(userId);
    assert(freeSubscription.get("effective_plan", "").asString() == "free");
    assert(jsonArrayContains(freeSubscription["accessible_levels"], "N1"));
    assert(!jsonArrayContains(freeSubscription["entitlements"], "export.standard"));
    assert(!freeSubscription["entitlement_access"]["export.standard"].get("granted", true).asBool());
    assert(freeSubscription["entitlement_access"]["export.standard"].get("required_plan", "").asString() == "pro");
    expectAppException(
        "ENTITLEMENT_REQUIRED",
        [&]() { service.requireEntitlement(userId, "export.standard"); });

    Json::Value proPatch(Json::objectValue);
    proPatch["plan"] = "pro";
    proPatch["status"] = "active";
    const auto proSubscription = service.updateUserSubscription(userId, proPatch);
    assert(service.hasEntitlement(userId, "export.standard"));
    assert(jsonArrayContains(proSubscription["entitlements"], "analytics.full"));
    assert(!jsonArrayContains(proSubscription["entitlements"], "analytics.prediction"));

    Json::Value ultraPatch(Json::objectValue);
    ultraPatch["plan"] = "ultra";
    ultraPatch["status"] = "active";
    const auto ultraSubscription = service.updateUserSubscription(userId, ultraPatch);
    assert(jsonArrayContains(ultraSubscription["entitlements"], "analytics.prediction"));
    assert(jsonArrayContains(ultraSubscription["entitlements"], "export.full_report"));

    Json::Value expiredPatch(Json::objectValue);
    expiredPatch["plan"] = "pro";
    expiredPatch["status"] = "active";
    expiredPatch["expires_at"] = "2000-01-01T00:00:00Z";
    const auto expiredSubscription = service.updateUserSubscription(userId, expiredPatch);
    assert(expiredSubscription.get("plan", "").asString() == "pro");
    assert(expiredSubscription.get("effective_plan", "").asString() == "free");
    assert(!expiredSubscription.get("is_active", true).asBool());
    assert(!jsonArrayContains(expiredSubscription["entitlements"], "export.standard"));
}

void testRenewalNotificationOutboxRetriesFailedEmail()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(
        profileRepository, organizationRepository, userRepository, 0);
    FlakyEmailService emailService(2);

    const auto user = userRepository.createUser(
        "renewal_outbox_smoke", "secret", "renewal-outbox@example.com");
    const auto userId = user.get("id", "").asString();
    userRepository.bindEmail(userId, "renewal-outbox@example.com");

    Json::Value subscriptionPatch(Json::objectValue);
    subscriptionPatch["plan"] = "pro";
    subscriptionPatch["status"] = "active";
    subscriptionPatch["expires_at"] = "2030-01-08T00:00:00Z";
    subscriptionService.updateUserSubscription(userId, subscriptionPatch);

    application::services::PaymentService paymentService(
        tempDir.path(), subscriptionService, &userRepository, &emailService);
    Json::Value renewalPatch(Json::objectValue);
    renewalPatch["enabled"] = true;
    renewalPatch["notify_email"] = true;
    renewalPatch["days"] = 365;
    renewalPatch["provider"] = "stripe";
    paymentService.updateAutoRenewal(userId, "personal", userId, renewalPatch);

    const auto firstRun = paymentService.runRenewalJobs("2030-01-01");
    assert(firstRun.get("reminders_enqueued", 0).asInt() == 1);
    assert(emailService.messages.size() == 1);
    auto inbox = paymentService.listNotifications(userId, false, 1, 20);
    assert(inbox.get("total", 0).asInt() == 1);
    assert(inbox["items"][0]["delivery"]["email"].get("status", "").asString() == "retry_scheduled");
    assert(inbox["items"][0]["delivery"]["email"].get("attempts", 0).asInt() == 1);
    assert(!inbox["items"][0]["delivery"]["email"].get("next_attempt_at", "").asString().empty());

    paymentService.runRenewalJobs("2030-01-01", true);
    assert(emailService.messages.size() == 2);
    inbox = paymentService.listNotifications(userId, false, 1, 20);
    assert(inbox["items"][0]["delivery"]["email"].get("status", "").asString() == "retry_scheduled");
    assert(inbox["items"][0]["delivery"]["email"].get("attempts", 0).asInt() == 2);

    const auto recoveredRun = paymentService.runRenewalJobs("2030-01-01", true);
    assert(emailService.messages.size() == 3);
    assert(recoveredRun["notification_delivery"].get("delivered", 0).asInt() == 1);
    inbox = paymentService.listNotifications(userId, false, 1, 20);
    assert(inbox["items"][0]["delivery"]["email"].get("status", "").asString() == "delivered");
    assert(inbox["items"][0]["delivery"]["email"].get("attempts", 0).asInt() == 3);
    assert(inbox["items"][0]["delivery"]["email"].get("next_attempt_at", "missing").asString().empty());

    const auto operations = paymentService.renewalOperations();
    assert(operations["email_delivery_counts"].get("delivered", 0).asInt() == 1);
}

void testStripeWebhookRejectsExpiredSignedPayload()
{
    ScopedEnvironmentVariable appEnv("APP_ENV", "production");
    ScopedEnvironmentVariable webhookSecret("STRIPE_WEBHOOK_SECRET", "smoke-webhook-secret");
    ScopedEnvironmentVariable webhookTolerance("STRIPE_WEBHOOK_TOLERANCE_SECONDS", "300");
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(
        profileRepository, organizationRepository, userRepository, 0);
    application::services::PaymentService paymentService(
        tempDir.path(), subscriptionService, &userRepository, nullptr);
    const auto productionPricing = paymentService.getPricingConfig();
    assert(productionPricing.get("default_provider", "").asString() == "stripe");
    assert(productionPricing["providers"].size() == 1);
    assert(productionPricing["providers"][0].asString() == "stripe");

    Json::Value payload(Json::objectValue);
    payload["id"] = "evt_signature_smoke";
    payload["type"] = "customer.updated";
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    const auto rawBody = Json::writeString(writer, payload);
    const auto now = static_cast<long long>(std::time(nullptr));
    const auto currentTimestamp = std::to_string(now);
    const auto currentSignature = hmacSha256HexForTest(
        "smoke-webhook-secret", currentTimestamp + "." + rawBody);
    const auto accepted = paymentService.handleWebhook(
        "stripe",
        rawBody,
        payload,
        "t=" + currentTimestamp + ",v1=" + currentSignature);
    assert(accepted.get("ignored", false).asBool());

    const auto expiredTimestamp = std::to_string(now - 301);
    const auto expiredSignature = hmacSha256HexForTest(
        "smoke-webhook-secret", expiredTimestamp + "." + rawBody);
    expectAppException("PAYMENT_WEBHOOK_SIGNATURE_INVALID", [&]() {
        (void)paymentService.handleWebhook(
            "stripe",
            rawBody,
            payload,
            "t=" + expiredTimestamp + ",v1=" + expiredSignature);
    });
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

void testPhoneVerificationDailyLimit()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    RecordingSmsService smsService;
    RecordingEmailService emailService;
    application::services::ContactChangeChallengeService contactChangeChallengeService(userRepository, emailService, smsService);
    application::services::PhoneService phoneService(
        userRepository,
        smsService,
        contactChangeChallengeService,
        true,
        2,
        0);

    const auto first = phoneService.sendVerificationCode("+8613800999000");
    assert(first.get("daily_limit", 0).asInt() == 2);
    assert(first.get("daily_remaining", -1).asInt() == 1);
    const auto second = phoneService.sendVerificationCode("+8613800999000");
    assert(second.get("daily_remaining", -1).asInt() == 0);
    expectAppException("SMS_DAILY_LIMITED", [&]() {
        (void)phoneService.sendVerificationCode("+8613800999000");
    });
}

void testAuthSessionPersistsAcrossServiceInstances()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::SessionRepository sessionRepository(tempDir.path());

    std::string token;
    {
        application::services::AuthService authService(userRepository, profileRepository, true, &sessionRepository);
        const auto login = authService.login(
            "student_session_persist_smoke",
            "",
            "127.0.0.1",
            "SmokeBrowser/1.0 Windows");
        token = login.get("token", "").asString();
        assert(!token.empty());
        assert(authService.verify(token).get("username", "").asString() == "student_session_persist_smoke");
    }

    application::services::AuthService restoredAuthService(userRepository, profileRepository, true, &sessionRepository);
    const auto restored = restoredAuthService.verify(token);
    assert(restored.get("username", "").asString() == "student_session_persist_smoke");
    assert(restored["roles"].isArray());
    const auto userId = restored.get("user_id", "").asString();
    const auto otherToken = restoredAuthService.login(
        "student_session_persist_smoke",
        "",
        "192.0.2.10",
        "OtherBrowser/2.0 Linux").get("token", "").asString();
    const auto sessions = restoredAuthService.sessionsForUser(userId, token);
    assert(sessions.isArray());
    assert(sessions.size() == 2);
    std::string otherSessionId;
    bool foundCurrent = false;
    for (const auto &entry : sessions)
    {
        if (entry.get("current", false).asBool())
        {
            foundCurrent = true;
            assert(entry.get("client_ip", "").asString() == "127.0.0.1");
        }
        else
        {
            otherSessionId = entry.get("session_id", "").asString();
            assert(entry.get("client_ip", "").asString() == "192.0.2.10");
        }
    }
    assert(foundCurrent);
    assert(!otherSessionId.empty());
    assert(!restoredAuthService.revokeSessionForUser(userId, drogon::utils::getSha256(token), token));
    assert(restoredAuthService.revokeSessionForUser(userId, otherSessionId, token));
    expectAppException("TOKEN_INVALID", [&]() {
        (void)restoredAuthService.verify(otherToken);
    });

    assert(restoredAuthService.logout(token));
    expectAppException("TOKEN_INVALID", [&]() {
        (void)restoredAuthService.verify(token);
    });
}

void testAuthSessionsAreCappedPerUser()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::SessionRepository sessionRepository(tempDir.path());
    application::services::AuthService authService(
        userRepository,
        profileRepository,
        true,
        &sessionRepository);

    std::vector<std::string> tokens;
    for (int index = 0; index < 12; ++index)
    {
        tokens.push_back(authService.login(
            "student_session_cap_smoke",
            "",
            "192.0.2." + std::to_string(index + 1),
            "Smoke Device " + std::to_string(index + 1)).get("token", "").asString());
    }
    const auto current = authService.verify(tokens.back());
    const auto sessions = authService.sessionsForUser(
        current.get("user_id", "").asString(),
        tokens.back());
    assert(sessions.size() == 10);
    expectAppException("TOKEN_INVALID", [&]() {
        (void)authService.verify(tokens.front());
    });
    assert(authService.verify(tokens.back()).get("username", "").asString() ==
           "student_session_cap_smoke");
}

void testPasswordLifecycle()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::SessionRepository sessionRepository(tempDir.path());
    RecordingEmailService emailService;
    RecordingSmsService smsService;
    application::services::AuthService authService(
        userRepository,
        profileRepository,
        true,
        &sessionRepository,
        &emailService,
        &smsService);

    const auto registered = authService.registerUser("password_lifecycle_smoke", "Start12345", "password_lifecycle@example.com");
    const auto token = registered.get("token", "").asString();
    assert(!token.empty());
    const auto session = authService.verify(token);
    assert(session.get("username", "").asString() == "password_lifecycle_smoke");

    const auto userId = session.get("user_id", "").asString();
    authService.requirePasswordReauthentication(userId, "Start12345");
    expectAppException("REAUTH_FAILED", [&]() {
        authService.requirePasswordReauthentication(userId, "wrong-password");
    });
    authService.changePassword(userId, "Start12345", "Changed12345");
    expectAppException("INVALID_CREDENTIALS", [&]() {
        (void)authService.login("password_lifecycle_smoke", "Start12345");
    });
    const auto firstChangedToken = authService.login("password_lifecycle_smoke", "Changed12345").get("token", "").asString();
    const auto secondChangedToken = authService.login("password_lifecycle_smoke", "Changed12345").get("token", "").asString();
    assert(!firstChangedToken.empty());
    assert(!secondChangedToken.empty());
    assert(authService.revokeSessionsForUser(userId, firstChangedToken) >= 1);
    assert(authService.verify(firstChangedToken).get("user_id", "").asString() == userId);
    expectAppException("TOKEN_INVALID", [&]() {
        (void)authService.verify(secondChangedToken);
    });

    const auto sent = authService.sendPasswordResetCode("password_lifecycle_smoke");
    assert(sent.get("channel", "").asString() == "email");
    assert(emailService.messages.size() == 1);
    const auto resetCode = extractSixDigitCode(emailService.messages.front().textBody);
    assert(resetCode.size() == 6);
    const auto reset = authService.resetPassword("password_lifecycle_smoke", resetCode, "Reset12345");
    assert(!reset.get("token", "").asString().empty());
    assert(!authService.login("password_lifecycle_smoke", "Reset12345").get("token", "").asString().empty());
}

void testPasswordsUseSaltedScryptAndMigrateLegacyHashes()
{
    ScopedTempDir modernDir;
    infrastructure::storage::UserRepository modernRepository(modernDir.path());
    const auto first = modernRepository.createUser(
        "scrypt_first",
        "Shared12345",
        "scrypt-first@example.com");
    const auto second = modernRepository.createUser(
        "scrypt_second",
        "Shared12345",
        "scrypt-second@example.com");
    assert(first.get("password_algo", "").asString() == "scrypt");
    assert(second.get("password_algo", "").asString() == "scrypt");
    assert(first.get("password_hash", "").asString().rfind("scrypt$", 0) == 0);
    assert(first.get("password_hash", "").asString() != second.get("password_hash", "").asString());
    assert(modernRepository.verifyPassword(first, "Shared12345"));
    assert(!modernRepository.verifyPassword(first, "Wrong12345"));

    ScopedTempDir legacyDir;
    Json::Value users(Json::objectValue);
    users["legacy_user"]["id"] = "legacy_user";
    users["legacy_user"]["user_id"] = "legacy_user";
    users["legacy_user"]["username"] = "legacy_login";
    users["legacy_user"]["password_hash"] = drogon::utils::getSha256("Legacy12345");
    users["legacy_user"]["password_algo"] = "sha256";
    users["legacy_user"]["status"] = "active";
    users["legacy_user"]["roles"] = Json::arrayValue;
    users["legacy_user"]["roles"].append("student");
    infrastructure::storage::writeJsonFileAtomic(legacyDir.path() / "users.json", users);

    infrastructure::storage::UserRepository legacyRepository(legacyDir.path());
    infrastructure::storage::ProfileRepository profileRepository(legacyDir.path());
    application::services::AuthService authService(legacyRepository, profileRepository, false);
    assert(!authService.login("legacy_login", "Legacy12345").get("token", "").asString().empty());
    const auto migrated = legacyRepository.findUserById("legacy_user");
    assert(migrated.get("password_algo", "").asString() == "scrypt");
    assert(migrated.get("password_hash", "").asString().rfind("scrypt$", 0) == 0);
    assert(!migrated.get("password_migrated_at", "").asString().empty());
}

void testAuthenticationRateLimitsAndResetAttemptCap()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    RecordingEmailService emailService;
    RecordingSmsService smsService;
    application::services::AuthService authService(
        userRepository,
        profileRepository,
        false,
        nullptr,
        &emailService,
        &smsService);
    userRepository.createUser("rate_limit_user", "Correct12345", "rate-limit@example.com");

    for (int attempt = 0; attempt < 4; ++attempt)
    {
        expectAppException("INVALID_CREDENTIALS", [&]() {
            (void)authService.login("rate_limit_user", "Wrong12345", "127.0.0.1");
        });
    }
    expectAppException("AUTH_RATE_LIMITED", [&]() {
        (void)authService.login("rate_limit_user", "Wrong12345", "127.0.0.1");
    });
    expectAppException("AUTH_RATE_LIMITED", [&]() {
        (void)authService.login("rate_limit_user", "Correct12345", "127.0.0.1");
    });

    userRepository.createUser("reset_attempt_user", "Before12345", "reset-attempt@example.com");
    const auto sent = authService.sendPasswordResetCode("reset_attempt_user", "127.0.0.2");
    assert(sent.get("sent", false).asBool());
    for (int attempt = 0; attempt < 4; ++attempt)
    {
        expectAppException("RESET_CODE_INVALID", [&]() {
            (void)authService.resetPassword("reset_attempt_user", "000000", "After12345");
        });
    }
    expectAppException("RESET_CODE_ATTEMPTS_EXCEEDED", [&]() {
        (void)authService.resetPassword("reset_attempt_user", "000000", "After12345");
    });
}

void testUserSearchUsesProfileIndex()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(
        profileRepository, organizationRepository, userRepository, 0);
    application::services::UserService userService(
        userRepository, profileRepository, organizationRepository, subscriptionService);

    const auto user = userRepository.createUser(
        "search_alpha_account", "Search12345", "search-alpha@example.com");
    const auto userId = user.get("id", "").asString();
    assert(!userId.empty());

    auto profile = profileRepository.loadProfile(userId);
    profile["display_name"] = "东京升学顾问 Alpha";
    profileRepository.saveProfile(userId, profile);

    const auto byAccountFragment = userService.searchUsers("alpha_acc", 10);
    assert(byAccountFragment.size() == 1);
    assert(byAccountFragment[0].get("id", "").asString() == userId);

    const auto byDisplayName = userService.searchUsers("升学顾问", 10);
    assert(byDisplayName.size() == 1);
    assert(byDisplayName[0].get("display_name", "").asString() == "东京升学顾问 Alpha");

    profile["display_name"] = "大阪课程顾问 Beta";
    profileRepository.saveProfile(userId, profile);
    assert(userService.searchUsers("升学顾问", 10).empty());
    const auto updatedName = userService.searchUsers("课程顾问", 10);
    assert(updatedName.size() == 1);
    assert(updatedName[0].get("id", "").asString() == userId);
}

void testOrganizationMemberPermissionOverrides()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(profileRepository, organizationRepository, userRepository, 0);
    RecordingSmsService smsService;
    RecordingEmailService emailService;
    application::services::OrganizationService organizationService(
        organizationRepository,
        userRepository,
        subscriptionService,
        smsService,
        emailService,
        "http://127.0.0.1:8000");
    application::services::UserService userService(userRepository, profileRepository, organizationRepository, subscriptionService);

    const auto owner = userRepository.createUser("org_override_owner", "secret", "owner@example.com");
    const auto teacher = userRepository.createUser("org_override_teacher", "secret", "teacher@example.com");
    const auto ownerId = owner.get("id", "").asString();
    const auto teacherId = teacher.get("id", "").asString();
    assert(!ownerId.empty());
    assert(!teacherId.empty());

    Json::Value createOrg(Json::objectValue);
    createOrg["name"] = "Permission Override Smoke";
    createOrg["organization_type"] = "school";
    createOrg["seats"] = 10;
    const auto organization = organizationService.createOrganization(ownerId, createOrg);
    const auto organizationId = organization.get("organization_id", "").asString();
    assert(!organizationId.empty());

    Json::Value roles(Json::arrayValue);
    roles.append("teacher");

    Json::Value templates(Json::arrayValue);
    templates.append("assistant");
    templates.append("campusAdmin");

    Json::Value overrides(Json::arrayValue);
    Json::Value allowImport(Json::objectValue);
    allowImport["permission"] = "student.import";
    allowImport["effect"] = "allow";
    allowImport["scope"] = "organization";
    allowImport["expires_at"] = "2026-12-31T23:59:59Z";
    overrides.append(allowImport);
    Json::Value denyDelete(Json::objectValue);
    denyDelete["permission"] = "assignment.create";
    denyDelete["effect"] = "deny";
    denyDelete["scope"] = "learningGroup";
    denyDelete["scope_id"] = "lg_smoke_001";
    overrides.append(denyDelete);
    Json::Value ignored(Json::objectValue);
    ignored["permission"] = "dangerous.internal";
    ignored["effect"] = "allow";
    ignored["scope"] = "platform";
    overrides.append(ignored);

    Json::Value memberPayload(Json::objectValue);
    memberPayload["user_id"] = teacherId;
    memberPayload["roles"] = roles;
    memberPayload["permission_templates"] = templates;
    memberPayload["permission_overrides"] = overrides;
    const auto member = organizationService.upsertMember(ownerId, organizationId, memberPayload);
    assert(member["permission_templates"].isArray());
    assert(member["permission_templates"].empty());
    assert(member["permission_overrides"].isArray());
    assert(member["permission_overrides"].size() == 2);
    assert(member["permission_overrides"][0].get("permission", "").asString() == "student.import");
    assert(member["permission_overrides"][1].get("effect", "").asString() == "deny");

    auto teacherProfile = profileRepository.loadProfile(teacherId);
    teacherProfile["scope_type"] = "organization";
    teacherProfile["scope_id"] = organizationId;
    teacherProfile["organization_type"] = "school";
    profileRepository.saveProfile(teacherId, teacherProfile);

    const auto permissions = userService.permissions(teacherId);
    assert(permissions["permission_templates"].isArray());
    assert(permissions["permission_templates"].empty());
    assert(permissions["permission_overrides"].isArray());
    assert(permissions["permission_overrides"].size() == 2);

    const auto organizationAfterUpdate = organizationService.getOrganization(organizationId);
    assert(organizationAfterUpdate["audit_logs"].isArray());
    bool sawMemberUpdateAudit = false;
    for (const auto &entry : organizationAfterUpdate["audit_logs"])
    {
        if (entry.get("action", "").asString() == "member.added" &&
            entry["details"].isMember("permission_overrides"))
        {
            sawMemberUpdateAudit = true;
            break;
        }
    }
    assert(sawMemberUpdateAudit);
}

void testOrganizationLearningModel()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository userRepository(tempDir.path());
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::SubscriptionService subscriptionService(profileRepository, organizationRepository, userRepository, 0);
    RecordingSmsService smsService;
    RecordingEmailService emailService;
    application::services::OrganizationService organizationService(
        organizationRepository,
        userRepository,
        subscriptionService,
        smsService,
        emailService,
        "http://127.0.0.1:8000");

    const auto owner = userRepository.createUser("learning_model_owner", "secret", "learning-owner@example.com");
    const auto teacher = userRepository.createUser("learning_model_teacher", "secret", "learning-teacher@example.com");
    const auto student = userRepository.createUser("learning_model_student", "secret", "learning-student@example.com");
    const auto ownerId = owner.get("id", "").asString();
    const auto teacherId = teacher.get("id", "").asString();
    const auto studentId = student.get("id", "").asString();
    assert(!ownerId.empty());
    assert(!teacherId.empty());
    assert(!studentId.empty());

    Json::Value createOrg(Json::objectValue);
    createOrg["name"] = "Learning Model Smoke";
    createOrg["organization_type"] = "school";
    createOrg["seats"] = 30;
    const auto organization = organizationService.createOrganization(ownerId, createOrg);
    const auto organizationId = organization.get("organization_id", "").asString();
    assert(!organizationId.empty());

    Json::Value campusPayload(Json::objectValue);
    campusPayload["name"] = "东京校区";
    campusPayload["address"] = "Tokyo";
    const auto campus = organizationService.upsertCampus(ownerId, organizationId, campusPayload);
    const auto campusId = campus.get("campus_id", "").asString();
    assert(!campusId.empty());
    assert(campus.get("name", "").asString() == "东京校区");
    assert(organizationService.listCampuses(organizationId).size() == 1);

    Json::Value groupPayload(Json::objectValue);
    groupPayload["name"] = "EJU 日语基础班";
    groupPayload["type"] = "class";
    groupPayload["subject"] = "japanese";
    groupPayload["campus_id"] = campusId;
    const auto group = organizationService.upsertLearningGroup(ownerId, organizationId, groupPayload);
    const auto groupId = group.get("learning_group_id", "").asString();
    assert(!groupId.empty());
    assert(group.get("type", "").asString() == "class");
    assert(group.get("campus_id", "").asString() == campusId);
    assert(organizationService.listLearningGroups(organizationId).size() == 1);

    Json::Value teacherEnrollment(Json::objectValue);
    teacherEnrollment["user_id"] = teacherId;
    teacherEnrollment["role"] = "teacher";
    const auto savedTeacherEnrollment = organizationService.upsertLearningGroupEnrollment(ownerId, organizationId, groupId, teacherEnrollment);
    assert(savedTeacherEnrollment.get("role", "").asString() == "teacher");

    Json::Value studentEnrollment(Json::objectValue);
    studentEnrollment["user_id"] = studentId;
    studentEnrollment["role"] = "student";
    const auto savedStudentEnrollment = organizationService.upsertLearningGroupEnrollment(ownerId, organizationId, groupId, studentEnrollment);
    assert(savedStudentEnrollment.get("role", "").asString() == "student");
    assert(organizationService.listLearningGroupEnrollments(organizationId, groupId).size() == 2);

    Json::Value packagePayload(Json::objectValue);
    packagePayload["student_id"] = studentId;
    packagePayload["subject"] = "sogo";
    packagePayload["title"] = "文综约课 20 次";
    packagePayload["total_lessons"] = 20;
    packagePayload["used_lessons"] = 3;
    const auto coursePackage = organizationService.upsertCoursePackage(ownerId, organizationId, packagePayload);
    const auto coursePackageId = coursePackage.get("course_package_id", "").asString();
    assert(!coursePackageId.empty());
    assert(coursePackage.get("remaining_lessons", 0).asInt() == 17);
    assert(coursePackage.get("status", "").asString() == "active");
    assert(organizationService.listCoursePackages(organizationId).size() == 1);

    Json::Value bookingPayload(Json::objectValue);
    bookingPayload["name"] = "文综一对一试讲";
    bookingPayload["type"] = "booking";
    bookingPayload["subject"] = "sogo";
    bookingPayload["campus_id"] = campusId;
    bookingPayload["course_package_id"] = coursePackageId;
    const auto booking = organizationService.upsertLearningGroup(ownerId, organizationId, bookingPayload);
    const auto bookingId = booking.get("learning_group_id", "").asString();
    assert(!bookingId.empty());
    assert(booking.get("type", "").asString() == "booking");

    Json::Value completePayload(Json::objectValue);
    completePayload["note"] = "lesson completed";
    const auto completed = organizationService.completeLearningGroup(ownerId, organizationId, bookingId, completePayload);
    assert(completed.get("deducted", false).asBool());
    assert(completed["learning_group"].get("status", "").asString() == "completed");
    assert(completed["course_package"].get("remaining_lessons", 0).asInt() == 16);
    assert(completed["course_package"].get("used_lessons", 0).asInt() == 4);

    const auto completedAgain = organizationService.completeLearningGroup(ownerId, organizationId, bookingId, Json::Value(Json::objectValue));
    assert(!completedAgain.get("deducted", true).asBool());
    assert(completedAgain["course_package"].get("remaining_lessons", 0).asInt() == 16);
    assert(completedAgain["course_package"].get("used_lessons", 0).asInt() == 4);

    const auto organizationAfterUpdate = organizationService.getOrganization(organizationId);
    bool sawCampusAudit = false;
    bool sawGroupAudit = false;
    bool sawPackageAudit = false;
    bool sawCompleteAudit = false;
    for (const auto &entry : organizationAfterUpdate["audit_logs"])
    {
        const auto action = entry.get("action", "").asString();
        sawCampusAudit = sawCampusAudit || action == "campus.created";
        sawGroupAudit = sawGroupAudit || action == "learning_group.created";
        sawPackageAudit = sawPackageAudit || action == "course_package.created";
        sawCompleteAudit = sawCompleteAudit || action == "learning_group.completed";
    }
    assert(sawCampusAudit);
    assert(sawGroupAudit);
    assert(sawPackageAudit);
    assert(sawCompleteAudit);
}

void testAutomaticAssignmentRemindersAreTargetedAndIdempotent()
{
    ScopedTempDir tempDir;
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    infrastructure::storage::AssignmentRepository assignmentRepository(tempDir.path());
    application::services::AssignmentService assignmentService(assignmentRepository, organizationRepository);

    Json::Value organization(Json::objectValue);
    organization["organization_id"] = "org-reminder-smoke";
    organization["name"] = "Reminder Smoke";
    organization["learning_groups"] = Json::Value(Json::arrayValue);
    Json::Value group(Json::objectValue);
    group["learning_group_id"] = "group-reminder-smoke";
    group["name"] = "提醒测试班";
    group["status"] = "active";
    group["enrollments"] = Json::Value(Json::arrayValue);
    for (const auto &studentId : {"student-missing", "student-submitted"})
    {
        Json::Value enrollment(Json::objectValue);
        enrollment["user_id"] = studentId;
        enrollment["role"] = "student";
        enrollment["status"] = "active";
        group["enrollments"].append(enrollment);
    }
    organization["learning_groups"].append(group);
    organizationRepository.upsertOrganization(organization);

    Json::Value payload(Json::objectValue);
    payload["exam_id"] = "exam-reminder-smoke";
    payload["title"] = "自动催交回归作业";
    payload["due_at"] = "2026-08-01T12:00:00Z";
    payload["auto_reminder_enabled"] = true;
    payload["auto_reminder_hours_before"].append(24);
    const auto assignment = assignmentService.createAssignment(
        "org-reminder-smoke",
        "group-reminder-smoke",
        "teacher-smoke",
        payload);
    const auto assignmentId = assignment.get("assignment_id", "").asString();
    assert(!assignmentId.empty());

    Json::Value answers(Json::objectValue);
    answers["1"] = 1;
    Json::Value score(Json::objectValue);
    score["score"] = 100;
    assignmentService.submitAssignment(assignmentId, "student-submitted", answers, score);

    const auto firstRun = assignmentService.runAutomaticReminderJobs("2026-07-31T13:00:00Z");
    assert(firstRun.get("reminders_created", 0).asInt() == 1);
    assert(firstRun.get("targets", 0).asInt() == 1);
    assert(firstRun["deliveries"][0].get("hours_before", 0).asInt() == 24);

    const auto secondRun = assignmentService.runAutomaticReminderJobs("2026-07-31T13:15:00Z");
    assert(secondRun.get("reminders_created", 0).asInt() == 0);

    const auto missingStudentView = assignmentService.getAssignmentForStudent(assignmentId, "student-missing");
    assert(!missingStudentView.isMember("submissions"));
    assert(!missingStudentView.isMember("reminders"));
    assert(missingStudentView["own_reminders"].size() == 1);
    assert(missingStudentView["own_reminders"][0].get("source", "").asString() == "automatic");
    assert(!missingStudentView["own_reminders"][0].isMember("target_student_ids"));

    const auto submittedStudentView = assignmentService.getAssignmentForStudent(assignmentId, "student-submitted");
    assert(submittedStudentView["own_reminders"].empty());
    assert(!submittedStudentView["own_submission"].isNull());

    Json::Value disabledPayload = payload;
    disabledPayload["title"] = "关闭自动催交的作业";
    disabledPayload["auto_reminder_enabled"] = false;
    assignmentService.createAssignment(
        "org-reminder-smoke",
        "group-reminder-smoke",
        "teacher-smoke",
        disabledPayload);
    const auto disabledRun = assignmentService.runAutomaticReminderJobs("2026-07-31T14:00:00Z");
    assert(disabledRun.get("reminders_created", 0).asInt() == 0);

    Json::Value invalidPayload = payload;
    invalidPayload["auto_reminder_hours_before"] = Json::Value(Json::arrayValue);
    invalidPayload["auto_reminder_hours_before"].append(0);
    expectAppException("VALIDATION_ERROR", [&]() {
        assignmentService.createAssignment(
            "org-reminder-smoke",
            "group-reminder-smoke",
            "teacher-smoke",
            invalidPayload);
    });
}

void testCompositeAnswerKeysAreScoredPerSection()
{
    ScopedTempDir tempDir;
    infrastructure::storage::AnswerRepository answerRepository(tempDir.path());
    application::services::AnswerService answerService(answerRepository);

    Json::Value exam(Json::objectValue);
    exam["exam_info"]["sections"] = Json::Value(Json::arrayValue);

    Json::Value firstSection(Json::objectValue);
    firstSection["questions"] = Json::Value(Json::arrayValue);
    firstSection["questions"][0]["id"] = "1";
    firstSection["questions"][0]["correct_answer"] = 1;

    Json::Value secondSection(Json::objectValue);
    secondSection["questions"] = Json::Value(Json::arrayValue);
    secondSection["questions"][0]["id"] = "1";
    secondSection["questions"][0]["correct_answer"] = 2;

    exam["exam_info"]["sections"].append(firstSection);
    exam["exam_info"]["sections"].append(secondSection);

    Json::Value answers(Json::objectValue);
    answers["0:1"] = 1;
    answers["1:1"] = 2;

    const auto score = answerService.calculateScore("composite_smoke", answers, exam);
    assert(score.get("total_questions", 0).asInt() == 2);
    assert(score.get("correct_count", 0).asInt() == 2);
    assert(score["results"].isMember("0:1"));
    assert(score["results"].isMember("1:1"));
    assert(score["results"]["0:1"].get("question_id", "").asString() == "1");
    assert(score["results"]["1:1"].get("section_index", -1).asInt() == 1);
}

void testDraftRevisionConflictAndForcedOverwrite()
{
    ScopedTempDir tempDir;
    infrastructure::storage::DraftRepository repository(tempDir.path());
    application::services::DraftService service(repository);
    Json::Value initial(Json::objectValue);
    initial["exam_id"] = "exam-a";
    initial["attempt_id"] = "attempt-a";
    initial["answers"]["0:1"] = 1;
    const auto first = service.save("student-a", initial);
    assert(first.get("revision", 0).asInt() == 1);

    Json::Value stale = initial;
    stale["base_revision"] = 0;
    bool sawConflict = false;
    try { service.save("student-a", stale); }
    catch (const common::AppException &error) { sawConflict = error.code() == "DRAFT_CONFLICT"; }
    assert(sawConflict);

    stale["force_overwrite"] = true;
    const auto forced = service.save("student-a", stale);
    assert(forced.get("revision", 0).asInt() == 2);

    service.markSubmitted("student-a", "exam-a", "attempt-a");
    bool sawSubmitted = false;
    try { service.save("student-a", forced); }
    catch (const common::AppException &error) { sawSubmitted = error.code() == "ATTEMPT_SUBMITTED"; }
    assert(sawSubmitted);
}

void testExpiredSectionsPersistInTimerSnapshot()
{
    ScopedTempDir tempDir;
    infrastructure::storage::AttemptTimerRepository repository(tempDir.path());
    Json::Value start(Json::objectValue);
    start["exam_id"] = "exam-a";
    start["section_limits_seconds"].append(30);
    repository.start("student-a", start);
    Json::Value tick(Json::objectValue);
    tick["exam_id"] = "exam-a";
    tick["section_index"] = 0;
    tick["delta_seconds"] = 30;
    const auto snapshot = repository.tick("student-a", tick);
    assert(snapshot["expired_section_indexes"].isArray());
    assert(snapshot["expired_section_indexes"][0].asInt() == 0);
}

void testAnswerSubmissionIdempotencyAndHistory()
{
    ScopedTempDir tempDir;
    infrastructure::storage::AnswerRepository repository(tempDir.path());
    Json::Value answers(Json::objectValue);
    answers["0:1"] = 1;
    Json::Value statistics(Json::objectValue);
    statistics["score"] = 100;
    const auto first = repository.saveAnswer("student-a", "exam-a", answers, statistics, "submission-a");
    const auto replay = repository.saveAnswer("student-a", "exam-a", answers, statistics, "submission-a");
    assert(!first.get("idempotent_replay", true).asBool());
    assert(replay.get("idempotent_replay", false).asBool());
    assert(repository.listAttempts("student-a", "exam-a").size() == 1);
}

void testAuditLogsRotateAndRemainQueryable()
{
    ScopedTempDir tempDir;
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());
    application::services::AuditLogService service(tempDir.path(), organizationRepository, 2);

    service.record("feature_flags.system.updated", "admin-a", "第一次修改");
    service.record("feature_flags.system.updated", "admin-a", "第二次修改");
    service.record("feature_flags.system.updated", "admin-a", "第三次修改");
    service.record("content.exam.updated", "content-a", "修改试卷内容");

    assert(std::filesystem::exists(tempDir.path() / "core.sqlite3"));

    application::services::AuditLogQuery query;
    query.action = "feature_flags.system.updated";
    const auto result = service.query(query);
    assert(result.get("total", 0).asInt() == 3);
    assert(result["items"][0].get("action_label", "").asString() == "修改系统功能开关");

    application::services::AuditLogQuery contentQuery;
    contentQuery.actionPrefix = "content.";
    const auto contentResult = service.query(contentQuery);
    assert(contentResult.get("total", 0).asInt() == 1);
    assert(contentResult["items"][0].get("action", "").asString() == "content.exam.updated");
    const auto contentActions = service.listActions(std::nullopt, "content.");
    assert(contentActions["actions"].size() == 1);
    assert(contentActions["actions"][0].asString() == "content.exam.updated");
}
}  // namespace

int main()
{
    testProductionConfigurationFailsClosed();
    testRequestIdsRemainUnique();
    testReferralRewardSettlesOnActivePaidSubscription();
    testSubscriptionEntitlementsFollowPlanAndActiveStatus();
    testRenewalNotificationOutboxRetriesFailedEmail();
    testStripeWebhookRejectsExpiredSignedPayload();
    testEmailRebindNotifiesPreviouslyVerifiedAddress();
    testPhoneRebindNotifiesPreviouslyVerifiedNumber();
    testPhoneVerificationDailyLimit();
    testAuthSessionPersistsAcrossServiceInstances();
    testAuthSessionsAreCappedPerUser();
    testPasswordLifecycle();
    testPasswordsUseSaltedScryptAndMigrateLegacyHashes();
    testAuthenticationRateLimitsAndResetAttemptCap();
    testUserSearchUsesProfileIndex();
    testOrganizationMemberPermissionOverrides();
    testOrganizationLearningModel();
    testAutomaticAssignmentRemindersAreTargetedAndIdempotent();
    testCompositeAnswerKeysAreScoredPerSection();
    testDraftRevisionConflictAndForcedOverwrite();
    testAnswerSubmissionIdempotencyAndHistory();
    testExpiredSectionsPersistInTimerSnapshot();
    testAuditLogsRotateAndRemainQueryable();
    return 0;
}
