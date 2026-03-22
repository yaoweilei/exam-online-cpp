#pragma once

#include <cctype>
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

inline std::string toLowerCopy(std::string value)
{
    for (auto &ch : value)
    {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return value;
}

inline std::string toUpperCopy(std::string value)
{
    for (auto &ch : value)
    {
        ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    }
    return value;
}

inline bool isDevelopmentEnv(const std::string &appEnv)
{
    return appEnv == "development" || appEnv == "dev" || appEnv == "local";
}

inline AppConfig loadConfig()
{
    AppConfig config{};
    config.host = readEnv("HOST", config.host);
    config.port = static_cast<uint16_t>(std::stoi(readEnv("PORT", std::to_string(config.port))));
    config.threads = static_cast<size_t>(std::stoul(readEnv("THREADS", std::to_string(config.threads))));
    config.appEnv = toLowerCopy(readEnv("APP_ENV", config.appEnv));
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
    const auto defaultLogLevel = isDevelopmentEnv(config.appEnv) ? "DEBUG" : "INFO";
    config.logLevel = toUpperCopy(readEnv("LOG_LEVEL", defaultLogLevel));
    return config;
}
}  // namespace infrastructure::config
