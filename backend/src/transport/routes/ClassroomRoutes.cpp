#include <string>
#include <vector>

#include <drogon/HttpAppFramework.h>

#include "transport/RouteUtils.h"
#include "transport/routes/Routes.h"

using namespace drogon;

namespace transport::routes
{
// ---------------------------------------------------------------------------
// 班级与作业 路由（业务功能 6）
//   班级：
//     POST   /api/v1/classrooms                          创建（teacher/orgAdmin/superAdmin）
//     GET    /api/v1/me/classrooms                       我的班级（学生或教师视角）
//     GET    /api/v1/classrooms/{id}                     详情（成员可见）
//     PATCH  /api/v1/classrooms/{id}                     更新 name/description/student_ids（owner+）
//     DELETE /api/v1/classrooms/{id}                     删除（owner+）
//     POST   /api/v1/classrooms/{id}/members             批量加学生（owner+）
//     DELETE /api/v1/classrooms/{id}/members/{userId}    踢出学生（owner+）
//   作业：
//     POST   /api/v1/classrooms/{id}/assignments         创建（owner+）
//     GET    /api/v1/classrooms/{id}/assignments         列表（成员可见）
//     PATCH  /api/v1/assignments/{id}                    更新（owner+；只校简单存在）
//     DELETE /api/v1/assignments/{id}                    删除（owner+）
//     GET    /api/v1/me/assignments                      我的作业（聚合所有班级）
// ---------------------------------------------------------------------------

namespace
{
// 班级 owner 守卫：当前用户必须是该班级的 teacher_user_id 或 superAdmin/orgAdmin
//   - 因为 Service 内部不持有 session，所以这里直接读 classroom 比对
void requireClassOwnerOrAdmin(application::services::ClassroomService &svc,
                              const Json::Value &session,
                              const std::string &classId)
{
    // 角色快速放行：超管/机构管理员
    const auto &roles = session["roles"];
    if (roles.isArray())
    {
        for (const auto &r : roles)
        {
            const auto s = r.asString();
            if (s == "superAdmin" || s == "orgAdmin")
            {
                return;
            }
        }
    }
    const auto userId = session.get("user_id", session.get("id", "")).asString();
    auto c = svc.getClassroom(classId);  // 不存在会抛 404
    if (c.get("teacher_user_id", "").asString() != userId)
    {
        throw common::AppException("FORBIDDEN", "仅班级教师可执行此操作", drogon::k403Forbidden);
    }
}
}  // namespace

void registerClassroomRoutes(const AppContext &ctx)
{
    // 创建班级
    app().registerHandler(
        "/api/v1/classrooms",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                requireRole(session, {"teacher", "orgAdmin", "superAdmin"}, "需要教师或管理员权限");
                const auto name = body.get("name", "").asString();
                const auto description = body.get("description", "").asString();
                const auto orgId = body.get("org_id", "").asString();
                return common::ok(req, ctx.classroomService->createClassroom(userId, orgId, name, description));
            });
        },
        {Post});

    // 我的班级
    app().registerHandler(
        "/api/v1/me/classrooms",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(req, ctx.classroomService->listMyClassrooms(userId));
            });
        },
        {Get});

    // 详情
    app().registerHandler(
        "/api/v1/classrooms/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                if (!ctx.classroomService->isClassMember(classId, userId))
                {
                    // 非成员需管理员
                    requireRole(session, {"orgAdmin", "superAdmin"}, "无权查看该班级");
                }
                return common::ok(req, ctx.classroomService->getClassroom(classId));
            });
        },
        {Get});

    // 更新
    app().registerHandler(
        "/api/v1/classrooms/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireClassOwnerOrAdmin(*ctx.classroomService, session, classId);
                return common::ok(req, ctx.classroomService->updateClassroom(classId, body));
            });
        },
        {Patch});

    // 删除
    app().registerHandler(
        "/api/v1/classrooms/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireClassOwnerOrAdmin(*ctx.classroomService, session, classId);
                return common::ok(req, ctx.classroomService->removeClassroom(classId));
            });
        },
        {Delete});

    // 批量加学生
    app().registerHandler(
        "/api/v1/classrooms/{1}/members",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireClassOwnerOrAdmin(*ctx.classroomService, session, classId);
                std::vector<std::string> userIds;
                if (body.isMember("user_ids") && body["user_ids"].isArray())
                {
                    for (const auto &v : body["user_ids"])
                    {
                        userIds.push_back(v.asString());
                    }
                }
                return common::ok(req, ctx.classroomService->addMembers(classId, userIds));
            });
        },
        {Post});

    // 踢出学生
    app().registerHandler(
        "/api/v1/classrooms/{1}/members/{2}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId,
              std::string userId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireClassOwnerOrAdmin(*ctx.classroomService, session, classId);
                return common::ok(req, ctx.classroomService->removeMember(classId, userId));
            });
        },
        {Delete});

    // 创建作业
    app().registerHandler(
        "/api/v1/classrooms/{1}/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                requireClassOwnerOrAdmin(*ctx.classroomService, session, classId);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                return common::ok(req,
                                  ctx.classroomService->createAssignment(
                                      classId,
                                      userId,
                                      body.get("exam_id", "").asString(),
                                      body.get("title", "").asString(),
                                      body.get("description", "").asString(),
                                      body.get("due_at", "").asString()));
            });
        },
        {Post});

    // 列出班级作业
    app().registerHandler(
        "/api/v1/classrooms/{1}/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string classId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                if (!ctx.classroomService->isClassMember(classId, userId))
                {
                    requireRole(session, {"orgAdmin", "superAdmin"}, "无权查看该班级作业");
                }
                return common::ok(req, ctx.classroomService->listAssignmentsByClass(classId));
            });
        },
        {Get});

    // 更新作业
    app().registerHandler(
        "/api/v1/assignments/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto body = parseJsonBody(req);
                const auto session = requireSession(*ctx.authService, req, &body);
                // 只允许教师/管理员更新；通过定位作业找到 classId 再校验
                // 简化：要求 superAdmin/orgAdmin/teacher 角色
                requireRole(session,
                            {"teacher", "orgAdmin", "superAdmin"},
                            "需要教师或管理员权限");
                return common::ok(req, ctx.classroomService->updateAssignment(assignmentId, body));
            });
        },
        {Patch});

    // 删除作业
    app().registerHandler(
        "/api/v1/assignments/{1}",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback,
              std::string assignmentId) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                requireRole(session,
                            {"teacher", "orgAdmin", "superAdmin"},
                            "需要教师或管理员权限");
                return common::ok(req, ctx.classroomService->removeAssignment(assignmentId));
            });
        },
        {Delete});

    // 我的作业
    app().registerHandler(
        "/api/v1/me/assignments",
        [ctx](const HttpRequestPtr &req,
              std::function<void(const HttpResponsePtr &)> &&callback) {
            handleRequest(req, std::move(callback), [&]() {
                const auto session = requireSession(*ctx.authService, req);
                const auto userId = session.get("user_id", session.get("id", "")).asString();
                requireFeature(*ctx.featureFlagService, "classrooms", userId);
                return common::ok(req, ctx.classroomService->listMyAssignments(userId));
            });
        },
        {Get});
}
}  // namespace transport::routes
