#include <string>
#include <vector>

#include <drogon/HttpAppFramework.h>

#include "application/services/WrongQuestionService.h"
#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 错题本相关路由
//   GET    /api/v1/wrong-questions/{userId}                  错题列表（含筛选/分页/统计）
//   GET    /api/v1/wrong-questions/{userId}/summary          仅返回统计摘要（个人中心徽标）
//   POST   /api/v1/wrong-questions/{userId}/sample           随机抽取若干道未掌握的错题用于复习
//   DELETE /api/v1/wrong-questions/{userId}/{questionId}     从错题本移除单题
//   POST   /api/v1/wrong-questions/{userId}/{questionId}/master    标记已掌握
//   POST   /api/v1/wrong-questions/{userId}/{questionId}/unmaster  取消已掌握
//   POST   /api/v1/wrong-questions/{userId}/reset            清空整份错题本
// ---------------------------------------------------------------------------
void registerWrongQuestionRoutes(const AppContext &ctx)
{
    // GET 列表：支持 query 参数 exam_id / type / status / sort / min_wrong / page / page_size
    app().registerHandler(
        "/api/v1/wrong-questions/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                application::services::WrongQuestionService::ListFilter filter;
                filter.examId = req->getParameter("exam_id");
                filter.questionType = req->getParameter("type");
                filter.status = req->getParameter("status");
                filter.sort = req->getParameter("sort");
                const auto minWrong = req->getParameter("min_wrong");
                if (!minWrong.empty())
                {
                    try
                    {
                        filter.minWrongCount = std::stoi(minWrong);
                    }
                    catch (...)
                    {
                        // 参数非法忽略，等同 0
                    }
                }
                const auto pageStr = req->getParameter("page");
                if (!pageStr.empty())
                {
                    try { filter.page = std::stoi(pageStr); } catch (...) {}
                }
                const auto pageSizeStr = req->getParameter("page_size");
                if (!pageSizeStr.empty())
                {
                    try { filter.pageSize = std::stoi(pageSizeStr); } catch (...) {}
                }
                return common::ok(req, ctx.wrongQuestionService->list(userId, filter));
            });
        },
        {Get});

    // 统计摘要
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/summary",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                return common::ok(req, ctx.wrongQuestionService->summary(userId));
            });
        },
        {Get});

    // 随机抽样复习
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/sample",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                int count = 10;
                const auto body = parseJsonBody(req);
                if (body.isMember("count") && body["count"].isIntegral())
                {
                    count = body["count"].asInt();
                }
                return common::ok(req, ctx.wrongQuestionService->sample(userId, count));
            });
        },
        {Post});

    // 从错题本移除单题
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string questionId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                Json::Value out(Json::objectValue);
                out["removed"] = ctx.wrongQuestionService->removeOne(userId, questionId);
                return common::ok(req, out);
            });
        },
        {Delete});

    // 标记已掌握
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/{2}/master",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string questionId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                Json::Value out(Json::objectValue);
                out["mastered"] = ctx.wrongQuestionService->markMastered(userId, questionId);
                return common::ok(req, out);
            });
        },
        {Post});

    // 取消已掌握
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/{2}/unmaster",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string questionId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                Json::Value out(Json::objectValue);
                out["unmastered"] = ctx.wrongQuestionService->unmarkMastered(userId, questionId);
                return common::ok(req, out);
            });
        },
        {Post});

    // 清空错题本
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/reset",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                ctx.wrongQuestionService->reset(userId);
                Json::Value out(Json::objectValue);
                out["ok"] = true;
                return common::ok(req, out);
            });
        },
        {Post});

    // 错因归因标签：预设标签列表（前端渲染按钮/图例用）
    //   GET  /api/v1/wrong-questions/tag-registry
    app().registerHandler(
        "/api/v1/wrong-questions/tag-registry",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                Json::Value out(Json::objectValue);
                out["tags"] = application::services::WrongQuestionService::attributionTagRegistry();
                return common::ok(req, out);
            });
        },
        {Get});

    // 错因归因标签：为单题覆盖式设置标签
    //   PUT  /api/v1/wrong-questions/{userId}/{questionId}/tags   body: { "tags": ["careless", ...] }
    app().registerHandler(
        "/api/v1/wrong-questions/{1}/{2}/tags",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string questionId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                requireSession(*ctx.authService, req, &body);
                requireFeature(*ctx.featureFlagService, "wrong_questions", userId);
                std::vector<std::string> tags;
                if (body.isMember("tags") && body["tags"].isArray())
                {
                    for (const auto &t : body["tags"])
                    {
                        if (t.isString())
                        {
                            tags.push_back(t.asString());
                        }
                    }
                }
                const auto ok = ctx.wrongQuestionService->setAttributionTags(userId, questionId, tags);
                Json::Value out(Json::objectValue);
                out["updated"] = ok;
                return common::ok(req, out);
            });
        },
        {Put});
}
}  // namespace transport::routes
