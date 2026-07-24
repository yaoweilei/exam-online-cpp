#include "SessionRepository.h"

#include <vector>

#include <drogon/utils/Utilities.h>

#include "JsonIo.h"

namespace infrastructure::storage
{

namespace
{
Json::Value loadDoc(const std::filesystem::path &path)
{
    Json::Value doc;
    if (std::filesystem::exists(path))
    {
        doc = readJsonFile(path);
    }
    if (!doc.isObject())
    {
        doc = Json::Value(Json::objectValue);
    }
    if (!doc.isMember("sessions") || !doc["sessions"].isObject())
    {
        doc["sessions"] = Json::Value(Json::objectValue);
    }
    return doc;
}

std::string tokenStorageKey(const std::string &token)
{
    return drogon::utils::getSha256(token);
}
}  // namespace

SessionRepository::SessionRepository(std::filesystem::path systemDir)
    : filePath_(systemDir / "auth_sessions.json"), sqliteStore_(std::move(systemDir) / "core.sqlite3")
{
    std::filesystem::create_directories(filePath_.parent_path());
    if (sqliteStore_.count("sessions") == 0 && std::filesystem::exists(filePath_))
    {
        const auto doc = loadDoc(filePath_);
        for (const auto &key : doc["sessions"].getMemberNames()) sqliteStore_.upsert("sessions", key, doc["sessions"][key]);
    }
}

void SessionRepository::save(const std::string &token, const Json::Value &session)
{
    if (token.empty())
    {
        return;
    }
    std::unique_lock lock(mutex_);
    Json::Value entry = session;
    const auto key = tokenStorageKey(token);
    entry["token_hash"] = key;
    if (entry.isMember("token"))
    {
        entry.removeMember("token");
    }
    sqliteStore_.upsert("sessions", key, entry);
}

Json::Value SessionRepository::find(const std::string &token) const
{
    if (token.empty())
    {
        return Json::Value();
    }
    std::shared_lock lock(mutex_);
    const auto key = tokenStorageKey(token);
    return sqliteStore_.get("sessions", key);
}

bool SessionRepository::remove(const std::string &token)
{
    if (token.empty())
    {
        return false;
    }
    std::unique_lock lock(mutex_);
    const auto key = tokenStorageKey(token);
    return sqliteStore_.erase("sessions", key);
}

int SessionRepository::removeByUserId(const std::string &userId, const std::string &keepToken)
{
    if (userId.empty()) return 0;
    std::unique_lock lock(mutex_);
    const auto keepKey = keepToken.empty() ? std::string() : tokenStorageKey(keepToken);
    const auto sessions = sqliteStore_.list("sessions");
    int removed = 0;
    for (const auto &entry : sessions)
    {
        const auto key = entry.get("token_hash", "").asString();
        if (key == keepKey || entry.get("user_id", "").asString() != userId) continue;
        if (sqliteStore_.erase("sessions", key)) ++removed;
    }
    return removed;
}

int SessionRepository::pruneExpired(std::int64_t nowEpochMs)
{
    std::unique_lock lock(mutex_);
    const auto sessions = sqliteStore_.list("sessions");
    int removed = 0;
    for (const auto &entry : sessions)
    {
        const auto expiresAt = entry.get("expires_at_epoch_ms", Json::Int64{0}).asInt64();
        if (expiresAt > 0 && expiresAt <= nowEpochMs && sqliteStore_.erase("sessions", entry.get("token_hash", "").asString())) ++removed;
    }
    return removed;
}

}  // namespace infrastructure::storage
