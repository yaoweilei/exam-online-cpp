#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// SRS 间隔重复 路由（业务功能 7）
//   GET    /api/v1/srs/{userId}/due?limit=20   待复习卡列表
//   GET    /api/v1/srs/{userId}/cards          全部卡（管理/调试）
//   POST   /api/v1/srs/{userId}/review         { card_id, grade(0-3) }
//   POST   /api/v1/srs/{userId}/cards          { exam_id, question_id, question_type?, snapshot? } 手工入卡
//   DELETE /api/v1/srs/{userId}/cards/{cardId}
// ---------------------------------------------------------------------------
void registerSrsRoutes(const AppContext &ctx)
{
    // 待复习
    app().registerHandler(
        "/api/v1/srs/{1}/due",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "srs", userId);
                int limit = 20;
                const auto lim = req->getParameter("limit");
                if (!lim.empty()) { try { limit = std::stoi(lim); } catch (...) {} }
                return common::ok(req, ctx.srsService->listDue(userId, limit));
            });
        },
        {Get});

    // 全部卡
    app().registerHandler(
        "/api/v1/srs/{1}/cards",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "srs", userId);
                return common::ok(req, ctx.srsService->listAll(userId));
            });
        },
        {Get});

    // 评分
    app().registerHandler(
        "/api/v1/srs/{1}/review",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "srs", userId);
                const auto cardId = body.get("card_id", "").asString();
                const auto grade = body.get("grade", -1).asInt();
                if (cardId.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "缺少 card_id", drogon::k422UnprocessableEntity);
                }
                return common::ok(req, ctx.srsService->review(userId, cardId, grade));
            });
        },
        {Post});

    // 手工入卡
    app().registerHandler(
        "/api/v1/srs/{1}/cards",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "srs", userId);
                const auto examId = body.get("exam_id", "").asString();
                const auto qid = body.get("question_id", "").asString();
                const auto qtype = body.get("question_type", "").asString();
                const auto snap = body.get("snapshot", Json::Value(Json::objectValue));
                const bool created = ctx.srsService->ingestSingle(userId, examId, qid, qtype, snap);
                Json::Value out(Json::objectValue);
                out["created"] = created;
                out["card_id"] = examId + ":" + qid;
                return common::ok(req, out);
            });
        },
        {Post});

    // 删卡
    app().registerHandler(
        "/api/v1/srs/{1}/cards/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string cardId) {
            handleRequest(req, std::move(callback), [&]() {
                requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "srs", userId);
                const bool removed = ctx.srsService->remove(userId, cardId);
                Json::Value out(Json::objectValue);
                out["removed"] = removed;
                out["card_id"] = cardId;
                return common::ok(req, out);
            });
        },
        {Delete});
}
}  // namespace transport::routes
