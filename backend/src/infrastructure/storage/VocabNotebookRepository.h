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
// 个人生词本：每个用户一份 JSON，路径 data/user/vocab_notebook/{userId}.json
//
// 文档形态：
// {
//   "user_id": "u1",
//   "items": [
//     {
//       "id": "vw_1714123412345",      // 自动生成（基于添加时间）
//       "word": "観客",                 // 词条原文（汉字 / 假名）
//       "reading": "かんきゃく",        // 读音（来源 furigana 词典或前端补齐）
//       "note": "听众/观众。考点：体育/演唱会场景",  // 用户自填释义/笔记
//       "exam_id": "N1_2010_07",      // 来源试卷（可选）
//       "question_id": "1",            // 来源题号（可选）
//       "added_at": "2026-04-23T10:30:00Z",
//       "updated_at": "2026-04-23T10:30:00Z"
//     }
//   ],
//   "updated_at": "2026-04-23T10:30:00Z"
// }
//
// 唯一性：同一用户下，相同 (word + reading) 视为同一词；重复添加只更新 source/note。
class VocabNotebookRepository
{
  public:
    explicit VocabNotebookRepository(std::filesystem::path userRootDir)
        : vocabDir_(std::move(userRootDir) / "vocab_notebook")
    {
        std::filesystem::create_directories(vocabDir_);
    }

    Json::Value load(const std::string &userId) const
    {
        const auto path = filePath(userId);
        std::shared_lock lock(mutex_);
        if (!std::filesystem::exists(path))
        {
            return defaultDoc(userId);
        }
        return readJsonFile(path);
    }

    // 添加一条词；若 (word + reading) 已存在则就地合并 note/source。
    // 返回写入后的整个文档。
    Json::Value addWord(const std::string &userId,
                        const std::string &word,
                        const std::string &reading,
                        const std::string &note,
                        const std::string &examId,
                        const std::string &questionId)
    {
        std::unique_lock lock(mutex_);
        const auto path = filePath(userId);
        auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);
        const auto now = common::nowIso8601();

        // 查找是否已存在
        bool merged = false;
        for (auto &item : doc["items"])
        {
            if (item["word"].asString() == word && item["reading"].asString() == reading)
            {
                if (!note.empty())
                {
                    item["note"] = note;
                }
                if (!examId.empty())
                {
                    item["exam_id"] = examId;
                }
                if (!questionId.empty())
                {
                    item["question_id"] = questionId;
                }
                item["updated_at"] = now;
                merged = true;
                break;
            }
        }

        if (!merged)
        {
            Json::Value entry(Json::objectValue);
            entry["id"] = "vw_" + now;  // ISO 时间已含毫秒/秒，足够区分；如冲突由 client 重试
            entry["word"] = word;
            entry["reading"] = reading;
            entry["note"] = note;
            entry["exam_id"] = examId;
            entry["question_id"] = questionId;
            entry["added_at"] = now;
            entry["updated_at"] = now;
            doc["items"].append(entry);
        }

        doc["updated_at"] = now;
        writeJsonFileAtomic(path, doc);
        return doc;
    }

    // 按 id 删除一条；不存在则静默成功。
    Json::Value removeWord(const std::string &userId, const std::string &wordId)
    {
        std::unique_lock lock(mutex_);
        const auto path = filePath(userId);
        auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);

        Json::Value filtered(Json::arrayValue);
        for (const auto &item : doc["items"])
        {
            if (item["id"].asString() != wordId)
            {
                filtered.append(item);
            }
        }
        doc["items"] = filtered;
        doc["updated_at"] = common::nowIso8601();
        writeJsonFileAtomic(path, doc);
        return doc;
    }

    // 更新某条的 note（用户编辑释义/笔记）；不存在返回当前文档。
    Json::Value updateNote(const std::string &userId,
                           const std::string &wordId,
                           const std::string &note)
    {
        std::unique_lock lock(mutex_);
        const auto path = filePath(userId);
        auto doc = std::filesystem::exists(path) ? readJsonFile(path) : defaultDoc(userId);
        const auto now = common::nowIso8601();

        for (auto &item : doc["items"])
        {
            if (item["id"].asString() == wordId)
            {
                item["note"] = note;
                item["updated_at"] = now;
                break;
            }
        }
        doc["updated_at"] = now;
        writeJsonFileAtomic(path, doc);
        return doc;
    }

  private:
    std::filesystem::path filePath(const std::string &userId) const
    {
        return vocabDir_ / (userId + ".json");
    }

    static Json::Value defaultDoc(const std::string &userId)
    {
        Json::Value doc(Json::objectValue);
        doc["user_id"] = userId;
        doc["items"] = Json::arrayValue;
        doc["updated_at"] = "";
        return doc;
    }

    std::filesystem::path vocabDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
