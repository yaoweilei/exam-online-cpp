#include <iostream>

#include <drogon/HttpAppFramework.h>

#include "application/recommendation/RuleBasedRecommendationStrategy.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/BookmarkService.h"
#include "application/services/ExamService.h"
#include "application/services/FuriganaService.h"
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
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/FuriganaRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"
#include "transport/ApiRouter.h"

using namespace drogon;

namespace
{
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
}  // namespace

int main()
{
    auto cfg = infrastructure::config::loadConfig();
    std::filesystem::create_directories(cfg.logDir);

    infrastructure::storage::ExamRepository examRepo(cfg.dataPaperDir);
    infrastructure::storage::AnswerRepository answerRepo(cfg.dataUserDir);
    infrastructure::storage::UserRepository userRepo(cfg.dataUserDir);
    infrastructure::storage::FuriganaRepository furiganaRepo(cfg.furiganaDictPath);
    infrastructure::storage::ProfileRepository profileRepo(cfg.dataUserDir);
    infrastructure::storage::OrganizationRepository organizationRepo(cfg.dataUserDir);
    infrastructure::storage::BookmarkRepository bookmarkRepo(cfg.dataUserDir);

    application::services::SubscriptionService subscriptionService(profileRepo, organizationRepo);
    application::services::ExamService examService(examRepo, subscriptionService);
    application::services::AnswerService answerService(answerRepo);
    application::services::AuthService authService(
        userRepo,
        profileRepo,
        infrastructure::config::isDevelopmentEnv(cfg.appEnv));
    application::services::StatisticsService statisticsService(answerRepo);
    application::services::UserService userService(userRepo, profileRepo, organizationRepo, subscriptionService);
    application::services::FuriganaService furiganaService(furiganaRepo);
    application::services::ProfileService profileService(profileRepo);
    application::services::OrganizationService organizationService(organizationRepo, userRepo, subscriptionService);
    application::services::BookmarkService bookmarkService(bookmarkRepo);
    application::services::StubSmsService stubSmsService;
    application::services::PhoneService phoneService(userRepo, stubSmsService);
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
		.disableStaticCache = infrastructure::config::isDevelopmentEnv(cfg.appEnv),
        .examService = &examService,
        .answerService = &answerService,
        .authService = &authService,
        .statisticsService = &statisticsService,
        .userService = &userService,
        .furiganaService = &furiganaService,
        .profileService = &profileService,
        .organizationService = &organizationService,
        .bookmarkService = &bookmarkService,
        .subscriptionService = &subscriptionService,
        .phoneService = &phoneService,
        .wechatService = &wechatService,
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
    app().setDocumentRoot(cfg.documentRoot.string());
    app().setFileTypes({"html", "css", "js", "map", "png", "jpg", "jpeg", "svg", "ico", "json", "mp3", "wav"});
    app().enableServerHeader(false);

    app().registerPreRoutingAdvice([](const HttpRequestPtr &req) {
        LOG_INFO << "incoming request "
                 << req->methodString() << " "
                 << req->path() << " request_id=" << common::resolveRequestId(req);
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
    std::cout << "data_paper_dir=" << cfg.dataPaperDir << "\n";
    std::cout << "data_user_dir=" << cfg.dataUserDir << "\n";
    std::cout << "static_dir=" << cfg.staticDir << "\n";
    std::cout << "app_env=" << cfg.appEnv << "\n";
    std::cout << "log_dir=" << cfg.logDir << "\n";
    std::cout << "log_level=" << cfg.logLevel << "\n";

    app().run();
    return 0;
}
