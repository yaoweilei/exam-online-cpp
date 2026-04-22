#pragma once

// 业务功能 11：管理员统计 Service
//
// 设计：
//   - 直接扫描 data/user 与 data/system 目录得到聚合计数；
//     不引入新存储，避免重复维护索引。
//   - 全部为只读、按需计算（每次请求都重扫描），适合中小数据量
//     的内部仪表盘；如果数据量增长再切换到缓存或聚合任务。
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

namespace application::services
{
class AdminStatisticsService
{
  public:
    AdminStatisticsService(std::filesystem::path userRootDir,
                          std::filesystem::path systemDir,
                          std::filesystem::path paperDir);

    // 全站概览
    Json::Value overview() const;

  private:
    std::filesystem::path userRootDir_;
    std::filesystem::path systemDir_;
    std::filesystem::path paperDir_;
};
}  // namespace application::services
