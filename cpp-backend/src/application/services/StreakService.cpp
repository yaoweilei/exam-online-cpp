#include "StreakService.h"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

namespace application::services
{

StreakService::StreakService(infrastructure::storage::StreakRepository &repository) : repository_(repository)
{
}

void StreakService::recordActivity(const std::string &userId, int questionsDone, int correct)
{
    repository_.recordActivity(userId, questionsDone, correct);
}

namespace
{
// 工具：取得 UTC 今天，"YYYY-MM-DD"
std::string todayUtcString()
{
    using namespace std::chrono;
    const auto t = system_clock::to_time_t(system_clock::now());
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%d");
    return oss.str();
}

// 工具：把 std::tm（UTC 日期）格式化为 "YYYY-MM-DD"
std::string formatDateUtc(std::tm tm)
{
    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%d");
    return oss.str();
}
}  // namespace

Json::Value StreakService::summary(const std::string &userId) const
{
    const auto doc = repository_.load(userId);
    Json::Value out(Json::objectValue);
    out["streak_current"] = doc.get("streak_current", 0);
    out["streak_best"] = doc.get("streak_best", 0);
    out["last_active_date"] = doc.get("last_active_date", "");

    const int goal = doc.isMember("daily_goal") ? doc["daily_goal"].get("questions", 30).asInt() : 30;
    out["daily_goal_questions"] = goal;

    int todayDone = 0;
    int todayCorrect = 0;
    const auto today = todayUtcString();
    if (doc.isMember("daily") && doc["daily"].isObject() && doc["daily"].isMember(today))
    {
        const auto &entry = doc["daily"][today];
        todayDone = entry.get("questions_done", 0).asInt();
        todayCorrect = entry.get("correct", 0).asInt();
    }
    out["today_questions_done"] = todayDone;
    out["today_correct"] = todayCorrect;
    out["today_hit_goal"] = todayDone >= goal;
    out["today_progress"] = goal > 0 ? std::min(100, todayDone * 100 / goal) : 0;
    return out;
}

Json::Value StreakService::heatmap(const std::string &userId, int days) const
{
    if (days <= 0) days = 90;
    if (days > 365) days = 365;

    const auto doc = repository_.load(userId);
    const int goal = doc.isMember("daily_goal") ? doc["daily_goal"].get("questions", 30).asInt() : 30;

    // 基准点：今天 UTC 的 00:00
    using namespace std::chrono;
    const auto t = system_clock::to_time_t(system_clock::now());
    std::tm today{};
#ifdef _WIN32
    gmtime_s(&today, &t);
#else
    gmtime_r(&t, &today);
#endif
    today.tm_hour = 0;
    today.tm_min = 0;
    today.tm_sec = 0;
#ifdef _WIN32
    auto baseEpoch = _mkgmtime(&today);
#else
    auto baseEpoch = timegm(&today);
#endif

    Json::Value daysArr(Json::arrayValue);
    for (int i = days - 1; i >= 0; --i)
    {
        const auto ts = baseEpoch - static_cast<long long>(i) * 86400LL;
        const auto tt = static_cast<std::time_t>(ts);
        std::tm tm{};
#ifdef _WIN32
        gmtime_s(&tm, &tt);
#else
        gmtime_r(&tt, &tm);
#endif
        const auto date = formatDateUtc(tm);
        Json::Value entry(Json::objectValue);
        entry["date"] = date;
        int qd = 0;
        int cr = 0;
        if (doc.isMember("daily") && doc["daily"].isObject() && doc["daily"].isMember(date))
        {
            const auto &de = doc["daily"][date];
            qd = de.get("questions_done", 0).asInt();
            cr = de.get("correct", 0).asInt();
        }
        entry["questions_done"] = qd;
        entry["correct"] = cr;
        entry["hit_goal"] = qd >= goal;
        daysArr.append(entry);
    }

    Json::Value out(Json::objectValue);
    out["days"] = daysArr;
    out["daily_goal_questions"] = goal;
    out["streak_current"] = doc.get("streak_current", 0);
    out["streak_best"] = doc.get("streak_best", 0);
    return out;
}

Json::Value StreakService::updateDailyGoal(const std::string &userId, int dailyQuestions)
{
    const auto doc = repository_.updateDailyGoal(userId, dailyQuestions);
    return summary(userId);
    (void)doc;
}

}  // namespace application::services
