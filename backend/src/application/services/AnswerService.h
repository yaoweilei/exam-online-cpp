#pragma once

#include <cmath>
#include <cctype>
#include <string>

#include <json/json.h>

#include "common/TimeUtils.h"
#include "infrastructure/storage/AnswerRepository.h"

namespace application::services
{
class AnswerService
{
  public:
    explicit AnswerService(infrastructure::storage::AnswerRepository &repository);

    Json::Value calculateScore(const std::string &examId,
                               const Json::Value &answers,
                               const Json::Value &examData) const;

    Json::Value save(const std::string &userId,
                     const std::string &examId,
                     const Json::Value &answers,
                     const Json::Value &statistics,
                     const std::string &submissionId = "");

    Json::Value load(const std::string &userId, const std::string &examId) const;

    Json::Value progress(const std::string &userId) const;

    Json::Value examProgress(const std::string &userId) const;

    Json::Value attempts(const std::string &userId, const std::string &examId, int limit = 20) const;

  private:
    static std::string normalizeAnswer(const Json::Value &value);

    static double round2(double value);

  private:
    infrastructure::storage::AnswerRepository &repository_;
};
}  // namespace application::services
