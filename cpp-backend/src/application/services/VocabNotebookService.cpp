#include "VocabNotebookService.h"

namespace application::services
{

VocabNotebookService::VocabNotebookService(infrastructure::storage::VocabNotebookRepository &repository)
    : repository_(repository)
{
}

Json::Value VocabNotebookService::list(const std::string &userId) const
{
    return repository_.load(userId);
}

Json::Value VocabNotebookService::addWord(const std::string &userId,
                                          const std::string &word,
                                          const std::string &reading,
                                          const std::string &note,
                                          const std::string &examId,
                                          const std::string &questionId)
{
    return repository_.addWord(userId, word, reading, note, examId, questionId);
}

Json::Value VocabNotebookService::removeWord(const std::string &userId, const std::string &wordId)
{
    return repository_.removeWord(userId, wordId);
}

Json::Value VocabNotebookService::updateNote(const std::string &userId,
                                             const std::string &wordId,
                                             const std::string &note)
{
    return repository_.updateNote(userId, wordId, note);
}

}  // namespace application::services
