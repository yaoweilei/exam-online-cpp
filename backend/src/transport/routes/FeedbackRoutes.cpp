#include <algorithm>
#include <string>
#include <vector>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 题目反馈/纠错 路由（业务功能 5）
//   POST   /api/v1/feedback                          用户提交（需登录 + 功能开关 question_feedback）
//                                                    题目反馈需 paper_id / question_id；账号与支付反馈只需 category / description。
//   GET    /api/v1/feedback?paper_id=&status=        运营/内容查看（需 superAdmin/contentAdmin）
//   PATCH  /api/v1/feedback/{feedbackId}?paper_id=   运营/内容更新 status / admin_note（需 superAdmin/contentAdmin）
// ---------------------------------------------------------------------------
void registerFeedbackRoutes(const AppContext &ctx)
{
    app().registerHandler("/api/v1/feedback/{1}/context",
        [ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string id) {
            handleRequest(req,std::move(callback),[&]() {
                const auto session=requireSession(*ctx.authService,req); requireRole(session,{"superAdmin","contentAdmin"},"需要内容管理权限");
                Json::Value out(Json::objectValue), item(Json::nullValue);
                for (const auto &row : ctx.feedbackService->list(req->getParameter("paper_id"),"")) if (row.get("feedback_id", "").asString()==id) { item=row; break; }
                if (item.isNull()) throw common::AppException("NOT_FOUND","反馈记录不存在",k404NotFound);
                out["feedback"]=item; out["source_questions"]=Json::arrayValue;
                if (item["category"].asString()=="account" || item["category"].asString()=="payment") {
                    out["versions"]=Json::arrayValue; out["source_available"]=false;
                    return common::ok(req,out);
                }
                out["versions"]=ctx.contentWorkflowService->listVersions(item["paper_id"].asString());
                const auto version=item.get("submitted_version_id", "").asString(); out["source_available"]=false;
                if (!version.empty()) {
                    try {
                        const auto snapshot=ctx.contentWorkflowService->versionSnapshot(item["paper_id"].asString(),version);
                        const auto sections=snapshot["exam_info"]["sections"]; const auto qid=item["question_id"].asString();
                        for (Json::ArrayIndex index=0;index<sections.size();++index) {
                            const auto append=[&](const Json::Value &questions) { for (const auto &question : questions) { const auto local=question.get("id", "").asString(); if (qid==local || qid==std::to_string(index)+":"+local) { Json::Value row(Json::objectValue); row["section"]=sections[index].get("section_name",sections[index].get("name","")); row["question"]=question; out["source_questions"].append(row); } } };
                            append(sections[index]["questions"]); for (const auto &passage : sections[index]["passages"]) append(passage["questions"]);
                        }
                        out["source_available"]=true;
                    } catch (...) { out["source_available"]=false; }
                }
                return common::ok(req,out);
            });
        },{Get});
    app().registerHandler("/api/v1/me/feedback-results",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                Json::Value out(Json::arrayValue);
                for (const auto &item : ctx.feedbackService->list("", ""))
                    if (item.get("user_id", "").asString() == session["user_id"].asString() && item.get("status", "open").asString() != "open")
                    {
                        Json::Value safe(Json::objectValue);
                        for (const auto *field : {"feedback_id", "paper_id", "question_id", "status", "public_reply", "updated_at"}) safe[field] = item[field];
                        out.append(safe);
                    }
                return common::ok(req, out);
            });
        }, {Get});
    // 提交
    app().registerHandler(
        "/api/v1/feedback",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "question_feedback", userId);

                // 服务端用 session 中的 userId 覆盖前端传入的，避免冒名提交
                Json::Value patched = body;
                patched["user_id"] = userId;
                const auto category=body.get("category", "other").asString();
                const bool accountSupport=category=="account" || category=="payment";
                if (accountSupport) {
                    for (const auto *field : {"paper_id", "exam_id", "question_id"}) patched[field]="";
                    requireBoundedString(body,"description",1,1000);
                } else {
                    requireBoundedString(body,"paper_id",1,120); requireBoundedString(body,"question_id",1,120);
                }
                patched.removeMember("submitted_version_id"); patched.removeMember("submitted_fingerprint");
                if (!accountSupport) try {
                    const auto version=ctx.contentWorkflowService->captureFeedbackVersion(body.get("paper_id", "").asString(),userId);
                    patched["submitted_version_id"]=version["id"]; patched["submitted_fingerprint"]=version.get("fingerprint", "");
                } catch (...) { }
                return common::ok(req, ctx.feedbackService->submit(patched));
            });
        },
        {Post});

    // 列表（管理员）
    app().registerHandler(
        "/api/v1/feedback",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"superAdmin", "contentAdmin"}, "需要内容管理员或超级管理员权限");
                const auto paperId = req->getParameter("paper_id");
                const auto status = req->getParameter("status");
                const auto category = req->getParameter("category");
                const auto query = req->getParameter("q");
                const auto sort = req->getParameter("sort");
                const bool ascending = req->getParameter("order") == "asc";
                int page = 1, pageSize = 100;
                try { page = (std::max)(1, std::stoi(req->getParameter("page"))); } catch (...) { }
                try { pageSize = std::clamp(std::stoi(req->getParameter("page_size")), 1, 100); } catch (...) { }
                std::vector<Json::Value> matches;
                for (const auto &item : ctx.feedbackService->list(paperId, status))
                {
                    if (!category.empty() && item.get("category", "").asString() != category) continue;
                    if (!query.empty())
                    {
                        Json::StreamWriterBuilder writer; writer["indentation"] = ""; writer["emitUTF8"] = true;
                        if (Json::writeString(writer, item).find(query) == std::string::npos) continue;
                    }
                    matches.push_back(item);
                }
                std::stable_sort(matches.begin(), matches.end(), [&](const Json::Value &left, const Json::Value &right) {
                    const auto field = sort == "status" ? "status" : "created_at";
                    const auto a = left.get(field, "").asString(), b = right.get(field, "").asString();
                    return ascending ? a < b : a > b;
                });
                Json::Value out(Json::objectValue);
                out["items"] = Json::arrayValue;
                const auto total = static_cast<int>(matches.size());
                const int begin = (page - 1) * pageSize;
                for (int index = begin; index < total && index < begin + pageSize; ++index) out["items"].append(matches[static_cast<std::size_t>(index)]);
                out["total"] = total; out["page"] = page; out["page_size"] = pageSize;
                out["pages"] = total == 0 ? 0 : (total + pageSize - 1) / pageSize;
                int pendingTotal = 0;
                const auto allFeedback = ctx.feedbackService->list("", "");
                for (const auto &item : allFeedback)
                {
                    const auto itemStatus = item.get("status", "open").asString();
                    if (itemStatus != "resolved" && itemStatus != "closed") ++pendingTotal;
                }
                out["summary"]["pending_total"] = pendingTotal;
                out["summary"]["total"] = static_cast<Json::UInt>(allFeedback.size());
                return common::ok(req, out);
            });
        },
        {Get});

    // 更新（管理员）
    app().registerHandler(
        "/api/v1/feedback/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string feedbackId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireRole(session, {"superAdmin", "contentAdmin"}, "需要内容管理员或超级管理员权限");
                const auto paperId = req->getParameter("paper_id");
                Json::Value patch=body; patch["updated_by"]=session["user_id"]; patch.removeMember("resolved_version_id"); patch.removeMember("resolved_fingerprint");
                if (patch.get("status", "").asString()=="resolved") {
                    auto source=paperId;
                    if (source.empty()) for (const auto &row : ctx.feedbackService->list("","")) if (row.get("feedback_id", "").asString()==feedbackId) { source=row["paper_id"].asString(); break; }
                    try { const auto version=ctx.contentWorkflowService->captureFeedbackVersion(source,session["user_id"].asString()); patch["resolved_version_id"]=version["id"]; patch["resolved_fingerprint"]=version.get("fingerprint", ""); } catch (...) { }
                }
                const auto result = ctx.feedbackService->update(paperId, feedbackId, patch);
                Json::Value details(Json::objectValue);
                details["feedback_id"] = feedbackId;
                details["paper_id"] = paperId;
                details["status"] = body.get("status", "");
                ctx.auditLogService->record(
                    "feedback.status.updated",
                    session.get("user_id", session.get("id", "")).asString(),
                    "更新反馈处理状态",
                    details);
                return common::ok(req, result);
            });
        },
        {Patch});
}
}  // namespace transport::routes
