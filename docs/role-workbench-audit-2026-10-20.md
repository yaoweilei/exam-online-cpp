# 全角色工作台使用流程检查（2026-10-20）

本轮按学员、教师、教学管理员、机构管理员、机构内容管理员、内容管理员、超级管理员分别检查。结果为 **10 项已复现的问题**，另有 3 项体验建议和 2 项待补验事项。当前共用布局已较接近学员端，优先级最高的问题是机构身份不能正常进入或读取数据，以及首页统计与业务列表不一致。

以下保留 2026-10-20 的检查记录和复现依据；后续修复及验收见文末“2026-10-21 修复记录”。

## 检查方式和范围

- 使用 `8083` 隔离服务，`paper/system/user` 为独立副本；图片、音频只读取。发布和回滚只发生在副本，原有 `8080` 服务及用户进度未因本轮检查而修改。
- 使用普通角色账号验证，另外专门创建原为学员、后被授予机构角色的账号。超级管理员切换角色仅作为辅助，不能替代普通账号验证。
- 现有 26 项回归通过：14 项角色权限及内容接口、6 项教师作业流程、6 项学员学习进度及失败重试。
- 另以真实 API 数据验证各角色首页、业务列表、退回重做、历史排课、过期模板、审核待发布、反馈搜索和分页、普通账号机构授权。内容管理员在隔离副本完成实际发布、版本查询和回滚。
- 手机、深浅主题、机构筛选和返回入口包含在教师回归中；本轮没有把所有角色的每个表单在所有屏宽重新组合测试。

## 逐角色结果

| 角色 | 已检查的主要路径 | 结论 |
| --- | --- | --- |
| 学员 | 首页/目标/每日计划，作业暂存、提交、退回重做、刷新恢复，进度保存失败重试 | 本轮覆盖的主要闭环正常；新获机构角色后入口问题见 F01 |
| 教师 | 布置作业→学员作答→退回→重提→评分回显；备课新建、编辑和精确题目范围；机构筛选、主题、手机导航 | 已有平台教师身份的账号闭环正常；仅机构授予教师身份的账号被接口拒绝，见 F02 |
| 教学管理员 | 催交列表、学员跟进详情、课程表、异常提醒 | 待重做漏计、历史课程误计、未来作业误报、详情标题不准确，见 F04–F07；新授权账号另受 F01/F02 影响 |
| 机构管理员 | 成员、学习组、课程包、机构看板、套餐/席位、权限、设置和日志入口；机构权限 API | 既有平台身份账号的入口可达；机构新授角色存在入口及 API 权限问题，见 F01/F02。并非所有编辑表单均已走过保存 |
| 机构内容管理员 | 普通账号进入、机构范围、模板列表、过期状态、课时管理入口 | 新授角色无直接入口；切到机构范围后能进入。首页和模板列表的到期状态互相矛盾，见 F01/F08 |
| 内容管理员 | 首页→反馈搜索/分页→返回；质检→解析审核→复核→发布→版本查询→回滚 | 业务发布/回滚可用；首页“待发布”和反馈数量错误，见 F03/F09 |
| 超级管理员 | 总览、用户、机构、权限、支付和日志入口；反馈搜索返回；权限隔离 | 首页反馈数量受列表搜索影响，用户/机构总数读取旧数据，见 F09/F10。用户全量列表还需补做性能验证 |

## 已复现、需要修改的问题

### F01 · P1 · 新授机构身份缺少可达入口

**影响：机构教师、教学管理员、机构管理员、机构内容管理员。**

1. 创建只有学员身份的账号；在机构中授予相应成员角色。
2. 重新登录，`/me/context` 的 `memberships` 中有该机构角色，但当前 `membership` 仍是 `personal`，有效角色仍只有 `student`。
3. 头像身份菜单没有对应工作台入口；单纯刷新、重新登录不能解决。
4. 在隔离验证中通过资料 API 将范围设置为该机构后，相应角色才出现在用户上下文中。

**应改为：** 在登录或角色入口中识别当前有效机构成员关系，提供清楚的机构/身份选择；不能要求用户用隐藏的资料 API 修改范围。对失效、移除或切换机构的情形，也必须重新验证成员关系。

依据：`UserService::resolveMembership` 仅按资料中已选的范围解析；前端 `availableWorkbenches` 依赖当前角色。

- [范围解析](/D:/_develop/_side/exam-online-cpp/backend/src/application/services/UserService.cpp:527)
- [工作台身份入口](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:8569)
- 证据：`tmp/role-flow-audit-20261020/targeted-results/*/organization-scope-comparison.json`，`new-role-recheck/*/new-org-role-accounts.json`。

### F02 · P1 · 机构角色在页面有效，教学数据 API 却返回 403

**影响：仅通过机构成员授权获得身份的教师、教学管理员、机构管理员。**

接续 F01，切到正确机构后，`/me/context` 已包含 `teacher` / `assistant` / `orgAdmin`，对应工作台可见，但三个普通账号的 `/institution/workbench?org_id=...` 均返回 **403**。机构管理员调用用户搜索也返回 403。页面出现“需要教师或机构管理员权限”，数据无法加载。

**原因：** 账号上下文合并了机构角色，认证会话仍以平台角色为主，教学服务和搜索接口先按会话角色拦截。只用平台教师账号或超级管理员切换角色时无法发现。

**应改为：** 以经过验证的机构成员权限判断机构业务访问，同时继续拒绝其他机构数据；不能通过给账号增加全平台教师/管理员权限来绕过。

- [会话角色来源](/D:/_develop/_side/exam-online-cpp/backend/src/application/services/AuthService.cpp:119)
- [教学数据角色检查](/D:/_develop/_side/exam-online-cpp/backend/src/application/services/InstitutionService.cpp:96)
- [用户搜索角色检查](/D:/_develop/_side/exam-online-cpp/backend/src/transport/routes/UserRoutes.cpp:39)
- 证据：`tmp/role-flow-audit-20261020/new-role-recheck/*/new-org-role-accounts.json` 及 `new-teacher-home.png`、`new-assistant-home.png`、`new-orgAdmin-home.png`。

### F03 · P1 · 已具备发布条件，内容首页“待发布”仍显示 0

**影响：内容管理员。**

用真实接口完成 `N2_2025_07` 的质检、解析审核、二次复核后，工作流列表出现“发布”按钮，实际发布也成功，但首页“待发布”为 **0**，待办中没有该发布事项。

首页读取 `secondary_review` / `secondaryReview`，真实接口返回 `reviews.secondary`。工作流列表使用了正确字段。此外首页的发布条件也应与后端一致，同时检查质检、解析审核和复核。

- [首页计算](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11872)
- [工作流列表使用的真实结构](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:13224)
- [后端发布条件](/D:/_develop/_side/exam-online-cpp/backend/src/application/services/ContentWorkflowService.cpp:183)
- 证据：`tmp/role-flow-audit-20261020/role-followup/*/contentAdmin-home.json`、`contentAdmin-publish.png`；`final-api-results/*/publish-rollback.json`。

### F04 · P2 · 教学管理员首页漏算退回重做

教师退回一份作业，催交列表显示 **“1 待重做”**，教师首页也显示 1 人待提交，但教学管理员首页“待催交”为 **0**，没有相应待办。

应统一“未提交 + 退回待重做”的人次口径，不能只用学生总数减已提交数。

- [教学管理员计算](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11812)
- 对照：教师在 11795 行已加入 `returned_count`。
- 证据：`tmp/role-flow-audit-20261020/role-results/*/assistant-home.json`、`assistant-remind.json`、`teacher-home.json`。

### F05 · P2 · 历史课程和未排时间的学习组计入“近期课程”

一门开始、结束时间均为 **2020-01-01** 且已完成的课程，教学管理员首页“近期排课”和“近期课程”均计为 **1**；教师首页同一课程不计入近期。新增一个还没排时间的学习组后，教学管理员显示 **2**。

教学管理员目前直接使用 `data.schedule.length`。应与教师共用“未来 7 天及进行中”的过滤规则，待排课另作标注。

- [近期排课计算](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11809)
- 证据：`role-results/*/assistant-home.json`、`assistant-schedule.json` 和 `targeted-results/*/assistant-future-home.json`。

### F06 · P2 · 未到期的正常作业被放入“异常提醒”

布置截止时间为 **2099 年**、尚未提交的作业，教学管理员首页“异常提醒”为 **1**，点击后看到该作业，但说明为“逾期与学习中断”。这是正常待办，不是逾期。

首页异常数也与异常列表的口径不同：列表还包括退回待重做项。应把普通未提交放在催交列表，只有符合逾期/风险规则的事项进入异常列表，并写明异常原因。

- [异常数计算](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11813)
- 证据：`targeted-results/*/assistant-future-home.json`、`assistant-future-alerts.json`。

### F07 · P2 · 教学管理员的学员详情标题、导航不准确

从“学员跟进”点进某学员后，主标题变成泛称 **“教学管理工作台”**，而不是学员姓名/学员详情。教师详情标题分支只针对教师工作台，教学管理员复用了详情却没复用标题规则。相关导航匹配也需要一起检查，返回后应保留原来的跟进列表位置。

- [详情标题选择](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:12011)
- 证据：`role-results/*/assistant-student-detail.json`。

### F08 · P2 · 过期模板同时被称为“当前有效”和“需关注”

创建 `status=active`、到期日为 2020 年的课程包模板，机构内容管理员首页显示：课程包 **1**、启用中 **1**（说明“当前有效课程包”）、需关注 **1**；列表仍显示 **“可用”**。

应统一模板是否适用到期日的业务定义。若到期日有效，首页、列表和分配动作都按有效状态判断；若模板本身不适用到期日，则不应被到期规则列为风险。

- [首页状态计算](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11854)
- 对照：已有 `effectiveCoursePackageStatus`，4606 行。
- 证据：`targeted-results/*/actual-orgContentAdmin-home.json`、`actual-orgContentAdmin-packages.json`。已使用真实机构内容管理员账号复核，结论不只来自超管预览。

### F09 · P2 · 两个管理首页的反馈数被分页和搜索改变

**影响：内容管理员、超级管理员。**

真实反馈超过 20 条，首页“待处理反馈”为 **20**。进入反馈页搜索不存在的关键词，再返回首页，反馈待办变为 **0/消失**，但没有任何反馈被处理。

首页直接计算当前页 `platformFeedbackItems`，沿用了反馈列表的页码、每页条数和搜索条件。应由独立的全局待处理汇总提供首页数字；点击待办则进入对应状态的列表。

- [内容首页](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:11870)
- [平台首页](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:10512)
- [列表分页缓存](/D:/_develop/_side/exam-online-cpp/frontend/src/viewer/personalCenter.ts:12240)
- 证据：`role-followup/*/contentAdmin-home.json`、`contentAdmin-after-empty-search.json`；`role-results/*/superAdmin-home.json`、`superAdmin-after-empty-search.json`。

### F10 · P2 · 超级管理员总览仍使用旧 JSON 统计

首页用户数 **12**、机构数 **160**；同一隔离服务的机构列表返回总数 **329**，仅搜索教师账号即返回 **50** 个。只读核对当前 SQLite：用户 **2465**、机构 **329**（审计过程创建少量测试账号，数字代表取证时点）。

`AdminStatisticsService` 仍读取旧 `users.json` 的 `users` 数组及旧 `organizations.json`，而用户、机构仓库已使用 SQLite。刷新不能解决。

应改由当前仓库/数据库聚合，用户和机构列表、首页、席位等统计保持同一数据来源，并明确停用/删除记录是否计入。

- [旧文件统计](/D:/_develop/_side/exam-online-cpp/backend/src/application/services/AdminStatisticsService.cpp:120)
- [用户当前存储](/D:/_develop/_side/exam-online-cpp/backend/src/infrastructure/storage/UserRepository.cpp:89)
- 证据：`final-api-results/*/platform-totals.json`、`tmp/role-flow-audit-20261020/storage-totals.json`。

## 体验建议（不当作已确认的权限漏洞）

1. **机构内容维护与学员课时分配边界清楚些。** 机构内容管理员页面仍有“课时管理/课时分配/查看分配”入口，点击后标题又回到“机构内容工作台”。当前权限模板允许管理课程包，不能仅凭这些按钮认定越权；需先明确该身份是否应维护学员账户，再统一入口、标题和后端校验。
2. **待办跳转时带上状态。** 首页“待批改/待发布/待处理反馈”应进入同口径的筛选结果，保留搜索、滚动位置和返回路径。数量是人次、作业数还是课程数，应显示一致单位。
3. **保持简洁，减少说明重复。** 维持学员端的白底、橙色选中态、统一内容宽度；机构选择只保留一处，详情用具体对象名，避免再增加重复统计卡或“快捷操作”说明。

## 待补验和已知验证边界

- 平台退款待处理数也从分页缓存计算，代码存在与 F09 类似的风险；本轮未构造跨页退款并完整复现，不列入上述 10 项。
- 用户管理依次全量读取多个角色；扩大到约 2400 个账号的隔离副本后，全量读取出现 15 秒超时，并影响后续请求。需要单独做串行/并发性能检查、改用服务端分页；本轮没有把它定为已定位根因的故障。
- 真实第三方支付/退款、外部短信/邮件送达未验证。机构管理员的所有编辑表单、账号安全的所有验证渠道、每角色每屏宽的所有组合未逐项执行，不能将“入口可达”写成这些流程全部通过。

## 建议修改顺序与验收

1. **先修 F01/F02。** 用普通账号接受机构角色，登录即可选到正确机构并读取自己负责的数据；其他机构和未授权高权限 API 仍拒绝。不能只用超管验收。
2. **再统一 F03/F04/F09/F10 的汇总。** 同一状态在首页、列表、详情一致；搜索、翻页、刷新不会改变全局待办总数。
3. **处理 F05/F06/F08 的状态和时间规则。** 覆盖过去/进行中/未来/未排时间、未到期/已到期、退回待重做等边界。
4. **最后处理 F07 和体验建议。** 统一详情标题、筛选跳转和返回路径，再逐角色补做表单和手机端验收。

原始脚本、报告和截图保留在 `tmp/role-flow-audit-20261020/`；其中临时夹具包含测试会话信息，只供本地排查，不应发布。

## 2026-10-21 修复记录

本轮已修复上述 F01–F10，保留现有白底、橙色选中态及统一内容布局。

| 问题 | 修复后的行为 |
| --- | --- |
| F01 | 登录时识别有效机构职员身份；多机构账号可在头像菜单切换所属机构，刷新保留选择；成员身份移除后不能沿用原权限。 |
| F02 | 教学数据、用户搜索、机构审计日志及机构功能开关按目标机构的有效授权校验；机构身份不提升为平台身份，仍拒绝跨机构和未授权平台操作。 |
| F03 | 待发布数量读取真实的嵌套审核字段，同时要求质检通过、解析审核通过、复核通过且尚未发布。 |
| F04 | 教学管理员催交统一统计未提交与退回待重做人次。 |
| F05 | 近期排课只包含未来 7 天及进行中的课程，排除历史课程和未排时间的学习组。 |
| F06 | 未到期的正常作业不再计入异常；首页与异常列表共用逾期判断。 |
| F07 | 共用详情按具体对象显示标题，保留进入时的导航和返回路径；课时管理入口标题也已修正。 |
| F08 | 首页、列表及分配操作使用一致的到期状态；过期模板不计入有效数量，不能新分配；已有课时账户仍可维护。 |
| F09 | 反馈接口独立返回全局待处理汇总；内容和平台首页不再受列表分页、搜索结果影响。 |
| F10 | 用户、机构总数改读当前用户仓库及 SQLite 机构仓库，新增记录会计入总览。 |

机构切换时仅缓存必要的机构身份信息，避免把课程包、日志等整份机构数据写入浏览器本地缓存。

### 修复验收

- 前端类型检查及构建、后端 MinSizeRel 构建、后端 smoke tests 均通过。
- 使用 `8083` 隔离数据执行 35 项端到端回归：角色与权限、内容存储及发布回滚、教师完整作业流程、学员学习流程、工作台紧凑布局和本轮新增的 7 项真实 API/UI 回归。
- 新增测试专门使用平台身份只有 `student`、另由机构授予职员身份的普通账号，覆盖机构切换与刷新、授权撤销、跨机构拒绝、审计及功能开关权限、待办日期边界、过期模板、搜索分页和仓库总数。
- 回归产物位于 `tmp/role-fixes-20261020/verified-results/` 和同名 JSON 报告；新增用例为 `tests/e2e/role-workbench-flow-fixes.spec.js`。
- 最终 35 项全部通过，无失败或不稳定重跑项。验证后的可执行文件已更新到本地 `8080` 服务，健康和就绪检查通过，前端版本为 `20261020-role-flow-fixes-v8`；已关闭 `8083` 隔离服务，未将测试数据覆盖到原用户数据。

以上验收针对本轮已定位问题；前述退款跨页汇总、用户全量列表性能、真实第三方支付/短信/邮件以及所有角色表单和屏宽组合，仍属于待补验范围。
