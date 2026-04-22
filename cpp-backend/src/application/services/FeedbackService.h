#pragma once

// 题目反馈/纠错 Service（业务功能 5）
// - submit：用户提交（可校验类别枚举 + 长度上限）
// - list / update：仅暴露给运营管理员

#include <string>

#include <json/json.h>

#include "infrastructure/storage/FeedbackRepository.h"

namespace application::services
{
class FeedbackService
{
  public:
    explicit FeedbackService(infrastructure::storage::FeedbackRepository &repository);

    // 提交反馈：必须包含 user_id / paper_id / question_id；校验后入库
    Json::Value submit(const Json::Value &payload);

    // 列表（运营）：paperId 可空 = 全部
    Json::Value list(const std::string &paperId, const std::string &status) const;

    // 更新（运营）：仅支持 status / admin_note
    Json::Value update(const std::string &paperId,
                       const std::string &feedbackId,
                       const Json::Value &patch);

  private:
    infrastructure::storage::FeedbackRepository &repository_;
};
}  // namespace application::services
