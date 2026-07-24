#pragma once

// 错题本 Service：业务编排层
// - 评分提交完成后，调用 recordFromScore 把当次错题与答对题写入错题本
// - 提供前端使用的列表（带筛选/分页/统计）/移除/掌握/重置接口

#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/WrongQuestionRepository.h"

namespace application::services
{
class WrongQuestionService
{
  public:
    explicit WrongQuestionService(infrastructure::storage::WrongQuestionRepository &repository);

    // 列表筛选项
    struct ListFilter
    {
        std::string examId;       // 仅返回某张试卷的错题（空=不限）
        std::string questionType; // 按题型筛选（空=不限）
        std::string status;       // "all" | "active"（未掌握）| "mastered"（已掌握）；默认 active
        std::string sort;         // "recent"（按 last_wrong_at 倒序，默认）| "wrong_count"（错次倒序）
        int minWrongCount{0};     // 仅返回错次 >= minWrongCount 的题
        int page{1};
        int pageSize{20};
    };

    // 取列表 + 统计 + 分页信息
    Json::Value list(const std::string &userId, const ListFilter &filter) const;

    // 仅取统计摘要（个人中心徽标计数用）
    Json::Value summary(const std::string &userId) const;

    // 评分结果回调：scoreResult 是 AnswerService::calculateScore 返回值；examData 是试卷
    void recordFromScore(const std::string &userId,
                         const std::string &examId,
                         const Json::Value &examData,
                         const Json::Value &scoreResult);

    // 直接操作单题
    bool removeOne(const std::string &userId, const std::string &questionId);
    bool markMastered(const std::string &userId, const std::string &questionId);
    bool unmarkMastered(const std::string &userId, const std::string &questionId);

    // 错题归因标签（错因分析）：覆盖式设置该题的所有标签
    // 已知标签：vocab_blindspot / grammar_unsure / reading_pace / listening_missed / careless / option_trap
    bool setAttributionTags(const std::string &userId,
                            const std::string &questionId,
                            const std::vector<std::string> &tags);

    // 返回预设标签列表（前端下拉/按钮用）
    static Json::Value attributionTagRegistry();

    // 清空整份错题本
    void reset(const std::string &userId, const std::string &actorUserId);

    // 复习用：随机抽取若干道未掌握的错题，返回完整 question_snapshot 列表
    Json::Value sample(const std::string &userId, int count) const;

  private:
    // 工具：基于 question 节点提取一个轻量级 snapshot（题干/选项/答案/解析）
    static Json::Value buildQuestionSnapshot(const Json::Value &question);

    infrastructure::storage::WrongQuestionRepository &repository_;
};
}  // namespace application::services
