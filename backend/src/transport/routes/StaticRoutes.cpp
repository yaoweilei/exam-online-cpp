#include <filesystem>

#include <drogon/HttpAppFramework.h>
#include <drogon/HttpResponse.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"
#include "infrastructure/config/AppConfig.h"

using namespace drogon;

namespace transport::routes
{
namespace
{
std::string contentTypeForPath(const std::filesystem::path &path)
{
    auto ext = path.extension().string();
    for (auto &ch : ext)
    {
        if (ch >= 'A' && ch <= 'Z')
        {
            ch = static_cast<char>(ch - 'A' + 'a');
        }
    }
    if (ext == ".html") return "text/html; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".js") return "application/javascript; charset=utf-8";
    if (ext == ".json" || ext == ".webmanifest") return "application/json; charset=utf-8";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".ico") return "image/x-icon";
    if (ext == ".mp3") return "audio/mpeg";
    if (ext == ".wav") return "audio/wav";
    return "application/octet-stream";
}
}

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
            auto response = fileContentResponse(path, "text/html; charset=utf-8");
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

            auto response = fileContentResponse(fullPath, contentTypeForPath(fullPath));
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
            auto response = fileContentResponse(fullPath, contentTypeForPath(fullPath));
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
            auto response = fileContentResponse(path, "application/javascript; charset=utf-8");
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
            auto response = fileContentResponse(path, "application/manifest+json; charset=utf-8");
            if (ctx.disableStaticCache)
            {
                applyNoCacheHeaders(response);
            }
            callback(response);
        },
        {Get});
}

void registerHealthRoutes(const AppContext &ctx)
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

    app().registerHandler(
        "/readyz",
        [ctx](const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
            Json::Value checks(Json::objectValue);
            const auto staticReady = std::filesystem::is_regular_file(ctx.staticDir / "index.html");
            const auto paperReady = std::filesystem::is_directory(ctx.dataRoot / "paper");
            const auto userReady = std::filesystem::is_directory(ctx.dataRoot / "user");
            const auto systemReady = std::filesystem::is_directory(ctx.dataRoot / "system");
            const auto servicesReady = ctx.examService && ctx.authService && ctx.paymentService &&
                                       ctx.organizationService && ctx.contentWorkflowService;
            checks["static"] = staticReady;
            checks["paper_store"] = paperReady;
            checks["user_store"] = userReady;
            checks["system_store"] = systemReady;
            checks["core_services"] = servicesReady;

            bool diskReady = false;
            std::uintmax_t availableBytes = 0;
            try
            {
                availableBytes = std::filesystem::space(ctx.dataRoot).available;
                const auto minimumMbText = infrastructure::config::readEnv("READY_MIN_FREE_DISK_MB", "256");
                const auto minimumBytes = static_cast<std::uintmax_t>(std::stoull(minimumMbText)) * 1024ULL * 1024ULL;
                diskReady = availableBytes >= minimumBytes;
            }
            catch (...)
            {
                diskReady = false;
            }
            checks["disk_space"] = diskReady;
            checks["available_disk_mb"] = static_cast<Json::UInt64>(availableBytes / 1024ULL / 1024ULL);

            const auto ready = staticReady && paperReady && userReady && systemReady && servicesReady && diskReady;
            Json::Value out(Json::objectValue);
            out["status"] = ready ? "ready" : "not_ready";
            out["service"] = "exam-online-cpp";
            out["checks"] = checks;
            auto response = ready
                                ? common::ok(req, out)
                                : common::fail(req, k503ServiceUnavailable, "SERVICE_NOT_READY", "Service dependencies are not ready", out);
            callback(response);
        },
        {Get});
}
}  // namespace transport::routes
