#include "transport/routes/Routes.h"
#include "transport/RouteUtils.h"
#include <drogon/HttpAppFramework.h>
using namespace drogon;

namespace transport::routes
{
void registerInstitutionInsightsRoutes(const AppContext &ctx);
void registerInstitutionWorkflowRoutes(const AppContext &ctx)
{
    registerInstitutionInsightsRoutes(ctx);
    for (const auto *operation : {"lesson-batch","relationship-change"}) for (const bool commit : {false,true}) {
        const bool relationship=std::string(operation)=="relationship-change";
        app().registerHandler(std::string("/api/v1/institution/organizations/{1}/learning-groups/{2}/")+operation+(commit?"":"/preview"),
            [ctx,relationship,commit](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string orgId,std::string groupId) {
                handleRequest(req,std::move(callback),[&]() {
                    const auto body=parseJsonBody(req),session=requireSession(*ctx.authService,req,&body);
                    if (commit) {
                        const auto expected=relationship?"确认变更授课关系":"确认批量排课";
                        if (body.get("confirmation","").asString()!=expected) throw common::AppException("CONFIRMATION_REQUIRED","请先核对影响预览并确认",k422UnprocessableEntity);
                        if (relationship) requirePasswordReauthentication(*ctx.authService,session,body);
                    }
                    return common::ok(req,relationship?ctx.institutionService->changeTeachingRelationship(session["user_id"].asString(),session["roles"],orgId,groupId,body,commit):ctx.institutionService->saveLessonBatch(session["user_id"].asString(),session["roles"],orgId,groupId,body,commit));
                });
            },{Post});
    }
    for (const bool commit : {false,true}) app().registerHandler(
        std::string("/api/v1/institution/organizations/{1}/learning-groups/{2}/lessons/{3}/corrections")+(commit?"":"/preview"),
        [ctx,commit](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string orgId,std::string groupId,std::string lessonId) {
            handleRequest(req,std::move(callback),[&]() {
                const auto body=parseJsonBody(req),session=requireSession(*ctx.authService,req,&body);
                if (commit) {
                    if (body.get("confirmation","").asString()!="确认更正课时") throw common::AppException("CONFIRMATION_REQUIRED","请先核对预览并确认更正课时",k422UnprocessableEntity);
                    requirePasswordReauthentication(*ctx.authService,session,body);
                }
                return common::ok(req,ctx.institutionService->correctLessonSettlement(session["user_id"].asString(),session["roles"],orgId,groupId,lessonId,body,commit));
            });
        },{Post});
    app().registerHandler("/api/v1/me/lessons/{1}/leave",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string lessonId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req), session = requireSession(*ctx.authService, req, &body);
                return common::ok(req, ctx.institutionService->requestLessonLeave(session["user_id"].asString(), requireBoundedString(body, "org_id", 1, 120), lessonId, requireBoundedString(body, "reason", 1, 500)));
            });
        }, {Post});
    app().registerHandler("/api/v1/me/courses",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.institutionService->myCourses(session["user_id"].asString()));
            });
        }, {Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/followups",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string orgId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.institutionService->followups(session["user_id"].asString(), session["roles"], orgId));
            });
        }, {Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/followups",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string orgId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req), session = requireSession(*ctx.authService, req, &body);
                return common::ok(req, ctx.institutionService->saveFollowup(session["user_id"].asString(), session["roles"], orgId, body));
            });
        }, {Post, Put});
    app().registerHandler("/api/v1/institution/organizations/{1}/learning-groups/{2}/lessons",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string orgId, std::string groupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                return common::ok(req, ctx.institutionService->lessons(session["user_id"].asString(), session["roles"], orgId, groupId));
            });
        }, {Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/learning-groups/{2}/lessons",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string orgId, std::string groupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req), session = requireSession(*ctx.authService, req, &body);
                return common::ok(req, ctx.institutionService->saveLesson(session["user_id"].asString(), session["roles"], orgId, groupId, body));
            });
        }, {Post, Put});
    app().registerHandler("/api/v1/organizations/{1}/student-import",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string orgId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req), session = requireSession(*ctx.authService, req, &body);
                const auto actor = session["user_id"].asString();
                if (!ctx.organizationService->hasOrganizationPermission(actor, session["roles"], orgId, "organization.member.manage"))
                    throw common::AppException("FORBIDDEN", "需要该机构成员管理权限", k403Forbidden);
                const bool commit = body.get("commit", false).asBool();
                ctx.institutionService->bulkImportPreview(actor, session["roles"], orgId, requireBoundedString(body, "text", 1, 65536));
                if (commit)
                {
                    if (body.get("confirmation", "").asString() != "确认导入学员")
                        throw common::AppException("CONFIRMATION_REQUIRED", "请确认导入学员", k422UnprocessableEntity);
                    requirePasswordReauthentication(*ctx.authService, session, body);
                }
                return common::ok(req, ctx.organizationService->importStudents(actor, orgId, requireBoundedString(body, "text", 1, 65536), commit));
            });
        }, {Post});
}
}
