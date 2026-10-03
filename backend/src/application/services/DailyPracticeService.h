#pragma once

// 业务功能 16：每日一练 Service
//   - 来源混合：错题本（最近 N 条按 last_wrong_at 倒序）+ SRS 到期卡；
//     数量不足时从免费试卷中选择稳定的推荐题，避免新用户清单为空。
//   - 同一 userId+date(YYYY-MM-DD) 缓存到 data/user/daily_practice/{userId}.json，
//     当天再请求返回相同列表（保证“每日一练”稳定）
//   - 提供 markComplete 标记完成；regenerate 强制刷新

#include <filesystem>
#include <string>

#include <json/json.h>

#include "application/services/SrsService.h"
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/ExamRepository.h"
#include "infrastructure/storage/WrongQuestionRepository.h"

namespace application::services
{
class DailyPracticeService
{
  public:
    DailyPracticeService(std::filesystem::path userRootDir,
                         infrastructure::storage::WrongQuestionRepository &wrongRepo,
                         SrsService &srsService,
                         infrastructure::storage::ExamRepository &examRepo,
                         infrastructure::storage::AnswerRepository &answerRepo);

    // 获取（或当天首次生成）今日清单
    Json::Value getOrCreateToday(const std::string &userId,
                                 int targetCount = 10,
                                 const std::string &examTarget = "",
                                 int dailyMinutes = 0) const;

    // 强制重新生成（不影响历史完成记录）
    Json::Value regenerate(const std::string &userId,
                           int targetCount = 10,
                           const std::string &examTarget = "",
                           int dailyMinutes = 0) const;

    // 标记某题完成（写入 completed_question_ids 集合）
    Json::Value markComplete(const std::string &userId,
                             const std::string &examId,
                             const std::string &questionId,
                             const std::string &examTarget = "") const;

  private:
    std::filesystem::path fileFor(const std::string &userId, const std::string &examTarget = "") const;
    Json::Value buildItems(const std::string &userId,
                           int targetCount,
                           const std::string &examTarget,
                           int dailyMinutes,
                           int &plannedMinutes) const;
    static std::string today();          // YYYY-MM-DD
    static std::string sanitize(const std::string &s);

    std::filesystem::path rootDir_;
    infrastructure::storage::WrongQuestionRepository &wrongRepo_;
    SrsService &srsService_;
    infrastructure::storage::ExamRepository &examRepo_;
    infrastructure::storage::AnswerRepository &answerRepo_;
};
}  // namespace application::services
