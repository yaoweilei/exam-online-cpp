#include <string>

#include <drogon/HttpAppFramework.h>

#include "application/services/ChapterService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// 章节式学习路径（功能 #18）路由
//   GET /api/v1/chapters?family=jlpt&level=N2&user_id=xxx        —— 列出章节 + 该用户进度
//   GET /api/v1/chapters/{chapterId}?user_id=xxx     —— 章节题目详情 + 作答状态
//   POST /api/v1/chapters/rebuild                     —— 管理员强制重建索引
void registerChapterRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/chapters",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto userId = req->getParameter("user_id");
                requireFeature(*ctx.featureFlagService, "chapter_path", userId);
                const auto family = req->getParameter("family");
                const auto level = req->getParameter("level");
                return common::ok(req, ctx.chapterService->listChapters(family, level, userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/chapters/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string chapterId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto userId = req->getParameter("user_id");
                requireFeature(*ctx.featureFlagService, "chapter_path", userId);
                if (chapterId == "rebuild")
                {
                    // 该路径与 POST /chapters/rebuild 冲突，但 GET 语义是 chapter detail
                    // 由客户端确保不会取 id 为 "rebuild" 的章节
                }
                return common::ok(req, ctx.chapterService->getChapter(chapterId, userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/chapters/rebuild",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req, nullptr);
                requireRole(session, {"contentAdmin", "superAdmin"}, "仅内容管理员可重建章节索引");
                ctx.chapterService->rebuild();
                Json::Value out(Json::objectValue);
                out["ok"] = true;
                return common::ok(req, out);
            });
        },
        {Post});
}
}  // namespace transport::routes
