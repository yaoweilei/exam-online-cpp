#include "WrongQuestionService.h"

#include <algorithm>
#include <array>
#include <random>
#include <unordered_map>
#include <vector>

namespace application::services
{

WrongQuestionService::WrongQuestionService(infrastructure::storage::WrongQuestionRepository &repository)
    : repository_(repository)
{
}

Json::Value WrongQuestionService::buildQuestionSnapshot(const Json::Value &question)
{
    // 仅截取展示所需字段，避免错题文件里冗余太多
    Json::Value snap(Json::objectValue);
    static const char *kKeepKeys[] = {
        "id",
        "question",
        "stem",
        "options",
        "answer",
        "correct_answer",
        "explanation",
        "translation",
        "target_words",
        "q_type",
        "type",
        "passage",
        "audio",
        "image",
    };
    for (const auto *key : kKeepKeys)
    {
        if (question.isMember(key))
        {
            snap[key] = question[key];
        }
    }
    return snap;
}

namespace
{
// 遍历试卷，建立 question_id -> question 节点 的索引
// 兼容两种结构：section.questions[] 与 section.passages[].questions[]
std::unordered_map<std::string, Json::Value> buildQuestionIndex(const Json::Value &examData)
{
    std::unordered_map<std::string, Json::Value> index;
    auto pushQuestion = [&](const Json::Value &q) {
        // id 字段可能是 int 或 string，统一转字符串
        std::string id;
        const auto &raw = q["id"];
        if (raw.isString())
        {
            id = raw.asString();
        }
        else if (raw.isIntegral())
        {
            id = std::to_string(raw.asInt64());
        }
        if (!id.empty())
        {
            index.emplace(std::move(id), q);
        }
    };

    if (!examData.isMember("exam_info"))
    {
        return index;
    }
    const auto &examInfo = examData["exam_info"];
    if (!examInfo.isMember("sections"))
    {
        return index;
    }
    for (const auto &section : examInfo["sections"])
    {
        if (section.isMember("questions") && section["questions"].isArray())
        {
            for (const auto &q : section["questions"])
            {
                pushQuestion(q);
            }
        }
        if (section.isMember("passages") && section["passages"].isArray())
        {
            for (const auto &passage : section["passages"])
            {
                if (passage.isMember("questions") && passage["questions"].isArray())
                {
                    for (const auto &q : passage["questions"])
                    {
                        pushQuestion(q);
                    }
                }
            }
        }
    }
    return index;
}

// 从 question 节点尝试取出题型与所属 section_id（若没有则空）
std::string pickQuestionType(const Json::Value &q)
{
    if (q.isMember("q_type") && q["q_type"].isString())
    {
        return q["q_type"].asString();
    }
    if (q.isMember("type") && q["type"].isString())
    {
        return q["type"].asString();
    }
    return {};
}
}  // namespace

void WrongQuestionService::recordFromScore(const std::string &userId,
                                           const std::string &examId,
                                           const Json::Value &examData,
                                           const Json::Value &scoreResult)
{
    if (userId.empty())
    {
        return;
    }
    if (!scoreResult.isMember("results") || !scoreResult["results"].isObject())
    {
        return;
    }

    // 建立题目索引以便取 snapshot 与题型
    const auto qIndex = buildQuestionIndex(examData);

    const auto &results = scoreResult["results"];
    const auto memberNames = results.getMemberNames();
    for (const auto &questionId : memberNames)
    {
        const auto &row = results[questionId];
        const auto status = row.get("status", "").asString();

        // 找到题目 snapshot 与题型；若试卷中找不到（如题库变更），仍允许写入
        Json::Value snapshot(Json::objectValue);
        std::string questionType;
        const auto it = qIndex.find(questionId);
        if (it != qIndex.end())
        {
            snapshot = buildQuestionSnapshot(it->second);
            questionType = pickQuestionType(it->second);
        }

        if (status == "wrong")
        {
            const auto correctAnswer = row.get("correct_answer", "").asString();
            const auto userAnswer = row.get("user_answer", "").asString();
            repository_.recordWrong(userId,
                                    examId,
                                    questionId,
                                    correctAnswer,
                                    userAnswer,
                                    /*sectionId=*/"",
                                    questionType,
                                    snapshot);
        }
        else if (status == "correct")
        {
            // 答对：若该题在错题本中，会被累加 correct_streak；不在则忽略
            repository_.recordCorrect(userId, examId, questionId);
        }
        // unanswered 不动
    }
}

Json::Value WrongQuestionService::summary(const std::string &userId) const
{
    const auto doc = repository_.load(userId);
    int total = 0;
    int active = 0;
    int mastered = 0;
    // 按标签聚合（仅统计未掌握的错题）
    std::unordered_map<std::string, int> tagCounts;
    if (doc.isMember("items") && doc["items"].isArray())
    {
        for (const auto &item : doc["items"])
        {
            ++total;
            const bool isMastered = item.get("mastered", false).asBool();
            if (isMastered)
            {
                ++mastered;
            }
            else
            {
                ++active;
            }
            if (!isMastered && item.isMember("attribution_tags") &&
                item["attribution_tags"].isArray())
            {
                for (const auto &t : item["attribution_tags"])
                {
                    const auto key = t.asString();
                    if (!key.empty())
                    {
                        ++tagCounts[key];
                    }
                }
            }
        }
    }
    Json::Value out(Json::objectValue);
    out["total"] = total;
    out["active"] = active;
    out["mastered"] = mastered;
    out["updated_at"] = doc.get("updated_at", "");
    Json::Value tagSummary(Json::objectValue);
    for (const auto &kv : tagCounts)
    {
        tagSummary[kv.first] = kv.second;
    }
    out["tag_summary"] = tagSummary;
    return out;
}

Json::Value WrongQuestionService::list(const std::string &userId, const ListFilter &filter) const
{
    const auto doc = repository_.load(userId);
    std::vector<Json::Value> rows;
    if (doc.isMember("items") && doc["items"].isArray())
    {
        rows.reserve(doc["items"].size());
        for (const auto &item : doc["items"])
        {
            rows.push_back(item);
        }
    }

    // 过滤
    const auto status = filter.status.empty() ? std::string{"active"} : filter.status;
    rows.erase(std::remove_if(rows.begin(),
                              rows.end(),
                              [&](const Json::Value &item) {
                                  if (!filter.examId.empty() &&
                                      item.get("exam_id", "").asString() != filter.examId)
                                  {
                                      return true;
                                  }
                                  if (!filter.questionType.empty() &&
                                      item.get("question_type", "").asString() != filter.questionType)
                                  {
                                      return true;
                                  }
                                  if (item.get("wrong_count", 0).asInt() < filter.minWrongCount)
                                  {
                                      return true;
                                  }
                                  const bool mastered = item.get("mastered", false).asBool();
                                  if (status == "active" && mastered)
                                  {
                                      return true;
                                  }
                                  if (status == "mastered" && !mastered)
                                  {
                                      return true;
                                  }
                                  return false;
                              }),
               rows.end());

    // 排序
    if (filter.sort == "wrong_count")
    {
        std::sort(rows.begin(), rows.end(), [](const Json::Value &a, const Json::Value &b) {
            const auto wa = a.get("wrong_count", 0).asInt();
            const auto wb = b.get("wrong_count", 0).asInt();
            if (wa != wb)
            {
                return wa > wb;
            }
            return a.get("last_wrong_at", "").asString() > b.get("last_wrong_at", "").asString();
        });
    }
    else
    {
        // 默认：按最近一次错答时间倒序
        std::sort(rows.begin(), rows.end(), [](const Json::Value &a, const Json::Value &b) {
            return a.get("last_wrong_at", "").asString() > b.get("last_wrong_at", "").asString();
        });
    }

    // 分页
    const int totalCount = static_cast<int>(rows.size());
    const int page = filter.page > 0 ? filter.page : 1;
    const int pageSize = filter.pageSize > 0 ? filter.pageSize : 20;
    const int start = std::min(totalCount, (page - 1) * pageSize);
    const int end = std::min(totalCount, start + pageSize);

    Json::Value items(Json::arrayValue);
    for (int i = start; i < end; ++i)
    {
        items.append(rows[static_cast<std::size_t>(i)]);
    }

    Json::Value out(Json::objectValue);
    out["items"] = items;
    out["total"] = totalCount;
    out["page"] = page;
    out["page_size"] = pageSize;
    out["summary"] = summary(userId);
    return out;
}

bool WrongQuestionService::removeOne(const std::string &userId, const std::string &questionId)
{
    return repository_.removeOne(userId, questionId);
}

bool WrongQuestionService::markMastered(const std::string &userId, const std::string &questionId)
{
    return repository_.markMastered(userId, questionId);
}

bool WrongQuestionService::unmarkMastered(const std::string &userId, const std::string &questionId)
{
    return repository_.unmarkMastered(userId, questionId);
}

void WrongQuestionService::reset(const std::string &userId)
{
    repository_.reset(userId);
}

Json::Value WrongQuestionService::sample(const std::string &userId, int count) const
{
    const auto doc = repository_.load(userId);
    std::vector<Json::Value> pool;
    if (doc.isMember("items") && doc["items"].isArray())
    {
        for (const auto &item : doc["items"])
        {
            // 仅抽取未掌握的错题
            if (!item.get("mastered", false).asBool())
            {
                pool.push_back(item);
            }
        }
    }

    if (count <= 0)
    {
        count = 10;
    }
    if (static_cast<int>(pool.size()) > count)
    {
        // 随机打散后截取前 count 个
        std::random_device rd;
        std::mt19937 gen(rd());
        std::shuffle(pool.begin(), pool.end(), gen);
        pool.resize(static_cast<std::size_t>(count));
    }

    Json::Value items(Json::arrayValue);
    for (const auto &item : pool)
    {
        items.append(item);
    }

    Json::Value out(Json::objectValue);
    out["items"] = items;
    out["count"] = static_cast<int>(items.size());
    return out;
}

bool WrongQuestionService::setAttributionTags(const std::string &userId,
                                              const std::string &questionId,
                                              const std::vector<std::string> &tags)
{
    // 只接受预设标签 key，未知 key 静默丢弃（避免脏数据）
    static const std::array<const char *, 6> kAllowed{
        "vocab_blindspot",
        "grammar_unsure",
        "reading_pace",
        "listening_missed",
        "careless",
        "option_trap"};
    std::vector<std::string> sanitized;
    sanitized.reserve(tags.size());
    for (const auto &t : tags)
    {
        for (const auto *a : kAllowed)
        {
            if (t == a)
            {
                sanitized.push_back(t);
                break;
            }
        }
    }
    return repository_.setAttributionTags(userId, questionId, sanitized);
}

Json::Value WrongQuestionService::attributionTagRegistry()
{
    // 预设的归因维度（中文名 + 说明，用于前端渲染按钮/图例）
    struct TagDef
    {
        const char *key;
        const char *nameZh;
        const char *descZh;
    };
    static const std::array<TagDef, 6> kDefs{{
        {"vocab_blindspot", "词汇盲点", "生词或词义没掌握"},
        {"grammar_unsure", "语法不熟", "句型/活用判断错误"},
        {"reading_pace", "阅读节奏", "时间不够或读漏关键句"},
        {"listening_missed", "听力漏听", "关键词没抓住/走神"},
        {"careless", "粗心", "低级看错题干或填错"},
        {"option_trap", "选项陷阱", "被相近干扰项骗到"},
    }};
    Json::Value arr(Json::arrayValue);
    for (const auto &d : kDefs)
    {
        Json::Value row(Json::objectValue);
        row["key"] = d.key;
        row["name"] = d.nameZh;
        row["description"] = d.descZh;
        arr.append(row);
    }
    return arr;
}

}  // namespace application::services
