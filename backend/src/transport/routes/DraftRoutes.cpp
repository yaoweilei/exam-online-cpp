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
Json::Value recentItemFromDraft(const std::string &userId, const Json::Value &draft, const std::string &status)
{
    Json::Value item(Json::objectValue);
    item["user_id"] = userId;
    item["exam_id"] = draft.get("exam_id", "").asString();
    item["paper_id"] = draft.get("paper_id", "").asString();
    item["status"] = status;
    item["total_questions"] = draft.get("total_questions", 0);
    item["answered_count"] = draft.get("answered_count", 0);
    item["last_section_index"] = draft.get("last_section_index", 0);
    item["last_question_index"] = draft.get("last_question_index", 0);
    return item;
}
}  // namespace

// ---------------------------------------------------------------------------
// 续考草稿路由（业务功能 4：上次未完成自动续考）
//   GET    /api/v1/drafts/{userId}     拉取最新草稿；无草稿返回 null
//   POST   /api/v1/drafts/{userId}     保存草稿（前端做题时定期调用）
//                                      body: { exam_id*, paper_id?, total_questions?, answered_count?,
//                                              last_section_index?, last_question_index?, answers? }
//   DELETE /api/v1/drafts/{userId}     放弃草稿
// ---------------------------------------------------------------------------
void registerDraftRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                return common::ok(req, ctx.draftService->get(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                // 必须带 exam_id
                requireString(body, "exam_id");
                auto saved = ctx.draftService->save(userId, body);
                if (ctx.recentLearningRepository != nullptr)
                {
                    ctx.recentLearningRepository->upsert(userId, recentItemFromDraft(userId, saved, "draft"));
                }
                return common::ok(req, saved);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/drafts/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                requireFeature(*ctx.featureFlagService, "resume_draft", userId);
                Json::Value out(Json::objectValue);
                out["cleared"] = ctx.draftService->clear(userId);
                return common::ok(req, out);
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/recent-learning/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int limit = readBoundedIntParameter(req, "limit", 10, 1, 10);
                if (ctx.recentLearningRepository != nullptr && ctx.draftService != nullptr)
                {
                    const auto currentDraft = ctx.draftService->get(userId);
                    if (currentDraft.isObject() && !currentDraft.get("exam_id", "").asString().empty())
                    {
                        ctx.recentLearningRepository->upsert(userId, recentItemFromDraft(userId, currentDraft, "draft"));
                    }
                }
                return common::ok(req,
                    ctx.recentLearningRepository != nullptr
                        ? ctx.recentLearningRepository->list(userId, limit)
                        : Json::Value(Json::objectValue));
            });
        },
        {Get});
}
}  // namespace transport::routes
