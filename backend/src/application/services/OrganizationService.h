#pragma once

#include <algorithm>
#include <chrono>
#include <cctype>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#include <json/json.h>

#include "application/services/NotificationService.h"
#include "application/services/SubscriptionService.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include "infrastructure/storage/OrganizationRepository.h"
#include "infrastructure/storage/UserRepository.h"

namespace application::services
{
class OrganizationService
{
  public:
        explicit OrganizationService(infrastructure::storage::OrganizationRepository &organizationRepository,
                           infrastructure::storage::UserRepository &userRepository,
                           SubscriptionService &subscriptionService,
                           SmsService &smsService,
                           EmailService &emailService,
                           std::string publicWebBaseUrl)
;

    Json::Value listOrganizationsForUser(const std::string &userId, bool includeAll = false) const;

    Json::Value getOrganization(const std::string &organizationId) const;

    Json::Value createOrganization(const std::string &actorUserId, const Json::Value &payload);

    Json::Value listMembers(const std::string &organizationId) const;

    Json::Value createInvitation(const std::string &actorUserId, const std::string &organizationId, const Json::Value &payload);

    void cancelInvitation(const std::string &actorUserId, const std::string &organizationId, const std::string &invitationId);

    Json::Value acceptInvitation(const std::string &actorUserId, const std::string &inviteCode);

    Json::Value listPendingInvitationsForUser(const std::string &actorUserId) const;

    Json::Value upsertMember(const std::string &actorUserId, const std::string &organizationId, const Json::Value &payload);

    void removeMember(const std::string &actorUserId, const std::string &organizationId, const std::string &userId);

    Json::Value updateSubscription(const std::string &actorUserId, const std::string &organizationId, const Json::Value &patch);

    bool canAccessOrganization(const std::string &actorUserId, const Json::Value &actorRoles, const std::string &organizationId) const;

    bool canManageOrganization(const std::string &actorUserId, const Json::Value &actorRoles, const std::string &organizationId) const;

  private:
    Json::Value requireOrganization(const std::string &organizationId) const;

    Json::Value enrichOrganization(Json::Value organization) const;

    Json::Value enrichMembership(Json::Value membership) const;

    Json::Value assignBusinessNumbers(const Json::Value &organization, Json::Value membership, const Json::Value &existing) const;

    std::string nextOrganizationMemberNo(const std::string &organizationId, const std::string &organizationType) const;

    static int extractPrefixedSerial(const std::string &value, const std::string &prefix);

    static std::string padSerial(int value, int width);

    static std::string normalizeOrganizationType(const std::string &organizationType);

    static Json::Value defaultOwnerRoles();

    static Json::Value defaultMemberRoles();

    static Json::Value allowedMembershipRoles();

    static bool hasRole(const Json::Value &roles, const std::string &expected);

    static Json::Value normalizeMemberRoles(const Json::Value &inputRoles);

    Json::Value appendAuditEntry(Json::Value organization, const Json::Value &entry) const;

    Json::Value prependInvitation(Json::Value organization, const Json::Value &entry) const;

    Json::Value replaceInvitation(Json::Value organization, const Json::Value &entry) const;

    Json::Value createAuditEntry(const std::string &actorUserId,
                                 const std::string &action,
                                 const std::string &summary,
                                 const Json::Value &details) const;

    struct InvitationContact
    {
        std::string channel;
        std::string value;
    };

    struct InvitationEligibility
    {
        bool visible{false};
        bool canAccept{false};
        bool contactMatches{false};
        bool contactVerified{false};
        bool expired{false};
        std::string blockCode;
        std::string blockMessage;
    };

    static InvitationContact extractInvitationContact(const Json::Value &payload);

    Json::Value findUserByInvitationContact(const InvitationContact &contact) const;

    Json::Value buildPendingInvitationView(const Json::Value &actor,
                                          const Json::Value &organization,
                                          const Json::Value &invitation) const;

    InvitationEligibility evaluateInvitationEligibility(const Json::Value &actor,
                                                        const Json::Value &organization,
                                                        const Json::Value &invitation) const;

    static bool invitationContactMatchesActor(const Json::Value &actor,
                                              const std::string &channel,
                                              const std::string &expectedContact);

    DeliveryResult deliverInvitation(const Json::Value &organization, const Json::Value &invitation) const;

    Json::Value mergeInvitationDelivery(Json::Value invitation, const DeliveryResult &delivery) const;

    void ensureInvitationContactVerified(const Json::Value &actor, const Json::Value &invitation) const;

    static bool looksLikeEmail(const std::string &value);

    static std::string toLowerCopy(std::string value);

    static std::string normalizePhone(const std::string &value);

    static std::string generateInvitationCode();

    std::string buildInvitationAcceptUrl(const std::string &inviteCode) const;

    static std::string defaultInvitationExpiresAt();

    static bool isExpiredIso8601(const std::string &value);

    void ensureOrgAdminGuard(const std::string &organizationId, const Json::Value &existing, const Json::Value &nextRoles) const;

    int organizationAdminCount(const std::string &organizationId) const;

    static std::string generateOrganizationId();

    static bool hasPlatformRole(const Json::Value &roles);

    infrastructure::storage::OrganizationRepository &organizationRepository_;
    infrastructure::storage::UserRepository &userRepository_;
    SubscriptionService &subscriptionService_;
    SmsService &smsService_;
    EmailService &emailService_;
    std::string publicWebBaseUrl_;
};
}  // namespace application::services
