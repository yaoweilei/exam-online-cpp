#include "FeedbackService.h"

#include <array>
#include <string_view>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"

namespace application::services
{

namespace
{
// 受控类别枚举，避免数据库被污染（同时方便运营按类型筛选）
constexpr std::array<std::string_view, 12> kCategories{
    "question",
    "answer",
    "content",
    "paper",
    "analysis",
    "payment",
    "account",
    "wrong_answer",
    "typo",
    "translation",
    "audio",
    "other"};

bool isValidCategory(const std::string &c)
{
    for (const auto &v : kCategories)
    {
        if (v == c)
        {
            return true;
        }
    }
    return false;
}

// 描述长度上限，防止恶意大体积写入
constexpr size_t kMaxDescription = 1000;
}  // namespace

FeedbackService::FeedbackService(infrastructure::storage::FeedbackRepository &repository)
    : repository_(repository)
{
}

Json::Value FeedbackService::submit(const Json::Value &payload)
{
    if (!payload.isObject())
    {
        throw common::AppException("VALIDATION_ERROR", "请求体必须为对象", drogon::k422UnprocessableEntity);
    }
    const auto userId = payload.get("user_id", "").asString();
    const auto paperId = payload.get("paper_id", "").asString();
    const auto examId = payload.get("exam_id", "").asString();  // 可选
    const auto questionId = payload.get("question_id", "").asString();
    auto category = payload.get("category", "other").asString();
    auto description = payload.get("description", "").asString();

    if (userId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "缺少 user_id", drogon::k422UnprocessableEntity);
    }
    if (paperId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "缺少 paper_id", drogon::k422UnprocessableEntity);
    }
    if (questionId.empty())
    {
        throw common::AppException("VALIDATION_ERROR", "缺少 question_id", drogon::k422UnprocessableEntity);
    }
    if (!isValidCategory(category))
    {
        category = "other";
    }
    if (description.size() > kMaxDescription)
    {
        description.resize(kMaxDescription);
    }

    Json::Value entry(Json::objectValue);
    entry["user_id"] = userId;
    entry["exam_id"] = examId;
    entry["paper_id"] = paperId;
    entry["question_id"] = questionId;
    entry["category"] = category;
    entry["description"] = description;
    entry["status"] = "open";
    entry["admin_note"] = "";
    return repository_.append(paperId, entry);
}

Json::Value FeedbackService::list(const std::string &paperId, const std::string &status) const
{
    return repository_.list(paperId, status);
}

Json::Value FeedbackService::update(const std::string &paperId,
                                    const std::string &feedbackId,
                                    const Json::Value &patch)
{
    if (!patch.isObject())
    {
        throw common::AppException("VALIDATION_ERROR", "请求体必须为对象", drogon::k422UnprocessableEntity);
    }
    if (patch.isMember("status"))
    {
        const auto s = patch["status"].asString();
        if (s != "open" && s != "reviewing" && s != "resolved" && s != "rejected")
        {
            throw common::AppException("VALIDATION_ERROR",
                                       "status 必须是 open / reviewing / resolved / rejected",
                                       drogon::k422UnprocessableEntity);
        }
    }
    const bool ok = repository_.update(paperId, feedbackId, patch);
    Json::Value out(Json::objectValue);
    out["updated"] = ok;
    out["feedback_id"] = feedbackId;
    return out;
}

}  // namespace application::services
