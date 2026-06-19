#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerProfileRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/profile/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.profileService->getProfile(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/profile/{1}",
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
        "/api/v1/bookmarks/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.bookmarkService->getBookmarks(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/bookmarks/{1}/exams",
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
        "/api/v1/bookmarks/{1}/exams/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.bookmarkService->removeExamBookmark(userId, examId));
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/bookmarks/{1}/questions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                auto body = parseJsonBody(req);
                requireString(body, "exam_id");
                requireString(body, "question_id");
                if (!body.isMember("section_index") || !body["section_index"].isIntegral())
                {
                    body["section_index"] = 0;
                }
                return common::ok(req, ctx.bookmarkService->addQuestionBookmark(userId, body));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/bookmarks/{1}/questions/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string bookmarkId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.bookmarkService->removeQuestionBookmark(userId, bookmarkId));
            });
        },
        {Delete});
}
}  // namespace transport::routes
