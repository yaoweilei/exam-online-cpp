#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerSubscriptionRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/subscription/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string scopeId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto scopeType = req->getParameter("scope_type");
                if (scopeType == "organization" || scopeId.rfind("org_", 0) == 0)
                {
                    if (!ctx.organizationService->canAccessOrganization(
                            session.get("user_id", "").asString(), session["roles"], scopeId))
                    {
                        throw common::AppException("FORBIDDEN",
                                                   "You do not have access to this organization subscription",
                                                   k403Forbidden);
                    }
                    return common::ok(req, ctx.subscriptionService->subscriptionForOrganization(scopeId));
                }
                const auto currentUserId = session.get("user_id", "").asString();
                if (currentUserId != scopeId && !hasAnyRole(session["roles"], {"superAdmin"}))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have access to this subscription",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.subscriptionService->subscriptionForUser(scopeId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/subscription/{1}/grant",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string scopeId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto scopeType = body.get("scope_type", req->getParameter("scope_type")).asString();
				const auto actorId = session.get("user_id", "").asString();
				const bool isSuper = hasAnyRole(session["roles"], {"superAdmin"});
                if (scopeType == "organization" || scopeId.rfind("org_", 0) == 0)
                {
                    if (!ctx.organizationService->canManageOrganization(
							actorId, session["roles"], scopeId))
                    {
                        throw common::AppException("FORBIDDEN",
                                                   "You do not have permission to manage this organization subscription",
                                                   k403Forbidden);
                    }
					if (!isSuper)
					{
						const auto current = ctx.subscriptionService->subscriptionForOrganization(scopeId);
						auto planRank = [](const std::string &plan) { return plan == "ultra" ? 2 : plan == "pro" ? 1 : 0; };
						const auto currentPlan = current.get("plan", "free").asString();
						const auto nextPlan = body.get("plan", currentPlan).asString();
						const auto currentSeats = current.get("seats", 5).asInt();
						const auto nextSeats = body.get("seats", currentSeats).asInt();
						const auto currentExpiry = current.get("expires_at", "").asString();
						const auto nextExpiry = body.get("expires_at", currentExpiry).asString();
						const auto currentStatus = current.get("status", "active").asString();
						const auto nextStatus = body.get("status", currentStatus).asString();
						const bool activatesInactive = (currentStatus == "expired" || currentStatus == "canceled") &&
							(nextStatus == "active" || nextStatus == "trial");
						const bool extendsExpiry = !currentExpiry.empty() && (nextExpiry.empty() || nextExpiry > currentExpiry);
						if (planRank(nextPlan) > planRank(currentPlan) || nextSeats > currentSeats || activatesInactive || extendsExpiry)
						{
							throw common::AppException("PAYMENT_REQUIRED", "套餐升级、续期或扩席必须通过支付订单完成", k403Forbidden);
						}
					}
					const auto confirmation = requireBoundedString(body, "confirmation", 1, 40);
					if (confirmation != "确认修改机构订阅" && confirmation != "CONFIRM_ORGANIZATION_SUBSCRIPTION")
						throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改机构订阅”确认此操作", k422UnprocessableEntity);
					requirePasswordReauthentication(*ctx.authService, session, body);
					auto result = ctx.organizationService->updateSubscription(actorId, scopeId, body);
					int revokedSessions = 0;
					for (const auto &member : ctx.organizationService->listMembers(scopeId))
					{
						revokedSessions += ctx.authService->revokeSessionsForUser(member.get("user_id", "").asString(), member.get("user_id", "").asString() == actorId ? session.get("token", "").asString() : "");
					}
					result["revoked_sessions"] = revokedSessions;
					return common::ok(req, result);
                }
				const auto currentUserId = actorId;
				if (currentUserId != scopeId && !isSuper)
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this subscription",
                                               k403Forbidden);
                }
				if (!isSuper)
				{
					if (body.get("plan", "").asString() != "free" ||
						(body.isMember("status") && body.get("status", "").asString() != "active") ||
						(body.isMember("expires_at") && !body.get("expires_at", "").asString().empty()))
					{
						throw common::AppException("PAYMENT_REQUIRED", "付费套餐必须通过支付订单完成", k403Forbidden);
					}
					Json::Value downgrade(Json::objectValue);
					downgrade["plan"] = "free";
					downgrade["status"] = "active";
					downgrade["expires_at"] = "";
					return common::ok(req, ctx.subscriptionService->updateUserSubscription(scopeId, downgrade));
				}
				if (requireBoundedString(body, "confirmation", 1, 30) != "确认修改订阅")
					throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改订阅”确认此操作", k422UnprocessableEntity);
				requirePasswordReauthentication(*ctx.authService, session, body);
				auto result = ctx.subscriptionService->updateUserSubscription(scopeId, body);
				result["revoked_sessions"] = ctx.authService->revokeSessionsForUser(scopeId, actorId == scopeId ? session.get("token", "").asString() : "");
				return common::ok(req, result);
            });
        },
        {Post});
}
}  // namespace transport::routes
