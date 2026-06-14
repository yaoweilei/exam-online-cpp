#include "CommunityService.h"

#include "common/AppException.h"

namespace application::services
{
namespace
{
// 简单 trim
std::string trim(const std::string &s)
{
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\n' || s[a] == '\r')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\n' || s[b - 1] == '\r')) --b;
    return s.substr(a, b - a);
}

void requireNonEmpty(const std::string &v, const std::string &field, size_t maxLen)
{
    if (v.empty())
    {
        throw common::AppException("INVALID_ARGUMENT", field + "不能为空", drogon::k422UnprocessableEntity);
    }
    if (v.size() > maxLen)
    {
        throw common::AppException("INVALID_ARGUMENT",
                                   field + "长度不能超过 " + std::to_string(maxLen),
                                   drogon::k422UnprocessableEntity);
    }
}
}  // namespace

CommunityService::CommunityService(infrastructure::storage::CommunityRepository &repo)
    : repo_(repo)
{
}

Json::Value CommunityService::listPosts(const std::string &paperId) const
{
    if (paperId.empty())
    {
        throw common::AppException("INVALID_ARGUMENT", "paper_id 必填", drogon::k422UnprocessableEntity);
    }
    return repo_.list(paperId);
}

Json::Value CommunityService::createPost(const std::string &paperId,
                                         const std::string &authorId,
                                         const std::string &authorName,
                                         const std::string &title,
                                         const std::string &body)
{
    if (paperId.empty())
    {
        throw common::AppException("INVALID_ARGUMENT", "paper_id 必填", drogon::k422UnprocessableEntity);
    }
    const auto t = trim(title);
    const auto b = trim(body);
    requireNonEmpty(t, "标题", 80);
    requireNonEmpty(b, "内容", 2000);
    return repo_.createPost(paperId, authorId, authorName, t, b);
}

Json::Value CommunityService::removePost(const std::string &paperId, const std::string &postId)
{
    Json::Value out(Json::objectValue);
    out["removed"] = repo_.removePost(paperId, postId);
    out["post_id"] = postId;
    return out;
}

Json::Value CommunityService::addComment(const std::string &paperId,
                                         const std::string &postId,
                                         const std::string &authorId,
                                         const std::string &authorName,
                                         const std::string &body)
{
    const auto b = trim(body);
    requireNonEmpty(b, "评论", 500);
    auto comment = repo_.addComment(paperId, postId, authorId, authorName, b);
    if (comment.isNull())
    {
        throw common::AppException("NOT_FOUND", "帖子不存在", drogon::k404NotFound);
    }
    return comment;
}

Json::Value CommunityService::toggleLike(const std::string &paperId,
                                         const std::string &postId,
                                         const std::string &userId)
{
    auto out = repo_.toggleLike(paperId, postId, userId);
    if (out.isNull())
    {
        throw common::AppException("NOT_FOUND", "帖子不存在", drogon::k404NotFound);
    }
    return out;
}
}  // namespace application::services
