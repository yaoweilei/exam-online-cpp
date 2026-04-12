#pragma once

#include <algorithm>
#include <string>
#include <tuple>
#include <vector>

#include "domain/Models.h"
#include "infrastructure/storage/ExamRepository.h"
#include "application/services/SubscriptionService.h"

namespace application::services
{
class ExamService
{
  public:
    explicit ExamService(infrastructure::storage::ExamRepository &repository,
                         application::services::SubscriptionService &subscriptionService)
        : repository_(repository), subscriptionService_(subscriptionService)
    {
    }

    Json::Value listExams(const std::string &level, const std::string &year, const std::string &sort) const
    {
        auto exams = repository_.listExams();
        exams.erase(std::remove_if(exams.begin(), exams.end(), [&](const domain::ExamSummary &item) {
                       if (!level.empty() && item.level != level)
                       {
                           return true;
                       }
                       if (!year.empty() && item.year != year)
                       {
                           return true;
                       }
                       return false;
                   }),
                   exams.end());

        if (sort == "date_asc")
        {
            std::sort(exams.begin(), exams.end(), [](const auto &a, const auto &b) {
                return std::tie(a.year, a.session) < std::tie(b.year, b.session);
            });
        }
        else if (sort == "level")
        {
            std::sort(exams.begin(), exams.end(), [](const auto &a, const auto &b) {
                return std::tie(a.level, a.year, a.session) < std::tie(b.level, b.year, b.session);
            });
        }
        else
        {
            std::sort(exams.begin(), exams.end(), [](const auto &a, const auto &b) {
                return std::tie(a.year, a.session) > std::tie(b.year, b.session);
            });
        }

        Json::Value out(Json::arrayValue);
        for (const auto &item : exams)
        {
            out.append(item.toJson());
        }
        return out;
    }

    Json::Value groupedByLevel() const
    {
        Json::Value grouped(Json::objectValue);
        for (const auto &exam : repository_.listExams())
        {
            grouped[exam.level].append(exam.toJson());
        }
        return grouped;
    }

    // userId may be empty (guest); access_level check still applies.
    Json::Value getExam(const std::string &examId, const std::string &userId = "guest") const
    {
        // First check if the exam exists by peeking at the index
        const auto &exams = repository_.listExams();
        const auto it = std::find_if(exams.begin(), exams.end(),
                                     [&](const domain::ExamSummary &s) { return s.id == examId; });
        if (it != exams.end())
        {
            subscriptionService_.requireAccess(userId, it->accessLevel);
        }
        return repository_.getExamById(examId);
    }

    void createOrUpdateExam(const std::string &examId, const Json::Value &payload)
    {
        repository_.saveExam(examId, payload);
    }

    void deleteExam(const std::string &examId)
    {
        repository_.deleteExam(examId);
    }

  private:
    infrastructure::storage::ExamRepository &repository_;
    application::services::SubscriptionService &subscriptionService_;
};
}  // namespace application::services
