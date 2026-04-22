#pragma once

// 业务功能 20：题目讲解附件 Service
//   - 数据：data/system/explanations/{examId}.json
//   - 结构：{exam_id, questions:{questionId:[{explanation_id, kind, body, url?, author_id, author_name, created_at}]}}
//   - kind 枚举：text / link / image / audio
//   - 学生默认仅在答题后/答案揭晓后调用 list 接口；后端不强制可见性，由前端在题面状态判断后再渲染

#include <filesystem>
#include <string>

#include <json/json.h>

namespace application::services
{
class ExplanationService
{
  public:
    explicit ExplanationService(std::filesystem::path systemRootDir);

    Json::Value listForExam(const std::string &examId) const;
    Json::Value listForQuestion(const std::string &examId, const std::string &questionId) const;
    Json::Value addExplanation(const std::string &examId,
                               const std::string &questionId,
                               const std::string &authorId,
                               const std::string &authorName,
                               const Json::Value &payload);
    bool removeExplanation(const std::string &examId,
                           const std::string &questionId,
                           const std::string &explanationId);

  private:
    std::filesystem::path fileFor(const std::string &examId) const;
    Json::Value loadDoc(const std::string &examId) const;
    void saveDoc(const std::string &examId, Json::Value &doc) const;
    static std::string sanitize(const std::string &s);

    std::filesystem::path rootDir_;
};
}  // namespace application::services
