#pragma once

#include <algorithm>
#include <filesystem>
#include <mutex>
#include <shared_mutex>
#include <string>
#include <vector>

#include <json/json.h>

#include "JsonIo.h"

namespace infrastructure::storage
{
class FuriganaRepository
{
  public:
    explicit FuriganaRepository(std::filesystem::path dictPath) : dictPath_(std::move(dictPath))
    {
        reload();
    }

    void reload()
    {
        std::unique_lock lock(mutex_);
        dictionary_.clear();
        if (!std::filesystem::exists(dictPath_))
        {
            return;
        }
        Json::Value raw = readJsonFile(dictPath_);
        if (raw.isObject())
        {
            for (const auto &key : raw.getMemberNames())
            {
                dictionary_.push_back({key, raw[key].asString()});
            }
        }
        else if (raw.isArray())
        {
            for (const auto &item : raw)
            {
                dictionary_.push_back({item.get("w", "").asString(), item.get("r", "").asString()});
            }
        }
        std::sort(dictionary_.begin(), dictionary_.end(), [](const auto &a, const auto &b) {
            return a.word.size() > b.word.size();
        });
    }

    std::string readingOf(const std::string &word) const
    {
        std::shared_lock lock(mutex_);
        for (const auto &entry : dictionary_)
        {
            if (entry.word == word)
            {
                return entry.reading;
            }
        }
        return {};
    }

    std::string annotate(const std::string &text) const
    {
        std::shared_lock lock(mutex_);
        if (text.empty())
        {
            return text;
        }
        std::string output = text;
        for (const auto &entry : dictionary_)
        {
            if (entry.word.empty() || entry.reading.empty())
            {
                continue;
            }
            std::string ruby = "<ruby>" + entry.word + "<rt>" + entry.reading + "</rt></ruby>";
            size_t pos = 0;
            while ((pos = output.find(entry.word, pos)) != std::string::npos)
            {
                output.replace(pos, entry.word.size(), ruby);
                pos += ruby.size();
            }
        }
        return output;
    }

  private:
    struct Entry
    {
        std::string word;
        std::string reading;
    };

    std::filesystem::path dictPath_;
    std::vector<Entry> dictionary_;
    mutable std::shared_mutex mutex_;
};
}  // namespace infrastructure::storage
