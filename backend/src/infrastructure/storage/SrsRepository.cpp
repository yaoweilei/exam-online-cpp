#include "SrsRepository.h"

#include <algorithm>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

SrsRepository::SrsRepository(std::filesystem::path userRootDir)
    : srsDir_(std::move(userRootDir) / "srs")
{
    std::filesystem::create_directories(srsDir_);
}

std::filesystem::path SrsRepository::filePath(const std::string &userId) const
{
    // userId 已经由上层校验，但仍消毒分隔符
    std::string safe;
    safe.reserve(userId.size());
    for (char c : userId)
    {
        if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '_'
            || c == '.')
        {
            safe.push_back(c);
        }
        else
        {
            safe.push_back('_');
        }
    }
    if (safe.empty())
    {
        safe = "_unknown";
    }
    return srsDir_ / (safe + ".json");
}

namespace
{
// 加载或初始化文档
Json::Value loadDoc(const std::filesystem::path &path, const std::string &userId)
{
    Json::Value doc;
    if (std::filesystem::exists(path))
    {
        doc = readJsonFile(path);
    }
    if (!doc.isObject())
    {
        doc = Json::Value(Json::objectValue);
    }
    doc["user_id"] = userId;
    if (!doc.isMember("cards") || !doc["cards"].isArray())
    {
        doc["cards"] = Json::Value(Json::arrayValue);
    }
    return doc;
}
}  // namespace

Json::Value SrsRepository::list(const std::string &userId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    return doc["cards"];
}

Json::Value SrsRepository::listDue(const std::string &userId, const std::string &nowIso, int limit) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    Json::Value out(Json::arrayValue);
    for (const auto &c : doc["cards"])
    {
        const auto due = c.get("due_at", "").asString();
        // ISO8601 字符串可直接字典序比较
        if (due.empty() || due <= nowIso)
        {
            out.append(c);
            if (limit > 0 && static_cast<int>(out.size()) >= limit)
            {
                break;
            }
        }
    }
    return out;
}

bool SrsRepository::upsertCard(const std::string &userId,
                               const std::string &examId,
                               const std::string &questionId,
                               const std::string &questionType,
                               const Json::Value &snapshot,
                               const std::string &nowIso)
{
    if (userId.empty() || examId.empty() || questionId.empty())
    {
        return false;
    }
    const std::string cardId = examId + ":" + questionId;
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    for (const auto &c : doc["cards"])
    {
        if (c.get("card_id", "").asString() == cardId)
        {
            return false;  // 已存在，幂等
        }
    }
    Json::Value entry(Json::objectValue);
    entry["card_id"] = cardId;
    entry["exam_id"] = examId;
    entry["question_id"] = questionId;
    entry["question_type"] = questionType;
    entry["snapshot"] = snapshot;
    entry["ease"] = 2.5;
    entry["interval_days"] = 0;
    entry["reps"] = 0;
    entry["lapses"] = 0;
    entry["due_at"] = nowIso;        // 立即可复习
    entry["last_reviewed_at"] = "";
    entry["last_grade"] = -1;
    entry["created_at"] = nowIso;
    entry["updated_at"] = nowIso;
    doc["cards"].append(entry);
    writeJsonFileAtomic(filePath(userId), doc);
    return true;
}

bool SrsRepository::applySchedule(const std::string &userId,
                                  const std::string &cardId,
                                  const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    bool changed = false;
    for (auto &c : doc["cards"])
    {
        if (c.get("card_id", "").asString() != cardId)
        {
            continue;
        }
        for (const char *field : {"ease", "interval_days", "reps", "lapses", "due_at",
                                  "last_reviewed_at", "last_grade"})
        {
            if (patch.isMember(field))
            {
                c[field] = patch[field];
            }
        }
        c["updated_at"] = common::nowIso8601();
        changed = true;
        break;
    }
    if (changed)
    {
        writeJsonFileAtomic(filePath(userId), doc);
    }
    return changed;
}

bool SrsRepository::removeCard(const std::string &userId, const std::string &cardId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &c : doc["cards"])
    {
        if (c.get("card_id", "").asString() == cardId)
        {
            removed = true;
            continue;
        }
        next.append(c);
    }
    if (removed)
    {
        doc["cards"] = next;
        writeJsonFileAtomic(filePath(userId), doc);
    }
    return removed;
}

}  // namespace infrastructure::storage
