#pragma once

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
// 段/句级译文众包仓库（B2：阅读分句双语对照）
//
// 文档路径：data/system/translations/jlpt/{level}/{examId}.json
// 文档形态：
// {
//   "exam_id": "N1_2010_07",
//   "items": {
//      // passageKey 推荐用 "section_id:question_id"，由前端约定（也可用 "passage:<id>"）
//      "1.08:54": {
//         "0.0": { "text": "这是第一段第一句的中文……", "ruby": "<ruby>...</ruby>", "updated_by": "uid", "updated_at": "..." },
//         "1.2": { "text": "...", "updated_by": "uid", "updated_at": "..." }
//      }
//   },
//   "updated_at": "2026-04-23T..."
// }
//
// 设计说明：
//  - 译文先做最简单的「众包覆盖式」：任何登录用户提交都覆盖同一句。
//    后续如需审核/历史版本，可在此结构上加 history[]。
class TranslationRepository
{
  public:
    explicit TranslationRepository(std::filesystem::path systemRootDir)
        : translationDir_(std::move(systemRootDir) / "translations")
    {
        std::filesystem::create_directories(translationDir_);
    }

    Json::Value load(const std::string &examId) const
    {
        const auto path = filePath(examId);
        std::shared_lock lock(mutex_);
        if (std::filesystem::exists(path))
        {
            return readJsonFile(path);
        }
        return defaultDoc(examId);
    }

    Json::Value upsertSentence(const std::string &examId,
                               const std::string &passageKey,
                               int paragraph,
                               int sentence,
                               const std::string &text,
                               const std::string &updatedBy)
    {
        std::unique_lock lock(mutex_);
        const auto path = filePath(examId);
        auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(examId);
        const auto now = common::nowIso8601();
        const std::string sentenceKey = std::to_string(paragraph) + "." + std::to_string(sentence);

        if (!doc["items"].isObject())
        {
            doc["items"] = Json::Value(Json::objectValue);
        }
        if (!doc["items"].isMember(passageKey))
        {
            doc["items"][passageKey] = Json::Value(Json::objectValue);
        }

        const Json::Value previous = doc["items"][passageKey][sentenceKey];
        Json::Value entry(Json::objectValue);
        entry["text"] = text;
        if (previous.isObject() && previous.isMember("kana"))
        {
            entry["kana"] = previous["kana"];
        }
        if (previous.isObject() && previous.isMember("ruby"))
        {
            entry["ruby"] = previous["ruby"];
        }
        entry["updated_by"] = updatedBy;
        entry["updated_at"] = now;
        doc["items"][passageKey][sentenceKey] = entry;
        doc["updated_at"] = now;
        std::filesystem::create_directories(path.parent_path());
        writeJsonFileAtomic(path, doc);
        return doc;
    }

  private:
    std::filesystem::path filePath(const std::string &examId) const
    {
        return translationDir_ / familyOf(examId) / levelOf(examId) / (examId + ".json");
    }

    static std::string lowerCopy(std::string value)
    {
        for (auto &ch : value)
        {
            if (ch >= 'A' && ch <= 'Z')
            {
                ch = static_cast<char>(ch - 'A' + 'a');
            }
        }
        return value;
    }

    static std::string familyOf(const std::string &examId)
    {
        if (examId.size() >= 2 && (examId[0] == 'N' || examId[0] == 'n') && examId[1] >= '1' && examId[1] <= '5')
        {
            return "jlpt";
        }
        return "general";
    }

    static std::string levelOf(const std::string &examId)
    {
        if (examId.size() >= 2 && (examId[0] == 'N' || examId[0] == 'n') && examId[1] >= '1' && examId[1] <= '5')
        {
            return lowerCopy(examId.substr(0, 2));
        }
        return "unknown";
    }

    static Json::Value defaultDoc(const std::string &examId)
    {
        Json::Value doc(Json::objectValue);
        doc["exam_id"] = examId;
        doc["items"] = Json::Value(Json::objectValue);
        doc["updated_at"] = "";
        return doc;
    }

    std::filesystem::path translationDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
