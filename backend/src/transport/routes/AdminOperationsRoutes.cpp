#include "transport/routes/Routes.h"
#include "transport/RouteUtils.h"
#include "common/TimeUtils.h"
#include "infrastructure/config/AppConfig.h"
#include "application/services/BackupStatus.h"
#include <algorithm>
#include <chrono>
#include <regex>
#include <drogon/HttpAppFramework.h>
using namespace drogon;
namespace transport::routes
{
void registerAdminOperationsRoutes(const AppContext &ctx)
{
    app().registerHandler("/api/v1/admin/operations",[ctx](const HttpRequestPtr &req,std::function<void(const HttpResponsePtr &)> &&callback) {
        handleRequest(req,std::move(callback),[&]() {
            const auto session=requireSession(*ctx.authService,req); requireRole(session,{"superAdmin"},"需要超级管理员权限");
            requireFeature(*ctx.featureFlagService,"admin_dashboard",session["user_id"].asString());
            auto date=req->getParameter("date"); if (date.empty()) date=common::nowIso8601().substr(0,10);
            if (!std::regex_match(date,std::regex(R"(^\d{4}-\d{2}-\d{2}$)"))) throw common::AppException("VALIDATION_ERROR","日期格式不正确",k422UnprocessableEntity);
            if (!std::chrono::year_month_day{std::chrono::year{std::stoi(date.substr(0,4))},std::chrono::month{unsigned(std::stoi(date.substr(5,2)))},std::chrono::day{unsigned(std::stoi(date.substr(8,2)))}}.ok()) throw common::AppException("VALIDATION_ERROR","日期不正确",k422UnprocessableEntity);
            Json::Value out(Json::objectValue); out["date"]=date; out["items"]=Json::arrayValue; out["checks"]=Json::arrayValue;
            auto append=[&](const std::string &type,const std::string &title,const std::string &id,const std::string &destination,const std::string &when="") { Json::Value row(Json::objectValue); row["type"]=type; row["title"]=title; row["id"]=id; row["destination"]=destination; row["created_at"]=when; out["items"].append(row); };
            const auto check=[&](const std::string &name,bool ready) { Json::Value row(Json::objectValue); row["name"]=name; row["ready"]=ready; out["checks"].append(row); if (!ready) append("service_issue",name+"不可用","","checks"); };
            check("前端页面",std::filesystem::is_regular_file(ctx.staticDir/"index.html"));
            check("题库存储",std::filesystem::is_directory(ctx.dataRoot/"paper")); check("用户存储",std::filesystem::is_directory(ctx.dataRoot/"user")); check("系统存储",std::filesystem::is_directory(ctx.dataRoot/"system"));
            bool diskReady=false; try { diskReady=std::filesystem::space(ctx.dataRoot).available >= std::stoull(infrastructure::config::readEnv("READY_MIN_FREE_DISK_MB","256"))*1024ULL*1024ULL; } catch (...) {}
            check("可用磁盘空间",diskReady);
            const auto backup=application::services::readBackupStatus(infrastructure::config::readEnv("BACKUP_STATUS_FILE",""),ctx.dataRoot);
            out["checks"].append(backup);
            if (backup["configured"].asBool() && !backup["ready"].asBool()) append("service_issue",backup["detail"].asString(),"","checks");
            try {
                for (const auto &item : ctx.paymentService->operationalAlerts(date)) {
                    const bool refund=!item.get("refund_id", "").asString().empty();
                    append(item["type"].asString(),item["message"].asString(),item.get(refund?"refund_id":"order_id", "").asString(),refund?"refund":"order",item.get("created_at", "").asString());
                    out["items"][out["items"].size()-1]["scope_type"]=item["scope_type"]; out["items"][out["items"].size()-1]["scope_id"]=item["scope_id"];
                }
                check("支付数据读取",true);
            } catch (...) { check("支付数据读取",false); }
            try {
                for (const auto &item : ctx.contentWorkflowService->listItems()) {
                    const auto id=item["exam_id"].asString(), status=item.get("status", "").asString();
                    const bool blocked=status=="quality_failed" || item["inspection"].get("passed",true).asBool()==false || item["reviews"]["analysis"].get("status", "").asString()=="rejected" || item["reviews"]["secondary"].get("status", "").asString()=="rejected";
                    if (status!="published" && blocked) append("blocked_content",id+"：质检或审核阻断",id,"content",item.get("updated_at", "").asString());
                    else if (status!="published" && !item.get("updated_at", "").asString().empty() && item["updated_at"].asString().substr(0,10)<date) append("overdue_content",id+"：跨日待继续处理的发布流程",id,"content",item["updated_at"].asString());
                }
                check("发布流程读取",true);
            } catch (...) { check("发布流程读取",false); }
            out["counts"]=Json::objectValue; for (const auto *type : {"failed_payment","overdue_order","overdue_refund","blocked_content","overdue_content","service_issue"}) out["counts"][type]=0;
            for (const auto &item : out["items"]) { const auto type=item["type"].asString(); out["counts"][type]=out["counts"][type].asInt()+1; }
            out["note"]="失败支付按所选 UTC 日期统计；跨日待办不等于渠道故障。服务检查为本机存储和数据读取，不包含外部邮件、短信或支付渠道探测。";
            return common::ok(req,out);
        });
    },{Get});
}
}
