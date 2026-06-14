#pragma once

// 功能开关 Repository（横切基础设施）
//
// 三层覆盖：system → org → user，下层未设置时回落到上层；
// 若某层显式 lock = true，则下层不可覆盖（只能由当前层或更高层修改）。
//
// 文件分布：
//   - system 默认：data/system/feature_flags.json
//     格式： { "flags": { "<key>": { "enabled": bool, "lock": bool } } }
//   - 组织覆盖：写在 organizations.json 中每个组织对象的 "feature_flags" 字段
//     格式： { "<key>": { "enabled": bool, "lock": bool } }
//   - 用户覆盖：写在 profile/{userId}.json 的 "feature_flags" 字段
//     格式： { "<key>": { "enabled": bool } }
//
// 本 Repository 只负责"读写存储"，"判定 enabled"逻辑放到 Service。

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

#include "OrganizationRepository.h"
#include "ProfileRepository.h"

namespace infrastructure::storage
{
class FeatureFlagRepository
{
  public:
    FeatureFlagRepository(std::filesystem::path systemDir,
                          OrganizationRepository &orgRepo,
                          ProfileRepository &profileRepo);

    // 读取系统级 flags（缺失返回空 object）
    Json::Value loadSystemFlags() const;

    // 写入系统级 flags（整体覆盖；调用方应先 load 再合并）
    void saveSystemFlags(const Json::Value &flags);

    // 读取组织级 flags
    Json::Value loadOrgFlags(const std::string &orgId) const;

    // 写入组织级 flags（合并到组织对象）
    void saveOrgFlags(const std::string &orgId, const Json::Value &flags);

    // 读取用户级 flags
    Json::Value loadUserFlags(const std::string &userId) const;

    // 写入用户级 flags（合并到 profile）
    void saveUserFlags(const std::string &userId, const Json::Value &flags);

  private:
    std::filesystem::path systemDir_;
    OrganizationRepository &orgRepo_;
    ProfileRepository &profileRepo_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
