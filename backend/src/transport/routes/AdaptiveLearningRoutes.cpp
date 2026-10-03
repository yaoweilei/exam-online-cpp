#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerAdaptiveLearningRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/api/v1/me/adaptive-learning",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                return common::ok(req, ctx.adaptiveLearningService->profile(userId, req->getParameter("exam_target")));
            });
        },
        {Get});
}
}  // namespace transport::routes
