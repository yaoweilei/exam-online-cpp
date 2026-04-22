#include "DataExportService.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>

#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
// userId 文件名安全消毒（同 BookmarkFolderRepository 的策略）
std::string sanitizeUserId(const std::string &userId)
{
    if (userId.empty())
    {
        return "_unknown";
    }
    std::string out;
    out.reserve(userId.size());
    for (char c : userId)
    {
        const unsigned char uc = static_cast<unsigned char>(c);
        if (std::isalnum(uc) || c == '-' || c == '_' || c == '.')
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

// 安全读取一个 JSON 文件；不存在或解析失败均返回 null
Json::Value tryReadJson(const std::filesystem::path &path)
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

std::string nowIso8601Utc()
{
    using clock = std::chrono::system_clock;
    const auto now = clock::now();
    const auto time = clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &time);
#else
    gmtime_r(&time, &tm);
#endif
    char buf[32]{};
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

// 单文件 per-user 的常规模块路径
std::filesystem::path perUserFile(const std::filesystem::path &root,
                                  const std::string &module,
                                  const std::string &safeId)
{
    return root / module / (safeId + ".json");
}
}  // namespace

DataExportService::DataExportService(std::filesystem::path userRootDir,
                                     std::filesystem::path systemDir)
    : userRootDir_(std::move(userRootDir)), systemDir_(std::move(systemDir))
{
}

Json::Value DataExportService::exportUserData(const std::string &userId) const
{
    const auto safeId = sanitizeUserId(userId);

    Json::Value out(Json::objectValue);
    out["user_id"] = userId;
    out["exported_at"] = nowIso8601Utc();
    out["schema_version"] = 1;

    Json::Value modules(Json::objectValue);
    // 单文件 per-user 模块（按模块名约定：data/user/<module>/<userId>.json）
    modules["profile"] = tryReadJson(perUserFile(userRootDir_, "profile", safeId));
    modules["bookmarks"] = tryReadJson(perUserFile(userRootDir_, "bookmarks", safeId));
    modules["wrong_questions"] = tryReadJson(perUserFile(userRootDir_, "wrong_questions", safeId));
    modules["streak"] = tryReadJson(perUserFile(userRootDir_, "streak", safeId));
    modules["draft"] = tryReadJson(perUserFile(userRootDir_, "drafts", safeId));
    modules["attempt_timer"] = tryReadJson(perUserFile(userRootDir_, "attempt_timer", safeId));
    modules["srs"] = tryReadJson(perUserFile(userRootDir_, "srs", safeId));
    modules["bookmark_folders"] = tryReadJson(perUserFile(userRootDir_, "bookmark_folders", safeId));

    // 答题历史：data/user/answers/{userId}/*.json
    Json::Value answers(Json::objectValue);
    const auto answersDir = userRootDir_ / "answers" / safeId;
    std::error_code ec;
    if (std::filesystem::is_directory(answersDir, ec))
    {
        for (const auto &entry : std::filesystem::directory_iterator(answersDir, ec))
        {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            const auto path = entry.path();
            if (path.extension() != ".json") continue;
            const auto examId = path.stem().string();
            answers[examId] = tryReadJson(path);
        }
    }
    modules["answers"] = answers;

    // 题目反馈：仅返回该用户为 reporter 的条目（按试卷拆分文件）
    Json::Value feedback(Json::arrayValue);
    const auto feedbackDir = userRootDir_ / "feedback";
    if (std::filesystem::is_directory(feedbackDir, ec))
    {
        for (const auto &entry : std::filesystem::directory_iterator(feedbackDir, ec))
        {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            const auto data = tryReadJson(entry.path());
            if (!data.isObject() || !data.isMember("items") || !data["items"].isArray()) continue;
            for (const auto &item : data["items"])
            {
                if (item.get("reporter_id", "").asString() == userId)
                {
                    feedback.append(item);
                }
            }
        }
    }
    modules["feedback"] = feedback;

    out["modules"] = modules;
    return out;
}
}  // namespace application::services
