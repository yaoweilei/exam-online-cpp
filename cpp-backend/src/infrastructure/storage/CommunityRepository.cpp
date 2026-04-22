#include "CommunityRepository.h"

#include <algorithm>

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
namespace
{
// 与 FeedbackRepository 一致的 paperId 文件名消毒
std::string sanitizePaperId(const std::string &paperId)
{
    if (paperId.empty()) return "_unknown";
    std::string out;
    out.reserve(paperId.size());
    for (char c : paperId)
    {
        if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
            || c == '-' || c == '_' || c == '.')
        {
            out.push_back(c);
        }
        else
        {
            out.push_back('_');
        }
    }
    return out;
}

Json::Value loadDoc(const std::filesystem::path &path, const std::string &paperId)
{
    Json::Value doc;
    if (std::filesystem::exists(path))
    {
        doc = readJsonFile(path);
    }
    if (!doc.isObject()) doc = Json::Value(Json::objectValue);
    doc["paper_id"] = paperId;
    if (!doc.isMember("posts") || !doc["posts"].isArray())
    {
        doc["posts"] = Json::Value(Json::arrayValue);
    }
    return doc;
}
}  // namespace

CommunityRepository::CommunityRepository(std::filesystem::path userRootDir)
    : communityDir_(std::move(userRootDir) / "community")
{
    std::filesystem::create_directories(communityDir_);
}

std::filesystem::path CommunityRepository::filePath(const std::string &paperId) const
{
    return communityDir_ / (sanitizePaperId(paperId) + ".json");
}

Json::Value CommunityRepository::list(const std::string &paperId) const
{
    std::shared_lock lock(mutex_);
    const auto path = filePath(paperId);
    if (!std::filesystem::exists(path))
    {
        Json::Value out(Json::objectValue);
        out["paper_id"] = paperId;
        out["posts"] = Json::Value(Json::arrayValue);
        return out;
    }
    auto doc = readJsonFile(path);
    if (!doc.isObject()) doc = Json::Value(Json::objectValue);
    if (!doc.isMember("posts") || !doc["posts"].isArray())
    {
        doc["posts"] = Json::Value(Json::arrayValue);
    }

    // 按 created_at 倒序（仅复制后排序，不写回）
    Json::Value posts = doc["posts"];
    std::vector<Json::Value> v;
    v.reserve(posts.size());
    for (const auto &p : posts) v.push_back(p);
    std::sort(v.begin(), v.end(), [](const Json::Value &a, const Json::Value &b) {
        return a.get("created_at", "").asString() > b.get("created_at", "").asString();
    });
    Json::Value sorted(Json::arrayValue);
    for (const auto &p : v) sorted.append(p);
    doc["posts"] = sorted;
    doc["paper_id"] = paperId;
    return doc;
}

Json::Value CommunityRepository::createPost(const std::string &paperId,
                                            const std::string &authorId,
                                            const std::string &authorName,
                                            const std::string &title,
                                            const std::string &body)
{
    std::unique_lock lock(mutex_);
    const auto path = filePath(paperId);
    auto doc = loadDoc(path, paperId);

    Json::Value post(Json::objectValue);
    post["post_id"] = common::generateOpaqueId("post_");
    post["author_id"] = authorId;
    post["author_name"] = authorName;
    post["title"] = title;
    post["body"] = body;
    const auto now = common::nowIso8601();
    post["created_at"] = now;
    post["updated_at"] = now;
    post["likes"] = Json::Value(Json::arrayValue);
    post["comments"] = Json::Value(Json::arrayValue);

    doc["posts"].append(post);
    writeJsonFileAtomic(path, doc);
    return post;
}

bool CommunityRepository::removePost(const std::string &paperId, const std::string &postId)
{
    std::unique_lock lock(mutex_);
    const auto path = filePath(paperId);
    if (!std::filesystem::exists(path)) return false;
    auto doc = readJsonFile(path);
    if (!doc.isObject() || !doc["posts"].isArray()) return false;

    Json::Value next(Json::arrayValue);
    bool removed = false;
    for (const auto &p : doc["posts"])
    {
        if (p.get("post_id", "").asString() == postId)
        {
            removed = true;
            continue;
        }
        next.append(p);
    }
    if (!removed) return false;
    doc["posts"] = next;
    writeJsonFileAtomic(path, doc);
    return true;
}

Json::Value CommunityRepository::addComment(const std::string &paperId,
                                            const std::string &postId,
                                            const std::string &authorId,
                                            const std::string &authorName,
                                            const std::string &body)
{
    std::unique_lock lock(mutex_);
    const auto path = filePath(paperId);
    auto doc = loadDoc(path, paperId);

    bool found = false;
    Json::Value comment(Json::objectValue);
    comment["comment_id"] = common::generateOpaqueId("cmt_");
    comment["author_id"] = authorId;
    comment["author_name"] = authorName;
    comment["body"] = body;
    comment["created_at"] = common::nowIso8601();

    for (auto &p : doc["posts"])
    {
        if (p.get("post_id", "").asString() == postId)
        {
            if (!p.isMember("comments") || !p["comments"].isArray())
            {
                p["comments"] = Json::Value(Json::arrayValue);
            }
            p["comments"].append(comment);
            p["updated_at"] = common::nowIso8601();
            found = true;
            break;
        }
    }
    if (!found) return Json::Value(Json::nullValue);
    writeJsonFileAtomic(path, doc);
    return comment;
}

Json::Value CommunityRepository::toggleLike(const std::string &paperId,
                                            const std::string &postId,
                                            const std::string &userId)
{
    std::unique_lock lock(mutex_);
    const auto path = filePath(paperId);
    if (!std::filesystem::exists(path)) return Json::Value(Json::nullValue);
    auto doc = readJsonFile(path);
    if (!doc.isObject() || !doc["posts"].isArray()) return Json::Value(Json::nullValue);

    for (auto &p : doc["posts"])
    {
        if (p.get("post_id", "").asString() != postId) continue;
        if (!p.isMember("likes") || !p["likes"].isArray())
        {
            p["likes"] = Json::Value(Json::arrayValue);
        }
        Json::Value next(Json::arrayValue);
        bool liked = true;
        bool exists = false;
        for (const auto &u : p["likes"])
        {
            if (u.asString() == userId)
            {
                exists = true;
                continue;  // 取消点赞 → 不复制
            }
            next.append(u);
        }
        if (!exists)
        {
            next.append(userId);
            liked = true;
        }
        else
        {
            liked = false;
        }
        p["likes"] = next;
        writeJsonFileAtomic(path, doc);
        Json::Value out(Json::objectValue);
        out["liked"] = liked;
        out["like_count"] = static_cast<Json::UInt>(next.size());
        return out;
    }
    return Json::Value(Json::nullValue);
}
}  // namespace infrastructure::storage
