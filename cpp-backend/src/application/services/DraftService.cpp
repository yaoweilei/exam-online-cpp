#include "DraftService.h"

namespace application::services
{

DraftService::DraftService(infrastructure::storage::DraftRepository &repository) : repository_(repository)
{
}

Json::Value DraftService::get(const std::string &userId) const
{
    return repository_.load(userId);
}

Json::Value DraftService::save(const std::string &userId, const Json::Value &patch)
{
    return repository_.save(userId, patch);
}

bool DraftService::clear(const std::string &userId)
{
    return repository_.clear(userId);
}

}  // namespace application::services
