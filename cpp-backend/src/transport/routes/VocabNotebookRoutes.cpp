#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// 个人生词本路由（自学者点词查词 + 加入生词本）
//
//   GET    /api/v2/vocab-notebook/{userId}
//   POST   /api/v2/vocab-notebook/{userId}/words      body: {word, reading, note?, exam_id?, question_id?}
//   DELETE /api/v2/vocab-notebook/{userId}/words/{wordId}
//   PATCH  /api/v2/vocab-notebook/{userId}/words/{wordId}   body: {note}
void registerVocabNotebookRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/vocab-notebook/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "vocab_notebook", userId);
                return common::ok(req, ctx.vocabNotebookService->list(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/vocab-notebook/{1}/words",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "vocab_notebook", userId);
                const auto word = requireString(body, "word");
                const auto reading = body.get("reading", "").asString();
                const auto note = body.get("note", "").asString();
                const auto examId = body.get("exam_id", "").asString();
                const auto questionId = body.get("question_id", "").asString();
                return common::ok(
                    req,
                    ctx.vocabNotebookService->addWord(userId, word, reading, note, examId, questionId));
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/vocab-notebook/{1}/words/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string wordId) {
            handleRequest(req, std::move(callback), [&]() {
                requireSession(*ctx.authService, req, nullptr);
                requireFeature(*ctx.featureFlagService, "vocab_notebook", userId);
                return common::ok(req, ctx.vocabNotebookService->removeWord(userId, wordId));
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v2/vocab-notebook/{1}/words/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string wordId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "vocab_notebook", userId);
                const auto note = body.get("note", "").asString();
                return common::ok(req, ctx.vocabNotebookService->updateNote(userId, wordId, note));
            });
        },
        {Patch});
}
}  // namespace transport::routes
