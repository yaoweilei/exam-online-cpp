#include "FeatureFlagService.h"

#include <utility>
#include <vector>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"

namespace application::services
{

// 静态注册表：所有可用的功能开关
//   - allowOrgOverride / allowUserOverride 决定能否在该层写入；
//     若 false，则对应层写入时被忽略（管理员页面也应据此隐藏控件）。
static const std::array<FeatureFlagDef, 24> kRegistry{{
    {"wrong_questions", "错题本", "错题自动沉淀与复习入口", true, true, true},
    {"streak", "学习连续天数", "每日目标与连续学习天数统计", true, true, true},
    {"exam_timer", "答题计时与限时", "全卷/分段限时和顶部计时条", true, true, true},
    {"resume_draft", "上次未完成自动续考", "自动保存答题草稿与续考横幅", true, true, true},
    {"question_feedback", "题目反馈/纠错", "用户报错入口与运营后台查看", true, true, true},
    {"learning_groups", "学习组与作业", "学习组管理、布置作业及学生作业汇总", true, true, true},
    {"srs", "间隔重复复习", "SM-2 调度的错题复习卡", true, true, true},
    {"bookmark_folders", "收藏分类", "自定义文件夹组织收藏的试卷", true, true, true},
    {"audio_enhancement", "音频增强", "听力题变速、循环与 AB 复读", true, true, true},
    {"data_export", "数据导出", "下载个人全部数据的 JSON 快照", true, true, true},
    {"admin_dashboard", "管理员仪表盘", "超管可查看用户/组织/活跃度聚合统计", true, false, false},
    {"community", "社区讨论", "试卷下发帖/评论/点赞", false, true, true},
    {"audit_log_viewer", "审计日志查看器", "超管/组织管理员查看、筛选与导出审计日志", true, false, false},
    {"pwa", "PWA 离线与安装", "注册 Service Worker、静态资源与 API 缓存、安装到桌面", true, true, true},
    {"daily_practice", "每日一练", "每日自动混编错题 + SRS 到期题", true, true, true},
    {"learning_report", "学习报告", "周/月小结：答题/错题/SRS/连续天数", true, true, true},
    {"study_goal", "备考目标 / 倒计时", "设置考试日期与每日题量目标", true, true, true},
    {"sync_devices", "多端同步", "跨设备拉取个人数据快照，服务端为准", true, true, true},
    {"leaderboard", "排行榜", "周/月/总榜：连胜 + 答题量 + 正确率", false, true, true},
    {"oauth_extra", "第三方 OAuth", "Google 真实登录", true, false, false},
    {"vocab_notebook", "个人生词本", "题面/听力原文点词查词并加入个人词本", true, true, true},
    {"wrong_question_tags", "错题归因维度", "为错题打上词汇/语法/粗心等标签用于复盘", true, true, true},
    {"related_questions", "同考点串题", "基于 target_words 聚合同考点的历届真题", true, true, true},
    {"chapter_path", "章节式学习路径", "按 section 聚合跨卷题目形成章节与进度视图", true, true, true},
}};

const std::array<FeatureFlagDef, 24> &FeatureFlagService::registry()
{
    return kRegistry;
}

const FeatureFlagDef *FeatureFlagService::findDef(const std::string &key)
{
    for (const auto &d : kRegistry)
    {
        if (d.key == key)
        {
            return &d;
        }
    }
    return nullptr;
}

FeatureFlagService::FeatureFlagService(infrastructure::storage::FeatureFlagRepository &repo,
                                       infrastructure::storage::OrganizationRepository &orgRepo)
    : repo_(repo), orgRepo_(orgRepo)
{
}

Json::Value FeatureFlagService::listRegistry() const
{
    Json::Value arr(Json::arrayValue);
    for (const auto &d : kRegistry)
    {
        Json::Value item(Json::objectValue);
        item["key"] = std::string(d.key);
        item["name"] = std::string(d.nameZh);
        item["description"] = std::string(d.descZh);
        item["default_enabled"] = d.defaultEnabled;
        item["allow_org_override"] = d.allowOrgOverride;
        item["allow_user_override"] = d.allowUserOverride;
        arr.append(item);
    }
    return arr;
}

namespace
{
// 在层 layer 中读取 key 的 enabled / lock；若没设置返回 std::nullopt 风格用 has=false
struct LayerValue
{
    bool has{false};
    bool enabled{false};
    bool lock{false};
};

LayerValue readLayer(const Json::Value &layer, const std::string &key)
{
    LayerValue v;
    if (!layer.isObject() || !layer.isMember(key) || !layer[key].isObject())
    {
        return v;
    }
    const auto &node = layer[key];
    v.has = true;
    v.enabled = node.get("enabled", true).asBool();
    v.lock = node.get("lock", false).asBool();
    return v;
}
}  // namespace

Json::Value FeatureFlagService::resolveOne(const std::string &key, const std::string &userId) const
{
    const auto *def = findDef(key);
    if (def == nullptr)
    {
        throw common::AppException("FEATURE_FLAG_UNKNOWN",
                                   "未知功能开关: " + key,
                                   drogon::k404NotFound);
    }

    Json::Value out(Json::objectValue);
    out["key"] = key;

    // 1) 默认值
    bool enabled = def->defaultEnabled;
    std::string source = "default";
    bool locked = false;
    std::string lockedBy;

    // 2) system 层
    const auto sys = readLayer(repo_.loadSystemFlags(), key);
    if (sys.has)
    {
        enabled = sys.enabled;
        source = "system";
        if (sys.lock)
        {
            locked = true;
            lockedBy = "system";
        }
    }

    // 3) org 层（取用户所属第一个组织；若多组织且需要更精细的优先级，将来可改成"任一关闭即关闭"）
    if (!locked && def->allowOrgOverride && !userId.empty())
    {
        const auto orgs = orgRepo_.listOrganizationsForUser(userId);
        if (orgs.isArray())
        {
            for (const auto &org : orgs)
            {
                const auto orgId = org.get("organization_id", org.get("id", "")).asString();
                if (orgId.empty())
                {
                    continue;
                }
                const auto layer = readLayer(repo_.loadOrgFlags(orgId), key);
                if (!layer.has)
                {
                    continue;
                }
                // 命中：覆盖 enabled，并记录 source；若 lock = true，停止继续向下解析
                enabled = layer.enabled;
                source = "org";
                out["organization_id"] = orgId;
                if (layer.lock)
                {
                    locked = true;
                    lockedBy = "org";
                }
                break;
            }
        }
    }

    // 4) user 层
    if (!locked && def->allowUserOverride && !userId.empty())
    {
        const auto layer = readLayer(repo_.loadUserFlags(userId), key);
        if (layer.has)
        {
            enabled = layer.enabled;
            source = "user";
        }
    }

    out["enabled"] = enabled;
    out["source"] = source;
    out["locked"] = locked;
    if (locked)
    {
        out["locked_by"] = lockedBy;
    }
    out["allow_org_override"] = def->allowOrgOverride;
    out["allow_user_override"] = def->allowUserOverride;
    return out;
}

Json::Value FeatureFlagService::resolveAll(const std::string &userId) const
{
    // 批量解析时各层只读取一次。此前逐项调用 resolveOne 会为每个开关重复
    // 解析 organizations.json / memberships.json，在机构数据增长后会拖慢整个登录流程。
    const auto systemFlags = repo_.loadSystemFlags();
    std::vector<std::pair<std::string, Json::Value>> organizationLayers;
    Json::Value userFlags(Json::objectValue);
    if (!userId.empty())
    {
        const auto organizations = orgRepo_.listOrganizationsForUser(userId);
        if (organizations.isArray())
        {
            for (const auto &organization : organizations)
            {
                const auto orgId = organization.get("organization_id", organization.get("id", "")).asString();
                if (!orgId.empty()) organizationLayers.emplace_back(orgId, repo_.loadOrgFlags(orgId));
            }
        }
        userFlags = repo_.loadUserFlags(userId);
    }

    Json::Value out(Json::objectValue);
    for (const auto &d : kRegistry)
    {
        const std::string key(d.key);
        bool enabled = d.defaultEnabled;
        std::string source = "default";
        bool locked = false;
        std::string lockedBy;
        std::string organizationId;

        const auto system = readLayer(systemFlags, key);
        if (system.has)
        {
            enabled = system.enabled;
            source = "system";
            if (system.lock)
            {
                locked = true;
                lockedBy = "system";
            }
        }

        if (!locked && d.allowOrgOverride)
        {
            for (const auto &[orgId, layer] : organizationLayers)
            {
                const auto organization = readLayer(layer, key);
                if (!organization.has) continue;
                enabled = organization.enabled;
                source = "org";
                organizationId = orgId;
                if (organization.lock)
                {
                    locked = true;
                    lockedBy = "org";
                }
                break;
            }
        }

        if (!locked && d.allowUserOverride)
        {
            const auto user = readLayer(userFlags, key);
            if (user.has)
            {
                enabled = user.enabled;
                source = "user";
            }
        }

        Json::Value resolved(Json::objectValue);
        resolved["key"] = key;
        resolved["enabled"] = enabled;
        resolved["source"] = source;
        resolved["locked"] = locked;
        resolved["allow_org_override"] = d.allowOrgOverride;
        resolved["allow_user_override"] = d.allowUserOverride;
        if (!organizationId.empty()) resolved["organization_id"] = organizationId;
        if (locked) resolved["locked_by"] = lockedBy;
        out[key] = std::move(resolved);
    }
    return out;
}

Json::Value FeatureFlagService::systemSnapshot() const
{
    const auto systemFlags = repo_.loadSystemFlags();
    Json::Value out(Json::objectValue);
    for (const auto &def : kRegistry)
    {
        const std::string key(def.key);
        const auto configured = readLayer(systemFlags, key);
        Json::Value entry(Json::objectValue);
        entry["key"] = key;
        entry["name"] = std::string(def.nameZh);
        entry["description"] = std::string(def.descZh);
        entry["enabled"] = configured.has ? configured.enabled : def.defaultEnabled;
        entry["source"] = configured.has ? "system" : "default";
        entry["locked"] = configured.has && configured.lock;
        entry["allow_org_override"] = def.allowOrgOverride;
        entry["allow_user_override"] = def.allowUserOverride;
        out[key] = entry;
    }
    return out;
}

bool FeatureFlagService::isEnabled(const std::string &key, const std::string &userId) const
{
    try
    {
        const auto r = resolveOne(key, userId);
        return r.get("enabled", true).asBool();
    }
    catch (...)
    {
        // 注册表中不存在的 key 视为禁用，避免错误开放
        return false;
    }
}

Json::Value FeatureFlagService::sanitize(const Json::Value &existing,
                                         const Json::Value &patch,
                                         bool allowLock)
{
    // 起步：保留 existing 中"仍在注册表内"的 key
    Json::Value merged(Json::objectValue);
    if (existing.isObject())
    {
        for (const auto &k : existing.getMemberNames())
        {
            if (findDef(k) != nullptr)
            {
                merged[k] = existing[k];
            }
        }
    }
    if (!patch.isObject())
    {
        return merged;
    }
    // 应用 patch：仅注册表内的 key
    for (const auto &k : patch.getMemberNames())
    {
        if (findDef(k) == nullptr)
        {
            continue;
        }
        const auto &node = patch[k];
        if (node.isNull())
        {
            // null 表示"清除该层覆盖"
            merged.removeMember(k);
            continue;
        }
        if (!node.isObject())
        {
            continue;
        }
        Json::Value entry(Json::objectValue);
        entry["enabled"] = node.get("enabled", true).asBool();
        if (allowLock)
        {
            entry["lock"] = node.get("lock", false).asBool();
        }
        merged[k] = entry;
    }
    return merged;
}

Json::Value FeatureFlagService::updateSystemFlags(const Json::Value &patch)
{
    auto current = repo_.loadSystemFlags();
    auto next = sanitize(current, patch, /*allowLock=*/true);
    repo_.saveSystemFlags(next);
    return next;
}

Json::Value FeatureFlagService::updateOrgFlags(const std::string &orgId, const Json::Value &patch)
{
    auto current = repo_.loadOrgFlags(orgId);
    auto next = sanitize(current, patch, /*allowLock=*/true);
    repo_.saveOrgFlags(orgId, next);
    return next;
}

Json::Value FeatureFlagService::updateUserFlags(const std::string &userId, const Json::Value &patch)
{
    // 只允许 allowUserOverride = true 的 key 写入；过滤后再合并
    Json::Value filtered(Json::objectValue);
    if (patch.isObject())
    {
        for (const auto &k : patch.getMemberNames())
        {
            const auto *def = findDef(k);
            if (def == nullptr || !def->allowUserOverride)
            {
                continue;
            }
            filtered[k] = patch[k];
        }
    }
    auto current = repo_.loadUserFlags(userId);
    auto next = sanitize(current, filtered, /*allowLock=*/false);
    repo_.saveUserFlags(userId, next);
    return next;
}

}  // namespace application::services
