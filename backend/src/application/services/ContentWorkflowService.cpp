#include "ContentWorkflowService.h"

#include <functional>

#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
ContentWorkflowService::ContentWorkflowService(std::filesystem::path systemDir, infrastructure::storage::ExamRepository &examRepository)
    : workflowDir_(std::move(systemDir) / "content_workflow"), stateFile_(workflowDir_ / "state.json"),
      versionsDir_(workflowDir_ / "versions"), examRepository_(examRepository)
{
    std::filesystem::create_directories(versionsDir_);
}

Json::Value ContentWorkflowService::loadState() const
{
    if (!std::filesystem::exists(stateFile_))
    {
        Json::Value state(Json::objectValue); state["items"] = Json::objectValue; state["queue"] = Json::arrayValue; return state;
    }
    auto state = infrastructure::storage::readJsonFile(stateFile_);
    if (!state.isObject()) state = Json::objectValue;
    if (!state["items"].isObject()) state["items"] = Json::objectValue;
    if (!state["queue"].isArray()) state["queue"] = Json::arrayValue;
    return state;
}

void ContentWorkflowService::saveState(const Json::Value &state) const { infrastructure::storage::writeJsonFileAtomic(stateFile_, state); }
std::string ContentWorkflowService::nowIso() { return common::nowIso8601(); }

Json::Value ContentWorkflowService::buildInspection(const std::string &examId, const Json::Value &exam) const
{
    Json::Value errors(Json::arrayValue), warnings(Json::arrayValue), assets(Json::arrayValue);
    int questions = 0, explanations = 0, images = 0, audio = 0;
    std::function<void(const Json::Value &, const std::string &)> walk = [&](const Json::Value &node, const std::string &path) {
        if (node.isArray()) { for (Json::ArrayIndex i = 0; i < node.size(); ++i) walk(node[i], path + "/" + std::to_string(i)); return; }
        if (!node.isObject()) return;
        const bool looksQuestion = node.isMember("question") || node.isMember("stem") || node.isMember("questionText") || node.isMember("options");
        if (looksQuestion)
        {
            ++questions;
            const auto text = node.get("question", node.get("stem", node.get("questionText", ""))).asString();
            if (text.empty()) { Json::Value issue(Json::objectValue); issue["code"]="QUESTION_TEXT_MISSING"; issue["path"]=path; issue["message"]="题干为空"; errors.append(issue); }
            const auto explanation = node.get("explanation", node.get("analysis", "")).asString();
            if (!explanation.empty()) ++explanations;
            else { Json::Value issue(Json::objectValue); issue["code"]="EXPLANATION_MISSING"; issue["path"]=path; issue["message"]="缺少解析"; warnings.append(issue); }
        }
        for (const auto &key : node.getMemberNames())
        {
            const auto lower = key;
            if ((lower.find("image") != std::string::npos || lower.find("audio") != std::string::npos) && node[key].isString() && !node[key].asString().empty())
            {
                Json::Value asset(Json::objectValue); asset["type"] = lower.find("audio") != std::string::npos ? "audio" : "image";
                asset["path"] = node[key].asString(); asset["field"] = path + "/" + key; assets.append(asset);
                if (asset["type"].asString() == "audio") ++audio; else ++images;
            }
            walk(node[key], path + "/" + key);
        }
    };
    walk(exam, "");
    if (questions == 0) { Json::Value issue(Json::objectValue); issue["code"]="QUESTION_LIST_EMPTY"; issue["path"]="/"; issue["message"]="未检测到题目"; errors.append(issue); }
    Json::Value out(Json::objectValue); out["exam_id"] = examId; out["checked_at"] = nowIso();
    out["errors"] = errors; out["warnings"] = warnings; out["assets"] = assets;
    out["question_count"] = questions; out["explanation_count"] = explanations; out["image_count"] = images; out["audio_count"] = audio;
    out["passed"] = errors.empty(); return out;
}

Json::Value ContentWorkflowService::inspect(const std::string &examId, const std::string &actorId)
{
    const auto exam = examRepository_.getExamById(examId);
    std::scoped_lock lock(mutex_); auto state = loadState(); auto result = buildInspection(examId, exam);
    state["items"][examId]["inspection"] = result; state["items"][examId]["status"] = result["passed"].asBool() ? "quality_checked" : "quality_failed";
    state["items"][examId]["updated_by"] = actorId; state["items"][examId]["updated_at"] = nowIso(); saveState(state); return state["items"][examId];
}

Json::Value ContentWorkflowService::review(const std::string &examId, const std::string &stage, const Json::Value &payload, const std::string &actorId)
{
    if (stage != "analysis" && stage != "secondary") throw common::AppException("CONTENT_REVIEW_STAGE_INVALID", "Invalid review stage", drogon::k422UnprocessableEntity);
    const auto status = payload.get("status", "").asString();
    if (status != "approved" && status != "rejected") throw common::AppException("CONTENT_REVIEW_STATUS_INVALID", "Review status must be approved or rejected", drogon::k422UnprocessableEntity);
    std::scoped_lock lock(mutex_); auto state = loadState();
    Json::Value review(Json::objectValue); review["status"] = status; review["note"] = payload.get("note", "").asString(); review["reviewed_by"] = actorId; review["reviewed_at"] = nowIso();
    state["items"][examId]["reviews"][stage] = review; state["items"][examId]["status"] = status == "approved" ? stage + "_approved" : stage + "_rejected";
    state["items"][examId]["updated_at"] = nowIso(); saveState(state); return state["items"][examId];
}

Json::Value ContentWorkflowService::createVersion(Json::Value &state, const std::string &examId, const std::string &kind, const std::string &actorId)
{
    const auto exam = examRepository_.getExamById(examId); const auto id = common::generateOpaqueId("ver_");
    const auto dir = versionsDir_ / examId; std::filesystem::create_directories(dir); infrastructure::storage::writeJsonFileAtomic(dir / (id + ".json"), exam);
    Json::Value version(Json::objectValue); version["id"] = id; version["exam_id"] = examId; version["kind"] = kind; version["created_by"] = actorId; version["created_at"] = nowIso();
    state["items"][examId]["versions"].append(version); return version;
}

Json::Value ContentWorkflowService::recordDraft(const std::string &examId, const std::string &actorId)
{
    std::scoped_lock lock(mutex_); auto state = loadState(); auto version = createVersion(state, examId, "draft", actorId);
    state["items"][examId]["status"] = "draft"; state["items"][examId]["updated_at"] = nowIso(); saveState(state); return version;
}

Json::Value ContentWorkflowService::enqueuePublish(const std::string &examId, const std::string &actorId)
{
    const auto exam = examRepository_.getExamById(examId); std::scoped_lock lock(mutex_); auto state = loadState();
    const auto inspection = buildInspection(examId, exam); state["items"][examId]["inspection"] = inspection;
    if (!inspection["passed"].asBool() || state["items"][examId]["reviews"]["analysis"].get("status", "").asString() != "approved" || state["items"][examId]["reviews"]["secondary"].get("status", "").asString() != "approved")
        throw common::AppException("CONTENT_PUBLISH_VALIDATION_FAILED", "Quality check and both reviews must pass before publishing", drogon::k409Conflict);
    auto version = createVersion(state, examId, "published", actorId); Json::Value queue(Json::objectValue);
    queue["id"] = common::generateOpaqueId("pub_"); queue["exam_id"] = examId; queue["version_id"] = version["id"]; queue["status"] = "published"; queue["created_by"] = actorId; queue["created_at"] = nowIso();
    state["queue"].append(queue); state["items"][examId]["status"] = "published"; state["items"][examId]["published_version_id"] = version["id"]; saveState(state); return queue;
}

Json::Value ContentWorkflowService::listQueue() const { std::scoped_lock lock(mutex_); return loadState()["queue"]; }
Json::Value ContentWorkflowService::listItems() const { std::scoped_lock lock(mutex_); const auto items=loadState()["items"]; Json::Value out(Json::arrayValue); for(const auto &id:items.getMemberNames()){Json::Value item=items[id];item["exam_id"]=id;out.append(item);} return out; }
Json::Value ContentWorkflowService::listVersions(const std::string &examId) const { std::scoped_lock lock(mutex_); return loadState()["items"][examId].get("versions", Json::Value(Json::arrayValue)); }

Json::Value ContentWorkflowService::rollback(const std::string &examId, const std::string &versionId, const std::string &actorId)
{
    std::scoped_lock lock(mutex_); const auto file = versionsDir_ / examId / (versionId + ".json");
    if (!std::filesystem::exists(file)) throw common::AppException("CONTENT_VERSION_NOT_FOUND", "Content version not found", drogon::k404NotFound);
    const auto snapshot = infrastructure::storage::readJsonFile(file); examRepository_.saveExam(examId, snapshot); auto state = loadState();
    const auto version = createVersion(state, examId, "rollback", actorId); state["items"][examId]["status"] = "rolled_back"; state["items"][examId]["rolled_back_from"] = versionId; saveState(state); return version;
}
}
