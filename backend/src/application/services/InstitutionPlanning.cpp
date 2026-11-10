#include "InstitutionService.h"
#include "InstitutionAccess.h"
#include "AssignmentScope.h"
#include "common/AppException.h"
#include "common/IdGenerator.h"
#include "common/TimeUtils.h"
#include <algorithm>
#include <set>
#include <drogon/HttpTypes.h>

namespace application::services {
namespace {
Json::Value rows(const Json::Value &value) { return value.isArray()?value:Json::Value(Json::arrayValue); }
void invalidPlan(const std::string &message) { throw common::AppException("VALIDATION_ERROR",message,drogon::k422UnprocessableEntity); }
void stalePlan() { throw common::AppException("PLANNING_CONFLICT","班级或课次已变化，请重新预览后确认",drogon::k409Conflict); }
std::string text(const Json::Value &body,const char *key,bool required=true) {
    if (!body[key].isString() || body[key].asString().size()>2000 || (required&&body[key].asString().find_first_not_of(" \t\n\r")==std::string::npos)) invalidPlan(std::string(key)+" 缺失或格式不正确");
    return body[key].asString();
}
Json::Value findRow(const Json::Value &items,const char *key,const std::string &id) { for (const auto &row:rows(items)) if (row.get(key,"").asString()==id) return row; return Json::nullValue; }
bool has(const Json::Value &items,const std::string &id) { for (const auto &value:rows(items)) if (value.isString()&&value.asString()==id) return true; return false; }
void appendNotice(Json::Value &org,const std::string &title,const std::string &message,const Json::Value &recipients) {
    Json::Value notice; notice["id"]=common::generateOpaqueId("course_"); notice["title"]=title; notice["message"]=message; notice["recipients"]=recipients; notice["created_at"]=common::nowIso8601();
    auto list=rows(org["course_notifications"]); list.append(notice);
    if (list.size()>2000) { Json::Value kept(Json::arrayValue); for (Json::ArrayIndex i=list.size()-2000;i<list.size();++i) kept.append(list[i]); list=kept; } org["course_notifications"]=list;
}
bool replayPlan(const Json::Value &org,const std::string &field,const std::string &requestId,const std::string &actor,const Json::Value &input,Json::Value &result) {
    for (const auto &entry:rows(org[field])) if (entry.get("request_id","").asString()==requestId) {
        if (entry.get("created_by","").asString()!=actor||entry["input"]!=input) throw common::AppException("IDEMPOTENCY_CONFLICT","请求编号已用于其他内容，请重新打开表单",drogon::k409Conflict);
        result=entry["result"]; result["replayed"]=true; return true;
    } return false;
}
void saveReceipt(Json::Value &org,const std::string &field,const std::string &id,const std::string &actor,const Json::Value &input,const Json::Value &result) {
    Json::Value entry; entry["request_id"]=id; entry["created_by"]=actor; entry["created_at"]=common::nowIso8601(); entry["input"]=input; entry["result"]=result;
    org[field]=rows(org[field]); org[field].append(entry);
}
}

Json::Value InstitutionService::saveLessonBatch(const std::string &userId,const Json::Value &roles,const std::string &orgId,const std::string &groupId,const Json::Value &payload,bool commit) {
    lessons(userId,roles,orgId,groupId);
    const auto requestId=text(payload,"request_id");
    if (requestId.size()>120||!payload["items"].isArray()||payload["items"].empty()||payload["items"].size()>52) invalidPlan("每次安排 1～52 节课，请重新预览");
    Json::Value input; input["group_id"]=groupId; input["items"]=Json::arrayValue;
    for (const auto &row:payload["items"]) { if (!row.isObject()) invalidPlan("课次格式不正确"); Json::Value item(Json::objectValue); for (const auto *key:{"title","starts_at","ends_at","student_ids","assignment_id"}) if (row.isMember(key)) item[key]=row[key]; item["status"]="scheduled"; input["items"].append(item); }
    Json::Value result;
    const auto apply=[&](Json::Value &org) {
        if (replayPlan(org,"lesson_batches",requestId,userId,input,result)) return;
        if (commit&&(!payload["expected_revision"].isUInt64()||payload["expected_revision"].asUInt64()!=org.get("workflow_revision",Json::UInt64(0)).asUInt64())) stalePlan();
        result=Json::objectValue; result["items"]=Json::arrayValue; result["conflicts"]=Json::arrayValue; result["revision"]=org.get("workflow_revision",Json::UInt64(0)); result["replayed"]=false;
        for (Json::ArrayIndex i=0;i<input["items"].size();++i) {
            auto candidate=org;
            try { auto saved=applyLesson(userId,orgId,groupId,candidate,input["items"][i]); org=std::move(candidate); result["items"].append(saved); }
            catch (const common::AppException &error) { Json::Value conflict; conflict["index"]=i; conflict["title"]=input["items"][i]["title"]; conflict["code"]=error.code(); conflict["message"]=error.message(); result["conflicts"].append(conflict); }
        }
        result["can_commit"]=result["conflicts"].empty();
        if (commit) {
            if (!result["can_commit"].asBool()) throw common::AppException("BATCH_SCHEDULE_CONFLICT","存在冲突或无效课次，未保存任何课次，请重新预览",drogon::k409Conflict);
            saveReceipt(org,"lesson_batches",requestId,userId,input,result);
        }
    };
    auto snapshot=organizationRepository_.findOrganization(orgId);
    if (!commit||replayPlan(snapshot,"lesson_batches",requestId,userId,input,result)) { if (!result.get("replayed",false).asBool()) apply(snapshot); }
    else organizationRepository_.updateOrganization(orgId,apply);
    return result;
}

Json::Value InstitutionService::changeTeachingRelationship(const std::string &userId,const Json::Value &roles,const std::string &orgId,const std::string &groupId,const Json::Value &payload,bool commit) {
    if (!canManageInstitution(institutionRolesForOrganization(organizationRepository_,userId,roles,orgId))) throw common::AppException("FORBIDDEN","仅本机构管理员可以变更授课关系",drogon::k403Forbidden);
    lessons(userId,roles,orgId,groupId);
    const auto actor=text(payload,"member_id"),kind=text(payload,"kind"),reason=text(payload,"reason"),requestId=text(payload,"request_id");
    for (const auto *key:{"target_group_id","replacement_id","followup_owner_id"}) if (payload.isMember(key)&&!payload[key].isString()) invalidPlan("目标成员或班级格式不正确");
    if (payload.isMember("include_target_lessons")&&!payload["include_target_lessons"].isBool()) invalidPlan("是否加入课次必须为布尔值");
    if (activeInstitutionMembership(organizationRepository_,actor,orgId).isNull()) invalidPlan("原成员已不在当前机构，请先核对成员关系");
    if (requestId.size()>120||(kind!="leave"&&kind!="transfer"&&kind!="replace_teacher")) invalidPlan("请选择离班、转班或更换教师");
    const auto destination=payload.get("target_group_id","").asString(),replacement=payload.get("replacement_id","").asString(),followupOwner=payload.get("followup_owner_id","").asString();
    const auto followupPerson=userRepository_.findUserById(followupOwner);
    const bool validFollowupOwner=!followupOwner.empty()&&!activeInstitutionMembership(organizationRepository_,followupOwner,orgId).isNull()&&!followupPerson.isNull()&&followupPerson.get("status","active").asString()=="active";
    if (kind=="replace_teacher") {
        const auto membership=activeInstitutionMembership(organizationRepository_,replacement,orgId);
        const auto person=userRepository_.findUserById(replacement);
        if (replacement==actor||person.isNull()||person.get("status","active").asString()!="active"||membership.isNull()||!(institutionHasRole(membership["roles"],"teacher")||institutionHasRole(membership["roles"],"assistant")||institutionHasRole(membership["roles"],"orgAdmin"))) invalidPlan("接任人必须是当前机构的有效授课职员");
    }
    Json::Value input; input["group_id"]=groupId; input["member_id"]=actor; input["kind"]=kind; input["reason"]=reason; input["target_group_id"]=destination; input["replacement_id"]=replacement; input["followup_owner_id"]=followupOwner; input["include_target_lessons"]=payload.get("include_target_lessons",false).asBool();
    Json::Value result;
    const auto apply=[&](Json::Value &org) {
        if (replayPlan(org,"relationship_changes",requestId,userId,input,result)) return;
        if (commit&&(!payload["expected_revision"].isUInt64()||payload["expected_revision"].asUInt64()!=org.get("workflow_revision",Json::UInt64(0)).asUInt64())) stalePlan();
        auto groups=rows(org["learning_groups"]),group=findRow(groups,"learning_group_id",groupId);
        auto enrollment=findRow(group["enrollments"],"user_id",actor); const auto role=enrollment.get("role","student").asString();
        if (enrollment.isNull()||enrollment.get("status","active").asString()!="active") invalidPlan("该成员已离班，请刷新当前关系");
        if ((kind=="transfer"&&role!="student")||(kind=="replace_teacher"&&role=="student")) invalidPlan("操作与成员身份不符");
        auto target=findRow(groups,"learning_group_id",destination);
        if (kind=="transfer"&&(destination==groupId||target.isNull()||target.get("status","active").asString()!="active")) invalidPlan("请选择本机构另一个正常班级");
        if (kind=="transfer") { const auto prior=findRow(target["enrollments"],"user_id",actor); if (!prior.isNull()&&prior.get("status","active").asString()=="active") invalidPlan("学员已经在目标班级，请先核对成员关系"); }
        result=Json::objectValue; result["revision"]=org.get("workflow_revision",Json::UInt64(0)); result["replayed"]=false; result["affected_lessons"]=Json::arrayValue; result["pending_assignments"]=Json::arrayValue; result["blockers"]=Json::arrayValue; result["account_balances"]=Json::arrayValue;
        if (role=="student") for (const auto &assignment:assignmentRepository_.listByLearningGroup(groupId)) if (assignmentTargetsStudent(assignment,actor)) {
            const auto submission=assignment["submissions"][actor];
            if (submission.isNull()||!submission.isMember("submitted_at")||submission.get("review_status",submission.get("status","")).asString()=="returned") { Json::Value item; item["title"]=assignment["title"]; item["assignment_id"]=assignment["assignment_id"]; result["pending_assignments"].append(item); }
        }
        if (!result["pending_assignments"].empty()) result["blockers"].append("原班仍有未提交或需重做作业，请先完成，避免离班后失去作答入口。");
        for (const auto &account:rows(org["course_packages"])) if (account.get("student_id","").asString()==actor) { Json::Value balance; balance["title"]=account["title"]; balance["remaining_lessons"]=account["remaining_lessons"]; result["account_balances"].append(balance); }
        const auto oldStaff=learningGroupStaffIds(group); const auto oldStudents=learningGroupStudentIds(group);
        for (auto &entry:group["enrollments"]) if (entry["user_id"].asString()==actor) { entry["status"]="inactive"; entry["ended_at"]=common::nowIso8601(); entry["ended_by"]=userId; }
        const auto activate=[&](Json::Value &g,const std::string &member,const std::string &memberRole) {
            auto entries=rows(g["enrollments"]); auto entry=findRow(entries,"user_id",member); if (entry.isNull()) { entry["enrollment_id"]=common::generateOpaqueId("enr_"); entry["created_at"]=common::nowIso8601(); entry["created_by"]=userId; }
            entry["user_id"]=member; entry["role"]=memberRole; entry["status"]="active"; entry["organization_id"]=orgId; entry["group_id"]=g["learning_group_id"]; entry["learning_group_id"]=g["learning_group_id"]; entry.removeMember("ended_at"); entry.removeMember("ended_by");
            bool replaced=false; for (auto &existing:entries) if (existing["user_id"]==entry["user_id"]) { existing=entry; replaced=true; } if (!replaced) entries.append(entry); g["enrollments"]=entries;
        };
        if (kind=="replace_teacher") activate(group,replacement,role);
        if (kind=="transfer") activate(target,actor,"student");
        if (role!="student"&&kind=="leave"&&learningGroupStaffIds(group).empty()) {
            for (const auto &assignment:assignmentRepository_.listByLearningGroup(groupId)) {
                bool pending=false;
                for (const auto &student:oldStudents) if (assignmentTargetsStudent(assignment,student)) { const auto submission=assignment["submissions"][student]; if (submission.isNull()||submission.get("review_status","").asString()!="reviewed") pending=true; }
                if (pending) { result["blockers"].append("原班仍有待完成或待批改作业，请通过“更换教师”指定接任人。"); break; }
            }
        }
        for (auto &g:groups) { if (g["learning_group_id"].asString()==groupId) g=group; if (kind=="transfer"&&g["learning_group_id"].asString()==destination) g=target; }
        org["learning_groups"]=groups;
        const auto existingLessons=rows(org["lessons"]); const auto now=common::nowIso8601();
        for (const auto &lesson:existingLessons) {
            const auto gid=lesson.get("group_id","").asString();
            if (gid==groupId&&lesson.get("status","").asString()=="completed"&&!lesson["teacher_ids"].isArray()) for (auto &stored:org["lessons"]) if (stored["lesson_id"]==lesson["lesson_id"]) { stored["teacher_ids"]=Json::arrayValue; for (const auto &staff:oldStaff) stored["teacher_ids"].append(staff); }
            if (lesson.get("status","").asString()!="scheduled") continue;
            if (gid==groupId&&lesson.get("starts_at","").asString()<=now) { if (role!="student"||has(lesson["student_ids"],actor)) result["blockers"].append("原班存在已开始或已结束但未结算的课次，请先结算出勤。"); continue; }
            auto changed=lesson; bool affected=false;
            if (gid==groupId) {
                if (role=="student") { Json::Value selected(Json::arrayValue); auto ids=lesson["student_ids"]; if (!ids.isArray()) { ids=Json::arrayValue; for (const auto &id:oldStudents) ids.append(id); } for (const auto &id:ids) if (id.asString()!=actor) selected.append(id); affected=has(ids,actor); changed["student_ids"]=selected; if (selected.empty()) changed["status"]="cancelled"; }
                else { affected=true; if (learningGroupStaffIds(group).empty()) result["blockers"].append("原班还有未来课程，请先指定接任教师。"); }
            } else if (kind=="transfer"&&input["include_target_lessons"].asBool()&&gid==destination) { if (lesson.get("starts_at","").asString()<=now) { result["blockers"].append("目标班存在未结算课次，请先结算或取消加入目标已排课次。"); continue; } auto ids=lesson["student_ids"]; if (!ids.isArray()) { ids=Json::arrayValue; for (const auto &id:learningGroupStudentIds(target)) if (id!=actor) ids.append(id); } if (!has(ids,actor)) ids.append(actor); changed["student_ids"]=ids; affected=true; }
            if (affected) { Json::Value effect; effect["lesson_id"]=lesson["lesson_id"]; effect["title"]=lesson["title"]; effect["starts_at"]=lesson["starts_at"]; effect["action"]=changed["status"].asString()=="cancelled"?"cancel":"update"; result["affected_lessons"].append(effect);
                try { applyLesson(userId,orgId,gid,org,changed); } catch (const common::AppException &error) { result["blockers"].append(error.message()); }
            }
        }
        // Replacement teachers inherit access to the class's existing homework.
        // Follow-ups outside this class remain with their existing owner.
        result["followups_transferred"]=0;
        if (role=="student") {
            const auto targetStaff=learningGroupStaffIds(target);
            for (auto &followup:org["followups"]) if (followup.get("student_id","").asString()==actor&&followup.get("status","").asString()!="completed"&&std::find(oldStaff.begin(),oldStaff.end(),followup.get("owner_id","").asString())!=oldStaff.end()) {
                if (kind!="transfer"||!validFollowupOwner||std::find(targetStaff.begin(),targetStaff.end(),followupOwner)==targetStaff.end()) { result["blockers"].append(kind=="transfer"?"该学员有原班老师负责的未完成跟进，请选择目标班教师或助教作为接任负责人。":"该学员仍有原班老师负责的未完成跟进，请先完成跟进或办理转班交接。"); continue; }
                auto history=followup; history.removeMember("history"); followup["history"]=rows(followup["history"]); followup["history"].append(history); followup["owner_id"]=followupOwner; followup["updated_by"]=userId; followup["updated_at"]=now; result["followups_transferred"]=result["followups_transferred"].asInt()+1;
            }
        }
        if (kind=="replace_teacher") for (auto &followup:org["followups"]) if (followup.get("owner_id","").asString()==actor&&followup.get("status","").asString()!="completed"&&std::find(oldStudents.begin(),oldStudents.end(),followup.get("student_id","").asString())!=oldStudents.end()) {
            auto history=followup; history.removeMember("history"); followup["history"]=rows(followup["history"]); followup["history"].append(history); followup["owner_id"]=replacement; followup["updated_by"]=userId; followup["updated_at"]=now; result["followups_transferred"]=result["followups_transferred"].asInt()+1;
        }
        result["can_commit"]=result["blockers"].empty(); result["message"]="保留原班历史出勤、扣课流水和补课关联；同机构课时账户及余额保持不变。原作业不复制到新班。";
        if (kind=="transfer"&&!input["include_target_lessons"].asBool()) result["message"]=result["message"].asString()+"本次不加入目标班已排课次；需要参加时请勾选后重新预览。";
        if (commit) {
            if (!result["can_commit"].asBool()) throw common::AppException("HANDOFF_REQUIRED","仍有未完成事项或排课冲突，未修改任何关系，请重新预览",drogon::k409Conflict);
            Json::Value recipients(Json::arrayValue); recipients.append(actor); if (!replacement.empty()) recipients.append(replacement);
            appendNotice(org,"班级关系已变更",group["name"].asString()+" · 请查看最新课程与班级安排。",recipients);
            Json::Value details=input; details["impact"]=result; org=appendOrganizationAuditEntry(org,userId,"institution.relationship.changed","变更班级成员与授课关系",details);
            saveReceipt(org,"relationship_changes",requestId,userId,input,result);
        }
    };
    auto snapshot=organizationRepository_.findOrganization(orgId);
    if (!commit||replayPlan(snapshot,"relationship_changes",requestId,userId,input,result)) { if (!result.get("replayed",false).asBool()) apply(snapshot); }
    else organizationRepository_.updateOrganization(orgId,apply);
    return result;
}
}
