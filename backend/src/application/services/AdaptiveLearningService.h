#pragma once

#include <filesystem>
#include <mutex>
#include <string>

#include <json/json.h>

namespace application::services
{
class AdaptiveLearningService
{
  public:
    explicit AdaptiveLearningService(std::filesystem::path userRootDir);

    void recordSubmission(const std::string &userId,
                          const std::string &examId,
                          const Json::Value &exam,
                          const Json::Value &score);

    Json::Value profile(const std::string &userId, const std::string &examTarget = "JLPT N2") const;

  private:
    std::filesystem::path fileFor(const std::string &userId) const;
    static std::string sanitize(const std::string &value);
    static Json::Value summarize(const Json::Value &observations);
    static void appendObservation(Json::Value &observations, const Json::Value &observation);

    std::filesystem::path rootDir_;
    mutable std::mutex mutex_;
};
}  // namespace application::services
