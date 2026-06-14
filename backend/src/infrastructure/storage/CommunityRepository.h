#pragma once

// 业务功能 12：社区讨论 Repository
// - 文件：data/user/community/{paperId}.json
//   按试卷聚合（与 FeedbackRepository 同思路），便于一份卷子的所有讨论一起读
// - 数据结构：
//   {
//     "paper_id": "...",
//     "posts": [
//       {
//         "post_id": "post_uuid",
//         "author_id": "...",
//         "author_name": "...",
//         "title": "...",
//         "body": "...",
//         "created_at": "...",
//         "updated_at": "...",
//         "likes": ["userId", ...],          // 点赞用户集（去重）
//         "comments": [
//           { "comment_id": "...", "author_id": "...", "author_name": "...",
//             "body": "...", "created_at": "..." }
//         ]
//       }
//     ]
//   }

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

namespace infrastructure::storage
{
class CommunityRepository
{
  public:
    explicit CommunityRepository(std::filesystem::path userRootDir);

    // 列出某试卷的全部帖子（按 created_at 倒序）
    Json::Value list(const std::string &paperId) const;

    // 创建帖子；返回入库后的对象（含 post_id）
    Json::Value createPost(const std::string &paperId,
                           const std::string &authorId,
                           const std::string &authorName,
                           const std::string &title,
                           const std::string &body);

    // 删除帖子（仅作者或管理员，由 Service 层校验）
    bool removePost(const std::string &paperId, const std::string &postId);

    // 在帖子下追加评论
    Json::Value addComment(const std::string &paperId,
                           const std::string &postId,
                           const std::string &authorId,
                           const std::string &authorName,
                           const std::string &body);

    // 点赞 / 取消点赞；返回 {liked: bool, like_count: number}；找不到帖子返回 null
    Json::Value toggleLike(const std::string &paperId,
                           const std::string &postId,
                           const std::string &userId);

  private:
    std::filesystem::path filePath(const std::string &paperId) const;

    std::filesystem::path communityDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
