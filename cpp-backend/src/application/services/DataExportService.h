#pragma once

// 业务功能 10：用户数据导出 Service
//
// 设计：
//   - 不引入新的存储；直接读取已有 data/user/{module}/{userId}.json
//     与 data/user/answers/{userId}/*.json，把这些聚合成一份 JSON 快照。
//   - 用于「下载我的数据」（GDPR/个人信息可携带权 类需求）。
//
// 包含模块（缺失则模块字段为 null，不会抛错）：
//   - profile, bookmarks, wrong_questions, streak, draft, attempt_timer,
//     srs, bookmark_folders
//   - answers: 用户全部 examId → 答题快照
//   - feedback：仅返回 reporter_id == userId 的若干条（避免暴露他人）
//
// 安全性：
//   - 服务本身不做权限校验，调用方（路由）负责 requireSelf-or-superAdmin。
//   - userId 字符消毒（filename safe），与其他 per-user repo 一致。

#include <filesystem>
#include <string>

#include <json/json.h>

namespace application::services
{
class DataExportService
{
  public:
    DataExportService(std::filesystem::path userRootDir,
                      std::filesystem::path systemDir);

    // 聚合该用户全部数据快照
    Json::Value exportUserData(const std::string &userId) const;

  private:
    std::filesystem::path userRootDir_;
    std::filesystem::path systemDir_;
};
}  // namespace application::services
