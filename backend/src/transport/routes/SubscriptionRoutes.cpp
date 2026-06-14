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
                if (currentUserId != scopeId && !hasAnyRole(session["roles"], {"systemAdmin", "superAdmin"}))
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
                if (scopeType == "organization" || scopeId.rfind("org_", 0) == 0)
                {
                    if (!ctx.organizationService->canManageOrganization(
                            session.get("user_id", "").asString(), session["roles"], scopeId))
                    {
                        throw common::AppException("FORBIDDEN",
                                                   "You do not have permission to manage this organization subscription",
                                                   k403Forbidden);
                    }
                    return common::ok(req, ctx.organizationService->updateSubscription(
                                              session.get("user_id", "").asString(), scopeId, body));
                }
                const auto currentUserId = session.get("user_id", "").asString();
                if (currentUserId != scopeId && !hasAnyRole(session["roles"], {"systemAdmin", "superAdmin"}))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this subscription",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.subscriptionService->updateUserSubscription(scopeId, body));
            });
        },
        {Post});
}
}  // namespace transport::routes
