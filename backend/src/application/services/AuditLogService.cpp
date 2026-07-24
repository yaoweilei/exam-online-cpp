#include "AuditLogService.h"

#include <algorithm>
#include <cctype>
#include <map>
#include <mutex>
#include <set>

#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
Json::Value safeRead(const std::filesystem::path &path)
{
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec) return Json::Value(Json::nullValue);
    try
    {
        return infrastructure::storage::readJsonFile(path);
    }
    catch (...)
    {
        return Json::Value(Json::nullValue);
    }
}

std::string actionLabel(const std::string &action)
{
    static const std::map<std::string, std::string> labels{
        {"account.deactivated", "注销账号"},
        {"assignment.create", "创建作业"},
        {"assignment.remind", "催交作业"},
        {"assignment.reminder.sent", "发送作业催交通知"},
        {"assignment.review", "批改作业"},
        {"campus.created", "创建校区"},
        {"campus.updated", "更新校区"},
        {"course_package.created", "创建课程包"},
        {"course_package.updated", "更新课程包"},
        {"feature_flags.organization.updated", "修改机构功能开关"},
        {"feature_flags.system.updated", "修改系统功能开关"},
        {"feedback.status.updated", "修改反馈状态"},
        {"invitation.created", "创建成员邀请"},
        {"learning_group.completed", "结束学习组"},
        {"learning_group.created", "创建学习组"},
        {"learning_group.enrollment_saved", "保存学习组成员"},
        {"learning_group.manage", "管理学习组"},
        {"learning_group.updated", "更新学习组"},
        {"member.added", "添加机构成员"},
        {"member.removed", "移除机构成员"},
        {"member.updated", "更新机构成员"},
        {"organization.created", "创建机构"},
        {"organization.member.manage", "管理机构成员"},
        {"payment.refund", "处理退款"},
        {"payment.refund.requested", "申请退款"},
        {"role_permissions.updated", "更新角色权限"},
        {"subscription.updated", "更新订阅"},
        {"wrong_questions.reset", "清空错题本"},
    };
    const auto it = labels.find(action);
    return it == labels.end() ? action : it->second;
}

std::string archiveMonth(const Json::Value &log)
{
    const auto createdAt = log.get("created_at", "").asString();
    const auto isDigit = [](unsigned char c) { return std::isdigit(c) != 0; };
    if (createdAt.size() >= 7 && createdAt[4] == '-' &&
        std::all_of(createdAt.begin(), createdAt.begin() + 4, isDigit) &&
        std::all_of(createdAt.begin() + 5, createdAt.begin() + 7, isDigit))
    {
        return createdAt.substr(0, 7);
    }
    return "unknown";
}

void appendUnique(Json::Value &target, const Json::Value &items)
{
    std::set<std::string> knownIds;
    for (const auto &item : target)
    {
        const auto id = item.get("audit_id", "").asString();
        if (!id.empty()) knownIds.insert(id);
    }
    for (const auto &item : items)
    {
        const auto id = item.get("audit_id", "").asString();
        if (!id.empty() && !knownIds.insert(id).second) continue;
        target.append(item);
    }
}
}  // namespace

AuditLogService::AuditLogService(std::filesystem::path userRootDir,
                                 infrastructure::storage::OrganizationRepository &orgRepo,
                                 std::size_t maxActivePlatformLogs)
    : orgFile_(userRootDir / "organizations.json"),
      platformFile_(userRootDir / "audit_logs.json"),
      platformArchiveDir_(platformFile_.parent_path() / "audit_logs.archive"),
      maxActivePlatformLogs_((std::max)(std::size_t{1}, maxActivePlatformLogs)),
      orgRepo_(orgRepo),
      sqliteStore_(userRootDir / "core.sqlite3")
{
    if (sqliteStore_.count("audit_logs") == 0)
    {
        const auto importLogs = [&](const Json::Value &logs, const std::string &fallbackOrg = "") {
            if (!logs.isArray()) return;
            for (auto log : logs) { if (!fallbackOrg.empty() && log.get("org_id", "").asString().empty()) log["org_id"] = fallbackOrg; const auto id=log.get("audit_id", common::generateOpaqueId("audit_")).asString(); log["audit_id"]=id; sqliteStore_.upsert("audit_logs",id,log); }
        };
        const auto orgRoot=safeRead(orgFile_); if(orgRoot.isObject()) for(const auto &orgId:orgRoot.getMemberNames()) importLogs(orgRoot[orgId]["audit_logs"],orgId);
        std::error_code ec; if(std::filesystem::exists(platformArchiveDir_,ec)) for(const auto &entry:std::filesystem::directory_iterator(platformArchiveDir_,ec)) if(entry.is_regular_file()&&entry.path().extension()==".json") importLogs(safeRead(entry.path()));
        importLogs(safeRead(platformFile_));
    }
}

Json::Value AuditLogService::loadAllLogs(const std::optional<std::string> &orgIdFilter) const
{
    Json::Value out(Json::arrayValue);
    std::shared_lock lock(mutex_);
    for(const auto &log:sqliteStore_.list("audit_logs")) if(!orgIdFilter||log.get("org_id","").asString()==*orgIdFilter) out.append(log);
    return out;
}

void AuditLogService::record(const std::string &action,
                             const std::string &actorUserId,
                             const std::string &summary,
                             const Json::Value &details,
                             const std::string &orgId)
{
    Json::Value entry(Json::objectValue);
    entry["audit_id"] = common::generateOpaqueId("audit_");
    entry["action"] = action;
    entry["actor_user_id"] = actorUserId;
    entry["created_at"] = common::nowIso8601();
    entry["summary"] = summary;
    entry["details"] = details.isNull() ? Json::Value(Json::objectValue) : details;
    entry["scope"] = orgId.empty() ? "platform" : "organization";
    if (!orgId.empty()) entry["org_id"] = orgId;

    std::unique_lock lock(mutex_);
    sqliteStore_.upsert("audit_logs", entry["audit_id"].asString(), entry);
}

Json::Value AuditLogService::query(const AuditLogQuery &q) const
{
    const int offset = (std::max)(0, q.offset);
    const int limit = (std::max)(1, (std::min)(500, q.limit));
    std::size_t total = 0;
    auto items = sqliteStore_.queryAudit("audit_logs", q.orgId, q.actorId, q.action, q.since, q.until, limit, offset, total);
    for (auto &item : items) item["action_label"] = actionLabel(item.get("action", "").asString());

    Json::Value out(Json::objectValue);
    out["items"] = items;
    out["total"] = static_cast<Json::UInt64>(total);
    out["limit"] = limit;
    out["offset"] = offset;
    out["has_more"] = static_cast<std::size_t>(offset + limit) < total;
    return out;
}

Json::Value AuditLogService::listActions(const std::optional<std::string> &orgId) const
{
    auto all = loadAllLogs(orgId);
    std::set<std::string> uniq;
    for (const auto &log : all)
    {
        const auto a = log.get("action", "").asString();
        if (!a.empty()) uniq.insert(a);
    }
    Json::Value arr(Json::arrayValue);
    Json::Value options(Json::arrayValue);
    for (const auto &a : uniq)
    {
        arr.append(a);
        Json::Value option(Json::objectValue);
        option["value"] = a;
        option["label"] = actionLabel(a);
        options.append(option);
    }
    Json::Value out(Json::objectValue);
    out["actions"] = arr;
    out["action_options"] = options;
    return out;
}

std::string AuditLogService::firstOrgIdOfUser(const std::string &userId) const
{
    const auto orgs = orgRepo_.listOrganizationsForUser(userId);
    if (orgs.isArray() && !orgs.empty())
    {
        return orgs[0].get("organization_id", orgs[0].get("scope_id", "")).asString();
    }
    return "";
}
}  // namespace application::services
