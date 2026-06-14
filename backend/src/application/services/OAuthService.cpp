#include "application/services/OAuthService.h"

#include <chrono>

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
    // mock 模式不需要 clientId 也算可用
    if (it->second.mock) return true;
    return !it->second.clientId.empty() && !it->second.redirectUri.empty();
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
    if (cfg.authUrl.empty() || cfg.clientId.empty())
        throw common::AppException("OAUTH_PROVIDER_DISABLED",
                                    "OAuth 提供方未完整配置：" + provider,
                                    drogon::k503ServiceUnavailable);
    std::string scope = (provider == "google") ? "openid%20email%20profile" : "name%20email";
    return cfg.authUrl + "?response_type=code&client_id=" + urlEncode(cfg.clientId) +
           "&redirect_uri=" + urlEncode(cfg.redirectUri) + "&scope=" + scope +
           "&state=" + urlEncode(state);
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
        // 真实 OAuth 实现：用 code 换 access_token 再拉 userinfo
        // 当前后端尚未集成出站 HTTP 客户端，此处直接 503 提示
        if (code.empty())
            throw common::AppException("OAUTH_NOT_IMPLEMENTED",
                                        "真实 OAuth 客户端尚未实现，请使用 mock 模式",
                                        drogon::k501NotImplemented);
        throw common::AppException("OAUTH_NOT_IMPLEMENTED",
                                    "真实 OAuth 客户端尚未实现",
                                    drogon::k501NotImplemented);
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
