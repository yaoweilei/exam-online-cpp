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
//                                                    body: { paper_id*, question_id*, exam_id?, category?, description? }
//   GET    /api/v1/feedback?paper_id=&status=        运营/内容查看（需 superAdmin/contentAdmin）
//   PATCH  /api/v1/feedback/{feedbackId}?paper_id=   运营/内容更新 status / admin_note（需 superAdmin/contentAdmin）
// ---------------------------------------------------------------------------
void registerFeedbackRoutes(const AppContext &ctx)
{
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
                        Json::StreamWriterBuilder writer; writer["indentation"] = "";
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
                const auto result = ctx.feedbackService->update(paperId, feedbackId, body);
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
