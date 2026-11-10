#pragma once

// 业务功能 11：管理员统计 Service
//
// 用户与机构统计读取当前仓库；活动文件按需聚合。
//
// 输出（overview）：
//   {
//     generated_at,
//     users:        { total, by_role:{teacher,orgAdmin,...} },
//     organizations:{ total },
//     content:      { exam_files },
//     activity:     { answer_users, answer_papers,
//                     wrong_question_users, srs_users,
//                     bookmark_folder_users, feedback_papers, feedback_items }
//   }
//
// 安全性：路由层 requireRole({"superAdmin"}) + requireFeature("admin_dashboard")。

#include <filesystem>
#include <string>

#include <json/json.h>
#include "infrastructure/storage/UserRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"

namespace application::services
{
class AdminStatisticsService
{
  public:
    AdminStatisticsService(std::filesystem::path userRootDir,
                          std::filesystem::path systemDir,
                          std::filesystem::path paperDir,
                          infrastructure::storage::UserRepository &users,
                          infrastructure::storage::OrganizationRepository &organizations);

    // 全站概览
    Json::Value overview() const;

  private:
    infrastructure::storage::UserRepository &users_;
    infrastructure::storage::OrganizationRepository &organizations_;
    std::filesystem::path userRootDir_;
    std::filesystem::path systemDir_;
    std::filesystem::path paperDir_;
};
}  // namespace application::services
