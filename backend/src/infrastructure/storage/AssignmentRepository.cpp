#include "AssignmentRepository.h"

#include <algorithm>
#include <unordered_set>

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

AssignmentRepository::AssignmentRepository(std::filesystem::path systemDir)
    : filePath_(std::move(systemDir) / "assignments.json")
{
    std::filesystem::create_directories(filePath_.parent_path());
}

namespace
{
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
    if (!doc.isMember("assignments") || !doc["assignments"].isArray())
    {
        doc["assignments"] = Json::Value(Json::arrayValue);
    }
    return doc;
}
}  // namespace

Json::Value AssignmentRepository::create(const Json::Value &item)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value entry = item;
    entry["assignment_id"] = common::generateOpaqueId("asg_");
    const auto now = common::nowIso8601();
    entry["created_at"] = now;
    entry["updated_at"] = now;
    doc["assignments"].append(entry);
    writeJsonFileAtomic(filePath_, doc);
    return entry;
}

Json::Value AssignmentRepository::listByClass(const std::string &classId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value out(Json::arrayValue);
    for (const auto &a : doc["assignments"])
    {
        if (a.get("class_id", "").asString() == classId)
        {
            out.append(a);
        }
    }
    return out;
}

Json::Value AssignmentRepository::listByClasses(const std::vector<std::string> &classIds) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    std::unordered_set<std::string> set(classIds.begin(), classIds.end());
    Json::Value out(Json::arrayValue);
    for (const auto &a : doc["assignments"])
    {
        if (set.count(a.get("class_id", "").asString()))
        {
            out.append(a);
        }
    }
    return out;
}

Json::Value AssignmentRepository::get(const std::string &assignmentId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (const auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() == assignmentId)
        {
            return a;
        }
    }
    return Json::Value();
}

bool AssignmentRepository::update(const std::string &assignmentId, const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    bool changed = false;
    for (auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() != assignmentId)
        {
            continue;
        }
        // 受控字段
        for (const char *field : {"title", "description", "due_at", "exam_id"})
        {
            if (patch.isMember(field))
            {
                a[field] = patch[field];
            }
        }
        a["updated_at"] = common::nowIso8601();
        changed = true;
        break;
    }
    if (changed)
    {
        writeJsonFileAtomic(filePath_, doc);
    }
    return changed;
}

bool AssignmentRepository::remove(const std::string &assignmentId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() == assignmentId)
        {
            removed = true;
            continue;
        }
        next.append(a);
    }
    if (removed)
    {
        doc["assignments"] = next;
        writeJsonFileAtomic(filePath_, doc);
    }
    return removed;
}

}  // namespace infrastructure::storage
