#include "application/services/StudyGoalService.h"

#include <algorithm>

#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
constexpr const char *kDirName = "study_goals";

bool isValidDate(const std::string &s)
{
    // 期望 YYYY-MM-DD 共 10 字符
    if (s.size() != 10) return false;
    if (s[4] != '-' || s[7] != '-') return false;
    for (int i : {0, 1, 2, 3, 5, 6, 8, 9})
    {
        if (s[i] < '0' || s[i] > '9') return false;
    }
    return true;
}
}  // namespace

StudyGoalService::StudyGoalService(std::filesystem::path userRootDir)
    : rootDir_(std::move(userRootDir) / kDirName)
{
    std::error_code ec;
    std::filesystem::create_directories(rootDir_, ec);
}

std::string StudyGoalService::sanitize(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
            out.push_back(c);
        else
            out.push_back('_');
    }
    return out;
}

std::filesystem::path StudyGoalService::fileFor(const std::string &userId) const
{
    return rootDir_ / (sanitize(userId) + ".json");
}

Json::Value StudyGoalService::loadDoc(const std::string &userId) const
{
    Json::Value doc(Json::objectValue);
    try
    {
        doc = infrastructure::storage::readJsonFile(fileFor(userId));
    }
    catch (...) { /* 文件不存在 */ }
    if (!doc.isObject()) doc = Json::Value(Json::objectValue);
    if (!doc.isMember("goals") || !doc["goals"].isArray()) doc["goals"] = Json::Value(Json::arrayValue);
    return doc;
}

void StudyGoalService::saveDoc(const std::string &userId, Json::Value &doc) const
{
    doc["user_id"] = userId;
    doc["updated_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(fileFor(userId), doc);
}

// 校验并仅保留允许字段
Json::Value StudyGoalService::normalize(const Json::Value &payload)
{
    Json::Value out(Json::objectValue);
    const auto title = payload.get("title", "").asString();
    if (title.empty() || title.size() > 80)
        throw common::AppException("VALIDATION_ERROR", "title 1-80 字符", drogon::k422UnprocessableEntity);
    const auto targetDate = payload.get("target_date", "").asString();
    if (!isValidDate(targetDate))
        throw common::AppException("VALIDATION_ERROR", "target_date 必须为 YYYY-MM-DD", drogon::k422UnprocessableEntity);
    out["title"] = title;
    out["target_date"] = targetDate;
    if (payload.isMember("exam_target")) out["exam_target"] = payload.get("exam_target", "").asString();
    if (payload.isMember("daily_question_target"))
    {
        const int n = payload.get("daily_question_target", 0).asInt();
        out["daily_question_target"] = std::clamp(n, 0, 1000);
    }
    if (payload.isMember("note"))
    {
        const auto note = payload.get("note", "").asString();
        out["note"] = note.size() > 500 ? note.substr(0, 500) : note;
    }
    return out;
}

Json::Value StudyGoalService::list(const std::string &userId) const
{
    auto doc = loadDoc(userId);
    // 按 target_date 升序返回
    std::vector<Json::Value> arr(doc["goals"].begin(), doc["goals"].end());
    std::sort(arr.begin(), arr.end(), [](const Json::Value &a, const Json::Value &b) {
        return a.get("target_date", "").asString() < b.get("target_date", "").asString();
    });
    Json::Value items(Json::arrayValue);
    for (const auto &g : arr) items.append(g);
    Json::Value out(Json::objectValue);
    out["items"] = items;
    return out;
}

Json::Value StudyGoalService::create(const std::string &userId, const Json::Value &payload)
{
    auto fields = normalize(payload);
    auto doc = loadDoc(userId);
    Json::Value goal = fields;
    goal["goal_id"] = common::generateOpaqueId("goal_");
    goal["created_at"] = common::nowIso8601();
    goal["updated_at"] = goal["created_at"];
    doc["goals"].append(goal);
    saveDoc(userId, doc);
    return goal;
}

Json::Value StudyGoalService::update(const std::string &userId, const std::string &goalId, const Json::Value &payload)
{
    if (goalId.empty())
        throw common::AppException("VALIDATION_ERROR", "goal_id 必填", drogon::k422UnprocessableEntity);
    auto doc = loadDoc(userId);
    auto &arr = doc["goals"];
    for (auto &g : arr)
    {
        if (g.get("goal_id", "").asString() != goalId) continue;
        // 部分字段更新：构造合并对象再 normalize
        Json::Value merged = g;
        for (const auto &k : payload.getMemberNames()) merged[k] = payload[k];
        auto fields = normalize(merged);
        for (const auto &k : fields.getMemberNames()) g[k] = fields[k];
        g["updated_at"] = common::nowIso8601();
        saveDoc(userId, doc);
        return g;
    }
    throw common::AppException("NOT_FOUND", "目标不存在", drogon::k404NotFound);
}

bool StudyGoalService::remove(const std::string &userId, const std::string &goalId)
{
    auto doc = loadDoc(userId);
    auto &arr = doc["goals"];
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &g : arr)
    {
        if (g.get("goal_id", "").asString() == goalId) { removed = true; continue; }
        next.append(g);
    }
    if (!removed) return false;
    doc["goals"] = next;
    saveDoc(userId, doc);
    return true;
}
}  // namespace application::services
