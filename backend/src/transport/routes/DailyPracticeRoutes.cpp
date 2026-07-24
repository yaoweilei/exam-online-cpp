#include <drogon/HttpAppFramework.h>

#include "application/services/DailyPracticeService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
std::string sessionUserId(const Json::Value &session)
{
    auto userId = session.get("user_id", "").asString();
    if (userId.empty())
    {
        userId = session.get("id", "").asString();
    }
    return userId;
}
}

// ---------------------------------------------------------------------------
// 业务功能 16：每日一练 路由
//   GET  /api/v1/me/daily-practice            获取（或当天首次生成）今日清单
//   POST /api/v1/me/daily-practice/regenerate 强制重新生成
//   POST /api/v1/me/daily-practice/complete   {question_id} 标记完成
//
// 权限：登录；FeatureFlag daily_practice
// ---------------------------------------------------------------------------
void registerDailyPracticeRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/daily-practice",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = sessionUserId(session);
                requireFeature(*ctx.featureFlagService, "daily_practice", userId);
                const int count = readBoundedIntParameter(req, "count", 10, 1, 50);
                return common::ok(req, ctx.dailyPracticeService->getOrCreateToday(userId, count));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/me/daily-practice/regenerate",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = sessionUserId(session);
                requireFeature(*ctx.featureFlagService, "daily_practice", userId);
                const auto body = parseJsonBody(req);
                const int count = readBoundedIntField(body, "count", 10, 1, 50);
                return common::ok(req, ctx.dailyPracticeService->regenerate(userId, count));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/me/daily-practice/complete",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = sessionUserId(session);
                requireFeature(*ctx.featureFlagService, "daily_practice", userId);
                const auto body = parseJsonBody(req);
                const auto qid = requireBoundedString(body, "question_id", 1, 200);
                return common::ok(req, ctx.dailyPracticeService->markComplete(userId, qid));
            });
        },
        {Post});
}
}  // namespace transport::routes
