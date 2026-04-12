#include "ApiRouter.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <string>

#include <drogon/HttpAppFramework.h>
#include <drogon/HttpResponse.h>
#include <json/json.h>

#include "common/ApiResponse.h"
#include "common/AppException.h"

using namespace drogon;

namespace
{
Json::Value parseJsonBody(const HttpRequestPtr &req)
{
    auto json = req->getJsonObject();
    if (!json)
    {
        throw common::AppException("BAD_REQUEST", "Request body must be valid JSON", k400BadRequest);
    }
    return *json;
}

std::string requireString(const Json::Value &json, const std::string &field)
{
    const auto value = json.get(field, "").asString();
    if (value.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "Missing field: " + field, k422UnprocessableEntity);
    }
    return value;
}

std::string resolveToken(const HttpRequestPtr &req)
{
    const auto bearer = req->getHeader("Authorization");
    if (!bearer.empty() && bearer.rfind("Bearer ", 0) == 0)
    {
        return bearer.substr(7);
    }
    return req->getParameter("token");
}
}  // namespace

namespace transport
{
void ApiRouter::registerRoutes() const
{
    app().registerHandler(
        "/",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto path = ctx.staticDir / "index.html";
            if (!std::filesystem::exists(path))
            {
                callback(common::fail(req, k404NotFound, "INDEX_NOT_FOUND", "Index file not found"));
                return;
            }
            auto response = HttpResponse::newFileResponse(path.string());
            response->setContentTypeCode(CT_TEXT_HTML);
            callback(response);
        },
        {Get});

    app().registerHandler(
        "/resource/{1:.*}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, const std::string &path) {
            const auto fullPath = ctx.staticDir / "resource" / path;
            if (!std::filesystem::exists(fullPath))
            {
                callback(common::fail(req, k404NotFound, "RESOURCE_NOT_FOUND", "Resource not found"));
                return;
            }
            callback(HttpResponse::newFileResponse(fullPath.string()));
        },
        {Get});

    app().registerHandler(
        "/healthz",
        [](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            Json::Value out(Json::objectValue);
            out["status"] = "ok";
            out["service"] = "exam-online-cpp";
            callback(common::ok(req, out));
        },
        {Get});

    app().registerHandler(
        "/api/v2/health",
        [](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            Json::Value out(Json::objectValue);
            out["status"] = "ok";
            out["service"] = "exam-online-cpp";
            callback(common::ok(req, out));
        },
        {Get});

    app().registerHandler(
        "/api/v2/exams",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto level = req->getParameter("level");
                const auto year = req->getParameter("year");
                const auto sort = req->getParameter("sort").empty() ? "date_desc" : req->getParameter("sort");
                callback(common::ok(req, ctx.examService->listExams(level, year, sort)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/exams/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId) {
            try
            {
                // Pass user_id for subscription check; defaults to "guest"
                const auto userId = req->getParameter("user_id").empty() ? "guest" : req->getParameter("user_id");
                callback(common::ok(req, ctx.examService->getExam(examId, userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/exams",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                auto json = parseJsonBody(req);
                const auto examId = json.get("id", "").asString().empty()
                                        ? ("exam_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count()))
                                        : json.get("id", "").asString();
                ctx.examService->createOrUpdateExam(examId, json);
                Json::Value out(Json::objectValue);
                out["id"] = examId;
                callback(common::ok(req, out, "exam_saved"));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/exams/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string examId) {
            try
            {
                ctx.examService->deleteExam(examId);
                callback(common::ok(req, Json::Value(Json::objectValue), "exam_deleted"));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Delete});

    app().registerHandler(
        "/api/v2/answers/submit",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto userId = body.get("user_id", "guest").asString();
                const auto examId = requireString(body, "exam_id");
                const auto answers = body.get("answers", Json::Value(Json::objectValue));
                const auto exam = ctx.examService->getExam(examId);
                const auto score = ctx.answerService->calculateScore(examId, answers, exam);
                ctx.answerService->save(userId, examId, answers, score);
                callback(common::ok(req, score));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/answers/{1}/{2}",
        [ctx = context_](const HttpRequestPtr &req,
                         std::function<void(const HttpResponsePtr &)> &&callback,
                         std::string userId,
                         std::string examId) {
            try
            {
                Json::Value out(Json::objectValue);
                out["answers"] = ctx.answerService->load(userId, examId);
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/progress/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.answerService->progress(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/progress/{1}/exams",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.answerService->examProgress(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/auth/login",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto username = requireString(body, "username");
                const auto password = requireString(body, "password");
                callback(common::ok(req, ctx.authService->login(username, password)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/auth/register",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto username = requireString(body, "username");
                const auto password = requireString(body, "password");
                const auto email = body.get("email", "").asString();
                callback(common::ok(req, ctx.authService->registerUser(username, password, email)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/auth/logout",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto token = requireString(body, "token");
                Json::Value out(Json::objectValue);
                out["success"] = ctx.authService->logout(token);
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/auth/verify",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto token = resolveToken(req);
                if (token.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing token parameter", k422UnprocessableEntity);
                }
                callback(common::ok(req, ctx.authService->verify(token)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/me",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto token = resolveToken(req);
                if (token.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing token parameter", k422UnprocessableEntity);
                }
                const auto session = ctx.authService->verify(token);
                callback(common::ok(req, ctx.userService->getUser(session.get("user_id", "").asString())));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/me/context",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto token = resolveToken(req);
                if (token.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing token parameter", k422UnprocessableEntity);
                }
                const auto session = ctx.authService->verify(token);
                Json::Value out = ctx.userService->context(session.get("user_id", "").asString());
                out["session"] = session;
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/statistics/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.statisticsService->userStatistics(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/statistics/{1}/weak-points",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.statisticsService->weakPoints(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/statistics/{1}/learning-curve",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto daysParam = req->getParameter("days");
                const int days = daysParam.empty() ? 30 : (std::max)(1, std::stoi(daysParam));
                callback(common::ok(req, ctx.statisticsService->learningCurve(userId, days)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/recommendations/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto limitParam = req->getParameter("limit");
                const int limit = limitParam.empty() ? 5 : (std::max)(1, std::stoi(limitParam));
                callback(common::ok(req, ctx.recommendationStrategy->recommend(userId, limit)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/statistics/{1}/recommendations",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto limitParam = req->getParameter("limit");
                const int limit = limitParam.empty() ? 5 : (std::max)(1, std::stoi(limitParam));
                callback(common::ok(req, ctx.recommendationStrategy->recommend(userId, limit)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.userService->getUser(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/by-role/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string roleId) {
            try
            {
                callback(common::ok(req, ctx.userService->usersByRole(roleId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/{1}/permissions",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.userService->permissions(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/roles",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                callback(common::ok(req, ctx.userService->allRoles()));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/furigana/add",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto text = requireString(body, "text");
                Json::Value out(Json::objectValue);
                out["result"] = ctx.furiganaService->annotate(text);
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/furigana/reading/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string word) {
            try
            {
                Json::Value out(Json::objectValue);
                out["word"] = word;
                out["reading"] = ctx.furiganaService->reading(word);
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    // -------------------------------------------------------------------------
    // Profile
    // -------------------------------------------------------------------------

    app().registerHandler(
        "/api/v2/profile/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.profileService->getProfile(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/profile/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto body = parseJsonBody(req);
                callback(common::ok(req, ctx.profileService->updateProfile(userId, body)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Put});

    // -------------------------------------------------------------------------
    // Bookmarks
    // -------------------------------------------------------------------------

    app().registerHandler(
        "/api/v2/bookmarks/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                callback(common::ok(req, ctx.bookmarkService->getBookmarks(userId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/bookmarks/{1}/exams",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto examId = requireString(body, "exam_id");
                callback(common::ok(req, ctx.bookmarkService->addExamBookmark(userId, examId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/bookmarks/{1}/exams/{2}",
        [ctx = context_](const HttpRequestPtr &req,
                         std::function<void(const HttpResponsePtr &)> &&callback,
                         std::string userId,
                         std::string examId) {
            try
            {
                callback(common::ok(req, ctx.bookmarkService->removeExamBookmark(userId, examId)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Delete});

    // -------------------------------------------------------------------------
    // Subscription
    // -------------------------------------------------------------------------

    app().registerHandler(
        "/api/v2/subscription/{1}",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                Json::Value out = ctx.subscriptionService->currentSubscription(userId);
                out["user_id"] = userId;
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/subscription/{1}/grant",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback, std::string userId) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto expiresAt = body.get("expires_at", "").asString();
                const auto plan = body.get("plan", "pro").asString();
                const auto status = body.get("status", "active").asString();
                Json::Value out = ctx.subscriptionService->grantSubscription(userId, plan, expiresAt, status);
                out["user_id"] = userId;
                callback(common::ok(req, out));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    // -------------------------------------------------------------------------
    // Phone binding
    // -------------------------------------------------------------------------

    app().registerHandler(
        "/api/v2/auth/phone/send-code",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto phone = requireString(body, "phone");
                ctx.phoneService->sendVerificationCode(phone);
                Json::Value out(Json::objectValue);
                out["phone"] = phone;
                callback(common::ok(req, out, "code_sent"));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    app().registerHandler(
        "/api/v2/auth/phone/verify",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto body = parseJsonBody(req);
                const auto userId = requireString(body, "user_id");
                const auto phone = requireString(body, "phone");
                const auto code = requireString(body, "code");
                callback(common::ok(req, ctx.phoneService->verifyAndBind(userId, phone, code)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Post});

    // -------------------------------------------------------------------------
    // WeChat login
    // -------------------------------------------------------------------------

    app().registerHandler(
        "/api/v2/auth/wechat/qrcode",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                callback(common::ok(req, ctx.wechatService->generateQrcode()));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/auth/wechat/callback",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto code = req->getParameter("code");
                const auto state = req->getParameter("state");
                if (code.empty() || state.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing code or state", k422UnprocessableEntity);
                }
                ctx.wechatService->handleCallback(code, state);
                // Return a simple HTML page that tells the user to return to the app
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k200OK);
                resp->setContentTypeCode(CT_TEXT_HTML);
                resp->setBody("<html><body><script>window.close();</script><p>Login successful. You may close this window.</p></body></html>");
                callback(resp);
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});

    app().registerHandler(
        "/api/v2/auth/wechat/poll",
        [ctx = context_](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            try
            {
                const auto state = req->getParameter("state");
                if (state.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing state parameter", k422UnprocessableEntity);
                }
                callback(common::ok(req, ctx.wechatService->poll(state)));
            }
            catch (const common::AppException &e)
            {
                callback(common::fail(req, e.statusCode(), e.code(), e.message()));
            }
        },
        {Get});
}
}  // namespace transport
