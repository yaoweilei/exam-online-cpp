#pragma once

#include <filesystem>
#include <mutex>
#include <string>

#include <json/json.h>

#include "application/services/SubscriptionService.h"
#include "infrastructure/storage/SqliteJsonStore.h"

namespace application::services
{
class PaymentService
{
  public:
    explicit PaymentService(std::filesystem::path userRootDir,
                            SubscriptionService &subscriptionService);

    Json::Value createOrder(const std::string &userId, const Json::Value &payload);
    Json::Value createOrganizationOrder(const std::string &actorId,
                                        const std::string &organizationId,
                                        const Json::Value &payload);
    Json::Value getOrder(const std::string &userId, const Json::Value &roles, const std::string &orderId) const;
    Json::Value listLedger(const std::string &userId, const Json::Value &roles, const std::string &targetUserId) const;
    Json::Value listOrders(const Json::Value &filters) const;
    Json::Value listRefunds(const Json::Value &filters) const;
    Json::Value listAllLedger(const Json::Value &filters) const;
    Json::Value reconciliation() const;
    Json::Value updateRefundStatus(const std::string &refundId,
                                   const std::string &status,
                                   const std::string &actorId,
                                   const Json::Value &payload);
    Json::Value requestRefund(const std::string &userId, const Json::Value &roles, const Json::Value &payload);
    Json::Value getPricingConfig() const;
    Json::Value updatePricingConfig(const Json::Value &payload);
    Json::Value handleWebhook(const std::string &provider,
                              const std::string &rawBody,
                              const Json::Value &payload,
                              const std::string &signatureHeader);

  private:
    Json::Value loadOrders() const;
    Json::Value loadLedger() const;
    Json::Value loadRefunds() const;
    Json::Value loadPricingConfig() const;
    void saveOrders(const Json::Value &orders) const;
    void saveLedger(const Json::Value &ledger) const;
    void saveRefunds(const Json::Value &refunds) const;
    void savePricingConfig(const Json::Value &pricing) const;

    Json::Value findOrderUnlocked(const Json::Value &orders, const std::string &orderId) const;
    Json::Value buildStripeCheckoutSession(const Json::Value &order) const;
    Json::Value buildProviderPayload(const Json::Value &order) const;
    Json::Value markOrderPaidUnlocked(Json::Value &orders,
                                      Json::Value &ledger,
                                      const std::string &orderId,
                                      const std::string &providerPaymentId,
                                      const Json::Value &providerEvent);
    Json::Value updateRefundFromWebhookUnlocked(Json::Value &orders,
                                                Json::Value &refunds,
                                                Json::Value &ledger,
                                                const std::string &provider,
                                                const Json::Value &payload,
                                                const std::string &eventId);
    void settleSuccessfulRefundUnlocked(Json::Value &orders,
                                        Json::Value &refunds,
                                        Json::Value &ledger,
                                        Json::Value &refund);
    Json::Value grantEntitlementForOrder(const Json::Value &order);
    Json::Value currentEntitlementForOrder(const Json::Value &order) const;
    Json::Value restoreEntitlementForOrder(const Json::Value &order, const Json::Value &snapshot);
    Json::Value appendLedgerEntry(Json::Value &ledger,
                                  const std::string &userId,
                                  const std::string &orderId,
                                  const std::string &type,
                                  int amountCents,
                                  const std::string &currency,
                                  const std::string &summary) const;
    bool canAccessOrder(const Json::Value &order, const std::string &userId, const Json::Value &roles) const;
    bool canManagePayments(const Json::Value &roles) const;
    bool verifyStripeSignature(const std::string &rawBody, const std::string &signatureHeader) const;
    bool verifyGenericHmacSignature(const std::string &rawBody, const std::string &signatureHeader, const std::string &secret) const;
    bool hasProcessedWebhookEvent(Json::Value &events, const std::string &eventId) const;
    void rememberWebhookEvent(Json::Value &events, const std::string &eventId, const std::string &provider) const;

    static std::string normalizeProvider(const std::string &provider);
    static std::string normalizePlan(const std::string &plan);
    static std::string normalizeCurrency(const std::string &currency);
    static int normalizeDays(int days);
    int priceCents(const std::string &plan, int days, const std::string &currency) const;
    static std::string makeId(const std::string &prefix);
    static std::string nowIso();
    static std::string nextExpiryDate(const std::string &currentExpiresAt, int days);
    static std::string env(const char *name, const std::string &fallback = "");
    static std::string urlEncode(const std::string &value);
    static Json::Value parseJsonOrNull(const std::string &raw);
    static std::string readStripeSignaturePart(const std::string &header, const std::string &key);
    static std::string hmacSha256Hex(const std::string &secret, const std::string &payload);
    static std::string sha256Hex(const std::string &payload);
    static std::string readTextFile(const std::string &path);
    static std::string base64Encode(const unsigned char *data, size_t len);
    static std::string rsaSha256Base64(const std::string &privateKeyPem, const std::string &payload);
    static std::string alipayTimestamp();
    static std::string buildAlipayPagePayUrl(const Json::Value &order);
    static Json::Value buildWechatNativePayOrder(const Json::Value &order);
    static std::string buildWechatAuthorization(const std::string &method,
                                                const std::string &urlPath,
                                                const std::string &body);

    std::filesystem::path paymentsDir_;
    std::filesystem::path ordersFile_;
    std::filesystem::path ledgerFile_;
    std::filesystem::path refundsFile_;
    std::filesystem::path webhookEventsFile_;
    std::filesystem::path pricingFile_;
    mutable infrastructure::storage::SqliteJsonStore sqliteStore_;
    SubscriptionService &subscriptionService_;
    mutable std::mutex mutex_;
};
}  // namespace application::services
