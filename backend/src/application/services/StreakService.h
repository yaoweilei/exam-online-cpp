#pragma once

// 学习连续天数 / 每日目标 Service（业务功能 2）
// 负责对外暴露的语义化接口：summary（个人中心徽标） / heatmap（最近 N 天） / updateGoal

#include <string>

#include <json/json.h>

#include "infrastructure/storage/StreakRepository.h"

namespace application::services
{
class StreakService
{
  public:
    explicit StreakService(infrastructure::storage::StreakRepository &repository);

    // 答题提交后的钩子：累计当日数据 + 推进连续天数
    void recordActivity(const std::string &userId, int questionsDone, int correct);

    // 个人中心徽标 / 顶部摘要：当前连续天数、历史最高、今日完成数与目标
    Json::Value summary(const std::string &userId) const;

    // 最近 N 天的热力图数据；返回 days 数组，包含 (date, questions_done, correct, hit_goal)
    Json::Value heatmap(const std::string &userId, int days) const;

    // 修改每日目标（题量）
    Json::Value updateDailyGoal(const std::string &userId, int dailyQuestions);

  private:
    infrastructure::storage::StreakRepository &repository_;
};
}  // namespace application::services
