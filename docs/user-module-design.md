# 用户模块设计稿

## 文档目标

本文档用于固定当前版本的用户模块设计方向，避免后续把账号类型、角色权限、订阅套餐混在一起。

当前结论：

- `business` 和 `school` 不应作为套餐名。
- `free / pro / ultra` 适合作为套餐层。
- `role` 和 `plan` 必须拆开建模。
- 组织账号和个人账号应走同一套核心模型，只在业务规则上分化。

## 设计原则

### 1. 分层建模

用户模块至少拆成以下四层：

- `User`：基础身份，解决“谁在登录”
- `Profile`：个人资料，解决“展示什么信息”
- `Membership`：成员关系，解决“在哪个空间里扮演什么身份”
- `Subscription`：订阅能力，解决“买了什么服务”

### 2. 角色与套餐解耦

- `role` 决定“可以执行什么动作”
- `plan` 决定“系统开放哪些能力”
- `organization_type` 决定“当前业务场景属于企业还是学校”

不要使用“一个字段同时表达身份和付费档位”的设计。

### 3. 组织与个人共模

从软件结构上看，`business` 和 `school` 都属于组织空间，二者共用：

- 成员管理
- 角色分配
- 组织级资源
- 组织级套餐
- 邀请/审批

二者差异主要体现在业务规则：

- `business` 更关注团队、座位、账单、数据权限
- `school` 更关注班级、课程、教师/学生关系、学期

## 核心模型

### User

基础账号对象。

建议字段：

- `user_id`
- `username`
- `email`
- `phone`
- `password_hash`
- `status`: `active | disabled | pending`
- `created_at`

### Profile

个人资料与学习偏好。

建议字段：

- `user_id`
- `display_name`
- `avatar_url`
- `locale`
- `goal_level`
- `goal_date`
- `daily_target`
- `notification_enabled`

### Membership

用户在某个空间里的身份关系。

建议字段：

- `user_id`
- `scope_type`: `personal | organization`
- `scope_id`
- `organization_type`: `business | school | ""`
- `roles`

建议角色枚举第一版：

- `student`
- `teacher`
- `reviewer`
- `orgAdmin`
- `systemAdmin`
- `superAdmin`

说明：

- `student / teacher / reviewer / orgAdmin` 偏业务角色
- `systemAdmin / superAdmin` 偏平台内部角色

### Subscription

订阅与能力配置对象。

建议字段：

- `scope_type`: `personal | organization`
- `scope_id`
- `plan`: `free | pro | ultra`
- `status`: `active | expired | canceled | trial`
- `expires_at`
- `seats`
- `entitlements`

说明：

- 个人订阅挂在 `scope_type=personal`
- 组织订阅挂在 `scope_type=organization`
- 组织成员原则上继承组织套餐能力

## 关键关系

### business / school 与 plan 的关系

不推荐：

```text
plan = free | pro | ultra | business
```

推荐：

```text
organization_type = business | school
plan = free | pro | ultra
```

结论：

- `business` 和 `school` 是组织类型，不是套餐档位
- `free / pro / ultra` 是能力层套餐

### role 与 plan 的关系

`role` 和 `plan` 是两个正交维度：

- `role` 决定这个用户被允许操作什么
- `plan` 决定这个空间被开放什么能力

统一判断规则建议：

```text
final_permission = role_permission
                 ∩ plan_entitlement
                 ∩ scope_policy
```

其中：

- `role_permission`：角色权限
- `plan_entitlement`：套餐能力
- `scope_policy`：组织或系统附加规则

### 示例

- 个人用户，`role=student`，`plan=free`
  - 可访问免费题、基础做题、基础个人中心
- 个人用户，`role=student`，`plan=pro`
  - 在 `free` 基础上增加错题、收藏、学习统计、推荐
- 学校成员，`organization_type=school`，`role=teacher`，组织 `plan=ultra`
  - 可使用组织高级功能、班级数据、布置练习
- 平台内部，`role=systemAdmin`
  - 属于平台权限，不应简单等同于付费套餐

## 套餐建议

### free

- 免费题
- 基础做题
- 基础个人资料
- 基础进度查看

### pro

- 全量付费题库
- 收藏
- 错题本
- 学习统计
- 推荐练习

### ultra

- 更强分析
- 专项训练
- 导出能力
- 高级学习工具
- 组织功能入口

说明：

- `ultra` 可以保留为营销型命名
- 如果后续希望更工具化，可改名为 `expert` 或 `max`

## 推荐的第一版枚举

```json
{
  "organization_type": ["", "business", "school"],
  "plan": ["free", "pro", "ultra"],
  "role": ["student", "teacher", "reviewer", "orgAdmin", "systemAdmin", "superAdmin"]
}
```

## 推荐数据结构

### 个人用户

```json
{
  "user_id": "u_001",
  "scope_type": "personal",
  "scope_id": "u_001",
  "organization_type": "",
  "plan": "pro",
  "plan_status": "active",
  "plan_expires_at": "2026-12-31",
  "roles": ["student"]
}
```

### 组织成员

```json
{
  "user_id": "u_101",
  "scope_type": "organization",
  "scope_id": "org_001",
  "organization_type": "school",
  "plan": "ultra",
  "plan_status": "active",
  "plan_expires_at": "2026-12-31",
  "roles": ["teacher"]
}
```

备注：

- 如果成员跟随组织套餐，可不在成员对象重复存 `plan`
- 也可以通过聚合接口直接返回“当前生效套餐”

## 当前工程的落地建议

结合当前代码库，建议按以下顺序推进。

### 第一阶段：先统一模型

当前问题：

- 后端默认角色仍偏旧：`guest / user / admin`
- 前端和用户服务已开始使用：`student / teacher / reviewer / academicAdmin / systemAdmin / superAdmin`
- 订阅层仍是：`free / premium`

建议先做三件事：

1. 统一前后端角色枚举
2. 将订阅从 `free / premium` 升级为 `free / pro / ultra`
3. 订阅对象增加 `status / expires_at / entitlements`

### 第二阶段：补组织能力

在角色和套餐稳定后，再补：

- `organization_type`
- 组织成员关系
- 组织套餐继承
- 组织管理后台

## 当前推荐的最小可行版本

若优先保证开发速度，建议先做个人版 MVP：

- `scope_type=personal`
- `plan=free | pro | ultra`
- `roles=student | systemAdmin | superAdmin`

后续再扩展：

- `organization_type=business | school`
- `roles += teacher | reviewer | orgAdmin`

## 与当前代码的对应关系

现有代码中已存在以下雏形：

- 用户服务：[cpp-backend/src/application/services/UserService.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/application/services/UserService.h)
- 订阅服务：[cpp-backend/src/application/services/SubscriptionService.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/application/services/SubscriptionService.h)
- 用户仓储：[cpp-backend/src/infrastructure/storage/UserRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/UserRepository.h)
- 用户资料仓储：[cpp-backend/src/infrastructure/storage/ProfileRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/ProfileRepository.h)
- 个人中心前端：[frontend/src/viewer/personalCenter.ts](D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts)

本设计稿的作用是为这些模块后续统一改造提供约束。
