#pragma once

// 错题本 Repository：
// - 每个用户一份 JSON 持久化在 data/user/wrong_questions/{userId}.json
// - 数据结构：
//   {
//     "user_id": "...",
//     "items": [
//       {
//         "question_id": "...",      // 题目唯一 ID
//         "exam_id": "...",          // 试卷 ID
//         "section_id": "...",       // 段落/小节 ID（可选）
//         "question_type": "...",    // 题型（可选）
//         "correct_answer": "...",   // 标准答案
//         "last_user_answer": "...", // 最近一次错误答案
//         "wrong_count": 3,          // 累计错误次数
//         "first_wrong_at": "...",   // 首次错答时间
//         "last_wrong_at": "...",    // 最近一次错答时间
//         "last_correct_at": "",     // 最近一次答对时间（用于"答对计数"）
//         "correct_streak": 0,       // 连续答对次数（用于自动掌握）
//         "mastered": false,         // 是否标记为已掌握
//         "mastered_at": "",         // 掌握时间
//         "question_snapshot": {}    // 题目快照（题干/选项），便于错题页脱离试卷展示
//       }
//     ],
//     "updated_at": "..."
//   }

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class WrongQuestionRepository
{
  public:
    explicit WrongQuestionRepository(std::filesystem::path userRootDir);

    // 读取指定用户的错题集合（不存在则返回默认空集合）
    Json::Value load(const std::string &userId) const;

    // 直接覆写整份文件（内部使用，已加写锁）
    void save(const std::string &userId, const Json::Value &doc);

    // 记录一次错答；如已存在则累加错误次数并更新 last_user_answer
    void recordWrong(const std::string &userId,
                     const std::string &examId,
                     const std::string &questionId,
                     const std::string &correctAnswer,
                     const std::string &userAnswer,
                     const std::string &sectionId,
                     const std::string &questionType,
                     const Json::Value &questionSnapshot);

    // 记录一次答对；若该题在错题本中，累加 correct_streak；连胜达到阈值或显式调用 markMastered 时标记为掌握
    void recordCorrect(const std::string &userId,
                       const std::string &examId,
                       const std::string &questionId,
                       int autoMasterThreshold = 2);

    // 手动从错题本移除一题
    bool removeOne(const std::string &userId, const std::string &questionId);

    // 标记某题为已掌握（保留在文件中但带 mastered=true）
    bool markMastered(const std::string &userId, const std::string &questionId);

    // 取消"已掌握"状态（重新进入复习队列）
    bool unmarkMastered(const std::string &userId, const std::string &questionId);

    // 设置/覆盖错题的归因标签（错因分析，如 vocab_blindspot / careless 等）。
    // 传空数组等同于清空该题的所有标签。返回是否命中该题。
    bool setAttributionTags(const std::string &userId,
                            const std::string &questionId,
                            const std::vector<std::string> &tags);

    // 清空整份错题本
    void reset(const std::string &userId);

  private:
    // 构造一份默认空集合
    static Json::Value defaultDoc(const std::string &userId);

    // 工具：在 items 数组中按 question_id 查找索引；找不到返回 -1
    static int findIndex(const Json::Value &items, const std::string &questionId);

    std::filesystem::path wrongDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
