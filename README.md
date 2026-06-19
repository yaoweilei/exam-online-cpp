# 在线试卷系统

当前代码库已经统一到这一套实现：

- 后端：C++20 + Drogon
- 前端：TypeScript + 浏览器原生 ES Module
- 接口：`/api/v1`
- 数据存储：JSON 文件

旧的 Python 后端、旧前端兼容启动链路、旧静态脚本残留都已经清理掉了。

## 当前状态

- 首页由 C++ 服务直接返回 [static/index.html](D:/_develop/_side/exam-online-cpp/static/index.html)
- 前端入口是 [frontend/src/main.ts](D:/_develop/_side/exam-online-cpp/frontend/src/main.ts)
- 前端查看器主模块位于 [frontend/src/viewer](D:/_develop/_side/exam-online-cpp/frontend/src/viewer)
- 编译产物输出到 [static/app](D:/_develop/_side/exam-online-cpp/static/app)
- 后端接口统一挂在 `/api/v1`
- 用户模块设计稿见 [docs/user-module-design.md](D:/_develop/_side/exam-online-cpp/docs/user-module-design.md)
- 用户模块式样书见 [docs/user-module-spec.md](D:/_develop/_side/exam-online-cpp/docs/user-module-spec.md)
- 用户模块接口式样书见 [docs/user-module-api-spec.md](D:/_develop/_side/exam-online-cpp/docs/user-module-api-spec.md)

## 功能完成进度

完成度按“前端入口 + 后端 API + 数据落库/读取 + 自动化测试覆盖”综合估算。`已闭环` 表示本地和内测环境可以完整使用；`基础可用` 表示代码链路已接通，但生产环境还需要外部 provider、商户配置或更细的风控。

### 账号与权限

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 账号登录 | 用户名密码登录、退出、session 恢复、游客/登录态区分 | 95% | 已闭环 |
| 注册流程 | 前端注册入口、校验、注册后自动登录 | 90% | 已闭环 |
| 密码体系 | 修改密码、忘记密码、验证码重置、错误登录不建 session | 90% | 已闭环 |
| 手机号登录 | 验证码登录、自动创建账号、发送频率限制 | 85% | 基础可用，真实短信服务需上线配置 |
| 微信登录 | 微信入口、开发 mock 扫码登录 | 75% | 基础可用，真实微信开放平台待接入 |
| OAuth | GitHub / Google / LINE mock 回调登录 | 65% | mock 可用，真实 provider 待接入 |
| 权限识别 | guest / student / assistant / teacher / orgAdmin / contentAdmin / superAdmin 角色识别 | 95% | 已闭环 |
| 成员权限 | 基础角色、权限模板、额外权限、作用域、有效期、组织审计 | 90% | 已闭环 |
| API 版本 | 接口统一到 `/api/v1` | 100% | 已完成 |

### 试卷学习核心

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 试卷选择 | JLPT / EJU、年份、场次、级别选择 | 95% | 已闭环 |
| 做题流程 | 显示题目、作答、保存答案、提交、跳题、答题卡 | 95% | 已闭环 |
| 答案与解析 | 答案解析、补充解析展示 | 95% | 已闭环 |
| 学习辅助 | 假名、中文翻译、显示间距优化 | 90% | 已可用 |
| 做题进度 | 进度记录、恢复 | 90% | 已闭环 |
| 听力核心 | 播放、暂停、逐句播放、transcript、题图对应 | 90% | 已闭环 |
| EJU 版式修正 | 答题卡去 Section、听力解析去原文版式 | 100% | 已验证 |
| 内容质量审计 | `audit:content` / `audit:content:strict` | 80% | 有工具，内容仍需持续人工终审 |

### 自学闭环

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 错题本 | 错题沉淀、筛选、移除、掌握/取消掌握、标签 | 90% | 已闭环 |
| 收藏夹 | 试卷收藏、单题收藏、收藏分类 | 90% | 已闭环 |
| 生词本 | 添加单词、读音、备注、删除/更新 | 85% | 已可用 |
| 今日复习 | SRS 到期、错题复习、每日一练聚合入口 | 90% | 已闭环 |
| 每日一练 | 生成、重新生成、完成标记 | 85% | 已可用 |
| 学习报告 | 周/月学习报告 | 80% | 已可用 |
| 备考目标 | 目标日期、每日目标、倒计时 | 85% | 已可用 |
| 连续学习 | 连续天数、热力图、每日目标 | 85% | 已可用 |
| 弱项分析 | 统计、弱点、推荐练习 | 85% | 已可用 |
| 推荐复习 | 推荐原因、去练习、完成后反馈 | 90% | 已闭环 |

### 个人账户与付费权益

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 个人资料 | 昵称、头像、邮箱/手机绑定 | 85% | 已可用 |
| 联系方式验证 | 邮箱/手机号验证码、剩余次数提示 | 85% | provider 依赖环境 |
| 推荐码 | 推荐码领取/归属 | 80% | 已可用 |
| 数据导出 | 个人数据 JSON 导出 | 90% | 已闭环 |
| 多端同步 | 拉取、上传、冲突提示、设备列表 | 80% | 已可用，冲突策略还可精细化 |
| 个人套餐 | 权益判断、续费/升级入口 | 80% | 已可用 |
| 兑换码 | 兑换入口、钱包积分 | 90% | 已闭环 |
| 卡券包 | 卡券显示 | 85% | 已可用 |
| 支付订单 | 订单、流水、退款、webhook 接口 | 75% | 代码有，真实支付待商户接入 |
| 支付流水 | 前端查看流水 | 85% | 已可用 |
| 到期/续费状态 | subscription 状态、到期显示 | 80% | 已可用 |

### 机构用户闭环

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 机构/学习组 | 创建机构、创建学习组、添加/移除学员 | 90% | 已闭环 |
| 机构套餐/席位 | 席位、套餐、功能分档 | 85% | 已可用 |
| 邀请码/邀请链接 | 邮箱/手机号邀请、待处理邀请、接受邀请 | 90% | 已闭环 |
| 老师/助教/学员权限 | 基础角色、权限模板、额外权限、作用域、有效期和审计记录 | 90% | 已闭环 |
| 作业系统 | 布置作业、指定学习组、试卷、题目范围 | 90% | 已闭环 |
| 学员作业 | 查看作业、完成作业、自动提交 | 90% | 已闭环 |
| 自动批改 | 作业提交后统计分数 | 85% | 已可用 |
| 提交情况 | 老师查看提交情况 | 90% | 已闭环 |
| 催交 | 手动催交未交学生 | 80% | 已可用；定时自动催交待做 |
| 学习组成绩册 | 学员、作业、平均分、弱项 | 90% | 已闭环 |
| 学员档案 | 错题变化、作文历史、听力弱项、老师备注、建议作业 | 90% | 已闭环 |
| 机构看板 | 学习组趋势、学员排名、题型弱项、老师效果、续费风险、席位 | 85% | 已可用 |
| 教学工作台 | 老师/学员日程、课程包预警、学生学习关系、备课方案聚合 | 90% | 已闭环 |

### P2 增强功能

| 功能 | 当前能力 | 完成度 | 状态 |
|---|---|---:|---|
| 老师备课 | 按试卷/关键词组卷、保存备课方案、从方案生成作业 | 95% | 已闭环 |
| 导出讲义 | HTML 讲义导出 | 90% | 已可用 |
| 打印题目 | 打开打印版讲义 | 80% | 已接前端 |
| 隐藏答案 | 讲义默认隐藏答案 | 85% | 已可用 |
| 课堂投屏 | 投屏版 HTML | 85% | 已接前端 |
| 社区 | 试卷讨论、发帖、评论、点赞、删除 | 90% | 已闭环 |
| 运营后台 | 用户搜索、角色查看、功能开关、反馈处理、全站统计 | 85% | 已闭环 |
| 审计日志 | 查询、筛选、分页、CSV 导出 | 85% | 已可用 |
| PWA | manifest、安装入口、service worker、缓存策略 | 80% | 已可用 |

### 自动化测试覆盖

当前 Playwright E2E 共 `25` 条，覆盖：

- 账号系统：游客、密码登录、注册、手机号、忘记密码、修改密码、微信 mock、OAuth mock、角色识别
- 角色权限：`guest/student/assistant/teacher/orgAdmin/contentAdmin/superAdmin` 上下文、入口和高风险 API 权限矩阵
- 试卷学习：EJU 试卷选择、答题卡、听力解析版式、听力播放/逐句、作答提交与进度
- 学习闭环：单题收藏、今日复习工作台、推荐复习反馈
- 账户付费：兑换码、卡券包、支付流水
- 机构闭环：学习组、作业、提交、催交、成绩册、学员档案、老师备注
- 组织邀请：邀请展示与接受
- P2 增强：PWA、备课讲义接口、运营后台、社区发帖/点赞/评论

最近一次验证命令：

```powershell
npm --prefix frontend run build
ctest --test-dir backend/build -C Debug --output-on-failure
npx playwright test
cmake --build backend/build --config Release -- /m:1 /p:UseMultiToolTask=true /p:CL_MPCount=1
```

账号系统专项 Playwright UI 调试命令：

```powershell
npx playwright test tests/e2e/auth-session.spec.js --ui --ui-host 127.0.0.1 --ui-port 9323
```

最近一次结果：Playwright `25 passed`，后端 `smoke_tests` 通过，Release 编译通过。

### 仍未到生产级的重点

- 真实微信开放平台接入
- 真实 OAuth provider 接入
- 真实短信服务接入与费用风控
- 真实微信/支付宝/Stripe 支付签名、回调验签、退款对账
- 作业定时自动催交，例如截止前 24 小时自动提醒未提交学生
- 生产级通知系统，例如站内信、邮件、短信、微信服务通知统一消息中心
- 内容质量全量人工终审，尤其是历年 EJU/JLPT 解析的出版级一致性

## 技术栈

- 后端：C++20、Drogon、CMake
- 前端：TypeScript、ES Modules
- 数据：本地 JSON、索引文件、WAL 日志
- 测试：C++ `ctest` + PowerShell smoke 脚本

## 代码结构分析

当前代码已经是单体应用结构：Drogon 后端负责静态页面、API、JSON 存储和业务规则；TypeScript 前端负责试卷查看、学习闭环、个人中心和机构工作台。运行时主入口是 `backend/src/main.cpp`，前端入口是 `frontend/src/main.ts`，浏览器加载的是编译后的 `static/app/main.js`。

后端分层比较清楚：

- `transport`：只做 HTTP 路由、参数读取、鉴权入口、响应包装。
- `application/services`：放业务规则，例如登录、作业、机构看板、学习报告、支付、社区。
- `infrastructure/storage`：读写 JSON 文件和 WAL，避免路由层直接碰文件格式。
- `domain`：放跨模块共享的数据模型。
- `common`：放响应、异常、时间、ID、request id 等基础能力。

前端也基本按职责拆分：

- `features`：负责启动阶段、登录/session、试卷列表、PWA。
- `viewer/core`：试卷查看器的主流程。
- `viewer/managers`：把答题、音频、导航、假名、中文、计时等交互拆开。
- `viewer/renderers`：负责题目 DOM 渲染。
- `viewer/personalCenter.ts`：个人中心、学习闭环、机构后台的主要 UI，目前功能最多，也是后续最值得继续拆分的文件。

当前最重要的设计判断：

- 机构教学已经统一为 `learning_groups`，作业绑定 `organization_id + learning_group_id`。
- 旧班级模型的服务、路由、仓储和历史作业数据已清理，后续不要再新增旧模型。
- JSON 存储适合当前开发和内测；如果进入多人高并发或商用部署，机构、订单、作业提交、用户 session 这些模块应优先迁移到数据库。
- 路由文件数量较多但职责薄，维护重点应放在 service 层的权限边界和数据一致性。
- 前端个人中心已经覆盖大量产品能力，建议下一阶段按“账号/学习/付费/机构/运营”继续拆分组件，降低单文件维护成本。

## 文件职责速查

下面按“源码、配置、测试、工具、运行数据”说明当前主要文件内容。试卷 JSON、音频、图片、图标这类数量很大的资源按目录说明，不逐个列出。

### 根目录文件

| 文件 | 内容 |
|---|---|
| `.editorconfig` | 统一编码、缩进、换行等编辑器规则。 |
| `.env.example` | 邮件、短信、支付、微信等外部 provider 的环境变量样例。 |
| `.gitignore` | 忽略构建产物、日志、临时文件和本地依赖。 |
| `package.json` | 根目录 Playwright E2E 和内容审计脚本入口。 |
| `package-lock.json` | 根目录 E2E 依赖锁定文件。 |
| `playwright.config.js` | Playwright 测试服务启动、baseURL、浏览器和报告配置。 |
| `run-e2e.ps1` | 自动安装依赖、启动后端并运行 Playwright 的包装脚本。 |
| `run-local-regression.ps1` | 本地回归测试集合脚本。 |
| `start-cpp.bat` | 推荐启动入口，负责 UTF-8 控制台、环境变量、基线迁移和启动 C++ 服务。 |
| `test_org_security.ps1` | 组织权限相关安全检查脚本。 |
| `README.md` | 当前项目说明、功能进度、启动方式、测试方式和代码速查。 |
| `功能设计书.md` | 产品功能设计书，重点覆盖角色、权限、机构学习模型和后续设计。 |

### 后端配置与文档

| 文件 | 内容 |
|---|---|
| `backend/CMakeLists.txt` | 后端 CMake 构建配置，编译主程序和 `smoke_tests`。 |
| `backend/README.md` | 后端局部说明。 |
| `backend/config/appsettings.example.json` | Drogon 和应用配置样例。 |
| `backend/docs/api-v1.md` | `/api/v1` 接口清单和请求/响应说明。 |

### 后端入口与基础层

| 文件 | 内容 |
|---|---|
| `backend/src/main.cpp` | 读取配置、创建 repository/service、注册路由、启动 Drogon。 |
| `backend/src/domain/Models.h` | 用户、角色、试卷、答案、组织、作业等共享模型。 |
| `backend/src/common/ApiResponse.h` | 统一 API 响应格式。 |
| `backend/src/common/AppException.h` | 业务异常类型。 |
| `backend/src/common/IdGenerator.h` | 用户、组织、作业等 ID 生成工具。 |
| `backend/src/common/RequestId.h` | 请求 ID 生成和传递。 |
| `backend/src/common/TimeUtils.h` | ISO 时间、过期时间、时间比较工具。 |
| `backend/src/infrastructure/config/AppConfig.h` | 应用配置结构和读取逻辑。 |

### 后端业务服务

| 文件 | 内容 |
|---|---|
| `AdminStatisticsService.{h,cpp}` | 运营后台全站统计、用户搜索、概览数据。 |
| `AnswerService.{h,cpp}` | 答案保存、读取、提交评分和做题记录。 |
| `AssignmentService.{h,cpp}` | 学习组作业创建、列表、提交、提交情况、催交和权限判断。 |
| `AttemptTimerService.{h,cpp}` | 做题计时、暂停、恢复和计时记录。 |
| `AuditLogService.{h,cpp}` | 组织和后台操作审计日志。 |
| `AuthService.{h,cpp}` | 用户名密码登录、注册、session 创建和恢复。 |
| `BookmarkFolderService.{h,cpp}` | 收藏夹分类、文件夹管理。 |
| `BookmarkService.{h,cpp}` | 试卷收藏、单题收藏、收藏原因和跳题入口数据。 |
| `ChapterService.{h,cpp}` | 试卷章节和题目结构读取。 |
| `CommunityService.{h,cpp}` | 讨论区发帖、评论、点赞、删除。 |
| `ContactChangeChallengeService.{h,cpp}` | 邮箱/手机改绑前的旧联系人验证。 |
| `DailyPracticeService.{h,cpp}` | 每日一练生成、完成和重置。 |
| `DataExportService.{h,cpp}` | 用户个人数据导出。 |
| `DraftService.{h,cpp}` | 作文、答题草稿保存和恢复。 |
| `EmailVerificationService.{h,cpp}` | 邮箱验证码、验证次数、debug code。 |
| `ExamService.{h,cpp}` | 试卷列表、试卷详情、题目数据读取。 |
| `FeatureFlagService.{h,cpp}` | 功能开关注册、读取和更新。 |
| `FeedbackService.{h,cpp}` | 用户反馈提交、后台处理。 |
| `InstitutionService.{h,cpp}` | 机构看板、学习组成绩册、学员档案、老师效果和续费风险。 |
| `LeaderboardService.{h,cpp}` | 学习排行榜和排名数据。 |
| `LearningReportService.{h,cpp}` | 周/月学习报告。 |
| `NotificationService.h` | 通知能力接口定义。 |
| `OAuthService.{h,cpp}` | GitHub/Google/LINE mock OAuth 登录和账号绑定。 |
| `OrganizationService.{h,cpp}` | 机构、成员、权限、校区、课程包、学习组、邀请链接。 |
| `PaymentService.{h,cpp}` | 支付订单、流水、退款、webhook 基础链路。 |
| `PhoneService.{h,cpp}` | 手机验证码登录、发送频率和每日次数限制。 |
| `ProfileService.{h,cpp}` | 个人资料、头像、联系方式、老师备注等 profile 数据。 |
| `RedeemService.{h,cpp}` | 兑换码、卡券、积分到账。 |
| `RelatedQuestionsService.{h,cpp}` | 相关题、推荐题和题目关联。 |
| `SmsService.h` | 短信 provider 抽象接口。 |
| `SrsService.{h,cpp}` | 间隔复习、到期复习、掌握状态。 |
| `StatisticsService.{h,cpp}` | 学习统计、正确率、弱项分析。 |
| `StreakService.{h,cpp}` | 连续学习、每日目标和热力图。 |
| `StudyGoalService.{h,cpp}` | 备考目标、目标日期、每日目标。 |
| `SubscriptionService.{h,cpp}` | 个人套餐、权益判断、到期状态。 |
| `SyncService.{h,cpp}` | 多端同步状态、上传、拉取和设备信息。 |
| `TranslationService.{h,cpp}` | 中文翻译数据读取。 |
| `UserService.{h,cpp}` | 用户、角色、密码、权限识别。 |
| `VocabNotebookService.{h,cpp}` | 生词本增删改查。 |
| `WechatService.{h,cpp}` | 微信 mock 登录、扫码状态和账号创建。 |
| `WrongQuestionService.{h,cpp}` | 错题本、掌握状态、错题筛选。 |
| `RecommendationStrategy.h` | 推荐策略接口。 |
| `RuleBasedRecommendationStrategy.h` | 基于规则的推荐策略实现。 |

### 后端存储层

| 文件 | 内容 |
|---|---|
| `JsonIo.h` | JSON 文件读写、原子写入辅助。 |
| `WalStore.h` | 写前日志存储辅助。 |
| `AnswerRepository.h` | 答案和提交记录存储。 |
| `AssignmentRepository.{h,cpp}` | 学习组作业、提交、催交记录存储。 |
| `AttemptTimerRepository.{h,cpp}` | 做题计时记录存储。 |
| `BookmarkFolderRepository.{h,cpp}` | 收藏夹文件夹存储。 |
| `BookmarkRepository.h` | 收藏和单题收藏存储。 |
| `CommunityRepository.{h,cpp}` | 社区帖子、评论、点赞存储。 |
| `DraftRepository.{h,cpp}` | 草稿存储。 |
| `ExamRepository.{h,cpp}` | 试卷 JSON、索引和章节读取。 |
| `FeatureFlagRepository.{h,cpp}` | 功能开关 JSON 存储。 |
| `FeedbackRepository.{h,cpp}` | 反馈数据存储。 |
| `OrganizationRepository.{h,cpp}` | 机构、成员、校区、课程包、学习组、邀请和审计数据存储。 |
| `ProfileRepository.{h,cpp}` | 用户 profile JSON 存储。 |
| `SessionRepository.{h,cpp}` | session token、过期时间和用户登录态存储。 |
| `SrsRepository.{h,cpp}` | SRS 复习卡片和复习记录存储。 |
| `StreakRepository.{h,cpp}` | 连续学习记录存储。 |
| `TranslationRepository.h` | 翻译 JSON 读取。 |
| `UserRepository.{h,cpp}` | 用户、密码、角色、联系人存储。 |
| `VocabNotebookRepository.h` | 生词本 JSON 存储。 |
| `WrongQuestionRepository.{h,cpp}` | 错题记录存储。 |

### 后端路由层

| 文件 | 内容 |
|---|---|
| `ApiRouter.{h,cpp}` | 聚合所有 route 注册函数，统一挂载 `/api/v1`。 |
| `RouteUtils.{h,cpp}` | 路由层通用参数读取、token 解析、响应辅助。 |
| `routes/Routes.h` | 各路由注册函数声明。 |
| `routes/AdminStatisticsRoutes.cpp` | 运营统计 API。 |
| `routes/AnswerRoutes.cpp` | 答案保存、提交、读取 API。 |
| `routes/AssignmentRoutes.cpp` | 学习组作业、提交、催交 API。 |
| `routes/AttemptTimerRoutes.cpp` | 做题计时 API。 |
| `routes/AuditLogRoutes.cpp` | 审计日志 API。 |
| `routes/AuthRoutes.cpp` | 登录、注册、退出、session API。 |
| `routes/BookmarkFolderRoutes.cpp` | 收藏夹分类 API。 |
| `routes/ChapterRoutes.cpp` | 章节和题目 API。 |
| `routes/CommunityRoutes.cpp` | 社区讨论 API。 |
| `routes/ContactRoutes.cpp` | 联系方式验证和改绑 API。 |
| `routes/DailyPracticeRoutes.cpp` | 每日一练 API。 |
| `routes/DataExportRoutes.cpp` | 数据导出 API。 |
| `routes/DraftRoutes.cpp` | 草稿 API。 |
| `routes/ExamRoutes.cpp` | 试卷列表和详情 API。 |
| `routes/FeatureFlagRoutes.cpp` | 功能开关 API。 |
| `routes/FeedbackRoutes.cpp` | 反馈提交和处理 API。 |
| `routes/InstitutionRoutes.cpp` | 机构看板、成绩册、学员档案 API。 |
| `routes/LeaderboardRoutes.cpp` | 排行榜 API。 |
| `routes/LearningReportRoutes.cpp` | 学习报告 API。 |
| `routes/MeRoutes.cpp` | 当前用户状态聚合 API。 |
| `routes/OAuthRoutes.cpp` | OAuth mock 登录 API。 |
| `routes/OrganizationRoutes.cpp` | 机构、成员、权限、学习组、课程包、邀请 API。 |
| `routes/PaymentRoutes.cpp` | 支付订单、流水、退款、webhook API。 |
| `routes/ProfileBookmarkRoutes.cpp` | 个人中心收藏、错题等聚合 API。 |
| `routes/RedeemRoutes.cpp` | 兑换码和卡券 API。 |
| `routes/RelatedQuestionsRoutes.cpp` | 相关题和推荐练习 API。 |
| `routes/SrsRoutes.cpp` | SRS 复习 API。 |
| `routes/StaticRoutes.cpp` | 首页和静态资源兜底路由。 |
| `routes/StatisticsRoutes.cpp` | 学习统计 API。 |
| `routes/StreakRoutes.cpp` | 连续学习和每日目标 API。 |
| `routes/StudyGoalRoutes.cpp` | 备考目标 API。 |
| `routes/SubscriptionRoutes.cpp` | 订阅权益 API。 |
| `routes/SyncRoutes.cpp` | 多端同步 API。 |
| `routes/TranslationRoutes.cpp` | 中文翻译 API。 |
| `routes/UserRoutes.cpp` | 用户、角色、密码、手机号 API。 |
| `routes/VocabNotebookRoutes.cpp` | 生词本 API。 |
| `routes/WechatRoutes.cpp` | 微信登录 API。 |
| `routes/WrongQuestionRoutes.cpp` | 错题本 API。 |

### 前端源码

| 文件 | 内容 |
|---|---|
| `frontend/package.json` | 前端 TypeScript 构建脚本和依赖。 |
| `frontend/tsconfig.json` | TypeScript 编译配置，输出到 `static/app`。 |
| `frontend/src/main.ts` | 浏览器入口，初始化登录、试卷选择、查看器和 PWA。 |
| `frontend/src/analytics/tracker.ts` | 前端埋点和用户行为记录辅助。 |
| `frontend/src/api/runtime.ts` | API baseURL、请求运行时配置。 |
| `frontend/src/api/dto.ts` | 前端 API DTO 类型定义。 |
| `frontend/src/api/client.ts` | 面向新版页面的 API 请求封装。 |
| `frontend/src/features/exams.ts` | 试卷列表加载和考试类型/年份/级别选择。 |
| `frontend/src/features/featureFlags.ts` | 前端功能开关读取和判断。 |
| `frontend/src/features/login.ts` | 登录、注册、手机号、微信、OAuth 入口 UI。 |
| `frontend/src/features/pwa.ts` | PWA 安装提示和 service worker 注册。 |
| `frontend/src/features/session.ts` | session 恢复、退出、游客/登录态区分。 |
| `frontend/src/features/viewerBootstrap.ts` | 创建并挂载 `ExamViewer`。 |
| `frontend/src/state/store.ts` | 简单前端状态存储。 |
| `frontend/src/viewer/globals.d.ts` | 浏览器全局对象和 viewer 相关类型声明。 |
| `frontend/src/viewer/core/APIClient.ts` | viewer 内部使用的 API 封装。 |
| `frontend/src/viewer/core/ExamLoader.ts` | 试卷 JSON、章节、资源加载。 |
| `frontend/src/viewer/core/ExamViewer.ts` | 试卷查看器主控制器。 |
| `frontend/src/viewer/core/UserContextManager.ts` | viewer 内用户状态、权限、权益上下文。 |
| `frontend/src/viewer/managers/AnswerManager.ts` | 作答、保存、提交、答案解析展示。 |
| `frontend/src/viewer/managers/AudioManager.ts` | 听力音频、暂停继续、逐句播放、时间戳控制。 |
| `frontend/src/viewer/managers/CategoryNavigationManager.ts` | 记述/读解/读听解/听解分类切换。 |
| `frontend/src/viewer/managers/ExamTimerManager.ts` | 做题计时 UI 和后端计时同步。 |
| `frontend/src/viewer/managers/NavigationManager.ts` | 上一题、下一题、题号跳转。 |
| `frontend/src/viewer/managers/QuestionMapManager.ts` | 答题卡、题号状态和跳题。 |
| `frontend/src/viewer/managers/StateManager.ts` | 当前试卷、章节、题目、显示开关状态。 |
| `frontend/src/viewer/managers/TranslationManager.ts` | 中文翻译显示、隐藏和定位。 |
| `frontend/src/viewer/managers/VocabLookupManager.ts` | 生词查询、字典弹层、生词本入口。 |
| `frontend/src/viewer/renderers/QuestionRenderer.ts` | 题干、选项、图片、解析、辅助文本渲染。 |
| `frontend/src/viewer/utils/DOMHelpers.ts` | DOM 创建、选择器、事件辅助。 |
| `frontend/src/viewer/utils/DOMUtils.ts` | DOM 操作工具。 |
| `frontend/src/viewer/utils/ErrorHandler.ts` | 前端错误捕获和展示。 |
| `frontend/src/viewer/utils/Logger.ts` | 前端日志封装。 |
| `frontend/src/viewer/personalCenter.ts` | 个人中心、学习闭环、付费权益、机构后台、运营入口主实现。 |
| `frontend/src/viewer/personalCenter/avatar.ts` | 头像资源和头像选择逻辑。 |
| `frontend/src/viewer/personalCenter/icons.ts` | 个人中心图标常量。 |
| `frontend/src/viewer/personalCenter/normalize.ts` | 个人中心后端数据标准化。 |
| `frontend/src/viewer/personalCenter/types.ts` | 个人中心类型定义。 |
| `frontend/src/viewer/personalCenter/utils.ts` | 个人中心通用格式化、转义、读取工具。 |

### 静态页面与样式

| 文件 | 内容 |
|---|---|
| `static/index.html` | 单页应用 HTML 入口。 |
| `static/style.css` | 全局样式入口，组合各 CSS 模块。 |
| `static/manifest.webmanifest` | PWA manifest。 |
| `static/sw.js` | service worker 和缓存策略。 |
| `static/favicon.ico` | 浏览器图标。 |
| `static/styles/tokens.css` | 颜色、间距、字号等 CSS token。 |
| `static/styles/layout.css` | 页面整体布局。 |
| `static/styles/exam-toolbar.css` | 顶部试卷工具栏。 |
| `static/styles/exam-controls.css` | 答题控制按钮和通用控制区。 |
| `static/styles/question.css` | 题目主体样式。 |
| `static/styles/question-navigation.css` | 答题卡和题号导航。 |
| `static/styles/answer-explanation.css` | 答案解析、补充解析样式。 |
| `static/styles/audio-listening.css` | 听力播放器和逐句播放样式。 |
| `static/styles/image.css` | 题目图片和材料图片样式。 |
| `static/styles/login.css` | 登录/注册相关样式。 |
| `static/styles/wechat-login.css` | 微信登录弹层样式。 |
| `static/styles/modals.css` | 通用弹窗样式。 |
| `static/styles/paper-library.css` | 试卷选择和试卷库样式。 |
| `static/styles/personal-center.css` | 个人中心、机构后台、运营后台样式。 |
| `static/styles/vocab-lookup.css` | 生词查询和词典弹层样式。 |
| `static/styles/misc.css` | 其他零散样式。 |
| `static/resource/icons/**` | 头像、用户角色、学习状态、试卷状态 SVG 图标。 |
| `static/app/**` | TypeScript 编译产物，可由 `npm --prefix frontend run build` 重新生成。 |

### 测试文件

| 文件 | 内容 |
|---|---|
| `backend/tests/smoke_tests.cpp` | C++ 后端 smoke 测试。 |
| `backend/tests/contract_v1_smoke.ps1` | `/api/v1` 合约烟雾测试。 |
| `backend/tests/integration_flow_smoke.ps1` | 后端集成流程 smoke 测试。 |
| `backend/tests/perf_read_score.ps1` | 读取和评分性能基线测试。 |
| `backend/tests/README.md` | 后端测试说明。 |
| `tests/e2e/README.md` | Playwright E2E 使用说明。 |
| `tests/e2e/helpers/session.js` | E2E 登录、session、API mock 辅助。 |
| `tests/e2e/auth-session.spec.js` | 账号、session、注册、手机号、微信、OAuth、角色识别测试。 |
| `tests/e2e/exam-viewer.spec.js` | 试卷查看、答题、答题卡、听力、解析测试。 |
| `tests/e2e/account-wallet.spec.js` | 个人账户、兑换码、卡券、支付流水测试。 |
| `tests/e2e/institution-core.spec.js` | 机构学习组、作业、成绩册、学员档案、课程包测试。 |
| `tests/e2e/org-invite.spec.js` | 组织邀请链接和接受邀请测试。 |
| `tests/e2e/p2-enhancements.spec.js` | PWA、备课、社区、运营后台等增强功能测试。 |
| `tests/e2e/role-permissions.spec.js` | 七类身份的角色上下文、功能入口和权限边界测试。 |
| `tests/e2e/scripts/start-e2e-backend.ps1` | E2E 专用后端启动脚本。 |

### 工具脚本

| 文件 | 内容 |
|---|---|
| `backend/tools/migrate_user_baseline.ps1` | 初始化用户和角色基线。 |
| `backend/tools/prepare_org_invite_demo.ps1` | 准备组织邀请演示数据。 |
| `backend/tools/sink_user_repository.ps1` | 用户仓储压力/写入辅助脚本。 |
| `backend/tools/sink_class.ps1` | C++ 头文件拆分工具，把 header 内联实现迁移到 `.cpp`；不是旧班级业务工具。 |
| `backend/tools/stop_running_backend.ps1` | 停止本机正在运行的后端进程。 |
| `tools/audit_exam_content.mjs` | 试卷内容质量审计，支持严格时间戳检查。 |
| `tools/align_eju_script_timestamps.py` | 对齐 EJU 听力原文时间戳。 |
| `tools/apply_eju_answers.py` | 写入/修正 EJU 答案。 |
| `tools/apply_eju_transcripts.py` | 写入/修正 EJU transcript。 |
| `tools/apply_jlpt_question_skill_tags.mjs` | 给 JLPT 题目补技能标签。 |
| `tools/audit_eju_listening_transcripts.py` | 审计 EJU 听力 transcript 完整性。 |
| `tools/build_eju_full_sample.py` | 生成 EJU 全量样例数据。 |
| `tools/extract_eju_transcript_layouts.py` | 从资料中抽取 EJU 原文版式。 |
| `tools/generate_eju_listening_explanations.mjs` | 生成/批处理 EJU 听力解析。 |
| `tools/generate_eju_translations.mjs` | 生成 EJU 中文翻译。 |
| `tools/generate_jlpt_translations.mjs` | 生成 JLPT 中文翻译。 |
| `tools/merge_eju_reading_to_root.py` | 合并 EJU 读解数据到根结构。 |
| `tools/normalize_eju_writing_sections.py` | 规范 EJU 作文题结构。 |
| `tools/parse_eju_docx.py` | 解析 EJU docx 材料。 |
| `tools/review_eju_translation_file.mjs` | 审查 EJU 翻译文件质量。 |
| `tools/split_eju_full_audio.py` | 按 EJU 模式切割整份听力音频。 |
| `tools/extract_pc_types.ps1` | 抽取 personal center TypeScript 类型辅助。 |
| `tools/scan_css_sections.ps1` | 扫描 CSS section。 |
| `tools/split_css.ps1` | CSS 拆分辅助。 |
| `tools/apply_pc_round6.ps1` | 个人中心历史批处理补丁脚本。 |

### 数据目录

| 目录/文件 | 内容 |
|---|---|
| `data/paper` | JLPT/EJU 试卷 JSON、索引和内容数据。 |
| `data/audio` | 听力音频，EJU 按年份场次和 track 存放。 |
| `data/image` | 试卷题图、材料图和处理后的图片资源。 |
| `data/system` | 系统级 JSON，例如作业、功能开关、机构套餐。 |
| `data/user` | 用户、角色、session、答题、profile、学习记录等运行数据。 |
| `downloads` | 原始下载资料、PDF、音频等处理前材料。 |
| `uploads` | 用户上传或导入产生的文件。 |
| `logs/backend` | 后端运行日志。 |
| `tmp_*`、`test-results`、`playwright-report` | 临时审计输出和测试报告，可按需要清理。 |

## 编码规则

- 仓库文本文件统一使用 UTF-8，这条规则已经落在根目录的 `.editorconfig`
- Windows 下后端 MSVC 编译会显式使用 `/utf-8`，避免中文、日文字符串按本地代码页误解析
- `start-cpp.bat` 和后端启动时都会把控制台切到 UTF-8，减少本地 stub 邮件/SMS 日志乱码
- 即便如此，终端字体或外部工具如果不支持 UTF-8，显示层仍可能出问题；默认排查顺序先看控制台编码，再看字体和查看工具

## 快速启动

### 1. 安装依赖

Windows 环境默认按 `vcpkg` 处理：

```powershell
C:\vcpkg\vcpkg.exe install drogon:x64-windows
```

前端依赖：

```powershell
cd frontend
npm install
cd ..
```

### 2. 初始化用户/角色基线

首次运行建议执行：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tools/migrate_user_baseline.ps1 -BaseDir .
```

### 3. 启动项目

推荐直接用：

```powershell
start-cpp.bat
```

`start-cpp.bat` 默认按开发模式启动：

- `APP_ENV=development`
- `LOG_LEVEL=DEBUG`
- `LOG_DIR=logs/backend`
- 如果 `data/user/users.json` 或 `data/user/roles.json` 缺失，会自动补一次基线迁移

手动构建运行：

```powershell
cmake -S backend -B backend/build -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build backend/build --config Release
backend/build/Release/exam_online_cpp.exe
```

如果要让组织邀请走真实邮件或短信，先复制 `.env.example` 到 `.env` 或直接设置环境变量，再按下面两组配置打开对应 provider：

- 邮件：`EMAIL_PROVIDER=resend`、`EMAIL_API_KEY`、`EMAIL_FROM_ADDRESS`
- 短信：`SMS_PROVIDER=twilio`、`SMS_ACCOUNT_SID`、`SMS_AUTH_TOKEN`、`SMS_FROM_NUMBER`
- 邀请链接：`PUBLIC_WEB_BASE_URL` 必须指向用户实际可访问的前端地址，否则邮件/SMS 中的落地链接会回到默认本地地址
- 推荐奖励：`REFERRAL_REWARD_CREDITS` 控制推荐人拿到的 credits 数量，默认 `10`

启动后访问：

- 首页：[http://127.0.0.1:8000](http://127.0.0.1:8000)
- API：`http://127.0.0.1:8000/api/v1`

生产环境推荐：

```powershell
set APP_ENV=production
set LOG_LEVEL=INFO
start-cpp.bat
```

如果你想让线上尽量安静，只记录错误：

```powershell
set APP_ENV=production
set LOG_LEVEL=ERROR
start-cpp.bat
```

健康检查接口：

- [http://127.0.0.1:8000/healthz](http://127.0.0.1:8000/healthz)
- `GET /api/v1/health`

## 本地回归

如果你想一键跑完整的本地回归，可以直接执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-local-regression.ps1
```

这个统一入口会自动完成：

- Release 构建
- `ctest` 运行 `smoke_tests`
- 启动本地后端
- 运行组织安全回归脚本 `test_org_security.ps1`
- 运行推荐奖励集成回归脚本 `backend/tests/integration_flow_smoke.ps1`
- 最后停止后端进程

如果要顺手验证奖励配置链路，可以传非默认奖励值：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-local-regression.ps1 -ReferralRewardCredits 25
```

## 组织邀请通知

组织管理员现在可以直接按邮箱或手机号发邀请，后端会自动投递邀请码，并把投递状态写回组织邀请记录。

- 默认 `stub` provider 只在后端控制台打印邮件/SMS 内容，适合本地联调
- 真实邮件当前支持 Resend 风格 API
- 真实短信当前支持 Twilio 风格 API
- 邀请接受方不能只凭邀请码加入，必须先登录并验证与邀请目标一致的邮箱或手机号
- 邮件和短信里的落地链接会自动附带 `invite_token` 查询参数，登录后个人中心会自动进入待处理邀请主入口

如果你想直接手测一遍完整的组织邀请流程，后端启动后可以执行：

```powershell
pwsh -ExecutionPolicy Bypass -File .\backend\tools\prepare_org_invite_demo.ps1 -BaseDir .
```

这个脚本会自动准备并复用一套本地演示数据：

- 发起邀请账号：`orgadmin_invite_demo`，开发环境空密码登录
- 接受邀请账号：`student_invite_demo`，开发环境空密码登录
- 预置已验证联系人：`orginvite.demo@example.local`、`13800138099`
- 预置测试组织：`Invite Demo Org`
- 自动重置该账号在测试组织中的成员状态，并重新发出一封邮箱邀请和一条短信邀请

跑完后，`student_invite_demo` 登录进入个人中心，就应该能在“待处理组织邀请”里直接看到两条可接受邀请；`orgadmin_invite_demo` 登录后，则可以在“管理”里继续创建、取消和查看邀请审计。

## 推荐奖励

- 普通用户推荐与企业邀请已经拆开
- 默认规则是：被推荐用户激活个人付费套餐后，推荐人获得 `10` credits
- 如果你要调整奖励额度，直接设置 `REFERRAL_REWARD_CREDITS`，不需要改代码

## 代码库结构

```text
exam-online-cpp/
├── backend/                 # C++ 后端工程
│   ├── src/
│   │   ├── transport/           # HTTP 路由与接口暴露
│   │   ├── application/         # 服务层、用例层、推荐策略
│   │   ├── domain/              # 领域模型
│   │   ├── infrastructure/      # 配置、JSON 仓储、WAL、索引
│   │   └── common/              # 通用响应、异常、请求 ID、时间工具
│   ├── docs/                    # API 文档
│   ├── tests/                   # C++ 测试 + PowerShell smoke/perf
│   ├── tools/                   # PowerShell 数据迁移工具
│   └── build/                   # CMake 构建输出
├── frontend/                    # 前端源码工程
│   ├── src/
│   │   ├── api/                 # 前端 API client / DTO
│   │   ├── analytics/           # 埋点与日志
│   │   ├── features/            # 启动流程、会话、试卷列表加载
│   │   ├── state/               # 前端状态容器
│   │   └── viewer/              # 试卷查看器核心模块
│   ├── package.json
│   └── tsconfig.json
├── static/                      # 运行时静态资源
│   ├── index.html               # 当前首页
│   ├── style.css                # 当前样式
│   ├── app/                     # TS 编译产物
│   └── resource/                # 图标、词典等静态资源
├── data/                        # 题库、音频、图片、用户数据
├── .env / .env.example          # 环境变量示例
├── start-cpp.bat                # Windows 一键启动脚本
└── README.md
```

## `static`、`frontend`、`data` 分别是什么

### `static`

`static` 不是“只放静态页面”的意思，更准确地说，它是运行时静态资源目录。

这里放的是服务启动后直接对外提供的文件：

- [static/index.html](D:/_develop/_side/exam-online-cpp/static/index.html)
  - 当前页面外壳
  - 只负责提供基础 DOM、主题切换脚本、以及前端模块入口
- [static/style.css](D:/_develop/_side/exam-online-cpp/static/style.css)
  - 页面样式
- [static/app](D:/_develop/_side/exam-online-cpp/static/app)
  - TypeScript 编译后的浏览器可执行 JS
- [static/resource](D:/_develop/_side/exam-online-cpp/static/resource)
  - 图标、振假名字典等静态资源

也就是说：

- `static` 是运行时直接被浏览器访问的目录
- 它里面既有 HTML/CSS，也有编译后的 JS 和资源文件

### `frontend`

`frontend` 不是运行时目录，而是前端源码工程目录。

这里放的是开发阶段的 TypeScript 源码：

- [frontend/src/api](D:/_develop/_side/exam-online-cpp/frontend/src/api)
  - 前端 API 调用封装
- [frontend/src/features](D:/_develop/_side/exam-online-cpp/frontend/src/features)
  - 启动流程、试卷列表加载、会话恢复
- [frontend/src/state](D:/_develop/_side/exam-online-cpp/frontend/src/state)
  - 前端状态管理
- [frontend/src/viewer](D:/_develop/_side/exam-online-cpp/frontend/src/viewer)
  - 试卷查看器主实现

构建关系是：

1. 开发时修改 `frontend/src/**/*.ts`
2. 执行 `npm run build`
3. 产物输出到 `static/app`
4. 浏览器实际运行的是 `static/app/*.js`

### `data`

`data` 是业务数据目录，不是源码目录。

这里放的是系统运行依赖的数据文件：

- [data/paper](D:/_develop/_side/exam-online-cpp/data/paper)
  - 试卷 JSON、试卷索引、题库结构文件
- [data/audio](D:/_develop/_side/exam-online-cpp/data/audio)
  - 听力音频
- [data/image](D:/_develop/_side/exam-online-cpp/data/image)
  - 图片类资源
- [data/user](D:/_develop/_side/exam-online-cpp/data/user)
  - 用户、角色、答题记录、WAL

## 数据是什么时候加载的

数据不是一次性全部塞进前端，而是分阶段加载。

### 1. C++ 服务启动时

服务启动入口在 [main.cpp](D:/_develop/_side/exam-online-cpp/backend/src/main.cpp)。

启动时会先创建这些仓储对象：

- `ExamRepository`
- `AnswerRepository`
- `UserRepository`

对应行为：

- [ExamRepository.h](D:/_develop/_side/exam-online-cpp/backend/src/infrastructure/storage/ExamRepository.h)
  - 构造时会执行 `rebuildIndex()`
  - 扫描 `data/paper/jlpt` 下的试卷 JSON
  - 构建内存索引
  - 生成 `.exam_index.json`
- [UserRepository.h](D:/_develop/_side/exam-online-cpp/backend/src/infrastructure/storage/UserRepository.h)
  - 启动时执行 `ensureBaseline()`
  - 检查并补齐 `users.json`、`roles.json`
  - 恢复用户 WAL
- [AnswerRepository.h](D:/_develop/_side/exam-online-cpp/backend/src/infrastructure/storage/AnswerRepository.h)
  - 启动时准备 `data/user/answers`
  - 恢复答题 WAL
所以：

- 试卷索引属于“服务启动时预加载”
- 用户/答题 WAL 也会在启动时做恢复准备

### 2. 浏览器打开页面时

浏览器先拿到 [static/index.html](D:/_develop/_side/exam-online-cpp/static/index.html)，然后执行：

```html
<script type="module" src="/static/app/main.js"></script>
```

前端启动时：

- [main.ts](D:/_develop/_side/exam-online-cpp/frontend/src/main.ts) 会先请求 `/api/v1/exams?sort=date_desc`
- [exams.ts](D:/_develop/_side/exam-online-cpp/frontend/src/features/exams.ts) 把返回结果按等级分组
- 结果写入前端 store 和 `window.__EXAMS_BY_LEVEL__`

也就是说：

- 前端首页打开时，并不会直接把整个题库 JSON 全量拉到浏览器
- 它只先取“试卷列表摘要”

### 3. 用户实际操作时

后续数据按需加载：

- 选择试卷时，再请求 `/api/v1/exams/{exam_id}`
  - 这时后端才读取该试卷详细 JSON
  - 首次读取后会放入后端缓存
- 查看用户进度时，请求 `/api/v1/progress/{user_id}/exams`
- 提交答案时，写入 `data/user/answers/...`
- 用户和角色信息按对应接口读取 `data/user/*.json`

所以整体逻辑是：

1. 服务启动时预热索引和必要基础数据
2. 页面启动时只加载试卷列表摘要
3. 试卷详情、答题记录、进度、用户信息都在交互时按需加载

## 后端结构说明

后端主入口：

- [main.cpp](D:/_develop/_side/exam-online-cpp/backend/src/main.cpp)

后端按分层组织：

- `transport`
  - 负责注册 HTTP 路由
  - 当前核心路由在 [ApiRouter.cpp](D:/_develop/_side/exam-online-cpp/backend/src/transport/ApiRouter.cpp)
  - 根页面和资源目录都走配置里的 `staticDir`，不再依赖进程当前工作目录
- `application`
  - 封装考试、答题、认证、统计、用户、推荐、振假名等服务
- `domain`
  - 放领域模型和核心数据结构
- `infrastructure`
  - 落地到 JSON 文件、索引、WAL、配置
- `common`
  - 统一响应信封、异常、请求 ID、时间工具

当前首页路由：

- `/` 直接返回 `static/index.html`

当前 API 根前缀：

- `/api/v1`

## 前端结构说明

前端启动链路：

1. [main.ts](D:/_develop/_side/exam-online-cpp/frontend/src/main.ts)
2. [viewerBootstrap.ts](D:/_develop/_side/exam-online-cpp/frontend/src/features/viewerBootstrap.ts)
3. `viewer` 模块按顺序加载
4. 创建 `ExamViewer` 实例并绑定页面

前端核心目录：

- `frontend/src/api`
  - 前端请求封装
- `frontend/src/features`
  - 启动、会话恢复、试卷列表预加载
- `frontend/src/state`
  - 前端状态存储
- `frontend/src/viewer`
  - 当前页面真正的试卷查看器实现
  - 包含 `core`、`managers`、`renderers`、`utils`

运行时入口脚本：

```html
<script type="module" src="/static/app/main.js"></script>
```

## 数据目录说明

[data](D:/_develop/_side/exam-online-cpp/data) 目前主要分成这几块：

- `data/paper`
  - 试卷 JSON
  - 试卷索引
  - 振假名字典
- `data/audio`
  - 听力音频资源
- `data/image`
  - 图片类题目资源
- `data/user`
  - 用户、角色、答题记录、WAL

当前用户数据基线主要文件：

- [data/user/users.json](D:/_develop/_side/exam-online-cpp/data/user/users.json)
- [data/user/roles.json](D:/_develop/_side/exam-online-cpp/data/user/roles.json)

## 日志与 WAL

### 后端运行日志

后端运行日志现在统一输出到：

- `logs/backend/`

日志文件基础名默认是：

- `exam-online-cpp`

这部分是 Drogon/Trantor 的运行日志，包含：

- 启动信息
- 请求日志
- 运行错误
- 你在代码里通过 `LOG_INFO / LOG_ERROR / LOG_DEBUG` 打的内容

### 日志级别策略

当前约定：

- 开发环境默认：`DEBUG`
- 生产环境默认：`INFO`
- 如果线上只想保留错误：`ERROR`

控制方式：

- `APP_ENV`
  - `development` / `dev` / `local` -> 默认 `DEBUG`
  - 其他值，例如 `production` -> 默认 `INFO`
- `LOG_LEVEL`
  - 显式覆盖默认值

支持的常用级别：

- `DEBUG`
- `INFO`
- `WARN`
- `ERROR`

### WAL 日志

下面这些不是普通运行日志，而是数据层的写前日志：

- `data/user/_users.wal.log`
- `data/user/answers/_wal.log`

它们用于：

- 记录用户或答题写入事件
- 崩溃恢复
- 保证 JSON 存储在写入过程中的一致性

这类文件即使删掉，后续运行和写入时也会自动重新生成。

## 构建产物说明

下面这些目录属于可再生成内容：

- `backend/build`
- `frontend/node_modules`
- `static/app`

如果需要瘦身仓库或重新构建，这几个目录都可以删掉后再生成。

## API 说明

统一响应结构：

```json
{
  "code": "OK",
  "message": "ok",
  "data": {},
  "request_id": "req_xxx",
  "ts": "2026-01-01T00:00:00.000Z"
}
```

详细接口清单见：

- [api-v1.md](D:/_develop/_side/exam-online-cpp/backend/docs/api-v1.md)

## 常用命令

初始化用户基线：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tools/migrate_user_baseline.ps1 -BaseDir .
```

构建前端：

```powershell
cd frontend
npm run build
cd ..
```

运行 C++ 测试：

```powershell
ctest --test-dir backend/build -C Release --output-on-failure
```

运行 API 合约烟雾测试：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tests/contract_v1_smoke.ps1
```

运行集成烟雾测试：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tests/integration_flow_smoke.ps1
```

运行性能基线测试：

```powershell
powershell -ExecutionPolicy Bypass -File backend/tests/perf_read_score.ps1
```

## 当前仓库不再包含的内容

以下内容已经从主实现中移除：

- Python 后端源码
- 前端 `legacyBridge` / `loader` 兼容启动链路
- 旧静态平铺版 JS 模块
- 旧 demo 页面和临时模板页

如果你后续继续扩展，建议直接沿现在这套结构走：

- 后端扩展：`backend/src/application`、`domain`、`transport`
- 前端扩展：`frontend/src/features`、`frontend/src/viewer`
