#pragma once

#include <string>

#include "infrastructure/storage/FuriganaRepository.h"

namespace application::services
{
class FuriganaService
{
  public:
    explicit FuriganaService(infrastructure::storage::FuriganaRepository &repository) : repository_(repository) {}

    std::string annotate(const std::string &text) const
    {
        return repository_.annotate(text);
    }

    std::string reading(const std::string &word) const
    {
        return repository_.readingOf(word);
    }

  private:
    infrastructure::storage::FuriganaRepository &repository_;
};
}  // namespace application::services
