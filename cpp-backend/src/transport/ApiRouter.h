#pragma once

#include <filesystem>
#include <memory>

#include "application/recommendation/RecommendationStrategy.h"
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

namespace transport
{
struct AppContext
{
    std::filesystem::path staticDir;
	bool disableStaticCache{false};
    application::services::ExamService *examService{nullptr};
    application::services::AnswerService *answerService{nullptr};
    application::services::AuthService *authService{nullptr};
    application::services::StatisticsService *statisticsService{nullptr};
    application::services::UserService *userService{nullptr};
    application::services::FuriganaService *furiganaService{nullptr};
    application::services::ProfileService *profileService{nullptr};
    application::services::OrganizationService *organizationService{nullptr};
    application::services::BookmarkService *bookmarkService{nullptr};
    application::services::SubscriptionService *subscriptionService{nullptr};
    application::services::PhoneService *phoneService{nullptr};
    application::services::WechatService *wechatService{nullptr};
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
