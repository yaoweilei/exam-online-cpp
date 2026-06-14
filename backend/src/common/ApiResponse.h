#pragma once

#include <string>

#include <drogon/HttpResponse.h>
#include <json/json.h>

#include "RequestId.h"
#include "TimeUtils.h"

namespace common
{
inline Json::Value envelope(const std::string &code,
                            const std::string &message,
                            const Json::Value &data,
                            const std::string &requestId)
{
    Json::Value root(Json::objectValue);
    root["code"] = code;
    root["message"] = message;
    root["data"] = data;
    root["request_id"] = requestId;
    root["ts"] = nowIso8601();
    return root;
}

inline drogon::HttpResponsePtr ok(const drogon::HttpRequestPtr &req,
                                  const Json::Value &data = Json::Value(Json::nullValue),
                                  const std::string &message = "ok")
{
    auto response = drogon::HttpResponse::newHttpJsonResponse(
        envelope("OK", message, data, resolveRequestId(req)));
    response->setStatusCode(drogon::k200OK);
    return response;
}

inline drogon::HttpResponsePtr fail(const drogon::HttpRequestPtr &req,
                                    drogon::HttpStatusCode statusCode,
                                    const std::string &code,
                                    const std::string &message,
                                    const Json::Value &data = Json::Value(Json::nullValue))
{
    auto response = drogon::HttpResponse::newHttpJsonResponse(
        envelope(code, message, data, resolveRequestId(req)));
    response->setStatusCode(statusCode);
    return response;
}
}  // namespace common
