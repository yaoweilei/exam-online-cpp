#pragma once

#include <atomic>
#include <chrono>
#include <sstream>
#include <string>

#include <drogon/HttpRequest.h>

namespace common
{
inline std::string generateRequestId()
{
    static std::atomic<uint64_t> seq{0};
    const auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
    const auto n = seq.fetch_add(1, std::memory_order_relaxed);
    std::ostringstream oss;
    oss << "req_" << now << "_" << n;
    return oss.str();
}

inline std::string resolveRequestId(const drogon::HttpRequestPtr &req)
{
    const auto externalId = req->getHeader("x-request-id");
    if (!externalId.empty())
    {
        return externalId;
    }
    return generateRequestId();
}
}  // namespace common
