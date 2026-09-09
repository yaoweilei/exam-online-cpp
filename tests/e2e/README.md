# Playwright E2E

当前共有 88 个串行场景，覆盖账号与会话、做题、个人中心、角色权限、机构教学（含自动催交配置与学生提醒隔离）、平台运营、支付订阅和内容工作流。

## 运行

```powershell
npx playwright test
```

默认启动脚本会：

1. 停止同一构建目录中的旧后端进程。
2. 将 `data/paper`、`data/system`、`data/user` 复制到被 Git 忽略的 `tmp/e2e-runtime/data`。
3. 通过 `DATA_ROOT` 让测试后端只读写隔离副本。
4. 继续从项目目录读取静态资源以及体积较大的音频、图片。

因此 E2E 创建的账号、机构、订单、会话和答题数据不会写回项目的真实 `data/`。

手动调试时如需复用已经运行的服务，可显式设置：

```powershell
$env:PLAYWRIGHT_REUSE_SERVER = '1'
npx playwright test --ui
```

此模式不会自动保证服务使用隔离数据，仅用于开发者明确知情的调试场景。
