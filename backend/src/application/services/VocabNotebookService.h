#pragma once

#include <string>

#include <json/json.h>

#include "infrastructure/storage/VocabNotebookRepository.h"

namespace application::services
{
// 个人生词本（业务功能：自学者点词查词 + 加入词本）
//   - 后端只存 word/reading/note + 来源（exam_id/question_id）
//   - 释义来源：前端从 furigana.dict.json 取读音，note 字段由用户自填
class VocabNotebookService
{
  public:
    explicit VocabNotebookService(infrastructure::storage::VocabNotebookRepository &repository);

    Json::Value list(const std::string &userId) const;

    Json::Value addWord(const std::string &userId,
                        const std::string &word,
                        const std::string &reading,
                        const std::string &note,
                        const std::string &examId,
                        const std::string &questionId);

    Json::Value removeWord(const std::string &userId, const std::string &wordId);

    Json::Value updateNote(const std::string &userId,
                           const std::string &wordId,
                           const std::string &note);

  private:
    infrastructure::storage::VocabNotebookRepository &repository_;
};
}  // namespace application::services
