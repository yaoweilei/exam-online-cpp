#include "InstitutionService.h"
#include "InstitutionAccess.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <stdexcept>
#include <drogon/HttpTypes.h>

namespace application::services
{
namespace
{
void correctionError(const std::string &message) { throw common::AppException("VALIDATION_ERROR",message,drogon::k422UnprocessableEntity); }
void staleCorrection() { throw common::AppException("SETTLEMENT_CONFLICT","课次或账户已变化，请重新读取并核对更正预览",drogon::k409Conflict); }
std::string text(const Json::Value &body,const char *key,size_t limit=120)
{
    if (!body[key].isString() || body[key].asString().empty() || body[key].asString().size()>limit) correctionError(std::string(key)+" 缺失或格式不正确");
    return body[key].asString();
}
Json::Value records(const Json::Value &value) { return value.isArray()?value:Json::Value(Json::arrayValue); }
Json::Value findRecord(const Json::Value &items,const char *key,const std::string &id)
{
    for (const auto &item : records(items)) if (item.get(key,"").asString()==id) return item;
    return Json::nullValue;
}
std::map<std::string,Json::Value> attendanceMap(const Json::Value &items)
{
    if (!items.isArray() || items.empty() || items.size()>500) correctionError("请逐人确认本课次的出勤与扣课");
    std::map<std::string,Json::Value> out;
    for (const auto &item : items) {
        const auto id=text(item,"student_id"),status=text(item,"status");
        if (status!="present"&&status!="absent"&&status!="leave"&&status!="makeup") correctionError("出勤状态不正确");
        if (!item["charge"].isInt()||item["charge"].asInt()<0||item["charge"].asInt()>10) correctionError("扣课次数应为 0～10 的整数");
        if (out.contains(id)) correctionError("更正名单中有重复学员");
        Json::Value row(Json::objectValue); row["student_id"]=id; row["status"]=status; row["charge"]=item["charge"];
        row["course_package_id"]=item["charge"].asInt()?text(item,"course_package_id"):"";
        out[id]=row;
    }
    return out;
}
Json::Value asArray(const std::map<std::string,Json::Value> &values) { Json::Value out(Json::arrayValue); for (const auto &[id,row]:values) out.append(row); return out; }
}

Json::Value InstitutionService::correctLessonSettlement(const std::string &userId,const Json::Value &roles,
    const std::string &orgId,const std::string &groupId,const std::string &lessonId,const Json::Value &payload,bool commit)
{
    if (!canManageInstitution(institutionRolesForOrganization(organizationRepository_,userId,roles,orgId)))
        throw common::AppException("FORBIDDEN","仅当前机构管理员可以更正已结算课次",drogon::k403Forbidden);
    lessons(userId,roles,orgId,groupId);
    const auto reason=text(payload,"reason",2000),requestId=text(payload,"request_id");
    if (std::all_of(reason.begin(),reason.end(),[](unsigned char c){return std::isspace(c);})) correctionError("请填写具体的更正原因");
    if (!payload["expected_revision"].isUInt64()) correctionError("请重新读取课次更正版本");
    const auto requested=attendanceMap(payload["attendance"]); const auto normalized=asArray(requested);
    Json::Value result(Json::objectValue);
    const auto apply=[&](Json::Value &org) {
        auto lessons=records(org["lessons"]),lesson=findRecord(lessons,"lesson_id",lessonId);
        if (lesson.isNull()||lesson.get("group_id","").asString()!=groupId||lesson.get("status","").asString()!="completed") correctionError("只能更正本班已结算的课次");
        for (const auto &prior:records(lesson["attendance_corrections"])) if (prior.get("request_id","").asString()==requestId) {
            if (prior.get("created_by","").asString()!=userId||prior["requested_attendance"]!=normalized||prior["reason"]!=reason||prior["expected_revision"]!=payload["expected_revision"])
                throw common::AppException("IDEMPOTENCY_CONFLICT","该更正请求编号已用于其他内容，请重新打开更正表单",drogon::k409Conflict);
            result["replayed"]=true; result["correction"]=prior; result["lesson"]=lesson; result["organization_revision"]=org.get("workflow_revision",Json::UInt64(0)); return;
        }
        const auto revision=lesson.get("attendance_revision",Json::UInt64(0)).asUInt64();
        if (payload["expected_revision"].asUInt64()!=revision) staleCorrection();
        if (commit&&(!payload["expected_organization_revision"].isUInt64()||payload["expected_organization_revision"].asUInt64()!=org.get("workflow_revision",Json::UInt64(0)).asUInt64())) staleCorrection();
        const auto before=attendanceMap(effectiveLessonAttendance(lesson));
        if (before.size()!=requested.size()) correctionError("不能通过更正增加或删除历史授课学员");
        for (const auto &[id,row]:before) if (!requested.contains(id)) correctionError("更正名单必须与原授课名单一致");
        auto packages=records(org["course_packages"]),ledger=records(org["lesson_ledger"]);
        const auto correctionId=commit?common::generateOpaqueId("lc_"):"preview";
        const auto now=common::nowIso8601(); Json::Value changes(Json::arrayValue),ledgerIds(Json::arrayValue),affected(Json::arrayValue);
        const auto packageFor=[&](const std::string &id,const std::string &student)->Json::Value& {
            for (auto &account:packages) if (account.get("course_package_id","").asString()==id) {
                if (account.get("record_type","assignment").asString()!="assignment"||account.get("student_id","").asString()!=student) correctionError("更正只能使用该学员的课时账户");
                return account;
            }
            correctionError("关联课时账户不存在，不能自动更正"); throw std::logic_error("unreachable");
        };
        const auto appendLedger=[&](const std::string &student,const std::string &account,int change,int balance,const std::string &type,const std::string &reverses="") {
            Json::Value entry(Json::objectValue); entry["ledger_id"]=commit?common::generateOpaqueId("ll_"):"preview-"+std::to_string(ledgerIds.size());
            entry["student_id"]=student; entry["course_package_id"]=account; entry["lesson_id"]=lessonId; entry["lesson_title"]=lesson["title"];
            entry["change"]=change; entry["balance_after"]=balance; entry["type"]=type; entry["correction_id"]=correctionId; entry["reason"]="课次账目更正";
            entry["reverses_ledger_id"]=reverses; entry["created_at"]=now; entry["created_by"]=userId;
            ledger.append(entry); ledgerIds.append(entry["ledger_id"]);
        };
        for (const auto &[student,after]:requested) {
            const auto &old=before.at(student); if (old==after) continue;
            const int oldCharge=old["charge"].asInt(),newCharge=after["charge"].asInt();
            const auto oldAccount=old["course_package_id"].asString(),newAccount=after["course_package_id"].asString();
            // A settlement may only reverse the currently effective, traceable charge.
            std::map<std::string,int> net;
            std::string reverses;
            for (const auto &entry:ledger) if (entry.get("lesson_id","").asString()==lessonId&&entry.get("student_id","").asString()==student) {
                net[entry.get("course_package_id","").asString()]+=entry.get("change",0).asInt();
                if (entry.get("course_package_id","").asString()==oldAccount&&entry.get("change",0).asInt()==-oldCharge&&oldCharge) reverses=entry.get("ledger_id","").asString();
            }
            for (const auto &[account,balance]:net) if (balance!=(account==oldAccount?-oldCharge:0)) correctionError("原始扣课流水与课次不一致，请先核对账目");
            if (oldCharge&&(net[oldAccount]!=-oldCharge||reverses.empty())) correctionError("缺少可核对的原始扣课流水，不能自动更正");
            Json::Value change(Json::objectValue); change["student_id"]=student; change["before"]=old; change["after"]=after;
            if (oldCharge) {
                auto &account=packageFor(oldAccount,student); const int used=account.get("used_lessons",0).asInt();
                if (used<oldCharge) correctionError("账户累计已用课时与扣课记录不一致");
                account["used_lessons"]=used-oldCharge; account["remaining_lessons"]=account.get("remaining_lessons",0).asInt()+oldCharge; account["updated_at"]=now;
                if (account.get("status","active").asString()=="depleted") account["status"]="active";
                appendLedger(student,oldAccount,oldCharge,account["remaining_lessons"].asInt(),"settlement_reversal",reverses);
            }
            if (newCharge) {
                auto &account=packageFor(newAccount,student); const int remaining=account.get("remaining_lessons",0).asInt();
                const bool refundOnly=newAccount==oldAccount&&newCharge<=oldCharge;
                const auto status=account.get("status","active").asString(),expiry=account.get("expires_at","").asString();
                if (!refundOnly&&(status!="active"||(!expiry.empty()&&(expiry.size()==10?expiry<now.substr(0,10):expiry<now)))) correctionError("新增扣课需要正常且未到期的课时账户");
                if (remaining<newCharge) correctionError("更正后的课时余额不足");
                account["remaining_lessons"]=remaining-newCharge; account["used_lessons"]=account.get("used_lessons",0).asInt()+newCharge; account["updated_at"]=now;
                if (remaining==newCharge&&status=="active") account["status"]="depleted";
                appendLedger(student,newAccount,-newCharge,remaining-newCharge,"settlement_correction");
            }
            changes.append(change); affected.append(student);
        }
        if (changes.empty()) correctionError("没有需要更正的出勤或扣课变化");
        Json::Value correction(Json::objectValue); correction["correction_id"]=correctionId; correction["request_id"]=requestId; correction["reason"]=reason;
        correction["expected_revision"]=payload["expected_revision"]; correction["revision"]=Json::UInt64(revision+1); correction["before_attendance"]=asArray(before);
        correction["requested_attendance"]=normalized; correction["after_attendance"]=normalized; correction["changes"]=changes; correction["ledger_ids"]=ledgerIds;
        correction["created_at"]=now; correction["created_by"]=userId;
        result["correction"]=correction; result["organization_revision"]=org.get("workflow_revision",Json::UInt64(0)); result["replayed"]=false;
        result["balances"]=Json::arrayValue;
        std::set<std::string> accountIds;
        for (const auto &change:changes) for (const auto *part:{"before","after"}) if (change[part]["charge"].asInt()) accountIds.insert(change[part]["course_package_id"].asString());
        for (const auto &account:packages) if (accountIds.contains(account["course_package_id"].asString())) { Json::Value balance; balance["course_package_id"]=account["course_package_id"]; balance["title"]=account.get("title",""); balance["remaining_lessons"]=account["remaining_lessons"]; result["balances"].append(balance); }
        lesson["corrected_attendance"]=normalized; lesson["attendance_revision"]=Json::UInt64(revision+1);
        lesson["attendance_corrections"]=records(lesson["attendance_corrections"]); lesson["attendance_corrections"].append(correction);
        lesson["updated_at"]=now; lesson["updated_by"]=userId; result["lesson"]=lesson;
        if (!commit) return;
        for (auto &row:lessons) if (row["lesson_id"].asString()==lessonId) row=lesson;
        org["lessons"]=lessons; org["course_packages"]=packages; org["lesson_ledger"]=ledger;
        const auto group=findRecord(org["learning_groups"],"learning_group_id",groupId);
        for (const auto &student:affected) {
            Json::Value notice(Json::objectValue); notice["id"]=common::generateOpaqueId("course_"); notice["lesson_id"]=lessonId;
            notice["title"]="课时记录已更正"; notice["message"]=lesson["title"].asString()+" · 你的出勤或扣课已更正，请查看课程与课时明细。"; notice["created_at"]=now; notice["recipients"]=Json::arrayValue; notice["recipients"].append(student);
            org["course_notifications"]=records(org["course_notifications"]); org["course_notifications"].append(notice);
        }
        Json::Value staffNotice(Json::objectValue); staffNotice["id"]=common::generateOpaqueId("course_"); staffNotice["lesson_id"]=lessonId;
        staffNotice["title"]="课次结算已更正"; staffNotice["message"]=lesson["title"].asString()+" · 管理员已更正出勤或扣课，请查看课次记录。";
        staffNotice["created_at"]=now; staffNotice["recipients"]=Json::arrayValue;
        for (const auto &entry:records(group["enrollments"])) if (entry.get("status","active").asString()=="active"&&entry.get("role","student").asString()!="student") staffNotice["recipients"].append(entry["user_id"]);
        if (!staffNotice["recipients"].empty()) org["course_notifications"].append(staffNotice);
        if (org["course_notifications"].size()>2000) { Json::Value recent(Json::arrayValue); for (Json::ArrayIndex i=org["course_notifications"].size()-2000;i<org["course_notifications"].size();++i) recent.append(org["course_notifications"][i]); org["course_notifications"]=recent; }
        Json::Value details(Json::objectValue); details["lesson_id"]=lessonId; details["group_id"]=groupId; details["correction"]=correction;
        org=appendOrganizationAuditEntry(org,userId,"institution.lesson.corrected","更正已结算课次与课时",details);
    };
    // A replay normally returns without even advancing the organization revision.
    auto snapshot=organizationRepository_.findOrganization(orgId);
    const auto existing=findRecord(snapshot["lessons"],"lesson_id",lessonId);
    const bool replay=std::any_of(existing["attendance_corrections"].begin(),existing["attendance_corrections"].end(),[&](const Json::Value &row){return row.get("request_id","").asString()==requestId;});
    if (!commit||replay) apply(snapshot); else organizationRepository_.updateOrganization(orgId,apply);
    return result;
}
}
