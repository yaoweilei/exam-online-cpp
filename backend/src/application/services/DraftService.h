#pragma once

// 续考 Service（业务功能 4）：薄包装，便于将来扩展（例如：自动判定是否仍有未答题）
#include <string>

#include <json/json.h>

#include "infrastructure/storage/DraftRepository.h"

namespace application::services
{
class DraftService
{
  public:
    explicit DraftService(infrastructure::storage::DraftRepository &repository);

    // 拉取草稿；不存在返回 Json::nullValue
    Json::Value get(const std::string &userId) const;

    // 保存草稿；patch 至少包含 exam_id
    Json::Value save(const std::string &userId, const Json::Value &patch);

    // 删除草稿
    bool clear(const std::string &userId);

    void markSubmitted(const std::string &userId, const std::string &examId, const std::string &attemptId);

  private:
    infrastructure::storage::DraftRepository &repository_;
};
}  // namespace application::services
