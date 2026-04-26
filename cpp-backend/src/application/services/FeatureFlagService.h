#pragma once

// 功能开关 Service（横切核心）
//
// 设计原则：
//   1) 静态注册表：所有可用 flag 的 key、默认值、是否允许 org/user 覆盖、面向用户的中文名
//      —— 写在 .cpp 内一个 std::array 里，杜绝魔法字符串与未授权 key
//   2) 三层解析：system → 用户所属组织（可能多个，命中第一个 lock 即停） → user
//      —— 任何一层 enabled = false 都会让最终结果 false（除非更高层 lock）
//      —— "lock" 含义：禁止下层覆盖；同层后写覆盖前写
//   3) 写入校验：只允许写注册表中已知的 key；写失败抛 AppException
//
// 接口：
//   - resolveAll(userId)   返回所有 flag 的最终结果（含 enabled、source、locked_by）
//   - isEnabled(key, userId)  快速判定（路由保护用）
//   - listRegistry()       返回完整注册表（管理员页面用）
//   - updateSystemFlag/updateOrgFlag/updateUserFlag  分层写入

#include <array>
#include <string>
#include <string_view>

#include <json/json.h>

#include "infrastructure/storage/FeatureFlagRepository.h"
#include "infrastructure/storage/OrganizationRepository.h"

namespace application::services
{
struct FeatureFlagDef
{
    std::string_view key;
    std::string_view nameZh;
    std::string_view descZh;
    bool defaultEnabled;
    bool allowOrgOverride;
    bool allowUserOverride;
};

class FeatureFlagService
{
  public:
    FeatureFlagService(infrastructure::storage::FeatureFlagRepository &repo,
                       infrastructure::storage::OrganizationRepository &orgRepo);

    // 已注册 flag 列表
    static const std::array<FeatureFlagDef, 24> &registry();

    // 给前端用：注册表 + 当前用户解析结果
    Json::Value listRegistry() const;
    Json::Value resolveAll(const std::string &userId) const;

    // 路由保护：true 表示放行；userId 为空时按 system + 默认值
    bool isEnabled(const std::string &key, const std::string &userId) const;

    // 单个 flag 解析详情（含 source / locked_by / enabled）
    Json::Value resolveOne(const std::string &key, const std::string &userId) const;

    // 写入：传入 { "<key>": { enabled, lock? } }；仅注册表内的 key 会被持久化
    Json::Value updateSystemFlags(const Json::Value &patch);
    Json::Value updateOrgFlags(const std::string &orgId, const Json::Value &patch);
    Json::Value updateUserFlags(const std::string &userId, const Json::Value &patch);

  private:
    static const FeatureFlagDef *findDef(const std::string &key);

    // 合并写入：existing 中已有的 key 保留，patch 中的 key 覆盖；移除不在注册表的 key
    static Json::Value sanitize(const Json::Value &existing, const Json::Value &patch, bool allowLock);

    infrastructure::storage::FeatureFlagRepository &repo_;
    infrastructure::storage::OrganizationRepository &orgRepo_;
};
}  // namespace application::services
