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

std::filesystem::path deviceFile(const std::filesystem::path &userRootDir, const std::string &userId)
{
    return userRootDir / "sync_devices" / (sanitize(userId) + ".json");
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

Json::Value SyncService::push(const std::string &userId, const Json::Value &payload)
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "userId 必填", drogon::k400BadRequest);
    const auto incoming = payload["modules"];
    if (!incoming.isObject())
        throw common::AppException("VALIDATION_ERROR", "modules must be an object", drogon::k422UnprocessableEntity);

    std::unique_lock lock(mutex_);
    const bool force = payload.get("force", false).asBool();
    Json::Value result(Json::objectValue);
    Json::Value written(Json::objectValue);
    Json::Value conflicts(Json::objectValue);
    std::vector<std::string> touchedModules;
    const auto &allowed = knownModules();

    for (const auto &name : incoming.getMemberNames())
    {
        if (std::find(allowed.begin(), allowed.end(), name) == allowed.end())
        {
            continue;
        }
        const auto entry = incoming[name];
        const auto p = moduleFile(name, userId);
        const auto current = fileSnapshot(p);
        const auto expected = entry.get("remote_modified_at", "").asString();
        const auto actual = current.get("modified_at", "").asString();
        if (!force && current.get("exists", false).asBool() && !expected.empty() && expected != actual)
        {
            Json::Value conflict(Json::objectValue);
            conflict["expected_remote_modified_at"] = expected;
            conflict["actual_remote_modified_at"] = actual;
            conflict["server"] = current;
            conflicts[name] = conflict;
            continue;
        }
        std::filesystem::create_directories(p.parent_path());
        infrastructure::storage::writeJsonFileAtomic(p, entry["content"]);
        written[name] = fileSnapshot(p);
        touchedModules.push_back(name);
    }

    touchDevice(userId, payload, touchedModules);
    result["server_time"] = common::nowIso8601();
    result["written"] = written;
    result["conflicts"] = conflicts;
    result["status"] = conflicts.empty() ? "ok" : (written.empty() ? "conflict" : "partial_conflict");
    return result;
}

Json::Value SyncService::loadDevices(const std::string &userId) const
{
    const auto p = deviceFile(userRootDir_, userId);
    if (!std::filesystem::exists(p))
    {
        return Json::Value(Json::arrayValue);
    }
    auto data = infrastructure::storage::readJsonFile(p);
    return data.isArray() ? data : Json::Value(Json::arrayValue);
}

void SyncService::saveDevices(const std::string &userId, const Json::Value &devices) const
{
    const auto p = deviceFile(userRootDir_, userId);
    std::filesystem::create_directories(p.parent_path());
    infrastructure::storage::writeJsonFileAtomic(p, devices);
}

void SyncService::touchDevice(const std::string &userId, const Json::Value &payload, const std::vector<std::string> &modules) const
{
    auto devices = loadDevices(userId);
    const auto deviceId = payload.get("device_id", "unknown").asString().empty() ? std::string("unknown") : payload.get("device_id", "unknown").asString();
    Json::Value next(Json::arrayValue);
    bool updated = false;
    for (const auto &device : devices)
    {
        if (device.get("device_id", "").asString() == deviceId)
        {
            Json::Value item = device;
            item["device_id"] = deviceId;
            item["device_name"] = payload.get("device_name", device.get("device_name", "Unknown device")).asString();
            item["last_seen_at"] = common::nowIso8601();
            item["last_push_modules"] = Json::arrayValue;
            for (const auto &m : modules) item["last_push_modules"].append(m);
            next.append(item);
            updated = true;
        }
        else
        {
            next.append(device);
        }
    }
    if (!updated)
    {
        Json::Value item(Json::objectValue);
        item["device_id"] = deviceId;
        item["device_name"] = payload.get("device_name", "Unknown device").asString();
        item["created_at"] = common::nowIso8601();
        item["last_seen_at"] = item["created_at"].asString();
        item["last_push_modules"] = Json::arrayValue;
        for (const auto &m : modules) item["last_push_modules"].append(m);
        next.append(item);
    }
    saveDevices(userId, next);
}

Json::Value SyncService::devices(const std::string &userId) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "userId 必填", drogon::k400BadRequest);
    std::scoped_lock lock(mutex_);
    Json::Value out(Json::objectValue);
    out["server_time"] = common::nowIso8601();
    out["items"] = loadDevices(userId);
    return out;
}
}  // namespace application::services
