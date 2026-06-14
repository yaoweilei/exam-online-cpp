#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 收藏夹/分类 路由（业务功能 8）
//   GET    /api/v1/bookmark-folders/{userId}                         列表
//   POST   /api/v1/bookmark-folders/{userId}                         创建 {name, color?}
//   PATCH  /api/v1/bookmark-folders/{userId}/{folderId}              改名/换色
//   DELETE /api/v1/bookmark-folders/{userId}/{folderId}              删除
//   POST   /api/v1/bookmark-folders/{userId}/{folderId}/exams        加试卷 {exam_id}
//   DELETE /api/v1/bookmark-folders/{userId}/{folderId}/exams/{ex}   移除试卷
// ---------------------------------------------------------------------------

namespace
{
// 仅本人可操作（与错题本/SRS 同样的所有权约束）
void requireSelf(const Json::Value &session, const std::string &userId)
{
    const auto sid = session.get("user_id", session.get("id", "")).asString();
    if (sid != userId)
    {
        throw common::AppException("FORBIDDEN", "只能操作自己的收藏夹", drogon::k403Forbidden);
    }
}
}  // namespace

void registerBookmarkFolderRoutes(const AppContext &ctx)
{
    // 列表
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                return common::ok(req, ctx.bookmarkFolderService->list(userId));
            });
        },
        {Get});

    // 创建
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                const auto name = body.get("name", "").asString();
                const auto color = body.get("color", "").asString();
                return common::ok(req, ctx.bookmarkFolderService->create(userId, name, color));
            });
        },
        {Post});

    // 改名/换色
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string folderId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                return common::ok(req, ctx.bookmarkFolderService->update(userId, folderId, body));
            });
        },
        {Patch});

    // 删除
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string folderId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                return common::ok(req, ctx.bookmarkFolderService->remove(userId, folderId));
            });
        },
        {Delete});

    // 加试卷到文件夹
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}/{2}/exams",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string folderId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                const auto examId = body.get("exam_id", "").asString();
                return common::ok(req, ctx.bookmarkFolderService->addExam(userId, folderId, examId));
            });
        },
        {Post});

    // 从文件夹移除试卷
    app().registerHandler(
        "/api/v1/bookmark-folders/{1}/{2}/exams/{3}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string folderId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireSelf(session, userId);
                requireFeature(*ctx.featureFlagService, "bookmark_folders", userId);
                return common::ok(req, ctx.bookmarkFolderService->removeExam(userId, folderId, examId));
            });
        },
        {Delete});
}
}  // namespace transport::routes
