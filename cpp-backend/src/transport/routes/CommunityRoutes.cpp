#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 12：社区讨论 路由（每张试卷一个讨论区）
//   GET    /api/v2/community/{paperId}                         列表
//   POST   /api/v2/community/{paperId}/posts                   发帖 {title, body}
//   DELETE /api/v2/community/{paperId}/posts/{postId}          删除帖子（作者或 superAdmin）
//   POST   /api/v2/community/{paperId}/posts/{postId}/comments 评论 {body}
//   POST   /api/v2/community/{paperId}/posts/{postId}/like     切换点赞
//
// 权限：登录；功能开关 community（用 actor userId 校验）
// ---------------------------------------------------------------------------

namespace
{
std::string actorUserId(const Json::Value &session)
{
    return session.get("user_id", session.get("id", "")).asString();
}

std::string actorDisplayName(const Json::Value &session)
{
    // 兼容多种字段命名：display_name / username / nickname
    auto n = session.get("display_name", session.get("username", session.get("nickname", ""))).asString();
    if (n.empty()) n = actorUserId(session);
    return n;
}
}  // namespace

void registerCommunityRoutes(const AppContext &ctx)
{
    // 列表
    app().registerHandler(
        "/api/v2/community/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string paperId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "community", actorUserId(session));
                return common::ok(req, ctx.communityService->listPosts(paperId));
            });
        },
        {Get});

    // 发帖
    app().registerHandler(
        "/api/v2/community/{1}/posts",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string paperId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "community", actorUserId(session));
                const auto title = body.get("title", "").asString();
                const auto text = body.get("body", "").asString();
                return common::ok(req, ctx.communityService->createPost(
                                            paperId, actorUserId(session), actorDisplayName(session), title, text));
            });
        },
        {Post});

    // 删除帖子（作者或 superAdmin）
    app().registerHandler(
        "/api/v2/community/{1}/posts/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string paperId,
              std::string postId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "community", actorUserId(session));
                // 取作者：先 list 找到对应 post 校验
                const auto doc = ctx.communityService->listPosts(paperId);
                std::string authorId;
                if (doc.isObject() && doc["posts"].isArray())
                {
                    for (const auto &p : doc["posts"])
                    {
                        if (p.get("post_id", "").asString() == postId)
                        {
                            authorId = p.get("author_id", "").asString();
                            break;
                        }
                    }
                }
                if (authorId.empty())
                {
                    throw common::AppException("NOT_FOUND", "帖子不存在", drogon::k404NotFound);
                }
                const auto self = actorUserId(session);
                const bool isSuper = hasAnyRole(session.get("roles", Json::Value(Json::arrayValue)), {"superAdmin"});
                if (self != authorId && !isSuper)
                {
                    throw common::AppException("FORBIDDEN", "只能删除自己的帖子", drogon::k403Forbidden);
                }
                return common::ok(req, ctx.communityService->removePost(paperId, postId));
            });
        },
        {Delete});

    // 评论
    app().registerHandler(
        "/api/v2/community/{1}/posts/{2}/comments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string paperId,
              std::string postId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "community", actorUserId(session));
                const auto text = body.get("body", "").asString();
                return common::ok(req, ctx.communityService->addComment(
                                            paperId, postId, actorUserId(session), actorDisplayName(session), text));
            });
        },
        {Post});

    // 切换点赞
    app().registerHandler(
        "/api/v2/community/{1}/posts/{2}/like",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string paperId,
              std::string postId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireFeature(*ctx.featureFlagService, "community", actorUserId(session));
                return common::ok(req, ctx.communityService->toggleLike(paperId, postId, actorUserId(session)));
            });
        },
        {Post});
}
}  // namespace transport::routes
