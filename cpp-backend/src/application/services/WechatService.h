#pragma once

#include <map>
#include <mutex>
#include <string>

#include <json/json.h>

#include "common/AppException.h"
#include "common/RequestId.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/UserRepository.h"
#include "AuthService.h"

// WechatService implements the "WeChat Web QR-code login" OAuth2 flow.
//
// Flow:
//   1. Frontend calls GET /api/v2/auth/wechat/qrcode
//      → backend calls WeChat API to get a qrcode_url + state token
//      → frontend renders the QR code and starts polling /api/v2/auth/wechat/poll?state=...
//
//   2. User scans the QR code with WeChat
//      → WeChat redirects to GET /api/v2/auth/wechat/callback?code=...&state=...
//      → backend exchanges code for openid, upserts user, stores result under state
//
//   3. Frontend polling returns the session token once the callback has been processed.
//
// In development (appId is empty), a stub flow is available:
//   - /qrcode returns a fake url with a test state
//   - /callback with state=test_xxx creates a test user directly

namespace application::services
{
class WechatService
{
  public:
    struct Config
    {
        std::string appId;
        std::string appSecret;
        std::string callbackBaseUrl;  // e.g. "https://example.com"
    };

    explicit WechatService(
        infrastructure::storage::UserRepository &userRepository,
        AuthService &authService,
        Config config)
        : userRepository_(userRepository), authService_(authService), config_(std::move(config))
    {
    }

    // Step 1: Generate a QR-code entry.
    // Returns { state, qrcode_url, expires_in }
    Json::Value generateQrcode()
    {
        const auto state = common::generateRequestId();

        Json::Value out(Json::objectValue);
        out["state"] = state;
        out["expires_in"] = 300;

        if (config_.appId.empty())
        {
            // Development stub: return a fake QR code URL
            out["qrcode_url"] = "https://stub.wechat.example/qrcode?state=" + state;
            out["stub"] = true;
        }
        else
        {
            const auto callbackUrl = config_.callbackBaseUrl + "/api/v2/auth/wechat/callback";
            out["qrcode_url"] = "https://open.weixin.qq.com/connect/qrconnect"
                                "?appid=" + config_.appId +
                                "&redirect_uri=" + callbackUrl +
                                "&response_type=code"
                                "&scope=snsapi_login"
                                "&state=" + state + "#wechat_redirect";
        }

        std::unique_lock lock(mutex_);
        pendingStates_[state] = PendingAuth{.state = state};
        return out;
    }

    // Step 2: Called by the OAuth2 callback.
    // Exchanges `code` for openid, upserts user, then stores session token.
    // Returns the internal session token.
    std::string handleCallback(const std::string &code, const std::string &state)
    {
        std::string openid;
        std::string nickname;
        std::string avatarUrl;

        if (config_.appId.empty())
        {
            // Stub: use the code itself as a fake openid
            openid = "stub_openid_" + code;
            nickname = "TestUser";
        }
        else
        {
            auto tokenResp = exchangeCodeForToken(code);
            openid = tokenResp.get("openid", "").asString();
            if (openid.empty())
            {
                throw common::AppException("WECHAT_AUTH_FAILED", "Failed to get openid from WeChat", drogon::k502BadGateway);
            }
            nickname = tokenResp.get("nickname", "").asString();
            avatarUrl = tokenResp.get("headimgurl", "").asString();
        }

        const auto user = userRepository_.upsertWechatUser(openid, nickname, avatarUrl);
        const auto sessionToken = authService_.createSessionForUser(user);

        std::unique_lock lock(mutex_);
        auto it = pendingStates_.find(state);
        if (it != pendingStates_.end())
        {
            it->second.sessionToken = sessionToken;
            it->second.userId = user.get("id", "").asString();
            it->second.username = user.get("username", "").asString();
            it->second.roles = user["roles"];
            it->second.done = true;
        }
        return sessionToken;
    }

    // Step 3: Frontend polls this to get the session token.
    // Returns { done, token?, user_id?, username?, roles? }
    Json::Value poll(const std::string &state)
    {
        std::unique_lock lock(mutex_);
        auto it = pendingStates_.find(state);
        if (it == pendingStates_.end())
        {
            throw common::AppException("WECHAT_STATE_NOT_FOUND", "Invalid or expired state", drogon::k400BadRequest);
        }

        Json::Value out(Json::objectValue);
        out["done"] = it->second.done;
        if (it->second.done)
        {
            out["token"] = it->second.sessionToken;
            out["user_id"] = it->second.userId;
            out["username"] = it->second.username;
            out["roles"] = it->second.roles;
            pendingStates_.erase(it);
        }
        return out;
    }

  private:
    // In production this makes an HTTPS call to api.weixin.qq.com.
    // Stubbed out here to avoid introducing an HTTP client dependency.
    Json::Value exchangeCodeForToken(const std::string & /*code*/) const
    {
        // TODO: replace with actual HTTPS call:
        // GET https://api.weixin.qq.com/sns/oauth2/access_token
        //     ?appid=APPID&secret=SECRET&code=CODE&grant_type=authorization_code
        throw common::AppException(
            "WECHAT_NOT_CONFIGURED",
            "WeChat appId/appSecret not configured. Set WECHAT_APP_ID and WECHAT_APP_SECRET env vars.",
            drogon::k503ServiceUnavailable);
    }

    struct PendingAuth
    {
        std::string state;
        std::string sessionToken;
        std::string userId;
        std::string username;
        Json::Value roles{Json::arrayValue};
        bool done{false};
    };

    infrastructure::storage::UserRepository &userRepository_;
    AuthService &authService_;
    Config config_;
    std::map<std::string, PendingAuth> pendingStates_;
    std::mutex mutex_;
};
}  // namespace application::services
