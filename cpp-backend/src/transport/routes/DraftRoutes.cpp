#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 续考草稿路由（业务功能 4：上次未完成自动续考）
//   GET    /api/v2/drafts/{userId}     拉取最新草稿；无草稿返回 null
//   POST   /api/v2/drafts/{userId}     保存草稿（前端做题时定期调用）
//                                      body: { exam_id*, paper_id?, total_questions?, answered_count?,
//                                              last_section_index?, last_question_index?, answers? }
//   DELETE /api/v2/drafts/{userId}     放弃草稿
// ---------------------------------------------------------------------------
void registerDraftRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                return common::ok(req, ctx.draftService->get(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                const auto body = parseJsonBody(req);
                // 必须带 exam_id
                requireString(body, "exam_id");
                return common::ok(req, ctx.draftService->save(userId, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                Json::Value out(Json::objectValue);
                out["cleared"] = ctx.draftService->clear(userId);
                return common::ok(req, out);
            });
        },
        {Delete});
}
}  // namespace transport::routes
