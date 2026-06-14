#include "SessionRepository.h"

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
    : filePath_(std::move(systemDir) / "auth_sessions.json")
{
    std::filesystem::create_directories(filePath_.parent_path());
}

void SessionRepository::save(const std::string &token, const Json::Value &session)
{
    if (token.empty())
    {
        return;
    }
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value entry = session;
    const auto key = tokenStorageKey(token);
    entry["token_hash"] = key;
    if (entry.isMember("token"))
    {
        entry.removeMember("token");
    }
    doc["sessions"][key] = entry;
    writeJsonFileAtomic(filePath_, doc);
}

Json::Value SessionRepository::find(const std::string &token) const
{
    if (token.empty())
    {
        return Json::Value();
    }
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    const auto key = tokenStorageKey(token);
    if (!doc["sessions"].isMember(key))
    {
        return Json::Value();
    }
    return doc["sessions"][key];
}

bool SessionRepository::remove(const std::string &token)
{
    if (token.empty())
    {
        return false;
    }
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    const auto key = tokenStorageKey(token);
    if (!doc["sessions"].isMember(key))
    {
        return false;
    }
    doc["sessions"].removeMember(key);
    writeJsonFileAtomic(filePath_, doc);
    return true;
}

int SessionRepository::pruneExpired(std::int64_t nowEpochMs)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    std::vector<std::string> expiredTokens;
    for (const auto &token : doc["sessions"].getMemberNames())
    {
        const auto expiresAt = doc["sessions"][token].get("expires_at_epoch_ms", Json::Int64{0}).asInt64();
        if (expiresAt > 0 && expiresAt <= nowEpochMs)
        {
            expiredTokens.push_back(token);
        }
    }
    for (const auto &token : expiredTokens)
    {
        doc["sessions"].removeMember(token);
    }
    if (!expiredTokens.empty())
    {
        writeJsonFileAtomic(filePath_, doc);
    }
    return static_cast<int>(expiredTokens.size());
}

}  // namespace infrastructure::storage
