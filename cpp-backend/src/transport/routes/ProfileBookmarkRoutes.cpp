#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerFuriganaRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/furigana/add",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto text = requireString(body, "text");
                Json::Value out(Json::objectValue);
                out["result"] = ctx.furiganaService->annotate(text);
                return common::ok(req, out);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/furigana/reading/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string word) {
            handleRequest(req, std::move(callback), [&]() {
                Json::Value out(Json::objectValue);
                out["word"] = word;
                out["reading"] = ctx.furiganaService->reading(word);
                return common::ok(req, out);
            });
        },
        {Get});
}

void registerProfileRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/profile/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.profileService->getProfile(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/profile/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                return common::ok(req, ctx.profileService->updateProfile(userId, body));
            });
        },
        {Put});
}

void registerBookmarkRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/bookmarks/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.bookmarkService->getBookmarks(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/bookmarks/{1}/exams",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto examId = requireString(body, "exam_id");
                return common::ok(req, ctx.bookmarkService->addExamBookmark(userId, examId));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/bookmarks/{1}/exams/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.bookmarkService->removeExamBookmark(userId, examId));
            });
        },
        {Delete});
}
}  // namespace transport::routes
