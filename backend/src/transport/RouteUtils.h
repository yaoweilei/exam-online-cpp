#pragma once

#include <functional>
#include <filesystem>
#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>

#include <drogon/HttpRequest.h>
#include <drogon/HttpResponse.h>
#include <json/json.h>

#include "application/services/AuthService.h"
#include "application/services/FeatureFlagService.h"
#include "application/services/SubscriptionService.h"
#include "common/ApiResponse.h"
#include "common/AppException.h"

namespace transport::routes
{
// ---- Request parsing helpers ------------------------------------------------

Json::Value parseJsonBody(const drogon::HttpRequestPtr &req);

std::string requireString(const Json::Value &json, const std::string &field);

int readBoundedIntParameter(const drogon::HttpRequestPtr &req,
                            const std::string &name,
                            int defaultValue,
                            int minValue,
                            int maxValue);

int readBoundedIntField(const Json::Value &json,
                        const std::string &name,
                        int defaultValue,
                        int minValue,
                        int maxValue);

std::string requireBoundedString(const Json::Value &json,
                                 const std::string &name,
                                 std::size_t minLength,
                                 std::size_t maxLength);

std::string readToken(const drogon::HttpRequestPtr &req, const Json::Value *json = nullptr);

void addSessionCookie(const drogon::HttpResponsePtr &response,
                      const std::string &token,
                      bool secure);

void clearSessionCookie(const drogon::HttpResponsePtr &response,
                        bool secure);

Json::Value requireSession(application::services::AuthService &authService,
                           const drogon::HttpRequestPtr &req,
                           const Json::Value *json = nullptr);

void requirePasswordReauthentication(application::services::AuthService &authService,
                                     const Json::Value &session,
                                     const Json::Value &body);

// ---- Authorization helpers --------------------------------------------------

bool hasAnyRole(const Json::Value &roles, std::initializer_list<const char *> expected);

void requireRole(const Json::Value &session,
                 std::initializer_list<const char *> expected,
                 const std::string &errorMessage);

void requireDataOwnerOrAdmin(const Json::Value &session,
                             const std::string &targetUserId,
                             const std::string &errorMessage = "无权访问其他用户的学习数据");

// 功能开关路由护栏：如果 flag 在该 userId 上被禁用，拋出 403 AppException
//   - errorMessageZh: 中文错误提示，默认“该功能已被管理员关闭”
void requireFeature(application::services::FeatureFlagService &svc,
                    const std::string &flagKey,
                    const std::string &userId,
                    const std::string &errorMessageZh = "该功能已被管理员关闭");

// 套餐权益路由护栏：功能开关只控制是否上线，权益决定当前用户能否使用。
void requireEntitlement(application::services::SubscriptionService &svc,
                        const std::string &userId,
                        const std::string &entitlementKey,
                        const std::string &errorMessageZh = "");

// ---- Static asset helpers ---------------------------------------------------

void applyNoCacheHeaders(const drogon::HttpResponsePtr &response);

bool containsParentTraversal(const std::string &path);

drogon::HttpResponsePtr fileContentResponse(const std::filesystem::path &path,
                                            const std::string &contentType = "");

// ---- Generic request handling wrapper --------------------------------------
//
// Wraps a handler lambda that returns an HttpResponsePtr. Catches
// common::AppException and converts it into a JSON failure envelope. This
// removes the try/catch boilerplate from every route registration.

using ResponseFactory = std::function<drogon::HttpResponsePtr()>;

void handleRequest(const drogon::HttpRequestPtr &req,
                   std::function<void(const drogon::HttpResponsePtr &)> &&callback,
                   const ResponseFactory &factory);
}  // namespace transport::routes
