#include <algorithm>
#include <string>
#include <unordered_set>
#include <vector>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
void closePracticeDraft(const AppContext &ctx, const std::string &userId, const std::string &id)
{
    if (!ctx.draftService || id.empty()) return;
    ctx.draftService->markSubmitted(userId + "__practice", id, id);
    ctx.draftService->clear(userId + "__practice", id, id);
}
Json::Value recentItemFromScore(const std::string &userId, const std::string &examId, const Json::Value &score)
{
    Json::Value item(Json::objectValue);
    item["user_id"] = userId;
    item["exam_id"] = examId;
    item["status"] = "submitted";
    item["total_questions"] = score.get("total_questions", 0);
    item["answered_count"] = score.get("total_questions", 0).asInt() - score.get("unanswered_count", 0).asInt();
    item["correct_count"] = score.get("correct_count", 0);
    item["wrong_count"] = score.get("wrong_count", 0);
    item["score"] = score.get("score", 0.0);
    item["completion"] = score.get("completion", 0.0);
    return item;
}

void recordLearningResult(const AppContext &ctx, const std::string &userId, const std::string &examId,
                          const Json::Value &exam, const Json::Value &score)
{
    auto independent = score;
    independent["results"] = Json::Value(Json::objectValue);
    int correct = 0, wrong = 0;
    for (const auto &key : score["results"].getMemberNames()) {
        const auto &row = score["results"][key];
        const auto status = row.get("status", "").asString();
        if (row.get("viewed", false).asBool() || (status != "correct" && status != "wrong")) continue;
        independent["results"][key] = row;
        status == "correct" ? ++correct : ++wrong;
    }
    if (!correct && !wrong) return;
    independent["total_questions"] = correct + wrong;
    independent["correct_count"] = correct;
    independent["wrong_count"] = wrong;
    independent["unanswered_count"] = 0;
    const auto enabled = [&](const std::string &feature) { return !ctx.featureFlagService || ctx.featureFlagService->isEnabled(feature, userId); };
    if (ctx.wrongQuestionService && enabled("wrong_questions")) {
        try { ctx.wrongQuestionService->recordFromScore(userId, examId, exam, independent); } catch (...) { }
    }
    if (ctx.srsService && enabled("srs")) {
        try { ctx.srsService->ingestWrongFromScore(userId, examId, exam, independent); } catch (...) { }
    }
    if (ctx.streakService && enabled("streak")) {
        try { ctx.streakService->recordActivity(userId, correct + wrong, correct); } catch (...) { }
    }
    if (ctx.adaptiveLearningService) {
        try { ctx.adaptiveLearningService->recordSubmission(userId, examId, exam, independent); } catch (...) { }
    }
}
}  // namespace

void registerAnswerRoutes(const AppContext &ctx)
{
    app().registerHandler("/api/v1/answers/specialty-session",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                const auto body = parseJsonBody(req);
                const auto label = requireBoundedString(body, "label", 1, 100);
                const auto submission = requireBoundedString(body, "submission_id", 1, 100);
                const auto &rows = body["questions"];
                if (!rows.isArray() || rows.empty() || rows.size() > 1000)
                    throw common::AppException("VALIDATION_ERROR", "Invalid specialty session", k422UnprocessableEntity);
                Json::Value stats(Json::objectValue), results(Json::arrayValue), answers(Json::objectValue), mastery(Json::objectValue);
                const auto previous = ctx.answerService->attempts(userId, "__specialty", 1);
                if (!previous.empty()) mastery = previous[0]["statistics"].get("mastery_results", mastery);
                std::unordered_set<std::string> seen;
                Json::Value learningScores(Json::objectValue);
                int correct = 0, wrong = 0, viewed = 0;
                for (const auto &row : rows)
                {
                    const auto examId = requireBoundedString(row, "exam_id", 1, 100);
                    const auto questionId = requireBoundedString(row, "question_id", 1, 100);
                    const bool hasSection = row.isMember("section_index");
                    if (hasSection && (!row["section_index"].isInt() || row["section_index"].asInt() < 0))
                        throw common::AppException("VALIDATION_ERROR", "Invalid specialty section", k422UnprocessableEntity);
                    auto exam = ctx.examService->getExam(examId);
                    auto &sections = exam["exam_info"]["sections"];
                    Json::Value question;
                    int foundSection = -1;
                    for (Json::ArrayIndex s = 0; s < sections.size() && foundSection < 0; ++s)
                    {
                        if (hasSection && static_cast<int>(s) != row["section_index"].asInt()) continue;
                        const auto find = [&](const Json::Value &questions) {
                            for (const auto &q : questions) if (q.get("id", "").asString() == questionId) { question = q; foundSection = static_cast<int>(s); break; }
                        };
                        find(sections[s]["questions"]);
                        if (foundSection < 0) for (const auto &passage : sections[s]["passages"]) { find(passage["questions"]); if (foundSection >= 0) break; }
                    }
                    if (foundSection < 0) throw common::AppException("NOT_FOUND", "Specialty question unavailable", k404NotFound);
                    const auto key = examId + ":" + std::to_string(foundSection) + ":" + questionId;
                    if (!seen.insert(key).second) throw common::AppException("VALIDATION_ERROR", "Duplicate specialty question", k422UnprocessableEntity);
                    Json::Value result(Json::objectValue);
                    result["exam_id"] = examId; result["question_id"] = questionId; result["answer"] = row["answer"];
                    result["section_index"] = foundSection;
                    result["viewed"] = row.get("viewed", false).asBool();
                    if (result["viewed"].asBool()) { result["status"] = "viewed"; ++viewed; }
                    else {
                        for (auto &section : sections) { section["questions"] = Json::arrayValue; section["passages"] = Json::arrayValue; }
                        sections[foundSection]["questions"].append(question);
                        Json::Value selected(Json::objectValue); selected[questionId] = row["answer"];
                        const auto score = ctx.answerService->calculateScore(examId, selected, exam);
                        for (const auto &scoreKey : score["results"].getMemberNames()) learningScores[examId]["results"][scoreKey] = score["results"][scoreKey];
                        const auto status = score.get("correct_count", 0).asInt() ? "correct" : score.get("wrong_count", 0).asInt() ? "wrong" : "ungraded";
                        result["status"] = status;
                        if (std::string(status) == "correct") ++correct;
                        if (std::string(status) == "wrong") ++wrong;
                        if (std::string(status) != "ungraded") {
                            const auto legacyKey = examId + ":" + questionId;
                            if (mastery.isMember(legacyKey) && mastery[legacyKey].get("section_index", -1).asInt() == foundSection) mastery.removeMember(legacyKey);
                            mastery[key] = result;
                        }
                    }
                    answers[key] = row["answer"];
                    results.append(result);
                }
                stats["exam_mode"] = "specialty"; stats["practice_label"] = label;
                stats["total_questions"] = static_cast<int>(rows.size()); stats["correct_count"] = correct; stats["wrong_count"] = wrong;
                stats["viewed_count"] = viewed; stats["accuracy"] = correct + wrong ? 100.0 * correct / (correct + wrong) : 0.0;
                stats["session_questions"] = results; stats["mastery_results"] = mastery;
                stats["learning_origin"] = body.get("learning_origin", "free").asString() == "system" ? "system" : "free";
                const auto saved = ctx.answerService->save(userId, "__specialty", answers, stats, "specialty-" + submission);
                closePracticeDraft(ctx, userId, submission);
                if (!saved.get("idempotent_replay", false).asBool()) for (const auto &id : learningScores.getMemberNames())
                    recordLearningResult(ctx, userId, id, ctx.examService->getExam(id), learningScores[id]);
                if (ctx.recentLearningRepository && !saved.get("idempotent_replay", false).asBool()) {
                    auto item = recentItemFromScore(userId, "__specialty", stats);
                    item["source"] = "specialty"; item["exam_title"] = label + " · 专项练习";
                    item["practice_label"] = label;
                    item["learning_origin"] = stats["learning_origin"];
                    ctx.recentLearningRepository->upsert(userId, item);
                }
                return common::ok(req, saved);
            });
        }, {Post});
    app().registerHandler("/api/v1/answers/practice-group",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                const auto body = parseJsonBody(req);
                const auto examId = requireBoundedString(body, "exam_id", 1, 100);
                const auto label = requireBoundedString(body, "label", 1, 80);
                const auto submissionId = requireBoundedString(body, "submission_id", 1, 100);
                const auto indexes = body["section_indexes"];
                const auto answers = body["answers"];
                auto exam = ctx.examService->getExam(examId);
                auto &sections = exam["exam_info"]["sections"];
                if (!sections.isArray() || !indexes.isArray() || indexes.empty() || indexes.size() > sections.size()
                    || !answers.isObject() || answers.size() > 1000)
                    throw common::AppException("VALIDATION_ERROR", "Invalid practice group", k422UnprocessableEntity);
                std::vector<bool> selected(sections.size(), false);
                for (const auto &value : indexes)
                {
                    if (!value.isInt() && !value.isUInt())
                        throw common::AppException("VALIDATION_ERROR", "Invalid section index", k422UnprocessableEntity);
                    const auto index = value.asInt();
                    if (index < 0 || index >= static_cast<int>(sections.size()) || selected[index])
                        throw common::AppException("VALIDATION_ERROR", "Invalid section index", k422UnprocessableEntity);
                    selected[index] = true;
                }
                for (Json::ArrayIndex index = 0; index < sections.size(); ++index)
                {
                    if (selected[index]) continue;
                    sections[index]["questions"] = Json::arrayValue;
                    sections[index]["passages"] = Json::arrayValue;
                }
                auto score = ctx.answerService->calculateScore(examId, answers, exam);
                int practiceTotal = 0;
                int practiceAnswered = 0;
                std::unordered_set<std::string> counted;
                for (Json::ArrayIndex index = 0; index < sections.size(); ++index)
                {
                    if (!selected[index]) continue;
                    const auto countQuestion = [&](const Json::Value &question) {
                        const auto questionId = question.get("id", "").asString();
                        const auto key = std::to_string(index) + ":" + questionId;
                        if (questionId.empty() || !counted.insert(key).second) return;
                        ++practiceTotal;
                        const auto answer = answers.isMember(key) ? answers[key] : answers[questionId];
                        if (!answer.isNull() && (!answer.isString() || !answer.asString().empty())
                            && (!answer.isArray() || !answer.empty())) ++practiceAnswered;
                    };
                    for (const auto &question : sections[index]["questions"]) countQuestion(question);
                    for (const auto &passage : sections[index]["passages"])
                        for (const auto &question : passage["questions"]) countQuestion(question);
                }
                score["exam_mode"] = "practice_group";
                score["practice_label"] = label;
                score["section_indexes"] = indexes;
                score["practice_total_questions"] = practiceTotal;
                score["practice_answered_count"] = practiceAnswered;
                const auto saved = ctx.answerService->save(userId, examId + "__practice", answers, score, "practice-" + submissionId);
                closePracticeDraft(ctx, userId, submissionId);
                if (!saved.get("idempotent_replay", false).asBool()) recordLearningResult(ctx, userId, examId, exam, score);
                if (ctx.recentLearningRepository != nullptr && !saved.get("idempotent_replay", false).asBool())
                {
                    auto item = recentItemFromScore(userId, examId, score);
                    item["source"] = "practice_group";
                    item["practice_label"] = label;
                    item["exam_title"] = exam["exam_info"].get("title", examId).asString();
                    item["total_questions"] = practiceTotal;
                    item["answered_count"] = practiceAnswered;
                    ctx.recentLearningRepository->upsert(userId, item);
                }
                return common::ok(req, saved);
            });
        }, {Post});

    // An experience is a single practice record, not a submitted full paper or diagnostic.
    app().registerHandler("/api/v1/me/experience",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                const auto body = parseJsonBody(req);
                const auto questionId = readBoundedIntField(body, "question_id", 0, 59, 62);
                const auto answer = readBoundedIntField(body, "answer", 0, 1, 4);
                const auto submission = requireBoundedString(body, "submission_id", 1, 100);
                if (questionId != 59 && questionId != 62)
                    throw common::AppException("VALIDATION_ERROR", "Invalid experience question", k422UnprocessableEntity);
                const std::string examId = "N3_2010_07";
                auto exam = ctx.examService->getExam(examId);
                Json::Value selected(Json::arrayValue);
                for (const auto &passage : exam["exam_info"]["sections"][8]["passages"])
                    for (const auto &question : passage["questions"])
                        if (question.get("id", 0).asInt() == questionId) selected.append(question);
                if (selected.empty())
                    throw common::AppException("NOT_FOUND", "Experience question unavailable", k404NotFound);
                // Preserve the original section index while scoring only the selected question.
                exam["exam_info"]["sections"] = Json::Value(Json::arrayValue);
                for (int i = 0; i < 9; ++i) exam["exam_info"]["sections"].append(Json::Value(Json::objectValue));
                exam["exam_info"]["sections"][8]["questions"] = selected;
                Json::Value answers(Json::objectValue);
                answers[std::to_string(questionId)] = answer;
                auto score = ctx.answerService->calculateScore(examId, answers, exam);
                score["exam_mode"] = "experience";
                const auto saved = ctx.answerService->save(userId, examId, answers, score, "experience-" + submission);
                if (ctx.recentLearningRepository != nullptr && !saved.get("idempotent_replay", false).asBool())
                {
                    auto item = recentItemFromScore(userId, examId, score);
                    item["exam_title"] = "JLPT N3 · 短篇阅读体验";
                    item["source"] = "experience";
                    ctx.recentLearningRepository->upsert(userId, item);
                }
                return common::ok(req, saved);
            });
        }, {Post});
    app().registerHandler(
        "/api/v1/answers/submit",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                auto userId = body.get("user_id", "guest").asString();
                const auto examId = requireString(body, "exam_id");
                const auto answers = body.get("answers", Json::Value(Json::objectValue));
                const auto submissionId = body.get("submission_id", "").asString();
                const auto attemptId = body.get("attempt_id", "").asString();
                const auto exam = ctx.examService->getExam(examId);
                auto score = ctx.answerService->calculateScore(examId, answers, exam);
                const bool diagnostic = exam["exam_info"].get("paper_type", exam.get("paper_type", "")).asString() == "diagnostic";
                if (diagnostic) {
                    int total = 0, answered = 0, sectionIndex = 0;
                    std::unordered_set<std::string> counted;
                    for (const auto &section : exam["exam_info"]["sections"]) {
                        const auto count = [&](const Json::Value &questions) {
                            for (const auto &question : questions) {
                                const auto id = question.get("id", "").asString();
                                const auto key = std::to_string(sectionIndex) + ":" + id;
                                if (id.empty() || !counted.insert(key).second) continue;
                                ++total;
                                const auto &answer = answers.isMember(key) ? answers[key] : answers[id];
                                if (!answer.isNull() && (!answer.isString() || !answer.asString().empty()) && (!answer.isArray() || !answer.empty())) ++answered;
                            }
                        };
                        count(section["questions"]);
                        for (const auto &passage : section["passages"]) count(passage["questions"]);
                        ++sectionIndex;
                    }
                    if (!total || answered < total) throw common::AppException("DIAGNOSTIC_INCOMPLETE", "请完成全部诊断题目后提交；未完成的答案可保存后继续", k422UnprocessableEntity);
                    score["diagnostic_answered_count"] = answered;
                    score["diagnostic_total_questions"] = total;
                }
                if (userId == "guest" && readToken(req, &body).empty()) return common::ok(req, score);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto sessionUserId = session.get("user_id", session.get("id", "")).asString();
                if (userId.empty() || userId == "guest") userId = sessionUserId;
                requireDataOwnerOrAdmin(session, userId, "只能提交当前登录账号的答案");
                score["exam_mode"] = diagnostic ? "mock" : body.get("exam_mode", "practice").asString();
                if (ctx.attemptTimerService != nullptr)
                {
                    const auto timer = ctx.attemptTimerService->get(userId);
                    if (timer.isObject() && timer.get("exam_id", "").asString() == examId)
                    {
                        score["elapsed_seconds"] = timer.get("elapsed_seconds", 0);
                    }
                }
                const auto savedAttempt = ctx.answerService->save(userId, examId, answers, score, submissionId, attemptId);
                if (savedAttempt.get("idempotent_replay", false).asBool())
                {
                    auto replayScore = savedAttempt.get("statistics", score);
                    replayScore["idempotent_replay"] = true;
                    replayScore["attempt_id"] = attemptId;
                    replayScore["attempt_status"] = "submitted";
                    return common::ok(req, replayScore);
                }
                if (ctx.recentLearningRepository != nullptr)
                {
                    ctx.recentLearningRepository->upsert(userId, recentItemFromScore(userId, examId, score));
                }
                recordLearningResult(ctx, userId, examId, exam, score);
                // 业务功能 4：提交后清除该用户的草稿（容错；仅在同一试卷时才清）
                if (ctx.draftService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("resume_draft", userId)))
                {
                    try
                    {
                        ctx.draftService->markSubmitted(userId, examId, attemptId);
                        ctx.draftService->clear(userId, examId, attemptId);
                    }
                    catch (...)
                    {
                        // 草稿清除异常不应阻断答题提交
                    }
                }
                // 业务功能 3：提交后清除答题计时（仅在同一试卷时才清）
                if (ctx.attemptTimerService != nullptr
                    && (ctx.featureFlagService == nullptr
                        || ctx.featureFlagService->isEnabled("exam_timer", userId)))
                {
                    try
                    {
                        const auto current = ctx.attemptTimerService->get(userId);
                        if (current.isObject() && current.get("exam_id", "").asString() == examId)
                        {
                            ctx.attemptTimerService->clear(userId);
                        }
                    }
                    catch (...)
                    {
                        // 计时清理异常不应阻断答题提交
                    }
                }
                auto submittedScore = score;
                submittedScore["attempt_id"] = attemptId;
                submittedScore["attempt_status"] = "submitted";
                return common::ok(req, submittedScore);
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/answers/{1}/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                Json::Value out(Json::objectValue);
                out["answers"] = ctx.answerService->load(userId, examId);
                return common::ok(req, out);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/answers/{1}/{2}/attempts",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId,
              std::string examId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                const int limit = readBoundedIntParameter(req, "limit", 20, 1, 50);
                return common::ok(req, ctx.answerService->attempts(userId, examId, limit));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/progress/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                return common::ok(req, ctx.answerService->progress(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/progress/{1}/exams",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireDataOwnerOrAdmin(session, userId);
                return common::ok(req, ctx.answerService->examProgress(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
