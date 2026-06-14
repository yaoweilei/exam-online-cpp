#pragma once

// 业务功能 18：学习目标 / 备考倒计时 Service
//   - 数据：data/user/study_goals/{userId}.json
//   - 字段：goals:[{goal_id, title, target_date(YYYY-MM-DD), exam_target?, daily_question_target?, note?, created_at, updated_at}]
//   - 接口：list / create / update / remove

#include <filesystem>
#include <string>

#include <json/json.h>

namespace application::services
{
class StudyGoalService
{
  public:
    explicit StudyGoalService(std::filesystem::path userRootDir);

    Json::Value list(const std::string &userId) const;
    Json::Value create(const std::string &userId, const Json::Value &payload);
    Json::Value update(const std::string &userId, const std::string &goalId, const Json::Value &payload);
    bool remove(const std::string &userId, const std::string &goalId);

  private:
    std::filesystem::path fileFor(const std::string &userId) const;
    static std::string sanitize(const std::string &s);
    Json::Value loadDoc(const std::string &userId) const;
    void saveDoc(const std::string &userId, Json::Value &doc) const;
    static Json::Value normalize(const Json::Value &payload);

    std::filesystem::path rootDir_;
};
}  // namespace application::services
