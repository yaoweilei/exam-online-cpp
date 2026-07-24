#pragma once

// 业务功能 22：第三方 OAuth Service
//   - Google 使用真实 OpenID Connect：授权 code -> access_token -> userinfo
//   - mock 仅保留为测试钩子，生产 provider 不启用 mock
//   - 用户落地：复用 UserRepository::upsertWechatUser(openid="{provider}:{sub}", nickname, avatar)
//   - 颁发本应用 session 由路由调用 AuthService::createSessionForUser 完成

#include <mutex>
#include <string>
#include <unordered_map>

#include <json/json.h>

namespace infrastructure::storage
{
class UserRepository;
}  // namespace infrastructure::storage

namespace application::services
{
struct OAuthClientConfig
{
    std::string clientId;
    std::string clientSecret;
    std::string redirectUri;
    std::string authUrl;
    std::string tokenUrl;
    std::string userinfoUrl;
    bool mock{true};
};

struct OAuthLoginResult
{
    Json::Value user;
    bool created{false};
};

class OAuthService
{
  public:
    OAuthService(infrastructure::storage::UserRepository &userRepo,
                 std::unordered_map<std::string, OAuthClientConfig> providers);

    bool isProviderEnabled(const std::string &provider) const;
    // 返回授权页 URL（mock 模式下直接返回 callback URL 模板）
    std::string buildAuthorizationUrl(const std::string &provider, const std::string &state) const;

    // 由 callback 路由调用：完成 code→user 的转换并 upsert 到本地用户表
    OAuthLoginResult handleCallback(const std::string &provider,
                                    const std::string &code,
                                    const std::string &state,
                                    const std::string &mockEmail,
                                    const std::string &mockSub,
                                    const std::string &mockName);

    // 颁发 / 校验 state（防 CSRF；TTL 10 分钟，单次使用）
    std::string issueState(const std::string &provider);
    bool consumeState(const std::string &provider, const std::string &state);

  private:
    OAuthClientConfig requireProvider(const std::string &provider) const;

    infrastructure::storage::UserRepository &userRepo_;
    std::unordered_map<std::string, OAuthClientConfig> providers_;
    std::mutex stateMutex_;
    // state → {provider, issuedAtEpoch}
    std::unordered_map<std::string, std::pair<std::string, long long>> states_;
};
}  // namespace application::services
