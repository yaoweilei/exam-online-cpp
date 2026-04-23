#pragma once

#include <string>

#include <json/json.h>

#include "infrastructure/storage/TranslationRepository.h"

namespace application::services
{
// 段/句级译文服务（B2 阅读分句双语对照的众包译文）
class TranslationService
{
  public:
    explicit TranslationService(infrastructure::storage::TranslationRepository &repository);

    Json::Value get(const std::string &examId) const;

    Json::Value upsertSentence(const std::string &examId,
                               const std::string &passageKey,
                               int paragraph,
                               int sentence,
                               const std::string &text,
                               const std::string &updatedBy);

  private:
    infrastructure::storage::TranslationRepository &repository_;
};
}  // namespace application::services
