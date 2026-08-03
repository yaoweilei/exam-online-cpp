#include <algorithm>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
Json::Value buildRecommendations(const AppContext &ctx, const std::string &userId, int limit)
{
    Json::Value out(Json::arrayValue);
    if (ctx.examService == nullptr)
    {
        return out;
    }

    Json::Value weak(Json::arrayValue);
    if (ctx.statisticsService != nullptr)
    {
        weak = ctx.statisticsService->weakPoints(userId);
    }

    const auto exams = ctx.examService->listExams("", "", "", "date_desc");
    if (!exams.isArray())
    {
        return out;
    }

    const bool hasWeakPoints = weak.isArray() && weak.size() > 0;
    int count = 0;
    for (const auto &exam : exams)
    {
        if (count >= limit)
        {
            break;
        }
        Json::Value item(Json::objectValue);
        item["exam_id"] = exam.get("id", "").asString();
        item["reason"] = hasWeakPoints ? "weak_point_boost" : "latest_exam";
        item["score"] = hasWeakPoints ? 0.8 : 0.5;
        out.append(item);
        ++count;
    }
    return out;
}

int readRecommendationLimit(const HttpRequestPtr &req)
{
    return readBoundedIntParameter(req, "limit", 5, 1, 50);
}

void requireUserEntitlement(const AppContext &ctx,
                            const Json::Value &session,
                            const std::string &userId,
                            const std::string &entitlementKey,
                            const std::string &message)
{
    if (hasAnyRole(session["roles"], {"superAdmin"}))
    {
        return;
    }
    requireEntitlement(*ctx.subscriptionService, userId, entitlementKey, message);
}
}  // namespace

void registerStatisticsRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/statistics/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                return common::ok(req, ctx.statisticsService->userStatistics(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/statistics/{1}/weak-points",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                requireUserEntitlement(
                    ctx, session, userId, "analytics.full", "完整薄弱项分析需要升级到 PRO 套餐");
                return common::ok(req, ctx.statisticsService->weakPoints(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/statistics/{1}/learning-curve",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int days = readBoundedIntParameter(req, "days", 30, 1, 365);
                if (days > 7)
                {
                    requireUserEntitlement(
                        ctx, session, userId, "analytics.full", "超过 7 天的学习趋势需要升级到 PRO 套餐");
                }
                return common::ok(req, ctx.statisticsService->learningCurve(userId, days));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/recommendations/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int limit = readRecommendationLimit(req);
                requireUserEntitlement(
                    ctx,
                    session,
                    userId,
                    "recommendation.personalized",
                    "个性化推荐需要升级到 PRO 套餐");
                return common::ok(req, buildRecommendations(ctx, userId, limit));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/statistics/{1}/recommendations",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int limit = readRecommendationLimit(req);
                requireUserEntitlement(
                    ctx,
                    session,
                    userId,
                    "recommendation.personalized",
                    "个性化推荐需要升级到 PRO 套餐");
                return common::ok(req, buildRecommendations(ctx, userId, limit));
            });
        },
        {Get});
}
}  // namespace transport::routes
