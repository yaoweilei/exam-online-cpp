#include "application/services/AdaptiveLearningService.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <vector>

#include "common/TimeUtils.h"
#include "infrastructure/storage/JsonIo.h"

namespace application::services
{
namespace
{
struct QuestionMeta
{
    std::string domain;
    std::vector<std::pair<std::string, std::string>> knowledge;
};

std::string scalarString(const Json::Value &value)
{
    if (value.isString()) return value.asString();
    if (value.isIntegral()) return std::to_string(value.asInt64());
    return {};
}

std::vector<std::string> strings(const Json::Value &node, const char *key)
{
    std::vector<std::string> out;
    if (!node[key].isArray()) return out;
    for (const auto &item : node[key])
    {
        if (item.isString() && !item.asString().empty()) out.push_back(item.asString());
    }
    return out;
}

std::string domainFrom(const Json::Value &section, const Json::Value &question)
{
    const auto explicitDomain = section.get("diagnostic_domain", "").asString();
    if (!explicitDomain.empty()) return explicitDomain;
    auto tags = strings(question, "skill_tags");
    const auto sectionTags = strings(section, "skill_tags");
    tags.insert(tags.end(), sectionTags.begin(), sectionTags.end());
    for (const auto &tag : tags)
    {
        if (tag.rfind("eju.writing", 0) == 0) return "writing";
        if (tag.rfind("eju.listening_reading", 0) == 0) return "listening_reading";
        if (tag.rfind("eju.reading", 0) == 0) return "reading";
        if (tag.rfind("eju.listening", 0) == 0) return "listening";
        if (tag.rfind("grammar", 0) == 0) return "grammar";
        if (tag.rfind("listening", 0) == 0) return "listening";
        if (tag.rfind("reading", 0) == 0) return "reading";
        if (tag.rfind("vocab", 0) == 0) return "vocabulary";
    }
    const auto type = section.get("section_type", "").asString();
    if (type == "writing" || type == "reading" || type == "listening" || type == "listening_reading") return type;
    return "vocabulary";
}

std::string targetFrom(const Json::Value &exam)
{
    const auto &info = exam["exam_info"];
    auto family = info.get("family", "").asString();
    std::transform(family.begin(), family.end(), family.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    if (family == "eju") return "EJU 日本語";
    const auto level = info.get("exam_level", "").asString();
    if (level == "N1" || level == "N2" || level == "N3" || level == "N4" || level == "N5") return "JLPT " + level;
    return {};
}

std::vector<std::string> domainsForTarget(const std::string &target)
{
    if (target == "EJU 日本語") return {"writing", "reading", "listening_reading", "listening"};
    return {"vocabulary", "grammar", "reading", "listening"};
}

QuestionMeta metaFor(const Json::Value &section, const Json::Value &question)
{
    QuestionMeta meta;
    meta.domain = domainFrom(section, question);
    if (meta.domain == "vocabulary")
    {
        for (const auto &word : strings(question, "target_words"))
            meta.knowledge.emplace_back("vocab.word:" + word, word);
    }
    for (const auto &tag : strings(question, "skill_tags"))
        meta.knowledge.emplace_back(tag, tag);
    if (meta.knowledge.empty())
    {
        for (const auto &tag : strings(section, "skill_tags"))
            meta.knowledge.emplace_back(tag, tag);
    }
    if (meta.knowledge.empty())
    {
        const auto sectionId = section.get("section_id", "general").asString();
        meta.knowledge.emplace_back(meta.domain + ":" + sectionId, section.get("section_name", sectionId).asString());
    }
    std::sort(meta.knowledge.begin(), meta.knowledge.end());
    meta.knowledge.erase(std::unique(meta.knowledge.begin(), meta.knowledge.end()), meta.knowledge.end());
    return meta;
}

double round1(double value)
{
    return std::round(value * 10.0) / 10.0;
}
}  // namespace

AdaptiveLearningService::AdaptiveLearningService(std::filesystem::path userRootDir)
    : rootDir_(std::move(userRootDir) / "adaptive_learning")
{
    std::error_code ec;
    std::filesystem::create_directories(rootDir_, ec);
}

std::string AdaptiveLearningService::sanitize(const std::string &value)
{
    std::string out;
    for (const unsigned char ch : value)
        out.push_back(std::isalnum(ch) || ch == '-' || ch == '_' ? static_cast<char>(ch) : '_');
    return out;
}

std::filesystem::path AdaptiveLearningService::fileFor(const std::string &userId) const
{
    return rootDir_ / (sanitize(userId) + ".json");
}

void AdaptiveLearningService::appendObservation(Json::Value &observations, const Json::Value &observation)
{
    if (!observations.isArray()) observations = Json::Value(Json::arrayValue);
    observations.append(observation);
    constexpr Json::ArrayIndex maxItems = 80;
    while (observations.size() > maxItems)
    {
        Json::Value trimmed(Json::arrayValue);
        for (Json::ArrayIndex i = observations.size() - maxItems; i < observations.size(); ++i)
            trimmed.append(observations[i]);
        observations = std::move(trimmed);
    }
}

Json::Value AdaptiveLearningService::summarize(const Json::Value &observations)
{
    Json::Value out(Json::objectValue);
    if (!observations.isArray() || observations.empty())
    {
        out["score"] = Json::nullValue;
        out["evidence"] = "unassessed";
        return out;
    }

    int correct = 0;
    std::set<std::string> days;
    std::set<std::string> materials;
    for (const auto &item : observations)
    {
        if (item.get("correct", false).asBool()) ++correct;
        days.insert(item.get("day", "").asString());
        materials.insert(item.get("exam_id", "").asString());
    }
    const int count = static_cast<int>(observations.size());
    const double historical = static_cast<double>(correct) / count;
    const int recentCount = std::min(5, count);
    int recentCorrect = 0;
    for (int i = count - recentCount; i < count; ++i)
        if (observations[static_cast<Json::ArrayIndex>(i)].get("correct", false).asBool()) ++recentCorrect;
    const double recent = static_cast<double>(recentCorrect) / recentCount;

    const auto firstDay = observations[0].get("day", "").asString();
    int delayedCount = 0;
    int delayedCorrect = 0;
    for (const auto &item : observations)
    {
        if (item.get("day", "").asString() == firstDay) continue;
        ++delayedCount;
        if (item.get("correct", false).asBool()) ++delayedCorrect;
    }

    double score = 0.0;
    if (delayedCount > 0)
    {
        const double retention = static_cast<double>(delayedCorrect) / delayedCount;
        score = 100.0 * (0.50 * historical + 0.30 * recent + 0.20 * retention);
        out["retention_score"] = round1(retention * 100.0);
    }
    else
    {
        score = std::min(60.0, 100.0 * ((0.50 * historical + 0.30 * recent) / 0.80));
        out["retention_score"] = Json::nullValue;
    }

    out["score"] = round1(score);
    out["historical_accuracy"] = round1(historical * 100.0);
    out["recent_accuracy"] = round1(recent * 100.0);
    out["observation_count"] = count;
    out["learning_days"] = static_cast<int>(days.size());
    out["material_count"] = static_cast<int>(materials.size());
    out["correct_count"] = correct;
    out["evidence"] = days.size() >= 3 && count >= 8 ? "sufficient" : days.size() >= 2 ? "initial" : "insufficient";
    return out;
}

void AdaptiveLearningService::recordSubmission(const std::string &userId,
                                               const std::string &examId,
                                               const Json::Value &exam,
                                               const Json::Value &score)
{
    const auto target = targetFrom(exam);
    if (target.empty()) return;

    std::map<std::pair<int, std::string>, QuestionMeta> metas;
    int sectionIndex = 0;
    for (const auto &section : exam["exam_info"]["sections"])
    {
        const auto add = [&](const Json::Value &question) {
            const auto id = scalarString(question["id"]);
            if (!id.empty()) metas[{sectionIndex, id}] = metaFor(section, question);
        };
        for (const auto &question : section["questions"]) add(question);
        for (const auto &passage : section["passages"])
            for (const auto &question : passage["questions"]) add(question);
        ++sectionIndex;
    }

    const auto now = common::nowIso8601();
    const auto day = now.size() >= 10 ? now.substr(0, 10) : now;
    std::lock_guard lock(mutex_);
    Json::Value doc(Json::objectValue);
    const auto path = fileFor(userId);
    if (std::filesystem::exists(path))
    {
        try { doc = infrastructure::storage::readJsonFile(path); } catch (...) { doc = Json::Value(Json::objectValue); }
    }
    doc["model_version"] = "mastery-v0.2";
    doc["user_id"] = userId;
    doc["updated_at"] = now;
    if (!doc["tracks"].isObject()) doc["tracks"] = Json::Value(Json::objectValue);
    auto &track = doc["tracks"][target];
    if (target == "JLPT N2" && !track["domains"].isObject() && doc["domains"].isObject()) track["domains"] = doc["domains"];
    if (target == "JLPT N2" && !track["knowledge"].isObject() && doc["knowledge"].isObject()) track["knowledge"] = doc["knowledge"];
    track["exam_target"] = target;
    track["model_version"] = "mastery-v0.2";
    track["updated_at"] = now;
    if (!track["domains"].isObject()) track["domains"] = Json::Value(Json::objectValue);
    if (!track["knowledge"].isObject()) track["knowledge"] = Json::Value(Json::objectValue);

    for (const auto &name : score["results"].getMemberNames())
    {
        const auto &result = score["results"][name];
        const auto questionId = scalarString(result["question_id"]);
        const int index = result.get("section_index", -1).asInt();
        const auto it = metas.find({index, questionId});
        if (it == metas.end()) continue;
        Json::Value observation(Json::objectValue);
        observation["at"] = now;
        observation["day"] = day;
        observation["exam_id"] = examId;
        observation["exam_target"] = target;
        observation["question_id"] = questionId;
        observation["correct"] = result.get("status", "").asString() == "correct";
        observation["answered"] = result.get("status", "").asString() != "unanswered";
        if (!observation["answered"].asBool()) continue;

        auto &domain = track["domains"][it->second.domain];
        appendObservation(domain["observations"], observation);
        domain["summary"] = summarize(domain["observations"]);

        for (const auto &[knowledgeId, title] : it->second.knowledge)
        {
            auto &knowledge = track["knowledge"][knowledgeId];
            knowledge["id"] = knowledgeId;
            knowledge["title"] = title;
            knowledge["domain"] = it->second.domain;
            appendObservation(knowledge["observations"], observation);
            knowledge["summary"] = summarize(knowledge["observations"]);
        }
    }
    if (target == "JLPT N2")
    {
        doc["domains"] = track["domains"];
        doc["knowledge"] = track["knowledge"];
    }
    infrastructure::storage::writeJsonFileAtomic(path, doc);
}

Json::Value AdaptiveLearningService::profile(const std::string &userId, const std::string &examTarget) const
{
    std::lock_guard lock(mutex_);
    Json::Value doc(Json::objectValue);
    const auto path = fileFor(userId);
    if (std::filesystem::exists(path))
    {
        try { doc = infrastructure::storage::readJsonFile(path); } catch (...) { doc = Json::Value(Json::objectValue); }
    }
    const auto target = examTarget.empty() ? std::string("JLPT N2") : examTarget;
    Json::Value track(Json::objectValue);
    if (doc["tracks"].isObject() && doc["tracks"][target].isObject()) track = doc["tracks"][target];
    else if (target == "JLPT N2")
    {
        track["model_version"] = doc.get("model_version", "mastery-v0.1");
        track["updated_at"] = doc.get("updated_at", "");
        track["domains"] = doc["domains"];
        track["knowledge"] = doc["knowledge"];
    }
    Json::Value out(Json::objectValue);
    out["exam_target"] = target;
    out["model_version"] = track.get("model_version", "mastery-v0.2");
    out["updated_at"] = track.get("updated_at", "");
    out["available_targets"] = Json::Value(Json::arrayValue);
    std::set<std::string> availableTargets;
    if (doc["tracks"].isObject())
        for (const auto &name : doc["tracks"].getMemberNames()) availableTargets.insert(name);
    if (doc["domains"].isObject() && !doc["domains"].empty()) availableTargets.insert("JLPT N2");
    for (const auto &name : availableTargets) out["available_targets"].append(name);
    out["domains"] = Json::Value(Json::objectValue);
    for (const auto &domain : domainsForTarget(target))
        out["domains"][domain] = track["domains"][domain].get("summary", summarize(Json::Value(Json::arrayValue)));

    std::vector<Json::Value> knowledge;
    if (track["knowledge"].isObject())
    {
        for (const auto &id : track["knowledge"].getMemberNames())
        {
            auto item = track["knowledge"][id];
            item.removeMember("observations");
            knowledge.push_back(std::move(item));
        }
    }
    std::sort(knowledge.begin(), knowledge.end(), [](const Json::Value &a, const Json::Value &b) {
        const auto scoreA = a["summary"].get("score", 101.0).asDouble();
        const auto scoreB = b["summary"].get("score", 101.0).asDouble();
        return scoreA < scoreB;
    });
    out["weak_knowledge"] = Json::Value(Json::arrayValue);
    for (size_t i = 0; i < knowledge.size() && i < 5; ++i) out["weak_knowledge"].append(knowledge[i]);
    out["daily_minutes"] = 20;
    out["knowledge_target"] = 5;
    out["practice_target"] = 10;
    return out;
}
}  // namespace application::services
