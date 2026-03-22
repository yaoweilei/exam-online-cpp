#pragma once

#include <cmath>
#include <cctype>
#include <string>

#include <json/json.h>

#include "common/TimeUtils.h"
#include "infrastructure/storage/AnswerRepository.h"

namespace application::services
{
class AnswerService
{
  public:
    explicit AnswerService(infrastructure::storage::AnswerRepository &repository) : repository_(repository) {}

    Json::Value calculateScore(const std::string &examId,
                               const Json::Value &answers,
                               const Json::Value &examData) const
    {
        int totalQuestions = 0;
        int correctCount = 0;
        int wrongCount = 0;
        int unansweredCount = 0;
        Json::Value results(Json::objectValue);

        for (const auto &section : examData["exam_info"]["sections"])
        {
            for (const auto &passage : section["passages"])
            {
                for (const auto &question : passage["questions"])
                {
                    const auto questionId = question.get("id", "").asString();
                    if (questionId.empty())
                    {
                        continue;
                    }
                    const auto correctAnswer = normalizeAnswer(question["answer"]);
                    if (correctAnswer.empty())
                    {
                        continue;
                    }
                    ++totalQuestions;

                    const auto userAnswer = normalizeAnswer(answers[questionId]);
                    Json::Value row(Json::objectValue);
                    row["correct_answer"] = correctAnswer;

                    if (userAnswer.empty())
                    {
                        ++unansweredCount;
                        row["status"] = "unanswered";
                    }
                    else if (userAnswer == correctAnswer)
                    {
                        ++correctCount;
                        row["status"] = "correct";
                        row["user_answer"] = userAnswer;
                    }
                    else
                    {
                        ++wrongCount;
                        row["status"] = "wrong";
                        row["user_answer"] = userAnswer;
                    }
                    results[questionId] = row;
                }
            }
        }

        const auto score = totalQuestions > 0 ? static_cast<double>(correctCount) * 100.0 / totalQuestions : 0.0;
        const auto accuracy = (correctCount + wrongCount) > 0
                                  ? static_cast<double>(correctCount) * 100.0 / (correctCount + wrongCount)
                                  : 0.0;
        const auto completion = totalQuestions > 0
                                    ? static_cast<double>(correctCount + wrongCount) * 100.0 / totalQuestions
                                    : 0.0;

        Json::Value output(Json::objectValue);
        output["exam_id"] = examId;
        output["total_questions"] = totalQuestions;
        output["correct_count"] = correctCount;
        output["wrong_count"] = wrongCount;
        output["unanswered_count"] = unansweredCount;
        output["score"] = round2(score);
        output["accuracy"] = round2(accuracy);
        output["completion"] = round2(completion);
        output["results"] = results;
        output["timestamp"] = common::nowIso8601();
        return output;
    }

    void save(const std::string &userId,
              const std::string &examId,
              const Json::Value &answers,
              const Json::Value &statistics)
    {
        repository_.saveAnswer(userId, examId, answers, statistics);
    }

    Json::Value load(const std::string &userId, const std::string &examId) const
    {
        auto payload = repository_.loadAnswer(userId, examId);
        return payload.get("answers", Json::Value(Json::objectValue));
    }

    Json::Value progress(const std::string &userId) const
    {
        const auto all = repository_.listUserAnswers(userId);
        Json::Value out(Json::objectValue);
        out["total_exams"] = static_cast<int>(all.size());
        out["completed_exams"] = static_cast<int>(all.size());
        out["total_questions"] = 0;
        out["correct_answers"] = 0;

        for (const auto &item : all)
        {
            const auto stats = item["statistics"];
            out["total_questions"] = out["total_questions"].asInt() + stats.get("total_questions", 0).asInt();
            out["correct_answers"] = out["correct_answers"].asInt() + stats.get("correct_count", 0).asInt();
        }
        return out;
    }

    Json::Value examProgress(const std::string &userId) const
    {
        const auto all = repository_.listUserAnswers(userId);
        Json::Value progress(Json::objectValue);
        for (const auto &item : all)
        {
            const auto examId = item.get("exam_id", "").asString();
            if (examId.empty())
            {
                continue;
            }
            const auto completion = item["statistics"].get("completion", 0.0).asDouble() / 100.0;
            progress[examId] = completion;
        }
        return progress;
    }

  private:
    static std::string normalizeAnswer(const Json::Value &value)
    {
        if (value.isNull())
        {
            return {};
        }
        std::string text = value.asString();
        for (auto &c : text)
        {
            if (c >= 'A' && c <= 'Z')
            {
                c = static_cast<char>(c - 'A' + 'a');
            }
        }
        while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front())))
        {
            text.erase(text.begin());
        }
        while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back())))
        {
            text.pop_back();
        }
        return text;
    }

    static double round2(double value)
    {
        return std::round(value * 100.0) / 100.0;
    }

  private:
    infrastructure::storage::AnswerRepository &repository_;
};
}  // namespace application::services
