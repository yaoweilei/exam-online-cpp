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
    explicit ProfileService(infrastructure::storage::ProfileRepository &repository) : repository_(repository) {}

    Json::Value getProfile(const std::string &userId) const
    {
        return repository_.loadProfile(userId);
    }

    // Accepts a partial JSON patch; only white-listed fields are written.
    Json::Value updateProfile(const std::string &userId, const Json::Value &patch)
    {
        auto profile = repository_.loadProfile(userId);

        static const std::vector<std::string> allowed = {
            "display_name", "avatar_url", "locale",
            "goal_level", "goal_date", "daily_target",
            "notification_enabled"};

        for (const auto &field : allowed)
        {
            if (patch.isMember(field))
            {
                profile[field] = patch[field];
            }
        }
        repository_.saveProfile(userId, profile);
        return profile;
    }

  private:
    infrastructure::storage::ProfileRepository &repository_;
};
}  // namespace application::services
