#pragma once

// 答题计时 Service（业务功能 3：答题计时与分段限时）
// - 在 Repository 之上做"剩余时间/是否超时"派生字段计算，便于前端直接使用
#include <string>

#include <json/json.h>

#include "infrastructure/storage/AttemptTimerRepository.h"

namespace application::services
{
class AttemptTimerService
{
  public:
    explicit AttemptTimerService(infrastructure::storage::AttemptTimerRepository &repository);

    // 拉取当前计时；不存在返回 Json::nullValue
    Json::Value get(const std::string &userId) const;

    // 启动 / 重置计时
    Json::Value start(const std::string &userId, const Json::Value &patch);

    // 累加心跳并返回最新（含派生字段：剩余/超时）
    Json::Value tick(const std::string &userId, const Json::Value &payload);

    // 完成 / 放弃
    bool clear(const std::string &userId);

  private:
    // 在原始文档上追加派生字段：total_remaining_seconds、section_remaining_seconds、expired、section_expired
    Json::Value enrich(const Json::Value &doc, int sectionIndex) const;

    infrastructure::storage::AttemptTimerRepository &repository_;
};
}  // namespace application::services
