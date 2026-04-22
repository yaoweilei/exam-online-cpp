#include "SrsService.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <unordered_map>

#include <drogon/HttpTypes.h>

#include "common/AppException.h"
#include "common/TimeUtils.h"

namespace application::services
{

namespace
{
// 在当前时刻基础上加 days 天，返回 ISO8601（UTC）
std::string addDaysIso(int days)
{
    using namespace std::chrono;
    auto t = system_clock::now() + hours(24 * days);
    std::time_t tt = system_clock::to_time_t(t);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &tt);
#else
    gmtime_r(&tt, &tm);
#endif
    std::ostringstream os;
    os << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return os.str();
}

// 简化的 question snapshot 抽取：复用错题本的字段约定
Json::Value buildSnapshot(const Json::Value &q)
{
    if (!q.isObject())
    {
        return Json::Value(Json::objectValue);
    }
    Json::Value out(Json::objectValue);
    for (const char *f : {"question", "options", "correct_answer", "explanation", "type", "passage"})
    {
        if (q.isMember(f))
        {
            out[f] = q[f];
        }
    }
    return out;
}

std::string pickType(const Json::Value &q)
{
    if (q.isObject() && q.isMember("type"))
    {
        return q["type"].asString();
    }
    return {};
}

// 建立 questionId -> question 索引，跨 sections 与扁平结构兼容
std::unordered_map<std::string, Json::Value> buildIndex(const Json::Value &examData)
{
    std::unordered_map<std::string, Json::Value> idx;
    auto pushArr = [&](const Json::Value &arr) {
        if (!arr.isArray()) return;
        for (const auto &q : arr)
        {
            if (q.isObject() && q.isMember("id"))
            {
                idx[q["id"].asString()] = q;
            }
        }
    };
    if (examData.isObject())
    {
        if (examData.isMember("sections") && examData["sections"].isArray())
        {
            for (const auto &s : examData["sections"])
            {
                if (s.isObject() && s.isMember("questions"))
                {
                    pushArr(s["questions"]);
                }
            }
        }
        if (examData.isMember("questions"))
        {
            pushArr(examData["questions"]);
        }
    }
    return idx;
}
}  // namespace

SrsService::SrsService(infrastructure::storage::SrsRepository &repository)
    : repository_(repository)
{
}

Json::Value SrsService::listDue(const std::string &userId, int limit) const
{
    Json::Value out(Json::objectValue);
    out["items"] = repository_.listDue(userId, common::nowIso8601(), limit);
    out["fetched_at"] = common::nowIso8601();
    return out;
}

Json::Value SrsService::listAll(const std::string &userId) const
{
    Json::Value out(Json::objectValue);
    out["items"] = repository_.list(userId);
    return out;
}

Json::Value SrsService::review(const std::string &userId, const std::string &cardId, int grade)
{
    if (grade < 0 || grade > 3)
    {
        throw common::AppException("VALIDATION_ERROR",
                                   "grade 必须是 0-3（再来/困难/良好/容易）",
                                   drogon::k422UnprocessableEntity);
    }
    // 找到当前卡（线性扫；MVP 体量足够）
    auto all = repository_.list(userId);
    Json::Value current;
    for (const auto &c : all)
    {
        if (c.get("card_id", "").asString() == cardId)
        {
            current = c;
            break;
        }
    }
    if (current.isNull())
    {
        throw common::AppException("NOT_FOUND", "卡片不存在", drogon::k404NotFound);
    }

    double ease = current.get("ease", 2.5).asDouble();
    int interval = current.get("interval_days", 0).asInt();
    int reps = current.get("reps", 0).asInt();
    int lapses = current.get("lapses", 0).asInt();

    // SM-2 简化调度
    if (grade == 0)
    {
        // 再来：重置
        reps = 0;
        lapses += 1;
        interval = 1;
        ease = std::max(1.3, ease - 0.2);
    }
    else
    {
        if (grade == 1)
        {
            // 困难
            interval = std::max(1, static_cast<int>(std::round(std::max(1, interval) * 1.2)));
            ease = std::max(1.3, ease - 0.15);
        }
        else if (grade == 2)
        {
            // 良好
            if (reps == 0) interval = 1;
            else if (reps == 1) interval = 3;
            else interval = static_cast<int>(std::round(interval * ease));
            // ease 不变
        }
        else  // grade == 3 容易
        {
            if (reps == 0) interval = 2;
            else if (reps == 1) interval = 4;
            else interval = static_cast<int>(std::round(interval * ease * 1.3));
            ease = ease + 0.15;
        }
        reps += 1;
    }

    Json::Value patch(Json::objectValue);
    patch["ease"] = ease;
    patch["interval_days"] = interval;
    patch["reps"] = reps;
    patch["lapses"] = lapses;
    patch["due_at"] = addDaysIso(interval);
    patch["last_reviewed_at"] = common::nowIso8601();
    patch["last_grade"] = grade;

    if (!repository_.applySchedule(userId, cardId, patch))
    {
        throw common::AppException("NOT_FOUND", "卡片不存在", drogon::k404NotFound);
    }
    patch["card_id"] = cardId;
    return patch;
}

int SrsService::ingestWrongFromScore(const std::string &userId,
                                     const std::string &examId,
                                     const Json::Value &examData,
                                     const Json::Value &scoreResult)
{
    if (userId.empty() || examId.empty()) return 0;
    if (!scoreResult.isMember("results") || !scoreResult["results"].isObject()) return 0;

    const auto qIndex = buildIndex(examData);
    const auto now = common::nowIso8601();
    int added = 0;
    const auto &results = scoreResult["results"];
    for (const auto &qid : results.getMemberNames())
    {
        const auto &row = results[qid];
        if (row.get("status", "").asString() != "wrong") continue;
        Json::Value snap(Json::objectValue);
        std::string qtype;
        auto it = qIndex.find(qid);
        if (it != qIndex.end())
        {
            snap = buildSnapshot(it->second);
            qtype = pickType(it->second);
        }
        if (repository_.upsertCard(userId, examId, qid, qtype, snap, now))
        {
            ++added;
        }
    }
    return added;
}

bool SrsService::ingestSingle(const std::string &userId,
                              const std::string &examId,
                              const std::string &questionId,
                              const std::string &questionType,
                              const Json::Value &snapshot)
{
    return repository_.upsertCard(userId, examId, questionId, questionType, snapshot, common::nowIso8601());
}

bool SrsService::remove(const std::string &userId, const std::string &cardId)
{
    return repository_.removeCard(userId, cardId);
}

}  // namespace application::services
