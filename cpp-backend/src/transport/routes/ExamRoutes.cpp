#include <chrono>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerExamRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/exams",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto family = req->getParameter("family");
                const auto level = req->getParameter("level");
                const auto year = req->getParameter("year");
                const auto sort = req->getParameter("sort").empty() ? "date_desc" : req->getParameter("sort");
                return common::ok(req, ctx.examService->listExams(family, level, year, sort));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/exams/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto userId = req->getParameter("user_id").empty() ? "guest" : req->getParameter("user_id");
                return common::ok(req, ctx.examService->getExam(examId, userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/exams/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                auto json = parseJsonBody(req);
                ctx.examService->createOrUpdateExam(examId, json);
                Json::Value out(Json::objectValue);
                out["id"] = examId;
                return common::ok(req, out, "exam_updated");
            });
        },
        {Put});

    app().registerHandler(
        "/api/v2/exams",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                auto json = parseJsonBody(req);
                const auto examId = json.get("id", "").asString().empty()
                                        ? ("exam_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()))
                                        : json.get("id", "").asString();
                ctx.examService->createOrUpdateExam(examId, json);
                Json::Value out(Json::objectValue);
                out["id"] = examId;
                return common::ok(req, out, "exam_saved");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v2/exams/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                ctx.examService->deleteExam(examId);
                return common::ok(req, Json::Value(Json::objectValue), "exam_deleted");
            });
        },
        {Delete});
}
}  // namespace transport::routes
