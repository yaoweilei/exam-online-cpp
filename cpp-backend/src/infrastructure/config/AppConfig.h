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
    std::string appEnv{"development"};
    std::filesystem::path baseDir{std::filesystem::current_path()};
    std::filesystem::path documentRoot{std::filesystem::current_path()};
    std::filesystem::path dataPaperDir;
    std::filesystem::path dataUserDir;
    std::filesystem::path staticDir;
    std::filesystem::path templatesDir;
    std::filesystem::path furiganaDictPath;
    std::filesystem::path logDir;
    std::string logFileBaseName{"exam-online-cpp"};
    std::string logLevel;
    size_t logFileSize{100000000};
    size_t logMaxFiles{10};
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

inline size_t readEnvSize(const char *name, size_t fallback)
{
    const char *value = std::getenv(name);
    if (!value || std::string(value).empty())
    {
        return fallback;
    }
    return static_cast<size_t>(std::stoull(value));
}

inline AppConfig loadConfig()
{
    AppConfig config{};
    config.host = readEnv("HOST", config.host);
    config.port = static_cast<uint16_t>(std::stoi(readEnv("PORT", std::to_string(config.port))));
    config.threads = static_cast<size_t>(std::stoul(readEnv("THREADS", std::to_string(config.threads))));
    config.appEnv = readEnv("APP_ENV", config.appEnv);
    config.baseDir = std::filesystem::path(readEnv("BASE_DIR", config.baseDir.string()));
    config.documentRoot = std::filesystem::path(readEnv("DOCUMENT_ROOT", config.baseDir.string()));
    config.dataPaperDir = config.baseDir / "data" / "paper" / "jlpt";
    config.dataUserDir = config.baseDir / "data" / "user";
    config.staticDir = config.baseDir / "static";
    config.templatesDir = config.baseDir / "templates";
    config.furiganaDictPath = config.staticDir / "resource" / "furigana.dict.json";
    config.logDir = std::filesystem::path(readEnv("LOG_DIR", (config.baseDir / "logs" / "backend").string()));
    config.logFileBaseName = readEnv("LOG_FILE_BASENAME", config.logFileBaseName);
    config.logFileSize = readEnvSize("LOG_FILE_SIZE", config.logFileSize);
    config.logMaxFiles = readEnvSize("LOG_MAX_FILES", config.logMaxFiles);
    const auto defaultLogLevel =
        (config.appEnv == "development" || config.appEnv == "dev" || config.appEnv == "local") ? "DEBUG" : "INFO";
    config.logLevel = readEnv("LOG_LEVEL", defaultLogLevel);
    return config;
}
}  // namespace infrastructure::config
