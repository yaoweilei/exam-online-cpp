#pragma once

#include <string>

#include <json/json.h>

namespace application::recommendation
{
class RecommendationStrategy
{
  public:
    virtual ~RecommendationStrategy() = default;
    virtual Json::Value recommend(const std::string &userId, int limit) const = 0;
};
}  // namespace application::recommendation
