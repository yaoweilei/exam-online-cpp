#pragma once

#include <algorithm>
#include <string>
#include <vector>

#include "RecommendationStrategy.h"
#include "application/services/ExamService.h"
#include "application/services/StatisticsService.h"

namespace application::recommendation
{
class RuleBasedRecommendationStrategy : public RecommendationStrategy
{
  public:
    RuleBasedRecommendationStrategy(const application::services::StatisticsService &statisticsService,
                                    const application::services::ExamService &examService)
        : statisticsService_(statisticsService), examService_(examService)
    {
    }

    Json::Value recommend(const std::string &userId, int limit) const override
    {
        Json::Value out(Json::arrayValue);
        auto weak = statisticsService_.weakPoints(userId);
        auto exams = examService_.listExams("", "", "date_desc");
        if (!weak.isArray() || !exams.isArray())
        {
            return out;
        }

        int count = 0;
        for (const auto &exam : exams)
        {
            if (count >= limit)
            {
                break;
            }
            Json::Value item(Json::objectValue);
            item["exam_id"] = exam.get("id", "").asString();
            item["reason"] = weak.empty() ? "latest_exam" : "weak_point_boost";
            item["score"] = weak.empty() ? 0.5 : 0.8;
            out.append(item);
            ++count;
        }
        return out;
    }

  private:
    const application::services::StatisticsService &statisticsService_;
    const application::services::ExamService &examService_;
};
}  // namespace application::recommendation
