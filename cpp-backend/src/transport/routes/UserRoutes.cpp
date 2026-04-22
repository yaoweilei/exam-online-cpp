#include <algorithm>
#include <cstddef>
#include <string>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerUserRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v2/users/search",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session, {"orgAdmin", "systemAdmin", "superAdmin"},
                            "You do not have permission to search users");

                const auto query = req->getParameter("q");
                if (query.empty())
                {
                    throw common::AppException("VALIDATION_ERROR", "Missing query parameter: q",
                                               k422UnprocessableEntity);
                }

                std::size_t limit = 12;
                const auto limitParam = req->getParameter("limit");
                if (!limitParam.empty())
                {
                    int parsedLimit = 12;
                    try
                    {
                        parsedLimit = std::stoi(limitParam);
                    }
                    catch (...)
                    {
                        throw common::AppException("VALIDATION_ERROR",
                                                   "limit must be a positive integer",
                                                   k422UnprocessableEntity);
                    }
                    if (parsedLimit <= 0)
                    {
                        throw common::AppException("VALIDATION_ERROR",
                                                   "limit must be a positive integer",
                                                   k422UnprocessableEntity);
                    }
                    limit = static_cast<std::size_t>((std::min)(parsedLimit, 50));
                }

                return common::ok(req, ctx.userService->searchUsers(query, limit));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.userService->getUser(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/by-role/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string roleId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.userService->usersByRole(roleId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/users/{1}/permissions",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.userService->permissions(userId));
            });
        },
        {Get});

    app().registerHandler(
        "/api/v2/roles",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                return common::ok(req, ctx.userService->allRoles());
            });
        },
        {Get});
}
}  // namespace transport::routes
