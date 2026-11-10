#pragma once

#include <chrono>
#include <filesystem>
#include <fstream>
#include <optional>
#include <regex>
#include <string>
#include <json/json.h>

namespace application::services
{
// Read job evidence only. This never starts, schedules or restores a backup.
inline std::optional<std::chrono::sys_seconds> backupUtcTime(const std::string &text)
{
    static const std::regex pattern(R"(^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|\+00:00)$)");
    std::smatch m;
    if (!std::regex_match(text, m, pattern)) return std::nullopt;
    const auto number = [&](size_t i) { return std::stoi(m[i].str()); };
    const std::chrono::year_month_day date{std::chrono::year{number(1)}, std::chrono::month{unsigned(number(2))}, std::chrono::day{unsigned(number(3))}};
    if (!date.ok() || number(4)>23 || number(5)>59 || number(6)>59) return std::nullopt;
    return std::chrono::sys_days{date}+std::chrono::hours{number(4)}+std::chrono::minutes{number(5)}+std::chrono::seconds{number(6)};
}

inline Json::Value readBackupStatus(const std::filesystem::path &statusFile,
                                   const std::filesystem::path &dataRoot,
                                   std::chrono::system_clock::time_point now = std::chrono::system_clock::now(),
                                   std::chrono::hours maxAge = std::chrono::hours{72})
{
    Json::Value out(Json::objectValue);
    out["name"]="数据备份校验"; out["ready"]=false; out["configured"]=!statusFile.empty();
    const auto fail = [&](const char *state, const char *detail) { out["state"]=state; out["detail"]=detail; return out; };
    if (statusFile.empty()) return fail("not_configured", "尚未配置备份状态来源，未验证自动备份是否运行");
    try
    {
        if (!std::filesystem::is_regular_file(statusFile)) return fail("missing", "找不到备份任务记录，请检查任务是否执行");
        if (std::filesystem::file_size(statusFile)>1024*1024) return fail("invalid", "备份任务记录异常，请检查本机记录");
        std::ifstream input(statusFile, std::ios::binary);
        Json::CharReaderBuilder reader;
        reader["collectComments"]=false;
        Json::Value value; std::string error;
        if (!Json::parseFromStream(reader,input,&value,&error) || !value.isObject() || value.get("schema_version",0)!=1)
            return fail("invalid", "无法读取有效的备份任务记录");
        const auto source=value.get("data_root", "").asString();
        if (source.empty() || !std::filesystem::equivalent(source,dataRoot)) return fail("wrong_source", "备份记录与当前业务数据目录不一致");
        const auto state=value.get("state", "").asString();
        if (state!="succeeded" && state!="running" && state!="failed") return fail("invalid", "备份任务状态无效");
        const auto success=value.get("last_successful_at", "").asString();
        const auto verified=backupUtcTime(success);
        const auto createdText=value.get("last_successful_backup_created_at", "").asString();
        const auto created=backupUtcTime(createdText);
        if (verified && *verified<=now+std::chrono::minutes{5}) out["last_verified_at"]=success;
        if (created && *created<=now+std::chrono::minutes{5}) out["backup_created_at"]=createdText;
        if (state=="failed") return fail("failed", "最近一次备份任务失败，请检查本机任务日志；先前成功记录不代表本次成功");
        if (!verified || !created) return fail("unverified", "尚无完整的成功校验与备份生成时间记录");
        if (*verified>now+std::chrono::minutes{5} || *created>*verified) return fail("invalid", "备份记录时间顺序异常，请检查时钟与记录");
        if (now-*verified>maxAge || now-*created>maxAge) return fail("stale", "备份生成或成功校验已超出72小时间隔，请检查备份任务；重新校验旧副本不等于生成新备份");
        if (state=="running")
        {
            const auto started=backupUtcTime(value.get("started_at", "").asString());
            if (!started || *started>now+std::chrono::minutes{5} || now-*started>std::chrono::hours{2})
                return fail("stalled", "备份任务长时间未结束，请检查本机任务日志");
            out["ready"]=true; out["state"]="running"; out["detail"]="备份任务正在运行，最近一次成功校验仍在有效期内";
        }
        else
        {
            const auto finished=backupUtcTime(value.get("finished_at", "").asString());
            if (!finished || *finished!=*verified) return fail("invalid", "备份完成时间与校验记录不一致");
            out["ready"]=true; out["state"]="succeeded"; out["detail"]="最近一次备份任务校验成功；此状态不替代恢复演练";
        }
        return out;
    }
    catch (...) { return fail("invalid", "无法读取备份任务记录，请检查本机配置"); }
}
}
