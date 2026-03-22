#pragma once

#include <cstdlib>
#include <filesystem>
#include <string>

namespace infrastructure::config
{
struct AppConfig
{
    std::string host{"0.0.0.0"};
    uint16_t port{8000};
    size_t threads{4};
    std::filesystem::path baseDir{std::filesystem::current_path()};
    std::filesystem::path documentRoot{std::filesystem::current_path()};
    std::filesystem::path dataPaperDir;
    std::filesystem::path dataUserDir;
    std::filesystem::path staticDir;
    std::filesystem::path templatesDir;
    std::filesystem::path furiganaDictPath;
    std::string logLevel{"INFO"};
    bool enableSendfile{true};
};

inline std::string readEnv(const char *name, const std::string &fallback)
{
    const char *value = std::getenv(name);
    if (!value || std::string(value).empty())
    {
        return fallback;
    }
    return value;
}

inline AppConfig loadConfig()
{
    AppConfig config{};
    config.host = readEnv("HOST", config.host);
    config.port = static_cast<uint16_t>(std::stoi(readEnv("PORT", std::to_string(config.port))));
    config.threads = static_cast<size_t>(std::stoul(readEnv("THREADS", std::to_string(config.threads))));
    config.logLevel = readEnv("LOG_LEVEL", config.logLevel);
    config.baseDir = std::filesystem::path(readEnv("BASE_DIR", config.baseDir.string()));
    config.documentRoot = std::filesystem::path(readEnv("DOCUMENT_ROOT", config.baseDir.string()));
    config.dataPaperDir = config.baseDir / "data" / "paper" / "jlpt";
    config.dataUserDir = config.baseDir / "data" / "user";
    config.staticDir = config.baseDir / "static";
    config.templatesDir = config.baseDir / "templates";
    config.furiganaDictPath = config.staticDir / "resource" / "furigana.dict.json";
    return config;
}
}  // namespace infrastructure::config
