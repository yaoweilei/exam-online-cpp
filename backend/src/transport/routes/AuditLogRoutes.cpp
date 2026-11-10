#include <optional>
#include <string>
#include <map>

#include <drogon/HttpAppFramework.h>

#include "application/services/AuditLogService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 业务功能 15：审计日志可视化 路由
//   GET /api/v1/admin/audit-logs           查询日志
//     query: org_id?, actor_id?, action?, since?, until?, limit?, offset?
//   GET /api/v1/admin/audit-logs/actions   去重 action 列表（用于筛选下拉）
//
// 权限：登录 + (superAdmin | orgAdmin | contentAdmin)；FeatureFlag audit_log_viewer
//   - orgAdmin：强制 org_id 限制为其所属组织（任一），传别的会被忽略覆盖
//   - contentAdmin：只返回 action 以 content. 开头的内容变更日志
// ---------------------------------------------------------------------------

namespace
{
std::optional<std::string> getOpt(const drogon::HttpRequestPtr &req, const std::string &key)
{
    const auto v = req->getParameter(key);
    if (v.empty()) return std::nullopt;
    return v;
}

application::services::AuditLogQuery visibleAuditScope(const AppContext &ctx, const Json::Value &session, const drogon::HttpRequestPtr &req)
{
    application::services::AuditLogQuery q;
    const auto actorId = session.get("user_id", "").asString();
    const auto roles = session["roles"];
    if (hasAnyRole(roles, {"superAdmin"}))
    {
        q.orgId = getOpt(req, "org_id");
    }
    else
    {
        const auto context = ctx.userService->context(actorId);
        const auto canAudit = [&](const std::string &orgId) {
            for (const auto &membership : context["memberships"])
            {
                if (membership.get("scope_id", "").asString() != orgId ||
                    membership.get("status", "active").asString() != "active") continue;
                for (const auto &organization : context["organizations"])
                    if (organization.get("organization_id", "").asString() == orgId &&
                        organization.get("status", "active").asString() == "active")
                        return ctx.organizationService->hasOrganizationPermission(actorId, roles, orgId, "audit.view");
            }
            return false;
        };
        const auto requested = req->getParameter("org_id");
        if (!requested.empty() && canAudit(requested)) q.orgId = requested;
        else if (hasAnyRole(roles, {"contentAdmin"}) && !hasAnyRole(roles, {"orgAdmin"})) q.actionPrefix = "content.";
        else
        {
            const auto selected = context["membership"].get("scope_id", "").asString();
            if (canAudit(selected)) q.orgId = selected;
            else for (const auto &membership : context["memberships"])
            {
                const auto id = membership.get("scope_id", "").asString();
                if (canAudit(id)) { q.orgId = id; break; }
            }
            if (!q.orgId) throw common::AppException("FORBIDDEN", "无权查看机构审计日志", drogon::k403Forbidden);
        }
    }
    if (req->getParameter("scope") == "content") q.actionPrefix = "content.";
    requireFeature(*ctx.featureFlagService, "audit_log_viewer", actorId);
    return q;
}
}  // namespace

void registerAuditLogRoutes(const AppContext &ctx)
{
    // 查询日志
    app().registerHandler(
        "/api/v1/admin/audit-logs",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                auto q = visibleAuditScope(ctx, session, req);
                q.actorId = getOpt(req, "actor_id");
                q.action = getOpt(req, "action");
                q.since = getOpt(req, "since");
                q.until = getOpt(req, "until");
                q.limit = readBoundedIntParameter(req, "limit", 50, 1, 200);
                q.offset = readBoundedIntParameter(req, "offset", 0, 0, 1000000);
                auto result=ctx.auditLogService->query(q);
                std::map<std::string,Json::Value> actors;
                std::map<std::string,std::string> titles;
                for (auto &item : result["items"])
                {
                    const auto actor=item.get("actor_user_id","").asString();
                    if (!actor.empty() && !actors.contains(actor)) {
                        try { actors[actor]=ctx.userService->getUser(actor); } catch (const common::AppException &) { actors[actor]=Json::nullValue; }
                    }
                    item["actor_display_name"]=actors[actor].get("display_name","");
                    item["actor_username"]=actors[actor].get("username","");
                    const auto details=item["details"];
                    const auto examId=details.get("exam_id",details.get("paper_id","")).asString();
                    if (!examId.empty() && !titles.contains(examId)) {
                        titles[examId]="";
                        try { const auto exam=ctx.examService->getExam(examId,session["user_id"].asString()); const auto info=exam["exam_info"]; titles[examId]=info.get("title",info.get("exam_name","")).asString(); }
                        catch (const common::AppException &) { /* Deleted or unavailable paper: the client retains the ID in details. */ }
                    }
                    if (!examId.empty()) { item["object_id"]=examId; item["object_name"]=titles[examId]; }
                }
                return common::ok(req, result);
            });
        },
        {Get});

    // 去重 action 列表
    app().registerHandler(
        "/api/v1/admin/audit-logs/actions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto q = visibleAuditScope(ctx, session, req);
                return common::ok(req, ctx.auditLogService->listActions(q.orgId, q.actionPrefix));
            });
        },
        {Get});
}
}  // namespace transport::routes
