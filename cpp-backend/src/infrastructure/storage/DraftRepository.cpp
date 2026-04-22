#include "DraftRepository.h"

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

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

    doc["user_id"] = userId;
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

}  // namespace infrastructure::storage
