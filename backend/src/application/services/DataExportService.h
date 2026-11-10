#pragma once

// 业务功能 10：用户数据导出 Service
//
// 设计：
//   - 不引入新的存储；直接读取已有 data/user/{module}/{userId}.json
//     与 AnswerRepository / AttemptTimerRepository 的实际存储，聚合个人数据。
//   - 用于「下载我的数据」（GDPR/个人信息可携带权 类需求）。
//
// 包含模块（缺失则模块字段为 null，不会抛错）：
//   - profile, bookmarks, wrong_questions, streak, draft, attempt_timer,
//     srs, bookmark_folders
//   - answers: 最新 examId → 答题快照；answer_history: 历史/尝试去重后的快照
//   - study_goals, recent_learning, daily_practice；manifest 记录范围、计数和读取异常
//   - feedback：仅返回 reporter_id == userId 的若干条（避免暴露他人）
//
// 安全性：
//   - 服务本身不做权限校验，调用方（路由）负责 requireSelf-or-superAdmin。
//   - 拒绝不安全的 userId；不导出内部教师备注和反馈内部处理记录。

#include <filesystem>
#include <string>

#include <json/json.h>
#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/AttemptTimerRepository.h"

namespace application::services
{
class DataExportService
{
  public:
    DataExportService(std::filesystem::path userRootDir,
                      std::filesystem::path systemDir,
                      infrastructure::storage::AnswerRepository &answers,
                      infrastructure::storage::AttemptTimerRepository &timers);

    // 聚合该用户全部数据快照
    Json::Value exportUserData(const std::string &userId) const;

  private:
    std::filesystem::path userRootDir_;
    std::filesystem::path systemDir_;
    infrastructure::storage::AnswerRepository &answers_;
    infrastructure::storage::AttemptTimerRepository &timers_;
};
}  // namespace application::services
