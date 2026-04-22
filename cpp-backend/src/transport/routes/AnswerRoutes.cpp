#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerAnswerRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/answers/submit",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto userId = body.get("user_id", "guest").asString();
                const auto examId = requireString(body, "exam_id");
                const auto answers = body.get("answers", Json::Value(Json::objectValue));
                const auto exam = ctx.examService->getExam(examId);
                const auto score = ctx.answerService->calculateScore(examId, answers, exam);
                ctx.answerService->save(userId, examId, answers, score);
                return common::ok(req, score);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/answers/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                Json::Value out(Json::objectValue);
                out["answers"] = ctx.answerService->load(userId, examId);
                return common::ok(req, out);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/progress/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.answerService->progress(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/progress/{1}/exams",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.answerService->examProgress(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
