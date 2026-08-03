#pragma once
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <json/json.h>
struct sqlite3;

namespace infrastructure::storage
{
class SqliteJsonStore
{
  public:
    explicit SqliteJsonStore(const std::filesystem::path &path);
    ~SqliteJsonStore();
    SqliteJsonStore(const SqliteJsonStore &) = delete;
    SqliteJsonStore &operator=(const SqliteJsonStore &) = delete;
    void upsert(const std::string &nameSpace, const std::string &key, const Json::Value &payload);
    Json::Value get(const std::string &nameSpace, const std::string &key) const;
    Json::Value list(const std::string &nameSpace, int limit = 0, int offset = 0) const;
    Json::Value searchText(const std::string &nameSpace,
                           const std::string &jsonPath,
                           const std::string &query,
                           int limit) const;
    Json::Value queryAudit(const std::string &nameSpace,
                           const std::optional<std::string> &orgId,
                           const std::optional<std::string> &actorId,
                           const std::optional<std::string> &action,
                           const std::optional<std::string> &actionPrefix,
                           const std::optional<std::string> &since,
                           const std::optional<std::string> &until,
                           int limit,
                           int offset,
                           std::size_t &total) const;
    void replace(const std::string &nameSpace, const Json::Value &items, const std::string &keyField = "id");
    std::size_t count(const std::string &nameSpace) const;
    std::unordered_map<std::string, int> groupCount(const std::string &nameSpace, const std::string &jsonPath) const;
    bool erase(const std::string &nameSpace, const std::string &key);
    void checkpoint() const;
  private:
    void exec(const char *sql) const;
    sqlite3 *db_{nullptr};
    mutable std::mutex mutex_;
};
}
