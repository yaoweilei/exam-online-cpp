#include <string>

#include <drogon/HttpAppFramework.h>

#include "application/services/RelatedQuestionsService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// 同考点串题（功能 #17）路由
//   GET  /api/v1/related-questions?exam_id=X&question_id=Y&limit=10
//   GET  /api/v1/related-questions/stats    （调试用；返回索引规模）
//   POST /api/v1/related-questions/rebuild  （管理员：强制重建索引）
void registerRelatedQuestionsRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/related-questions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                // 此功能无须用户态；所有登录用户或访客只读
                requireFeature(*ctx.featureFlagService, "related_questions", "");
                const auto examId = req->getParameter("exam_id");
                const auto questionId = req->getParameter("question_id");
                if (examId.empty() || questionId.empty())
                {
                    throw common::AppException("BAD_REQUEST", "exam_id/question_id required",
                                               drogon::k400BadRequest);
                }
                int limit = 10;
                const auto l = req->getParameter("limit");
                if (!l.empty())
                {
                    try { limit = std::stoi(l); } catch (...) {}
                }
                return common::ok(req, ctx.relatedQuestionsService->findByQuestion(examId, questionId, limit));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/related-questions/stats",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "related_questions", "");
                return common::ok(req, ctx.relatedQuestionsService->getStats());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/related-questions/rebuild",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req, nullptr);
                requireRole(session, {"systemAdmin", "superAdmin"}, "仅管理员可重建索引");
                ctx.relatedQuestionsService->rebuild();
                return common::ok(req, ctx.relatedQuestionsService->getStats());
            });
        },
        {Post});
}
}  // namespace transport::routes
