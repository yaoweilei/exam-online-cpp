#pragma once

#include <stdexcept>
#include <string>

#include <drogon/HttpTypes.h>

namespace common
{
class AppException : public std::runtime_error
{
  public:
    AppException(std::string code,
                 std::string message,
                 drogon::HttpStatusCode statusCode = drogon::k500InternalServerError)
        : std::runtime_error(message),
          code_(std::move(code)),
          message_(what()),
          statusCode_(statusCode)
    {
    }

    const std::string &code() const noexcept
    {
        return code_;
    }

    const std::string &message() const noexcept
    {
        return message_;
    }

    drogon::HttpStatusCode statusCode() const noexcept
    {
        return statusCode_;
    }

  private:
    std::string code_;
    std::string message_;
    drogon::HttpStatusCode statusCode_;
};
}  // namespace common
