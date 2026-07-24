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
        "/api/v1/exams",
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
        "/api/v1/exams/{1}",
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
        "/api/v1/exams/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                auto json = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &json);
                requireRole(session, {"contentAdmin", "superAdmin"}, "需要内容管理员权限");
                json.removeMember("token");
                ctx.examService->createOrUpdateExam(examId, json);
                const auto actor = session.get("user_id", "").asString();
                const auto version = ctx.contentWorkflowService->recordDraft(examId, actor);
                Json::Value details(Json::objectValue); details["exam_id"] = examId; details["version_id"] = version["id"];
                ctx.auditLogService->record("content.exam.updated", actor, "修改试卷内容", details);
                Json::Value out(Json::objectValue);
                out["id"] = examId;
                out["version"] = version;
                return common::ok(req, out, "exam_updated");
            });
        },
        {Put});

    app().registerHandler(
        "/api/v1/exams",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                auto json = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &json);
                requireRole(session, {"contentAdmin", "superAdmin"}, "需要内容管理员权限");
                const auto examId = json.get("id", "").asString().empty()
                                        ? ("exam_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()))
                                        : json.get("id", "").asString();
                json.removeMember("token");
                ctx.examService->createOrUpdateExam(examId, json);
                const auto actor = session.get("user_id", "").asString();
                const auto version = ctx.contentWorkflowService->recordDraft(examId, actor);
                Json::Value details(Json::objectValue); details["exam_id"] = examId; details["version_id"] = version["id"];
                ctx.auditLogService->record("content.exam.imported", actor, "导入试卷内容", details);
                Json::Value out(Json::objectValue);
                out["id"] = examId;
                out["version"] = version;
                return common::ok(req, out, "exam_saved");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/exams/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"contentAdmin", "superAdmin"}, "需要内容管理员权限");
                if (requireBoundedString(body, "confirmation", 1, 20) != "确认删除试卷")
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认删除试卷”", k422UnprocessableEntity);
                requirePasswordReauthentication(*ctx.authService, session, body);
                ctx.examService->deleteExam(examId);
                Json::Value details(Json::objectValue); details["exam_id"] = examId;
                ctx.auditLogService->record("content.exam.deleted", session.get("user_id", "").asString(), "删除试卷内容", details);
                return common::ok(req, Json::Value(Json::objectValue), "exam_deleted");
            });
        },
        {Delete});
}
}  // namespace transport::routes
