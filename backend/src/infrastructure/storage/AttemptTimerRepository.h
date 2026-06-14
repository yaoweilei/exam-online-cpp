#pragma once

// 答题计时 Repository（业务功能 3：答题计时与分段限时）
// - 文件：data/user/timers/{userId}.json
// - 数据结构：
//   {
//     "user_id": "...",
//     "exam_id": "...",
//     "started_at": "...",                    // 第一次开始的时间（exam_id 切换会重置）
//     "elapsed_seconds": 0,                   // 全卷已用秒数（前端心跳累加）
//     "section_elapsed_seconds": {            // 各 section 已用秒数
//       "0": 30, "1": 50
//     },
//     "total_limit_seconds": 0,               // 0 = 不限时
//     "section_limits_seconds": [3600, 1800], // 0 元素 = 该 section 不限时；空数组 = 全部不限时
//     "updated_at": "..."
//   }
// - 注意：每个用户只保留一份当前考试计时；切换 exam_id 自动重置。

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>

#include <json/json.h>

namespace infrastructure::storage
{
class AttemptTimerRepository
{
  public:
    explicit AttemptTimerRepository(std::filesystem::path userRootDir);

    // 读取当前计时；不存在返回 Json::nullValue
    Json::Value load(const std::string &userId) const;

    // 启动 / 重置计时（切换 exam_id 会清空累计秒数）
    //   patch 至少包含 exam_id；total_limit_seconds、section_limits_seconds 可选
    Json::Value start(const std::string &userId, const Json::Value &patch);

    // 累加心跳：tick 内必须包含 exam_id 校验，避免错配
    //   tick: { exam_id, section_index, delta_seconds }
    //   返回最新文档；若 exam_id 不匹配则返回 Json::nullValue（前端据此重启）
    Json::Value tick(const std::string &userId, const Json::Value &tick);

    // 完成 / 放弃 → 删除文件
    bool clear(const std::string &userId);

  private:
    std::filesystem::path timerDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
