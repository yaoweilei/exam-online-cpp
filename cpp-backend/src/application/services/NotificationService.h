#pragma once

#include <array>
#include <cctype>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>

#include <drogon/HttpClient.h>
#include <json/json.h>

namespace application::services
{
struct DeliveryResult
{
    bool delivered{false};
    std::string provider;
    std::string providerMessageId;
    std::string errorMessage;
};

struct EmailMessage
{
    std::string toAddress;
    std::string subject;
    std::string textBody;
    std::string htmlBody;
};

struct SmsMessage
{
    std::string to;
    std::string body;
};

namespace detail
{
inline std::string urlEncode(const std::string &value)
{
    std::ostringstream oss;
    oss.fill('0');
    oss << std::hex << std::uppercase;
    for (const unsigned char ch : value)
    {
        if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~')
        {
            oss << static_cast<char>(ch);
            continue;
        }
        oss << '%' << std::setw(2) << static_cast<int>(ch);
    }
    return oss.str();
}

inline std::string base64Encode(std::string_view value)
{
    static constexpr std::array<char, 64> table{
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
        'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f',
        'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v',
        'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '/'};

    std::string out;
    out.reserve(((value.size() + 2) / 3) * 4);

    std::size_t index = 0;
    while (index + 3 <= value.size())
    {
        const auto chunk = (static_cast<unsigned char>(value[index]) << 16) |
                           (static_cast<unsigned char>(value[index + 1]) << 8) |
                           static_cast<unsigned char>(value[index + 2]);
        out.push_back(table[(chunk >> 18) & 0x3F]);
        out.push_back(table[(chunk >> 12) & 0x3F]);
        out.push_back(table[(chunk >> 6) & 0x3F]);
        out.push_back(table[chunk & 0x3F]);
        index += 3;
    }

    const auto remainder = value.size() - index;
    if (remainder == 1)
    {
        const auto chunk = static_cast<unsigned char>(value[index]) << 16;
        out.push_back(table[(chunk >> 18) & 0x3F]);
        out.push_back(table[(chunk >> 12) & 0x3F]);
        out.append("==");
    }
    else if (remainder == 2)
    {
        const auto chunk = (static_cast<unsigned char>(value[index]) << 16) |
                           (static_cast<unsigned char>(value[index + 1]) << 8);
        out.push_back(table[(chunk >> 18) & 0x3F]);
        out.push_back(table[(chunk >> 12) & 0x3F]);
        out.push_back(table[(chunk >> 6) & 0x3F]);
        out.push_back('=');
    }
    return out;
}

inline Json::Value parseJsonBody(const drogon::HttpResponsePtr &response)
{
    Json::Value root(Json::nullValue);
    if (!response)
    {
        return root;
    }
    Json::CharReaderBuilder builder;
    std::string errors;
    std::istringstream input(std::string(response->getBody()));
    Json::parseFromStream(builder, input, &root, &errors);
    return root;
}

inline std::string responseBodyString(const drogon::HttpResponsePtr &response)
{
    return response ? std::string(response->getBody()) : std::string();
}

inline std::string jsonFieldOrFallback(const Json::Value &payload,
                                       const std::string &field,
                                       const std::string &fallback)
{
    if (payload.isObject() && payload.isMember(field))
    {
        const auto value = payload[field].asString();
        if (!value.empty())
        {
            return value;
        }
    }
    return fallback;
}

inline DeliveryResult buildHttpFailure(const std::string &provider,
                                       const std::string &errorMessage)
{
    DeliveryResult result;
    result.provider = provider;
    result.errorMessage = errorMessage;
    return result;
}

inline std::string reqResultLabel(const drogon::ReqResult result)
{
    switch (result)
    {
    case drogon::ReqResult::Ok:
        return "ok";
    case drogon::ReqResult::BadResponse:
        return "bad_response";
    case drogon::ReqResult::NetworkFailure:
        return "network_failure";
    case drogon::ReqResult::BadServerAddress:
        return "bad_server_address";
    case drogon::ReqResult::Timeout:
        return "timeout";
    case drogon::ReqResult::HandshakeError:
        return "handshake_error";
    case drogon::ReqResult::InvalidCertificate:
        return "invalid_certificate";
    case drogon::ReqResult::EncryptionFailure:
        return "encryption_failure";
    default:
        return "unknown";
    }
}
}  // namespace detail

class EmailService
{
  public:
    virtual ~EmailService() = default;
    virtual DeliveryResult send(const EmailMessage &message) = 0;
};

class SmsService
{
  public:
    virtual ~SmsService() = default;
    virtual DeliveryResult send(const SmsMessage &message) = 0;

    bool sendCode(const std::string &phone, const std::string &code)
    {
        SmsMessage message;
        message.to = phone;
        message.body = "【Exam Online】验证码：" + code + "，10 分钟内有效。";
        return send(message).delivered;
    }
};

class StubEmailService : public EmailService
{
  public:
    DeliveryResult send(const EmailMessage &message) override
    {
        std::printf("[EMAIL-STUB] to=%s subject=%s\n%s\n",
                    message.toAddress.c_str(),
                    message.subject.c_str(),
                    message.textBody.c_str());
        return DeliveryResult{.delivered = true, .provider = "stub-email", .providerMessageId = "stub"};
    }
};

class StubSmsService : public SmsService
{
  public:
    DeliveryResult send(const SmsMessage &message) override
    {
        std::printf("[SMS-STUB] to=%s\n%s\n", message.to.c_str(), message.body.c_str());
        return DeliveryResult{.delivered = true, .provider = "stub-sms", .providerMessageId = "stub"};
    }
};

class ResendEmailService : public EmailService
{
  public:
    struct Config
    {
        std::string apiKey;
        std::string fromAddress;
        std::string fromName;
        std::string apiBaseUrl{"https://api.resend.com"};
    };

    explicit ResendEmailService(Config config) : config_(std::move(config)) {}

    DeliveryResult send(const EmailMessage &message) override
    {
        if (config_.apiKey.empty() || config_.fromAddress.empty())
        {
            return detail::buildHttpFailure("resend", "Resend email provider is not configured");
        }

        auto client = drogon::HttpClient::newHttpClient(config_.apiBaseUrl);
        auto request = drogon::HttpRequest::newHttpRequest();
        request->setMethod(drogon::Post);
        request->setPath("/emails");
        request->setContentTypeCode(drogon::CT_APPLICATION_JSON);
        request->addHeader("Authorization", "Bearer " + config_.apiKey);

        Json::Value body(Json::objectValue);
        body["from"] = config_.fromName.empty() ? config_.fromAddress : (config_.fromName + " <" + config_.fromAddress + ">");
        body["to"] = Json::arrayValue;
        body["to"].append(message.toAddress);
        body["subject"] = message.subject;
        body["text"] = message.textBody;
        if (!message.htmlBody.empty())
        {
            body["html"] = message.htmlBody;
        }
        request->setBody(body.toStyledString());

        const auto [result, response] = client->sendRequest(request);
        if (result != drogon::ReqResult::Ok || !response)
        {
            return detail::buildHttpFailure("resend", "Email request failed: " + detail::reqResultLabel(result));
        }

        const auto payload = detail::parseJsonBody(response);
        if (response->statusCode() < drogon::k200OK || response->statusCode() >= drogon::k300MultipleChoices)
        {
            return detail::buildHttpFailure(
                "resend",
                detail::jsonFieldOrFallback(payload, "message", detail::responseBodyString(response)));
        }

        DeliveryResult delivery;
        delivery.delivered = true;
        delivery.provider = "resend";
        delivery.providerMessageId = payload.get("id", "").asString();
        return delivery;
    }

  private:
    Config config_;
};

class TwilioSmsService : public SmsService
{
  public:
    struct Config
    {
        std::string accountSid;
        std::string authToken;
        std::string fromNumber;
        std::string apiBaseUrl{"https://api.twilio.com"};
    };

    explicit TwilioSmsService(Config config) : config_(std::move(config)) {}

    DeliveryResult send(const SmsMessage &message) override
    {
        if (config_.accountSid.empty() || config_.authToken.empty() || config_.fromNumber.empty())
        {
            return detail::buildHttpFailure("twilio", "Twilio SMS provider is not configured");
        }

        auto client = drogon::HttpClient::newHttpClient(config_.apiBaseUrl);
        auto request = drogon::HttpRequest::newHttpRequest();
        request->setMethod(drogon::Post);
        request->setPath("/2010-04-01/Accounts/" + config_.accountSid + "/Messages.json");
        request->setContentTypeString("application/x-www-form-urlencoded");
        request->addHeader("Authorization", "Basic " + detail::base64Encode(config_.accountSid + ":" + config_.authToken));
        request->setBody(
            "To=" + detail::urlEncode(message.to) +
            "&From=" + detail::urlEncode(config_.fromNumber) +
            "&Body=" + detail::urlEncode(message.body));

        const auto [result, response] = client->sendRequest(request);
        if (result != drogon::ReqResult::Ok || !response)
        {
            return detail::buildHttpFailure("twilio", "SMS request failed: " + detail::reqResultLabel(result));
        }

        const auto payload = detail::parseJsonBody(response);
        if (response->statusCode() < drogon::k200OK || response->statusCode() >= drogon::k300MultipleChoices)
        {
            return detail::buildHttpFailure(
                "twilio",
                detail::jsonFieldOrFallback(payload, "message", detail::responseBodyString(response)));
        }

        DeliveryResult delivery;
        delivery.delivered = true;
        delivery.provider = "twilio";
        delivery.providerMessageId = payload.get("sid", "").asString();
        return delivery;
    }

  private:
    Config config_;
};
}  // namespace application::services