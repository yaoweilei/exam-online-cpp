#pragma once

#include <filesystem>
#include <memory>

#include "application/recommendation/RecommendationStrategy.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/ExamService.h"
#include "application/services/FuriganaService.h"
#include "application/services/StatisticsService.h"
#include "application/services/UserService.h"

namespace transport
{
struct AppContext
{
    std::filesystem::path staticDir;
    application::services::ExamService *examService{nullptr};
    application::services::AnswerService *answerService{nullptr};
    application::services::AuthService *authService{nullptr};
    application::services::StatisticsService *statisticsService{nullptr};
    application::services::UserService *userService{nullptr};
    application::services::FuriganaService *furiganaService{nullptr};
    application::recommendation::RecommendationStrategy *recommendationStrategy{nullptr};
};

class ApiRouter
{
  public:
    explicit ApiRouter(AppContext context) : context_(context) {}
    void registerRoutes() const;

  private:
    AppContext context_;
};
}  // namespace transport
