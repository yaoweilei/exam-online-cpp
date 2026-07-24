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

Json::Value DraftRepository::load(const std::string &userId) const
{
    const auto path = draftDir_ / (userId + ".json");
    std::shared_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return Json::Value(Json::nullValue);  // 没有草稿
    }
    return readJsonFile(path);
}

Json::Value DraftRepository::save(const std::string &userId, const Json::Value &patch)
{
    const auto path = draftDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);

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
    Json::Value doc;
    const bool exists = std::filesystem::exists(path);
    if (exists)
    {
        doc = readJsonFile(path);
    }
    if (!doc.isObject())
    {
        doc = Json::Value(Json::objectValue);
    }

    const auto newExamId = patch.get("exam_id", "").asString();
    const auto oldExamId = doc.get("exam_id", "").asString();
    const bool isNewSession = newExamId != oldExamId;
    const int currentRevision = isNewSession ? 0 : doc.get("revision", 0).asInt();
    const bool forceOverwrite = patch.get("force_overwrite", false).asBool();
    if (!isNewSession && patch.isMember("base_revision") && !forceOverwrite
        && patch["base_revision"].asInt() != currentRevision)
    {
        throw common::AppException("DRAFT_CONFLICT",
                                   "草稿已在其他设备更新，请选择保留版本",
                                   drogon::k409Conflict);
    }

    doc["user_id"] = userId;
    doc["attempt_status"] = "draft";
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

    writeJsonFileAtomic(path, doc);
    return doc;
}

bool DraftRepository::clear(const std::string &userId)
{
    const auto path = draftDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    std::error_code ec;
    std::filesystem::remove(path, ec);
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
