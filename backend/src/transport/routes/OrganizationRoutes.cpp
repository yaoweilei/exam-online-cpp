#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace
{
void stripPrivateOrganizationFields(Json::Value &organization)
{
    organization.removeMember("invitations");
    organization.removeMember("audit_logs");
}
}  // namespace

namespace transport::routes
{
void registerOrganizationRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/organizations",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                auto organizations = ctx.organizationService->listOrganizationsForUser(
                    session.get("user_id", "").asString(),
                    hasAnyRole(session["roles"], {"superAdmin"}));
                for (auto &organization : organizations)
                {
                    const auto organizationId = organization.get(
                        "organization_id", organization.get("scope_id", "")).asString();
                    if (!ctx.organizationService->canManageOrganization(
                            session.get("user_id", "").asString(), session["roles"], organizationId))
                    {
                        stripPrivateOrganizationFields(organization);
                    }
                }
                return common::ok(req, organizations);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (hasAnyRole(session["roles"], {"guest"}))
                {
                    throw common::AppException("FORBIDDEN", "Guest users cannot create organizations",
                                               k403Forbidden);
                }
                return common::ok(req,
                    ctx.organizationService->createOrganization(session.get("user_id", "").asString(), body),
                    "organization_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/organizations/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                auto organization = ctx.organizationService->getOrganization(organizationId);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    stripPrivateOrganizationFields(organization);
                }
                return common::ok(req, organization);
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/members",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.organizationService->listMembers(organizationId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/members",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                    ctx.organizationService->upsertMember(session.get("user_id", "").asString(),
                                                         organizationId, body),
                    "member_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/organizations/{1}/members/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                ctx.organizationService->removeMember(session.get("user_id", "").asString(),
                                                     organizationId, userId);
                return common::ok(req, Json::Value(Json::objectValue), "member_removed");
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/organizations/{1}/campuses",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.organizationService->listCampuses(organizationId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/campuses",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                                  ctx.organizationService->upsertCampus(session.get("user_id", "").asString(),
                                                                        organizationId, body),
                                  "campus_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.organizationService->listLearningGroups(organizationId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                                  ctx.organizationService->upsertLearningGroup(session.get("user_id", "").asString(),
                                                                               organizationId, body),
                                  "learning_group_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups/{2}/enrollments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.organizationService->listLearningGroupEnrollments(organizationId, learningGroupId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups/{2}/enrollments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                                  ctx.organizationService->upsertLearningGroupEnrollment(
                                      session.get("user_id", "").asString(), organizationId, learningGroupId, body),
                                  "learning_group_enrollment_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/organizations/{1}/learning-groups/{2}/complete",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string learningGroupId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                                  ctx.organizationService->completeLearningGroup(
                                      session.get("user_id", "").asString(), organizationId, learningGroupId, body),
                                  "learning_group_completed");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/organizations/{1}/course-packages",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canAccessOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have access to this organization",
                                               k403Forbidden);
                }
                return common::ok(req, ctx.organizationService->listCoursePackages(organizationId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v1/organizations/{1}/course-packages",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN", "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                                  ctx.organizationService->upsertCoursePackage(session.get("user_id", "").asString(),
                                                                               organizationId, body),
                                  "course_package_saved");
            });
        },
        {Post, Put});

    app().registerHandler(
        "/api/v1/organizations/{1}/invitations",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                return common::ok(req,
                    ctx.organizationService->createInvitation(session.get("user_id", "").asString(),
                                                              organizationId, body),
                    "invitation_created");
            });
        },
        {Post});

    app().registerHandler(
        "/api/v1/organizations/{1}/invitations/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string invitationId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                ctx.organizationService->cancelInvitation(session.get("user_id", "").asString(),
                                                         organizationId, invitationId);
                return common::ok(req, Json::Value(Json::objectValue), "invitation_cancelled");
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/organizations/invitations/accept",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto inviteToken = body.get("invite_token", body.get("invite_code", "")).asString();
                if (inviteToken.empty())
                {
                    throw common::AppException("INVITE_TOKEN_REQUIRED", "Invite token is required",
                                               k422UnprocessableEntity);
                }
                auto result = ctx.organizationService->acceptInvitation(
                    session.get("user_id", "").asString(), inviteToken);
                const auto organizationId = result["organization"].get(
                    "organization_id", result["organization"].get("scope_id", "")).asString();
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    stripPrivateOrganizationFields(result["organization"]);
                }
                return common::ok(req, result, "invitation_accepted");
            });
        },
        {Post});
}
}  // namespace transport::routes
