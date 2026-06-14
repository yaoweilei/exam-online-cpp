#include "ClassroomRepository.h"

#include <algorithm>
#include <unordered_set>

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

ClassroomRepository::ClassroomRepository(std::filesystem::path systemDir)
    : filePath_(std::move(systemDir) / "classrooms.json")
{
    std::filesystem::create_directories(filePath_.parent_path());
}

namespace
{
// 读取整个文档；若不存在或非法，返回 { classrooms: [] }
Json::Value loadDoc(const std::filesystem::path &path)
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
    if (!doc.isMember("classrooms") || !doc["classrooms"].isArray())
    {
        doc["classrooms"] = Json::Value(Json::arrayValue);
    }
    return doc;
}
}  // namespace

Json::Value ClassroomRepository::create(const Json::Value &item)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);

    Json::Value entry = item;
    entry["class_id"] = common::generateOpaqueId("cls_");
    const auto now = common::nowIso8601();
    entry["created_at"] = now;
    entry["updated_at"] = now;
    if (!entry.isMember("student_ids") || !entry["student_ids"].isArray())
    {
        entry["student_ids"] = Json::Value(Json::arrayValue);
    }
    doc["classrooms"].append(entry);
    writeJsonFileAtomic(filePath_, doc);
    return entry;
}

Json::Value ClassroomRepository::list() const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    return doc["classrooms"];
}

Json::Value ClassroomRepository::listForUser(const std::string &userId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value out(Json::arrayValue);
    for (const auto &c : doc["classrooms"])
    {
        if (c.get("teacher_user_id", "").asString() == userId)
        {
            out.append(c);
            continue;
        }
        if (c.isMember("student_ids") && c["student_ids"].isArray())
        {
            for (const auto &sid : c["student_ids"])
            {
                if (sid.asString() == userId)
                {
                    out.append(c);
                    break;
                }
            }
        }
    }
    return out;
}

Json::Value ClassroomRepository::get(const std::string &classId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (const auto &c : doc["classrooms"])
    {
        if (c.get("class_id", "").asString() == classId)
        {
            return c;
        }
    }
    return Json::Value();  // null
}

bool ClassroomRepository::update(const std::string &classId, const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    bool changed = false;
    for (auto &c : doc["classrooms"])
    {
        if (c.get("class_id", "").asString() != classId)
        {
            continue;
        }
        // 受控字段。机构端高级能力会用 assistant/advisor/campus 字段做权限与多校区视图。
        for (const char *field : {"name", "description", "campus_id", "campus_name"})
        {
            if (patch.isMember(field))
            {
                c[field] = patch[field].asString();
            }
        }
        for (const char *field : {"student_ids", "assistant_ids", "advisor_ids", "parent_viewer_ids"})
        {
            if (patch.isMember(field) && patch[field].isArray())
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
        writeJsonFileAtomic(filePath_, doc);
    }
    return changed;
}

bool ClassroomRepository::remove(const std::string &classId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &c : doc["classrooms"])
    {
        if (c.get("class_id", "").asString() == classId)
        {
            removed = true;
            continue;
        }
        next.append(c);
    }
    if (removed)
    {
        doc["classrooms"] = next;
        writeJsonFileAtomic(filePath_, doc);
    }
    return removed;
}

Json::Value ClassroomRepository::addMembers(const std::string &classId,
                                            const std::vector<std::string> &userIds)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (auto &c : doc["classrooms"])
    {
        if (c.get("class_id", "").asString() != classId)
        {
            continue;
        }
        std::unordered_set<std::string> existing;
        if (c.isMember("student_ids") && c["student_ids"].isArray())
        {
            for (const auto &sid : c["student_ids"])
            {
                existing.insert(sid.asString());
            }
        }
        else
        {
            c["student_ids"] = Json::Value(Json::arrayValue);
        }
        for (const auto &uid : userIds)
        {
            if (uid.empty() || existing.count(uid))
            {
                continue;
            }
            c["student_ids"].append(uid);
            existing.insert(uid);
        }
        c["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(filePath_, doc);
        return c["student_ids"];
    }
    return Json::Value(Json::arrayValue);
}

bool ClassroomRepository::removeMember(const std::string &classId, const std::string &userId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (auto &c : doc["classrooms"])
    {
        if (c.get("class_id", "").asString() != classId)
        {
            continue;
        }
        if (!c.isMember("student_ids") || !c["student_ids"].isArray())
        {
            return false;
        }
        Json::Value next(Json::arrayValue);
        bool removed = false;
        for (const auto &sid : c["student_ids"])
        {
            if (sid.asString() == userId)
            {
                removed = true;
                continue;
            }
            next.append(sid);
        }
        if (removed)
        {
            c["student_ids"] = next;
            c["updated_at"] = common::nowIso8601();
            writeJsonFileAtomic(filePath_, doc);
        }
        return removed;
    }
    return false;
}

}  // namespace infrastructure::storage
