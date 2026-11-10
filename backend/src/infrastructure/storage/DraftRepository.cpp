#include "DraftRepository.h"

#include <cctype>

#include "JsonIo.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
namespace
{
std::string safeAttemptId(const std::string &value)
{
    std::string out;
    for (const unsigned char c : value) out.push_back(std::isalnum(c) || c == '-' || c == '_' ? static_cast<char>(c) : '_');
    return out;
}
}

DraftRepository::DraftRepository(std::filesystem::path userRootDir)
    : draftDir_(std::move(userRootDir) / "drafts")
{
    // 确保目录存在
    std::filesystem::create_directories(draftDir_);
}

std::filesystem::path DraftRepository::paperPath(const std::string &userId, const std::string &examId) const
{
    // Hex encoding preserves distinct IDs without allowing path separators.
    static constexpr char hex[] = "0123456789abcdef";
    std::string key;
    for (const unsigned char c : examId) { key += hex[c >> 4]; key += hex[c & 15]; }
    return draftDir_ / "_papers" / userId / (key + ".json");
}

Json::Value DraftRepository::loadUnlocked(const std::string &userId, const std::string &examId) const
{
    Json::Value latest(Json::nullValue);
    const auto legacy = draftDir_ / (userId + ".json");
    if (std::filesystem::exists(legacy)) latest = readJsonFile(legacy);
    if (!examId.empty()) {
        const auto path = paperPath(userId, examId);
        if (std::filesystem::exists(path)) return readJsonFile(path);
        return latest.get("exam_id", "").asString() == examId ? latest : Json::Value(Json::nullValue);
    }
    const auto dir = draftDir_ / "_papers" / userId;
    if (std::filesystem::exists(dir)) for (const auto &entry : std::filesystem::directory_iterator(dir)) {
        if (!entry.is_regular_file() || entry.path().extension() != ".json") continue;
        const auto doc = readJsonFile(entry.path());
        if (latest.isNull() || doc.get("updated_at", "").asString() > latest.get("updated_at", "").asString()) latest = doc;
    }
    return latest;
}

Json::Value DraftRepository::load(const std::string &userId, const std::string &examId) const
{
    std::shared_lock lock(mutex_);
    return loadUnlocked(userId, examId);
}

Json::Value DraftRepository::list(const std::string &userId) const
{
    std::shared_lock lock(mutex_);
    Json::Value items(Json::arrayValue);
    const auto dir = draftDir_ / "_papers" / userId;
    if (std::filesystem::exists(dir)) for (const auto &entry : std::filesystem::directory_iterator(dir)) {
        if (!entry.is_regular_file() || entry.path().extension() != ".json") continue;
        try { items.append(readJsonFile(entry.path())); } catch (...) { }
    }
    return items;
}

Json::Value DraftRepository::save(const std::string &userId, const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    const auto newExamId = patch.get("exam_id", "").asString();
    const auto path = paperPath(userId, newExamId);
    const auto legacy = draftDir_ / (userId + ".json");
    // Archive the previous single-file draft before updating the latest mirror.
    if (std::filesystem::exists(legacy)) {
        const auto old = readJsonFile(legacy);
        const auto oldExamId = old.get("exam_id", "").asString();
        if (!oldExamId.empty()) {
            const auto archived = paperPath(userId, oldExamId);
            if (!std::filesystem::exists(archived)) {
                std::filesystem::create_directories(archived.parent_path());
                writeJsonFileAtomic(archived, old);
            }
        }
    }

    const auto attemptId = patch.get("attempt_id", "").asString();
    if (!attemptId.empty())
    {
        const auto submittedPath = draftDir_ / "_submitted" / userId / (safeAttemptId(attemptId) + ".json");
        if (std::filesystem::exists(submittedPath))
        {
            throw common::AppException("ATTEMPT_SUBMITTED", "该次答题已在其他页面提交", drogon::k409Conflict);
        }
    }

    // 读取旧草稿（若 exam_id 不同，则视为新会话，重置 started_at）
    Json::Value doc = loadUnlocked(userId, newExamId);
    if (!doc.isObject())
    {
        doc = Json::Value(Json::objectValue);
    }

    const auto oldExamId = doc.get("exam_id", "").asString();
    const bool isNewSession = newExamId != oldExamId;
    const int currentRevision = isNewSession ? 0 : doc.get("revision", 0).asInt();
    const bool forceOverwrite = patch.get("force_overwrite", false).asBool();
    if (!isNewSession && patch.isMember("base_revision") && !forceOverwrite
        && patch["base_revision"].asInt() != currentRevision)
    {
        if (patch.isMember("session_draft") && patch["session_draft"] == doc["session_draft"]) return doc;
        throw common::AppException("DRAFT_CONFLICT",
                                   "草稿已在其他设备更新，请选择保留版本",
                                   drogon::k409Conflict);
    }

    doc["user_id"] = userId;
    doc["attempt_status"] = "draft";
    for (const auto *field : {"exam_mode", "session_draft"}) if (patch.isMember(field)) doc[field] = patch[field];
    if (!attemptId.empty()) doc["attempt_id"] = attemptId;
    if (!newExamId.empty())
    {
        doc["exam_id"] = newExamId;
    }
    if (patch.isMember("paper_id"))
    {
        doc["paper_id"] = patch["paper_id"];
    }
    if (patch.isMember("total_questions"))
    {
        doc["total_questions"] = patch["total_questions"];
    }
    if (patch.isMember("answered_count"))
    {
        doc["answered_count"] = patch["answered_count"];
    }
    if (patch.isMember("last_section_index"))
    {
        doc["last_section_index"] = patch["last_section_index"];
    }
    if (patch.isMember("last_question_index"))
    {
        doc["last_question_index"] = patch["last_question_index"];
    }
    if (patch.isMember("answers"))
    {
        // 整体覆盖：前端每次保存都传完整快照（避免合并冲突）
        doc["answers"] = patch["answers"];
    }

    const auto now = common::nowIso8601();
    if (isNewSession || !doc.isMember("started_at") || doc["started_at"].asString().empty())
    {
        doc["started_at"] = now;
    }
    doc["updated_at"] = now;
    doc["revision"] = currentRevision + 1;

    std::filesystem::create_directories(path.parent_path());
    writeJsonFileAtomic(path, doc);
    writeJsonFileAtomic(legacy, doc);
    return doc;
}

bool DraftRepository::clear(const std::string &userId, const std::string &examId, const std::string &attemptId)
{
    std::unique_lock lock(mutex_);
    const auto draft = loadUnlocked(userId, examId);
    if (!draft.isObject() || (!attemptId.empty() && draft.get("attempt_id", "").asString() != attemptId)) return false;
    const auto id = draft.get("exam_id", "").asString();
    const auto path = paperPath(userId, id);
    std::error_code ec;
    std::filesystem::remove(path, ec);
    const auto legacy = draftDir_ / (userId + ".json");
    if (std::filesystem::exists(legacy) && readJsonFile(legacy).get("exam_id", "").asString() == id) std::filesystem::remove(legacy, ec);
    return !ec;
}

void DraftRepository::markSubmitted(const std::string &userId,
                                    const std::string &examId,
                                    const std::string &attemptId)
{
    if (attemptId.empty()) return;
    std::unique_lock lock(mutex_);
    const auto dir = draftDir_ / "_submitted" / userId;
    std::filesystem::create_directories(dir);
    Json::Value marker(Json::objectValue);
    marker["user_id"] = userId;
    marker["exam_id"] = examId;
    marker["attempt_id"] = attemptId;
    marker["attempt_status"] = "submitted";
    marker["submitted_at"] = common::nowIso8601();
    writeJsonFileAtomic(dir / (safeAttemptId(attemptId) + ".json"), marker);
}

}  // namespace infrastructure::storage
