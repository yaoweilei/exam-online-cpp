#pragma once

#include <filesystem>
#include <mutex>
#include <string>
#include <vector>
#include <json/json.h>

#include "infrastructure/storage/ExamRepository.h"

namespace application::services
{
class ContentWorkflowService
{
  public:
    ContentWorkflowService(std::filesystem::path systemDir, infrastructure::storage::ExamRepository &examRepository);
    Json::Value inspect(const std::string &examId, const std::string &actorId);
    Json::Value inspectBatch(const std::vector<std::string> &examIds, const std::string &actorId);
    Json::Value review(const std::string &examId, const std::string &stage, const Json::Value &payload, const std::string &actorId);
    Json::Value enqueuePublish(const std::string &examId, const std::string &actorId);
    Json::Value listQueue() const;
    Json::Value listItems() const;
    Json::Value listVersions(const std::string &examId) const;
    Json::Value rollback(const std::string &examId, const std::string &versionId, const std::string &actorId);
    Json::Value recordDraft(const std::string &examId, const std::string &actorId);

  private:
    Json::Value loadState() const;
    void saveState(const Json::Value &state) const;
    Json::Value buildInspection(const std::string &examId, const Json::Value &exam) const;
    Json::Value createVersion(Json::Value &state, const std::string &examId, const std::string &kind, const std::string &actorId);
    static std::string nowIso();

    std::filesystem::path workflowDir_;
    std::filesystem::path stateFile_;
    std::filesystem::path versionsDir_;
    infrastructure::storage::ExamRepository &examRepository_;
    mutable std::mutex mutex_;
};
}
