#pragma once

#include <filesystem>
#include <fstream>
#include <string>
#include <shared_mutex>
#include <mutex>
#include <unordered_map>

#include <json/json.h>

#include "common/AppException.h"

namespace infrastructure::storage
{
struct JsonFileCacheEntry { Json::Value value; std::filesystem::file_time_type modified; std::uintmax_t size{0}; };
inline std::unordered_map<std::string, JsonFileCacheEntry> &jsonFileCache() { static std::unordered_map<std::string, JsonFileCacheEntry> cache; return cache; }
inline std::shared_mutex &jsonFileCacheMutex() { static std::shared_mutex mutex; return mutex; }
inline Json::Value parseJson(const std::string &raw, const std::string &sourceName)
{
    Json::CharReaderBuilder builder;
    builder["collectComments"] = false;
    std::string error;
    Json::Value value;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    if (!reader->parse(raw.data(), raw.data() + raw.size(), &value, &error))
    {
        throw common::AppException(
            "JSON_PARSE_ERROR",
            "Failed to parse JSON from " + sourceName + ": " + error,
            drogon::k500InternalServerError);
    }
    return value;
}

inline Json::Value readJsonFile(const std::filesystem::path &path)
{
    std::error_code metadataError;
    const auto absolute = std::filesystem::absolute(path).lexically_normal().string();
    const auto modified = std::filesystem::last_write_time(path, metadataError);
    const auto size = metadataError ? 0 : std::filesystem::file_size(path, metadataError);
    if (!metadataError)
    {
        std::shared_lock cacheLock(jsonFileCacheMutex());
        const auto it = jsonFileCache().find(absolute);
        if (it != jsonFileCache().end() && it->second.modified == modified && it->second.size == size) return it->second.value;
    }
    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        throw common::AppException(
            "FILE_READ_ERROR",
            "Unable to read file: " + path.string(),
            drogon::k500InternalServerError);
    }
    std::string raw((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    auto value = parseJson(raw, path.string());
    if (!metadataError) { std::unique_lock cacheLock(jsonFileCacheMutex()); jsonFileCache()[absolute] = {value, modified, size}; }
    return value;
}

inline void writeJsonFileAtomic(const std::filesystem::path &path, const Json::Value &value)
{
    std::filesystem::create_directories(path.parent_path());
    const auto tmpPath = path.string() + ".tmp";
    {
        std::ofstream out(tmpPath, std::ios::binary | std::ios::trunc);
        if (!out)
        {
            throw common::AppException(
                "FILE_WRITE_ERROR",
                "Unable to open temp file for write: " + tmpPath,
                drogon::k500InternalServerError);
        }
        Json::StreamWriterBuilder builder;
        builder["indentation"] = "  ";
        builder["emitUTF8"] = true;
        out << Json::writeString(builder, value);
    }
    std::error_code ec;
    std::filesystem::rename(tmpPath, path, ec);
    if (ec)
    {
        std::filesystem::copy_file(
            tmpPath,
            path,
            std::filesystem::copy_options::overwrite_existing,
            ec);
        std::filesystem::remove(tmpPath, ec);
    }
    std::error_code metadataError;
    const auto absolute = std::filesystem::absolute(path).lexically_normal().string();
    const auto modified = std::filesystem::last_write_time(path, metadataError);
    const auto size = metadataError ? 0 : std::filesystem::file_size(path, metadataError);
    if (!metadataError) { std::unique_lock cacheLock(jsonFileCacheMutex()); jsonFileCache()[absolute] = {value, modified, size}; }
}
}  // namespace infrastructure::storage
