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

    // 业务功能 14（PWA）：Service Worker 必须以根作用域（/sw.js）暴露才能控制全站
    app().registerHandler(
        "/sw.js",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto path = ctx.staticDir / "sw.js";
            if (!std::filesystem::exists(path))
            {
                callback(common::fail(req, k404NotFound, "SW_NOT_FOUND", "Service worker not found"));
                return;
            }
            auto response = HttpResponse::newFileResponse(path.string());
            response->setContentTypeString("application/javascript; charset=utf-8");
            // 始终禁用 SW 缓存，确保新版本能被快速感知
            applyNoCacheHeaders(response);
            response->addHeader("Service-Worker-Allowed", "/");
            callback(response);
        },
        {Get});

    // 业务功能 14（PWA）：Web App Manifest（根路径暴露）
    app().registerHandler(
        "/manifest.webmanifest",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto path = ctx.staticDir / "manifest.webmanifest";
            if (!std::filesystem::exists(path))
            {
                callback(common::fail(req, k404NotFound, "MANIFEST_NOT_FOUND", "Manifest not found"));
                return;
            }
            auto response = HttpResponse::newFileResponse(path.string());
            response->setContentTypeString("application/manifest+json; charset=utf-8");
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
    app().registerHandler("/api/v1/health", healthHandler, {Get});
}
}  // namespace transport::routes
