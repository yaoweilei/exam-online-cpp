// Smoke assertions must run in MinSizeRel and Release configurations too.
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

#include <drogon/utils/Utilities.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

#include "application/services/ContactChangeChallengeService.h"
#include "application/services/AdaptiveLearningService.h"
#include "application/services/DailyPracticeService.h"
#include "application/services/DraftService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/FeatureFlagService.h"
#include "application/services/AnswerService.h"
#include "application/services/AssignmentService.h"
#include "application/services/AssignmentScope.h"
#include "application/services/BackupStatus.h"
#include "application/services/AuthService.h"
#include "application/services/AuditLogService.h"
#include "application/services/OrganizationService.h"
#include "application/services/PaymentService.h"
#include "application/services/PhoneService.h"
#include "application/services/SubscriptionService.h"
#include "application/services/UserService.h"
#include "application/services/WechatService.h"
#include "common/RequestId.h"
#include "common/AppException.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/AttemptTimerRepository.h"
#include "infrastructure/storage/DraftRepository.h"
#include "infrastructure/storage/FeatureFlagRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/SessionRepository.h"
#include "infrastructure/storage/UserRepository.h"
#include "infrastructure/storage/WrongQuestionRepository.h"
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

void testWechatDevelopmentMobileEntryRequiresExplicitIdentity()
{
	ScopedTempDir tempDir;
	infrastructure::storage::UserRepository userRepository(tempDir.path());
	infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
	infrastructure::storage::SessionRepository sessionRepository(tempDir.path());
	application::services::AuthService authService(userRepository, profileRepository, true, &sessionRepository);
	application::services::WechatService wechatService(
		userRepository,
		authService,
		application::services::WechatService::Config{});

	const auto entry = wechatService.generateMobileAuthorization();
	assert(entry.get("stub", false).asBool());
	assert(entry.get("auth_url", "unexpected").asString().empty());
	assert(entry["test_ids"].isArray());
	assert(entry["test_ids"].size() == 6);
	assert(entry.get("qrcode_url", "").asString().find("student_demo") == std::string::npos);
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
    authService.changePassword(userId, "Changed12345");
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

void testInstitutionWorkflowRejectsStaleOrganizationSave()
{
    ScopedTempDir tempDir;
    infrastructure::storage::OrganizationRepository repository(tempDir.path());
    Json::Value initial(Json::objectValue);
    initial["organization_id"] = "org_workflow_revision";
    initial["name"] = "Initial";
    repository.upsertOrganization(initial);
    const auto stale = repository.findOrganization("org_workflow_revision");
    repository.updateOrganization("org_workflow_revision", [](Json::Value &organization) {
        organization["lessons"][0]["status"] = "completed";
        organization["lesson_ledger"][0]["change"] = -1;
    });
    bool rejected = false;
    try { repository.upsertOrganization(stale); }
    catch (const common::AppException &) { rejected = true; }
    if (!rejected) throw std::runtime_error("Stale organization save overwrote a completed lesson");
    auto latest = repository.findOrganization("org_workflow_revision");
    latest["name"] = "Updated management settings";
    repository.upsertOrganization(latest);
    if (repository.findOrganization("org_workflow_revision")["lesson_ledger"][0]["change"].asInt() != -1)
        throw std::runtime_error("Management save lost the lesson ledger");
    try {
        repository.updateOrganization("org_workflow_revision", [](Json::Value &organization) {
            organization["lesson_ledger"][0]["change"] = -9;
            throw std::runtime_error("Cancel transaction");
        });
    } catch (const std::runtime_error &) {}
    if (repository.findOrganization("org_workflow_revision")["lesson_ledger"][0]["change"].asInt() != -1)
        throw std::runtime_error("Failed workflow update was partially persisted");
}

void testOrganizationArchivePreservesDataAndBlocksAccess()
{
    ScopedTempDir tempDir;
    infrastructure::storage::UserRepository users(tempDir.path());
    infrastructure::storage::ProfileRepository profiles(tempDir.path());
    infrastructure::storage::OrganizationRepository organizations(tempDir.path());
    application::services::SubscriptionService subscriptions(profiles, organizations, users, 0);
    RecordingSmsService sms;
    RecordingEmailService email;
    application::services::OrganizationService service(organizations, users, subscriptions, sms, email, "http://localhost");
    application::services::PaymentService payments(tempDir.path(), subscriptions, &users, &email);
    const auto admin = users.createDevelopmentUser("superadmin_archive_smoke");
    const auto student = users.createUser("archive_student", "secret", "archive@example.com");
    const auto adminId = admin["id"].asString(), studentId = student["id"].asString();
    Json::Value payload(Json::objectValue);
    payload["name"] = "Archive test"; payload["organization_type"] = "school"; payload["seats"] = 30;
    const auto organization = service.createOrganization(adminId, payload);
    const auto id = organization["organization_id"].asString();
    Json::Value member(Json::objectValue);
    member["user_id"] = studentId; member["roles"] = Json::arrayValue; member["roles"].append("student");
    service.upsertMember(adminId, id, member);
    Json::Value group(Json::objectValue); group["name"] = "Preserved class";
    service.upsertLearningGroup(adminId, id, group);
    const auto stale = organizations.findOrganization(id);
    const auto originalMembers = organizations.listMembershipsForScope(id);
    const auto membershipData = [](Json::Value members) {
        for (auto &value : members) value.removeMember("_storage_key");
        return members;
    };
    expectAppException("FORBIDDEN", [&] { service.setOrganizationArchived(studentId, id, true); });
    const auto archive = [&] { return service.setOrganizationArchived(adminId, id, true); };
    payments.archiveOrganization(id, archive);
    assert(organizations.findOrganization(id).isNull());
    assert(organizations.organizationCount() == 0);
    assert(organizations.findMembership(studentId, id).isNull());
    assert(organizations.listMembershipsForUser(studentId).empty());
    assert(!service.canAccessOrganization(studentId, student["roles"], id));
    assert(service.effectiveOrganizationPermissions(adminId, admin["roles"], id).empty());
    expectAppException("ORGANIZATION_ARCHIVED", [&] { organizations.upsertOrganization(stale); });
    expectAppException("ORGANIZATION_ARCHIVED", [&] { organizations.upsertMembership(originalMembers[0]); });
    expectAppException("ORGANIZATION_NOT_FOUND", [&] { subscriptions.subscriptionForOrganization(id); });
    assert(service.listOrganizationSummaries(adminId, true, id, 1, 10)["total"].asInt() == 0);
    Json::Value filters(Json::objectValue); filters["visibility"] = "archived";
    assert(service.listOrganizationSummaries(adminId, true, id, 1, 10, filters)["total"].asInt() == 1);
    {
        infrastructure::storage::OrganizationRepository reopened(tempDir.path());
        assert(reopened.findOrganization(id).isNull());
        assert(membershipData(reopened.listMembershipsForScope(id)) == membershipData(originalMembers));
        assert(reopened.findOrganization(id, true)["learning_groups"].size() == 1);
    }
    service.setOrganizationArchived(adminId, id, false);
    assert(organizations.listMembershipsForScope(id) == originalMembers);
    assert(service.listLearningGroups(id).size() == 1);
    assert(service.canAccessOrganization(studentId, student["roles"], id));
    const auto restored = organizations.findOrganization(id);
    assert(restored["audit_logs"][0]["action"].asString() == "organization.restored");
    Json::Value patch(Json::objectValue); patch["plan"] = "pro"; patch["status"] = "active";
    subscriptions.updateOrganizationSubscription(id, patch);
    expectAppException("ORGANIZATION_BILLING_ACTIVE", [&] { payments.archiveOrganization(id, archive); });
    patch["plan"] = "free"; subscriptions.updateOrganizationSubscription(id, patch);
    infrastructure::storage::SqliteJsonStore billing(tempDir.path() / "payments" / "payments.sqlite3");
    Json::Value order(Json::objectValue);
    order["id"] = "archive_order"; order["scope_type"] = "organization"; order["scope_id"] = id; order["status"] = "pending";
    billing.upsert("payment_orders", "archive_order", order);
    expectAppException("ORGANIZATION_BILLING_PENDING", [&] { payments.archiveOrganization(id, archive); });
    order["status"] = "paid"; billing.upsert("payment_orders", "archive_order", order);
    Json::Value refund(Json::objectValue); refund["id"] = "archive_refund"; refund["order_id"] = "archive_order"; refund["status"] = "requires_manual_review";
    billing.upsert("payment_refunds", "archive_refund", refund);
    expectAppException("ORGANIZATION_BILLING_PENDING", [&] { payments.archiveOrganization(id, archive); });
    refund["status"] = "succeeded"; billing.upsert("payment_refunds", "archive_refund", refund);
    payments.archiveOrganization(id, archive);
    assert(billing.get("payment_orders", "archive_order")["status"].asString() == "paid");
    assert(organizations.listMembershipsForScope(id) == originalMembers);
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

    const auto platformRoleTemplates = userService.platformRoleTemplates();
    bool sawOrganizationAssistant = false;
    bool sawPlatformContentAdmin = false;
    bool sawOrganizationContentAdminAsPlatformRole = false;
    for (const auto &role : platformRoleTemplates)
    {
        const auto roleId = role.get("id", "").asString();
        if (roleId == "assistant")
        {
            sawOrganizationAssistant = true;
            assert(role.get("organization_override_eligible", false).asBool());
            assert(role.get("allow_organization_override", false).asBool());
        }
        else if (roleId == "contentAdmin")
        {
            sawPlatformContentAdmin = true;
            assert(!role.get("organization_override_eligible", true).asBool());
            assert(!role.get("allow_organization_override", true).asBool());
        }
        else if (roleId == "orgContentAdmin")
        {
            sawOrganizationContentAdminAsPlatformRole = true;
        }
    }
    assert(sawOrganizationAssistant);
    assert(sawPlatformContentAdmin);
    assert(!sawOrganizationContentAdminAsPlatformRole);

    const auto owner = userRepository.createUser("org_override_owner", "secret", "owner@example.com");
    const auto teacher = userRepository.createUser("org_override_teacher", "secret", "teacher@example.com");
    const auto organizationContentAdmin = userRepository.createUser("org_content_admin", "secret", "org-content@example.com");
    const auto ownerId = owner.get("id", "").asString();
    const auto teacherId = teacher.get("id", "").asString();
    const auto organizationContentAdminId = organizationContentAdmin.get("id", "").asString();
    assert(!ownerId.empty());
    assert(!teacherId.empty());
    assert(!organizationContentAdminId.empty());

    Json::Value createOrg(Json::objectValue);
    createOrg["name"] = "Permission Override Smoke";
    createOrg["organization_type"] = "school";
    createOrg["seats"] = 10;
    const auto organization = organizationService.createOrganization(ownerId, createOrg);
    const auto organizationId = organization.get("organization_id", "").asString();
    assert(!organizationId.empty());
    const auto initialSummary = organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 20);
    assert(initialSummary["items"].size() == 1);
    assert(initialSummary["items"][0]["member_count"].asInt() == 1);
    assert(initialSummary["items"][0]["billable_member_count"].asInt() == 0);
    Json::Value directoryFilters(Json::objectValue);
    directoryFilters["members"] = "0";
    assert(organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 10, directoryFilters)["total"].asInt() == 0);
    directoryFilters["members"] = "1-10";
    directoryFilters["plan"] = "free";
    assert(organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 10, directoryFilters)["total"].asInt() == 1);
    directoryFilters["plan"] = "pro";
    assert(organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 10, directoryFilters)["total"].asInt() == 0);
    directoryFilters.removeMember("plan");
    directoryFilters["status"] = "suspended";
    assert(organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 10, directoryFilters)["total"].asInt() == 0);
    directoryFilters.removeMember("status");
    assert(organizationService.listOrganizationSummaries(teacherId, false, organizationId, 1, 10, directoryFilters)["total"].asInt() == 0);
    directoryFilters["sort"] = "member_count";
    directoryFilters["order"] = "desc";
    const auto sortedOrganizations = organizationService.listOrganizationSummaries(ownerId, true, "", 1, 100, directoryFilters);
    for (Json::ArrayIndex i = 1; i < sortedOrganizations["items"].size(); ++i)
        assert(sortedOrganizations["items"][i - 1]["member_count"].asInt() >= sortedOrganizations["items"][i]["member_count"].asInt());
    const auto containsPermission = [](const Json::Value &permissions, const std::string &expected) {
        for (const auto &permission : permissions)
        {
            if (permission.asString() == expected)
            {
                return true;
            }
        }
        return false;
    };
    const auto roleDefaults = organization.get("role_default_permissions", Json::Value(Json::objectValue));
    assert(roleDefaults.isObject());
    assert(containsPermission(roleDefaults["assistant"], "assignment.review"));
    assert(containsPermission(roleDefaults["assistant"], "gradebook.view"));
    assert(!containsPermission(roleDefaults["assistant"], "student.profile.edit"));
    assert(containsPermission(roleDefaults["teacher"], "learning_record.feedback.edit"));
    assert(!containsPermission(roleDefaults["teacher"], "student.profile.edit"));
    assert(containsPermission(roleDefaults["orgAdmin"], "organization.billing.manage"));
    assert(containsPermission(roleDefaults["orgContentAdmin"], "course_package.manage"));
    assert(containsPermission(roleDefaults["orgContentAdmin"], "course_package.view"));
    assert(!containsPermission(roleDefaults["orgContentAdmin"], "content.publish"));
    assert(!roleDefaults.isMember("contentAdmin"));

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
    const auto memberSummary = organizationService.listOrganizationSummaries(ownerId, true, organizationId, 1, 20);
    assert(memberSummary["items"][0]["member_count"].asInt() == 2);
    assert(memberSummary["items"][0]["billable_member_count"].asInt() == 1);
    assert(member["permission_templates"].isArray());
    assert(member["permission_templates"].empty());
    assert(member["permission_overrides"].isArray());
    assert(member["permission_overrides"].size() == 2);
    assert(member["permission_overrides"][0].get("permission", "").asString() == "student.import");
    assert(member["permission_overrides"][1].get("effect", "").asString() == "deny");

    const Json::Value noPlatformRoles(Json::arrayValue);
    Json::Value organizationContentAdminRoles(Json::arrayValue);
    organizationContentAdminRoles.append("orgContentAdmin");
    Json::Value organizationContentAdminPayload(Json::objectValue);
    organizationContentAdminPayload["user_id"] = organizationContentAdminId;
    organizationContentAdminPayload["roles"] = organizationContentAdminRoles;
    expectAppException("VALIDATION_ERROR", [&]() {
        organizationService.upsertMember(ownerId, organizationId, organizationContentAdminPayload);
    });
    Json::Value legacyMembership = organizationContentAdminPayload;
    legacyMembership["scope_type"] = "organization";
    legacyMembership["scope_id"] = organizationId;
    organizationRepository.upsertMembership(legacyMembership);
    const auto organizationContentMember = organizationService.upsertMember(
        ownerId, organizationId, organizationContentAdminPayload);
    assert(organizationContentMember["roles"].size() == 1);
    assert(organizationContentMember["roles"][0].asString() == "orgContentAdmin");
    assert(organizationService.hasOrganizationPermission(
        organizationContentAdminId, noPlatformRoles, organizationId, "course_package.manage"));
    assert(!organizationService.hasOrganizationPermission(
        organizationContentAdminId, noPlatformRoles, organizationId, "organization.member.manage"));
    assert(!organizationService.hasOrganizationPermission(
        organizationContentAdminId, noPlatformRoles, organizationId, "content.publish"));
    assert(organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "assignment.create"));
    assert(organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "learning_record.feedback.edit"));
    assert(!organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "student.profile.edit"));
    assert(organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "student.import"));
    assert(!organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "organization.member.manage"));
    assert(!organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "assignment.create", "learningGroup", "lg_smoke_001"));
    assert(organizationService.hasOrganizationPermission(
        teacherId, noPlatformRoles, organizationId, "assignment.create", "learningGroup", "lg_smoke_002"));

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
    assert(coursePackageId.rfind("acct_", 0) == 0);
    assert(coursePackage.get("remaining_lessons", 0).asInt() == 17);
    assert(coursePackage.get("status", "").asString() == "active");
    assert(organizationService.listCoursePackages(organizationId).size() == 1);

    Json::Value templatePayload(Json::objectValue);
    templatePayload["record_type"] = "template";
    templatePayload["title"] = "文综 20 课时模板";
    templatePayload["subject"] = "sogo";
    templatePayload["total_lessons"] = 20;
    const auto coursePackageTemplate = organizationService.upsertCoursePackage(ownerId, organizationId, templatePayload);
    const auto coursePackageTemplateId = coursePackageTemplate.get("course_package_id", "").asString();
    assert(coursePackageTemplateId.rfind("tpl_", 0) == 0);
    const auto deletedTemplate = organizationService.deleteCoursePackage(ownerId, organizationId, coursePackageTemplateId);
    assert(deletedTemplate.get("course_package_id", "").asString() == coursePackageTemplateId);
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

    Json::Value pausedPackagePayload(Json::objectValue);
    pausedPackagePayload["course_package_id"] = coursePackageId;
    pausedPackagePayload["status"] = "paused";
    const auto pausedPackage = organizationService.upsertCoursePackage(ownerId, organizationId, pausedPackagePayload);
    assert(pausedPackage.get("status", "").asString() == "paused");

    Json::Value pausedBookingPayload(Json::objectValue);
    pausedBookingPayload["name"] = "暂停账户约课";
    pausedBookingPayload["type"] = "booking";
    pausedBookingPayload["course_package_id"] = coursePackageId;
    const auto pausedBooking = organizationService.upsertLearningGroup(ownerId, organizationId, pausedBookingPayload);
    expectAppException("COURSE_PACKAGE_UNAVAILABLE", [&]() {
        (void)organizationService.completeLearningGroup(ownerId, organizationId, pausedBooking.get("learning_group_id", "").asString(), Json::Value(Json::objectValue));
    });

    Json::Value expiredPackagePayload(Json::objectValue);
    expiredPackagePayload["course_package_id"] = coursePackageId;
    expiredPackagePayload["status"] = "active";
    expiredPackagePayload["expires_at"] = "2020-01-01T00:00:00.000Z";
    const auto expiredPackage = organizationService.upsertCoursePackage(ownerId, organizationId, expiredPackagePayload);
    assert(expiredPackage.get("status", "").asString() == "expired");
    expectAppException("COURSE_PACKAGE_EXPIRED", [&]() {
        (void)organizationService.completeLearningGroup(ownerId, organizationId, pausedBooking.get("learning_group_id", "").asString(), Json::Value(Json::objectValue));
    });

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
    const auto submitted = assignmentService.submitAssignment(assignmentId, "student-submitted", answers, score, "receipt-smoke-1");
    const auto replay = assignmentService.submitAssignment(assignmentId, "student-submitted", answers, score, "receipt-smoke-1");
    assert(submitted["attempt_no"].asInt() == 1 && replay["attempt_no"].asInt() == 1);
    auto changedAnswers = answers;
    changedAnswers["1"] = 2;
    expectAppException("SUBMISSION_CONFLICT", [&]() {
        assignmentService.submitAssignment(assignmentId, "student-submitted", changedAnswers, score, "receipt-smoke-1");
    });
    expectAppException("ASSIGNMENT_SUBMITTED", [&]() {
        assignmentService.submitAssignment(assignmentId, "student-submitted", answers, score, "receipt-smoke-2");
    });
    expectAppException("ASSIGNMENT_SUBMITTED", [&]() {
        assignmentService.submitAssignment(assignmentId, "student-submitted", changedAnswers, score);
    });
    const auto legacyReplay = assignmentService.submitAssignment(assignmentId, "student-submitted", answers, score);
    assert(legacyReplay["attempt_no"].asInt() == 1 && legacyReplay["submission_id"] == submitted["submission_id"]);

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

    Json::Value review(Json::objectValue);
    review["action"] = "returned";
    review["comment"] = "请重做";
    assignmentService.reviewSubmission(assignmentId, "student-submitted", "teacher-smoke", review);
    Json::Value manual(Json::objectValue);
    manual["message"] = "请完成重做";
    manual["idempotency_key"] = "manual-returned-smoke";
    const auto reminder = assignmentService.remindAssignment(assignmentId, "teacher-smoke", manual);
    assert(reminder["target_student_ids"].size() == 2);
    const auto afterReturn = assignmentService.runAutomaticReminderJobs("2026-07-31T13:30:00Z");
    assert(afterReturn["targets"].asInt() == 2 && afterReturn["reminders_created"].asInt() == 1);
    assert(assignmentService.runAutomaticReminderJobs("2026-07-31T13:31:00Z")["reminders_created"].asInt() == 0);
    const auto redo = assignmentService.submitAssignment(assignmentId, "student-submitted", changedAnswers, score);
    assert(redo["attempt_no"].asInt() == 2 && !redo["submission_id"].asString().empty());
    assert(assignmentService.submitAssignment(assignmentId, "student-submitted", changedAnswers, score)["attempt_no"].asInt() == 2);
    manual["idempotency_key"] = "manual-after-resubmit";
    manual["student_ids"].append("student-submitted");
    manual["student_ids"].append("student-missing");
    assert(assignmentService.remindAssignment(assignmentId, "teacher-smoke", manual)["target_student_ids"].size() == 1);

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

    Json::Value targetedPayload = payload;
    targetedPayload["title"] = "只分配给一位学员的错题作业";
    targetedPayload["target_student_ids"].append("student-missing");
    const auto targeted = assignmentService.createAssignment("org-reminder-smoke", "group-reminder-smoke", "teacher-smoke", targetedPayload);
    const auto targetedId = targeted["assignment_id"].asString();
    const auto targetedRun = assignmentService.runAutomaticReminderJobs("2026-07-31T14:05:00Z");
    assert(targetedRun["reminders_created"].asInt() == 1 && targetedRun["targets"].asInt() == 1);
    const auto targetedStored = assignmentService.getAssignment(targetedId);
    assert(targetedStored["reminders"][0]["target_student_ids"].size() == 1);
    assert(targetedStored["reminders"][0]["target_student_ids"][0].asString() == "student-missing");
    expectAppException("FORBIDDEN", [&]() { assignmentService.getAssignmentForStudent(targetedId, "student-submitted"); });
    expectAppException("FORBIDDEN", [&]() { assignmentService.submitAssignment(targetedId, "student-submitted", answers, score); });

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
    initial["exam_mode"] = "mock";
    initial["answers"]["0:1"] = 1;
    const auto first = service.save("student-a", initial);
    assert(first.get("revision", 0).asInt() == 1);
    assert(first.get("exam_mode", "").asString() == "mock");

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

    Json::Value other = initial;
    other["exam_id"] = "exam-b";
    other["attempt_id"] = "attempt-b";
    other["answers"]["0:1"] = 2;
    service.save("student-a", other);
    assert(service.get("student-a", "exam-a")["answers"]["0:1"].asInt() == 1);
    assert(service.get("student-a", "exam-b")["answers"]["0:1"].asInt() == 2);
    assert(!service.clear("student-a", "exam-b", "attempt-a"));
    assert(service.clear("student-a", "exam-a", "attempt-a"));
    assert(service.get("student-a", "exam-a").isNull());
    assert(service.get("student-a")["exam_id"].asString() == "exam-b");

    // A legacy draft must survive saving and submitting another paper.
    const auto legacyPath = tempDir.path() / "drafts" / "legacy-user.json";
    infrastructure::storage::writeJsonFileAtomic(legacyPath, initial);
    service.save("legacy-user", other);
    service.clear("legacy-user", "exam-b", "attempt-b");
    assert(service.get("legacy-user", "exam-a")["answers"]["0:1"].asInt() == 1);
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
    const auto attempt = repository.saveAnswer("student-a", "exam-b", answers, statistics, "page-one", "shared-attempt");
    answers["0:1"] = 4;
    const auto otherPage = repository.saveAnswer("student-a", "exam-b", answers, statistics, "page-two", "shared-attempt");
    assert(!attempt["idempotent_replay"].asBool());
    assert(otherPage["idempotent_replay"].asBool());
    assert(otherPage["answers"]["0:1"].asInt() == 1);
    assert(repository.listAttempts("student-a", "exam-b").size() == 1);
    assert(!repository.saveAnswer("student-a", "exam-b", answers, statistics, "retry-new", "new-attempt")["idempotent_replay"].asBool());
}

void testDailyPracticeKeepsCompletedReviewsAndUsesWeakDomains()
{
    ScopedTempDir tempDir;
    infrastructure::storage::ExamRepository exams(tempDir.path() / "paper");
    infrastructure::storage::AnswerRepository answers(tempDir.path());
    infrastructure::storage::WrongQuestionRepository wrong(tempDir.path());
    infrastructure::storage::SrsRepository cards(tempDir.path());
    application::services::SrsService srs(cards);
    application::services::AdaptiveLearningService adaptive(tempDir.path());
    application::services::DailyPracticeService daily(tempDir.path(), wrong, srs, exams, answers);
    Json::Value paper(Json::objectValue);
    paper["family"] = "jlpt";
    paper["access_level"] = "free";
    paper["exam_info"]["exam_level"] = "N3";
    paper["exam_info"]["family"] = "jlpt";
    for (int index = 0; index < 2; ++index) {
        Json::Value section(Json::objectValue);
        section["section_type"] = index ? "listening" : "vocabulary";
        section["section_id"] = index ? "3.01" : "1.01";
        for (int id = 1; id <= 8; ++id) {
            Json::Value question(Json::objectValue);
            question["id"] = id; question["question"] = "test"; question["correct_answer"] = 1;
            question["options"].append("right"); question["options"].append("wrong");
            section["questions"].append(question);
        }
        paper["exam_info"]["sections"].append(section);
    }
    exams.saveExam("N3_2020_07", paper);
    Json::Value snapshot = paper["exam_info"]["sections"][1]["questions"][0];
    snapshot["section_index"] = 1;
    cards.upsertCard("review-student", "N3_2020_07", "1:1", "listening", snapshot, "2000-01-01T00:00:00Z");
    wrong.recordWrong("review-student", "N3_2020_07", "0:1", "1", "2", "1.01", "vocabulary", paper["exam_info"]["sections"][0]["questions"][0]);
    auto plan = daily.getOrCreateToday("review-student", 50, "JLPT N3", 20);
    bool foundDue = false, foundWrong = false;
    for (const auto &item : plan["items"]) {
        foundDue |= item["source"].asString() == "srs_due" && item["section_index"].asInt() == 1 && item["question_id"].asString() == "1";
        foundWrong |= item["source"].asString() == "wrong_question" && item["section_index"].asInt() == 0 && item["question_id"].asString() == "1";
    }
    assert(foundDue && foundWrong);
    daily.markComplete("review-student", "N3_2020_07", "1:1", "JLPT N3");
    plan = daily.getOrCreateToday("review-student", 50, "JLPT N3", 30);
    assert(plan["completed_question_ids"].size() == 1);
    assert(plan["completed_question_ids"][0].asString() == "N3_2020_07\x1f" "1:1");
    assert(daily.regenerate("review-student", 50, "JLPT N3", 20)["completed_question_ids"].size() == 1);
    Json::Value score(Json::objectValue), row(Json::objectValue);
    row["question_id"] = "1"; row["section_index"] = 1; row["status"] = "wrong";
    score["results"]["1:1"] = row;
    adaptive.recordSubmission("weak-student", "N3_DIAGNOSTIC_V1", paper, score);
    const auto focused = daily.getOrCreateToday("weak-student", 50, "JLPT N3", 20);
    assert(!focused["items"].empty());
    assert(focused["items"][0]["section_type"].asString() == "listening");
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

void testOrganizationFeatureFlagsRejectUnsupportedOverrides()
{
    ScopedTempDir tempDir;
    infrastructure::storage::ProfileRepository profileRepository(tempDir.path());
    infrastructure::storage::OrganizationRepository organizationRepository(tempDir.path());

    Json::Value organization(Json::objectValue);
    organization["organization_id"] = "org-feature-flags";
    organization["name"] = "Feature flag test";
    organization["feature_flags"]["oauth_extra"]["enabled"] = false;
    organization["feature_flags"]["admin_dashboard"]["enabled"] = false;
    organization["feature_flags"]["related_questions"]["enabled"] = false;
    organizationRepository.upsertOrganization(organization);

    infrastructure::storage::FeatureFlagRepository featureFlagRepository(
        tempDir.path() / "system",
        organizationRepository,
        profileRepository);
    application::services::FeatureFlagService service(featureFlagRepository, organizationRepository);

    Json::Value patch(Json::objectValue);
    patch["oauth_extra"]["enabled"] = false;
    patch["audit_log_viewer"]["enabled"] = false;
    patch["related_questions"]["enabled"] = true;
    const auto updated = service.updateOrgFlags("org-feature-flags", patch);

    assert(updated.isMember("related_questions"));
    assert(updated["related_questions"].get("enabled", false).asBool());
    assert(!updated.isMember("oauth_extra"));
    assert(!updated.isMember("admin_dashboard"));
    assert(!updated.isMember("audit_log_viewer"));

    const auto persisted = featureFlagRepository.loadOrgFlags("org-feature-flags");
    assert(persisted.isMember("related_questions"));
    assert(!persisted.isMember("oauth_extra"));
    assert(!persisted.isMember("admin_dashboard"));
    assert(!persisted.isMember("audit_log_viewer"));
}

void testAdaptiveLearningSeparatesEjuAndJlptTargets()
{
    ScopedTempDir tempDir;
    application::services::AdaptiveLearningService service(tempDir.path());

    Json::Value exam(Json::objectValue);
    exam["exam_info"]["family"] = "eju";
    exam["exam_info"]["exam_level"] = "";
    exam["exam_info"]["sections"] = Json::Value(Json::arrayValue);
    const std::vector<std::pair<std::string, std::string>> sections = {
        {"writing", "eju.writing"}, {"reading", "eju.reading"},
        {"listening_reading", "eju.listening_reading"}, {"listening", "eju.listening"}};
    Json::Value score(Json::objectValue);
    score["results"] = Json::Value(Json::objectValue);
    for (Json::ArrayIndex index = 0; index < sections.size(); ++index)
    {
        Json::Value section(Json::objectValue);
        section["section_type"] = sections[index].first;
        section["skill_tags"] = Json::Value(Json::arrayValue);
        section["skill_tags"].append(sections[index].second);
        section["questions"] = Json::Value(Json::arrayValue);
        Json::Value question(Json::objectValue);
        question["id"] = static_cast<int>(index + 1);
        section["questions"].append(question);
        exam["exam_info"]["sections"].append(section);

        Json::Value result(Json::objectValue);
        result["question_id"] = std::to_string(index + 1);
        result["section_index"] = static_cast<int>(index);
        result["status"] = "correct";
        score["results"][std::to_string(index)] = result;
    }

    service.recordSubmission("student-eju", "2026_01", exam, score);
    const auto eju = service.profile("student-eju", "EJU 日本語");
    assert(eju.get("exam_target", "").asString() == "EJU 日本語");
    assert(eju["domains"]["writing"].get("observation_count", 0).asInt() == 1);
    assert(eju["domains"]["reading"].get("observation_count", 0).asInt() == 1);
    assert(eju["domains"]["listening_reading"].get("observation_count", 0).asInt() == 1);
    assert(eju["domains"]["listening"].get("observation_count", 0).asInt() == 1);
    assert(eju["available_targets"].size() == 1);

    const auto jlpt = service.profile("student-eju", "JLPT N2");
    assert(jlpt["domains"]["vocabulary"].get("evidence", "").asString() == "unassessed");
    assert(jlpt["available_targets"].size() == 1);
    assert(jlpt["available_targets"][0].asString() == "EJU 日本語");
}

void testWrongQuestionCorrectionRequiresTwoConsecutiveCorrectAnswers()
{
    ScopedTempDir tempDir;
    infrastructure::storage::WrongQuestionRepository repository(tempDir.path());
    Json::Value snapshot(Json::objectValue);
    snapshot["id"] = 2;
    snapshot["question"] = "question";
    repository.recordWrong("student-correction", "N2_2016_07", "2", "1", "3", "1.01", "vocabulary", snapshot);

    const auto first = repository.recordCorrection("student-correction", "N2_2016_07", "2", "1", "1", true);
    assert(first.isObject());
    assert(first.get("correct_streak", 0).asInt() == 1);
    assert(!first.get("mastered", false).asBool());

    const auto wrong = repository.recordCorrection("student-correction", "N2_2016_07", "2", "1", "4", false);
    assert(wrong.get("correct_streak", -1).asInt() == 0);
    assert(wrong.get("wrong_count", 0).asInt() == 2);
    assert(!wrong.get("mastered", false).asBool());

    const auto retry = repository.recordCorrection("student-correction", "N2_2016_07", "2", "1", "1", true);
    assert(retry.get("correct_streak", 0).asInt() == 1);
    assert(!retry.get("mastered", false).asBool());
    const auto mastered = repository.recordCorrection("student-correction", "N2_2016_07", "2", "1", "1", true);
    assert(mastered.get("correct_streak", 0).asInt() == 2);
    assert(mastered.get("mastered", false).asBool());

    const auto otherExam = repository.recordCorrection("student-correction", "N2_2022_07", "2", "1", "1", true);
    assert(otherExam.isNull());

    repository.recordWrong("student-correction", "N2_2016_07", "3", "1", "2", "1.01", "vocabulary", snapshot);
    const auto once = repository.recordCorrection("student-correction", "N2_2016_07", "3", "1", "1", true, 2, "one-answer");
    const auto replay = repository.recordCorrection("student-correction", "N2_2016_07", "3", "1", "1", true, 2, "one-answer");
    assert(once["correct_streak"].asInt() == 1);
    assert(replay["correct_streak"].asInt() == 1);
    assert(replay["idempotent_replay"].asBool());
    assert(!replay["mastered"].asBool());
    bool rejected = false;
    try { repository.recordCorrection("student-correction", "N2_2016_07", "3", "1", "2", false, 2, "one-answer"); }
    catch (const common::AppException &) { rejected = true; }
    assert(rejected);
    const auto independent = repository.recordCorrection("student-correction", "N2_2016_07", "3", "1", "1", true, 2, "next-answer");
    assert(independent["correct_streak"].asInt() == 2);
    assert(independent["mastered"].asBool());
    const auto original = repository.recordCorrection("student-correction", "N2_2016_07", "3", "1", "1", true, 2, "one-answer");
    assert(original["correct_streak"].asInt() == 1);
}
}  // namespace

void testUserIdLookupPreservesCurrentAccessAndLegacyKeys()
{
    ScopedTempDir temp;
    Json::Value users(Json::objectValue);
    for (int i=0;i<2500;++i) {
        auto &user=users["legacy_storage_"+std::to_string(i)];
        user["id"]="canonical_"+std::to_string(i); user["username"]="lookup_"+std::to_string(i);
        user["status"]="active"; user["roles"]=Json::arrayValue; user["roles"].append("student");
    }
    infrastructure::storage::writeJsonFileAtomic(temp.path()/"users.json",users);
    infrastructure::storage::UserRepository repository(temp.path());
    assert(repository.findUserById("canonical_2499")["username"].asString()=="lookup_2499");
    assert(repository.findUserById("legacy_storage_2499").isNull());
    assert(repository.findUserById("missing").isNull());
    Json::Value access; access["roles"]=Json::arrayValue; access["roles"].append("teacher");
    repository.updatePlatformAccess("canonical_2499",access);
    assert(repository.findUserById("canonical_2499")["roles"][0].asString()=="teacher");
    repository.deactivateUser("canonical_2499","lookup test");
    assert(repository.findUserById("canonical_2499")["status"].asString()!="active");
}

int main()
{
    {
        using application::services::readBackupStatus;
        using application::services::backupUtcTime;
        ScopedTempDir dir;
        const auto file=dir.path()/"backup-status.json", data=dir.path()/"data";
        std::filesystem::create_directories(data);
        const auto now=*backupUtcTime("2026-10-28T10:00:00Z");
        assert(readBackupStatus({},data,now)["state"]=="not_configured");
        assert(readBackupStatus(file,data,now)["state"]=="missing");
        Json::Value status(Json::objectValue);
        status["schema_version"]=1; status["data_root"]=data.string(); status["state"]="succeeded";
        status["last_successful_at"]="2026-10-28T09:00:00.1234567+00:00";
        status["last_successful_backup_created_at"]="2026-10-28T08:00:00Z";
        status["finished_at"]=status["last_successful_at"];
        const auto check=[&]() { infrastructure::storage::writeJsonFileAtomic(file,status); return readBackupStatus(file,data,now); };
        assert(check()["ready"].asBool());
        status["state"]="failed"; status["error"]="PRIVATE disk path and provider secret";
        auto failed=check(); assert(failed["state"]=="failed" && !failed["ready"].asBool());
        assert(failed.toStyledString().find("PRIVATE")==std::string::npos);
        assert(failed.toStyledString().find(data.string())==std::string::npos);
        status["state"]="running"; status["started_at"]="2026-10-28T09:30:00Z"; assert(check()["ready"].asBool());
        status["started_at"]="2026-10-28T07:30:00Z"; assert(check()["state"]=="stalled");
        status["state"]="succeeded"; status["last_successful_backup_created_at"]="2026-10-24T08:00:00Z";
        assert(check()["state"]=="stale"); // Fresh verification cannot make an old snapshot fresh.
        status["last_successful_backup_created_at"]="2026-10-24T08:00:00Z";
        status["state"]="succeeded"; status["last_successful_at"]="2026-10-24T09:00:00Z";
        status["finished_at"]=status["last_successful_at"]; assert(check()["state"]=="stale");
        status["last_successful_at"]="2026-10-29T09:00:00Z"; assert(check()["state"]=="invalid");
        status["last_successful_at"]="2026-02-30T09:00:00Z"; assert(check()["state"]=="unverified");
        status["data_root"]=dir.path().string(); assert(check()["state"]=="wrong_source");
        std::ofstream(file)<<"{"; assert(readBackupStatus(file,data,now)["state"]=="invalid");
    }
    {
        ScopedTempDir tempDir;
        infrastructure::storage::ProfileRepository repository(tempDir.path());
        Json::Value first(Json::arrayValue), second(Json::arrayValue);
        first.append("reminder:first"); second.append("reminder:second");
        if (!repository.messageReads("student-a").empty()) throw std::runtime_error("New inbox must not contain read receipts");
        const auto receipt = repository.markMessagesRead("student-a", first);
        repository.markMessagesRead("student-a", second);
        if (repository.markMessagesRead("student-a", first)["reminder:first"] != receipt["reminder:first"])
            throw std::runtime_error("Acknowledgement must preserve its original timestamp");
        infrastructure::storage::ProfileRepository reopened(tempDir.path());
        if (reopened.messageReads("student-a").size() != 2) throw std::runtime_error("Read receipts must merge and persist");
        if (!reopened.messageReads("student-b").empty()) throw std::runtime_error("Read receipts must be scoped to their owner");
    }
    {
        Json::Value exam(Json::objectValue), assignment(Json::objectValue);
        for (int section = 0; section < 2; ++section)
            for (int question = 1; question <= 3; ++question)
                exam["exam_info"]["sections"][section]["questions"][question - 1]["id"] = std::to_string(question);
        assignment["question_start"] = 1;
        assignment["question_end"] = 3;
        const auto keys = application::services::resolveAssignmentQuestionKeys(exam, assignment);
        assert(keys.size() == 3 && keys[0].asString() == "0:1" && keys[2].asString() == "0:3");
        assignment["question_ids"].append("1:2");
        const auto explicitKeys = application::services::resolveAssignmentQuestionKeys(exam, assignment);
        assert(explicitKeys.size() == 1 && explicitKeys[0].asString() == "1:2");
        for (const auto &bad : {"2", "9:99"}) {
            assignment["question_ids"] = Json::Value(Json::arrayValue);
            assignment["question_ids"].append(bad);
            bool rejected = false;
            try { application::services::resolveAssignmentQuestionKeys(exam, assignment); }
            catch (const common::AppException &) { rejected = true; }
            assert(rejected);
        }
        assignment["question_ids"] = Json::Value(Json::arrayValue);
        assignment["question_start"] = 99;
        bool rejected = false;
        try { application::services::resolveAssignmentQuestionKeys(exam, assignment); }
        catch (const common::AppException &) { rejected = true; }
        assert(rejected);
        Json::Value prep(Json::objectValue);
        for (const auto &id : {"0:1", "1:2"}) { Json::Value item(Json::objectValue); item["question_id"] = id; prep["question_set"].append(item); }
        const auto prepKeys = application::services::resolveLessonPrepQuestionKeys(exam, prep);
        assert(prepKeys.size() == 2 && prepKeys[1].asString() == "1:2");
        prep["question_set"] = Json::Value(Json::arrayValue);
        for (const auto &id : {"1", "2", "3", "1"}) { Json::Value item(Json::objectValue); item["question_id"] = id; prep["question_set"].append(item); }
        const auto oldKeys = application::services::resolveLessonPrepQuestionKeys(exam, prep);
        assert(oldKeys.size() == 4 && oldKeys[3].asString() == "1:1");
        for (auto &section : exam["exam_info"]["sections"]) {
            section["passages"][0]["questions"] = section["questions"];
            section.removeMember("questions");
        }
        assert(application::services::resolveLessonPrepQuestionKeys(exam, prep) == oldKeys);
        prep["question_set"][0]["question_id"] = "999";
        expectAppException("VALIDATION_ERROR", [&]() { application::services::resolveLessonPrepQuestionKeys(exam, prep); });
    }
    testUserIdLookupPreservesCurrentAccessAndLegacyKeys();
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
	testWechatDevelopmentMobileEntryRequiresExplicitIdentity();
    testAuthSessionsAreCappedPerUser();
    testPasswordLifecycle();
    testPasswordsUseSaltedScryptAndMigrateLegacyHashes();
    testAuthenticationRateLimitsAndResetAttemptCap();
    testUserSearchUsesProfileIndex();
    testOrganizationMemberPermissionOverrides();
    testOrganizationArchivePreservesDataAndBlocksAccess();
    testInstitutionWorkflowRejectsStaleOrganizationSave();
    testOrganizationLearningModel();
    testAutomaticAssignmentRemindersAreTargetedAndIdempotent();
    testCompositeAnswerKeysAreScoredPerSection();
    testDraftRevisionConflictAndForcedOverwrite();
    testAnswerSubmissionIdempotencyAndHistory();
    testDailyPracticeKeepsCompletedReviewsAndUsesWeakDomains();
    testExpiredSectionsPersistInTimerSnapshot();
    testAuditLogsRotateAndRemainQueryable();
    testOrganizationFeatureFlagsRejectUnsupportedOverrides();
    testAdaptiveLearningSeparatesEjuAndJlptTargets();
    testWrongQuestionCorrectionRequiresTwoConsecutiveCorrectAnswers();
    return 0;
}
