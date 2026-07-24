#pragma once

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <string>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/ProfileRepository.h"

namespace application::services
{
class StatisticsService
{
  public:
    StatisticsService(infrastructure::storage::AnswerRepository &repository,
                      infrastructure::storage::ProfileRepository &profileRepository);

    Json::Value userStatistics(const std::string &userId) const;

    Json::Value weakPoints(const std::string &userId) const;

    Json::Value learningCurve(const std::string &userId, int days) const;

  private:
    static std::string inferSection(const std::string &questionId);

  private:
    infrastructure::storage::AnswerRepository &repository_;
    infrastructure::storage::ProfileRepository &profileRepository_;
};
}  // namespace application::services
