#include "application/services/SyncService.h"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <sstream>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
std::string sanitize(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
            out.push_back(c);
        else
            out.push_back('_');
    }
    return out;
}

// 把 file_time 转成 UTC ISO8601 字符串
std::string fileTimeToIso(std::filesystem::file_time_type ft)
{
    using namespace std::chrono;
    // C++20 file_clock → system_clock；为兼容此项目编译器，用近似法
    const auto sctp = time_point_cast<system_clock::duration>(ft - decltype(ft)::clock::now() + system_clock::now());
    const std::time_t tt = system_clock::to_time_t(sctp);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &tt);
#else
    gmtime_r(&tt, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}
}  // namespace

SyncService::SyncService(std::filesystem::path userRootDir) : userRootDir_(std::move(userRootDir)) {}

const std::vector<std::string> &SyncService::knownModules()
{
    // 注意：列表名 = data/user 下子目录名（除 daily_practice 外都已在其它功能中创建）
    static const std::vector<std::string> kModules{
        "bookmarks",        "wrong_questions",  "streak",         "draft",        "srs",
        "bookmark_folders", "study_goals",      "daily_practice", "attempt_timer"};
    return kModules;
}

std::filesystem::path SyncService::moduleFile(const std::string &moduleName, const std::string &userId) const
{
    return userRootDir_ / moduleName / (sanitize(userId) + ".json");
}

Json::Value SyncService::fileSnapshot(const std::filesystem::path &p) const
{
    Json::Value out(Json::objectValue);
    std::error_code ec;
    if (!std::filesystem::exists(p, ec))
    {
        out["exists"] = false;
        return out;
    }
    out["exists"] = true;
    const auto sz = std::filesystem::file_size(p, ec);
    out["size"] = static_cast<Json::UInt64>(ec ? 0 : sz);
    const auto mt = std::filesystem::last_write_time(p, ec);
    out["modified_at"] = ec ? "" : fileTimeToIso(mt);
    return out;
}

Json::Value SyncService::state(const std::string &userId) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "userId 必填", drogon::k400BadRequest);
    Json::Value out(Json::objectValue);
    out["server_time"] = common::nowIso8601();
    Json::Value modules(Json::objectValue);
    for (const auto &m : knownModules())
    {
        modules[m] = fileSnapshot(moduleFile(m, userId));
    }
    out["modules"] = modules;
    return out;
}

Json::Value SyncService::pull(const std::string &userId, const std::vector<std::string> &modules) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "userId 必填", drogon::k400BadRequest);
    Json::Value out(Json::objectValue);
    out["server_time"] = common::nowIso8601();
    Json::Value entries(Json::objectValue);

    const auto &all = knownModules();
    auto isAllowed = [&](const std::string &name) {
        return std::find(all.begin(), all.end(), name) != all.end();
    };

    std::vector<std::string> targets;
    if (modules.empty())
        targets = all;
    else
    {
        for (const auto &m : modules)
        {
            if (isAllowed(m)) targets.push_back(m);
        }
    }

    for (const auto &m : targets)
    {
        Json::Value entry(Json::objectValue);
        const auto p = moduleFile(m, userId);
        std::error_code ec;
        if (!std::filesystem::exists(p, ec))
        {
            entry["exists"] = false;
            entry["modified_at"] = "";
            entry["content"] = Json::Value(Json::nullValue);
        }
        else
        {
            entry["exists"] = true;
            const auto mt = std::filesystem::last_write_time(p, ec);
            entry["modified_at"] = ec ? "" : fileTimeToIso(mt);
            try
            {
                entry["content"] = infrastructure::storage::readJsonFile(p);
            }
            catch (...)
            {
                entry["content"] = Json::Value(Json::nullValue);
                entry["error"] = "READ_FAILED";
            }
        }
        entries[m] = entry;
    }
    out["modules"] = entries;
    return out;
}
}  // namespace application::services
