#include "BookmarkFolderRepository.h"

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

BookmarkFolderRepository::BookmarkFolderRepository(std::filesystem::path userRootDir)
    : folderDir_(std::move(userRootDir) / "bookmark_folders")
{
    std::filesystem::create_directories(folderDir_);
}

std::filesystem::path BookmarkFolderRepository::filePath(const std::string &userId) const
{
    // userId 消毒，防目录穿越
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
    return folderDir_ / (safe + ".json");
}

namespace
{
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
    if (!doc.isMember("folders") || !doc["folders"].isArray())
    {
        doc["folders"] = Json::Value(Json::arrayValue);
    }
    return doc;
}
}  // namespace

Json::Value BookmarkFolderRepository::list(const std::string &userId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    return doc["folders"];
}

Json::Value BookmarkFolderRepository::create(const std::string &userId,
                                             const std::string &name,
                                             const std::string &color)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    Json::Value entry(Json::objectValue);
    entry["folder_id"] = common::generateOpaqueId("fld_");
    entry["name"] = name;
    entry["color"] = color;
    entry["exam_ids"] = Json::Value(Json::arrayValue);
    const auto now = common::nowIso8601();
    entry["created_at"] = now;
    entry["updated_at"] = now;
    doc["folders"].append(entry);
    writeJsonFileAtomic(filePath(userId), doc);
    return entry;
}

bool BookmarkFolderRepository::update(const std::string &userId,
                                      const std::string &folderId,
                                      const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    bool changed = false;
    for (auto &f : doc["folders"])
    {
        if (f.get("folder_id", "").asString() != folderId)
        {
            continue;
        }
        if (patch.isMember("name"))
        {
            f["name"] = patch["name"].asString();
        }
        if (patch.isMember("color"))
        {
            f["color"] = patch["color"].asString();
        }
        f["updated_at"] = common::nowIso8601();
        changed = true;
        break;
    }
    if (changed)
    {
        writeJsonFileAtomic(filePath(userId), doc);
    }
    return changed;
}

bool BookmarkFolderRepository::remove(const std::string &userId, const std::string &folderId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &f : doc["folders"])
    {
        if (f.get("folder_id", "").asString() == folderId)
        {
            removed = true;
            continue;
        }
        next.append(f);
    }
    if (removed)
    {
        doc["folders"] = next;
        writeJsonFileAtomic(filePath(userId), doc);
    }
    return removed;
}

bool BookmarkFolderRepository::addExam(const std::string &userId,
                                       const std::string &folderId,
                                       const std::string &examId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    for (auto &f : doc["folders"])
    {
        if (f.get("folder_id", "").asString() != folderId)
        {
            continue;
        }
        // 去重
        for (const auto &e : f["exam_ids"])
        {
            if (e.asString() == examId)
            {
                return false;
            }
        }
        f["exam_ids"].append(examId);
        f["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(filePath(userId), doc);
        return true;
    }
    return false;
}

bool BookmarkFolderRepository::removeExam(const std::string &userId,
                                          const std::string &folderId,
                                          const std::string &examId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath(userId), userId);
    for (auto &f : doc["folders"])
    {
        if (f.get("folder_id", "").asString() != folderId)
        {
            continue;
        }
        Json::Value next(Json::arrayValue);
        bool removed = false;
        for (const auto &e : f["exam_ids"])
        {
            if (e.asString() == examId)
            {
                removed = true;
                continue;
            }
            next.append(e);
        }
        if (removed)
        {
            f["exam_ids"] = next;
            f["updated_at"] = common::nowIso8601();
            writeJsonFileAtomic(filePath(userId), doc);
        }
        return removed;
    }
    return false;
}

}  // namespace infrastructure::storage
