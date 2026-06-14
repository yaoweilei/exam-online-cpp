#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerInstitutionRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/institution/plans",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.institutionService->plans());
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/dashboard",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(
                    req,
                    ctx.institutionService->dashboard(userId, session["roles"], req->getParameter("org_id")));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/classes/{1}/gradebook",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(
                    req,
                    ctx.institutionService->classGradebook(userId, session["roles"], classId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/students/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string studentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(
                    req,
                    ctx.institutionService->studentProfile(userId, session["roles"], studentId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/lesson-prep",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(
                    req,
                    ctx.institutionService->lessonPrep(userId, session["roles"], body),
                    "lesson_prep_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/institution/import-preview",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(
                    req,
                    ctx.institutionService->bulkImportPreview(
                        userId,
                        session["roles"],
                        body.get("org_id", "").asString(),
                        body.get("text", "").asString()),
                    "institution_import_previewed");
            });
        },
        {Post});
}
}  // namespace transport::routes
