#include "application/services/OAuthService.h"

#include <chrono>
#include <sstream>

#include <drogon/HttpClient.h>
#include <drogon/utils/Utilities.h>

#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
namespace
{
long long nowEpoch()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string urlEncode(const std::string &s)
{
    return drogon::utils::urlEncode(s);
}

Json::Value parseJsonBody(const drogon::HttpResponsePtr &response)
{
    Json::Value root(Json::nullValue);
    if (!response)
    {
        return root;
    }
    Json::CharReaderBuilder builder;
    std::string errors;
    std::istringstream input(std::string(response->getBody()));
    Json::parseFromStream(builder, input, &root, &errors);
    return root;
}

std::string responseText(const drogon::HttpResponsePtr &response)
{
    return response ? std::string(response->getBody()) : std::string();
}

struct ParsedUrl
{
    std::string origin;
    std::string path;
};

ParsedUrl parseHttpsUrl(const std::string &url)
{
    const std::string prefix = "https://";
    if (url.rfind(prefix, 0) != 0)
    {
        throw common::AppException("OAUTH_CONFIG_INVALID",
                                    "OAuth endpoint must use https: " + url,
                                    drogon::k500InternalServerError);
    }
    const auto pathStart = url.find('/', prefix.size());
    if (pathStart == std::string::npos)
    {
        return ParsedUrl{url, "/"};
    }
    return ParsedUrl{url.substr(0, pathStart), url.substr(pathStart)};
}

Json::Value exchangeGoogleCode(const OAuthClientConfig &cfg, const std::string &code)
{
    if (cfg.clientId.empty() || cfg.clientSecret.empty() || cfg.redirectUri.empty() ||
        cfg.tokenUrl.empty() || cfg.userinfoUrl.empty())
    {
        throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                    "Google OAuth provider is not fully configured.",
                                    drogon::k503ServiceUnavailable);
    }

    const auto tokenUrl = parseHttpsUrl(cfg.tokenUrl);
    auto tokenClient = drogon::HttpClient::newHttpClient(tokenUrl.origin);
    auto tokenRequest = drogon::HttpRequest::newHttpRequest();
    tokenRequest->setMethod(drogon::Post);
    tokenRequest->setPath(tokenUrl.path);
    tokenRequest->setContentTypeString("application/x-www-form-urlencoded");
    tokenRequest->setBody(
        "code=" + urlEncode(code) +
        "&client_id=" + urlEncode(cfg.clientId) +
        "&client_secret=" + urlEncode(cfg.clientSecret) +
        "&redirect_uri=" + urlEncode(cfg.redirectUri) +
        "&grant_type=authorization_code");

    const auto [tokenResult, tokenResponse] = tokenClient->sendRequest(tokenRequest);
    if (tokenResult != drogon::ReqResult::Ok || !tokenResponse)
    {
        throw common::AppException("OAUTH_TOKEN_FAILED",
                                    "Failed to request Google access_token",
                                    drogon::k502BadGateway);
    }
    const auto tokenPayload = parseJsonBody(tokenResponse);
    if (tokenResponse->statusCode() < drogon::k200OK ||
        tokenResponse->statusCode() >= drogon::k300MultipleChoices)
    {
        const auto message = tokenPayload.get("error_description",
                                              tokenPayload.get("error", responseText(tokenResponse)).asString())
                                 .asString();
        throw common::AppException("OAUTH_TOKEN_FAILED",
                                    "Google access_token error: " + message,
                                    drogon::k502BadGateway);
    }

    const auto accessToken = tokenPayload.get("access_token", "").asString();
    if (accessToken.empty())
    {
        throw common::AppException("OAUTH_TOKEN_FAILED",
                                    "Google response did not include access_token",
                                    drogon::k502BadGateway);
    }

    const auto userinfoUrl = parseHttpsUrl(cfg.userinfoUrl);
    auto userClient = drogon::HttpClient::newHttpClient(userinfoUrl.origin);
    auto userRequest = drogon::HttpRequest::newHttpRequest();
    userRequest->setMethod(drogon::Get);
    userRequest->setPath(userinfoUrl.path);
    userRequest->addHeader("Authorization", "Bearer " + accessToken);

    const auto [userResult, userResponse] = userClient->sendRequest(userRequest);
    if (userResult != drogon::ReqResult::Ok || !userResponse)
    {
        throw common::AppException("OAUTH_USERINFO_FAILED",
                                    "Failed to request Google userinfo",
                                    drogon::k502BadGateway);
    }
    const auto userPayload = parseJsonBody(userResponse);
    if (userResponse->statusCode() < drogon::k200OK ||
        userResponse->statusCode() >= drogon::k300MultipleChoices)
    {
        const auto message = userPayload.get("error_description",
                                             userPayload.get("error", responseText(userResponse)).asString())
                                 .asString();
        throw common::AppException("OAUTH_USERINFO_FAILED",
                                    "Google userinfo error: " + message,
                                    drogon::k502BadGateway);
    }

    return userPayload;
}
}  // namespace

OAuthService::OAuthService(infrastructure::storage::UserRepository &userRepo,
                           std::unordered_map<std::string, OAuthClientConfig> providers)
    : userRepo_(userRepo), providers_(std::move(providers))
{
}

bool OAuthService::isProviderEnabled(const std::string &provider) const
{
    auto it = providers_.find(provider);
    if (it == providers_.end()) return false;
    // mock 模式仅用于测试，不需要真实 client 配置。
    if (it->second.mock) return true;
    return !it->second.clientId.empty() && !it->second.clientSecret.empty() &&
           !it->second.redirectUri.empty() && !it->second.authUrl.empty() &&
           !it->second.tokenUrl.empty() && !it->second.userinfoUrl.empty();
}

OAuthClientConfig OAuthService::requireProvider(const std::string &provider) const
{
    auto it = providers_.find(provider);
    if (it == providers_.end())
        throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                    "未配置的 OAuth 提供方：" + provider,
                                    drogon::k503ServiceUnavailable);
    return it->second;
}

std::string OAuthService::issueState(const std::string &provider)
{
    const auto state = common::generateOpaqueId("st_");
    std::lock_guard<std::mutex> lk(stateMutex_);
    states_[state] = {provider, nowEpoch()};
    // 顺手清理过期 state（>10 分钟）
    const auto cutoff = nowEpoch() - 600;
    for (auto it = states_.begin(); it != states_.end();)
    {
        if (it->second.second < cutoff)
            it = states_.erase(it);
        else
            ++it;
    }
    return state;
}

bool OAuthService::consumeState(const std::string &provider, const std::string &state)
{
    if (state.empty()) return false;
    std::lock_guard<std::mutex> lk(stateMutex_);
    auto it = states_.find(state);
    if (it == states_.end()) return false;
    if (it->second.first != provider) return false;
    if (nowEpoch() - it->second.second > 600) { states_.erase(it); return false; }
    states_.erase(it);
    return true;
}

std::string OAuthService::buildAuthorizationUrl(const std::string &provider, const std::string &state) const
{
    const auto cfg = requireProvider(provider);
    if (cfg.mock)
    {
        // mock 模式下直接给一个 callback URL，前端可在浏览器手动调用
        return "/api/v1/auth/oauth/" + provider + "/callback?state=" + urlEncode(state) +
               "&mock_sub=mock-user-001&mock_email=mock-" + provider + "@example.com&mock_name=" +
               urlEncode("Mock " + provider);
    }
    if (cfg.authUrl.empty() || cfg.clientId.empty() || cfg.redirectUri.empty())
        throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                    "OAuth 提供方未完整配置：" + provider,
                                    drogon::k503ServiceUnavailable);
    std::string scope = (provider == "google") ? "openid%20email%20profile" : "name%20email";
    return cfg.authUrl + "?response_type=code&client_id=" + urlEncode(cfg.clientId) +
           "&redirect_uri=" + urlEncode(cfg.redirectUri) + "&scope=" + scope +
           "&state=" + urlEncode(state) +
           (provider == "google" ? "&prompt=select_account" : "");
}

OAuthLoginResult OAuthService::handleCallback(const std::string &provider,
                                              const std::string &code,
                                              const std::string &state,
                                              const std::string &mockEmail,
                                              const std::string &mockSub,
                                              const std::string &mockName)
{
    const auto cfg = requireProvider(provider);
    if (!consumeState(provider, state))
        throw common::AppException("OAUTH_STATE_INVALID",
                                    "OAuth state 无效或已过期",
                                    drogon::k400BadRequest);

    std::string sub;
    std::string email;
    std::string name;
    std::string avatar;

    if (cfg.mock)
    {
        sub = mockSub.empty() ? std::string("mock-") + provider + "-" + common::generateOpaqueId("") : mockSub;
        email = mockEmail.empty() ? (sub + "@example.com") : mockEmail;
        name = mockName.empty() ? (provider + " 用户") : mockName;
    }
    else
    {
        if (code.empty())
            throw common::AppException("OAUTH_CODE_REQUIRED",
                                        "OAuth callback 缺少授权 code",
                                        drogon::k400BadRequest);
        if (provider != "google")
        {
            throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                        "未启用的 OAuth 提供方：" + provider,
                                        drogon::k503ServiceUnavailable);
        }

        const auto profile = exchangeGoogleCode(cfg, code);
        sub = profile.get("sub", "").asString();
        email = profile.get("email", "").asString();
        name = profile.get("name", "").asString();
        avatar = profile.get("picture", "").asString();
        if (sub.empty())
        {
            throw common::AppException("OAUTH_USERINFO_INVALID",
                                        "Google userinfo response did not include sub",
                                        drogon::k502BadGateway);
        }
        if (name.empty())
        {
            name = email.empty() ? "Google 用户" : email;
        }
    }

    const std::string openid = provider + ":" + sub;
    auto user = userRepo_.upsertWechatUser(openid, name, avatar, email);
    OAuthLoginResult result;
    result.user = user;
    // upsertWechatUser 内部会处理新建/已存在；这里粗略以是否包含 created_at 来判断
    result.created = user.get("created_via_oauth", false).asBool();
    return result;
}
}  // namespace application::services
