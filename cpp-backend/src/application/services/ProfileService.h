#pragma once

#include <string>
#include <vector>

#include <json/json.h>

#include "infrastructure/storage/ProfileRepository.h"

namespace application::services
{
class ProfileService
{
  public:
    explicit ProfileService(infrastructure::storage::ProfileRepository &repository);

    Json::Value getProfile(const std::string &userId) const;

    // Accepts a partial JSON patch; only white-listed fields are written.
    Json::Value updateProfile(const std::string &userId, const Json::Value &patch);

  private:
    infrastructure::storage::ProfileRepository &repository_;
};
}  // namespace application::services
