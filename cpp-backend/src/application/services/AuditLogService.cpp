#include "AuditLogService.h"

#include <algorithm>
#include <set>

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
}  // namespace

AuditLogService::AuditLogService(std::filesystem::path userRootDir,
                                 infrastructure::storage::OrganizationRepository &orgRepo)
    : orgFile_(std::move(userRootDir) / "organizations.json"), orgRepo_(orgRepo)
{
}

Json::Value AuditLogService::loadAllLogs(const std::optional<std::string> &orgIdFilter) const
{
    Json::Value out(Json::arrayValue);
    const auto root = safeRead(orgFile_);
    if (!root.isObject()) return out;

    for (const auto &orgId : root.getMemberNames())
    {
        if (orgIdFilter && *orgIdFilter != orgId) continue;
        const auto &org = root[orgId];
        if (!org.isObject() || !org["audit_logs"].isArray()) continue;
        for (const auto &log : org["audit_logs"])
        {
            if (!log.isObject()) continue;
            // 注入 org_id 字段，便于前端展示
            Json::Value entry = log;
            entry["org_id"] = orgId;
            out.append(entry);
        }
    }
    return out;
}

Json::Value AuditLogService::query(const AuditLogQuery &q) const
{
    auto all = loadAllLogs(q.orgId);

    // 过滤
    std::vector<Json::Value> filtered;
    filtered.reserve(all.size());
    for (const auto &log : all)
    {
        if (q.actorId && log.get("actor_user_id", "").asString() != *q.actorId) continue;
        if (q.action && log.get("action", "").asString() != *q.action) continue;
        const auto created = log.get("created_at", "").asString();
        if (q.since && !created.empty() && created < *q.since) continue;
        if (q.until && !created.empty() && created >= *q.until) continue;
        filtered.push_back(log);
    }

    // 倒序（ISO8601 字符串可直接比较）
    std::sort(filtered.begin(), filtered.end(), [](const Json::Value &a, const Json::Value &b) {
        return a.get("created_at", "").asString() > b.get("created_at", "").asString();
    });

    // 分页
    const int total = static_cast<int>(filtered.size());
    const int offset = (std::max)(0, q.offset);
    const int limit = (std::max)(1, (std::min)(500, q.limit));
    const int end = (std::min)(total, offset + limit);

    Json::Value items(Json::arrayValue);
    for (int i = offset; i < end; ++i) items.append(filtered[i]);

    Json::Value out(Json::objectValue);
    out["items"] = items;
    out["total"] = total;
    out["limit"] = limit;
    out["offset"] = offset;
    out["has_more"] = end < total;
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
    for (const auto &a : uniq) arr.append(a);
    Json::Value out(Json::objectValue);
    out["actions"] = arr;
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
