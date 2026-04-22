#pragma once

// 业务功能 19：多端同步（增量时间戳）Service
//   - state(userId)：返回各模块文件 mtime（ISO8601），便于客户端 diff
//   - pull(userId, modules)：批量返回选定模块的完整 JSON 内容
//   - 仅"快照式"同步：last-write-wins，由客户端决定是否覆盖本地缓存
// 模块清单：bookmarks / wrong_questions / streak / draft / srs /
//          bookmark_folders / study_goals / daily_practice / attempt_timer

#include <filesystem>
#include <string>
#include <vector>

#include <json/json.h>

namespace application::services
{
class SyncService
{
  public:
    explicit SyncService(std::filesystem::path userRootDir);

    // 返回 {server_time, modules:{name:{exists,modified_at,size}}}
    Json::Value state(const std::string &userId) const;
    // modules 为空表示拉全部；返回 {server_time, modules:{name:{modified_at, content}}}
    Json::Value pull(const std::string &userId, const std::vector<std::string> &modules) const;

  private:
    static const std::vector<std::string> &knownModules();
    std::filesystem::path moduleFile(const std::string &moduleName, const std::string &userId) const;
    Json::Value fileSnapshot(const std::filesystem::path &p) const;

    std::filesystem::path userRootDir_;
};
}  // namespace application::services
