#include "TranslationService.h"

namespace application::services
{

TranslationService::TranslationService(infrastructure::storage::TranslationRepository &repository)
    : repository_(repository)
{
}

Json::Value TranslationService::get(const std::string &examId) const
{
    return repository_.load(examId);
}

Json::Value TranslationService::upsertSentence(const std::string &examId,
                                               const std::string &passageKey,
                                               int paragraph,
                                               int sentence,
                                               const std::string &text,
                                               const std::string &updatedBy)
{
    return repository_.upsertSentence(examId, passageKey, paragraph, sentence, text, updatedBy);
}

}  // namespace application::services
