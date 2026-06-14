#include "application/services/LearningReportService.h"

#include <algorithm>
#include <chrono>
#include <ctime>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
std::string sanitize(const std::string &s)
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
}  // namespace

LearningReportService::LearningReportService(infrastructure::storage::AnswerRepository &answerRepo,
                                             infrastructure::storage::WrongQuestionRepository &wrongRepo,
                                             infrastructure::storage::SrsRepository &srsRepo,
                                             std::filesystem::path userRootDir)
    : answerRepo_(answerRepo), wrongRepo_(wrongRepo), srsRepo_(srsRepo),
      streakDir_(std::move(userRootDir) / "streak")
{
}

// 计算"距今 N 天"对应的 ISO8601 起点（取当地 00:00 简化为 UTC 减天数）
std::string LearningReportService::sinceFor(const std::string &period)
{
    using namespace std::chrono;
    int days = (period == "month") ? 30 : 7;
    auto t = system_clock::now() - hours(24 * days);
    const auto tt = system_clock::to_time_t(t);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &tt);
#else
    gmtime_r(&tt, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

Json::Value LearningReportService::generate(const std::string &userId, const std::string &periodIn) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    const std::string period = (periodIn == "month") ? "month" : "week";
    const auto since = sinceFor(period);
    const auto until = common::nowIso8601();

    // ---- 答题数据聚合 ----
    int exams = 0;
    long long questions = 0, correct = 0, wrong = 0, unanswered = 0;
    Json::Value papers(Json::arrayValue);
    const auto answers = answerRepo_.listUserAnswers(userId);
    for (const auto &doc : answers)
    {
        const auto savedAt = doc.get("saved_at", "").asString();
        if (savedAt < since) continue;
        ++exams;
        const auto &stats = doc["statistics"];
        const long long tq = stats.get("total_questions", 0).asInt64();
        const long long cc = stats.get("correct_count", 0).asInt64();
        const long long wc = stats.get("wrong_count", 0).asInt64();
        const long long uc = stats.get("unanswered_count", 0).asInt64();
        questions += tq;
        correct += cc;
        wrong += wc;
        unanswered += uc;

        Json::Value paper(Json::objectValue);
        paper["exam_id"] = doc.get("exam_id", "");
        paper["saved_at"] = savedAt;
        paper["total_questions"] = static_cast<Json::Int64>(tq);
        paper["correct_count"] = static_cast<Json::Int64>(cc);
        paper["wrong_count"] = static_cast<Json::Int64>(wc);
        paper["accuracy"] = stats.get("accuracy", 0).asDouble();
        papers.append(paper);
    }
    // 按 saved_at 倒序，最多保留 20 条
    std::vector<Json::Value> arr(papers.begin(), papers.end());
    std::sort(arr.begin(), arr.end(), [](const Json::Value &a, const Json::Value &b) {
        return a.get("saved_at", "").asString() > b.get("saved_at", "").asString();
    });
    if (arr.size() > 20) arr.resize(20);
    papers = Json::Value(Json::arrayValue);
    for (const auto &p : arr) papers.append(p);

    Json::Value answersBlock(Json::objectValue);
    answersBlock["exams"] = exams;
    answersBlock["questions"] = static_cast<Json::Int64>(questions);
    answersBlock["correct"] = static_cast<Json::Int64>(correct);
    answersBlock["wrong"] = static_cast<Json::Int64>(wrong);
    answersBlock["unanswered"] = static_cast<Json::Int64>(unanswered);
    answersBlock["accuracy"] = questions > 0 ? static_cast<double>(correct) / static_cast<double>(questions) : 0.0;
    answersBlock["papers"] = papers;

    // ---- 错题统计 ----
    Json::Value wrongBlock(Json::objectValue);
    int addedInPeriod = 0, totalWrong = 0, mastered = 0;
    auto wrongDoc = wrongRepo_.load(userId);
    if (wrongDoc.isMember("items") && wrongDoc["items"].isArray())
    {
        for (const auto &it : wrongDoc["items"])
        {
            ++totalWrong;
            if (it.get("mastered", false).asBool()) ++mastered;
            // 用 first_wrong_at 判断是否本期新增；缺失则用 last_wrong_at 兜底
            const auto firstAt = it.get("first_wrong_at",
                                        it.get("last_wrong_at", "")).asString();
            if (!firstAt.empty() && firstAt >= since) ++addedInPeriod;
        }
    }
    wrongBlock["added_in_period"] = addedInPeriod;
    wrongBlock["total"] = totalWrong;
    wrongBlock["mastered"] = mastered;

    // ---- SRS 统计 ----
    Json::Value srsBlock(Json::objectValue);
    int srsTotal = 0, srsDue = 0;
    const auto due = srsRepo_.listDue(userId, common::nowIso8601(), 9999);
    if (due.isArray()) srsDue = static_cast<int>(due.size());
    // 总卡数从 SrsRepository 没有 list 接口，简化为 due 数量；后续可扩展
    srsBlock["due"] = srsDue;
    srsBlock["total_estimate"] = srsTotal == 0 ? srsDue : srsTotal;

    // ---- 连续天数 ----
    Json::Value streakBlock(Json::objectValue);
    try
    {
        const auto streakPath = streakDir_ / (sanitize(userId) + ".json");
        if (std::filesystem::exists(streakPath))
        {
            const auto sd = infrastructure::storage::readJsonFile(streakPath);
            streakBlock["current"] = sd.get("streak_current", 0);
            streakBlock["best"] = sd.get("streak_best", 0);
            streakBlock["daily_goal"] = sd.get("daily_goal", Json::Value(Json::objectValue));
            streakBlock["last_active_date"] = sd.get("last_active_date", "");
        }
    }
    catch (...) { /* 忽略读取失败 */ }

    Json::Value out(Json::objectValue);
    out["period"] = period;
    out["since"] = since;
    out["until"] = until;
    out["answers"] = answersBlock;
    out["wrong_questions"] = wrongBlock;
    out["srs"] = srsBlock;
    out["streak"] = streakBlock;
    return out;
}
}  // namespace application::services
