#include "application/services/ExplanationService.h"

#include <set>

#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
constexpr const char *kDirName = "explanations";

// 校验/规整化讲解条目；只保留白名单字段
Json::Value normalize(const Json::Value &payload)
{
    static const std::set<std::string> kKinds{"text", "link", "image", "audio"};
    const auto kind = payload.get("kind", "text").asString();
    if (kKinds.find(kind) == kKinds.end())
        throw common::AppException("VALIDATION_ERROR", "kind 必须为 text|link|image|audio", drogon::k422UnprocessableEntity);
    Json::Value out(Json::objectValue);
    out["kind"] = kind;
    const auto body = payload.get("body", "").asString();
    if (body.size() > 4000)
        throw common::AppException("VALIDATION_ERROR", "body 上限 4000 字", drogon::k422UnprocessableEntity);
    out["body"] = body;
    if (payload.isMember("url"))
    {
        const auto url = payload.get("url", "").asString();
        if (url.size() > 1000)
            throw common::AppException("VALIDATION_ERROR", "url 上限 1000 字", drogon::k422UnprocessableEntity);
        out["url"] = url;
    }
    // text 必须有 body；其它类型必须有 url
    if (kind == "text" && body.empty())
        throw common::AppException("VALIDATION_ERROR", "文本讲解必须填写 body", drogon::k422UnprocessableEntity);
    if (kind != "text" && out.get("url", "").asString().empty())
        throw common::AppException("VALIDATION_ERROR", "非文本讲解必须填写 url", drogon::k422UnprocessableEntity);
    return out;
}
}  // namespace

ExplanationService::ExplanationService(std::filesystem::path systemRootDir)
    : rootDir_(std::move(systemRootDir) / kDirName)
{
    std::error_code ec;
    std::filesystem::create_directories(rootDir_, ec);
}

std::string ExplanationService::sanitize(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.')
            out.push_back(c);
        else
            out.push_back('_');
    }
    return out;
}

std::filesystem::path ExplanationService::fileFor(const std::string &examId) const
{
    return rootDir_ / (sanitize(examId) + ".json");
}

Json::Value ExplanationService::loadDoc(const std::string &examId) const
{
    Json::Value doc(Json::objectValue);
    try
    {
        doc = infrastructure::storage::readJsonFile(fileFor(examId));
    }
    catch (...) { /* 不存在 */ }
    if (!doc.isObject()) doc = Json::Value(Json::objectValue);
    if (!doc.isMember("exam_id")) doc["exam_id"] = examId;
    if (!doc.isMember("questions") || !doc["questions"].isObject()) doc["questions"] = Json::Value(Json::objectValue);
    return doc;
}

void ExplanationService::saveDoc(const std::string &examId, Json::Value &doc) const
{
    doc["exam_id"] = examId;
    doc["updated_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(fileFor(examId), doc);
}

Json::Value ExplanationService::listForExam(const std::string &examId) const
{
    if (examId.empty())
        throw common::AppException("VALIDATION_ERROR", "exam_id 必填", drogon::k400BadRequest);
    Json::Value out(Json::objectValue);
    out["exam_id"] = examId;
    out["questions"] = loadDoc(examId)["questions"];
    return out;
}

Json::Value ExplanationService::listForQuestion(const std::string &examId, const std::string &questionId) const
{
    if (examId.empty() || questionId.empty())
        throw common::AppException("VALIDATION_ERROR", "exam_id 与 question_id 必填", drogon::k400BadRequest);
    auto doc = loadDoc(examId);
    Json::Value out(Json::objectValue);
    out["exam_id"] = examId;
    out["question_id"] = questionId;
    out["items"] = doc["questions"].isMember(questionId) ? doc["questions"][questionId] : Json::Value(Json::arrayValue);
    return out;
}

Json::Value ExplanationService::addExplanation(const std::string &examId,
                                               const std::string &questionId,
                                               const std::string &authorId,
                                               const std::string &authorName,
                                               const Json::Value &payload)
{
    if (examId.empty() || questionId.empty())
        throw common::AppException("VALIDATION_ERROR", "exam_id 与 question_id 必填", drogon::k400BadRequest);
    auto fields = normalize(payload);
    fields["explanation_id"] = common::generateOpaqueId("exp_");
    fields["author_id"] = authorId;
    fields["author_name"] = authorName;
    fields["created_at"] = common::nowIso8601();
    auto doc = loadDoc(examId);
    if (!doc["questions"].isMember(questionId)) doc["questions"][questionId] = Json::Value(Json::arrayValue);
    doc["questions"][questionId].append(fields);
    saveDoc(examId, doc);
    return fields;
}

bool ExplanationService::removeExplanation(const std::string &examId,
                                           const std::string &questionId,
                                           const std::string &explanationId)
{
    auto doc = loadDoc(examId);
    if (!doc["questions"].isMember(questionId)) return false;
    auto &arr = doc["questions"][questionId];
    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &it : arr)
    {
        if (it.get("explanation_id", "").asString() == explanationId) { removed = true; continue; }
        next.append(it);
    }
    if (!removed) return false;
    doc["questions"][questionId] = next;
    saveDoc(examId, doc);
    return true;
}
}  // namespace application::services
