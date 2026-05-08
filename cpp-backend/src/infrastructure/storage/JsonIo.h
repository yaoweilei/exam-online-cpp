#pragma once

#include <filesystem>
#include <fstream>
#include <string>

#include <json/json.h>

#include "common/AppException.h"

namespace infrastructure::storage
{
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
    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        throw common::AppException(
            "FILE_READ_ERROR",
            "Unable to read file: " + path.string(),
            drogon::k500InternalServerError);
    }
    std::string raw((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return parseJson(raw, path.string());
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
}
}  // namespace infrastructure::storage
