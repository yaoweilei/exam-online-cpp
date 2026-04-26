#pragma once

#include <filesystem>
#include <memory>

#include "application/recommendation/RecommendationStrategy.h"
#include "application/services/AnswerService.h"
#include "application/services/AuthService.h"
#include "application/services/BookmarkService.h"
#include "application/services/ContactChangeChallengeService.h"
#include "application/services/EmailVerificationService.h"
#include "application/services/ExamService.h"
#include "application/services/FuriganaService.h"
#include "application/services/OrganizationService.h"
#include "application/services/PhoneService.h"
#include "application/services/ProfileService.h"
#include "application/services/StatisticsService.h"
#include "application/services/SubscriptionService.h"
#include "application/services/UserService.h"
#include "application/services/WechatService.h"
#include "application/services/WrongQuestionService.h"
#include "application/services/StreakService.h"
#include "application/services/DraftService.h"
#include "application/services/AttemptTimerService.h"
#include "application/services/BookmarkFolderService.h"
#include "application/services/ClassroomService.h"
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
    application::services::EmailVerificationService *emailVerificationService{nullptr};
    application::services::ContactChangeChallengeService *contactChangeChallengeService{nullptr};
    application::services::WechatService *wechatService{nullptr};
    // 错题本服务（业务功能 1）
    application::services::WrongQuestionService *wrongQuestionService{nullptr};
    // 学习连续天数 / 每日目标（业务功能 2）
    application::services::StreakService *streakService{nullptr};
    // 上次未完成草稿（业务功能 4）
    application::services::DraftService *draftService{nullptr};
    // 答题计时与分段限时（业务功能 3）
    application::services::AttemptTimerService *attemptTimerService{nullptr};
    // 功能开关（横切基础设施）
    application::services::FeatureFlagService *featureFlagService{nullptr};
    // 题目反馈/纠错（业务功能 5）
    application::services::FeedbackService *feedbackService{nullptr};
    // 班级与作业（业务功能 6）
    application::services::ClassroomService *classroomService{nullptr};
    // SRS 间隔重复（业务功能 7）
    application::services::SrsService *srsService{nullptr};
    // 个人生词本（自学者点词查词）
    application::services::VocabNotebookService *vocabNotebookService{nullptr};
    // 阅读分句译文（B2 众包式）
    application::services::TranslationService *translationService{nullptr};
    // 收藏夹/分类（业务功能 8）
    application::services::BookmarkFolderService *bookmarkFolderService{nullptr};
    // 用户数据导出（业务功能 10）
    application::services::DataExportService *dataExportService{nullptr};
    // 管理员统计（业务功能 11）
    application::services::AdminStatisticsService *adminStatisticsService{nullptr};
    // 社区讨论（业务功能 12）
    application::services::CommunityService *communityService{nullptr};
    // 审计日志可视化（业务功能 15）
    application::services::AuditLogService *auditLogService{nullptr};
    // 每日一练（业务功能 16）
    application::services::DailyPracticeService *dailyPracticeService{nullptr};
    // 学习报告（业务功能 17）
    application::services::LearningReportService *learningReportService{nullptr};
    // 备考目标 / 倒计时（业务功能 18）
    application::services::StudyGoalService *studyGoalService{nullptr};
    // 多端同步（业务功能 19）
    application::services::SyncService *syncService{nullptr};
    // 排行榜（业务功能 21）
    application::services::LeaderboardService *leaderboardService{nullptr};
    // 第三方 OAuth（业务功能 22）
    application::services::OAuthService *oauthService{nullptr};
    // 同考点串题（功能 #17）
    application::services::RelatedQuestionsService *relatedQuestionsService{nullptr};
    // 章节式学习路径（功能 #18）
    application::services::ChapterService *chapterService{nullptr};
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
