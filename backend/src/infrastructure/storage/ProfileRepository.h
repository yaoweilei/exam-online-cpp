#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class ProfileRepository
{
  public:
    explicit ProfileRepository(std::filesystem::path userRootDir)
;

    Json::Value loadProfile(const std::string &userId) const;

    void saveProfile(const std::string &userId, const Json::Value &data);

    bool grantCreditsIfAbsent(const std::string &userId,
                              const std::string &awardKey,
                              int credits,
                              const std::string &reason);

    Json::Value recordStudySeconds(const std::string &userId, int deltaSeconds);

    // Called on every successful login: updates streak_days / last_active_at.
    void updateStreak(const std::string &userId);

  private:
    static Json::Value defaultProfile(const std::string &userId);

    static Json::Value normalizeProfile(const std::string &userId, const Json::Value &input);

    static std::string normalizePlan(const std::string &plan);

    static std::string normalizePlanStatus(const std::string &status);

    // Returns true if `other` (YYYY-MM-DD) is exactly one day before `today` (YYYY-MM-DD).
    static bool isYesterday(const std::string &today, const std::string &other);

    std::filesystem::path profileDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
