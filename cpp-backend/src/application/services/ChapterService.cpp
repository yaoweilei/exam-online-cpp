#include "ChapterService.h"

#include <algorithm>

namespace application::services
{

namespace
{
std::string toQuestionIdString(const Json::Value &raw)
{
    if (raw.isString()) return raw.asString();
    if (raw.isIntegral()) return std::to_string(raw.asInt64());
    return {};
}

std::string safeSlug(const std::string &s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
    {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) out.push_back(c);
        else if (c >= 'A' && c <= 'Z') out.push_back(static_cast<char>(c - 'A' + 'a'));
        else if (c == '.' || c == '_' || c == '-') out.push_back(c);
        else if (c == ' ') out.push_back('_');
        // 其它字符（包括中/日文）用 '.' 占位，避免 URL 里的问题
        else out.push_back('.');
    }
    return out;
}

// 章节 id = <level>__<section_id>（后者在同一等级内稳定）
std::string makeChapterId(const std::string &level, const std::string &sectionId)
{
    std::string out;
    out.reserve(level.size() + sectionId.size() + 2);
    for (char c : level) out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    out.append("__");
    out.append(safeSlug(sectionId));
    return out;
}

std::string pickStem(const Json::Value &q)
{
    const auto stem = q.get("question", q.get("stem", "")).asString();
    if (stem.size() > 160)
    {
        return stem.substr(0, 160) + "...";
    }
    return stem;
}
}  // namespace

ChapterService::ChapterService(infrastructure::storage::ExamRepository &examRepo,
                               infrastructure::storage::AnswerRepository &answerRepo)
    : examRepo_(examRepo), answerRepo_(answerRepo)
{
}

void ChapterService::buildIndexLocked() const
{
    chapters_.clear();
    orderedIds_.clear();

    const auto exams = examRepo_.listExams();
    // 按 level+id 排序，保证 chapter 顺序稳定
    std::vector<std::string> ids;
    ids.reserve(exams.size());
    for (const auto &e : exams) ids.push_back(e.id);
    std::sort(ids.begin(), ids.end());

    for (const auto &examId : ids)
    {
        Json::Value examData;
        try { examData = examRepo_.getExamById(examId); } catch (...) { continue; }
        if (!examData.isMember("exam_info")) continue;
        const auto &info = examData["exam_info"];
        const auto level = info.get("exam_level", "").asString();
        if (!info.isMember("sections")) continue;

        for (const auto &section : info["sections"])
        {
            const auto sectionId = section.get("section_id", "").asString();
            const auto sectionName = section.get("section_name", section.get("section_title", "")).asString();
            const auto sectionType = section.get("section_type", "").asString();
            if (sectionId.empty() || sectionName.empty()) continue;

            const auto chapterId = makeChapterId(level, sectionId);
            auto it = chapters_.find(chapterId);
            if (it == chapters_.end())
            {
                Chapter ch;
                ch.id = chapterId;
                ch.level = level;
                ch.sectionName = sectionName;
                ch.sectionType = sectionType;
                auto [ins, _] = chapters_.emplace(chapterId, std::move(ch));
                orderedIds_.push_back(chapterId);
                it = ins;
            }

            auto addQuestion = [&](const Json::Value &q) {
                QuestionRef ref;
                ref.examId = examId;
                ref.questionId = toQuestionIdString(q["id"]);
                if (ref.questionId.empty()) return;
                ref.stem = pickStem(q);
                it->second.questions.push_back(std::move(ref));
            };

            if (section.isMember("questions") && section["questions"].isArray())
            {
                for (const auto &q : section["questions"]) addQuestion(q);
            }
            if (section.isMember("passages") && section["passages"].isArray())
            {
                for (const auto &p : section["passages"])
                {
                    if (p.isMember("questions") && p["questions"].isArray())
                    {
                        for (const auto &q : p["questions"]) addQuestion(q);
                    }
                }
            }
        }
    }

    built_ = true;
}

void ChapterService::ensureBuiltLocked() const
{
    if (!built_) buildIndexLocked();
}

void ChapterService::rebuild()
{
    std::unique_lock lock(mutex_);
    built_ = false;
    buildIndexLocked();
}

std::unordered_map<std::string, std::unordered_map<std::string, std::string>>
ChapterService::loadUserAnswerIndex(const std::string &userId) const
{
    std::unordered_map<std::string, std::unordered_map<std::string, std::string>> index;
    if (userId.empty()) return index;
    const auto rows = answerRepo_.listUserAnswers(userId);
    for (const auto &row : rows)
    {
        const auto examId = row.get("exam_id", "").asString();
        if (examId.empty()) continue;
        // statistics.results: { "1": {status: "correct"|...}, ... }
        const auto &stats = row["statistics"];
        if (!stats.isObject()) continue;
        const auto &results = stats["results"];
        if (!results.isObject()) continue;
        auto &byExam = index[examId];
        const auto names = results.getMemberNames();
        for (const auto &qid : names)
        {
            byExam[qid] = results[qid].get("status", "").asString();
        }
    }
    return index;
}

Json::Value ChapterService::listChapters(const std::string &level, const std::string &userId) const
{
    std::unique_lock lock(mutex_);
    ensureBuiltLocked();

    const auto answers = loadUserAnswerIndex(userId);

    Json::Value out(Json::objectValue);
    Json::Value arr(Json::arrayValue);
    for (const auto &chapterId : orderedIds_)
    {
        const auto &ch = chapters_.at(chapterId);
        if (!level.empty() && ch.level != level) continue;
        int answered = 0, correct = 0;
        for (const auto &q : ch.questions)
        {
            const auto byExamIt = answers.find(q.examId);
            if (byExamIt == answers.end()) continue;
            const auto statusIt = byExamIt->second.find(q.questionId);
            if (statusIt == byExamIt->second.end()) continue;
            const auto &status = statusIt->second;
            if (status == "correct" || status == "wrong")
            {
                ++answered;
                if (status == "correct") ++correct;
            }
        }
        Json::Value row(Json::objectValue);
        row["id"] = ch.id;
        row["level"] = ch.level;
        row["section_name"] = ch.sectionName;
        row["section_type"] = ch.sectionType;
        row["question_count"] = static_cast<int>(ch.questions.size());
        row["answered"] = answered;
        row["correct"] = correct;
        arr.append(row);
    }
    out["items"] = arr;
    out["count"] = arr.size();
    return out;
}

Json::Value ChapterService::getChapter(const std::string &chapterId, const std::string &userId) const
{
    std::unique_lock lock(mutex_);
    ensureBuiltLocked();

    const auto it = chapters_.find(chapterId);
    Json::Value out(Json::objectValue);
    if (it == chapters_.end())
    {
        out["found"] = false;
        return out;
    }
    const auto &ch = it->second;
    const auto answers = loadUserAnswerIndex(userId);

    Json::Value info(Json::objectValue);
    info["id"] = ch.id;
    info["level"] = ch.level;
    info["section_name"] = ch.sectionName;
    info["section_type"] = ch.sectionType;
    info["question_count"] = static_cast<int>(ch.questions.size());
    out["chapter"] = info;

    Json::Value questions(Json::arrayValue);
    int answered = 0, correct = 0;
    for (const auto &q : ch.questions)
    {
        Json::Value row(Json::objectValue);
        row["exam_id"] = q.examId;
        row["question_id"] = q.questionId;
        row["stem"] = q.stem;
        std::string status;
        const auto byExamIt = answers.find(q.examId);
        if (byExamIt != answers.end())
        {
            const auto s = byExamIt->second.find(q.questionId);
            if (s != byExamIt->second.end()) status = s->second;
        }
        row["status"] = status;
        if (status == "correct" || status == "wrong")
        {
            ++answered;
            if (status == "correct") ++correct;
        }
        questions.append(row);
    }
    out["questions"] = questions;
    out["answered"] = answered;
    out["correct"] = correct;
    out["found"] = true;
    return out;
}

}  // namespace application::services
