#pragma once

#include <string>

namespace application::services
{
// Abstract SMS sending interface.
// In production, replace with an Aliyun/Tencent SMS implementation.
// In development/test, the stub logs the code and always succeeds.
class SmsService
{
  public:
    virtual ~SmsService() = default;

    // Send a 6-digit verification code to the given phone number.
    // Returns true on success.
    virtual bool sendCode(const std::string &phone, const std::string &code) = 0;
};

// ----- Stub (always succeeds, prints to stdout) -----
class StubSmsService : public SmsService
{
  public:
    bool sendCode(const std::string &phone, const std::string &code) override
    {
        // In development: print to stdout so the developer can read it.
        // Replace this class with a real HTTP call to your SMS provider.
        std::printf("[SMS-STUB] Send code %s to %s\n", code.c_str(), phone.c_str());
        return true;
    }
};
}  // namespace application::services
