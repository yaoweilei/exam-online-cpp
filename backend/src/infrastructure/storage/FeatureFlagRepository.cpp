#include "FeatureFlagRepository.h"

#include "JsonIo.h"

namespace infrastructure::storage
{

FeatureFlagRepository::FeatureFlagRepository(std::filesystem::path systemDir,
                                             OrganizationRepository &orgRepo,
                                             ProfileRepository &profileRepo)
    : systemDir_(std::move(systemDir)), orgRepo_(orgRepo), profileRepo_(profileRepo)
{
    std::filesystem::create_directories(systemDir_);
}

Json::Value FeatureFlagRepository::loadSystemFlags() const
{
    const auto path = systemDir_ / "feature_flags.json";
    std::shared_lock lock(mutex_);
    if (!std::filesystem::exists(path))
    {
        return Json::Value(Json::objectValue);
    }
    auto doc = readJsonFile(path);
    if (!doc.isObject())
    {
        return Json::Value(Json::objectValue);
    }
    if (doc.isMember("flags") && doc["flags"].isObject())
    {
        return doc["flags"];
    }
    return Json::Value(Json::objectValue);
}

void FeatureFlagRepository::saveSystemFlags(const Json::Value &flags)
{
    const auto path = systemDir_ / "feature_flags.json";
    std::unique_lock lock(mutex_);
    Json::Value doc(Json::objectValue);
    doc["flags"] = flags.isObject() ? flags : Json::Value(Json::objectValue);
    writeJsonFileAtomic(path, doc);
}

Json::Value FeatureFlagRepository::loadOrgFlags(const std::string &orgId) const
{
    auto org = orgRepo_.findOrganization(orgId);
    if (!org.isObject() || !org.isMember("feature_flags") || !org["feature_flags"].isObject())
    {
        return Json::Value(Json::objectValue);
    }
    return org["feature_flags"];
}

void FeatureFlagRepository::saveOrgFlags(const std::string &orgId, const Json::Value &flags)
{
    auto org = orgRepo_.findOrganization(orgId);
    if (!org.isObject())
    {
        return;
    }
    org["feature_flags"] = flags.isObject() ? flags : Json::Value(Json::objectValue);
    orgRepo_.upsertOrganization(org);
}

Json::Value FeatureFlagRepository::loadUserFlags(const std::string &userId) const
{
    auto profile = profileRepo_.loadProfile(userId);
    if (!profile.isObject() || !profile.isMember("feature_flags") || !profile["feature_flags"].isObject())
    {
        return Json::Value(Json::objectValue);
    }
    return profile["feature_flags"];
}

void FeatureFlagRepository::saveUserFlags(const std::string &userId, const Json::Value &flags)
{
    auto profile = profileRepo_.loadProfile(userId);
    if (!profile.isObject())
    {
        profile = Json::Value(Json::objectValue);
    }
    profile["feature_flags"] = flags.isObject() ? flags : Json::Value(Json::objectValue);
    profileRepo_.saveProfile(userId, profile);
}

}  // namespace infrastructure::storage
