#pragma once

#include "transport/ApiRouter.h"

namespace transport::routes
{
void registerStaticRoutes(const AppContext &ctx);
void registerHealthRoutes(const AppContext &ctx);
void registerExamRoutes(const AppContext &ctx);
void registerAnswerRoutes(const AppContext &ctx);
void registerAuthRoutes(const AppContext &ctx);
void registerMeRoutes(const AppContext &ctx);
void registerStatisticsRoutes(const AppContext &ctx);
void registerUserRoutes(const AppContext &ctx);
void registerFuriganaRoutes(const AppContext &ctx);
void registerProfileRoutes(const AppContext &ctx);
void registerBookmarkRoutes(const AppContext &ctx);
void registerSubscriptionRoutes(const AppContext &ctx);
void registerOrganizationRoutes(const AppContext &ctx);
void registerContactRoutes(const AppContext &ctx);
void registerWechatRoutes(const AppContext &ctx);
// 错题本路由（业务功能 1）
void registerWrongQuestionRoutes(const AppContext &ctx);
// 连续天数 / 每日目标路由（业务功能 2）
void registerStreakRoutes(const AppContext &ctx);
// 续考草稿路由（业务功能 4）
void registerDraftRoutes(const AppContext &ctx);
// 答题计时路由（业务功能 3）
void registerAttemptTimerRoutes(const AppContext &ctx);
// 功能开关路由（横切基础设施）
void registerFeatureFlagRoutes(const AppContext &ctx);
// 题目反馈路由（业务功能 5）
void registerFeedbackRoutes(const AppContext &ctx);
// 班级与作业路由（业务功能 6）
void registerClassroomRoutes(const AppContext &ctx);
// SRS 间隔重复路由（业务功能 7）
void registerSrsRoutes(const AppContext &ctx);
// 个人生词本路由（自学者点词查词）
void registerVocabNotebookRoutes(const AppContext &ctx);
// 阅读分句译文路由（B2）
void registerTranslationRoutes(const AppContext &ctx);
// 收藏夹/分类路由（业务功能 8）
void registerBookmarkFolderRoutes(const AppContext &ctx);
// 用户数据导出路由（业务功能 10）
void registerDataExportRoutes(const AppContext &ctx);
// 管理员统计路由（业务功能 11）
void registerAdminStatisticsRoutes(const AppContext &ctx);
// 社区讨论路由（业务功能 12）
void registerCommunityRoutes(const AppContext &ctx);
// 审计日志路由（业务功能 15）
void registerAuditLogRoutes(const AppContext &ctx);
// 每日一练路由（业务功能 16）
void registerDailyPracticeRoutes(const AppContext &ctx);
// 学习报告路由（业务功能 17）
void registerLearningReportRoutes(const AppContext &ctx);
// 备考目标 / 倒计时路由（业务功能 18）
void registerStudyGoalRoutes(const AppContext &ctx);
// 多端同步路由（业务功能 19）
void registerSyncRoutes(const AppContext &ctx);
// 排行榜路由（业务功能 21）
void registerLeaderboardRoutes(const AppContext &ctx);
// 第三方 OAuth 路由（业务功能 22）
void registerOAuthRoutes(const AppContext &ctx);
// 同考点串题路由（功能 #17）
void registerRelatedQuestionsRoutes(const AppContext &ctx);
// 章节式学习路径路由（功能 #18）
void registerChapterRoutes(const AppContext &ctx);
// 兑换码 / 卡券包
void registerRedeemRoutes(const AppContext &ctx);
// 支付订单 / 回调 / 退款 / 流水
void registerPaymentRoutes(const AppContext &ctx);
// 机构端管理工作台
void registerInstitutionRoutes(const AppContext &ctx);
}  // namespace transport::routes
