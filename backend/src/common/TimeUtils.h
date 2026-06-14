#pragma once

#include <chrono>
#include <iomanip>
#include <sstream>
#include <string>

namespace common
{
inline std::string nowIso8601()
{
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto secondsPart = time_point_cast<std::chrono::seconds>(now);
    const auto ms = duration_cast<milliseconds>(now - secondsPart).count();
    const auto timeValue = system_clock::to_time_t(now);

    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &timeValue);
#else
    gmtime_r(&timeValue, &tm);
#endif

    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S")
        << "." << std::setw(3) << std::setfill('0') << ms
        << "Z";
    return oss.str();
}
}  // namespace common
