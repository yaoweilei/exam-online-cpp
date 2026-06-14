#pragma once

// 业务功能 17：学习报告 Service
//   - 输入 userId + period (week|month)
//   - 输出：周期内答题/正确率/弱项 + 错题增量 + SRS 待复习 + 连续天数

#include <filesystem>
#include <string>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/SrsRepository.h"
#include "infrastructure/storage/WrongQuestionRepository.h"

namespace application::services
{
class LearningReportService
{
  public:
    LearningReportService(infrastructure::storage::AnswerRepository &answerRepo,
                          infrastructure::storage::WrongQuestionRepository &wrongRepo,
                          infrastructure::storage::SrsRepository &srsRepo,
                          std::filesystem::path userRootDir);

    Json::Value generate(const std::string &userId, const std::string &period) const;

  private:
    static std::string sinceFor(const std::string &period);

    infrastructure::storage::AnswerRepository &answerRepo_;
    infrastructure::storage::WrongQuestionRepository &wrongRepo_;
    infrastructure::storage::SrsRepository &srsRepo_;
    std::filesystem::path streakDir_;
};
}  // namespace application::services
