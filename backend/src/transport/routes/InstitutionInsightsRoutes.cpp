#include "transport/routes/Routes.h"
#include "transport/RouteUtils.h"
#include <drogon/HttpAppFramework.h>
using namespace drogon;
namespace transport::routes
{
namespace
{
Json::Value insightFilters(const HttpRequestPtr &req)
{
    Json::Value out(Json::objectValue);
    for (const auto *field : {"from","to","target","skill","timezone"}) if (!req->getParameter(field).empty()) out[field]=req->getParameter(field);
    return out;
}
}
void registerInstitutionInsightsRoutes(const AppContext &ctx)
{
    app().registerHandler("/api/v1/me/learning-progress",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_report",session["user_id"].asString()); return common::ok(req,ctx.institutionService->learningProgress(session["user_id"].asString(),session["roles"],session["user_id"].asString(),"",insightFilters(req))); });
    },{Get});
    app().registerHandler("/api/v1/institution/students/{1}/progress",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string id) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->learningProgress(session["user_id"].asString(),session["roles"],id,req->getParameter("org_id"),insightFilters(req))); });
    },{Get});
    app().registerHandler("/api/v1/institution/students/{1}/weakness-questions",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string id) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->weaknessQuestions(session["user_id"].asString(),session["roles"],id,req->getParameter("org_id"),insightFilters(req))); });
    },{Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/operations",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string org) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->operationalDashboard(session["user_id"].asString(),session["roles"],org,insightFilters(req))); });
    },{Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/setup",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string org) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->setupContext(session["user_id"].asString(),session["roles"],org)); });
    },{Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/setup",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string org) {
        handleRequest(req,std::move(callback),[&]() { const auto body=parseJsonBody(req),session=requireSession(*ctx.authService,req,&body); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->setupCohort(session["user_id"].asString(),session["roles"],org,body)); });
    },{Post});
    app().registerHandler("/api/v1/institution/organizations/{1}/review-comments",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string org) {
        handleRequest(req,std::move(callback),[&]() { const auto session=requireSession(*ctx.authService,req); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->reviewComments(session["user_id"].asString(),session["roles"],org)); });
    },{Get});
    app().registerHandler("/api/v1/institution/organizations/{1}/review-comments",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback,std::string org) {
        handleRequest(req,std::move(callback),[&]() { const auto body=parseJsonBody(req),session=requireSession(*ctx.authService,req,&body); requireFeature(*ctx.featureFlagService,"learning_groups",session["user_id"].asString()); return common::ok(req,ctx.institutionService->saveReviewComment(session["user_id"].asString(),session["roles"],org,body)); });
    },{Post});
}
}
