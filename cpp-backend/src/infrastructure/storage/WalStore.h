#pragma once

#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <vector>

#include <json/json.h>

#include "JsonIo.h"
#include "common/TimeUtils.h"

namespace infrastructure::storage
{
class WalStore
{
  public:
    WalStore(std::filesystem::path walPath, std::filesystem::path snapshotPath, size_t compactEvery = 100)
        : walPath_(std::move(walPath)),
          snapshotPath_(std::move(snapshotPath)),
          compactEvery_(compactEvery)
    {
        std::filesystem::create_directories(walPath_.parent_path());
    }

    void append(const std::string &eventType, const Json::Value &payload)
    {
        std::scoped_lock lock(mutex_);
        std::ofstream out(walPath_, std::ios::app | std::ios::binary);
        Json::Value record(Json::objectValue);
        record["event"] = eventType;
        record["payload"] = payload;
        record["ts"] = common::nowIso8601();

        Json::StreamWriterBuilder builder;
        builder["indentation"] = "";
        out << Json::writeString(builder, record) << "\n";
        ++eventCounter_;

        if (eventCounter_ >= compactEvery_)
        {
            compact();
            eventCounter_ = 0;
        }
    }

    void compact()
    {
        Json::Value snapshot(Json::objectValue);
        snapshot["wal_path"] = walPath_.string();
        snapshot["compacted_at"] = common::nowIso8601();
        writeJsonFileAtomic(snapshotPath_, snapshot);

        std::ofstream truncateWal(walPath_, std::ios::trunc);
        truncateWal.flush();
    }

    std::vector<Json::Value> recover() const
    {
        std::vector<Json::Value> records;
        if (!std::filesystem::exists(walPath_))
        {
            return records;
        }

        std::ifstream in(walPath_, std::ios::binary);
        std::string line;
        while (std::getline(in, line))
        {
            if (line.empty())
            {
                continue;
            }
            try
            {
                records.push_back(parseJson(line, walPath_.string()));
            }
            catch (...)
            {
                continue;
            }
        }
        return records;
    }

    std::filesystem::path walPath() const
    {
        return walPath_;
    }

  private:
    std::filesystem::path walPath_;
    std::filesystem::path snapshotPath_;
    size_t compactEvery_;
    size_t eventCounter_{0};
    std::mutex mutex_;
};
}  // namespace infrastructure::storage
