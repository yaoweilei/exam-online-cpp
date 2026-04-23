#pragma once

// 章节式学习路径（功能 #18）：
//   - 把 data/paper/jlpt/{level}/*.json 里各试卷的同名 section 聚合成"章节"
//   - 章节 key 形式：<level>__<section_name_hash> （section_name 含 section_type 已足够定位主题）
//   - 对给定用户，统计各章节累计答题/答对数，以评估进度
//   - 不做"难度编排"，只做「按章节串联所有历届题目」的路径聚合
//
// 对外接口：
//   listChapters(level, userId) -> { items: [{id, level, section_name, section_type, question_count, answered, correct}] }
//   getChapter(chapterId, userId) -> { chapter, questions: [{exam_id, question_id, stem, status}] }

#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/AnswerRepository.h"
#include "infrastructure/storage/ExamRepository.h"

namespace application::services
{
class ChapterService
{
  public:
    ChapterService(infrastructure::storage::ExamRepository &examRepo,
                   infrastructure::storage::AnswerRepository &answerRepo);

    // 列出指定等级的章节；level 为空时返回所有等级的章节
    Json::Value listChapters(const std::string &level, const std::string &userId) const;

    // 获取单个章节的题目详情 + 用户作答状态
    Json::Value getChapter(const std::string &chapterId, const std::string &userId) const;

    // 手动强制重建（当试卷被导入/删除时）
    void rebuild();

  private:
    struct QuestionRef
    {
        std::string examId;
        std::string questionId;
        std::string stem;
    };
    struct Chapter
    {
        std::string id;          // 如 "n2__1.10__reading"
        std::string level;       // N2
        std::string sectionName; // "問題10 - 内容理解（短文）"
        std::string sectionType; // vocabulary | grammar | reading | listening
        std::vector<QuestionRef> questions;
    };

    void ensureBuiltLocked() const;
    void buildIndexLocked() const;

    // 读取用户所有答题记录，聚合成 exam_id -> (question_id -> status)
    std::unordered_map<std::string, std::unordered_map<std::string, std::string>>
    loadUserAnswerIndex(const std::string &userId) const;

    infrastructure::storage::ExamRepository &examRepo_;
    infrastructure::storage::AnswerRepository &answerRepo_;

    mutable std::shared_mutex mutex_;
    mutable bool built_{false};
    mutable std::unordered_map<std::string, Chapter> chapters_;
    // 保持稳定顺序：first seen 的 chapter id 列表
    mutable std::vector<std::string> orderedIds_;
};
}  // namespace application::services
