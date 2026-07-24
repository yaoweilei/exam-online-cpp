#include "WrongQuestionRepository.h"

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

WrongQuestionRepository::WrongQuestionRepository(std::filesystem::path userRootDir)
    : wrongDir_(std::move(userRootDir) / "wrong_questions")
{
    // 启动时确保目录存在
    std::filesystem::create_directories(wrongDir_);
}

Json::Value WrongQuestionRepository::defaultDoc(const std::string &userId)
{
    // 默认空错题本结构
    Json::Value doc(Json::objectValue);
    doc["user_id"] = userId;
    doc["items"] = Json::arrayValue;
    doc["updated_at"] = "";
    return doc;
}

int WrongQuestionRepository::findIndex(const Json::Value &items, const std::string &questionId)
{
    // 顺序查找；错题数量通常不大（数百级），无需建索引
    if (!items.isArray())
    {
        return -1;
    }
    for (Json::ArrayIndex i = 0; i < items.size(); ++i)
    {
        if (items[i].get("question_id", "").asString() == questionId)
        {
            return static_cast<int>(i);
        }
    }
    return -1;
}

Json::Value WrongQuestionRepository::load(const std::string &userId) const
{
    const auto path = wrongDir_ / (userId + ".json");
    std::shared_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return defaultDoc(userId);
    }
    return readJsonFile(path);
}

void WrongQuestionRepository::save(const std::string &userId, const Json::Value &doc)
{
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    writeJsonFileAtomic(path, doc);
}

void WrongQuestionRepository::recordWrong(const std::string &userId,
                                          const std::string &examId,
                                          const std::string &questionId,
                                          const std::string &correctAnswer,
                                          const std::string &userAnswer,
                                          const std::string &sectionId,
                                          const std::string &questionType,
                                          const Json::Value &questionSnapshot)
{
    if (questionId.empty())
    {
        return;  // 无效题目直接忽略
    }

    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);

    if (!doc.isMember("items") || !doc["items"].isArray())
    {
        doc["items"] = Json::arrayValue;
    }

    const auto now = common::nowIso8601();
    const auto idx = findIndex(doc["items"], questionId);

    if (idx >= 0)
    {
        // 已存在：累加错误次数、刷新最近错答信息、清零连胜、解除"已掌握"状态
        auto &item = doc["items"][static_cast<Json::ArrayIndex>(idx)];
        item["wrong_count"] = item.get("wrong_count", 0).asInt() + 1;
        item["last_user_answer"] = userAnswer;
        item["last_wrong_at"] = now;
        item["correct_streak"] = 0;
        item["mastered"] = false;
        item["mastered_at"] = "";
        // 试卷与题目快照可能更新（例如题库修订）
        item["exam_id"] = examId;
        if (!sectionId.empty())
        {
            item["section_id"] = sectionId;
        }
        if (!questionType.empty())
        {
            item["question_type"] = questionType;
        }
        if (!questionSnapshot.isNull())
        {
            item["question_snapshot"] = questionSnapshot;
        }
        item["correct_answer"] = correctAnswer;
    }
    else
    {
        // 新错题：构造完整记录
        Json::Value item(Json::objectValue);
        item["question_id"] = questionId;
        item["exam_id"] = examId;
        item["section_id"] = sectionId;
        item["question_type"] = questionType;
        item["correct_answer"] = correctAnswer;
        item["last_user_answer"] = userAnswer;
        item["wrong_count"] = 1;
        item["first_wrong_at"] = now;
        item["last_wrong_at"] = now;
        item["last_correct_at"] = "";
        item["correct_streak"] = 0;
        item["mastered"] = false;
        item["mastered_at"] = "";
        item["question_snapshot"] = questionSnapshot;
        doc["items"].append(item);
    }

    doc["updated_at"] = now;
    writeJsonFileAtomic(path, doc);
}

void WrongQuestionRepository::recordCorrect(const std::string &userId,
                                            const std::string &examId,
                                            const std::string &questionId,
                                            int autoMasterThreshold)
{
    if (questionId.empty())
    {
        return;
    }

    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return;  // 没有错题本就无需更新
    }

    auto doc = readJsonFile(path);
    const auto idx = findIndex(doc["items"], questionId);
    if (idx < 0)
    {
        return;  // 该题从未错过，不写入文件
    }

    auto &item = doc["items"][static_cast<Json::ArrayIndex>(idx)];
    const auto now = common::nowIso8601();
    item["last_correct_at"] = now;
    item["correct_streak"] = item.get("correct_streak", 0).asInt() + 1;
    item["exam_id"] = examId;  // 记录最近答对来自哪张卷

    // 连续答对达到阈值，自动标记为已掌握
    if (item["correct_streak"].asInt() >= autoMasterThreshold && !item.get("mastered", false).asBool())
    {
        item["mastered"] = true;
        item["mastered_at"] = now;
    }

    doc["updated_at"] = now;
    writeJsonFileAtomic(path, doc);
}

bool WrongQuestionRepository::removeOne(const std::string &userId, const std::string &questionId)
{
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    auto doc = readJsonFile(path);
    if (!doc.isMember("items") || !doc["items"].isArray())
    {
        return false;
    }

    Json::Value filtered(Json::arrayValue);
    bool removed = false;
    for (const auto &item : doc["items"])
    {
        if (item.get("question_id", "").asString() == questionId)
        {
            removed = true;
            continue;
        }
        filtered.append(item);
    }

    if (!removed)
    {
        return false;
    }
    doc["items"] = filtered;
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return true;
}

bool WrongQuestionRepository::markMastered(const std::string &userId, const std::string &questionId)
{
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    auto doc = readJsonFile(path);
    const auto idx = findIndex(doc["items"], questionId);
    if (idx < 0)
    {
        return false;
    }
    auto &item = doc["items"][static_cast<Json::ArrayIndex>(idx)];
    item["mastered"] = true;
    item["mastered_at"] = common::nowIso8601();
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return true;
}

bool WrongQuestionRepository::unmarkMastered(const std::string &userId, const std::string &questionId)
{
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    auto doc = readJsonFile(path);
    const auto idx = findIndex(doc["items"], questionId);
    if (idx < 0)
    {
        return false;
    }
    auto &item = doc["items"][static_cast<Json::ArrayIndex>(idx)];
    item["mastered"] = false;
    item["mastered_at"] = "";
    item["correct_streak"] = 0;
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return true;
}

bool WrongQuestionRepository::setAttributionTags(const std::string &userId,
                                                 const std::string &questionId,
                                                 const std::vector<std::string> &tags)
{
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    auto doc = readJsonFile(path);
    const auto idx = findIndex(doc["items"], questionId);
    if (idx < 0)
    {
        return false;
    }
    auto &item = doc["items"][static_cast<Json::ArrayIndex>(idx)];
    Json::Value arr(Json::arrayValue);
    for (const auto &t : tags)
    {
        if (!t.empty())
        {
            arr.append(t);
        }
    }
    item["attribution_tags"] = arr;
    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return true;
}

void WrongQuestionRepository::reset(const std::string &userId, const std::string &actorUserId)
{
    // 直接覆写为默认空集合（保留 user_id），不删除文件
    const auto path = wrongDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    Json::Value previous;
    if (std::filesystem::exists(path))
    {
        previous = readJsonFile(path);
    }
    auto doc = defaultDoc(userId);
    const auto resetAt = common::nowIso8601();
    const auto previousItems = previous.get("items", Json::Value(Json::arrayValue));
    Json::Value audit(Json::objectValue);
    audit["actor_user_id"] = actorUserId;
    audit["reset_at"] = resetAt;
    audit["previous_question_count"] = previousItems.isArray() ? static_cast<Json::UInt64>(previousItems.size()) : 0;
    audit["reset_count"] = previous.get("reset_audit", Json::Value(Json::objectValue)).get("reset_count", 0).asUInt64() + 1;
    doc["reset_audit"] = audit;
    doc["updated_at"] = resetAt;
    writeJsonFileAtomic(path, doc);
}

}  // namespace infrastructure::storage
