#include "DraftService.h"

namespace application::services
{

DraftService::DraftService(infrastructure::storage::DraftRepository &repository) : repository_(repository)
{
}

Json::Value DraftService::get(const std::string &userId, const std::string &examId) const
{
    return repository_.load(userId, examId);
}

Json::Value DraftService::save(const std::string &userId, const Json::Value &patch)
{
    return repository_.save(userId, patch);
}

Json::Value DraftService::list(const std::string &userId) const { return repository_.list(userId); }

bool DraftService::clear(const std::string &userId, const std::string &examId, const std::string &attemptId)
{
    return repository_.clear(userId, examId, attemptId);
}

void DraftService::markSubmitted(const std::string &userId,
                                 const std::string &examId,
                                 const std::string &attemptId)
{
    repository_.markSubmitted(userId, examId, attemptId);
}

}  // namespace application::services
