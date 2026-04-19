# 用户模块式样书

## 1. 文档目的

本文件用于固定用户模块的最终数据模型与字段职责，作为后端实现、前端展示、接口设计、数据迁移的统一依据。

目标：

- 固定用户、组织、成员关系、订阅的对象边界
- 固定角色、套餐、组织类型、业务编号之间的关系
- 固定“内部主键”和“业务编号”的职责分离

## 2. 适用范围

本式样适用于以下模块：

- 登录注册
- 微信登录 / 手机登录 / 开发测试登录
- 个人资料
- 个人中心
- 角色权限
- 套餐订阅
- 组织空间
- 组织成员管理

## 3. 术语定义

| 术语 | 含义 |
| --- | --- |
| User | 基础账号对象，表示一个可登录主体 |
| Profile | 用户资料对象，表示昵称、头像、偏好等 |
| Organization | 组织对象，表示企业或学校空间 |
| Membership | 用户在某个空间下的成员关系 |
| Subscription | 某个空间的套餐订阅信息 |
| Scope | 权限和套餐生效的空间 |
| Personal Scope | 个人空间 |
| Organization Scope | 组织空间 |
| Organization Type | 组织类型，区分 `business` 与 `school` |
| Internal ID | 系统内部主键，不携带业务语义 |
| Business Number | 业务编号，对人可见、可录入、可导入 |
| member_no | 通用业务编号 |
| student_no | 学校场景成员编号 |
| employee_no | 企业场景成员编号 |
| Role | 身份权限 |
| Plan | 套餐档位 |
| Entitlement | 套餐开放的能力项 |

## 4. 设计结论

### 4.1 固定结论

- `business` 和 `school` 不是套餐名
- `business` 和 `school` 属于组织类型
- `free / pro / ultra` 属于套餐档位
- `role` 和 `plan` 必须分离
- 个人账号与组织账号共用基础模型
- `user_id / organization_id / membership_id` 属于内部主键，不承载业务语义
- `member_no / student_no / employee_no` 属于业务编号，不可替代内部主键
- 业务编号的唯一性应定义在各自生效空间内，而不是全局唯一
- 同一用户可在不同组织空间拥有不同业务编号

### 4.2 标识符策略

最终方案采用“内部主键 + 业务编号”双层模型。

内部主键：

- `user_id`：用户内部主键
- `organization_id`：组织内部主键
- `membership_id`：成员关系内部主键

内部主键要求：

- 全局唯一
- 创建后不可变
- 不对外表达业务含义
- 推荐使用时间有序的 opaque id，例如 UUIDv7 或同等级方案
- 当前工程建议使用带前缀的 opaque id 形式：`usr_...`、`org_...`、`mem_...`

业务编号：

- `member_no`：通用成员编号
- `student_no`：学校成员编号
- `employee_no`：企业成员编号

业务编号要求：

- 面向运营、导入、展示、检索
- 可读、可录入
- 允许按组织规则生成或外部导入
- 不作为数据库或系统对象的唯一主键

### 4.3 禁止事项

禁止以下设计：

- 使用一个字段同时表示角色和套餐
- 将 `business` 作为 `plan` 的取值
- 将 `teacher`、`student` 作为套餐名
- 将平台管理角色与普通用户套餐混为一体
- 将 `user_id` 直接设计成学号、工号、手机号、微信 openid
- 将 `student_no` 或 `employee_no` 作为系统内部主键

## 5. 枚举定义

### 5.1 ScopeType

| 值 | 说明 |
| --- | --- |
| `personal` | 个人空间 |
| `organization` | 组织空间 |

### 5.2 OrganizationType

| 值 | 说明 |
| --- | --- |
| `""` | 非组织空间 |
| `business` | 企业/团队 |
| `school` | 学校/教育组织 |

### 5.3 Plan

| 值 | 说明 |
| --- | --- |
| `free` | 免费版 |
| `pro` | 专业版 |
| `ultra` | 高级版 |

### 5.4 PlanStatus

| 值 | 说明 |
| --- | --- |
| `active` | 生效中 |
| `trial` | 试用中 |
| `expired` | 已过期 |
| `canceled` | 已取消 |

### 5.5 UserStatus

| 值 | 说明 |
| --- | --- |
| `active` | 正常 |
| `disabled` | 禁用 |
| `pending` | 待完成 |

### 5.6 Role

| 值 | 类型 | 说明 |
| --- | --- | --- |
| `student` | 业务角色 | 学习者 |
| `teacher` | 业务角色 | 教师 |
| `reviewer` | 业务角色 | 阅卷/审核 |
| `orgAdmin` | 业务角色 | 组织管理员 |
| `systemAdmin` | 平台角色 | 系统管理员 |
| `superAdmin` | 平台角色 | 超级管理员 |

## 6. 对象定义

### 6.1 User

基础账号对象，只表达“这个人是谁、如何登录”，不承载组织内业务编号。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | string | 是 | 用户内部主键，推荐 `usr_<opaque-id>` |
| `username` | string | 是 | 登录名 |
| `email` | string | 否 | 邮箱 |
| `phone` | string | 否 | 手机号 |
| `password_hash` | string | 否 | 密码哈希 |
| `status` | enum(UserStatus) | 是 | 账号状态 |
| `created_at` | string | 是 | 创建时间 |
| `member_no` | string | 否 | 个人空间业务编号，可选 |

约束：

- `user_id` 不应表达学号、工号、组织类型、登录来源
- 微信 openid、手机号、用户名都不应替代 `user_id`
- 若个人空间需要对人展示编号，可使用 `member_no`

### 6.2 Profile

资料对象。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | string | 是 | 用户 ID |
| `display_name` | string | 否 | 显示名称 |
| `avatar_url` | string | 否 | 头像地址 |
| `locale` | string | 否 | 语言环境 |
| `goal_level` | string | 否 | 目标级别 |
| `goal_date` | string | 否 | 目标日期 |
| `daily_target` | number | 否 | 每日目标 |
| `notification_enabled` | boolean | 否 | 通知开关 |

### 6.3 Organization

组织空间对象。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `organization_id` | string | 是 | 组织内部主键，推荐 `org_<opaque-id>` |
| `name` | string | 是 | 组织名称 |
| `organization_type` | enum(OrganizationType) | 是 | 组织类型 |
| `created_by` | string | 是 | 创建人 `user_id` |
| `created_at` | string | 是 | 创建时间 |
| `updated_at` | string | 否 | 更新时间 |

### 6.4 Membership

成员关系对象。组织场景下的业务编号应定义在该对象上，而不是定义在 `User` 上。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `membership_id` | string | 是 | 成员关系内部主键，推荐 `mem_<opaque-id>` |
| `user_id` | string | 是 | 用户 ID |
| `scope_type` | enum(ScopeType) | 是 | 生效空间类型 |
| `scope_id` | string | 是 | 空间 ID；组织场景下为 `organization_id` |
| `organization_type` | enum(OrganizationType) | 是 | 组织类型 |
| `roles` | string[] | 是 | 角色集合 |
| `member_no` | string | 否 | 通用业务编号 |
| `student_no` | string | 否 | 学校场景业务编号 |
| `employee_no` | string | 否 | 企业场景业务编号 |
| `joined_at` | string | 否 | 加入时间 |

约束：

- 当 `scope_type=personal` 时，`organization_type` 必须为 `""`
- 当 `scope_type=organization` 时，`organization_type` 必须为 `business` 或 `school`
- 同一 `user_id` 可拥有多个 `Membership`
- 业务编号的唯一性应定义在 `scope_id` 内
- 当 `organization_type=school` 时，优先使用 `student_no`
- 当 `organization_type=business` 时，优先使用 `employee_no`
- `member_no` 为通用字段，`student_no / employee_no` 为场景化别名或映射字段

### 6.5 Subscription

订阅对象。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `subscription_id` | string | 否 | 订阅 ID |
| `scope_type` | enum(ScopeType) | 是 | 套餐生效空间 |
| `scope_id` | string | 是 | 空间 ID |
| `plan` | enum(Plan) | 是 | 套餐档位 |
| `status` | enum(PlanStatus) | 是 | 套餐状态 |
| `expires_at` | string | 否 | 到期时间 |
| `seats` | number | 否 | 座位数，组织套餐使用 |
| `entitlements` | string[] | 否 | 能力项集合 |

约束：

- 个人套餐挂在 `scope_type=personal`
- 组织套餐挂在 `scope_type=organization`
- 组织成员默认继承组织空间的套餐能力

## 7. 关系定义

### 7.1 OrganizationType 与 Plan 的关系

| 维度 | 取值 |
| --- | --- |
| `organization_type` | `business` / `school` |
| `plan` | `free` / `pro` / `ultra` |

结论：

- `organization_type` 解决“是什么组织”
- `plan` 解决“买了什么能力”

### 7.2 Role 与 Plan 的关系

| 维度 | 作用 |
| --- | --- |
| `role` | 决定允许执行什么动作 |
| `plan` | 决定开放什么能力 |

固定规则：

```text
final_permission = role_permission
                 ∩ plan_entitlement
                 ∩ scope_policy
```

### 7.3 平台角色与业务角色的关系

- `student / teacher / reviewer / orgAdmin` 面向业务场景
- `systemAdmin / superAdmin` 面向平台管理
- 平台角色不应直接等价于付费套餐

### 7.4 Internal ID 与 Business Number 的关系

固定规则：

- 对象关联、持久化、外键引用使用内部主键
- 展示、导入、运营检索优先使用业务编号
- 同一用户在不同组织空间可拥有不同的 `member_no`
- 学校学号和企业工号属于成员关系维度，不属于用户主键维度

## 8. 套餐能力定义

### 8.1 free

建议能力：

- 免费题访问
- 基础做题
- 基础进度记录
- 基础个人中心

### 8.2 pro

建议能力：

- 全量题库访问
- 收藏
- 错题本
- 学习统计
- 推荐练习

### 8.3 ultra

建议能力：

- 高级分析
- 专项训练
- 导出能力
- 高级学习工具
- 组织功能入口

## 9. 展示规则

### 9.1 个人中心展示规则

应展示：

- 当前用户基本资料
- 当前角色集合
- 当前生效套餐
- 套餐有效期
- 当前空间类型
- 当前内部主键 `user_id`
- 当前业务编号：个人空间显示 `member_no`，组织空间显示当前成员编号

不应混淆展示：

- 角色名称和套餐名称
- 用户身份和组织类型
- 内部主键和业务编号

### 9.2 组织场景展示规则

当用户处于组织空间时，应展示：

- 当前组织名称
- `organization_id`
- `organization_type`
- 当前组织套餐
- 当前成员角色
- 当前成员编号：`member_no` 及其场景化别名 `student_no / employee_no`

## 10. 示例数据

### 10.1 个人用户

```json
{
  "user": {
    "user_id": "usr_0196319f-15d4-7b6a-82f4-1234567890ab",
    "username": "alice",
    "member_no": "MEM-000001",
    "status": "active",
    "created_at": "2026-04-12T10:00:00Z"
  },
  "profile": {
    "user_id": "usr_0196319f-15d4-7b6a-82f4-1234567890ab",
    "display_name": "Alice"
  },
  "membership": {
    "membership_id": "mem_019631a1-2bc4-7aa0-8f10-abcdef123456",
    "user_id": "usr_0196319f-15d4-7b6a-82f4-1234567890ab",
    "scope_type": "personal",
    "scope_id": "usr_0196319f-15d4-7b6a-82f4-1234567890ab",
    "organization_type": "",
    "roles": ["student"],
    "member_no": "MEM-000001"
  },
  "subscription": {
    "scope_type": "personal",
    "scope_id": "usr_0196319f-15d4-7b6a-82f4-1234567890ab",
    "plan": "pro",
    "status": "active",
    "expires_at": "2026-12-31"
  }
}
```

### 10.2 学校组织成员

```json
{
  "organization": {
    "organization_id": "org_019631b0-9910-74b2-90c2-fedcba654321",
    "name": "示例学校",
    "organization_type": "school"
  },
  "membership": {
    "membership_id": "mem_019631b1-0e91-76cb-9d12-2468ace02468",
    "user_id": "usr_019631af-6011-7ad2-8b32-112233445566",
    "scope_type": "organization",
    "scope_id": "org_019631b0-9910-74b2-90c2-fedcba654321",
    "organization_type": "school",
    "roles": ["teacher"],
    "member_no": "STU-000045",
    "student_no": "STU-000045"
  },
  "subscription": {
    "scope_type": "organization",
    "scope_id": "org_019631b0-9910-74b2-90c2-fedcba654321",
    "plan": "ultra",
    "status": "active",
    "expires_at": "2026-12-31",
    "seats": 100
  }
}
```

### 10.3 企业组织成员

```json
{
  "organization": {
    "organization_id": "org_019631c0-8832-7df1-8f11-998877665544",
    "name": "示例企业",
    "organization_type": "business"
  },
  "membership": {
    "membership_id": "mem_019631c1-1aa0-7d20-8cc0-123443211234",
    "user_id": "usr_019631bf-22a0-7ec0-89d0-001122334455",
    "scope_type": "organization",
    "scope_id": "org_019631c0-8832-7df1-8f11-998877665544",
    "organization_type": "business",
    "roles": ["orgAdmin"],
    "member_no": "EMP-000012",
    "employee_no": "EMP-000012"
  }
}
```

## 11. 实施建议

若分阶段交付，可仅裁剪 UI 或功能入口，不应改变最终模型定义。

允许分阶段隐藏：

- 组织后台页面
- 成员导入
- 企业工号导入
- 学校学号导入

不允许阶段性简化为：

- 用学号代替 `user_id`
- 用用户名代替 `organization_id`
- 用 `scope_id:user_id` 代替正式 `membership_id`

## 12. 开发与测试约定

开发测试模式可额外提供：

- 固定测试登录 ID
- 微信 stub 登录
- 空密码测试登录

但这些仅用于开发便利，不属于正式业务主键设计。

## 13. 检查清单

评审时按以下项目检查：

- 是否将 `business` 或 `school` 误做成套餐名
- 是否将 `role` 与 `plan` 混成同一个字段
- 是否区分个人空间与组织空间
- 是否支持组织成员关系
- 是否定义套餐状态
- 是否定义套餐有效期
- 是否定义角色集合
- 是否预留能力项 `entitlements`
- 是否考虑组织套餐继承
- 是否保证前后端枚举一致
- 是否将 `user_id` 与 `member_no / student_no / employee_no` 明确分离
- 是否将组织业务编号定义在 `Membership` 而不是 `User`
- 是否使用独立的 `organization_id / membership_id`

## 14. 当前文档定位

本文件用于确认最终式样与数据职责。

如需查看设计背景与推导说明，请参考：

- [docs/user-module-design.md](D:/_develop/_side/exam-online-cpp/docs/user-module-design.md)
