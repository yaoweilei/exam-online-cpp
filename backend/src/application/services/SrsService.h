#pragma once

// SRS 间隔重复 Service（业务功能 7）
//   - SM-2 简化版调度
//     评分 grade ∈ {0:再来, 1:困难, 2:良好, 3:容易}
//     ease 初始 2.5；下界 1.3
//     reps == 0 → interval=1 天
//     reps == 1 → interval=3 天
//     否则      → interval = round(prevInterval * ease)
//     困难      → interval = max(1, round(prevInterval * 1.2))
//     再来      → reps=0, lapses+=1, interval=1
//   - 与错题本联动：recordWrongCards 由调用方在评分提交后异步触发

#include <string>

#include <json/json.h>

#include "infrastructure/storage/SrsRepository.h"

namespace application::services
{
class SrsService
{
  public:
    explicit SrsService(infrastructure::storage::SrsRepository &repository);

    // 待复习清单
    Json::Value listDue(const std::string &userId, int limit) const;

    // 全部卡
    Json::Value listAll(const std::string &userId) const;

    // 评分：返回更新后的字段（next due_at 等）
    Json::Value review(const std::string &userId, const std::string &cardId, int grade);

    // 错题入卡（业务功能 1 联动）：从一次评分结果中，把所有 status=="wrong" 的题目入卡
    //   examData 用于取 question snapshot；与 WrongQuestionService.recordFromScore 保持同形参
    int ingestWrongFromScore(const std::string &userId,
                             const std::string &examId,
                             const Json::Value &examData,
                             const Json::Value &scoreResult);

    // 单题入卡（管理/手工）
    bool ingestSingle(const std::string &userId,
                      const std::string &examId,
                      const std::string &questionId,
                      const std::string &questionType,
                      const Json::Value &snapshot);

    // 删除单卡
    bool remove(const std::string &userId, const std::string &cardId);

  private:
    infrastructure::storage::SrsRepository &repository_;
};
}  // namespace application::services
