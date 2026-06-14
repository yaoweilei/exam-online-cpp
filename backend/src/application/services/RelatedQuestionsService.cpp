#include "RelatedQuestionsService.h"

#include <algorithm>
#include <unordered_set>

namespace application::services
{

namespace
{
std::string makeKey(const std::string &examId, const std::string &questionId)
{
    return examId + "#" + questionId;
}

std::string toQuestionIdString(const Json::Value &raw)
{
    if (raw.isString())
    {
        return raw.asString();
    }
    if (raw.isIntegral())
    {
        return std::to_string(raw.asInt64());
    }
    return {};
}

// 从 question 节点抽一份轻量 snapshot，用来在前端展示
Json::Value buildSnapshot(const std::string &examId, const Json::Value &q)
{
    Json::Value snap(Json::objectValue);
    snap["exam_id"] = examId;
    snap["question_id"] = toQuestionIdString(q["id"]);
    const auto stem = q.get("question", q.get("stem", "")).asString();
    snap["stem"] = stem;
    snap["q_type"] = q.get("q_type", q.get("type", "")).asString();
    if (q.isMember("target_words") && q["target_words"].isArray())
    {
        snap["target_words"] = q["target_words"];
    }
    else
    {
        snap["target_words"] = Json::arrayValue;
    }
    return snap;
}

// 遍历试卷所有 question（兼容 section.questions 和 section.passages[].questions）
template <typename Fn>
void forEachQuestion(const Json::Value &examData, Fn &&fn)
{
    if (!examData.isMember("exam_info") || !examData["exam_info"].isMember("sections"))
    {
        return;
    }
    for (const auto &section : examData["exam_info"]["sections"])
    {
        if (section.isMember("questions") && section["questions"].isArray())
        {
            for (const auto &q : section["questions"])
            {
                fn(q);
            }
        }
        if (section.isMember("passages") && section["passages"].isArray())
        {
            for (const auto &p : section["passages"])
            {
                if (p.isMember("questions") && p["questions"].isArray())
                {
                    for (const auto &q : p["questions"])
                    {
                        fn(q);
                    }
                }
            }
        }
    }
}
}  // namespace

RelatedQuestionsService::RelatedQuestionsService(infrastructure::storage::ExamRepository &examRepo)
    : examRepo_(examRepo)
{
}

void RelatedQuestionsService::buildIndexLocked() const
{
    wordIndex_.clear();
    questionSnapshot_.clear();
    indexedExams_ = 0;
    indexedQuestions_ = 0;

    const auto exams = examRepo_.listExams();
    for (const auto &summary : exams)
    {
        Json::Value examData;
        try
        {
            examData = examRepo_.getExamById(summary.id);
        }
        catch (...)
        {
            continue;  // 跳过损坏试卷
        }
        ++indexedExams_;

        forEachQuestion(examData, [&](const Json::Value &q) {
            const auto qid = toQuestionIdString(q["id"]);
            if (qid.empty())
            {
                return;
            }
            if (!q.isMember("target_words") || !q["target_words"].isArray() ||
                q["target_words"].empty())
            {
                return;
            }
            ++indexedQuestions_;
            const auto key = makeKey(summary.id, qid);
            questionSnapshot_[key] = buildSnapshot(summary.id, q);
            for (const auto &w : q["target_words"])
            {
                const auto word = w.asString();
                if (!word.empty())
                {
                    wordIndex_[word].emplace_back(summary.id, qid);
                }
            }
        });
    }

    built_ = true;
}

void RelatedQuestionsService::ensureBuiltLocked() const
{
    if (!built_)
    {
        buildIndexLocked();
    }
}

void RelatedQuestionsService::rebuild()
{
    std::unique_lock lock(mutex_);
    built_ = false;
    buildIndexLocked();
}

Json::Value RelatedQuestionsService::findByQuestion(const std::string &examId,
                                                   const std::string &questionId,
                                                   int limit) const
{
    if (limit <= 0) limit = 10;
    if (limit > 50) limit = 50;

    std::unique_lock lock(mutex_);
    ensureBuiltLocked();

    const auto selfKey = makeKey(examId, questionId);
    const auto selfIt = questionSnapshot_.find(selfKey);

    Json::Value out(Json::objectValue);
    out["exam_id"] = examId;
    out["question_id"] = questionId;
    out["target_words"] = Json::arrayValue;
    out["items"] = Json::arrayValue;

    if (selfIt == questionSnapshot_.end() ||
        !selfIt->second.isMember("target_words") ||
        selfIt->second["target_words"].empty())
    {
        return out;
    }
    out["target_words"] = selfIt->second["target_words"];

    // 合并所有共享 target_word 的其他题（去重）
    std::unordered_map<std::string, int> hitByKey;  // 命中词数
    std::unordered_map<std::string, std::vector<std::string>> hitWords;  // 记录命中的词
    for (const auto &w : selfIt->second["target_words"])
    {
        const auto word = w.asString();
        const auto idxIt = wordIndex_.find(word);
        if (idxIt == wordIndex_.end())
        {
            continue;
        }
        for (const auto &[otherExam, otherQid] : idxIt->second)
        {
            if (otherExam == examId && otherQid == questionId)
            {
                continue;  // 排除自己
            }
            const auto key = makeKey(otherExam, otherQid);
            ++hitByKey[key];
            hitWords[key].push_back(word);
        }
    }

    // 按命中词数排序
    std::vector<std::pair<std::string, int>> rows(hitByKey.begin(), hitByKey.end());
    std::sort(rows.begin(), rows.end(), [](const auto &a, const auto &b) {
        return a.second > b.second;
    });

    int emitted = 0;
    for (const auto &[key, hit] : rows)
    {
        if (emitted >= limit) break;
        const auto it = questionSnapshot_.find(key);
        if (it == questionSnapshot_.end()) continue;
        auto row = it->second;
        row["match_count"] = hit;
        Json::Value matched(Json::arrayValue);
        for (const auto &w : hitWords[key])
        {
            matched.append(w);
        }
        row["matched_words"] = matched;
        out["items"].append(row);
        ++emitted;
    }
    out["count"] = emitted;
    return out;
}

Json::Value RelatedQuestionsService::getStats() const
{
    std::unique_lock lock(mutex_);
    ensureBuiltLocked();
    Json::Value out(Json::objectValue);
    out["indexed_exams"] = indexedExams_;
    out["indexed_questions"] = indexedQuestions_;
    out["indexed_words"] = static_cast<int>(wordIndex_.size());
    out["built"] = built_;
    return out;
}

}  // namespace application::services
