# 用户模块式样书

## 1. 文档目的

本文件为用户模块的规格说明文档。

目标：

- 固定用户模块的数据定义
- 固定角色、套餐、组织类型之间的关系
- 作为后续后端实现、前端展示、接口设计的检查依据

## 2. 适用范围

本式样适用于以下模块：

- 登录注册
- 个人资料
- 个人中心
- 角色权限
- 套餐订阅
- 组织账号

## 3. 术语定义

| 术语 | 含义 |
| --- | --- |
| User | 基础账号对象，表示一个可登录主体 |
| Profile | 用户资料对象，表示昵称、头像、偏好等 |
| Membership | 用户在某个空间下的成员关系 |
| Subscription | 某个空间的套餐订阅信息 |
| Scope | 权限和套餐生效的空间 |
| Personal Scope | 个人空间 |
| Organization Scope | 组织空间 |
| Organization Type | 组织类型，区分 `business` 与 `school` |
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

### 4.2 禁止事项

禁止以下设计：

- 使用一个字段同时表示角色和套餐
- 将 `business` 作为 `plan` 的取值
- 将 `teacher`、`student` 作为套餐名
- 将平台管理角色与普通用户套餐混为一体

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

基础账号对象。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | string | 是 | 用户唯一 ID |
| `username` | string | 是 | 登录名 |
| `email` | string | 否 | 邮箱 |
| `phone` | string | 否 | 手机号 |
| `password_hash` | string | 否 | 密码哈希 |
| `status` | enum(UserStatus) | 是 | 账号状态 |
| `created_at` | string | 是 | 创建时间 |

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

### 6.3 Membership

成员关系对象。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `membership_id` | string | 否 | 成员关系 ID |
| `user_id` | string | 是 | 用户 ID |
| `scope_type` | enum(ScopeType) | 是 | 生效空间类型 |
| `scope_id` | string | 是 | 空间 ID |
| `organization_type` | enum(OrganizationType) | 是 | 组织类型 |
| `roles` | string[] | 是 | 角色集合 |

约束：

- 当 `scope_type=personal` 时，`organization_type` 必须为 `""`
- 当 `scope_type=organization` 时，`organization_type` 必须为 `business` 或 `school`
- 同一 `user_id` 可拥有多个 `Membership`

### 6.4 Subscription

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

不应混淆展示：

- 角色名称和套餐名称
- 用户身份和组织类型

### 9.2 组织场景展示规则

当用户处于组织空间时，应展示：

- 当前组织名称
- `organization_type`
- 当前组织套餐
- 当前成员角色

## 10. 示例数据

### 10.1 个人用户

```json
{
  "user": {
    "user_id": "u_001",
    "username": "alice",
    "status": "active",
    "created_at": "2026-04-12T10:00:00Z"
  },
  "profile": {
    "user_id": "u_001",
    "display_name": "Alice"
  },
  "membership": {
    "user_id": "u_001",
    "scope_type": "personal",
    "scope_id": "u_001",
    "organization_type": "",
    "roles": ["student"]
  },
  "subscription": {
    "scope_type": "personal",
    "scope_id": "u_001",
    "plan": "pro",
    "status": "active",
    "expires_at": "2026-12-31"
  }
}
```

### 10.2 学校组织成员

```json
{
  "membership": {
    "user_id": "u_101",
    "scope_type": "organization",
    "scope_id": "org_001",
    "organization_type": "school",
    "roles": ["teacher"]
  },
  "subscription": {
    "scope_type": "organization",
    "scope_id": "org_001",
    "plan": "ultra",
    "status": "active",
    "expires_at": "2026-12-31",
    "seats": 100
  }
}
```

## 11. MVP 约束

首版建议仅实现：

- 个人空间
- `free / pro / ultra`
- `student / systemAdmin / superAdmin`

组织功能暂缓：

- `business`
- `school`
- `teacher`
- `reviewer`
- `orgAdmin`

## 12. 现状与改造要求

根据当前工程现状，后续改造应满足以下要求：

### 12.1 角色统一

前后端角色枚举必须统一。

### 12.2 套餐统一

订阅实现应从旧的 `free / premium` 迁移为：

- `free`
- `pro`
- `ultra`

### 12.3 字段补全

订阅至少补齐：

- `plan`
- `status`
- `expires_at`
- `entitlements`

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

## 14. 当前文档定位

本文件用于快速确认式样。

如需查看设计背景与推导说明，请参考：

- [docs/user-module-design.md](D:/_develop/_side/exam-online-cpp/docs/user-module-design.md)
