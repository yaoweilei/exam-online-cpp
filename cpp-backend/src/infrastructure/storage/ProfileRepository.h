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
        : profileDir_(std::move(userRootDir) / "profile")
    {
        std::filesystem::create_directories(profileDir_);
    }

    Json::Value loadProfile(const std::string &userId) const
    {
        const auto path = profileDir_ / (userId + ".json");
        std::shared_lock lock(mutex_);
        if (!std::filesystem::exists(path))
        {
            return defaultProfile(userId);
        }
        return normalizeProfile(readJsonFile(path), userId);
    }

    void saveProfile(const std::string &userId, const Json::Value &data)
    {
        std::unique_lock lock(mutex_);
        writeJsonFileAtomic(profileDir_ / (userId + ".json"), normalizeProfile(data, userId));
    }

    // Called on every successful login: updates streak_days / last_active_at.
    void updateStreak(const std::string &userId)
    {
        const auto now = common::nowIso8601();
        const auto todayDate = now.substr(0, 10);  // "YYYY-MM-DD"

        std::unique_lock lock(mutex_);
        const auto path = profileDir_ / (userId + ".json");
        auto profile = std::filesystem::exists(path) ? normalizeProfile(readJsonFile(path), userId) : defaultProfile(userId);

        const auto lastActive = profile.get("last_active_at", "").asString();
        const auto lastDate = lastActive.size() >= 10 ? lastActive.substr(0, 10) : "";

        // Already touched today — nothing to update
        if (lastDate == todayDate)
        {
            return;
        }

        int streak = profile.get("streak_days", 0).asInt();
        int longest = profile.get("longest_streak", 0).asInt();

        if (!lastDate.empty() && isYesterday(todayDate, lastDate))
        {
            streak += 1;
        }
        else
        {
            streak = 1;
        }

        longest = std::max(longest, streak);
        profile["streak_days"] = streak;
        profile["longest_streak"] = longest;
        profile["last_active_at"] = now;

        writeJsonFileAtomic(path, profile);
    }

  private:
    static Json::Value defaultProfile(const std::string &userId)
    {
        Json::Value p(Json::objectValue);
        p["user_id"] = userId;
        p["display_name"] = "";
        p["avatar_url"] = "";
        p["locale"] = "zh-CN";
        p["goal_level"] = "";
        p["goal_date"] = "";
        p["daily_target"] = 20;
        p["streak_days"] = 0;
        p["longest_streak"] = 0;
        p["last_active_at"] = "";
        p["xp"] = 0;
        p["credits"] = 0;
        p["scope_type"] = "personal";
        p["scope_id"] = userId;
        p["organization_type"] = "";
        p["plan"] = "free";
        p["plan_status"] = "active";
        p["plan_expires_at"] = "";
        p["notification_enabled"] = true;
        return p;
    }

    static Json::Value normalizeProfile(const Json::Value &raw, const std::string &userId)
    {
        Json::Value profile = defaultProfile(userId);
        if (raw.isObject())
        {
            for (const auto &member : raw.getMemberNames())
            {
                profile[member] = raw[member];
            }
        }

        const auto plan = normalizePlan(profile.get("plan", "free").asString());
        const auto expiresAt = profile.get("plan_expires_at", profile.get("plan_expires", "")).asString();

        profile["user_id"] = userId;
        profile["display_name"] = profile.get("display_name", "").asString();
        profile["avatar_url"] = profile.get("avatar_url", "").asString();
        profile["locale"] = profile.get("locale", "zh-CN").asString();
        profile["goal_level"] = profile.get("goal_level", "").asString();
        profile["goal_date"] = profile.get("goal_date", "").asString();
        profile["daily_target"] = profile.get("daily_target", 20).asInt();
        profile["streak_days"] = profile.get("streak_days", 0).asInt();
        profile["longest_streak"] = profile.get("longest_streak", 0).asInt();
        profile["last_active_at"] = profile.get("last_active_at", "").asString();
        profile["xp"] = profile.get("xp", 0).asInt();
        profile["credits"] = profile.get("credits", 0).asInt();
        profile["scope_type"] = profile.get("scope_type", "personal").asString();
        profile["scope_id"] = profile.get("scope_id", userId).asString();
        profile["organization_type"] = profile.get("organization_type", "").asString();
        profile["plan"] = plan;
        profile["plan_status"] = normalizePlanStatus(profile.get("plan_status", "").asString(), expiresAt);
        profile["plan_expires_at"] = expiresAt;
        profile.removeMember("plan_expires");
        profile["notification_enabled"] = profile.get("notification_enabled", true).asBool();
        return profile;
    }

    static std::string normalizePlan(const std::string &plan)
    {
        if (plan == "premium")
        {
            return "pro";
        }
        if (plan == "ultra" || plan == "pro" || plan == "free")
        {
            return plan;
        }
        return "free";
    }

    static std::string normalizePlanStatus(const std::string &status, const std::string &expiresAt)
    {
        std::string normalized = status;
        if (normalized != "active" && normalized != "trial" && normalized != "expired" && normalized != "canceled")
        {
            normalized = "active";
        }
        if (!expiresAt.empty())
        {
            const auto today = common::nowIso8601().substr(0, 10);
            const auto expiryDate = expiresAt.size() >= 10 ? expiresAt.substr(0, 10) : expiresAt;
            if (!expiryDate.empty() && expiryDate < today)
            {
                normalized = "expired";
            }
        }
        return normalized;
    }

    // Returns true if `other` (YYYY-MM-DD) is exactly one day before `today` (YYYY-MM-DD).
    static bool isYesterday(const std::string &today, const std::string &other)
    {
        if (today.size() < 10 || other.size() < 10)
        {
            return false;
        }
        int ty = std::stoi(today.substr(0, 4));
        int tm = std::stoi(today.substr(5, 2));
        int td = std::stoi(today.substr(8, 2));
        const int oy = std::stoi(other.substr(0, 4));
        const int om = std::stoi(other.substr(5, 2));
        const int od = std::stoi(other.substr(8, 2));

        // Decrement today by one calendar day
        td -= 1;
        if (td == 0)
        {
            tm -= 1;
            if (tm == 0)
            {
                tm = 12;
                ty -= 1;
            }
            const int daysInMonth[] = {0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
            int dim = daysInMonth[tm];
            if (tm == 2 && ((ty % 4 == 0 && ty % 100 != 0) || ty % 400 == 0))
            {
                dim = 29;
            }
            td = dim;
        }
        return (ty == oy && tm == om && td == od);
    }

    std::filesystem::path profileDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
