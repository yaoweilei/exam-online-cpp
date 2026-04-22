#pragma once

// 草稿 / 上次未完成 Repository（业务功能 4：续考）
// - 文件：data/user/drafts/{userId}.json
// - 数据结构：
//   {
//     "user_id": "...",
//     "exam_id": "...",
//     "paper_id": "...",                 // 可选：题库/试卷分类
//     "total_questions": 0,
//     "answered_count": 0,               // 已答题数
//     "last_section_index": 0,           // 用户最后停留的 section 下标
//     "last_question_index": 0,          // section 内的题目下标
//     "answers": { "<qid>": "..." },     // 部分作答（透传字符串/数字）
//     "started_at": "...",               // 第一次开始的时间
//     "updated_at": "..."                // 最近一次更新时间
//   }
// - 注意：每个用户只保留一份草稿；保存不同 exam_id 会覆盖前一份。

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

namespace infrastructure::storage
{
class DraftRepository
{
  public:
    explicit DraftRepository(std::filesystem::path userRootDir);

    // 读取最新草稿；不存在返回 Json::nullValue（前端据此判定"无未完成"）
    Json::Value load(const std::string &userId) const;

    // 保存/覆盖草稿
    //   传入 patch 至少包含 exam_id；其余字段缺失时使用旧值或默认值
    Json::Value save(const std::string &userId, const Json::Value &patch);

    // 删除草稿（提交完成或用户主动放弃）
    bool clear(const std::string &userId);

  private:
    std::filesystem::path draftDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
