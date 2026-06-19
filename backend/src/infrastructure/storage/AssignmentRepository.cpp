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

namespace
{
std::string assignmentLearningGroupId(const Json::Value &assignment)
{
    return assignment.get("learning_group_id", assignment.get("group_id", "")).asString();
}
}  // namespace

Json::Value AssignmentRepository::listByLearningGroup(const std::string &learningGroupId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    Json::Value out(Json::arrayValue);
    for (const auto &a : doc["assignments"])
    {
        if (assignmentLearningGroupId(a) == learningGroupId)
        {
            out.append(a);
        }
    }
    return out;
}

Json::Value AssignmentRepository::listByLearningGroups(const std::vector<std::string> &learningGroupIds) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    std::unordered_set<std::string> set(learningGroupIds.begin(), learningGroupIds.end());
    Json::Value out(Json::arrayValue);
    for (const auto &a : doc["assignments"])
    {
        if (set.count(assignmentLearningGroupId(a)))
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

Json::Value AssignmentRepository::submit(const std::string &assignmentId,
                                         const std::string &studentId,
                                         const Json::Value &submission)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() != assignmentId)
        {
            continue;
        }
        if (!a.isMember("submissions") || !a["submissions"].isObject())
        {
            a["submissions"] = Json::Value(Json::objectValue);
        }
        Json::Value entry = submission;
        entry["student_id"] = studentId;
        entry["submitted_at"] = common::nowIso8601();
        entry["updated_at"] = entry["submitted_at"].asString();
        entry["attempt_no"] = a["submissions"].isMember(studentId)
                                  ? a["submissions"][studentId].get("attempt_no", 0).asInt() + 1
                                  : 1;
        a["submissions"][studentId] = entry;
        a["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(filePath_, doc);
        return entry;
    }
    return Json::Value();
}

Json::Value AssignmentRepository::listSubmissions(const std::string &assignmentId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (const auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() == assignmentId)
        {
            return a.get("submissions", Json::Value(Json::objectValue));
        }
    }
    return Json::Value(Json::objectValue);
}

Json::Value AssignmentRepository::addReminder(const std::string &assignmentId, const Json::Value &reminder)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc(filePath_);
    for (auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() != assignmentId)
        {
            continue;
        }
        if (!a.isMember("reminders") || !a["reminders"].isArray())
        {
            a["reminders"] = Json::Value(Json::arrayValue);
        }
        Json::Value entry = reminder;
        entry["reminder_id"] = common::generateOpaqueId("rem_");
        entry["created_at"] = common::nowIso8601();
        a["reminders"].append(entry);
        a["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(filePath_, doc);
        return entry;
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
        for (const char *field : {"question_start", "question_end"})
        {
            if (patch.isMember(field))
            {
                a[field] = patch[field].asInt();
            }
        }
        if (patch.isMember("question_ids") && patch["question_ids"].isArray())
        {
            a["question_ids"] = patch["question_ids"];
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
