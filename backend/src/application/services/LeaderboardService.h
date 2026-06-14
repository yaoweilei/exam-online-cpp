#pragma once

// 业务功能 21：排行榜 Service
//   - 周期：week / month / all
//   - 维度：streak（连胜天数）+ answer 总题数 + 正确率
//   - 缓存：data/system/leaderboards/{period}.json，TTL=600 秒
//   - 仅展示用户脱敏：{user_id, display_name, streak, questions, accuracy}

#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class UserRepository;
class ProfileRepository;
}  // namespace infrastructure::storage

namespace application::services
{
class LeaderboardService
{
  public:
    LeaderboardService(std::filesystem::path systemRootDir,
                       std::filesystem::path userRootDir,
                       infrastructure::storage::UserRepository &userRepo,
                       infrastructure::storage::ProfileRepository &profileRepo);

    // period: week | month | all；limit 上限 100；force 跳过缓存
    Json::Value get(const std::string &period, int limit, bool force);

  private:
    struct Entry
    {
        std::string userId;
        std::string displayName;
        int streak{0};
        int questions{0};
        int correct{0};
        double accuracy{0.0};
    };

    std::filesystem::path cacheFile(const std::string &period) const;
    Json::Value loadCache(const std::string &period) const;
    void saveCache(const std::string &period, const Json::Value &doc) const;
    std::vector<Entry> compute(const std::string &period) const;
    static std::string sinceFor(const std::string &period);
    static std::string sanitize(const std::string &s);

    std::filesystem::path systemRootDir_;
    std::filesystem::path userRootDir_;
    infrastructure::storage::UserRepository &userRepo_;
    infrastructure::storage::ProfileRepository &profileRepo_;
    std::chrono::seconds cacheTtl_{600};
};
}  // namespace application::services
