#include <cassert>
#include <chrono>
#include <filesystem>
#include <functional>
#include <string>
#include <system_error>
#include <vector>

#include "application/services/ContactChangeChallengeService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/OrganizationService.h"
#include "application/services/PhoneService.h"
#include "application/services/SubscriptionService.h"
#include "application/services/UserService.h"
#include "common/RequestId.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/SessionRepository.h"
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
        const auto login = authService.login("student_session_persist_smoke", "");
        token = login.get("token", "").asString();
        assert(!token.empty());
        assert(authService.verify(token).get("username", "").asString() == "student_session_persist_smoke");
    }

    application::services::AuthService restoredAuthService(userRepository, profileRepository, true, &sessionRepository);
    const auto restored = restoredAuthService.verify(token);
    assert(restored.get("username", "").asString() == "student_session_persist_smoke");
    assert(restored["roles"].isArray());

    assert(restoredAuthService.logout(token));
    expectAppException("TOKEN_INVALID", [&]() {
        (void)restoredAuthService.verify(token);
    });
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
    authService.changePassword(userId, "Start12345", "Changed12345");
    expectAppException("INVALID_CREDENTIALS", [&]() {
        (void)authService.login("password_lifecycle_smoke", "Start12345");
    });
    assert(!authService.login("password_lifecycle_smoke", "Changed12345").get("token", "").asString().empty());

    const auto sent = authService.sendPasswordResetCode("password_lifecycle_smoke");
    assert(sent.get("channel", "").asString() == "email");
    assert(emailService.messages.size() == 1);
    const auto resetCode = extractSixDigitCode(emailService.messages.front().textBody);
    assert(resetCode.size() == 6);
    const auto reset = authService.resetPassword("password_lifecycle_smoke", resetCode, "Reset12345");
    assert(!reset.get("token", "").asString().empty());
    assert(!authService.login("password_lifecycle_smoke", "Reset12345").get("token", "").asString().empty());
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
}  // namespace

int main()
{
    testRequestIdsRemainUnique();
    testReferralRewardSettlesOnActivePaidSubscription();
    testEmailRebindNotifiesPreviouslyVerifiedAddress();
    testPhoneRebindNotifiesPreviouslyVerifiedNumber();
    testPhoneVerificationDailyLimit();
    testAuthSessionPersistsAcrossServiceInstances();
    testPasswordLifecycle();
    testOrganizationMemberPermissionOverrides();
    testOrganizationLearningModel();
    testCompositeAnswerKeysAreScoredPerSection();
    return 0;
}
