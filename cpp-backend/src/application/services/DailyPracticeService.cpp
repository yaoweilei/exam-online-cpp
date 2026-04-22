#include "application/services/DailyPracticeService.h"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <set>
#include <string>
#include <unordered_set>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
constexpr const char *kDirName = "daily_practice";
}

DailyPracticeService::DailyPracticeService(std::filesystem::path userRootDir,
                                           infrastructure::storage::WrongQuestionRepository &wrongRepo,
                                           SrsService &srsService)
    : rootDir_(std::move(userRootDir) / kDirName), wrongRepo_(wrongRepo), srsService_(srsService)
{
    std::error_code ec;
    std::filesystem::create_directories(rootDir_, ec);
}

std::string DailyPracticeService::sanitize(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
            out.push_back(c);
        else
            out.push_back('_');
    }
    return out;
}

std::filesystem::path DailyPracticeService::fileFor(const std::string &userId) const
{
    return rootDir_ / (sanitize(userId) + ".json");
}

std::string DailyPracticeService::today()
{
    using namespace std::chrono;
    const auto t = system_clock::to_time_t(system_clock::now());
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    char buf[16];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", &tm);
    return std::string(buf);
}

// 构造今日题目列表：先从错题本拉 70%（按 last_wrong_at 倒序），剩余从 SRS 到期卡补足
Json::Value DailyPracticeService::buildItems(const std::string &userId, int targetCount) const
{
    Json::Value items(Json::arrayValue);
    std::unordered_set<std::string> seen;  // 以 question_id 去重

    const int wrongTarget = std::max(1, targetCount * 7 / 10);

    // ---- 错题本来源 ----
    auto wrongDoc = wrongRepo_.load(userId);
    auto &wrongItems = wrongDoc["items"];
    if (wrongItems.isArray())
    {
        // 复制可排序索引
        std::vector<Json::Value> arr;
        arr.reserve(wrongItems.size());
        for (const auto &x : wrongItems)
        {
            if (x.get("mastered", false).asBool()) continue;  // 已掌握跳过
            arr.push_back(x);
        }
        std::sort(arr.begin(), arr.end(), [](const Json::Value &a, const Json::Value &b) {
            return a.get("last_wrong_at", "").asString() > b.get("last_wrong_at", "").asString();
        });
        for (const auto &x : arr)
        {
            if (static_cast<int>(items.size()) >= wrongTarget) break;
            const auto qid = x.get("question_id", "").asString();
            if (qid.empty() || seen.count(qid)) continue;
            seen.insert(qid);
            Json::Value item(Json::objectValue);
            item["question_id"] = qid;
            item["exam_id"] = x.get("exam_id", "");
            item["section_id"] = x.get("section_id", "");
            item["question_type"] = x.get("question_type", "");
            item["source"] = "wrong_question";
            item["question_snapshot"] = x.get("question_snapshot", Json::Value(Json::objectValue));
            items.append(item);
        }
    }

    // ---- SRS 到期来源 ----
    const int remain = targetCount - static_cast<int>(items.size());
    if (remain > 0)
    {
        auto due = srsService_.listDue(userId, remain * 2);  // 多取一些以便去重
        // SrsService::listDue 返回 {items:[...]}，兼容直接数组的情况
        const auto &arr = (due.isObject() && due.isMember("items")) ? due["items"] : due;
        if (arr.isArray())
        {
            for (const auto &card : arr)
            {
                if (static_cast<int>(items.size()) >= targetCount) break;
                // SRS 卡 card_id 形如 "{examId}:{questionId}"，按需拆分；优先使用显式字段
                std::string qid = card.get("question_id", "").asString();
                std::string eid = card.get("exam_id", "").asString();
                const auto cardId = card.get("card_id", "").asString();
                if ((qid.empty() || eid.empty()) && !cardId.empty())
                {
                    const auto pos = cardId.find(':');
                    if (pos != std::string::npos)
                    {
                        if (eid.empty()) eid = cardId.substr(0, pos);
                        if (qid.empty()) qid = cardId.substr(pos + 1);
                    }
                }
                if (qid.empty() || seen.count(qid)) continue;
                seen.insert(qid);
                Json::Value item(Json::objectValue);
                item["question_id"] = qid;
                item["exam_id"] = eid;
                item["card_id"] = cardId;
                item["source"] = "srs_due";
                items.append(item);
            }
        }
    }

    return items;
}

Json::Value DailyPracticeService::getOrCreateToday(const std::string &userId, int targetCount) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    targetCount = std::clamp(targetCount, 1, 50);
    const auto path = fileFor(userId);
    Json::Value doc;
    try
    {
        doc = infrastructure::storage::readJsonFile(path);
    }
    catch (...)
    {
        doc = Json::Value(Json::nullValue);
    }

    const auto td = today();
    if (doc.isObject() && doc.get("date", "").asString() == td)
    {
        // 已存在今日缓存，直接返回
        return doc;
    }

    Json::Value next(Json::objectValue);
    next["user_id"] = userId;
    next["date"] = td;
    next["target_count"] = targetCount;
    next["items"] = buildItems(userId, targetCount);
    next["completed_question_ids"] = Json::Value(Json::arrayValue);
    next["generated_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(path, next);
    return next;
}

Json::Value DailyPracticeService::regenerate(const std::string &userId, int targetCount) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    targetCount = std::clamp(targetCount, 1, 50);
    const auto path = fileFor(userId);
    Json::Value doc(Json::objectValue);
    doc["user_id"] = userId;
    doc["date"] = today();
    doc["target_count"] = targetCount;
    doc["items"] = buildItems(userId, targetCount);
    doc["completed_question_ids"] = Json::Value(Json::arrayValue);
    doc["generated_at"] = common::nowIso8601();
    doc["regenerated"] = true;
    infrastructure::storage::writeJsonFileAtomic(path, doc);
    return doc;
}

Json::Value DailyPracticeService::markComplete(const std::string &userId, const std::string &questionId) const
{
    if (userId.empty() || questionId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id 与 question_id 必填", drogon::k422UnprocessableEntity);
    auto doc = getOrCreateToday(userId);
    auto &arr = doc["completed_question_ids"];
    if (!arr.isArray()) arr = Json::Value(Json::arrayValue);
    // 去重添加
    bool exists = false;
    for (const auto &v : arr)
    {
        if (v.asString() == questionId) { exists = true; break; }
    }
    if (!exists) arr.append(questionId);
    doc["last_completed_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(fileFor(userId), doc);
    return doc;
}
}  // namespace application::services
