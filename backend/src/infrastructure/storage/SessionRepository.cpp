#include "SessionRepository.h"

#include <algorithm>
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

Json::Value SessionRepository::listByUserId(const std::string &userId) const
{
    Json::Value out(Json::arrayValue);
    if (userId.empty()) return out;
    std::shared_lock lock(mutex_);
    for (const auto &entry : sqliteStore_.list("sessions"))
    {
        if (entry.get("user_id", "").asString() == userId)
        {
            out.append(entry);
        }
    }
    return out;
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

bool SessionRepository::removeById(const std::string &userId, const std::string &sessionId)
{
    if (userId.empty() || sessionId.empty()) return false;
    std::unique_lock lock(mutex_);
    const auto entry = sqliteStore_.get("sessions", sessionId);
    if (entry.isNull() || entry.get("user_id", "").asString() != userId) return false;
    return sqliteStore_.erase("sessions", sessionId);
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

int SessionRepository::trimByUserId(const std::string &userId,
                                    std::size_t maxSessions,
                                    const std::string &keepSessionId)
{
    if (userId.empty()) return 0;
    std::unique_lock lock(mutex_);
    std::vector<Json::Value> sessions;
    for (const auto &entry : sqliteStore_.list("sessions"))
    {
        if (entry.get("user_id", "").asString() == userId) sessions.push_back(entry);
    }
    if (sessions.size() <= maxSessions) return 0;
    std::sort(sessions.begin(), sessions.end(), [](const Json::Value &left, const Json::Value &right) {
        const auto timestamp = [](const Json::Value &entry) {
            const auto createdAt = entry.get("created_at", "").asString();
            if (!createdAt.empty()) return createdAt;
            const auto lastSeenAt = entry.get("last_seen_at", "").asString();
            if (!lastSeenAt.empty()) return lastSeenAt;
            return entry.get("expires_at", "").asString();
        };
        return timestamp(left) > timestamp(right);
    });
    const bool hasKeptSession = !keepSessionId.empty() &&
                                std::any_of(sessions.begin(), sessions.end(), [&](const Json::Value &entry) {
                                    return entry.get("token_hash", "").asString() == keepSessionId;
                                });
    std::size_t retained = hasKeptSession ? 1 : 0;
    int removed = 0;
    for (const auto &entry : sessions)
    {
        const auto sessionId = entry.get("token_hash", "").asString();
        if (sessionId.empty() || sessionId == keepSessionId) continue;
        if (retained < maxSessions)
        {
            ++retained;
            continue;
        }
        if (sqliteStore_.erase("sessions", sessionId)) ++removed;
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
