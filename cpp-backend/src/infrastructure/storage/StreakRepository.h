#pragma once

// 学习连续天数 / 每日目标 Repository（业务功能 2）
// - 持久化文件：data/user/streaks/{userId}.json
// - 数据结构：
//   {
//     "user_id": "...",
//     "daily": {
//       "YYYY-MM-DD": {
//         "answers_submitted": 0,   // 当日提交答题次数
//         "questions_done": 0,      // 当日累计题量（含未答和错答）
//         "correct": 0              // 当日累计答对题数
//       }
//     },
//     "streak_current": 0,          // 当前连续天数
//     "streak_best": 0,             // 历史最高连续天数
//     "last_active_date": "YYYY-MM-DD", // 上次有学习记录的日期（UTC）
//     "daily_goal": { "questions": 30 },// 每日目标（题量）
//     "updated_at": "..."
//   }

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

namespace infrastructure::storage
{
class StreakRepository
{
  public:
    explicit StreakRepository(std::filesystem::path userRootDir);

    // 读取（不存在则返回默认空集合）
    Json::Value load(const std::string &userId) const;

    // 当一次答题提交完成时记录学习活动；自动更新 daily 与 streak 字段
    //   questionsDone: 本次试卷参与的题量（已答+错答+未答）
    //   correct:       本次答对题数
    void recordActivity(const std::string &userId, int questionsDone, int correct);

    // 设置每日目标（题量）；返回更新后的整份文档
    Json::Value updateDailyGoal(const std::string &userId, int dailyQuestions);

  private:
    static Json::Value defaultDoc(const std::string &userId);

    // 工具：获取当前 UTC 日期字符串 "YYYY-MM-DD"
    static std::string todayUtc();

    // 工具：把 "YYYY-MM-DD" 解析为 std::tm（仅 year/mon/mday 有效）
    // 返回是否解析成功
    static bool parseDate(const std::string &date, std::tm &out);

    // 工具：判断 b 是否为 a 的次日（UTC）
    static bool isNextDay(const std::string &a, const std::string &b);

    std::filesystem::path streakDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
