#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 答题计时路由（业务功能 3：答题计时与分段限时）
//   GET    /api/v2/timers/{userId}              查询当前计时；无返回 null
//   POST   /api/v2/timers/{userId}/start        启动/重置
//                                               body: { exam_id*, total_limit_seconds?, section_limits_seconds? }
//   POST   /api/v2/timers/{userId}/tick         心跳累加（前端定时器调用）
//                                               body: { exam_id*, section_index?, delta_seconds }
//                                               若 exam_id 不匹配返回 null（前端应重 start）
//   POST   /api/v2/timers/{userId}/finish       完成 / 放弃（清理）
// ---------------------------------------------------------------------------
void registerAttemptTimerRoutes(const AppContext &ctx)
{
    // GET 当前计时
    app().registerHandler(
        "/api/v2/timers/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "exam_timer", userId);
                return common::ok(req, ctx.attemptTimerService->get(userId));
            });
        },
        {Get});

    // POST start
    app().registerHandler(
        "/api/v2/timers/{1}/start",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "exam_timer", userId);
                const auto body = parseJsonBody(req);
                requireString(body, "exam_id");
                return common::ok(req, ctx.attemptTimerService->start(userId, body));
            });
        },
        {Post});

    // POST tick
    app().registerHandler(
        "/api/v2/timers/{1}/tick",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "exam_timer", userId);
                const auto body = parseJsonBody(req);
                requireString(body, "exam_id");
                return common::ok(req, ctx.attemptTimerService->tick(userId, body));
            });
        },
        {Post});

    // POST finish
    app().registerHandler(
        "/api/v2/timers/{1}/finish",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "exam_timer", userId);
                Json::Value out(Json::objectValue);
                out["cleared"] = ctx.attemptTimerService->clear(userId);
                return common::ok(req, out);
            });
        },
        {Post});
}
}  // namespace transport::routes
