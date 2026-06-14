#pragma once

#include <filesystem>
#include <string>

#include <json/json.h>

#include "application/services/SubscriptionService.h"
#include "infrastructure/storage/ProfileRepository.h"

namespace application::services
{
class RedeemService
{
  public:
    RedeemService(std::filesystem::path systemDir,
                  infrastructure::storage::ProfileRepository &profileRepository,
                  SubscriptionService &subscriptionService);

    Json::Value walletForUser(const std::string &userId) const;

    Json::Value redeemCode(const std::string &userId, const std::string &rawCode);

  private:
    Json::Value loadCatalog() const;
    Json::Value findCode(const std::string &normalizedCode) const;
    Json::Value buildWalletView(const std::string &userId, const Json::Value &profile) const;
    Json::Value buildRedemptionRecord(const Json::Value &codeEntry,
                                       const std::string &normalizedCode,
                                       const Json::Value &effect) const;

    static std::string normalizeCode(const std::string &raw);
    static std::string readCodeKind(const Json::Value &entry);
    static bool isCodeEnabled(const Json::Value &entry);
    static bool isExpired(const Json::Value &entry);
    static std::string nextExpiryDate(const std::string &currentExpiresAt, int days);
    static std::string effectSummary(const Json::Value &entry, const Json::Value &effect);

    std::filesystem::path catalogFile_;
    infrastructure::storage::ProfileRepository &profileRepository_;
    SubscriptionService &subscriptionService_;
};
}  // namespace application::services
