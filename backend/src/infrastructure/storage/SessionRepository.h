#pragma once

#include <cstdint>
#include <filesystem>
#include <shared_mutex>
#include <string>

#include <json/json.h>
#include "SqliteJsonStore.h"

namespace infrastructure::storage
{
class SessionRepository
{
  public:
    explicit SessionRepository(std::filesystem::path systemDir);

    void save(const std::string &token, const Json::Value &session);
    Json::Value find(const std::string &token) const;
    bool remove(const std::string &token);
    int removeByUserId(const std::string &userId, const std::string &keepToken = "");
    int pruneExpired(std::int64_t nowEpochMs);

  private:
    std::filesystem::path filePath_;
    SqliteJsonStore sqliteStore_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
