#include <algorithm>
#include <string>
#include <vector>

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

Json::Value paginateItems(const std::vector<Json::Value> &items, int page, int pageSize)
{
    Json::Value out(Json::objectValue);
    out["items"] = Json::arrayValue;
    const auto total = static_cast<int>(items.size());
    const int begin = (page - 1) * pageSize;
    for (int index = begin; index < total && index < begin + pageSize; ++index)
    {
        out["items"].append(items[static_cast<std::size_t>(index)]);
    }
    out["total"] = total;
    out["page"] = page;
    out["page_size"] = pageSize;
    out["pages"] = total == 0 ? 0 : (total + pageSize - 1) / pageSize;
    return out;
}

std::pair<int, int> readPage(const HttpRequestPtr &req)
{
    int page = 1;
    int pageSize = 20;
    try { page = (std::max)(1, std::stoi(req->getParameter("page"))); } catch (...) { }
    try { pageSize = std::clamp(std::stoi(req->getParameter("page_size")), 1, 100); } catch (...) { }
    return {page, pageSize};
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
                const bool paged = !req->getParameter("page").empty() || !req->getParameter("page_size").empty()
                    || !req->getParameter("q").empty() || req->getParameter("summary") == "1";
                if (paged)
                {
                    const auto [page, pageSize] = readPage(req);
                    return common::ok(req, ctx.organizationService->listOrganizationSummaries(
                        session.get("user_id", "").asString(), hasAnyRole(session["roles"], {"superAdmin"}),
                        req->getParameter("q"), page, pageSize));
                }
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
				auto createPayload = body;
				if (!hasAnyRole(session["roles"], {"superAdmin"}))
				{
					createPayload.removeMember("organization_id");
					createPayload.removeMember("owner_roles");
					createPayload.removeMember("permission_templates");
					createPayload.removeMember("permission_overrides");
					createPayload["plan"] = "free";
					createPayload["status"] = "active";
					createPayload["expires_at"] = "";
					createPayload["seats"] = 5;
				}
                return common::ok(req,
					ctx.organizationService->createOrganization(session.get("user_id", "").asString(), createPayload),
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
                const auto query = req->getParameter("q");
                const auto role = req->getParameter("role");
                const auto status = req->getParameter("status");
                const auto sort = req->getParameter("sort");
                const bool ascending = req->getParameter("order") == "asc";
                const bool paged = !req->getParameter("page").empty() || !req->getParameter("page_size").empty()
                    || !query.empty() || !role.empty() || !status.empty() || !sort.empty();
                auto members = ctx.organizationService->listMembers(organizationId);
                if (!paged) return common::ok(req, members);
                std::vector<Json::Value> matches;
                for (const auto &member : members)
                {
                    if (!status.empty() && member.get("status", "active").asString() != status) continue;
                    if (!role.empty())
                    {
                        bool found = false;
                        for (const auto &memberRole : member["roles"])
                        {
                            if (memberRole.asString() == role) { found = true; break; }
                        }
                        if (!found) continue;
                    }
                    if (!query.empty())
                    {
                        const auto searchable = member.get("username", "").asString() + " "
                            + member.get("user_id", "").asString() + " " + member.get("member_no", "").asString();
                        if (searchable.find(query) == std::string::npos) continue;
                    }
                    matches.push_back(member);
                }
                std::stable_sort(matches.begin(), matches.end(), [&](const Json::Value &left, const Json::Value &right) {
                    const auto field = sort == "status" ? "status" : sort == "member_no" ? "member_no" : "username";
                    const auto a = left.get(field, "").asString(), b = right.get(field, "").asString();
                    return ascending ? a < b : a > b;
                });
                const auto [page, pageSize] = readPage(req);
                return common::ok(req, paginateItems(matches, page, pageSize));
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
                if (body.get("confirmation", "").asString() != "确认修改机构成员")
                {
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改机构成员”确认此操作", k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                const auto targetUserId = body.get("user_id", "").asString();
                bool existingMember = false;
                for (const auto &currentMember : ctx.organizationService->listMembers(organizationId))
                {
                    if (currentMember.get("user_id", "").asString() == targetUserId)
                    {
                        existingMember = true;
                        break;
                    }
                }
                auto member = ctx.organizationService->upsertMember(
                    session.get("user_id", "").asString(), organizationId, body);
                member["revoked_sessions"] = existingMember
                    ? ctx.authService->revokeSessionsForUser(member.get("user_id", "").asString())
                    : 0;
                return common::ok(req, member, "member_saved");
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
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                if (!ctx.organizationService->canManageOrganization(
                        session.get("user_id", "").asString(), session["roles"], organizationId))
                {
                    throw common::AppException("FORBIDDEN",
                                               "You do not have permission to manage this organization",
                                               k403Forbidden);
                }
                const auto confirmation = body.get("confirmation", "").asString();
                if (confirmation != "确认移除机构成员" && confirmation != "CONFIRM_REMOVE_ORGANIZATION_MEMBER")
                {
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认移除机构成员”确认此操作", k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                ctx.organizationService->removeMember(session.get("user_id", "").asString(),
                                                     organizationId, userId);
                Json::Value out(Json::objectValue);
                out["revoked_sessions"] = ctx.authService->revokeSessionsForUser(userId);
                return common::ok(req, out, "member_removed");
            });
        },
        {Delete});

    app().registerHandler(
        "/api/v1/organizations/{1}/role-permissions/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string organizationId,
              std::string roleId) {
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
                if (body.get("confirmation", "").asString() != "确认修改角色权限")
                {
                    throw common::AppException("CONFIRMATION_REQUIRED", "请输入“确认修改角色权限”确认此操作", k422UnprocessableEntity);
                }
                requirePasswordReauthentication(*ctx.authService, session, body);
                auto result = ctx.organizationService->updateRolePermissions(
                    session.get("user_id", "").asString(), organizationId, roleId, body);
                int revokedSessions = 0;
                for (const auto &member : ctx.organizationService->listMembers(organizationId))
                {
                    bool affected = false;
                    for (const auto &memberRole : member["roles"])
                    {
                        if (memberRole.asString() == roleId) { affected = true; break; }
                    }
                    if (affected)
                    {
                        revokedSessions += ctx.authService->revokeSessionsForUser(
                            member.get("user_id", "").asString());
                    }
                }
                result["revoked_sessions"] = revokedSessions;
                return common::ok(req, result, "role_permissions_saved");
            });
        },
        {Post, Put});

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
                const auto query = req->getParameter("q");
                const auto status = req->getParameter("status");
                const auto sort = req->getParameter("sort");
                const bool ascending = req->getParameter("order") == "asc";
                const bool paged = !req->getParameter("page").empty() || !req->getParameter("page_size").empty()
                    || !query.empty() || !status.empty() || !sort.empty();
                auto campuses = ctx.organizationService->listCampuses(organizationId);
                if (!paged) return common::ok(req, campuses);
                std::vector<Json::Value> matches;
                for (const auto &campus : campuses)
                {
                    if (!status.empty() && campus.get("status", "active").asString() != status) continue;
                    if (!query.empty())
                    {
                        const auto searchable = campus.get("name", "").asString() + " "
                            + campus.get("address", "").asString() + " " + campus.get("campus_id", "").asString();
                        if (searchable.find(query) == std::string::npos) continue;
                    }
                    matches.push_back(campus);
                }
                std::stable_sort(matches.begin(), matches.end(), [&](const Json::Value &left, const Json::Value &right) {
                    const auto field = sort == "status" ? "status" : "name";
                    const auto a = left.get(field, "").asString(), b = right.get(field, "").asString();
                    return ascending ? a < b : a > b;
                });
                const auto [page, pageSize] = readPage(req);
                return common::ok(req, paginateItems(matches, page, pageSize));
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
                const auto query = req->getParameter("q");
                const auto campusId = req->getParameter("campus_id");
                const auto status = req->getParameter("status");
                const auto type = req->getParameter("type");
                const auto sort = req->getParameter("sort");
                const bool ascending = req->getParameter("order") == "asc";
                const bool paged = !req->getParameter("page").empty() || !req->getParameter("page_size").empty()
                    || !query.empty() || !campusId.empty() || !status.empty() || !type.empty() || !sort.empty();
                auto groups = ctx.organizationService->listLearningGroups(organizationId);
                if (!paged) return common::ok(req, groups);
                std::vector<Json::Value> matches;
                for (const auto &group : groups)
                {
                    if (!campusId.empty())
                    {
                        const auto expectedCampus = campusId == "__none__" ? "" : campusId;
                        if (group.get("campus_id", "").asString() != expectedCampus) continue;
                    }
                    if (!status.empty() && group.get("status", "").asString() != status) continue;
                    if (!type.empty() && group.get("type", "").asString() != type) continue;
                    if (!query.empty())
                    {
                        const auto searchable = group.get("name", "").asString() + " "
                            + group.get("subject", "").asString() + " " + group.get("learning_group_id", "").asString();
                        if (searchable.find(query) == std::string::npos) continue;
                    }
                    matches.push_back(group);
                }
                std::stable_sort(matches.begin(), matches.end(), [&](const Json::Value &left, const Json::Value &right) {
                    const auto field = sort == "status" ? "status" : sort == "starts_at" ? "starts_at" : "name";
                    const auto a = left.get(field, "").asString(), b = right.get(field, "").asString();
                    return ascending ? a < b : a > b;
                });
                const auto [page, pageSize] = readPage(req);
                return common::ok(req, paginateItems(matches, page, pageSize));
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
                const auto query = req->getParameter("q");
                const auto status = req->getParameter("status");
                const auto studentId = req->getParameter("student_id");
                const auto sort = req->getParameter("sort");
                const bool ascending = req->getParameter("order") == "asc";
                const bool paged = !req->getParameter("page").empty() || !req->getParameter("page_size").empty()
                    || !query.empty() || !status.empty() || !studentId.empty() || !sort.empty();
                auto packages = ctx.organizationService->listCoursePackages(organizationId);
                if (!paged) return common::ok(req, packages);
                std::vector<Json::Value> matches;
                for (const auto &package : packages)
                {
                    if (!status.empty() && package.get("status", "active").asString() != status) continue;
                    if (!studentId.empty() && package.get("student_id", "").asString() != studentId) continue;
                    if (!query.empty())
                    {
                        const auto searchable = package.get("title", "").asString() + " "
                            + package.get("subject", "").asString() + " " + package.get("student_id", "").asString()
                            + " " + package.get("course_package_id", "").asString();
                        if (searchable.find(query) == std::string::npos) continue;
                    }
                    matches.push_back(package);
                }
                std::stable_sort(matches.begin(), matches.end(), [&](const Json::Value &left, const Json::Value &right) {
                    if (sort == "remaining_lessons")
                    {
                        const auto a = left.get("remaining_lessons", 0).asInt(), b = right.get("remaining_lessons", 0).asInt();
                        return ascending ? a < b : a > b;
                    }
                    const auto field = sort == "expires_at" ? "expires_at" : sort == "status" ? "status" : "title";
                    const auto a = left.get(field, "").asString(), b = right.get(field, "").asString();
                    return ascending ? a < b : a > b;
                });
                const auto [page, pageSize] = readPage(req);
                return common::ok(req, paginateItems(matches, page, pageSize));
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
