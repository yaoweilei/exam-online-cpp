#include <iostream>

#include <drogon/HttpAppFramework.h>

#include "application/recommendation/RuleBasedRecommendationStrategy.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/ExamService.h"
#include "application/services/FuriganaService.h"
#include "application/services/StatisticsService.h"
#include "application/services/UserService.h"
#include "common/ApiResponse.h"
#include "common/RequestId.h"
#include "infrastructure/config/AppConfig.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/FuriganaRepository.h"
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

    infrastructure::storage::ExamRepository examRepo(cfg.dataPaperDir);
    infrastructure::storage::AnswerRepository answerRepo(cfg.dataUserDir);
    infrastructure::storage::UserRepository userRepo(cfg.dataUserDir);
    infrastructure::storage::FuriganaRepository furiganaRepo(cfg.furiganaDictPath);

    application::services::ExamService examService(examRepo);
    application::services::AnswerService answerService(answerRepo);
    application::services::AuthService authService(userRepo);
    application::services::StatisticsService statisticsService(answerRepo);
    application::services::UserService userService(userRepo);
    application::services::FuriganaService furiganaService(furiganaRepo);
    application::recommendation::RuleBasedRecommendationStrategy recommendationStrategy(statisticsService, examService);

    transport::AppContext context{
        .examService = &examService,
        .answerService = &answerService,
        .authService = &authService,
        .statisticsService = &statisticsService,
        .userService = &userService,
        .furiganaService = &furiganaService,
        .recommendationStrategy = &recommendationStrategy};

    transport::ApiRouter router(context);
    router.registerRoutes();

    app().setThreadNum(static_cast<size_t>(cfg.threads));
    app().setLogLevel(toLogLevel(cfg.logLevel));
    app().addListener(cfg.host, cfg.port);
    app().setDocumentRoot(cfg.documentRoot.string());
    app().setFileTypes({"html", "css", "js", "png", "jpg", "jpeg", "svg", "ico", "json", "mp3", "wav"});
    app().enableServerHeader(false);

    app().registerPreRoutingAdvice([](const HttpRequestPtr &req) {
        LOG_INFO << "incoming request "
                 << req->methodString() << " "
                 << req->path() << " request_id=" << common::resolveRequestId(req);
    });

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

    app().run();
    return 0;
}
