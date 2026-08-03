#include "RouteUtils.h"

#include <cctype>
#include <fstream>
#include <sstream>

namespace transport::routes
{
Json::Value parseJsonBody(const drogon::HttpRequestPtr &req)
{
    auto json = req->getJsonObject();
    if (!json)
    {
        throw common::AppException("BAD_REQUEST", "Request body must be valid JSON", drogon::k400BadRequest);
    }
    return *json;
}

std::string requireString(const Json::Value &json, const std::string &field)
{
    const auto value = json.get(field, "").asString();
    if (value.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "Missing field: " + field, drogon::k422UnprocessableEntity);
    }
    return value;
}

int readBoundedIntParameter(const drogon::HttpRequestPtr &req,
                            const std::string &name,
                            int defaultValue,
                            int minValue,
                            int maxValue)
{
    const auto raw = req->getParameter(name);
    if (raw.empty())
    {
        return defaultValue;
    }
    try
    {
        std::size_t parsedLength = 0;
        const auto parsed = std::stoll(raw, &parsedLength);
        if (parsedLength != raw.size() || parsed < minValue || parsed > maxValue)
        {
            throw std::out_of_range("query parameter out of range");
        }
        return static_cast<int>(parsed);
    }
    catch (...)
    {
        throw common::AppException(
            "VALIDATION_ERROR",
            "参数 " + name + " 必须是 " + std::to_string(minValue) + " 到 " +
                std::to_string(maxValue) + " 之间的整数",
            drogon::k422UnprocessableEntity);
    }
}

int readBoundedIntField(const Json::Value &json,
                        const std::string &name,
                        int defaultValue,
                        int minValue,
                        int maxValue)
{
    if (!json.isMember(name))
    {
        if (defaultValue < minValue || defaultValue > maxValue)
        {
            throw common::AppException("VALIDATION_ERROR", "缺少字段 " + name,
                                       drogon::k422UnprocessableEntity);
        }
        return defaultValue;
    }
    const auto &value = json[name];
    if ((!value.isInt() && !value.isUInt()) || value.asInt64() < minValue || value.asInt64() > maxValue)
    {
        throw common::AppException(
            "VALIDATION_ERROR",
            "字段 " + name + " 必须是 " + std::to_string(minValue) + " 到 " +
                std::to_string(maxValue) + " 之间的整数",
            drogon::k422UnprocessableEntity);
    }
    return value.asInt();
}

std::string requireBoundedString(const Json::Value &json,
                                 const std::string &name,
                                 std::size_t minLength,
                                 std::size_t maxLength)
{
    if (!json.isMember(name) || !json[name].isString())
    {
        throw common::AppException("VALIDATION_ERROR", "字段 " + name + " 必须是文本",
                                   drogon::k422UnprocessableEntity);
    }
    auto value = json[name].asString();
    const auto first = value.find_first_not_of(" \t\r\n");
    const auto last = value.find_last_not_of(" \t\r\n");
    value = first == std::string::npos ? "" : value.substr(first, last - first + 1);
    std::size_t charCount = 0;
    for (const auto byte : value)
    {
        if ((static_cast<unsigned char>(byte) & 0xC0U) != 0x80U)
        {
            ++charCount;
        }
    }
    if (charCount < minLength || charCount > maxLength)
    {
        throw common::AppException(
            "VALIDATION_ERROR",
            "字段 " + name + " 长度必须是 " + std::to_string(minLength) + " 到 " +
                std::to_string(maxLength) + " 个字符",
            drogon::k422UnprocessableEntity);
    }
    return value;
}

std::string readToken(const drogon::HttpRequestPtr &req, const Json::Value *json)
{
    auto token = req->getParameter("token");
    if (token.empty())
    {
        const auto authorization = req->getHeader("Authorization");
        constexpr std::string_view bearerPrefix = "Bearer ";
        if (authorization.rfind(bearerPrefix, 0) == 0)
        {
            token = authorization.substr(bearerPrefix.size());
        }
    }
    if (token.empty() && json != nullptr)
    {
        token = json->get("token", "").asString();
    }
    if (token == "__cookie_session__")
    {
        token.clear();
    }
    if (token.empty())
    {
        token = req->getCookie("exam_session");
    }
    return token;
}

void addSessionCookie(const drogon::HttpResponsePtr &response,
                      const std::string &token,
                      bool secure)
{
    drogon::Cookie cookie("exam_session", token);
    cookie.setPath("/");
    cookie.setHttpOnly(true);
    cookie.setSecure(secure);
    cookie.setSameSite(drogon::Cookie::SameSite::kLax);
    cookie.setMaxAge(7 * 24 * 60 * 60);
    response->addCookie(std::move(cookie));
}

void clearSessionCookie(const drogon::HttpResponsePtr &response,
                        bool secure)
{
    // Drogon omits cookies whose value is empty, so use a non-empty tombstone
    // together with Max-Age=0 to ensure the browser removes the cookie.
    drogon::Cookie cookie("exam_session", "deleted");
    cookie.setPath("/");
    cookie.setHttpOnly(true);
    cookie.setSecure(secure);
    cookie.setSameSite(drogon::Cookie::SameSite::kLax);
    cookie.setMaxAge(0);
    response->addCookie(std::move(cookie));
}

Json::Value requireSession(application::services::AuthService &authService,
                           const drogon::HttpRequestPtr &req,
                           const Json::Value *json)
{
    const auto token = readToken(req, json);
    if (token.empty())
    {
        throw common::AppException("AUTH_REQUIRED", "请先登录", drogon::k401Unauthorized);
    }
    auto session = authService.verify(token);
    session["token"] = token;
    return session;
}

void requirePasswordReauthentication(application::services::AuthService &authService,
                                     const Json::Value &session,
                                     const Json::Value &body)
{
    if (!body.isObject() || !body.isMember("reauth_password") || !body["reauth_password"].isString())
    {
        throw common::AppException(
            "REAUTH_REQUIRED",
            "该操作需要重新验证当前密码",
            drogon::k422UnprocessableEntity);
    }
    const auto password = body["reauth_password"].asString();
    if (password.size() > 256)
    {
        throw common::AppException(
            "VALIDATION_ERROR",
            "reauth_password must not exceed 256 characters",
            drogon::k422UnprocessableEntity);
    }
    authService.requirePasswordReauthentication(
        session.get("user_id", session.get("id", "")).asString(),
        password);
}

bool hasAnyRole(const Json::Value &roles, std::initializer_list<const char *> expected)
{
    for (const auto &role : roles)
    {
        const auto value = role.asString();
        for (const auto *candidate : expected)
        {
            if (value == candidate)
            {
                return true;
            }
        }
    }
    return false;
}

void requireRole(const Json::Value &session,
                 std::initializer_list<const char *> expected,
                 const std::string &errorMessage)
{
    if (!hasAnyRole(session["roles"], expected))
    {
        throw common::AppException("FORBIDDEN", errorMessage, drogon::k403Forbidden);
    }
}

// 功能开关路由保护：禁用时返回 403 + FEATURE_DISABLED
void requireFeature(application::services::FeatureFlagService &svc,
                    const std::string &flagKey,
                    const std::string &userId,
                    const std::string &errorMessageZh)
{
    if (!svc.isEnabled(flagKey, userId))
    {
        throw common::AppException("FEATURE_DISABLED", errorMessageZh, drogon::k403Forbidden);
    }
}

void requireEntitlement(application::services::SubscriptionService &svc,
                        const std::string &userId,
                        const std::string &entitlementKey,
                        const std::string &errorMessageZh)
{
    svc.requireEntitlement(userId, entitlementKey, errorMessageZh);
}

void applyNoCacheHeaders(const drogon::HttpResponsePtr &response)
{
    response->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "0");
}

bool containsParentTraversal(const std::string &path)
{
    return path.find("..") != std::string::npos;
}

void requireDataOwnerOrAdmin(const Json::Value &session,
                             const std::string &targetUserId,
                             const std::string &errorMessage)
{
    const auto actorUserId = session.get("user_id", session.get("id", "")).asString();
    if (actorUserId == targetUserId || hasAnyRole(session["roles"], {"superAdmin"})) return;
    throw common::AppException("FORBIDDEN", errorMessage, drogon::k403Forbidden);
}

drogon::HttpResponsePtr fileContentResponse(const std::filesystem::path &path,
                                            const std::string &contentType)
{
    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        auto response = drogon::HttpResponse::newHttpResponse();
        response->setStatusCode(drogon::k404NotFound);
        response->setBody("Not found");
        return response;
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    auto response = drogon::HttpResponse::newHttpResponse();
    response->setBody(buffer.str());
    if (!contentType.empty())
    {
        response->setContentTypeString(contentType);
    }
    return response;
}

void handleRequest(const drogon::HttpRequestPtr &req,
                   std::function<void(const drogon::HttpResponsePtr &)> &&callback,
                   const ResponseFactory &factory)
{
    try
    {
        callback(factory());
    }
    catch (const common::AppException &e)
    {
        callback(common::fail(req, e.statusCode(), e.code(), e.message()));
    }
    catch (const std::exception &e)
    {
        callback(common::fail(req, drogon::k500InternalServerError, "INTERNAL_ERROR", e.what()));
    }
    catch (...)
    {
        callback(common::fail(req, drogon::k500InternalServerError, "INTERNAL_ERROR", "Unknown internal error"));
    }
}
}  // namespace transport::routes
