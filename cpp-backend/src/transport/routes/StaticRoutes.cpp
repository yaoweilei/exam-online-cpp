#include <filesystem>

#include <drogon/HttpAppFramework.h>
#include <drogon/HttpResponse.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
void registerStaticRoutes(const AppContext &ctx)
{
    app().registerHandler(
        "/",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto path = ctx.staticDir / "index.html";
            if (!std::filesystem::exists(path))
            {
                callback(common::fail(req, k404NotFound, "INDEX_NOT_FOUND", "Index file not found"));
                return;
            }
            auto response = HttpResponse::newFileResponse(path.string());
            response->setContentTypeCode(CT_TEXT_HTML);
            if (ctx.disableStaticCache)
            {
                applyNoCacheHeaders(response);
            }
            callback(response);
        },
        {Get});

    app().registerHandler(
        "/static/{1:.*}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &path) {
            if (path.empty() || containsParentTraversal(path))
            {
                callback(common::fail(req, k404NotFound, "STATIC_NOT_FOUND", "Static asset not found"));
                return;
            }

            const auto fullPath = ctx.staticDir / path;
            if (!std::filesystem::exists(fullPath) || std::filesystem::is_directory(fullPath))
            {
                callback(common::fail(req, k404NotFound, "STATIC_NOT_FOUND", "Static asset not found"));
                return;
            }

            auto response = HttpResponse::newFileResponse(fullPath.string());
            if (ctx.disableStaticCache)
            {
                applyNoCacheHeaders(response);
            }
            callback(response);
        },
        {Get});

    app().registerHandler(
        "/resource/{1:.*}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              const std::string &path) {
            const auto fullPath = ctx.staticDir / "resource" / path;
            if (!std::filesystem::exists(fullPath))
            {
                callback(common::fail(req, k404NotFound, "RESOURCE_NOT_FOUND", "Resource not found"));
                return;
            }
            auto response = HttpResponse::newFileResponse(fullPath.string());
            if (ctx.disableStaticCache)
            {
                applyNoCacheHeaders(response);
            }
            callback(response);
        },
        {Get});
}

void registerHealthRoutes(const AppContext & /*ctx*/)
{
    auto healthHandler = [](const HttpRequestPtr &req,
                            std::function<void(const HttpResponsePtr &)> &&callback) {
        Json::Value out(Json::objectValue);
        out["status"] = "ok";
        out["service"] = "exam-online-cpp";
        callback(common::ok(req, out));
    };
    app().registerHandler("/healthz", healthHandler, {Get});
    app().registerHandler("/api/v2/health", healthHandler, {Get});
}
}  // namespace transport::routes
