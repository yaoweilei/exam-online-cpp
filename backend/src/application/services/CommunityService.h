#pragma once

// 业务功能 12：社区讨论 Service
//   - 校验长度（title ≤80, body ≤2000, comment ≤500）
//   - 透传 Repository

#include <string>

#include <json/json.h>

#include "infrastructure/storage/CommunityRepository.h"

namespace application::services
{
class CommunityService
{
  public:
    explicit CommunityService(infrastructure::storage::CommunityRepository &repo);

    Json::Value listPosts(const std::string &paperId) const;

    Json::Value createPost(const std::string &paperId,
                           const std::string &authorId,
                           const std::string &authorName,
                           const std::string &title,
                           const std::string &body);

    Json::Value removePost(const std::string &paperId, const std::string &postId);

    Json::Value addComment(const std::string &paperId,
                           const std::string &postId,
                           const std::string &authorId,
                           const std::string &authorName,
                           const std::string &body);

    Json::Value toggleLike(const std::string &paperId,
                           const std::string &postId,
                           const std::string &userId);

  private:
    infrastructure::storage::CommunityRepository &repo_;
};
}  // namespace application::services
