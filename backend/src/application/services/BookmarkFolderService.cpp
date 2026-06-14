#include "BookmarkFolderService.h"

#include <drogon/HttpTypes.h>

#include "common/AppException.h"

namespace application::services
{

namespace
{
constexpr size_t kMaxNameLen = 50;

void validateName(const std::string &name)
{
    if (name.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "文件夹名称不能为空", drogon::k422UnprocessableEntity);
    }
    if (name.size() > kMaxNameLen)
    {
        throw common::AppException("VALIDATION_ERROR", "文件夹名称过长（≤50）", drogon::k422UnprocessableEntity);
    }
}
}  // namespace

BookmarkFolderService::BookmarkFolderService(infrastructure::storage::BookmarkFolderRepository &repo)
    : repo_(repo)
{
}

Json::Value BookmarkFolderService::list(const std::string &userId) const
{
    Json::Value out(Json::objectValue);
    out["items"] = repo_.list(userId);
    return out;
}

Json::Value BookmarkFolderService::create(const std::string &userId,
                                          const std::string &name,
                                          const std::string &color)
{
    validateName(name);
    return repo_.create(userId, name, color);
}

Json::Value BookmarkFolderService::update(const std::string &userId,
                                          const std::string &folderId,
                                          const Json::Value &patch)
{
    if (patch.isMember("name"))
    {
        validateName(patch["name"].asString());
    }
    if (!repo_.update(userId, folderId, patch))
    {
        throw common::AppException("NOT_FOUND", "文件夹不存在", drogon::k404NotFound);
    }
    Json::Value out(Json::objectValue);
    out["updated"] = true;
    out["folder_id"] = folderId;
    return out;
}

Json::Value BookmarkFolderService::remove(const std::string &userId, const std::string &folderId)
{
    if (!repo_.remove(userId, folderId))
    {
        throw common::AppException("NOT_FOUND", "文件夹不存在", drogon::k404NotFound);
    }
    Json::Value out(Json::objectValue);
    out["removed"] = true;
    out["folder_id"] = folderId;
    return out;
}

Json::Value BookmarkFolderService::addExam(const std::string &userId,
                                           const std::string &folderId,
                                           const std::string &examId)
{
    if (examId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "缺少 exam_id", drogon::k422UnprocessableEntity);
    }
    const bool added = repo_.addExam(userId, folderId, examId);
    Json::Value out(Json::objectValue);
    out["added"] = added;
    out["folder_id"] = folderId;
    out["exam_id"] = examId;
    return out;
}

Json::Value BookmarkFolderService::removeExam(const std::string &userId,
                                              const std::string &folderId,
                                              const std::string &examId)
{
    const bool removed = repo_.removeExam(userId, folderId, examId);
    Json::Value out(Json::objectValue);
    out["removed"] = removed;
    out["folder_id"] = folderId;
    out["exam_id"] = examId;
    return out;
}

}  // namespace application::services
