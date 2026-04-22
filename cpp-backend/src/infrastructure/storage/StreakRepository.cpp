#include "StreakRepository.h"

#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

StreakRepository::StreakRepository(std::filesystem::path userRootDir)
    : streakDir_(std::move(userRootDir) / "streaks")
{
    // 确保目录存在
    std::filesystem::create_directories(streakDir_);
}

Json::Value StreakRepository::defaultDoc(const std::string &userId)
{
    Json::Value doc(Json::objectValue);
    doc["user_id"] = userId;
    doc["daily"] = Json::objectValue;
    doc["streak_current"] = 0;
    doc["streak_best"] = 0;
    doc["last_active_date"] = "";
    Json::Value goal(Json::objectValue);
    goal["questions"] = 30;  // 默认每日目标题量
    doc["daily_goal"] = goal;
    doc["updated_at"] = "";
    return doc;
}

std::string StreakRepository::todayUtc()
{
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto t = system_clock::to_time_t(now);
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

bool StreakRepository::parseDate(const std::string &date, std::tm &out)
{
    out = std::tm{};
    if (date.size() != 10 || date[4] != '-' || date[7] != '-')
    {
        return false;
    }
    try
    {
        out.tm_year = std::stoi(date.substr(0, 4)) - 1900;
        out.tm_mon = std::stoi(date.substr(5, 2)) - 1;
        out.tm_mday = std::stoi(date.substr(8, 2));
        return true;
    }
    catch (...)
    {
        return false;
    }
}

bool StreakRepository::isNextDay(const std::string &a, const std::string &b)
{
    std::tm ta{};
    std::tm tb{};
    if (!parseDate(a, ta) || !parseDate(b, tb))
    {
        return false;
    }
    // 用 timegm 风格转换；Windows 用 _mkgmtime
#ifdef _WIN32
    const auto ea = _mkgmtime(&ta);
    const auto eb = _mkgmtime(&tb);
#else
    const auto ea = timegm(&ta);
    const auto eb = timegm(&tb);
#endif
    if (ea == -1 || eb == -1)
    {
        return false;
    }
    // 判断 b - a 是否恰好为一天（86400 秒）
    return (eb - ea) == 86400;
}

Json::Value StreakRepository::load(const std::string &userId) const
{
    const auto path = streakDir_ / (userId + ".json");
    std::shared_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return defaultDoc(userId);
    }
    return readJsonFile(path);
}

void StreakRepository::recordActivity(const std::string &userId, int questionsDone, int correct)
{
    if (userId.empty())
    {
        return;
    }
    const auto path = streakDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);

    if (!doc.isMember("daily") || !doc["daily"].isObject())
    {
        doc["daily"] = Json::objectValue;
    }

    const auto today = todayUtc();
    auto &daily = doc["daily"];
    if (!daily.isMember(today))
    {
        Json::Value entry(Json::objectValue);
        entry["answers_submitted"] = 0;
        entry["questions_done"] = 0;
        entry["correct"] = 0;
        daily[today] = entry;
    }
    auto &entry = daily[today];
    entry["answers_submitted"] = entry.get("answers_submitted", 0).asInt() + 1;
    entry["questions_done"] = entry.get("questions_done", 0).asInt() + std::max(0, questionsDone);
    entry["correct"] = entry.get("correct", 0).asInt() + std::max(0, correct);

    // 更新连续天数
    const auto lastDate = doc.get("last_active_date", "").asString();
    int current = doc.get("streak_current", 0).asInt();
    if (lastDate == today)
    {
        // 同一天再次提交，连续天数不变
        if (current <= 0)
        {
            current = 1;
        }
    }
    else if (isNextDay(lastDate, today))
    {
        // 连续学习，+1
        current = current + 1;
    }
    else
    {
        // 中断或首次，重置为 1
        current = 1;
    }
    doc["streak_current"] = current;
    int best = doc.get("streak_best", 0).asInt();
    if (current > best)
    {
        doc["streak_best"] = current;
    }
    doc["last_active_date"] = today;
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
}

Json::Value StreakRepository::updateDailyGoal(const std::string &userId, int dailyQuestions)
{
    const auto path = streakDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);
    Json::Value goal(Json::objectValue);
    // 限制在合理区间，避免脏数据
    int q = dailyQuestions;
    if (q < 1) q = 1;
    if (q > 1000) q = 1000;
    goal["questions"] = q;
    doc["daily_goal"] = goal;
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return doc;
}

}  // namespace infrastructure::storage
