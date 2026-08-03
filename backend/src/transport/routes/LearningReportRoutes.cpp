#include <drogon/HttpAppFramework.h>

#include "application/services/LearningReportService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 17：学习报告 路由
//   GET /api/v1/me/learning-report?period=week|month
//   权限：登录；FeatureFlag learning_report；月报需 analytics.full
// ---------------------------------------------------------------------------
void registerLearningReportRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/learning-report",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_report", userId);
                const auto requestedPeriod = req->getParameter("period");
                const auto period = requestedPeriod == "month" ? std::string("month") : std::string("week");
                if (period == "month")
                {
                    requireEntitlement(
                        *ctx.subscriptionService,
                        userId,
                        "analytics.full",
                        "完整月度学习分析需要升级到 PRO 套餐");
                }
                return common::ok(req, ctx.learningReportService->generate(userId, period));
            });
        },
        {Get});
}
}  // namespace transport::routes
