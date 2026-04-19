#pragma once

#include <chrono>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>

#include <json/json.h>

#include "SmsService.h"
#include "common/AppException.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class PhoneService
{
  public:
    explicit PhoneService(infrastructure::storage::UserRepository &userRepository,
                          SmsService &smsService)
        : userRepository_(userRepository), smsService_(smsService)
    {
    }

    // Step 1: generate + send a 6-digit code.
    // Rate-limited: one code per phone per 60 seconds.
    void sendVerificationCode(const std::string &phone)
    {
        validatePhoneFormat(phone);

        std::unique_lock lock(mutex_);
        const auto now = std::chrono::system_clock::now();
        auto it = pending_.find(phone);
        if (it != pending_.end())
        {
            const auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - it->second.sentAt).count();
            if (elapsed < 60)
            {
                throw common::AppException(
                    "SMS_RATE_LIMITED",
                    "Please wait before requesting another code",
                    drogon::k429TooManyRequests);
            }
        }

        const auto code = generateCode();
        pending_[phone] = PendingCode{
            .code = code,
            .sentAt = now,
            .expiresAt = now + std::chrono::minutes(10)};
        lock.unlock();

        if (!smsService_.sendCode(phone, code))
        {
            throw common::AppException("SMS_SEND_FAILED", "Failed to send SMS", drogon::k500InternalServerError);
        }
    }

    // Step 2: verify the code and either bind an existing user or create/login a phone user.
    Json::Value verifyAndBind(const std::string &userId, const std::string &phone, const std::string &code)
    {
        validatePhoneFormat(phone);

        std::unique_lock lock(mutex_);
        auto it = pending_.find(phone);
        if (it == pending_.end())
        {
            throw common::AppException("SMS_CODE_NOT_FOUND", "No code sent to this number, or it has expired", drogon::k400BadRequest);
        }
        if (std::chrono::system_clock::now() > it->second.expiresAt)
        {
            pending_.erase(it);
            throw common::AppException("SMS_CODE_EXPIRED", "Verification code has expired", drogon::k400BadRequest);
        }
        if (it->second.code != code)
        {
            throw common::AppException("SMS_CODE_INVALID", "Verification code is incorrect", drogon::k400BadRequest);
        }
        pending_.erase(it);
        lock.unlock();

        if (userId.empty() || userId == "guest")
        {
            auto existing = userRepository_.findUserByPhone(phone);
            if (!existing.isNull())
            {
                return existing;
            }
            return userRepository_.createPhoneUser(phone);
        }

        return userRepository_.bindPhone(userId, phone);
    }

  private:
    static std::string generateCode()
    {
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<int> dist(100000, 999999);
        return std::to_string(dist(gen));
    }

    static void validatePhoneFormat(const std::string &phone)
    {
        if (phone.size() < 8 || phone.size() > 15)
        {
            throw common::AppException("INVALID_PHONE", "Invalid phone number format", drogon::k422UnprocessableEntity);
        }
        for (const char c : phone)
        {
            if (c != '+' && (c < '0' || c > '9'))
            {
                throw common::AppException("INVALID_PHONE", "Invalid phone number format", drogon::k422UnprocessableEntity);
            }
        }
    }

    struct PendingCode
    {
        std::string code;
        std::chrono::system_clock::time_point sentAt;
        std::chrono::system_clock::time_point expiresAt;
    };

    infrastructure::storage::UserRepository &userRepository_;
    SmsService &smsService_;
    std::unordered_map<std::string, PendingCode> pending_;
    std::mutex mutex_;
};
}  // namespace application::services
