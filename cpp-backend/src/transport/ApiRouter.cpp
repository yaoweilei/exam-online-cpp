#include "ApiRouter.h"

#include "transport/routes/Routes.h"

namespace transport
{
void ApiRouter::registerRoutes() const
{
    routes::registerStaticRoutes(context_);
    routes::registerHealthRoutes(context_);
    routes::registerExamRoutes(context_);
    routes::registerAnswerRoutes(context_);
    routes::registerAuthRoutes(context_);
    routes::registerMeRoutes(context_);
    routes::registerStatisticsRoutes(context_);
    routes::registerUserRoutes(context_);
    routes::registerFuriganaRoutes(context_);
    routes::registerProfileRoutes(context_);
    routes::registerBookmarkRoutes(context_);
    routes::registerSubscriptionRoutes(context_);
    routes::registerOrganizationRoutes(context_);
    routes::registerContactRoutes(context_);
    routes::registerWechatRoutes(context_);
    // 错题本路由（业务功能 1）
    routes::registerWrongQuestionRoutes(context_);
    // 连续天数 / 每日目标路由（业务功能 2）
    routes::registerStreakRoutes(context_);
    // 续考草稿路由（业务功能 4）
    routes::registerDraftRoutes(context_);
    // 答题计时路由（业务功能 3）
    routes::registerAttemptTimerRoutes(context_);
    // 功能开关路由（横切基础设施）
    routes::registerFeatureFlagRoutes(context_);
    // 题目反馈路由（业务功能 5）
    routes::registerFeedbackRoutes(context_);
    // 班级与作业路由（业务功能 6）
    routes::registerClassroomRoutes(context_);
    // SRS 间隔重复路由（业务功能 7）
    routes::registerSrsRoutes(context_);
    // 个人生词本路由（自学者点词查词）
    routes::registerVocabNotebookRoutes(context_);
    // 阅读分句译文路由（B2）
    routes::registerTranslationRoutes(context_);
    // 收藏夹/分类路由（业务功能 8）
    routes::registerBookmarkFolderRoutes(context_);
    // 用户数据导出路由（业务功能 10）
    routes::registerDataExportRoutes(context_);
    // 管理员统计路由（业务功能 11）
    routes::registerAdminStatisticsRoutes(context_);
    // 社区讨论路由（业务功能 12）
    routes::registerCommunityRoutes(context_);
    // 审计日志路由（业务功能 15）
    routes::registerAuditLogRoutes(context_);
    // 每日一练路由（业务功能 16）
    routes::registerDailyPracticeRoutes(context_);
    // 学习报告路由（业务功能 17）
    routes::registerLearningReportRoutes(context_);
    // 备考目标 / 倒计时路由（业务功能 18）
    routes::registerStudyGoalRoutes(context_);
    // 多端同步路由（业务功能 19）
    routes::registerSyncRoutes(context_);
    // 排行榜路由（业务功能 21）
    routes::registerLeaderboardRoutes(context_);
    // 第三方 OAuth 路由（业务功能 22）
    routes::registerOAuthRoutes(context_);
    // 同考点串题路由（功能 #17）
    routes::registerRelatedQuestionsRoutes(context_);
    // 章节式学习路径路由（功能 #18）
    routes::registerChapterRoutes(context_);
}
}  // namespace transport
