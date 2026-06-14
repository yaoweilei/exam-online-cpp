#include "RouteUtils.h"

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
    return token;
}

Json::Value requireSession(application::services::AuthService &authService,
                           const drogon::HttpRequestPtr &req,
                           const Json::Value *json)
{
    const auto token = readToken(req, json);
    if (token.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "Missing token parameter", drogon::k422UnprocessableEntity);
    }
    auto session = authService.verify(token);
    session["token"] = token;
    return session;
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
}
}  // namespace transport::routes
