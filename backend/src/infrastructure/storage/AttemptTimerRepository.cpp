#include "AttemptTimerRepository.h"

#include <algorithm>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

AttemptTimerRepository::AttemptTimerRepository(std::filesystem::path userRootDir)
    : timerDir_(std::move(userRootDir) / "timers")
{
    // 确保目录存在
    std::filesystem::create_directories(timerDir_);
}

Json::Value AttemptTimerRepository::load(const std::string &userId) const
{
    const auto path = timerDir_ / (userId + ".json");
    std::shared_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return Json::Value(Json::nullValue);
    }
    return readJsonFile(path);
}

Json::Value AttemptTimerRepository::start(const std::string &userId, const Json::Value &patch)
{
    const auto path = timerDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);

    // 切换 exam_id 时重置累计秒数；同 exam_id 时延续旧文档（仅更新限时配置）
    Json::Value doc;
    bool isNewSession = true;
    if (std::filesystem::exists(path))
    {
        doc = readJsonFile(path);
        if (doc.isObject())
        {
            const auto oldExamId = doc.get("exam_id", "").asString();
            const auto newExamId = patch.get("exam_id", "").asString();
            if (!oldExamId.empty() && oldExamId == newExamId)
            {
                isNewSession = false;
            }
        }
    }
    if (!doc.isObject() || isNewSession)
    {
        doc = Json::Value(Json::objectValue);
        doc["elapsed_seconds"] = 0;
        doc["section_elapsed_seconds"] = Json::Value(Json::objectValue);
        doc["expired_section_indexes"] = Json::Value(Json::arrayValue);
    }

    doc["user_id"] = userId;
    doc["exam_id"] = patch.get("exam_id", "").asString();

    // 限时字段：每次 start 都允许覆盖
    if (patch.isMember("total_limit_seconds"))
    {
        doc["total_limit_seconds"] = patch["total_limit_seconds"].asInt();
    }
    else if (!doc.isMember("total_limit_seconds"))
    {
        doc["total_limit_seconds"] = 0;  // 默认不限时
    }
    if (patch.isMember("section_limits_seconds") && patch["section_limits_seconds"].isArray())
    {
        doc["section_limits_seconds"] = patch["section_limits_seconds"];
    }
    else if (!doc.isMember("section_limits_seconds"))
    {
        doc["section_limits_seconds"] = Json::Value(Json::arrayValue);
    }

    const auto now = common::nowIso8601();
    if (isNewSession || !doc.isMember("started_at") || doc["started_at"].asString().empty())
    {
        doc["started_at"] = now;
    }
    doc["updated_at"] = now;

    writeJsonFileAtomic(path, doc);
    return doc;
}

Json::Value AttemptTimerRepository::tick(const std::string &userId, const Json::Value &tick)
{
    const auto path = timerDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);

    if (!std::filesystem::exists(path))
    {
        // 计时不存在：直接返回 null，让前端重新 start
        return Json::Value(Json::nullValue);
    }
    auto doc = readJsonFile(path);
    if (!doc.isObject())
    {
        return Json::Value(Json::nullValue);
    }

    // 校验 exam_id：避免前端窗口残留导致错记
    const auto storedExam = doc.get("exam_id", "").asString();
    const auto incomingExam = tick.get("exam_id", "").asString();
    if (storedExam.empty() || storedExam != incomingExam)
    {
        return Json::Value(Json::nullValue);
    }

    // 累加 delta（最多累加 120 秒，防止前端长时间挂起后一次性灌入）
    int delta = tick.get("delta_seconds", 0).asInt();
    if (delta < 0)
    {
        delta = 0;
    }
    if (delta > 120)
    {
        delta = 120;
    }
    const int newTotal = doc.get("elapsed_seconds", 0).asInt() + delta;
    doc["elapsed_seconds"] = newTotal;

    // section 累加
    int sectionIndex = tick.get("section_index", -1).asInt();
    if (sectionIndex >= 0)
    {
        if (!doc.isMember("section_elapsed_seconds") || !doc["section_elapsed_seconds"].isObject())
        {
            doc["section_elapsed_seconds"] = Json::Value(Json::objectValue);
        }
        const auto key = std::to_string(sectionIndex);
        const int prev = doc["section_elapsed_seconds"].get(key, 0).asInt();
        doc["section_elapsed_seconds"][key] = prev + delta;
        const auto limits = doc.get("section_limits_seconds", Json::Value(Json::arrayValue));
        const int sectionLimit = limits.isArray() && static_cast<int>(limits.size()) > sectionIndex
            ? limits[sectionIndex].asInt()
            : 0;
        if (sectionLimit > 0 && prev + delta >= sectionLimit)
        {
            if (!doc["expired_section_indexes"].isArray()) doc["expired_section_indexes"] = Json::Value(Json::arrayValue);
            bool exists = false;
            for (const auto &value : doc["expired_section_indexes"]) exists = exists || value.asInt() == sectionIndex;
            if (!exists) doc["expired_section_indexes"].append(sectionIndex);
        }
    }

    doc["updated_at"] = common::nowIso8601();
    writeJsonFileAtomic(path, doc);
    return doc;
}

bool AttemptTimerRepository::clear(const std::string &userId)
{
    const auto path = timerDir_ / (userId + ".json");
    std::unique_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return false;
    }
    std::error_code ec;
    std::filesystem::remove(path, ec);
    return !ec;
}

}  // namespace infrastructure::storage
