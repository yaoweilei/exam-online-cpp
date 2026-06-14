#pragma once

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <string>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"

namespace application::services
{
class StatisticsService
{
  public:
    explicit StatisticsService(infrastructure::storage::AnswerRepository &repository);

    Json::Value userStatistics(const std::string &userId) const;

    Json::Value weakPoints(const std::string &userId) const;

    Json::Value learningCurve(const std::string &userId, int days) const;

  private:
    static std::string inferSection(const std::string &questionId);

  private:
    infrastructure::storage::AnswerRepository &repository_;
};
}  // namespace application::services
