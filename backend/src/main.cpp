#include <iostream>
#include <memory>
#include <stdexcept>
#include <algorithm>
#include <cctype>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

#include <drogon/HttpAppFramework.h>

#include "application/recommendation/RuleBasedRecommendationStrategy.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/BookmarkService.h"
#include "application/services/WrongQuestionService.h"
#include "application/services/StreakService.h"
#include "application/services/DraftService.h"
#include "application/services/AttemptTimerService.h"
#include "application/services/BookmarkFolderService.h"
#include "application/services/AssignmentService.h"
#include "application/services/FeatureFlagService.h"
#include "application/services/FeedbackService.h"
#include "application/services/SrsService.h"
#include "application/services/VocabNotebookService.h"
#include "application/services/TranslationService.h"
#include "application/services/DataExportService.h"
#include "application/services/AdminStatisticsService.h"
#include "application/services/CommunityService.h"
#include "application/services/AuditLogService.h"
#include "application/services/DailyPracticeService.h"
#include "application/services/LearningReportService.h"
#include "application/services/StudyGoalService.h"
#include "application/services/SyncService.h"
#include "application/services/LeaderboardService.h"
#include "application/services/OAuthService.h"
#include "application/services/RelatedQuestionsService.h"
#include "application/services/ChapterService.h"
#include "application/services/RedeemService.h"
#include "application/services/PaymentService.h"
#include "application/services/InstitutionService.h"
#include "application/services/ContentWorkflowService.h"
#include "application/services/ContactChangeChallengeService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/ExamService.h"
#include "application/services/NotificationService.h"
#include "application/services/OrganizationService.h"
#include "application/services/PhoneService.h"
#include "application/services/ProfileService.h"
#include "application/services/StatisticsService.h"
#include "application/services/SubscriptionService.h"
#include "application/services/UserService.h"
#include "application/services/WechatService.h"
#include "common/ApiResponse.h"
#include "common/RequestId.h"
#include "infrastructure/config/AppConfig.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/BookmarkRepository.h"
#include "infrastructure/storage/WrongQuestionRepository.h"
#include "infrastructure/storage/StreakRepository.h"
#include "infrastructure/storage/DraftRepository.h"
#include "infrastructure/storage/AssignmentRepository.h"
#include "infrastructure/storage/AttemptTimerRepository.h"
#include "infrastructure/storage/BookmarkFolderRepository.h"
#include "infrastructure/storage/FeatureFlagRepository.h"
#include "infrastructure/storage/FeedbackRepository.h"
#include "infrastructure/storage/SrsRepository.h"
#include "infrastructure/storage/VocabNotebookRepository.h"
#include "infrastructure/storage/TranslationRepository.h"
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/RecentLearningRepository.h"
#include "infrastructure/storage/SessionRepository.h"
#include "infrastructure/storage/UserRepository.h"
#include "transport/ApiRouter.h"

using namespace drogon;

namespace
{
#ifdef _WIN32
void configureConsoleUtf8()
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
}
#else
void configureConsoleUtf8()
{
}
#endif

trantor::Logger::LogLevel toLogLevel(const std::string &level)
{
    if (level == "DEBUG")
    {
        return trantor::Logger::kDebug;
    }
    if (level == "WARN" || level == "WARNING")
    {
        return trantor::Logger::kWarn;
    }
    if (level == "ERROR")
    {
        return trantor::Logger::kError;
    }
    return trantor::Logger::kInfo;
}

std::string lowerAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string originAuthority(const std::string &origin)
{
    const auto schemeEnd = origin.find("://");
    if (schemeEnd == std::string::npos) return {};
    const auto authorityStart = schemeEnd + 3;
    const auto authorityEnd = origin.find('/', authorityStart);
    return lowerAscii(origin.substr(
        authorityStart,
        authorityEnd == std::string::npos ? std::string::npos : authorityEnd - authorityStart));
}

bool isMutationMethod(const drogon::HttpMethod method)
{
    return method == drogon::Post || method == drogon::Put ||
           method == drogon::Patch || method == drogon::Delete;
}

std::unique_ptr<application::services::EmailService> buildEmailService(const infrastructure::config::AppConfig &cfg)
{
    if (cfg.emailProvider == "resend")
    {
        return std::make_unique<application::services::ResendEmailService>(application::services::ResendEmailService::Config{
            .apiKey = cfg.emailApiKey,
            .fromAddress = cfg.emailFromAddress,
            .fromName = cfg.emailFromName,
            .apiBaseUrl = cfg.emailApiBaseUrl});
    }

    if (!infrastructure::config::isDevelopmentEnv(cfg.appEnv))
    {
        throw std::runtime_error(
            "EMAIL_PROVIDER must be configured for a real provider in production; stub delivery is disabled");
    }
    return std::make_unique<application::services::StubEmailService>();
}

std::unique_ptr<application::services::SmsService> buildSmsService(const infrastructure::config::AppConfig &cfg)
{
    if (cfg.smsProvider == "twilio")
    {
        return std::make_unique<application::services::TwilioSmsService>(application::services::TwilioSmsService::Config{
            .accountSid = cfg.smsAccountSid,
            .authToken = cfg.smsAuthToken,
            .fromNumber = cfg.smsFromNumber,
            .apiBaseUrl = cfg.smsApiBaseUrl});
    }

    if (!infrastructure::config::isDevelopmentEnv(cfg.appEnv))
    {
        throw std::runtime_error(
            "SMS_PROVIDER must be configured for a real provider in production; stub delivery is disabled");
    }
    return std::make_unique<application::services::StubSmsService>();
}
}  // namespace

int main()
{
    configureConsoleUtf8();

    auto cfg = infrastructure::config::loadConfig();
    std::filesystem::create_directories(cfg.logDir);

    infrastructure::storage::ExamRepository examRepo(cfg.dataPaperDir);
    infrastructure::storage::AnswerRepository answerRepo(cfg.dataUserDir);
    infrastructure::storage::UserRepository userRepo(cfg.dataUserDir);
    infrastructure::storage::SessionRepository sessionRepo(cfg.dataSystemDir);
    infrastructure::storage::ProfileRepository profileRepo(cfg.dataUserDir);
    infrastructure::storage::OrganizationRepository organizationRepo(cfg.dataUserDir);
    infrastructure::storage::BookmarkRepository bookmarkRepo(cfg.dataUserDir);
    // 错题本 Repository（业务功能 1）
    infrastructure::storage::WrongQuestionRepository wrongQuestionRepo(cfg.dataUserDir);
    // 连续天数 Repository（业务功能 2）
    infrastructure::storage::StreakRepository streakRepo(cfg.dataUserDir);
    // 续考草稿 Repository（业务功能 4）
    infrastructure::storage::DraftRepository draftRepo(cfg.dataUserDir);
    infrastructure::storage::RecentLearningRepository recentLearningRepo(cfg.dataUserDir);
    // 答题计时 Repository（业务功能 3）
    infrastructure::storage::AttemptTimerRepository attemptTimerRepo(cfg.dataUserDir);
    application::services::SubscriptionService subscriptionService(
        profileRepo,
        organizationRepo,
        userRepo,
        cfg.referralRewardCredits);
    application::services::ExamService examService(examRepo, subscriptionService);
    application::services::AnswerService answerService(answerRepo);
    auto emailService = buildEmailService(cfg);
    auto smsService = buildSmsService(cfg);
    application::services::AuthService authService(
        userRepo,
        profileRepo,
        infrastructure::config::isDevelopmentEnv(cfg.appEnv),
        &sessionRepo,
        emailService.get(),
        smsService.get());
    application::services::StatisticsService statisticsService(answerRepo, profileRepo);
    application::services::UserService userService(userRepo, profileRepo, organizationRepo, subscriptionService);
    application::services::ProfileService profileService(profileRepo);
    application::services::ContactChangeChallengeService contactChangeChallengeService(userRepo, *emailService, *smsService);
    application::services::OrganizationService organizationService(
        organizationRepo,
        userRepo,
        subscriptionService,
        *smsService,
        *emailService,
        cfg.publicWebBaseUrl);
    application::services::BookmarkService bookmarkService(bookmarkRepo);
    // 错题本 Service（业务功能 1）
    application::services::WrongQuestionService wrongQuestionService(wrongQuestionRepo);
    // 连续天数 Service（业务功能 2）
    application::services::StreakService streakService(streakRepo);
    // 续考草稿 Service（业务功能 4）
    application::services::DraftService draftService(draftRepo);
    // 答题计时 Service（业务功能 3）
    application::services::AttemptTimerService attemptTimerService(attemptTimerRepo, profileRepo);
    // 功能开关 Repository + Service（横切基础设施）
    infrastructure::storage::FeatureFlagRepository featureFlagRepo(cfg.dataSystemDir, organizationRepo, profileRepo);
    application::services::FeatureFlagService featureFlagService(featureFlagRepo, organizationRepo);
    // 题目反馈 Repository + Service（业务功能 5）
    infrastructure::storage::FeedbackRepository feedbackRepo(cfg.dataUserDir);
    application::services::FeedbackService feedbackService(feedbackRepo);
    // 学习组作业 Repository + Service（业务功能 6）
    infrastructure::storage::AssignmentRepository assignmentRepo(cfg.dataSystemDir);
    application::services::AssignmentService assignmentService(assignmentRepo, organizationRepo);
    // SRS Repository + Service（业务功能 7）
    infrastructure::storage::SrsRepository srsRepo(cfg.dataUserDir);
    application::services::SrsService srsService(srsRepo);
    // 个人生词本 Repository + Service（自学者点词查词）
    infrastructure::storage::VocabNotebookRepository vocabNotebookRepo(cfg.dataUserDir);
    application::services::VocabNotebookService vocabNotebookService(vocabNotebookRepo);
    // 阅读分句译文 Repository + Service（B2 众包式双语对照）
    infrastructure::storage::TranslationRepository translationRepo(cfg.dataSystemDir);
    application::services::TranslationService translationService(translationRepo);
    // 收藏夹/分类 Repository + Service（业务功能 8）
    infrastructure::storage::BookmarkFolderRepository bookmarkFolderRepo(cfg.dataUserDir);
    application::services::BookmarkFolderService bookmarkFolderService(bookmarkFolderRepo);
    // 用户数据导出 Service（业务功能 10）
    application::services::DataExportService dataExportService(cfg.dataUserDir, cfg.dataSystemDir);
    // 管理员统计 Service（业务功能 11）
    application::services::AdminStatisticsService adminStatisticsService(
        cfg.dataUserDir, cfg.dataSystemDir, cfg.dataPaperDir);
    // 社区讨论 Repository + Service（业务功能 12）
    infrastructure::storage::CommunityRepository communityRepo(cfg.dataUserDir);
    application::services::CommunityService communityService(communityRepo);
    // 审计日志 Service（业务功能 15）
    application::services::AuditLogService auditLogService(cfg.dataUserDir, organizationRepo);
    // 每日一练 Service（业务功能 16）
    application::services::DailyPracticeService dailyPracticeService(
        cfg.dataUserDir, wrongQuestionRepo, srsService, examRepo);
    // 学习报告 Service（业务功能 17）
    application::services::LearningReportService learningReportService(answerRepo, wrongQuestionRepo, srsRepo, cfg.dataUserDir);
    // 备考目标 / 倒计时 Service（业务功能 18）
    application::services::StudyGoalService studyGoalService(cfg.dataUserDir);
    // 多端同步 Service（业务功能 19）
    application::services::SyncService syncService(cfg.dataUserDir);
    // 排行榜 Service（业务功能 21）
    application::services::LeaderboardService leaderboardService(cfg.dataSystemDir, cfg.dataUserDir, userRepo, profileRepo);
    // 第三方 OAuth Service（业务功能 22）—Google 使用真实 OpenID Connect 流程；未配置时禁用。
    std::unordered_map<std::string, application::services::OAuthClientConfig> oauthProviders{
        {"google",
         application::services::OAuthClientConfig{
             .clientId = cfg.googleOAuthClientId,
             .clientSecret = cfg.googleOAuthClientSecret,
             .redirectUri = cfg.googleOAuthRedirectUri,
             .authUrl = "https://accounts.google.com/o/oauth2/v2/auth",
             .tokenUrl = "https://oauth2.googleapis.com/token",
             .userinfoUrl = "https://openidconnect.googleapis.com/v1/userinfo",
             .mock = false}}};
    application::services::OAuthService oauthService(userRepo, std::move(oauthProviders));
    // 同考点串题 Service（功能 #17）—复用 ExamRepository，懒加载反向索引
    application::services::RelatedQuestionsService relatedQuestionsService(examRepo);
    // 章节式学习路径 Service（功能 #18）—复用 Exam + Answer Repository
    application::services::ChapterService chapterService(examRepo, answerRepo);
    application::services::RedeemService redeemService(cfg.dataSystemDir, profileRepo, subscriptionService);
    application::services::PaymentService paymentService(
        cfg.dataUserDir,
        subscriptionService,
        &userRepo,
        emailService.get());
    application::services::ContentWorkflowService contentWorkflowService(cfg.dataSystemDir, examRepo);
    application::services::InstitutionService institutionService(
        assignmentRepo,
        answerRepo,
        userRepo,
        profileRepo,
        organizationRepo,
        examRepo,
        cfg.dataSystemDir);
    application::services::PhoneService phoneService(
        userRepo,
        *smsService,
        contactChangeChallengeService,
        infrastructure::config::isDevelopmentEnv(cfg.appEnv));
    application::services::EmailVerificationService emailVerificationService(userRepo, *emailService, contactChangeChallengeService);
    application::services::WechatService wechatService(
        userRepo,
        authService,
        application::services::WechatService::Config{
            .appId = cfg.wechatAppId,
            .appSecret = cfg.wechatAppSecret,
            .callbackBaseUrl = cfg.wechatCallbackBaseUrl});
    application::recommendation::RuleBasedRecommendationStrategy recommendationStrategy(statisticsService, examService);

    transport::AppContext context{
        .staticDir = cfg.staticDir,
        .dataRoot = cfg.dataRoot,
		.disableStaticCache = infrastructure::config::isDevelopmentEnv(cfg.appEnv),
        .secureCookies = !infrastructure::config::isDevelopmentEnv(cfg.appEnv),
        .examService = &examService,
        .answerService = &answerService,
        .authService = &authService,
        .statisticsService = &statisticsService,
        .userService = &userService,
        .profileService = &profileService,
        .organizationService = &organizationService,
        .bookmarkService = &bookmarkService,
        .subscriptionService = &subscriptionService,
        .phoneService = &phoneService,
        .emailVerificationService = &emailVerificationService,
        .contactChangeChallengeService = &contactChangeChallengeService,
        .wechatService = &wechatService,
        .wrongQuestionService = &wrongQuestionService,
        .streakService = &streakService,
        .draftService = &draftService,
        .attemptTimerService = &attemptTimerService,
        .featureFlagService = &featureFlagService,
        .feedbackService = &feedbackService,
        .assignmentService = &assignmentService,
        .srsService = &srsService,
        .vocabNotebookService = &vocabNotebookService,
        .translationService = &translationService,
        .bookmarkFolderService = &bookmarkFolderService,
        .dataExportService = &dataExportService,
        .adminStatisticsService = &adminStatisticsService,
        .communityService = &communityService,
        .auditLogService = &auditLogService,
        .dailyPracticeService = &dailyPracticeService,
        .learningReportService = &learningReportService,
        .studyGoalService = &studyGoalService,
        .syncService = &syncService,
        .leaderboardService = &leaderboardService,
        .oauthService = &oauthService,
        .relatedQuestionsService = &relatedQuestionsService,
        .chapterService = &chapterService,
        .redeemService = &redeemService,
        .paymentService = &paymentService,
        .institutionService = &institutionService,
        .contentWorkflowService = &contentWorkflowService,
        .recentLearningRepository = &recentLearningRepo,
        .recommendationStrategy = &recommendationStrategy};

    transport::ApiRouter router(context);
    router.registerRoutes();

    app().setThreadNum(static_cast<size_t>(cfg.threads));
    app().setLogPath(
        cfg.logDir.string(),
        cfg.logFileBaseName,
        cfg.logFileSize,
        cfg.logMaxFiles);
    app().setLogLevel(toLogLevel(cfg.logLevel));
    app().setLogLocalTime(true);
    app().addListener(cfg.host, cfg.port);
    // Only the curated static directory is exposed by Drogon's fallback file
    // handler. Runtime data, environment files and source files live beside
    // the application in development and must never become public assets.
    auto staticDocumentRoot = cfg.staticDir.generic_string();
    if (staticDocumentRoot.empty() || staticDocumentRoot.back() != '/')
    {
        staticDocumentRoot.push_back('/');
    }
    app().setDocumentRoot(staticDocumentRoot);
    // Public assets keep their historical /static/* URLs while the document
    // root remains confined to the curated static directory.  Without this
    // location Drogon's built-in static router would resolve /static/app.js
    // as <staticDir>/static/app.js; pointing the prefix at "." also prevents
    // source code and runtime data outside staticDir from being downloaded.
    app().addALocation("/static", "", ".", false, true, true);
    // Listening audio is a deliberate public asset surface. Keep the rest of
    // runtime data private while letting Drogon's static router provide byte
    // range responses required by Safari/iOS media playback.
    const auto audioAlias = std::filesystem::relative(cfg.dataRoot / "audio", cfg.staticDir).generic_string();
    app().addALocation("/data/audio", "audio/mpeg", audioAlias, false, false, true);
    app().setFileTypes({"html", "css", "js", "map", "png", "jpg", "jpeg", "svg", "ico", "json", "mp3", "wav"});
    app().enableServerHeader(false);

    app().registerSyncAdvice([](const HttpRequestPtr &req) -> HttpResponsePtr {
        if (!isMutationMethod(req->method()) ||
            !req->path().starts_with("/api/") ||
            req->getCookie("exam_session").empty())
        {
            return nullptr;
        }

        const auto fetchSite = lowerAscii(req->getHeader("Sec-Fetch-Site"));
        const auto origin = req->getHeader("Origin");
        const auto host = lowerAscii(req->getHeader("Host"));
        const auto authority = originAuthority(origin);
        const bool crossSite = fetchSite == "cross-site";
        const bool foreignOrigin = !origin.empty() &&
                                   (origin == "null" || authority.empty() || authority != host);
        if (!crossSite && !foreignOrigin)
        {
            return nullptr;
        }

        LOG_WARN << "blocked cross-site cookie request path=" << req->path()
                 << " origin=" << origin
                 << " host=" << host
                 << " request_id=" << common::resolveRequestId(req);
        return common::fail(
            req,
            k403Forbidden,
            "CROSS_SITE_REQUEST_BLOCKED",
            "该请求来源不受信任，请从本站重新操作");
    });

    app().registerPreRoutingAdvice([](const HttpRequestPtr &req) {
        LOG_INFO << "incoming request "
                 << req->methodString() << " "
                 << req->path() << " request_id=" << common::resolveRequestId(req);
    });

    const bool productionSecurityHeaders = !infrastructure::config::isDevelopmentEnv(cfg.appEnv);
    app().registerPreSendingAdvice([productionSecurityHeaders](const HttpRequestPtr &req,
                                                               const HttpResponsePtr &resp) {
        resp->addHeader("X-Content-Type-Options", "nosniff");
        resp->addHeader("X-Frame-Options", "DENY");
        resp->addHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        resp->addHeader(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(self)");
        resp->addHeader(
            "Content-Security-Policy",
            "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
            "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; "
            "connect-src 'self' https:; form-action 'self'");
        if (req->path().rfind("/data/audio/", 0) == 0)
        {
            resp->addHeader("Accept-Ranges", "bytes");
        }
        if (productionSecurityHeaders)
        {
            resp->addHeader(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains");
        }
    });

    app().registerBeginningAdvice([&paymentService, &assignmentService, &auditLogService]() {
        const auto runRenewalJob = [&paymentService]() {
            try
            {
                const auto result = paymentService.runRenewalJobs();
                LOG_INFO << "renewal job completed scanned=" << result.get("scanned", 0).asInt()
                         << " reminders=" << result.get("reminders_enqueued", 0).asInt()
                         << " charge_requests=" << result.get("charge_requests_created", 0).asInt()
                         << " email_attempted=" << result["notification_delivery"].get("attempted", 0).asInt()
                         << " email_dead_letter=" << result["notification_delivery"].get("dead_letter", 0).asInt();
            }
            catch (const std::exception &error)
            {
                LOG_ERROR << "renewal job failed: " << error.what();
            }
        };
        const auto runAssignmentReminderJob = [&assignmentService, &auditLogService]() {
            try
            {
                const auto result = assignmentService.runAutomaticReminderJobs();
                for (const auto &delivery : result.get("deliveries", Json::Value(Json::arrayValue)))
                {
                    Json::Value details(Json::objectValue);
                    details["assignment_id"] = delivery.get("assignment_id", "");
                    details["reminder_id"] = delivery.get("reminder_id", "");
                    details["hours_before"] = delivery.get("hours_before", 0);
                    details["target_count"] = delivery.get("target_count", 0);
                    auditLogService.record(
                        "assignment.reminder.auto_sent",
                        "system",
                        "自动发送作业催交提醒",
                        details,
                        delivery.get("organization_id", "").asString());
                }
                LOG_INFO << "assignment reminder job completed scanned=" << result.get("scanned", 0).asInt()
                         << " eligible=" << result.get("eligible", 0).asInt()
                         << " reminders=" << result.get("reminders_created", 0).asInt()
                         << " targets=" << result.get("targets", 0).asInt()
                         << " failed=" << result.get("failed", 0).asInt();
            }
            catch (const std::exception &error)
            {
                LOG_ERROR << "assignment reminder job failed: " << error.what();
            }
        };
        runRenewalJob();
        runAssignmentReminderJob();
        app().getLoop()->runEvery(15.0 * 60.0, runRenewalJob);
        app().getLoop()->runEvery(15.0 * 60.0, runAssignmentReminderJob);
    });

    if (infrastructure::config::isDevelopmentEnv(cfg.appEnv))
    {
        app().registerPreSendingAdvice([](const HttpRequestPtr &req, const HttpResponsePtr &resp) {
            const auto &path = req->path();
            if (path.rfind("/static/", 0) != 0 && path.rfind("/resource/", 0) != 0)
            {
                return;
            }
            resp->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
            resp->addHeader("Pragma", "no-cache");
            resp->addHeader("Expires", "0");
        });
    }

    app().setCustomErrorHandler([](HttpStatusCode statusCode, const HttpRequestPtr &req) {
        auto response = HttpResponse::newHttpJsonResponse(common::envelope(
            "HTTP_ERROR",
            std::string("HTTP error: ") + std::to_string(static_cast<int>(statusCode)),
            Json::Value(Json::nullValue),
            common::resolveRequestId(req)));
        response->setStatusCode(statusCode);
        return response;
    });

    std::cout << "exam_online_cpp_v2 starting on " << cfg.host << ":" << cfg.port << "\n";
    std::cout << "base_dir=" << cfg.baseDir << "\n";
    std::cout << "data_root=" << cfg.dataRoot << "\n";
    std::cout << "data_paper_dir=" << cfg.dataPaperDir << "\n";
    std::cout << "data_user_dir=" << cfg.dataUserDir << "\n";
    std::cout << "data_system_dir=" << cfg.dataSystemDir << "\n";
    std::cout << "static_dir=" << cfg.staticDir << "\n";
    std::cout << "app_env=" << cfg.appEnv << "\n";
    std::cout << "threads=" << cfg.threads << "\n";
    std::cout << "log_dir=" << cfg.logDir << "\n";
    std::cout << "log_level=" << cfg.logLevel << "\n";

    app().run();
    return 0;
}
