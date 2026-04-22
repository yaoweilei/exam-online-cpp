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
    std::filesystem::path dataSystemDir;
    std::filesystem::path staticDir;
    std::filesystem::path templatesDir;
    std::filesystem::path furiganaDictPath;
    std::filesystem::path logDir;
    std::string publicWebBaseUrl{"http://127.0.0.1:8000"};
    std::string logFileBaseName{"exam-online-cpp"};
    std::string logLevel;
    size_t logFileSize{100000000};
    size_t logMaxFiles{10};
    bool enableSendfile{true};
    // WeChat Open Platform
    std::string wechatAppId;
    std::string wechatAppSecret;
    std::string wechatCallbackBaseUrl;  // e.g. "https://example.com"
    // SMS (Aliyun / Tencent)
    std::string smsAccessKeyId;
    std::string smsAccessKeySecret;
    std::string smsSignName;
    std::string smsTemplateCode;
    std::string smsProvider{"stub"};
    std::string smsAccountSid;
    std::string smsAuthToken;
    std::string smsFromNumber;
    std::string smsApiBaseUrl{"https://api.twilio.com"};
    // Email
    std::string emailProvider{"stub"};
    std::string emailApiKey;
    std::string emailFromAddress;
    std::string emailFromName{"Exam Online"};
    std::string emailApiBaseUrl{"https://api.resend.com"};
    int referralRewardCredits{10};
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

inline int readEnvInt(const char *name, int fallback)
{
    const char *value = std::getenv(name);
    if (!value || std::string(value).empty())
    {
        return fallback;
    }
    return std::stoi(value);
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

inline bool looksLikeBaseDir(const std::filesystem::path &candidate)
{
    return std::filesystem::exists(candidate / "data" / "paper")
        && std::filesystem::exists(candidate / "data" / "user")
        && std::filesystem::exists(candidate / "static");
}

inline std::filesystem::path resolveDefaultBaseDir()
{
    const auto current = std::filesystem::current_path();
    auto candidate = current;
    while (true)
    {
        if (looksLikeBaseDir(candidate))
        {
            return candidate;
        }
        const auto parent = candidate.parent_path();
        if (parent.empty() || parent == candidate)
        {
            return current;
        }
        candidate = parent;
    }
}

inline AppConfig loadConfig()
{
    AppConfig config{};
    config.baseDir = resolveDefaultBaseDir();
    config.documentRoot = config.baseDir;
    config.host = readEnv("HOST", config.host);
    config.port = static_cast<uint16_t>(std::stoi(readEnv("PORT", std::to_string(config.port))));
    config.threads = static_cast<size_t>(std::stoul(readEnv("THREADS", std::to_string(config.threads))));
    config.appEnv = toLowerCopy(readEnv("APP_ENV", config.appEnv));
    config.baseDir = std::filesystem::path(readEnv("BASE_DIR", config.baseDir.string()));
    config.documentRoot = std::filesystem::path(readEnv("DOCUMENT_ROOT", config.baseDir.string()));
    config.dataPaperDir = config.baseDir / "data" / "paper" / "jlpt";
    config.dataUserDir = config.baseDir / "data" / "user";
    config.dataSystemDir = config.baseDir / "data" / "system";
    config.staticDir = config.baseDir / "static";
    config.templatesDir = config.baseDir / "templates";
    config.furiganaDictPath = config.staticDir / "resource" / "furigana.dict.json";
    config.publicWebBaseUrl = readEnv("PUBLIC_WEB_BASE_URL", config.publicWebBaseUrl);
    config.logDir = std::filesystem::path(readEnv("LOG_DIR", (config.baseDir / "logs" / "backend").string()));
    config.logFileBaseName = readEnv("LOG_FILE_BASENAME", config.logFileBaseName);
    config.logFileSize = readEnvSize("LOG_FILE_SIZE", config.logFileSize);
    config.logMaxFiles = readEnvSize("LOG_MAX_FILES", config.logMaxFiles);
    const auto defaultLogLevel = isDevelopmentEnv(config.appEnv) ? "DEBUG" : "INFO";
    config.logLevel = toUpperCopy(readEnv("LOG_LEVEL", defaultLogLevel));
    // WeChat
    config.wechatAppId = readEnv("WECHAT_APP_ID", "");
    config.wechatAppSecret = readEnv("WECHAT_APP_SECRET", "");
    config.wechatCallbackBaseUrl = readEnv("WECHAT_CALLBACK_BASE_URL", "");
    // SMS
    config.smsAccessKeyId = readEnv("SMS_ACCESS_KEY_ID", "");
    config.smsAccessKeySecret = readEnv("SMS_ACCESS_KEY_SECRET", "");
    config.smsSignName = readEnv("SMS_SIGN_NAME", "");
    config.smsTemplateCode = readEnv("SMS_TEMPLATE_CODE", "");
    config.smsProvider = toLowerCopy(readEnv("SMS_PROVIDER", config.smsProvider));
    config.smsAccountSid = readEnv("SMS_ACCOUNT_SID", "");
    config.smsAuthToken = readEnv("SMS_AUTH_TOKEN", "");
    config.smsFromNumber = readEnv("SMS_FROM_NUMBER", "");
    config.smsApiBaseUrl = readEnv("SMS_API_BASE_URL", config.smsApiBaseUrl);
    // Email
    config.emailProvider = toLowerCopy(readEnv("EMAIL_PROVIDER", config.emailProvider));
    config.emailApiKey = readEnv("EMAIL_API_KEY", "");
    config.emailFromAddress = readEnv("EMAIL_FROM_ADDRESS", "");
    config.emailFromName = readEnv("EMAIL_FROM_NAME", config.emailFromName);
    config.emailApiBaseUrl = readEnv("EMAIL_API_BASE_URL", config.emailApiBaseUrl);
    config.referralRewardCredits = readEnvInt("REFERRAL_REWARD_CREDITS", config.referralRewardCredits);
    if (config.referralRewardCredits < 0)
    {
        config.referralRewardCredits = 0;
    }
    return config;
}
}  // namespace infrastructure::config
