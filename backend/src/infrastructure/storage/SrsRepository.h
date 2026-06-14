#pragma once

// SRS 间隔重复 Repository（业务功能 7）
// - 文件：data/user/srs/{userId}.json
//   结构: { user_id, cards: [ { card_id, exam_id, question_id, ease, interval_days,
//                               reps, lapses, due_at, last_reviewed_at, last_grade,
//                               snapshot, question_type, created_at, updated_at } ] }
// - card_id = "{examId}:{questionId}"，便于幂等 upsert（错题本写入时重复触发不会增卡）

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class SrsRepository
{
  public:
    explicit SrsRepository(std::filesystem::path userRootDir);

    // 列出某用户全部卡片（管理/调试用）
    Json::Value list(const std::string &userId) const;

    // 列出到期卡片（due_at <= nowIso）；limit > 0 时截断
    Json::Value listDue(const std::string &userId, const std::string &nowIso, int limit) const;

    // 幂等创建：若 card_id 已存在则不变；否则新增并初始化 ease=2.5,interval=0,reps=0,due_at=now
    //   - questionType / snapshot 用于 viewer 渲染（参考错题本同字段）
    bool upsertCard(const std::string &userId,
                    const std::string &examId,
                    const std::string &questionId,
                    const std::string &questionType,
                    const Json::Value &snapshot,
                    const std::string &nowIso);

    // 应用一次评分调度结果：覆盖 ease / interval_days / reps / lapses / due_at / last_*
    bool applySchedule(const std::string &userId,
                       const std::string &cardId,
                       const Json::Value &patch);

    // 删除单卡
    bool removeCard(const std::string &userId, const std::string &cardId);

  private:
    std::filesystem::path filePath(const std::string &userId) const;

    std::filesystem::path srsDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
