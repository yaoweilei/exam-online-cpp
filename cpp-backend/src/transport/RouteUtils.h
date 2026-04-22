#pragma once

#include <functional>
#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>

#include <drogon/HttpRequest.h>
#include <drogon/HttpResponse.h>
#include <json/json.h>

#include "application/services/AuthService.h"
#include "common/ApiResponse.h"
#include "common/AppException.h"

namespace transport::routes
{
// ---- Request parsing helpers ------------------------------------------------

Json::Value parseJsonBody(const drogon::HttpRequestPtr &req);

std::string requireString(const Json::Value &json, const std::string &field);

std::string readToken(const drogon::HttpRequestPtr &req, const Json::Value *json = nullptr);

Json::Value requireSession(application::services::AuthService &authService,
                           const drogon::HttpRequestPtr &req,
                           const Json::Value *json = nullptr);

// ---- Authorization helpers --------------------------------------------------

bool hasAnyRole(const Json::Value &roles, std::initializer_list<const char *> expected);

void requireRole(const Json::Value &session,
                 std::initializer_list<const char *> expected,
                 const std::string &errorMessage);

// ---- Static asset helpers ---------------------------------------------------

void applyNoCacheHeaders(const drogon::HttpResponsePtr &response);

bool containsParentTraversal(const std::string &path);

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
