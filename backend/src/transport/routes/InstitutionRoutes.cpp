#include <string>

#include <drogon/HttpAppFramework.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"
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
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->dashboard(userId, session["roles"], req->getParameter("org_id")));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/workbench",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->teachingWorkbench(userId, session["roles"], req->getParameter("org_id")));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/organizations/{1}/learning-groups/{2}/gradebook",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->learningGroupGradebook(userId, session["roles"], organizationId, learningGroupId));
            });
        },
        {Get});

	app().registerHandler(
		"/api/v1/institution/organizations/{1}/learning-groups/{2}/schedule",
		[ctx](const HttpRequestPtr &req,
		      std::function<void(const HttpResponsePtr &)> &&callback,
		      std::string organizationId,
		      std::string learningGroupId) {
			handleRequest(req, std::move(callback), [&]() {
				const auto body = parseJsonBody(req);
				const auto session = requireSession(*ctx.authService, req, &body);
				const auto userId = session.get("user_id", session.get("id", "")).asString();
				if (!hasAnyRole(session["roles"], {"superAdmin"}) &&
					!ctx.organizationService->canManageOrganization(userId, session["roles"], organizationId) &&
					!ctx.assignmentService->isLearningGroupStaff(organizationId, learningGroupId, userId))
				{
					throw common::AppException("FORBIDDEN", "仅学习组老师、助教或机构管理员可调整排课", k403Forbidden);
				}
				Json::Value patch(Json::objectValue);
				patch["learning_group_id"] = learningGroupId;
				for (const char *field : {"starts_at", "ends_at", "status"})
				{
					if (body.isMember(field))
					{
						if (!body[field].isString() || body[field].asString().size() > 80)
						{
							throw common::AppException("VALIDATION_ERROR", std::string(field) + " 格式不正确", k422UnprocessableEntity);
						}
						patch[field] = body[field];
					}
				}
				return common::ok(
					req,
					ctx.organizationService->upsertLearningGroup(userId, organizationId, patch),
					"schedule_updated");
			});
		},
		{Patch, Post});

	app().registerHandler(
		"/api/v1/institution/students/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string studentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->studentProfile(userId, session["roles"], studentId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/students/{1}/teacher-notes",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string studentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);

                // 复用学员档案的机构归属校验，防止教师跨机构写备注。
                ctx.institutionService->studentProfile(userId, session["roles"], studentId);
                const auto text = requireBoundedString(body, "text", 1, 500);
                auto profile = ctx.profileService->getProfile(studentId);
                auto notes = profile.get("teacher_notes", Json::Value(Json::arrayValue));
                if (!notes.isArray())
                {
                    notes = Json::Value(Json::arrayValue);
                }
                Json::Value note(Json::objectValue);
                note["text"] = text;
                note["created_at"] = common::nowIso8601();
                note["created_by"] = userId;
                notes.append(note);

                Json::Value patch(Json::objectValue);
                patch["teacher_notes"] = notes;
                return common::ok(req, ctx.profileService->updateProfile(studentId, patch), "teacher_note_added");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/institution/lesson-prep",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->lessonPrep(userId, session["roles"], body),
                    "lesson_prep_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/institution/lesson-prep/plans",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->listLessonPrepPlans(userId, session["roles"], req->getParameter("org_id")));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/institution/lesson-prep/plans",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
                return common::ok(
                    req,
                    ctx.institutionService->saveLessonPrepPlan(userId, session["roles"], body),
                    "lesson_prep_plan_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/institution/import-preview",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", "").asString();
                requireFeature(*ctx.featureFlagService, "learning_groups", userId);
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
