#pragma once

// 业务功能 15：审计日志可视化 Service
//
// 数据来源（一期）：data/user/organizations.json 中各组织 audit_logs 数组
//   每条字段：audit_id, action, actor_user_id, actor_username, created_at,
//             details, summary（部分缺失时容忍）
// 输出：合并 + 过滤 + 倒序 + 分页
//
// 安全：路由层 requireRole({superAdmin, orgAdmin})；
//   - orgAdmin 必须强制其 orgIdFilter == 自己的 org（路由内注入）
//   - superAdmin 可不传 orgIdFilter 看全部

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/OrganizationRepository.h"

namespace application::services
{
struct AuditLogQuery
{
    std::optional<std::string> orgId;     // 限定组织
    std::optional<std::string> actorId;   // actor_user_id 精确匹配
    std::optional<std::string> action;    // action 精确匹配（如 "subscription.updated"）
    std::optional<std::string> since;     // ISO8601 起始（含）
    std::optional<std::string> until;     // ISO8601 结束（不含）
    int limit{50};
    int offset{0};
};

class AuditLogService
{
  public:
    AuditLogService(std::filesystem::path userRootDir,
                    infrastructure::storage::OrganizationRepository &orgRepo);

    // 返回 { items: [...], total, has_more, limit, offset }
    Json::Value query(const AuditLogQuery &q) const;

    // 列出去重的 action 类型，用于前端筛选下拉
    Json::Value listActions(const std::optional<std::string> &orgId) const;

    // 查询 actor 第一个所属组织的 ID（供路由层在 orgAdmin 路径上强制范围）
    std::string firstOrgIdOfUser(const std::string &userId) const;

  private:
    Json::Value loadAllLogs(const std::optional<std::string> &orgIdFilter) const;

    std::filesystem::path orgFile_;
    infrastructure::storage::OrganizationRepository &orgRepo_;
};
}  // namespace application::services
