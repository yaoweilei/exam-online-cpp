#include "AdminStatisticsService.h"

#include <chrono>
#include <ctime>
#include <unordered_map>

#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
std::string nowIso8601Utc()
{
    using clock = std::chrono::system_clock;
    const auto t = clock::to_time_t(clock::now());
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32]{};
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

Json::Value safeRead(const std::filesystem::path &path)
{
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec)
    {
        return Json::Value(Json::nullValue);
    }
    try
    {
        return infrastructure::storage::readJsonFile(path);
    }
    catch (...)
    {
        return Json::Value(Json::nullValue);
    }
}

// 计数指定目录里 *.json 的数量（顶层文件，不递归）
size_t countJsonFiles(const std::filesystem::path &dir)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) return 0;
    size_t n = 0;
    for (const auto &e : std::filesystem::directory_iterator(dir, ec))
    {
        if (ec) break;
        if (e.is_regular_file() && e.path().extension() == ".json")
        {
            ++n;
        }
    }
    return n;
}

// 计数指定目录里子目录数（用于 answers/{userId} 风格统计「有过答题的用户数」）
size_t countSubDirs(const std::filesystem::path &dir)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) return 0;
    size_t n = 0;
    for (const auto &e : std::filesystem::directory_iterator(dir, ec))
    {
        if (ec) break;
        if (e.is_directory()) ++n;
    }
    return n;
}

// 递归统计 answers 总文件数（每份 = 一次答题快照）
size_t countAnswerPapers(const std::filesystem::path &dir)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) return 0;
    size_t n = 0;
    for (const auto &e : std::filesystem::recursive_directory_iterator(dir, ec))
    {
        if (ec) break;
        if (e.is_regular_file() && e.path().extension() == ".json")
        {
            ++n;
        }
    }
    return n;
}
}  // namespace

AdminStatisticsService::AdminStatisticsService(std::filesystem::path userRootDir,
                                              std::filesystem::path systemDir,
                                              std::filesystem::path paperDir)
    : userRootDir_(std::move(userRootDir)),
      systemDir_(std::move(systemDir)),
      paperDir_(std::move(paperDir))
{
}

Json::Value AdminStatisticsService::overview() const
{
    Json::Value out(Json::objectValue);
    out["generated_at"] = nowIso8601Utc();

    // ------ 用户：总数 + 按角色分桶 ------
    Json::Value usersBlock(Json::objectValue);
    std::unordered_map<std::string, size_t> roleCounts;
    size_t totalUsers = 0;
    const auto usersJson = safeRead(userRootDir_ / "users.json");
    if (usersJson.isObject() && usersJson["users"].isArray())
    {
        for (const auto &u : usersJson["users"])
        {
            ++totalUsers;
            if (u.isMember("roleIds") && u["roleIds"].isArray())
            {
                for (const auto &r : u["roleIds"])
                {
                    if (r.isString())
                    {
                        roleCounts[r.asString()]++;
                    }
                }
            }
        }
    }
    usersBlock["total"] = static_cast<Json::UInt64>(totalUsers);
    Json::Value byRole(Json::objectValue);
    for (const auto &[k, v] : roleCounts)
    {
        byRole[k] = static_cast<Json::UInt64>(v);
    }
    usersBlock["by_role"] = byRole;
    out["users"] = usersBlock;

    // ------ 组织：总数 ------
    Json::Value orgBlock(Json::objectValue);
    size_t orgCount = 0;
    const auto orgJson = safeRead(userRootDir_ / "organizations.json");
    if (orgJson.isObject())
    {
        orgCount = orgJson.getMemberNames().size();
    }
    orgBlock["total"] = static_cast<Json::UInt64>(orgCount);
    out["organizations"] = orgBlock;

    // ------ 内容：试卷文件数（递归 paperDir 下 *.json） ------
    Json::Value contentBlock(Json::objectValue);
    contentBlock["exam_files"] = static_cast<Json::UInt64>(countAnswerPapers(paperDir_));
    out["content"] = contentBlock;

    // ------ 活跃度：答题/错题/SRS/收藏夹/反馈 ------
    Json::Value activity(Json::objectValue);
    activity["answer_users"] = static_cast<Json::UInt64>(countSubDirs(userRootDir_ / "answers"));
    activity["answer_papers"] = static_cast<Json::UInt64>(countAnswerPapers(userRootDir_ / "answers"));
    activity["wrong_question_users"] = static_cast<Json::UInt64>(countJsonFiles(userRootDir_ / "wrong_questions"));
    activity["srs_users"] = static_cast<Json::UInt64>(countJsonFiles(userRootDir_ / "srs"));
    activity["bookmark_folder_users"] = static_cast<Json::UInt64>(countJsonFiles(userRootDir_ / "bookmark_folders"));

    // 反馈：按试卷文件聚合 items 数量
    size_t feedbackPapers = 0;
    size_t feedbackItems = 0;
    const auto feedbackDir = userRootDir_ / "feedback";
    std::error_code ec;
    if (std::filesystem::is_directory(feedbackDir, ec))
    {
        for (const auto &e : std::filesystem::directory_iterator(feedbackDir, ec))
        {
            if (ec) break;
            if (!e.is_regular_file() || e.path().extension() != ".json") continue;
            ++feedbackPapers;
            const auto data = safeRead(e.path());
            if (data.isObject() && data["items"].isArray())
            {
                feedbackItems += data["items"].size();
            }
        }
    }
    activity["feedback_papers"] = static_cast<Json::UInt64>(feedbackPapers);
    activity["feedback_items"] = static_cast<Json::UInt64>(feedbackItems);
    out["activity"] = activity;

    return out;
}
}  // namespace application::services
