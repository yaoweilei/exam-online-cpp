#include <algorithm>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerStatisticsRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/statistics/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
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
                const auto daysParam = req->getParameter("days");
                const int days = daysParam.empty() ? 30 : (std::max)(1, std::stoi(daysParam));
                return common::ok(req, ctx.statisticsService->learningCurve(userId, days));
            });
        },
        {Get});

    auto recommendHandler = [ctx](const HttpRequestPtr &req,
                                  std::function<void(const HttpResponsePtr &)> &&callback,
                                  std::string userId) {
        handleRequest(req, std::move(callback), [&]() {
            const auto limitParam = req->getParameter("limit");
            const int limit = limitParam.empty() ? 5 : (std::max)(1, std::stoi(limitParam));
            return common::ok(req, ctx.recommendationStrategy->recommend(userId, limit));
        });
    };

    app().registerHandler("/api/v1/recommendations/{1}", recommendHandler, {Get});
    app().registerHandler("/api/v1/statistics/{1}/recommendations", recommendHandler, {Get});
}
}  // namespace transport::routes
