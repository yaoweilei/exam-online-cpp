# 每日离线备份设置 · 2026-10-28

用户已明确允许固定时段短暂停机，并指定每天北京时间 03:00、保留最新 2 份，目录由代理选择。

- 已启用 Windows 计划任务 `ExamOnlineCpp-NightlyBackup`；首次计划运行时间为 2026-10-29 03:00，时区 China Standard Time。
- 数据源：`D:/_develop/_side/exam-online-cpp/data`；目录：`E:/ExamOnlineBackups/exam-online-cpp`。D 和 E 分别位于本机磁盘 0、1；这是另一块本地硬盘上的副本，不是异地备份。
- 持久配置：`E:/ExamOnlineBackups/exam-online-cpp/maintenance/config.json`。目录 ACL 限制为当前用户、SYSTEM 和 Administrators。
- Windows 拒绝当前非提升账号注册 S4U 任务；已成功注册并启用当前用户 Interactive 任务。用户必须保持登录，锁屏可以；注销后不能运行。没有绕过系统权限。需要注销后运行时，应在管理员 PowerShell 中重新运行下方安装命令。

```powershell
./tools/install_scheduled_backup.ps1 -ConfigPath E:/ExamOnlineBackups/exam-online-cpp/maintenance/config.json -At 03:00 -Enable
```

任务请求唤醒电脑，实际是否可唤醒取决于 Windows 电源策略；关闭错过时间后的补跑，避免开机后在白天突然停机。重复实例不并行执行。不设置强制终止时限，避免系统在复制期间直接杀死脚本而跳过恢复启动。

运行脚本 `tools/invoke_scheduled_backup.ps1` 先核对数据目录、链接、磁盘空间、唯一目标进程、端口归属及服务健康，再停止指定后端、创建离线快照。无论创建成功与否，都尝试恢复指定服务并检查健康；恢复后才执行完整校验、可选复制及保留清理。只清理已校验、同一数据源的旧副本。其他测试后端存在或服务预检查失败时拒绝停机。

`tools/start_backup_backend.ps1` 通过独立 WMI 启动器恢复后端，避免长驻服务被计划任务的进程树和输出管道拖住。重启环境继续使用当前 development、8080、stub 邮件/短信设置，并接入真实备份状态文件。实际业务服务本次没有白天重启，状态来源会在首次夜间恢复启动时生效。

隔离演练使用真实后端 8083 与物理测试数据，验证了成功创建/启动/健康、创建失败仍恢复服务、拒绝错误可执行文件，并核对副本哈希及 UTC 生成时间。测试专用进程过滤适配只存在于隔离夹具，部署脚本仍保留“其他后端存在则拒绝备份”的约束。

证明文件：`tmp/scheduled-drill-d5cf0766324847e29e7cf80a5dcd27be/verification.json`。安装结果和任务 XML：`tmp/scheduled-backup-20261028/`。本次没有手动运行真实停机备份；首次计划执行仍需以真实任务结果确认。当前 8080 健康及就绪检查通过。
