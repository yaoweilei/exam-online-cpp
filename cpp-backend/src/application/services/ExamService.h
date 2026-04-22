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
;

    Json::Value listExams(const std::string &level, const std::string &year, const std::string &sort) const;

    Json::Value groupedByLevel() const;

    // userId may be empty (guest); access_level check still applies.
    Json::Value getExam(const std::string &examId, const std::string &userId = "guest") const;

    void createOrUpdateExam(const std::string &examId, const Json::Value &payload);

    void deleteExam(const std::string &examId);

  private:
    infrastructure::storage::ExamRepository &repository_;
    application::services::SubscriptionService &subscriptionService_;
};
}  // namespace application::services
