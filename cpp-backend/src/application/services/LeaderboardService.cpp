#include "application/services/LeaderboardService.h"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <set>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"
#include "infrastructure/storage/ProfileRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
namespace
{
constexpr const char *kDirName = "leaderboards";
}

LeaderboardService::LeaderboardService(std::filesystem::path systemRootDir,
                                       std::filesystem::path userRootDir,
                                       infrastructure::storage::UserRepository &userRepo,
                                       infrastructure::storage::ProfileRepository &profileRepo)
    : systemRootDir_(std::move(systemRootDir) / kDirName),
      userRootDir_(std::move(userRootDir)),
      userRepo_(userRepo),
      profileRepo_(profileRepo)
{
    std::error_code ec;
    std::filesystem::create_directories(systemRootDir_, ec);
}

std::string LeaderboardService::sanitize(const std::string &s)
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

std::filesystem::path LeaderboardService::cacheFile(const std::string &period) const
{
    return systemRootDir_ / (sanitize(period) + ".json");
}

std::string LeaderboardService::sinceFor(const std::string &period)
{
    if (period == "all") return "";
    int days = (period == "month") ? 30 : 7;
    auto tp = std::chrono::system_clock::now() - std::chrono::hours(24 * days);
    std::time_t tt = std::chrono::system_clock::to_time_t(tp);
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

std::vector<LeaderboardService::Entry> LeaderboardService::compute(const std::string &period) const
{
    const auto since = sinceFor(period);
    const auto answersDir = userRootDir_ / "answers";
    const auto streakDir = userRootDir_ / "streak";

    // 收集有过答题的 userId（answers/{userId}/ 目录）
    std::set<std::string> userIds;
    std::error_code ec;
    if (std::filesystem::exists(answersDir, ec))
    {
        for (const auto &e : std::filesystem::directory_iterator(answersDir, ec))
        {
            if (e.is_directory()) userIds.insert(e.path().filename().string());
        }
    }
    // 也加入 streak 目录里出现过的 userId（无答题但有连胜也展示）
    if (std::filesystem::exists(streakDir, ec))
    {
        for (const auto &e : std::filesystem::directory_iterator(streakDir, ec))
        {
            if (e.is_regular_file())
            {
                const auto stem = e.path().stem().string();
                if (!stem.empty()) userIds.insert(stem);
            }
        }
    }

    std::vector<Entry> entries;
    entries.reserve(userIds.size());
    for (const auto &uid : userIds)
    {
        Entry en;
        en.userId = uid;
        // 基本资料 / 显示名
        try
        {
            const auto user = userRepo_.findUserById(uid);
            if (user.isObject())
                en.displayName = user.get("display_name", user.get("username", uid)).asString();
            if (en.displayName.empty()) en.displayName = uid;
        }
        catch (...)
        {
            en.displayName = uid;
        }
        // 连胜
        try
        {
            const auto streakDoc = infrastructure::storage::readJsonFile(streakDir / (uid + ".json"));
            en.streak = streakDoc.get("streak_current", 0).asInt();
        }
        catch (...) { /* 可能没有 */ }
        // 答题汇总
        const auto userDir = answersDir / uid;
        if (std::filesystem::exists(userDir, ec))
        {
            for (const auto &fe : std::filesystem::directory_iterator(userDir, ec))
            {
                if (!fe.is_regular_file()) continue;
                if (fe.path().extension() != ".json") continue;
                Json::Value doc;
                try { doc = infrastructure::storage::readJsonFile(fe.path()); }
                catch (...) { continue; }
                const auto savedAt = doc.get("saved_at", "").asString();
                if (!since.empty() && !savedAt.empty() && savedAt < since) continue;
                const auto stat = doc.get("statistics", Json::Value(Json::objectValue));
                en.questions += stat.get("total_questions", 0).asInt();
                en.correct += stat.get("correct_count", 0).asInt();
            }
        }
        en.accuracy = en.questions > 0 ? static_cast<double>(en.correct) / en.questions : 0.0;
        entries.push_back(std::move(en));
    }

    // 排序：streak desc → questions desc → accuracy desc
    std::sort(entries.begin(), entries.end(), [](const Entry &a, const Entry &b) {
        if (a.streak != b.streak) return a.streak > b.streak;
        if (a.questions != b.questions) return a.questions > b.questions;
        return a.accuracy > b.accuracy;
    });
    return entries;
}

Json::Value LeaderboardService::loadCache(const std::string &period) const
{
    try { return infrastructure::storage::readJsonFile(cacheFile(period)); }
    catch (...) { return Json::Value(Json::nullValue); }
}

void LeaderboardService::saveCache(const std::string &period, const Json::Value &doc) const
{
    infrastructure::storage::writeJsonFileAtomic(cacheFile(period), doc);
}

Json::Value LeaderboardService::get(const std::string &periodIn, int limit, bool force)
{
    static const std::set<std::string> kPeriods{"week", "month", "all"};
    const std::string period = kPeriods.count(periodIn) ? periodIn : "week";
    if (limit <= 0 || limit > 100) limit = 20;

    if (!force)
    {
        const auto cached = loadCache(period);
        if (cached.isObject())
        {
            const auto generatedAt = cached.get("generated_at", "").asString();
            // 简化：只比较缓存生成时间字符串与当前 - TTL 的 ISO 字符串
            const auto threshold = [this]() {
                auto tp = std::chrono::system_clock::now() - cacheTtl_;
                std::time_t tt = std::chrono::system_clock::to_time_t(tp);
                std::tm tm{};
#if defined(_WIN32)
                gmtime_s(&tm, &tt);
#else
                gmtime_r(&tt, &tm);
#endif
                char buf[32];
                std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
                return std::string(buf);
            }();
            if (!generatedAt.empty() && generatedAt >= threshold) return cached;
        }
    }

    const auto entries = compute(period);
    Json::Value items(Json::arrayValue);
    int rank = 0;
    for (const auto &en : entries)
    {
        if (rank >= limit) break;
        Json::Value item(Json::objectValue);
        item["rank"] = ++rank;
        item["user_id"] = en.userId;
        item["display_name"] = en.displayName;
        item["streak"] = en.streak;
        item["questions"] = en.questions;
        item["correct"] = en.correct;
        item["accuracy"] = en.accuracy;
        items.append(item);
    }
    Json::Value doc(Json::objectValue);
    doc["period"] = period;
    doc["limit"] = limit;
    doc["generated_at"] = common::nowIso8601();
    doc["items"] = items;
    saveCache(period, doc);
    return doc;
}
}  // namespace application::services
