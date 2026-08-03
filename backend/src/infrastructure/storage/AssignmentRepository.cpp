#include "AssignmentRepository.h"

#include <algorithm>
#include <unordered_set>

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

AssignmentRepository::AssignmentRepository(std::filesystem::path systemDir)
    : filePath_(std::move(systemDir) / "assignments.json"),
      sqliteStore_(filePath_.parent_path() / "core.sqlite3")
{
    std::filesystem::create_directories(filePath_.parent_path());
    if (sqliteStore_.count("assignments") == 0 && std::filesystem::exists(filePath_))
    {
        const auto legacy = readJsonFile(filePath_);
        if (legacy["assignments"].isArray() && !legacy["assignments"].empty())
            sqliteStore_.replace("assignments", legacy["assignments"], "assignment_id");
    }
}

Json::Value AssignmentRepository::loadDoc() const
{
    if (cacheLoaded_) return cache_;
    Json::Value doc(Json::objectValue); doc["assignments"] = sqliteStore_.list("assignments");
    cache_ = doc; cacheLoaded_ = true; return cache_;
}

void AssignmentRepository::saveDoc(const Json::Value &doc)
{
    const auto items = doc.get("assignments", Json::Value(Json::arrayValue));
    sqliteStore_.replace("assignments", items, "assignment_id"); cache_ = doc; cacheLoaded_ = true;
}

Json::Value AssignmentRepository::create(const Json::Value &item)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc();
    Json::Value entry = item;
    entry["assignment_id"] = common::generateOpaqueId("asg_");
    const auto now = common::nowIso8601();
    entry["created_at"] = now;
    entry["updated_at"] = now;
    doc["assignments"].append(entry);
    saveDoc(doc);
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
    auto doc = loadDoc();
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
    auto doc = loadDoc();
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

Json::Value AssignmentRepository::listAll() const
{
    std::shared_lock lock(mutex_);
    return loadDoc().get("assignments", Json::Value(Json::arrayValue));
}

Json::Value AssignmentRepository::get(const std::string &assignmentId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc();
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
    auto doc = loadDoc();
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
		const auto previous = a["submissions"].get(studentId, Json::Value(Json::objectValue));
		entry["student_id"] = studentId;
        entry["submitted_at"] = common::nowIso8601();
        entry["updated_at"] = entry["submitted_at"].asString();
		entry["attempt_no"] = a["submissions"].isMember(studentId)
								  ? a["submissions"][studentId].get("attempt_no", 0).asInt() + 1
								  : 1;
		if (previous.isMember("review_history") && previous["review_history"].isArray())
		{
			entry["review_history"] = previous["review_history"];
		}
        a["submissions"][studentId] = entry;
        a["updated_at"] = common::nowIso8601();
    saveDoc(doc);
        return entry;
    }
    return Json::Value();
}

Json::Value AssignmentRepository::listSubmissions(const std::string &assignmentId) const
{
    std::shared_lock lock(mutex_);
    auto doc = loadDoc();
    for (const auto &a : doc["assignments"])
    {
        if (a.get("assignment_id", "").asString() == assignmentId)
        {
            return a.get("submissions", Json::Value(Json::objectValue));
        }
    }
	return Json::Value(Json::objectValue);
}

Json::Value AssignmentRepository::reviewSubmission(const std::string &assignmentId,
	                                                 const std::string &studentId,
	                                                 const Json::Value &review)
{
	std::unique_lock lock(mutex_);
	auto doc = loadDoc();
	for (auto &assignment : doc["assignments"])
	{
		if (assignment.get("assignment_id", "").asString() != assignmentId ||
			!assignment.isMember("submissions") || !assignment["submissions"].isObject() ||
			!assignment["submissions"].isMember(studentId))
		{
			continue;
		}
		auto submission = assignment["submissions"][studentId];
		auto history = submission.get("review_history", Json::Value(Json::arrayValue));
		if (!history.isArray()) history = Json::Value(Json::arrayValue);
		Json::Value entry = review;
		entry["reviewed_at"] = common::nowIso8601();
		history.append(entry);
		submission["review_status"] = entry.get("action", "reviewed").asString();
		submission["status"] = submission["review_status"];
		submission["teacher_comment"] = entry.get("comment", "").asString();
		submission["reviewed_by"] = entry.get("reviewed_by", "").asString();
		submission["reviewed_at"] = entry["reviewed_at"];
		submission["review_history"] = history;
		if (entry.isMember("manual_score")) submission["manual_score"] = entry["manual_score"];
		submission["updated_at"] = entry["reviewed_at"];
		assignment["submissions"][studentId] = submission;
		assignment["updated_at"] = entry["reviewed_at"];
    saveDoc(doc);
		return submission;
	}
	return Json::Value();
}

Json::Value AssignmentRepository::addReminder(const std::string &assignmentId, const Json::Value &reminder)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc();
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
        const auto idempotencyKey = reminder.get("idempotency_key", "").asString();
        const auto createdBy = reminder.get("created_by", "").asString();
        for (const auto &existing : a["reminders"])
        {
            if (!idempotencyKey.empty() &&
                existing.get("idempotency_key", "").asString() == idempotencyKey &&
                existing.get("created_by", "").asString() == createdBy)
            {
                Json::Value replay = existing;
                replay["idempotent_replay"] = true;
                return replay;
            }
        }
        Json::Value entry = reminder;
        entry["idempotent_replay"] = false;
        entry["reminder_id"] = common::generateOpaqueId("rem_");
        entry["created_at"] = common::nowIso8601();
        a["reminders"].append(entry);
        a["updated_at"] = common::nowIso8601();
		saveDoc(doc);
        return entry;
    }
    return Json::Value();
}

bool AssignmentRepository::update(const std::string &assignmentId, const Json::Value &patch)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc();
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
        if (patch.isMember("auto_reminder_enabled"))
        {
            a["auto_reminder_enabled"] = patch["auto_reminder_enabled"].asBool();
        }
        if (patch.isMember("auto_reminder_hours_before") && patch["auto_reminder_hours_before"].isArray())
        {
            a["auto_reminder_hours_before"] = patch["auto_reminder_hours_before"];
        }
        a["updated_at"] = common::nowIso8601();
        changed = true;
        break;
    }
    if (changed)
    {
        saveDoc(doc);
    }
    return changed;
}

bool AssignmentRepository::remove(const std::string &assignmentId)
{
    std::unique_lock lock(mutex_);
    auto doc = loadDoc();
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
        saveDoc(doc);
    }
    return removed;
}

}  // namespace infrastructure::storage
