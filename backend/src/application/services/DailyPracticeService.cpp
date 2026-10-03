#include "application/services/DailyPracticeService.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <functional>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
constexpr const char *kDirName = "daily_practice";

std::string scalarString(const Json::Value &value)
{
    if (value.isString()) return value.asString();
    if (value.isIntegral()) return std::to_string(value.asInt64());
    return {};
}

std::string questionKey(const std::string &examId, const std::string &questionId)
{
    return examId + '\x1f' + questionId;
}

std::string lowerCopy(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string upperCopy(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    return value;
}

bool matchesTarget(const domain::ExamSummary &exam, const std::string &target)
{
    if (target.empty()) return true;
    const auto normalized = lowerCopy(target);
    if (normalized.find("eju") != std::string::npos) return lowerCopy(exam.family) == "eju";
    const auto marker = normalized.find('n');
    const auto level = marker == std::string::npos ? std::string{} : upperCopy(normalized.substr(marker, 2));
    return lowerCopy(exam.family) == "jlpt" && !level.empty() && upperCopy(exam.level) == level;
}

std::string isoDaysAgo(int days)
{
    using namespace std::chrono;
    const auto t = system_clock::to_time_t(system_clock::now() - hours(24 * days));
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::ostringstream out;
    out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");
    return out.str();
}

int estimatedMinutes(const std::string &sectionType, int questionCount, bool material)
{
    const auto type = lowerCopy(sectionType);
    if (type.find("writing") != std::string::npos) return 20;
    if (type.find("listening_reading") != std::string::npos) return std::max(3, questionCount * 3);
    if (type.find("listening") != std::string::npos) return std::max(2, questionCount * 2);
    if (type.find("reading") != std::string::npos) return std::max(3, questionCount * 2 + (material ? 1 : 0));
    if (type.find("vocab") != std::string::npos || type.find("grammar") != std::string::npos) return std::max(1, questionCount);
    return std::max(1, questionCount * 2);
}

bool isAtomicMaterial(const Json::Value &section, const Json::Value &passage)
{
    const auto type = lowerCopy(section.get("section_type", "").asString());
    return type.find("reading") != std::string::npos ||
           type.find("listening") != std::string::npos ||
           type.find("writing") != std::string::npos ||
           passage.isMember("passage") || passage.isMember("audio") || passage.isMember("audio_url") ||
           (passage.isMember("assets") && passage["assets"].isArray() && !passage["assets"].empty());
}

struct QuestionGroup
{
    Json::Value items{Json::arrayValue};
    int minutes{1};
};
}

DailyPracticeService::DailyPracticeService(std::filesystem::path userRootDir,
                                           infrastructure::storage::WrongQuestionRepository &wrongRepo,
                                           SrsService &srsService,
                                           infrastructure::storage::ExamRepository &examRepo,
                                           infrastructure::storage::AnswerRepository &answerRepo)
    : rootDir_(std::move(userRootDir) / kDirName),
      wrongRepo_(wrongRepo),
      srsService_(srsService),
      examRepo_(examRepo),
      answerRepo_(answerRepo)
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

std::filesystem::path DailyPracticeService::fileFor(const std::string &userId, const std::string &examTarget) const
{
    const auto suffix = examTarget.empty() ? std::string{} : "__" + sanitize(examTarget);
    return rootDir_ / (sanitize(userId) + suffix + ".json");
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

// 今日题目只从当前目标中选取；阅读、听力和记述以材料为最小单位。
Json::Value DailyPracticeService::buildItems(const std::string &userId,
                                             int targetCount,
                                             const std::string &examTarget,
                                             int dailyMinutes,
                                             int &plannedMinutes) const
{
    Json::Value items(Json::arrayValue);
    std::unordered_set<std::string> seen;
    std::unordered_set<std::string> recent;
    const auto cutoff = isoDaysAgo(7);
    for (const auto &answer : answerRepo_.listUserAnswers(userId))
    {
        if (answer.get("saved_at", "").asString() < cutoff) continue;
        const auto examId = answer.get("exam_id", "").asString();
        const auto &results = answer["statistics"]["results"];
        if (!results.isObject()) continue;
        for (const auto &name : results.getMemberNames())
        {
            const auto &result = results[name];
            const auto status = result.get("status", "").asString();
            const auto questionId = scalarString(result["question_id"]);
            if ((status == "correct" || status == "wrong") && !questionId.empty())
                recent.insert(questionKey(examId, questionId));
        }
    }

    auto exams = examRepo_.listExams();
    exams.erase(std::remove_if(exams.begin(), exams.end(), [&](const auto &exam) {
        return exam.questionCount <= 0 || (!exam.accessLevel.empty() && exam.accessLevel != "free") || !matchesTarget(exam, examTarget);
    }), exams.end());
    std::sort(exams.begin(), exams.end(), [](const auto &left, const auto &right) { return left.id < right.id; });
    std::unordered_map<std::string, domain::ExamSummary> examById;
    for (const auto &exam : exams) examById.emplace(exam.id, exam);

    const int budget = dailyMinutes > 0 ? std::clamp(dailyMinutes, 5, 180) : std::max(5, targetCount * 2);
    const int maxItems = std::clamp(targetCount, 1, 50);
    plannedMinutes = 0;

    const auto makeItem = [](const Json::Value &question,
                             const Json::Value &section,
                             const std::string &examId,
                             const std::string &source,
                             const std::string &materialId,
                             int materialSize,
                             int minutes) {
        Json::Value item(Json::objectValue);
        item["question_id"] = scalarString(question["id"]);
        item["exam_id"] = examId;
        item["section_id"] = scalarString(section["section_id"]);
        item["section_type"] = section.get("section_type", "");
        item["question_type"] = question.get("question_type", "");
        item["source"] = source;
        item["material_id"] = materialId;
        item["material_question_count"] = materialSize;
        item["estimated_minutes"] = minutes;
        item["question_snapshot"] = question;
        return item;
    };

    const auto groupsForExam = [&](const domain::ExamSummary &exam, const std::string &source) {
        std::vector<QuestionGroup> groups;
        Json::Value payload;
        try { payload = examRepo_.getExamById(exam.id); } catch (...) { return groups; }
        const auto &sections = payload["exam_info"]["sections"];
        if (!sections.isArray()) return groups;
        for (const auto &section : sections)
        {
            const auto type = section.get("section_type", "").asString();
            if (section["questions"].isArray())
            {
                for (const auto &question : section["questions"])
                {
                    QuestionGroup group;
                    group.minutes = estimatedMinutes(type, 1, false);
                    group.items.append(makeItem(question, section, exam.id, source,
                                                scalarString(section["section_id"]) + ":" + scalarString(question["id"]), 1, group.minutes));
                    groups.push_back(std::move(group));
                }
            }
            if (!section["passages"].isArray()) continue;
            for (const auto &passage : section["passages"])
            {
                const auto &questions = passage["questions"];
                if (!questions.isArray() || questions.empty()) continue;
                const auto materialId = scalarString(section["section_id"]) + ":p" + scalarString(passage["id"]);
                if (isAtomicMaterial(section, passage))
                {
                    QuestionGroup group;
                    group.minutes = estimatedMinutes(type, static_cast<int>(questions.size()), true);
                    for (const auto &question : questions)
                        group.items.append(makeItem(question, section, exam.id, source, materialId,
                                                    static_cast<int>(questions.size()), group.minutes));
                    groups.push_back(std::move(group));
                }
                else
                {
                    for (const auto &question : questions)
                    {
                        QuestionGroup group;
                        group.minutes = estimatedMinutes(type, 1, false);
                        group.items.append(makeItem(question, section, exam.id, source,
                                                    materialId + ":" + scalarString(question["id"]), 1, group.minutes));
                        groups.push_back(std::move(group));
                    }
                }
            }
        }
        return groups;
    };

    const auto appendGroup = [&](const QuestionGroup &group) {
        if (!group.items.isArray() || group.items.empty()) return false;
        if (static_cast<int>(items.size() + group.items.size()) > maxItems) return false;
        if (plannedMinutes + group.minutes > budget) return false;
        for (const auto &item : group.items)
        {
            const auto key = questionKey(item.get("exam_id", "").asString(), item.get("question_id", "").asString());
            if (seen.count(key) || recent.count(key)) return false;
        }
        for (const auto &item : group.items)
        {
            seen.insert(questionKey(item.get("exam_id", "").asString(), item.get("question_id", "").asString()));
            items.append(item);
        }
        plannedMinutes += group.minutes;
        return true;
    };

    const auto findRecordedGroup = [&](const Json::Value &record, const std::string &source) {
        QuestionGroup empty;
        const auto examId = scalarString(record["exam_id"]);
        const auto questionId = scalarString(record["question_id"]);
        const auto foundExam = examById.find(examId);
        if (foundExam == examById.end() || questionId.empty()) return empty;
        for (auto group : groupsForExam(foundExam->second, source))
        {
            for (const auto &item : group.items)
            {
                if (item.get("question_id", "").asString() != questionId) continue;
                for (auto &groupItem : group.items)
                {
                    if (groupItem.get("question_id", "").asString() == questionId)
                    {
                        if (record.isMember("wrong_count")) groupItem["wrong_count"] = record["wrong_count"];
                        if (record.isMember("card_id")) groupItem["card_id"] = record["card_id"];
                    }
                }
                return group;
            }
        }
        return empty;
    };

    // 到期复习先填充不超过约 40% 的时间预算，并限制为每天最多 10 组。
    // 其余到期卡保留在 SRS 中，后续日期继续按最早到期顺序安排。
    const auto due = srsService_.listDue(userId, 100);
    const auto &dueItems = due.isObject() && due.isMember("items") ? due["items"] : due;
    std::vector<QuestionGroup> eligibleDueGroups;
    if (dueItems.isArray())
    {
        for (const auto &card : dueItems)
        {
            auto group = findRecordedGroup(card, "srs_due");
            if (group.items.isArray() && !group.items.empty()) eligibleDueGroups.push_back(std::move(group));
        }
        int scheduledDueGroups = 0;
        for (const auto &group : eligibleDueGroups)
        {
            if (plannedMinutes >= std::max(2, budget * 4 / 10)) break;
            if (scheduledDueGroups >= 10) break;
            if (appendGroup(group)) ++scheduledDueGroups;
        }
    }
    const bool hasHeavyDueBacklog = static_cast<int>(eligibleDueGroups.size()) >= std::max(10, budget * 3 / 4);

    // 再用未掌握错题填充约 25% 预算，同一材料中的题一起加入。
    auto wrongDoc = wrongRepo_.load(userId);
    std::vector<Json::Value> wrongItems;
    if (wrongDoc["items"].isArray())
        for (const auto &item : wrongDoc["items"])
            if (!item.get("mastered", false).asBool()) wrongItems.push_back(item);
    std::sort(wrongItems.begin(), wrongItems.end(), [](const auto &left, const auto &right) {
        const auto lw = left.get("wrong_count", 0).asInt(), rw = right.get("wrong_count", 0).asInt();
        return lw == rw ? left.get("last_wrong_at", "").asString() > right.get("last_wrong_at", "").asString() : lw > rw;
    });
    const auto wrongLimit = plannedMinutes + std::max(2, budget * 25 / 100);
    for (const auto &wrong : wrongItems)
    {
        if (plannedMinutes >= wrongLimit) break;
        appendGroup(findRecordedGroup(wrong, "wrong_question"));
    }

    // 剩余时间从当前考试目标的免费题库中补充；用户+日期保证同日稳定。
    const auto start = exams.empty() ? std::size_t{0} : std::hash<std::string>{}(userId + ':' + today() + ':' + examTarget) % exams.size();
    for (std::size_t scanned = 0; !hasHeavyDueBacklog && scanned < exams.size() && plannedMinutes < budget && static_cast<int>(items.size()) < maxItems; ++scanned)
    {
        const auto &exam = exams[(start + scanned) % exams.size()];
        auto groups = groupsForExam(exam, "recommended");
        if (groups.empty()) continue;
        const auto groupStart = std::hash<std::string>{}(userId + ':' + today() + ':' + exam.id) % groups.size();
        for (std::size_t offset = 0; offset < groups.size() && plannedMinutes < budget; ++offset)
            appendGroup(groups[(groupStart + offset) % groups.size()]);
    }
    return items;
}

Json::Value DailyPracticeService::getOrCreateToday(const std::string &userId,
                                                   int targetCount,
                                                   const std::string &examTarget,
                                                   int dailyMinutes) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    targetCount = std::clamp(targetCount, 1, 50);
    const auto path = fileFor(userId, examTarget);
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
    if (doc.isObject() && doc.get("date", "").asString() == td &&
        doc.get("exam_target", "").asString() == examTarget &&
        doc.get("daily_minutes", 0).asInt() == dailyMinutes &&
        doc.get("target_count", 0).asInt() == targetCount)
    {
        // 已存在今日缓存，直接返回
        return doc;
    }

    Json::Value next(Json::objectValue);
    next["user_id"] = userId;
    next["date"] = td;
    next["target_count"] = targetCount;
    next["exam_target"] = examTarget;
    next["daily_minutes"] = dailyMinutes;
    int plannedMinutes = 0;
    try
    {
        next["items"] = buildItems(userId, targetCount, examTarget, dailyMinutes, plannedMinutes);
    }
    catch (...)
    {
        // 个别旧学习数据损坏时仍返回可用的空清单，不让个人中心整体加载失败。
        next["items"] = Json::Value(Json::arrayValue);
    }
    next["planned_minutes"] = plannedMinutes;
    next["completed_question_ids"] = Json::Value(Json::arrayValue);
    next["generated_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(path, next);
    return next;
}

Json::Value DailyPracticeService::regenerate(const std::string &userId,
                                             int targetCount,
                                             const std::string &examTarget,
                                             int dailyMinutes) const
{
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    targetCount = std::clamp(targetCount, 1, 50);
    const auto path = fileFor(userId, examTarget);
    Json::Value doc(Json::objectValue);
    doc["user_id"] = userId;
    doc["date"] = today();
    doc["target_count"] = targetCount;
    doc["exam_target"] = examTarget;
    doc["daily_minutes"] = dailyMinutes;
    int plannedMinutes = 0;
    doc["items"] = buildItems(userId, targetCount, examTarget, dailyMinutes, plannedMinutes);
    doc["planned_minutes"] = plannedMinutes;
    doc["completed_question_ids"] = Json::Value(Json::arrayValue);
    doc["generated_at"] = common::nowIso8601();
    doc["regenerated"] = true;
    infrastructure::storage::writeJsonFileAtomic(path, doc);
    return doc;
}

Json::Value DailyPracticeService::markComplete(const std::string &userId,
                                               const std::string &examId,
                                               const std::string &questionId,
                                               const std::string &examTarget) const
{
    if (userId.empty() || questionId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id 与 question_id 必填", drogon::k422UnprocessableEntity);
    Json::Value doc;
    const auto path = fileFor(userId, examTarget);
    try { doc = infrastructure::storage::readJsonFile(path); }
    catch (...) { doc = getOrCreateToday(userId, 10, examTarget); }
    if (!doc.isObject() || doc.get("date", "").asString() != today()) doc = getOrCreateToday(userId, 10, examTarget);
    auto &arr = doc["completed_question_ids"];
    if (!arr.isArray()) arr = Json::Value(Json::arrayValue);
    // 去重添加
    bool exists = false;
    const auto completedKey = examId.empty() ? questionId : questionKey(examId, questionId);
    for (const auto &v : arr)
    {
        if (v.asString() == completedKey || v.asString() == questionId) { exists = true; break; }
    }
    if (!exists) arr.append(completedKey);
    doc["last_completed_at"] = common::nowIso8601();
    infrastructure::storage::writeJsonFileAtomic(path, doc);
    return doc;
}
}  // namespace application::services
