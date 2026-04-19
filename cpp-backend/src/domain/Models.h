#pragma once

#include <string>

#include <json/json.h>

namespace domain
{
struct ExamSummary
{
    std::string id;
    std::string title;
    int questionCount{0};
    std::string level;
    std::string year;
    std::string session;
    std::string display;
    bool checked{false};
    std::string accessLevel{"free"};  // "free" | "premium"

    Json::Value toJson() const
    {
        Json::Value value(Json::objectValue);
        value["id"] = id;
        value["title"] = title;
        value["questionCount"] = questionCount;
        value["level"] = level;
        value["year"] = year;
        value["session"] = session;
        value["display"] = display;
        value["checked"] = checked;
        value["access_level"] = accessLevel;
        return value;
    }
};
}  // namespace domain
