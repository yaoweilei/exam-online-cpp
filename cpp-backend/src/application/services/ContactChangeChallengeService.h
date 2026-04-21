#pragma once

#include <algorithm>
#include <chrono>
#include <cctype>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "NotificationService.h"
#include "common/AppException.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class ContactChangeChallengeService
{
  public:
    ContactChangeChallengeService(infrastructure::storage::UserRepository &userRepository,
                                  EmailService &emailService,
                                  SmsService &smsService)
        : userRepository_(userRepository), emailService_(emailService), smsService_(smsService)
    {
    }

    void sendChallengeCode(const std::string &userId, const std::string &channel)
    {
        if (userId.empty() || userId == "guest")
        {
            throw common::AppException("AUTH_REQUIRED", "Login is required before requesting a change confirmation code", drogon::k401Unauthorized);
        }

        const auto currentUser = userRepository_.findUserById(userId);
        if (currentUser.isNull())
        {
            throw common::AppException("USER_NOT_FOUND", "User not found", drogon::k404NotFound);
        }

        const auto target = requireAvailableChannel(currentUser, channel);

        std::unique_lock lock(mutex_);
        const auto now = std::chrono::system_clock::now();
        const auto key = challengeKey(userId, target.channel);
        auto it = pending_.find(key);
        if (it != pending_.end())
        {
            const auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - it->second.sentAt).count();
            if (elapsed < 60)
            {
                throw common::AppException("CONTACT_CHANGE_RATE_LIMITED", "Please wait before requesting another confirmation code", drogon::k429TooManyRequests);
            }
        }

        const auto code = generateCode();
        pending_[key] = PendingCode{
            .code = code,
            .destination = target.destination,
            .sentAt = now,
            .expiresAt = now + std::chrono::minutes(10)};
        lock.unlock();

        if (target.channel == "email")
        {
            EmailMessage message;
            message.toAddress = target.destination;
            message.subject = "Exam Online 改绑确认验证码";
            message.textBody = "你正在修改账号绑定联系人，确认验证码是 " + code + "，10 分钟内有效。如果这不是你的操作，请尽快检查账号安全。";
            message.htmlBody = "<p>你正在修改账号绑定联系人，确认验证码是 <strong>" + code + "</strong>，10 分钟内有效。</p><p>如果这不是你的操作，请尽快检查账号安全。</p>";
            const auto delivery = emailService_.send(message);
            if (!delivery.delivered)
            {
                throw common::AppException(
                    "EMAIL_SEND_FAILED",
                    delivery.errorMessage.empty() ? "Failed to send email" : delivery.errorMessage,
                    drogon::k500InternalServerError);
            }
            return;
        }

        if (!smsService_.sendCode(target.destination, code))
        {
            throw common::AppException("SMS_SEND_FAILED", "Failed to send SMS", drogon::k500InternalServerError);
        }
    }

    void requireVerifiedChallengeIfNeeded(const Json::Value &currentUser,
                                          const std::string &contactKind,
                                          const std::string &nextValue,
                                          const std::string &challengeChannel,
                                          const std::string &challengeCode)
    {
        if (!changeRequiresChallenge(currentUser, contactKind, nextValue))
        {
            return;
        }

        if (challengeChannel.empty() || challengeCode.empty())
        {
            throw common::AppException(
                "CONTACT_CHANGE_CONFIRMATION_REQUIRED",
                "Please verify your current email or phone before changing contact information",
                drogon::k400BadRequest);
        }

        const auto userId = currentUser.get("id", "").asString();
        const auto target = requireAvailableChannel(currentUser, challengeChannel);
        const auto key = challengeKey(userId, target.channel);

        std::unique_lock lock(mutex_);
        auto it = pending_.find(key);
        if (it == pending_.end())
        {
            throw common::AppException(
                "CONTACT_CHANGE_CODE_NOT_FOUND",
                "No confirmation code sent to the selected current contact, or it has expired",
                drogon::k400BadRequest);
        }
        if (std::chrono::system_clock::now() > it->second.expiresAt)
        {
            pending_.erase(it);
            throw common::AppException("CONTACT_CHANGE_CODE_EXPIRED", "Confirmation code has expired", drogon::k400BadRequest);
        }
        if (it->second.destination != target.destination)
        {
            pending_.erase(it);
            throw common::AppException(
                "CONTACT_CHANGE_CODE_NOT_FOUND",
                "No confirmation code sent to the selected current contact, or it has expired",
                drogon::k400BadRequest);
        }
        if (it->second.code != challengeCode)
        {
            throw common::AppException("CONTACT_CHANGE_CODE_INVALID", "Confirmation code is incorrect", drogon::k400BadRequest);
        }
        pending_.erase(it);
    }

  private:
    struct PendingCode
    {
        std::string code;
        std::string destination;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    struct ChallengeTarget
    {
        std::string channel;
        std::string destination;
    };

    static std::string normalizeChannel(const std::string &channel)
    {
        std::string normalized = channel;
        std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        return normalized;
    }

    static std::string generateCode()
    {
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<int> dist(100000, 999999);
        return std::to_string(dist(gen));
    }

    static bool hasVerifiedEmail(const Json::Value &user)
    {
        return user.get("email_verified", false).asBool() && !user.get("email", "").asString().empty();
    }

    static bool hasVerifiedPhone(const Json::Value &user)
    {
        return user.get("phone_verified", false).asBool() && !user.get("phone", "").asString().empty();
    }

    static std::string currentContactValue(const Json::Value &user, const std::string &contactKind)
    {
        if (contactKind == "phone")
        {
            return user.get("phone", "").asString();
        }
        return user.get("email", "").asString();
    }

    static bool changeRequiresChallenge(const Json::Value &currentUser,
                                        const std::string &contactKind,
                                        const std::string &nextValue)
    {
        if (!hasVerifiedEmail(currentUser) && !hasVerifiedPhone(currentUser))
        {
            return false;
        }
        return currentContactValue(currentUser, contactKind) != nextValue;
    }

    static std::string challengeKey(const std::string &userId, const std::string &channel)
    {
        return userId + ":" + channel;
    }

    static ChallengeTarget requireAvailableChannel(const Json::Value &currentUser, const std::string &channel)
    {
        const auto normalizedChannel = normalizeChannel(channel);
        if (normalizedChannel == "email" && hasVerifiedEmail(currentUser))
        {
            return ChallengeTarget{.channel = normalizedChannel, .destination = currentUser.get("email", "").asString()};
        }
        if (normalizedChannel == "phone" && hasVerifiedPhone(currentUser))
        {
            return ChallengeTarget{.channel = normalizedChannel, .destination = currentUser.get("phone", "").asString()};
        }
        throw common::AppException(
            "CONTACT_CHANGE_CHANNEL_UNAVAILABLE",
            "The selected current contact is not available for change confirmation",
            drogon::k400BadRequest);
    }

    infrastructure::storage::UserRepository &userRepository_;
    EmailService &emailService_;
    SmsService &smsService_;
    std::unordered_map<std::string, PendingCode> pending_;
    std::mutex mutex_;
};
}  // namespace application::services