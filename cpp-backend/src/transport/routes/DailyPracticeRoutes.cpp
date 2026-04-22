#include <drogon/HttpAppFramework.h>

#include "application/services/DailyPracticeService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 16：每日一练 路由
//   GET  /api/v2/me/daily-practice            获取（或当天首次生成）今日清单
//   POST /api/v2/me/daily-practice/regenerate 强制重新生成
//   POST /api/v2/me/daily-practice/complete   {question_id} 标记完成
//
// 权限：登录；FeatureFlag daily_practice
// ---------------------------------------------------------------------------
void registerDailyPracticeRoutes(const AppContext &ctx)
{
    auto getHandler = [ctx](const HttpRequestPtr &req,
                            std::function<void(const HttpResponsePtr &)> &&callback) {
        handleRequest(req, std::move(callback), [&]() {
            const auto session = requireSession(*ctx.authService, req);
            const auto userId = session.get("user_id", session.get("id", "")).asString();
            requireFeature(*ctx.featureFlagService, "daily_practice", userId);
            const auto countStr = req->getParameter("count");
            int count = 10;
            if (!countStr.empty())
            {
                try { count = std::stoi(countStr); } catch (...) { count = 10; }
            }
            return common::ok(req, ctx.dailyPracticeService->getOrCreateToday(userId, count));
        });
    };
    app().registerHandler("/api/v2/me/daily-practice", getHandler, {Get});

    app().registerHandler(
        "/api/v2/me/daily-practice/regenerate",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "daily_practice", userId);
                const auto body = parseJsonBody(req);
                int count = body.get("count", 10).asInt();
                return common::ok(req, ctx.dailyPracticeService->regenerate(userId, count));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/me/daily-practice/complete",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "daily_practice", userId);
                const auto body = parseJsonBody(req);
                const auto qid = body.get("question_id", "").asString();
                if (qid.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "question_id 必填", drogon::k422UnprocessableEntity);
                }
                return common::ok(req, ctx.dailyPracticeService->markComplete(userId, qid));
            });
        },
        {Post});
}
}  // namespace transport::routes
