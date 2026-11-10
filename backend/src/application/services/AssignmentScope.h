#pragma once

#include <algorithm>
#include <cctype>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <json/json.h>
#include <drogon/HttpTypes.h>
#include "common/AppException.h"

namespace application::services
{
inline bool assignmentTargetsStudent(const Json::Value &assignment, const std::string &studentId)
{
    if (!assignment["target_student_ids"].isArray()) return true;
    for (const auto &id : assignment["target_student_ids"]) if (id.isString() && id.asString() == studentId) return true;
    return false;
}
// Public ranges use the paper's display order. Stored identities always include
// the section: local question numbers are reused by listening/reading groups.
inline Json::Value resolveAssignmentQuestionKeys(const Json::Value &exam, const Json::Value &assignment)
{
    std::vector<std::string> ordered;
    std::unordered_map<std::string, std::vector<std::string>> localIds;
    const auto &sections = exam["exam_info"]["sections"];
    for (Json::ArrayIndex si = 0; si < sections.size(); ++si)
    {
        const auto append = [&](const Json::Value &questions) {
            for (const auto &question : questions)
            {
                const auto id = question.get("id", "").asString();
                if (id.empty()) continue;
                const auto key = std::to_string(si) + ":" + id;
                ordered.push_back(key);
                localIds[id].push_back(key);
            }
        };
        if (!sections[si]["questions"].empty()) append(sections[si]["questions"]);
        else for (const auto &passage : sections[si]["passages"]) append(passage["questions"]);
    }
    auto invalid = [](const std::string &message) {
        throw common::AppException("VALIDATION_ERROR", message, drogon::k422UnprocessableEntity);
    };
    if (ordered.empty()) invalid("该试卷没有可布置的题目");
    std::unordered_set<std::string> selected;
    const auto ids = assignment.get("question_ids", Json::Value(Json::arrayValue));
    if (!ids.isArray()) invalid("题目范围格式不正确");
    if (!ids.empty())
    {
        const std::unordered_set<std::string> available(ordered.begin(), ordered.end());
        for (const auto &id : ids)
        {
            if (!id.isString()) invalid("题目标识必须是字符串");
            auto key = id.asString();
            if (!available.contains(key))
            {
                const auto found = localIds.find(key);
                if (found == localIds.end()) invalid("指定题目不存在，请重新选择题目范围");
                if (found->second.size() != 1) invalid("题号在多个题组中重复，请重新选择包含题组的题目范围");
                key = found->second.front();
            }
            selected.insert(key);
        }
    }
    else
    {
        for (const auto *field : {"question_start", "question_end"})
            if (assignment.isMember(field) && (!assignment[field].isIntegral() || assignment[field].asInt() < 0))
                invalid("题号范围必须为正整数");
        const int start = assignment.get("question_start", 0).asInt();
        const int end = assignment.get("question_end", 0).asInt();
        const int first = start > 0 ? start : 1;
        const int last = end > 0 ? end : static_cast<int>(ordered.size());
        if (last < first || first > static_cast<int>(ordered.size()) || last > static_cast<int>(ordered.size()))
            invalid("题号范围超出试卷题目数量");
        for (int i = first - 1; i < last; ++i) selected.insert(ordered[i]);
    }
    Json::Value result(Json::arrayValue);
    for (const auto &key : ordered) if (selected.contains(key)) result.append(key);
    return result;
}

// Early prep plans stored only the first N matching questions, with local IDs.
// Replay that original selection and verify every saved identity before using it.
// Modern plans already contain canonical keys and do not need this recovery.
inline Json::Value resolveLessonPrepQuestionKeys(const Json::Value &exam, const Json::Value &plan)
{
    if (plan["question_ids"].isArray() && !plan["question_ids"].empty())
        return resolveAssignmentQuestionKeys(exam, plan);
    const auto saved = plan.get("question_set", Json::Value(Json::arrayValue));
    const auto invalid = []() {
        throw common::AppException("VALIDATION_ERROR", "原备课题目无法完整匹配，请重新选择题目范围后保存", drogon::k422UnprocessableEntity);
    };
    if (!saved.isArray() || saved.empty()) invalid();
    Json::Value scope(Json::objectValue);
    scope["question_ids"] = Json::Value(Json::arrayValue);
    bool canonical = true;
    for (const auto &item : saved)
    {
        auto id = item.get("question_id", "").asString();
        if (id.find(':') == std::string::npos && item["section_index"].isIntegral())
            id = std::to_string(item["section_index"].asInt()) + ":" + item.get("local_question_id", id).asString();
        if (id.find(':') == std::string::npos) canonical = false;
        scope["question_ids"].append(id);
    }
    if (canonical) return resolveAssignmentQuestionKeys(exam, scope);

    auto focus = plan.get("focus_keyword", plan.get("focus_type", "")).asString();
    std::transform(focus.begin(), focus.end(), focus.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    scope["question_ids"] = Json::Value(Json::arrayValue);
    const auto &sections = exam["exam_info"]["sections"];
    Json::ArrayIndex index = 0;
    for (Json::ArrayIndex si = 0; si < sections.size(); ++si)
    {
        const auto &section = sections[si];
        auto questions = section.get("questions", Json::Value(Json::arrayValue));
        if (questions.empty())
            for (const auto &passage : section["passages"])
                for (const auto &question : passage["questions"]) questions.append(question);
        for (const auto &question : questions)
        {
            if (index >= saved.size()) break;
            const auto id = question.get("id", question.get("question_id", "")).asString();
            auto haystack = section.get("name", section.get("type", "")).asString() + " " +
                section.get("section_type", "").asString() + " " + question.get("type", section.get("type", "")).asString() + " " + id;
            std::transform(haystack.begin(), haystack.end(), haystack.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (!focus.empty() && haystack.find(focus) == std::string::npos) continue;
            const auto &item = saved[index];
            if (item.get("question_id", "").asString() != id) invalid();
            if (!item.get("section", "").asString().empty() && item["section"].asString() != section.get("name", section.get("type", "")).asString()) invalid();
            if (!item.get("type", "").asString().empty() && item["type"] != question.get("type", section.get("type", ""))) invalid();
            if (!item.get("question_number", "").asString().empty() && item["question_number"].asString() != question.get("question_number", question.get("number", "")).asString()) invalid();
            scope["question_ids"].append(std::to_string(si) + ":" + id);
            ++index;
        }
    }
    if (index != saved.size()) invalid();
    return resolveAssignmentQuestionKeys(exam, scope);
}
}
