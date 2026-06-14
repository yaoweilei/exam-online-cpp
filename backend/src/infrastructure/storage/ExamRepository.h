#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <optional>
#include <regex>
#include <shared_mutex>
#include <unordered_map>
#include <vector>

#include <json/json.h>

#include "JsonIo.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "domain/Models.h"

namespace infrastructure::storage
{
class ExamRepository
{
  public:
    explicit ExamRepository(std::filesystem::path rootDir)
;

    void rebuildIndex();

    std::vector<domain::ExamSummary> listExams() const;

    Json::Value getExamById(const std::string &examId);

    void saveExam(const std::string &examId, const Json::Value &payload);

    void deleteExam(const std::string &examId);

  private:
    std::filesystem::path buildStoragePath(const std::string &examId, const Json::Value &payload) const;

    std::optional<domain::ExamSummary> parseSummary(const std::filesystem::path &path) const;

    static int countQuestions(const Json::Value &examInfo);

    static std::vector<std::string> splitExamId(const std::string &examId);

  private:
    std::filesystem::path rootDir_;
    std::filesystem::path indexFile_;
    mutable std::shared_mutex mutex_;
    std::vector<domain::ExamSummary> exams_;
    std::unordered_map<std::string, std::filesystem::path> fileIndex_;
    std::unordered_map<std::string, Json::Value> examCache_;
};
}  // namespace infrastructure::storage
