#pragma once

// 同考点串题（功能 #17）：
//   - 根据题目的 target_words 建立 word -> [{exam_id, question_id, stem, target_words}] 反向索引
//   - 首次查询时懒加载：遍历 ExamRepository 的所有试卷（成本与试卷数量成正比）
//   - 缓存在内存中；试卷内容在当前进程内视为稳定（若需手动刷新可在管理 API 里再加）
//
// 对外接口：
//   findByQuestion(examId, questionId, limit) —— 找到与当前题共享 target_word 的其他题
//   getStats() —— 返回索引大小/覆盖试卷数，调试用

#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/ExamRepository.h"

namespace application::services
{
class RelatedQuestionsService
{
  public:
    explicit RelatedQuestionsService(infrastructure::storage::ExamRepository &examRepo);

    // 找到与 (examId, questionId) 共享 target_words 的其他题目；limit 默认 10，最大 50
    Json::Value findByQuestion(const std::string &examId,
                               const std::string &questionId,
                               int limit) const;

    // 手动强制重建（例如管理员导入了新试卷时）
    void rebuild();

    Json::Value getStats() const;

  private:
    void ensureBuiltLocked() const;
    void buildIndexLocked() const;

    infrastructure::storage::ExamRepository &examRepo_;

    // 下面字段在懒加载中改动，所以都是 mutable + 共享锁
    mutable std::shared_mutex mutex_;
    mutable bool built_{false};
    // word -> list of (exam_id, question_id)
    mutable std::unordered_map<std::string, std::vector<std::pair<std::string, std::string>>> wordIndex_;
    // (exam_id + "#" + question_id) -> 题面 snapshot（题干/题型/target_words）
    mutable std::unordered_map<std::string, Json::Value> questionSnapshot_;
    mutable int indexedExams_{0};
    mutable int indexedQuestions_{0};
};
}  // namespace application::services
