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
    std::string family{"jlpt"};
    std::string subject{"japanese"};
    std::string paperType{"mock_exam"};
    std::string level;
    std::string year;
    std::string session;
    std::string display;
    bool checked{false};
    std::string accessLevel{"free"};  // "free" | "premium"
    std::vector<std::string> skills;
    Json::Value capabilities{Json::objectValue};

    Json::Value toJson() const
    {
        Json::Value value(Json::objectValue);
        value["id"] = id;
        value["title"] = title;
        value["questionCount"] = questionCount;
        value["family"] = family;
        value["subject"] = subject;
        value["paper_type"] = paperType;
        value["level"] = level;
        value["year"] = year;
        value["session"] = session;
        value["display"] = display;
        value["checked"] = checked;
        value["access_level"] = accessLevel;
        Json::Value skillArray(Json::arrayValue);
        for (const auto &skill : skills)
        {
            skillArray.append(skill);
        }
        value["skills"] = skillArray;
        value["capabilities"] = capabilities.isObject() ? capabilities : Json::Value(Json::objectValue);
        return value;
    }
};
}  // namespace domain
