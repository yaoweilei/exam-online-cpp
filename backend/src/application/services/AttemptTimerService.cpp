#include "AttemptTimerService.h"

namespace application::services
{

AttemptTimerService::AttemptTimerService(infrastructure::storage::AttemptTimerRepository &repository)
    : repository_(repository)
{
}

Json::Value AttemptTimerService::get(const std::string &userId) const
{
    auto doc = repository_.load(userId);
    if (!doc.isObject())
    {
        return Json::Value(Json::nullValue);
    }
    return enrich(doc, -1);
}

Json::Value AttemptTimerService::start(const std::string &userId, const Json::Value &patch)
{
    auto doc = repository_.start(userId, patch);
    return enrich(doc, -1);
}

Json::Value AttemptTimerService::tick(const std::string &userId, const Json::Value &payload)
{
    auto doc = repository_.tick(userId, payload);
    if (!doc.isObject())
    {
        return Json::Value(Json::nullValue);
    }
    const int sectionIndex = payload.get("section_index", -1).asInt();
    return enrich(doc, sectionIndex);
}

bool AttemptTimerService::clear(const std::string &userId)
{
    return repository_.clear(userId);
}

Json::Value AttemptTimerService::enrich(const Json::Value &doc, int sectionIndex) const
{
    if (!doc.isObject())
    {
        return doc;
    }
    Json::Value out = doc;

    // 全卷剩余 / 是否超时
    const int totalLimit = doc.get("total_limit_seconds", 0).asInt();
    const int totalElapsed = doc.get("elapsed_seconds", 0).asInt();
    if (totalLimit > 0)
    {
        const int remaining = totalLimit - totalElapsed;
        out["total_remaining_seconds"] = remaining > 0 ? remaining : 0;
        out["expired"] = remaining <= 0;
    }
    else
    {
        out["total_remaining_seconds"] = 0;
        out["expired"] = false;
    }

    // section 剩余 / 超时（仅当 sectionIndex >= 0 时才计算）
    if (sectionIndex >= 0)
    {
        const auto limits = doc.get("section_limits_seconds", Json::Value(Json::arrayValue));
        int sectionLimit = 0;
        if (limits.isArray() && static_cast<int>(limits.size()) > sectionIndex)
        {
            sectionLimit = limits[sectionIndex].asInt();
        }
        const auto elapsedMap = doc.get("section_elapsed_seconds", Json::Value(Json::objectValue));
        const auto key = std::to_string(sectionIndex);
        const int sectionElapsed = elapsedMap.isObject() ? elapsedMap.get(key, 0).asInt() : 0;

        out["section_index"] = sectionIndex;
        out["section_elapsed"] = sectionElapsed;
        if (sectionLimit > 0)
        {
            const int remaining = sectionLimit - sectionElapsed;
            out["section_remaining_seconds"] = remaining > 0 ? remaining : 0;
            out["section_expired"] = remaining <= 0;
        }
        else
        {
            out["section_remaining_seconds"] = 0;
            out["section_expired"] = false;
        }
    }

    return out;
}

}  // namespace application::services
