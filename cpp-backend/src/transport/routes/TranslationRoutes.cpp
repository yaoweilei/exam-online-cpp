#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// 段/句级译文路由（B2：阅读分句双语对照）
//
//   GET  /api/v2/translations/{examId}
//   PUT  /api/v2/translations/{examId}/sentences
//        body: { passage_key, paragraph, sentence, text }
//        - passage_key: 由前端约定的稳定键（推荐 "section_id:question_id"）
//        - paragraph / sentence: 0 起的下标
void registerTranslationRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/translations/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.translationService->get(examId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/translations/{1}/sentences",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto passageKey = requireString(body, "passage_key");
                const auto text = requireString(body, "text");
                if (!body.isMember("paragraph") || !body["paragraph"].isInt())
                {
                    throw common::AppException(
                        "VALIDATION_ERROR",
                        "缺少或非法 paragraph",
                        drogon::k422UnprocessableEntity);
                }
                if (!body.isMember("sentence") || !body["sentence"].isInt())
                {
                    throw common::AppException(
                        "VALIDATION_ERROR",
                        "缺少或非法 sentence",
                        drogon::k422UnprocessableEntity);
                }
                const auto paragraph = body["paragraph"].asInt();
                const auto sentence = body["sentence"].asInt();
                const auto updatedBy = session.get("user_id", "").asString();
                return common::ok(
                    req,
                    ctx.translationService->upsertSentence(
                        examId, passageKey, paragraph, sentence, text, updatedBy));
            });
        },
        {Put});
}
}  // namespace transport::routes
