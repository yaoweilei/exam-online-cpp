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

std::string questionKey(const std::string &examId, const std::string &questionId, int sectionIndex = -1)
{
    return examId + '\x1f' + (sectionIndex >= 0 && questionId.find(':') == std::string::npos ? std::to_string(sectionIndex) + ":" : "") + questionId;
}

std::string itemKey(const Json::Value &item)
{
    return questionKey(item.get("exam_id", "").asString(), item.get("question_id", "").asString(), item.get("section_index", -1).asInt());
}

bool completedItem(const Json::Value &completed, const Json::Value &item)
{
    const auto id = item.get("question_id", "").asString();
    for (const auto &key : completed)
        if (key.asString() == itemKey(item) || key.asString() == questionKey(item.get("exam_id", "").asString(), id) || key.asString() == id) return true;
    return false;
}

bool usableQuestion(const Json::Value &question)
{
    const auto &answer = question.isMember("correct_answer") ? question["correct_answer"] : question["answer"];
    return question.get("has_ans", true).asBool() && !answer.isNull() && (!answer.isString() || !answer.asString().empty())
        && question["options"].isArray() && !question["options"].empty();
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
      answerRepo_(answerRepo), adaptive_(rootDir_.parent_path())
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
                                             int &plannedMinutes,
                                             const Json::Value &previous) const
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
                recent.insert(questionKey(examId, questionId, result.get("section_index", -1).asInt()));
        }
    }

    auto exams = examRepo_.listExams();
    exams.erase(std::remove_if(exams.begin(), exams.end(), [&](const auto &exam) {
        return exam.id.find("DIAGNOSTIC") != std::string::npos || exam.questionCount <= 0 || (!exam.accessLevel.empty() && exam.accessLevel != "free") || !matchesTarget(exam, examTarget);
    }), exams.end());
    std::sort(exams.begin(), exams.end(), [](const auto &left, const auto &right) { return left.id < right.id; });
    std::unordered_map<std::string, domain::ExamSummary> examById;
    for (const auto &exam : examRepo_.listExams()) if (matchesTarget(exam, examTarget) && (exam.accessLevel.empty() || exam.accessLevel == "free")) examById.emplace(exam.id, exam);

    const int budget = dailyMinutes > 0 ? std::clamp(dailyMinutes, 5, 180) : std::max(5, targetCount * 2);
    const int maxItems = std::clamp(targetCount, 1, 50);
    plannedMinutes = 0;
    std::unordered_set<std::string> retainedMaterials;
    for (const auto &item : previous["items"]) if (completedItem(previous["completed_question_ids"], item)) {
        if (!seen.insert(itemKey(item)).second) continue;
        items.append(item);
        if (retainedMaterials.insert(item.get("exam_id", "").asString() + ':' + item.get("material_id", item.get("question_id", "")).asString()).second)
            plannedMinutes += item.get("estimated_minutes", 1).asInt();
    }

    const auto makeItem = [](const Json::Value &question,
                             const Json::Value &section,
                             const std::string &examId,
                             const std::string &source,
                             const std::string &materialId,
                             int materialSize,
                             int minutes,
                             int sectionIndex) {
        Json::Value item(Json::objectValue);
        item["question_id"] = scalarString(question["id"]);
        item["exam_id"] = examId;
        item["section_id"] = scalarString(section["section_id"]);
        item["section_type"] = section.get("section_type", "");
        item["section_index"] = sectionIndex;
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
        for (Json::ArrayIndex sectionIndex = 0; sectionIndex < sections.size(); ++sectionIndex)
        {
            const auto &section = sections[sectionIndex];
            const auto type = section.get("section_type", "").asString();
            if (section["questions"].isArray())
            {
                for (const auto &question : section["questions"])
                {
                    if (!usableQuestion(question)) continue;
                    QuestionGroup group;
                    group.minutes = estimatedMinutes(type, 1, false);
                    group.items.append(makeItem(question, section, exam.id, source,
                                                scalarString(section["section_id"]) + ":" + scalarString(question["id"]), 1, group.minutes, sectionIndex));
                    groups.push_back(std::move(group));
                }
            }
            if (!section["passages"].isArray()) continue;
            for (const auto &passage : section["passages"])
            {
                Json::Value questions(Json::arrayValue);
                for (const auto &question : passage["questions"]) if (usableQuestion(question)) questions.append(question);
                if (!questions.isArray() || questions.empty()) continue;
                const auto materialId = scalarString(section["section_id"]) + ":p" + scalarString(passage["id"]);
                if (isAtomicMaterial(section, passage))
                {
                    QuestionGroup group;
                    group.minutes = estimatedMinutes(type, static_cast<int>(questions.size()), true);
                    for (const auto &question : questions)
                        group.items.append(makeItem(question, section, exam.id, source, materialId,
                                                    static_cast<int>(questions.size()), group.minutes, sectionIndex));
                    groups.push_back(std::move(group));
                }
                else
                {
                    for (const auto &question : questions)
                    {
                        QuestionGroup group;
                        group.minutes = estimatedMinutes(type, 1, false);
                        group.items.append(makeItem(question, section, exam.id, source,
                                                    materialId + ":" + scalarString(question["id"]), 1, group.minutes, sectionIndex));
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
            const auto key = itemKey(item);
            if (seen.count(key) || (item.get("source", "").asString() == "recommended" && recent.count(key))) return false;
        }
        for (const auto &item : group.items)
        {
            seen.insert(itemKey(item));
            items.append(item);
        }
        plannedMinutes += group.minutes;
        return true;
    };

    const auto findRecordedGroup = [&](const Json::Value &record, const std::string &source) {
        QuestionGroup empty;
        const auto examId = scalarString(record["exam_id"]);
        auto questionId = scalarString(record["question_id"]);
        int sectionIndex = record.get("section_index", record["snapshot"].get("section_index", -1)).asInt();
        const auto colon = questionId.find(':');
        if (colon != std::string::npos) {
            try { sectionIndex = std::stoi(questionId.substr(0, colon)); } catch (...) { return empty; }
            questionId = questionId.substr(colon + 1);
        }
        const auto foundExam = examById.find(examId);
        if (foundExam == examById.end() || questionId.empty()) return empty;
        for (auto group : groupsForExam(foundExam->second, source))
        {
            for (const auto &item : group.items)
            {
                if (item.get("question_id", "").asString() != questionId || (sectionIndex >= 0 && item["section_index"].asInt() != sectionIndex)) continue;
                QuestionGroup review;
                auto selected = item;
                if (record.isMember("wrong_count")) selected["wrong_count"] = record["wrong_count"];
                if (record.isMember("card_id")) selected["card_id"] = record["card_id"];
                selected["review_overdue"] = record.get("due_at", "9999").asString() < isoDaysAgo(1);
                review.minutes = estimatedMinutes(selected.get("section_type", "").asString(), 1, false);
                selected["estimated_minutes"] = review.minutes;
                selected["material_question_count"] = 1;
                review.items.append(selected);
                return review;
            }
        }
        return empty;
    };

    std::string focusDomain;
    double weakest = 101;
    const auto profile = adaptive_.profile(userId, examTarget);
    for (const auto &domain : profile["domains"].getMemberNames()) {
        const auto &summary = profile["domains"][domain];
        if (summary.get("observation_count", 0).asInt() > 0 && summary.get("score", 100).asDouble() < weakest) {
            weakest = summary["score"].asDouble(); focusDomain = domain;
        }
    }
    const auto domainOf = [](const Json::Value &item) {
        auto type = item.get("section_type", "").asString();
        const auto sectionId = item.get("section_id", "").asString();
        if ((type == "vocabulary" || type == "vocab") && sectionId >= "1.07" && sectionId <= "1.09") type = "grammar";
        return type == "vocab" ? std::string("vocabulary") : type;
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
        std::stable_sort(eligibleDueGroups.begin(), eligibleDueGroups.end(), [&](const auto &a, const auto &b) {
            return (domainOf(a.items[0]) == focusDomain) > (domainOf(b.items[0]) == focusDomain);
        });
        int scheduledDueGroups = 0;
        for (const auto &group : eligibleDueGroups)
        {
            if (plannedMinutes >= std::max(2, budget * 4 / 10)) break;
            if (scheduledDueGroups >= 10) break;
            if (appendGroup(group)) ++scheduledDueGroups;
        }
    }
    const bool hasHeavyDueBacklog = std::count_if(eligibleDueGroups.begin(), eligibleDueGroups.end(), [](const auto &group) { return group.items[0].get("review_overdue", false).asBool(); }) >= std::max(10, budget * 3 / 4);

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
    const auto wrongLimit = focusDomain.empty() ? plannedMinutes + std::max(2, budget * 25 / 100) : std::max(plannedMinutes, budget / 2);
    for (const auto &wrong : wrongItems)
    {
        if (plannedMinutes >= wrongLimit) break;
        const auto group = findRecordedGroup(wrong, "wrong_question");
        if (plannedMinutes + group.minutes <= wrongLimit) appendGroup(group);
    }

    // Use the current diagnostic evidence before filling the remaining budget.
    if (!hasHeavyDueBacklog && !focusDomain.empty()) {
        const int focusBudget = plannedMinutes + std::max(2, (budget - plannedMinutes) * 6 / 10);
        for (const auto &exam : exams) {
            for (const auto &group : groupsForExam(exam, "recommended")) {
                if (plannedMinutes >= focusBudget) break;
                if (!group.items.empty() && domainOf(group.items[0]) == focusDomain) appendGroup(group);
            }
            if (plannedMinutes >= focusBudget) break;
        }
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
    std::lock_guard lock(mutex_);
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
        doc.get("target_count", 0).asInt() == targetCount && doc.get("plan_version", 0).asInt() == 2 &&
        doc.get("diagnostic_version", "").asString() == diagnosticVersion(userId, examTarget) &&
        doc.get("review_version", "").asString() == reviewVersion(userId))
    {
        // 已存在今日缓存，直接返回
        return doc;
    }

    auto next = buildPlan(userId, targetCount, examTarget, dailyMinutes, doc.get("date", "").asString() == td ? doc : Json::Value(Json::objectValue));
    infrastructure::storage::writeJsonFileAtomic(path, next);
    return next;
}

std::string DailyPracticeService::diagnosticVersion(const std::string &userId, const std::string &examTarget) const
{
    const auto examId = examTarget.find("EJU") != std::string::npos ? "EJU_JAPANESE_DIAGNOSTIC_V1"
        : examTarget.find("N3") != std::string::npos ? "N3_DIAGNOSTIC_V1" : examTarget.find("N1") != std::string::npos ? "N1_DIAGNOSTIC_V1" : "N2_DIAGNOSTIC_V1";
    return answerRepo_.loadAnswer(userId, examId).get("saved_at", "").asString();
}

std::string DailyPracticeService::reviewVersion(const std::string &userId) const
{
    std::string version;
    const auto wrong = wrongRepo_.load(userId);
    for (const auto &item : wrong["items"]) version += item.get("exam_id", "").asString() + ':' + item.get("question_id", "").asString()
        + ':' + item.get("last_wrong_at", "").asString() + ':' + std::to_string(item.get("correct_streak", 0).asInt()) + (item.get("mastered", false).asBool() ? "y" : "n");
    const auto due = srsService_.listDue(userId, 100);
    for (const auto &card : due["items"]) version += card.get("card_id", "").asString() + card.get("due_at", "").asString();
    return std::to_string(std::hash<std::string>{}(version));
}

Json::Value DailyPracticeService::buildPlan(const std::string &userId, int targetCount, const std::string &examTarget, int dailyMinutes, const Json::Value &previous) const
{
    Json::Value next(Json::objectValue);
    next["user_id"] = userId;
    next["date"] = today();
    next["target_count"] = targetCount;
    next["exam_target"] = examTarget;
    next["daily_minutes"] = dailyMinutes;
    int plannedMinutes = 0;
    try
    {
        next["items"] = buildItems(userId, targetCount, examTarget, dailyMinutes, plannedMinutes, previous);
    }
    catch (...)
    {
        // 个别旧学习数据损坏时仍返回可用的空清单，不让个人中心整体加载失败。
        next["items"] = previous.get("items", Json::Value(Json::arrayValue));
    }
    next["planned_minutes"] = plannedMinutes;
    next["completed_question_ids"] = previous.get("completed_question_ids", Json::Value(Json::arrayValue));
    next["plan_version"] = 2;
    next["diagnostic_version"] = diagnosticVersion(userId, examTarget);
    next["review_version"] = reviewVersion(userId);
    next["generated_at"] = common::nowIso8601();
    return next;
}

Json::Value DailyPracticeService::regenerate(const std::string &userId,
                                             int targetCount,
                                             const std::string &examTarget,
                                             int dailyMinutes) const
{
    std::lock_guard lock(mutex_);
    if (userId.empty())
        throw common::AppException("VALIDATION_ERROR", "user_id required", drogon::k422UnprocessableEntity);
    targetCount = std::clamp(targetCount, 1, 50);
    const auto path = fileFor(userId, examTarget);
    Json::Value previous(Json::objectValue);
    try { previous = infrastructure::storage::readJsonFile(path); } catch (...) { }
    if (previous.get("date", "").asString() != today()) previous = Json::Value(Json::objectValue);
    auto doc = buildPlan(userId, targetCount, examTarget, dailyMinutes, previous);
    doc["regenerated"] = true;
    infrastructure::storage::writeJsonFileAtomic(path, doc);
    return doc;
}

Json::Value DailyPracticeService::markComplete(const std::string &userId,
                                               const std::string &examId,
                                               const std::string &questionId,
                                               const std::string &examTarget) const
{
    std::lock_guard lock(mutex_);
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
    auto completedKey = examId.empty() ? questionId : questionKey(examId, questionId);
    if (questionId.find(':') == std::string::npos && !examId.empty()) {
        int matches = 0;
        for (const auto &item : doc["items"]) if (item.get("exam_id", "").asString() == examId && item.get("question_id", "").asString() == questionId) { completedKey = itemKey(item); ++matches; }
        if (matches > 1) throw common::AppException("AMBIGUOUS_QUESTION", "请提供题型位置后标记完成", drogon::k422UnprocessableEntity);
    }
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
