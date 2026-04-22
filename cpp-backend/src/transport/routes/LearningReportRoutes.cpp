#include <drogon/HttpAppFramework.h>

#include "application/services/LearningReportService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 17：学习报告 路由
//   GET /api/v2/me/learning-report?period=week|month
//   权限：登录；FeatureFlag learning_report
// ---------------------------------------------------------------------------
void registerLearningReportRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/me/learning-report",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "learning_report", userId);
                const auto period = req->getParameter("period");
                return common::ok(req, ctx.learningReportService->generate(userId, period));
            });
        },
        {Get});
}
}  // namespace transport::routes
