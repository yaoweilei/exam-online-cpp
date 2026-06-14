# 用户模块接口式样书

## 1. 文档目的

本文件用于定义用户模块相关接口的路径、请求格式、响应格式、错误码和当前约束。

本文件只覆盖用户模块相关接口，不覆盖试卷、答题、统计等其他领域接口。

## 2. 基本规则

### 2.1 Base URL

统一前缀：

```text
/api/v1
```

### 2.2 响应包裹格式

成功与失败均使用统一包裹：

```json
{
  "code": "OK",
  "message": "ok",
  "data": {},
  "request_id": "req_xxx",
  "ts": "2026-01-01T00:00:00.000Z"
}
```

字段定义：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 业务码，成功固定为 `OK` |
| `message` | string | 响应消息 |
| `data` | object/null | 业务数据 |
| `request_id` | string | 请求 ID |
| `ts` | string | 服务端时间 |

### 2.3 Content-Type

- 请求体为 JSON 时必须使用 `application/json`
- 成功回调页等个别接口允许返回 HTML

### 2.4 当前认证方式

当前工程使用会话令牌 `token`。

现状：

- 登录返回 `token`
- 登出通过请求体传 `token`
- 校验通过 query 传 `token`
- 当前大多数用户接口尚未强制鉴权

备注：

- 这是当前实现状态，不是最终目标状态
- 后续建议统一为请求头鉴权，但本式样先按现状记录

## 3. 通用对象

### 3.1 AuthSession

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `user_id` | string | 是 | 用户 ID |
| `username` | string | 是 | 用户名 |
| `roles` | string[] | 是 | 角色列表 |
| `token` | string | 否 | 登录时返回 |
| `expires_at` | string | 否 | 校验会话时返回 |

### 3.2 User

当前接口返回的用户对象以现有实现为准。

常见字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 用户 ID |
| `username` | string | 用户名 |
| `email` | string | 邮箱 |
| `phone` | string | 手机号 |
| `phone_verified` | boolean | 手机是否验证 |
| `roles` | string[] | 角色列表 |
| `created_at` | string | 创建时间 |
| `wechat_openid` | string | 微信 OpenID |
| `wechat_nickname` | string | 微信昵称 |
| `wechat_avatar` | string | 微信头像 |

### 3.3 Profile

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | string | 用户 ID |
| `display_name` | string | 显示名 |
| `avatar_url` | string | 头像地址 |
| `locale` | string | 语言环境 |
| `goal_level` | string | 目标等级 |
| `goal_date` | string | 目标日期 |
| `daily_target` | number | 每日目标 |
| `streak_days` | number | 连续活跃天数 |
| `longest_streak` | number | 最长连续活跃 |
| `last_active_at` | string | 最后活跃时间 |
| `xp` | number | 经验值 |
| `credits` | number | 点数/余额 |
| `plan` | string | 当前实现中的套餐字段 |
| `plan_expires` | string | 当前实现中的套餐到期字段 |
| `notification_enabled` | boolean | 通知开关 |

备注：

- 当前实现中 `plan` 仍为 `free/premium`
- 目标式样中将迁移为 `free/pro/ultra`

### 3.4 PermissionView

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | string | 用户 ID |
| `roles` | string[] | 角色列表 |
| `features` | object[] | 可见功能项 |
| `sections` | object[] | 可见导航项 |

`features[]` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 功能 ID |
| `title` | string | 功能标题 |
| `icon` | string | 功能图标 |

`sections[]` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 区块 ID |
| `title` | string | 区块标题 |

## 4. 接口清单

用户模块相关接口包括：

- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/logout`
- `GET /auth/verify`
- `POST /auth/phone/send-code`
- `POST /auth/phone/verify`
- `GET /auth/wechat/qrcode`
- `GET /auth/wechat/callback`
- `GET /auth/wechat/poll`
- `GET /users/{user_id}`
- `GET /users/by-role/{role_id}`
- `GET /users/{user_id}/permissions`
- `GET /roles`
- `GET /profile/{user_id}`
- `PUT /profile/{user_id}`
- `GET /subscription/{user_id}`
- `POST /subscription/{user_id}/grant`

## 5. 认证接口

### 5.1 登录

`POST /auth/login`

说明：

- 使用用户名密码登录
- 成功后返回会话令牌

请求体：

```json
{
  "username": "alice",
  "password": "secret"
}
```

请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |

成功响应 `data`：

```json
{
  "user_id": "user_1",
  "username": "alice",
  "roles": ["user"],
  "token": "req_xxx"
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求体不是合法 JSON |
| `VALIDATION_ERROR` | 422 | 缺少字段 |
| `INVALID_CREDENTIALS` | 401 | 用户名或密码错误 |

### 5.2 注册

`POST /auth/register`

请求体：

```json
{
  "username": "alice",
  "password": "secret",
  "email": "alice@example.com"
}
```

请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |
| `email` | string | 否 | 邮箱 |

成功响应 `data`：

```json
{
  "user_id": "user_2",
  "username": "alice",
  "roles": ["user"]
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求体不是合法 JSON |
| `VALIDATION_ERROR` | 422 | 缺少字段 |
| `USER_EXISTS` | 400 | 用户名已存在 |

### 5.3 登出

`POST /auth/logout`

请求体：

```json
{
  "token": "req_xxx"
}
```

成功响应 `data`：

```json
{
  "success": true
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求体不是合法 JSON |
| `VALIDATION_ERROR` | 422 | 缺少 `token` |

### 5.4 校验会话

`GET /auth/verify?token={token}`

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `token` | 是 | 会话令牌 |

成功响应 `data`：

```json
{
  "user_id": "user_1",
  "username": "alice",
  "roles": ["user"],
  "expires_at": "2026-04-12T10:00:00.000Z"
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 缺少 `token` |
| `TOKEN_INVALID` | 401 | 令牌不存在 |
| `TOKEN_EXPIRED` | 401 | 令牌过期 |

备注：

- 当前实现中的 `expires_at` 实际保存的是登录时生成的时间字符串，而非真实失效时刻
- 该行为属于现状问题，后续需要修正

## 6. 手机绑定接口

### 6.1 发送验证码

`POST /auth/phone/send-code`

请求体：

```json
{
  "phone": "+8613800000000"
}
```

成功响应 `data`：

```json
{
  "phone": "+8613800000000"
}
```

成功消息：

```text
code_sent
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 缺少字段 |
| `INVALID_PHONE` | 422 | 手机号格式错误 |
| `SMS_RATE_LIMITED` | 429 | 发送过于频繁 |
| `SMS_SEND_FAILED` | 500 | 短信发送失败 |

### 6.2 校验并绑定手机号

`POST /auth/phone/verify`

请求体：

```json
{
  "user_id": "user_1",
  "phone": "+8613800000000",
  "code": "123456"
}
```

成功响应 `data`：

- 返回绑定后的完整用户对象

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 缺少字段 |
| `INVALID_PHONE` | 422 | 手机号格式错误 |
| `SMS_CODE_NOT_FOUND` | 400 | 未发送验证码或验证码已清理 |
| `SMS_CODE_EXPIRED` | 400 | 验证码已过期 |
| `SMS_CODE_INVALID` | 400 | 验证码错误 |
| `USER_NOT_FOUND` | 404 | 用户不存在 |

## 7. 微信登录接口

### 7.1 获取二维码登录入口

`GET /auth/wechat/qrcode`

成功响应 `data`：

```json
{
  "state": "req_xxx",
  "qrcode_url": "https://stub.wechat.example/qrcode?state=req_xxx",
  "expires_in": 300,
  "stub": true
}
```

字段定义：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `state` | string | 登录状态码 |
| `qrcode_url` | string | 二维码地址 |
| `expires_in` | number | 二维码有效秒数 |
| `stub` | boolean | 是否为开发桩模式 |

### 7.2 微信回调

`GET /auth/wechat/callback?code={code}&state={state}`

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `code` | 是 | 微信授权码 |
| `state` | 是 | 登录状态码 |

成功响应：

- 返回 HTML 页面
- 页面内容提示登录成功并关闭窗口

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 缺少 `code` 或 `state` |
| `WECHAT_AUTH_FAILED` | 502 | 微信授权失败 |
| `WECHAT_NOT_CONFIGURED` | 503 | 微信配置缺失 |

### 7.3 轮询登录结果

`GET /auth/wechat/poll?state={state}`

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `state` | 是 | 登录状态码 |

成功响应 `data`：

未完成：

```json
{
  "done": false
}
```

已完成：

```json
{
  "done": true,
  "token": "req_xxx",
  "user_id": "wx_123",
  "username": "wx_user_1",
  "roles": ["user"]
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | 缺少 `state` |
| `WECHAT_STATE_NOT_FOUND` | 400 | `state` 无效或已过期 |

备注：

- 当前 `poll` 返回的 `token` 仅来自 `WechatService` 内部状态，不与 `AuthService` 的会话表自动打通
- 该行为属于现状约束，后续应统一

## 8. 用户接口

### 8.1 查询用户详情

`GET /users/{user_id}`

Path 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_id` | 是 | 用户 ID |

成功响应 `data`：

- 返回完整用户对象

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `USER_NOT_FOUND` | 404 | 用户不存在 |

### 8.2 按角色查询用户列表

`GET /users/by-role/{role_id}`

Path 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `role_id` | 是 | 角色 ID |

成功响应 `data`：

- 返回用户对象数组

备注：

- 当前实现支持角色值取决于 `users.json` 中实际保存的数据
- 后端默认基线与前端角色枚举尚未完全统一

### 8.3 查询用户权限视图

`GET /users/{user_id}/permissions`

成功响应 `data`：

```json
{
  "user_id": "user_1",
  "roles": ["student"],
  "features": [
    { "id": "profile", "title": "个人信息", "icon": "👤" }
  ],
  "sections": [
    { "id": "dashboard", "title": "概览" }
  ]
}
```

错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `USER_NOT_FOUND` | 404 | 用户不存在 |

备注：

- 当前权限视图仅基于 `roles` 计算
- 尚未并入 `plan`、`organization_type`、`entitlements`

### 8.4 查询角色定义

`GET /roles`

成功响应 `data`：

- 返回角色映射对象

当前典型结构：

```json
{
  "guest": {
    "id": "guest",
    "name": "guest",
    "description": "Guest user",
    "permissions": ["view_exams", "submit_answers"]
  }
}
```

备注：

- 当前默认角色基线仍偏旧，仍包含 `guest/user/admin`
- 目标式样将迁移为 `student/teacher/reviewer/orgAdmin/systemAdmin/superAdmin`

## 9. 资料接口

### 9.1 查询个人资料

`GET /profile/{user_id}`

成功响应 `data`：

- 返回完整 Profile 对象

若资料文件不存在：

- 返回默认资料对象

默认值要点：

- `locale = "zh-CN"`
- `daily_target = 20`
- `plan = "free"`
- `plan_expires = ""`
- `notification_enabled = true`

### 9.2 更新个人资料

`PUT /profile/{user_id}`

请求体为部分更新。

允许写入字段：

- `display_name`
- `avatar_url`
- `locale`
- `goal_level`
- `goal_date`
- `daily_target`
- `notification_enabled`

请求示例：

```json
{
  "display_name": "Alice",
  "daily_target": 30,
  "notification_enabled": false
}
```

成功响应 `data`：

- 返回更新后的完整 Profile 对象

备注：

- 未在白名单内的字段会被忽略
- 当前不支持通过该接口直接修改 `plan`

## 10. 订阅接口

### 10.1 查询订阅状态

`GET /subscription/{user_id}`

成功响应 `data`：

```json
{
  "user_id": "user_1",
  "is_premium": false
}
```

备注：

- 当前实现只有布尔字段 `is_premium`
- 实际订阅信息从 `profile.plan` 和 `profile.plan_expires` 推导
- 当前仍使用 `premium` 语义，不符合目标式样

### 10.2 授予订阅

`POST /subscription/{user_id}/grant`

请求体：

```json
{
  "expires_at": "2026-12-31"
}
```

成功响应 `data`：

```json
{
  "user_id": "user_1",
  "plan": "premium",
  "plan_expires": "2026-12-31"
}
```

备注：

- 当前接口仅支持授予 `premium`
- 当前接口不支持 `free/pro/ultra` 任意切换
- 后续目标应升级为通用订阅写接口

## 11. 当前实现与目标式样差异

### 11.1 角色差异

当前实现存在以下不一致：

- 用户基线默认角色：`guest / user / admin`
- 权限视图和前端个人中心：已在使用 `student / teacher / reviewer / academicAdmin / systemAdmin / superAdmin`

要求：

- 后续必须统一前后端角色枚举

### 11.2 套餐差异

当前实现：

- `plan = free | premium`
- 订阅查询接口只返回 `is_premium`

目标式样：

- `plan = free | pro | ultra`
- 订阅对象应包含 `plan / status / expires_at / entitlements`

### 11.3 组织能力差异

当前实现：

- 用户接口未正式引入 `scope_type`
- 用户接口未正式引入 `organization_type`

目标式样：

- 支持个人空间与组织空间
- 支持 `business` 和 `school`

## 12. 后续接口演进建议

建议后续新增或重构以下接口：

- `GET /me`
- `GET /me/context`
- `GET /memberships`
- `GET /subscriptions/current`
- `PUT /subscriptions/{scope_type}/{scope_id}`

建议目标返回结构：

```json
{
  "user": {},
  "profile": {},
  "membership": {},
  "subscription": {},
  "permissions": {}
}
```

## 13. 检查清单

评审接口时按以下项目检查：

- 是否使用统一 envelope
- 是否明确区分 path/query/body 参数
- 是否返回稳定字段名
- 是否记录错误码
- 是否说明当前实现限制
- 是否混入了角色与套餐语义
- 是否为后续组织空间预留扩展位

## 14. 关联文档

- [docs/user-module-design.md](D:/_develop/_side/exam-online-cpp/docs/user-module-design.md)
- [docs/user-module-spec.md](D:/_develop/_side/exam-online-cpp/docs/user-module-spec.md)
- [backend/docs/api-v1.md](D:/_develop/_side/exam-online-cpp/backend/docs/api-v1.md)
