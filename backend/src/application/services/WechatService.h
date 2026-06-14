#pragma once

#include <map>
#include <mutex>
#include <string>
#include <vector>

#include <json/json.h>

#include "application/services/AuthService.h"
#include "common/AppException.h"
#include "common/RequestId.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/UserRepository.h"

// WechatService implements the "WeChat Web QR-code login" OAuth2 flow.
//
// Flow:
//   1. Frontend calls GET /api/v1/auth/wechat/qrcode
//      → backend calls WeChat API to get a qrcode_url + state token
//      → frontend renders the QR code and starts polling /api/v1/auth/wechat/poll?state=...
//
//   2. User scans the QR code with WeChat
//      → WeChat redirects to GET /api/v1/auth/wechat/callback?code=...&state=...
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

    explicit WechatService(infrastructure::storage::UserRepository &userRepository,
                           AuthService &authService,
                           Config config)
;

    // Step 1: Generate a QR-code entry.
    // Returns { state, qrcode_url, expires_in }
    Json::Value generateQrcode();

    // Step 2: Called by the OAuth2 callback.
    // Exchanges `code` for openid, upserts user, then stores session token.
    // Returns the internal session token.
    std::string handleCallback(const std::string &code, const std::string &state);

    // Step 3: Frontend polls this to get the session token.
    // Returns { done, token?, user_id?, username?, roles? }
    Json::Value poll(const std::string &state);

  private:
    static const std::vector<std::string> &defaultDevelopmentTestIds();

    // In production this makes an HTTPS call to api.weixin.qq.com.
    // Stubbed out here to avoid introducing an HTTP client dependency.
    Json::Value exchangeCodeForToken(const std::string &code) const;

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
