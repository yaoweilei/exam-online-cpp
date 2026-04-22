#include "FeedbackRepository.h"

#include <algorithm>

#include "JsonIo.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{

FeedbackRepository::FeedbackRepository(std::filesystem::path userRootDir)
    : feedbackDir_(std::move(userRootDir) / "feedback")
{
    std::filesystem::create_directories(feedbackDir_);
}

namespace
{
std::string sanitizePaperId(const std::string &paperId)
{
    // 防御性：避免目录穿越；空值落到 _unknown
    if (paperId.empty())
    {
        return "_unknown";
    }
    std::string out;
    out.reserve(paperId.size());
    for (char c : paperId)
    {
        if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '_'
            || c == '.')
        {
            out.push_back(c);
        }
        else
        {
            out.push_back('_');
        }
    }
    return out;
}
}  // namespace

Json::Value FeedbackRepository::append(const std::string &paperId, const Json::Value &item)
{
    const auto safe = sanitizePaperId(paperId);
    const auto path = feedbackDir_ / (safe + ".json");
    std::unique_lock lock(mutex_);

    Json::Value doc;
    if (std::filesystem::exists(path))
    {
        doc = readJsonFile(path);
    }
    if (!doc.isObject())
    {
        doc = Json::Value(Json::objectValue);
    }
    doc["paper_id"] = paperId;  // 注意：保留原始 paperId 便于显示
    if (!doc.isMember("items") || !doc["items"].isArray())
    {
        doc["items"] = Json::Value(Json::arrayValue);
    }

    Json::Value entry = item;
    entry["feedback_id"] = common::generateOpaqueId("fb_");
    const auto now = common::nowIso8601();
    entry["created_at"] = now;
    entry["updated_at"] = now;
    if (!entry.isMember("status") || entry["status"].asString().empty())
    {
        entry["status"] = "open";
    }
    doc["items"].append(entry);

    writeJsonFileAtomic(path, doc);
    return entry;
}

std::vector<std::string> FeedbackRepository::listPaperFiles() const
{
    std::vector<std::string> out;
    if (!std::filesystem::exists(feedbackDir_))
    {
        return out;
    }
    for (const auto &entry : std::filesystem::directory_iterator(feedbackDir_))
    {
        if (!entry.is_regular_file())
        {
            continue;
        }
        if (entry.path().extension() != ".json")
        {
            continue;
        }
        out.push_back(entry.path().stem().string());
    }
    return out;
}

Json::Value FeedbackRepository::list(const std::string &paperId, const std::string &status) const
{
    std::shared_lock lock(mutex_);
    Json::Value out(Json::arrayValue);

    auto pushFromDoc = [&](const Json::Value &doc) {
        if (!doc.isObject() || !doc.isMember("items") || !doc["items"].isArray())
        {
            return;
        }
        for (const auto &it : doc["items"])
        {
            if (!status.empty() && it.get("status", "").asString() != status)
            {
                continue;
            }
            out.append(it);
        }
    };

    if (!paperId.empty())
    {
        const auto safe = sanitizePaperId(paperId);
        const auto path = feedbackDir_ / (safe + ".json");
        if (std::filesystem::exists(path))
        {
            pushFromDoc(readJsonFile(path));
        }
    }
    else
    {
        // 全部
        for (const auto &stem : listPaperFiles())
        {
            const auto path = feedbackDir_ / (stem + ".json");
            pushFromDoc(readJsonFile(path));
        }
    }
    return out;
}

bool FeedbackRepository::update(const std::string &paperId,
                                const std::string &feedbackId,
                                const Json::Value &patch)
{
    std::unique_lock lock(mutex_);

    auto applyToFile = [&](const std::filesystem::path &path) {
        if (!std::filesystem::exists(path))
        {
            return false;
        }
        auto doc = readJsonFile(path);
        if (!doc.isObject() || !doc.isMember("items") || !doc["items"].isArray())
        {
            return false;
        }
        bool changed = false;
        for (auto &it : doc["items"])
        {
            if (it.get("feedback_id", "").asString() != feedbackId)
            {
                continue;
            }
            // 仅允许更新有限字段，避免被改 user_id 等关键字段
            if (patch.isMember("status"))
            {
                it["status"] = patch["status"].asString();
            }
            if (patch.isMember("admin_note"))
            {
                it["admin_note"] = patch["admin_note"].asString();
            }
            it["updated_at"] = common::nowIso8601();
            changed = true;
            break;
        }
        if (changed)
        {
            writeJsonFileAtomic(path, doc);
        }
        return changed;
    };

    if (!paperId.empty())
    {
        const auto safe = sanitizePaperId(paperId);
        return applyToFile(feedbackDir_ / (safe + ".json"));
    }
    // 不指定 paperId：扫描所有文件直到命中（运营场景）
    for (const auto &stem : listPaperFiles())
    {
        if (applyToFile(feedbackDir_ / (stem + ".json")))
        {
            return true;
        }
    }
    return false;
}

}  // namespace infrastructure::storage
