#include "DataExportService.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>

#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
// userId 文件名安全消毒（同 BookmarkFolderRepository 的策略）
std::string sanitizeUserId(const std::string &userId)
{
    if (userId.empty())
    {
        return "_unknown";
    }
    std::string out;
    out.reserve(userId.size());
    for (char c : userId)
    {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (std::isalnum(uc) || c == '-' || c == '_' || c == '.')
        {
            out.push_back(c);
        }
        else
        {
            out.push_back('_');
        }
    }
    return out;
}

std::string nowIso8601Utc()
{
    using clock = std::chrono::system_clock;
    const auto now = clock::now();
    const auto time = clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &time);
#else
    gmtime_r(&time, &tm);
#endif
    char buf[32]{};
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

// 单文件 per-user 的常规模块路径
std::filesystem::path perUserFile(const std::filesystem::path &root,
                                  const std::string &module,
                                  const std::string &safeId)
{
    return root / module / (safeId + ".json");
}
}  // namespace

DataExportService::DataExportService(std::filesystem::path userRootDir,
                                     std::filesystem::path systemDir,
                                     infrastructure::storage::AnswerRepository &answers,
                                     infrastructure::storage::AttemptTimerRepository &timers)
    : userRootDir_(std::move(userRootDir)), systemDir_(std::move(systemDir)), answers_(answers), timers_(timers)
{
}

Json::Value DataExportService::exportUserData(const std::string &userId) const
{
    const auto safeId = sanitizeUserId(userId);
    if (userId.empty() || userId.size()>160 || safeId!=userId || userId=="." || userId=="..")
        throw common::AppException("VALIDATION_ERROR","用户编号不正确",drogon::k422UnprocessableEntity);

    Json::Value out(Json::objectValue);
    out["user_id"] = userId;
    out["exported_at"] = nowIso8601Utc();
    out["schema_version"] = 2;
    Json::Value manifest(Json::objectValue); manifest["warnings"]=Json::arrayValue; manifest["modules"]=Json::objectValue;
    manifest["scope"]="personal_learning_data";
    manifest["description"]="个人学习数据快照；不用于整站备份或恢复。complete 仅表示清单内模块读取无异常。";
    manifest["consistency"]="per_module_snapshot";
    manifest["not_included"]=Json::arrayValue;
    for (const auto *scope : {"账号密码和会话密钥","机构内部备注和他人资料","机构课务、作业和课时账目","订单、支付及退款记录","公共试卷媒体与平台运营数据"}) manifest["not_included"].append(scope);
    const auto read = [&](const std::string &module, const std::filesystem::path &path) {
        Json::Value value(Json::nullValue); std::error_code ec;
        if (std::filesystem::is_symlink(path,ec)) { Json::Value warning; warning["module"]=module; warning["code"]="symlink_skipped"; manifest["warnings"].append(warning); return value; }
        if (std::filesystem::exists(path,ec)) {
            try { value=infrastructure::storage::readJsonFile(path); }
            catch (...) { Json::Value warning; warning["module"]=module; warning["code"]="unreadable_record"; manifest["warnings"].append(warning); }
        } else if (ec) { Json::Value warning; warning["module"]=module; warning["code"]="unreadable_record"; manifest["warnings"].append(warning); }
        return value;
    };

    Json::Value modules(Json::objectValue);
    // 单文件 per-user 模块（按模块名约定：data/user/<module>/<userId>.json）
    modules["profile"] = read("profile", perUserFile(userRootDir_, "profile", safeId));
    modules["bookmarks"] = read("bookmarks", perUserFile(userRootDir_, "bookmarks", safeId));
    modules["wrong_questions"] = read("wrong_questions", perUserFile(userRootDir_, "wrong_questions", safeId));
    modules["streak"] = read("streak", perUserFile(userRootDir_, "streaks", safeId));
    modules["draft"] = read("draft", perUserFile(userRootDir_, "drafts", safeId));
    try { modules["attempt_timer"] = timers_.load(userId); }
    catch (...) { modules["attempt_timer"]=Json::nullValue; Json::Value warning; warning["module"]="attempt_timer"; warning["code"]="unreadable_record"; manifest["warnings"].append(warning); }
    modules["srs"] = read("srs", perUserFile(userRootDir_, "srs", safeId));
    modules["adaptive_learning"] = read("adaptive_learning", perUserFile(userRootDir_, "adaptive_learning", safeId));
    modules["bookmark_folders"] = read("bookmark_folders", perUserFile(userRootDir_, "bookmark_folders", safeId));

    if (modules["profile"].isObject()) modules["profile"].removeMember("teacher_notes");
    for (const auto *module : {"study_goals","recent_learning"}) modules[module]=read(module,perUserFile(userRootDir_,module,safeId));
    Json::Value daily(Json::objectValue); std::error_code ec;
    const auto dailyDir=userRootDir_/"daily_practice";
    if (std::filesystem::exists(dailyDir,ec)) {
        for (std::filesystem::directory_iterator it(dailyDir,ec),end; !ec&&it!=end; it.increment(ec)) {
            const auto stem=it->path().stem().string();
            if (it->is_regular_file()&&it->path().extension()==".json"&&(stem==safeId||stem.rfind(safeId+"__",0)==0)) daily[stem==safeId?"default":stem.substr(safeId.size()+2)]=read("daily_practice",it->path());
        }
        if (ec) { Json::Value warning; warning["module"]="daily_practice"; warning["code"]="unreadable_directory"; manifest["warnings"].append(warning); }
    }
    modules["daily_practice"]=daily;
    const auto snapshots=answers_.exportSnapshots(userId);
    modules["answers"]=snapshots["latest"]; modules["answer_history"]=snapshots["history"];
    manifest["answer_source_records"]=snapshots.get("source_records",0);
    manifest["answer_duplicate_copies_removed"]=snapshots.get("duplicate_copies",0);
    for (auto warning : snapshots["warnings"]) { warning["module"]="answer_history"; manifest["warnings"].append(warning); }

    // 题目反馈：仅返回该用户为 reporter 的条目（按试卷拆分文件）
    Json::Value feedback(Json::arrayValue);
    const auto feedbackDir = userRootDir_ / "feedback";
    if (std::filesystem::is_directory(feedbackDir, ec))
    {
        for (const auto &entry : std::filesystem::directory_iterator(feedbackDir, ec))
        {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            const auto data = read("feedback",entry.path());
            if (!data.isObject() || !data.isMember("items") || !data["items"].isArray()) continue;
            for (const auto &item : data["items"])
            {
                if (item.get("reporter_id", "").asString() == userId)
                {
                    Json::Value visible(Json::objectValue);
                    for (const auto *key : {"feedback_id","reporter_id","paper_id","question_id","category","description","created_at","updated_at","status","public_reply","submitted_version_id","resolved_version_id"}) if (item.isMember(key)) visible[key]=item[key];
                    visible["processing_history"]=Json::arrayValue;
                    if (item["processing_history"].isArray()) for (const auto &history : item["processing_history"]) { if (!history.isObject()) continue; Json::Value publicHistory(Json::objectValue); for (const auto *key : {"status","public_reply","changed_at"}) if (history.isMember(key)) publicHistory[key]=history[key]; visible["processing_history"].append(publicHistory); }
                    feedback.append(visible);
                }
            }
        }
    }
    if (ec) { Json::Value warning; warning["module"]="feedback"; warning["code"]="unreadable_directory"; manifest["warnings"].append(warning); }
    modules["feedback"] = feedback;

    for (const auto &module : modules.getMemberNames()) {
        const auto &value=modules[module];
        manifest["modules"][module]["records"]=value.isNull()?0:(value.isArray()||module=="answers"||module=="daily_practice"?int(value.size()):1);
        manifest["modules"][module]["unit"]=module=="answers"?"paper_snapshots":module=="daily_practice"?"target_snapshots":value.isArray()?"records":"snapshot";
        manifest["modules"][module]["available"]=!value.isNull();
    }
    manifest["complete"]=manifest["warnings"].empty(); manifest["finished_at"]=nowIso8601Utc();
    out["manifest"]=manifest; out["modules"] = modules;
    return out;
}
}  // namespace application::services
