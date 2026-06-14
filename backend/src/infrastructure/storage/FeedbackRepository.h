#pragma once

// 题目反馈/纠错 Repository（业务功能 5）
// - 文件：data/user/feedback/{paperId}.json
//   选用按 paperId 聚合（而不是按 userId），便于运营批处理一份卷子的所有问题
// - 数据结构：
//   {
//     "paper_id": "...",
//     "items": [
//       {
//         "feedback_id": "fb_uuid",
//         "user_id": "...",
//         "exam_id": "...",
//         "question_id": "...",
//         "category": "wrong_answer | typo | translation | audio | other",
//         "description": "用户描述",
//         "status": "open | resolved | rejected",
//         "admin_note": "",
//         "created_at": "...",
//         "updated_at": "..."
//       }
//     ]
//   }

#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

namespace infrastructure::storage
{
class FeedbackRepository
{
  public:
    explicit FeedbackRepository(std::filesystem::path userRootDir);

    // 追加一条反馈，返回完整入库后的对象（带 feedback_id / created_at）
    //   - paperId 为空时落到 _unknown.json，避免数据丢失
    Json::Value append(const std::string &paperId, const Json::Value &item);

    // 列出某 paperId 下的反馈；paperId 为空 → 列出全部（管理员用）
    //   filter:
    //     - status: 可选，按状态过滤
    Json::Value list(const std::string &paperId, const std::string &status) const;

    // 更新指定 feedback_id 的状态/备注，返回是否更新成功
    bool update(const std::string &paperId,
                const std::string &feedbackId,
                const Json::Value &patch);

  private:
    // 列出 feedback 目录下所有 paper 文件名（不含扩展名）
    std::vector<std::string> listPaperFiles() const;

    std::filesystem::path feedbackDir_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
