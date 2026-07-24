#include <drogon/HttpAppFramework.h>
#include <functional>
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;
namespace transport::routes
{
void registerContentWorkflowRoutes(const AppContext &ctx)
{
    app().registerHandler("/api/v1/admin/content/workflow", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
        handleRequest(req, std::move(callback), [&]() { const auto session=requireSession(*ctx.authService,req); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); return common::ok(req,ctx.contentWorkflowService->listItems()); });
    }, {Get});
    app().registerHandler("/api/v1/admin/content/workflow/queue", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
        handleRequest(req, std::move(callback), [&]() { const auto session=requireSession(*ctx.authService,req); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); return common::ok(req,ctx.contentWorkflowService->listQueue()); });
    }, {Get});
    app().registerHandler("/api/v1/admin/content/workflow/{1}/inspect", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId) {
        handleRequest(req,std::move(callback),[&](){ const auto body=parseJsonBody(req); const auto session=requireSession(*ctx.authService,req,&body); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); const auto actor=session.get("user_id","").asString(); const auto result=ctx.contentWorkflowService->inspect(examId,actor); Json::Value d(Json::objectValue); d["exam_id"]=examId; d["inspection"]=result["inspection"]; ctx.auditLogService->record("content.quality.inspected",actor,"执行内容质量检查",d); return common::ok(req,result); });
    }, {Post});
    app().registerHandler("/api/v1/admin/content/workflow/{1}/reviews/{2}", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId, std::string stage) {
        handleRequest(req,std::move(callback),[&](){ const auto body=parseJsonBody(req); const auto session=requireSession(*ctx.authService,req,&body); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); const auto actor=session.get("user_id","").asString(); const auto result=ctx.contentWorkflowService->review(examId,stage,body,actor); Json::Value d(Json::objectValue); d["exam_id"]=examId; d["stage"]=stage; d["status"]=body.get("status",""); ctx.auditLogService->record("content.review.updated",actor,"更新内容审核",d); return common::ok(req,result); });
    }, {Put});
    app().registerHandler("/api/v1/admin/content/workflow/{1}/publish", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId) {
        handleRequest(req,std::move(callback),[&](){ const auto body=parseJsonBody(req); const auto session=requireSession(*ctx.authService,req,&body); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); if(requireBoundedString(body,"confirmation",1,20)!="确认发布") throw common::AppException("CONFIRMATION_REQUIRED","请输入“确认发布”",k422UnprocessableEntity); requirePasswordReauthentication(*ctx.authService,session,body); const auto actor=session.get("user_id","").asString(); const auto result=ctx.contentWorkflowService->enqueuePublish(examId,actor); Json::Value d(Json::objectValue); d["exam_id"]=examId; d["version_id"]=result["version_id"]; ctx.auditLogService->record("content.published",actor,"发布内容版本",d); return common::ok(req,result); });
    }, {Post});
    app().registerHandler("/api/v1/admin/content/workflow/{1}/versions", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId) {
        handleRequest(req,std::move(callback),[&](){ const auto session=requireSession(*ctx.authService,req); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); return common::ok(req,ctx.contentWorkflowService->listVersions(examId)); });
    }, {Get});
    app().registerHandler("/api/v1/admin/content/workflow/{1}/versions/{2}/rollback", [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId, std::string versionId) {
        handleRequest(req,std::move(callback),[&](){ const auto body=parseJsonBody(req); const auto session=requireSession(*ctx.authService,req,&body); requireRole(session,{"contentAdmin","superAdmin"},"需要内容管理员权限"); if(requireBoundedString(body,"confirmation",1,20)!="确认回滚") throw common::AppException("CONFIRMATION_REQUIRED","请输入“确认回滚”",k422UnprocessableEntity); requirePasswordReauthentication(*ctx.authService,session,body); const auto actor=session.get("user_id","").asString(); const auto result=ctx.contentWorkflowService->rollback(examId,versionId,actor); Json::Value d(Json::objectValue); d["exam_id"]=examId; d["from_version_id"]=versionId; d["new_version_id"]=result["id"]; ctx.auditLogService->record("content.rolled_back",actor,"回滚内容版本",d); return common::ok(req,result); });
    }, {Post});
}
}
