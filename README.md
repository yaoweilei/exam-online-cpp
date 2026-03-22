# 在线试卷系统

当前代码库已经统一到这一套实现：

- 后端：C++20 + Drogon
- 前端：TypeScript + 浏览器原生 ES Module
- 接口：`/api/v2`
- 数据存储：JSON 文件

旧的 Python 后端、旧前端兼容启动链路、旧静态脚本残留都已经清理掉了。

## 当前状态

- 首页由 C++ 服务直接返回 [static/index.html](D:/_develop/_side/exam-online-cpp/static/index.html)
- 前端入口是 [frontend/src/main.ts](D:/_develop/_side/exam-online-cpp/frontend/src/main.ts)
- 前端查看器主模块位于 [frontend/src/viewer](D:/_develop/_side/exam-online-cpp/frontend/src/viewer)
- 编译产物输出到 [static/app](D:/_develop/_side/exam-online-cpp/static/app)
- 后端接口统一挂在 `/api/v2`

## 技术栈

- 后端：C++20、Drogon、CMake
- 前端：TypeScript、ES Modules
- 数据：本地 JSON、索引文件、WAL 日志
- 测试：C++ `ctest` + PowerShell smoke 脚本

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
powershell -ExecutionPolicy Bypass -File cpp-backend/tools/migrate_user_baseline.ps1 -BaseDir .
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
cmake -S cpp-backend -B cpp-backend/build -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build cpp-backend/build --config Release
cpp-backend/build/Release/exam_online_cpp.exe
```

启动后访问：

- 首页：[http://127.0.0.1:8000](http://127.0.0.1:8000)
- API：`http://127.0.0.1:8000/api/v2`

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
- `GET /api/v2/health`

## 代码库结构

```text
exam-online-cpp/
├── cpp-backend/                 # C++ 后端工程
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

服务启动入口在 [main.cpp](D:/_develop/_side/exam-online-cpp/cpp-backend/src/main.cpp)。

启动时会先创建这些仓储对象：

- `ExamRepository`
- `AnswerRepository`
- `UserRepository`
- `FuriganaRepository`

对应行为：

- [ExamRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/ExamRepository.h)
  - 构造时会执行 `rebuildIndex()`
  - 扫描 `data/paper/jlpt` 下的试卷 JSON
  - 构建内存索引
  - 生成 `.exam_index.json`
- [UserRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/UserRepository.h)
  - 启动时执行 `ensureBaseline()`
  - 检查并补齐 `users.json`、`roles.json`
  - 恢复用户 WAL
- [AnswerRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/AnswerRepository.h)
  - 启动时准备 `data/user/answers`
  - 恢复答题 WAL
- [FuriganaRepository.h](D:/_develop/_side/exam-online-cpp/cpp-backend/src/infrastructure/storage/FuriganaRepository.h)
  - 启动时调用 `reload()`
  - 把振假名字典读入内存

所以：

- 试卷索引和振假名字典属于“服务启动时预加载”
- 用户/答题 WAL 也会在启动时做恢复准备

### 2. 浏览器打开页面时

浏览器先拿到 [static/index.html](D:/_develop/_side/exam-online-cpp/static/index.html)，然后执行：

```html
<script type="module" src="/static/app/main.js"></script>
```

前端启动时：

- [main.ts](D:/_develop/_side/exam-online-cpp/frontend/src/main.ts) 会先请求 `/api/v2/exams?sort=date_desc`
- [exams.ts](D:/_develop/_side/exam-online-cpp/frontend/src/features/exams.ts) 把返回结果按等级分组
- 结果写入前端 store 和 `window.__EXAMS_BY_LEVEL__`

也就是说：

- 前端首页打开时，并不会直接把整个题库 JSON 全量拉到浏览器
- 它只先取“试卷列表摘要”

### 3. 用户实际操作时

后续数据按需加载：

- 选择试卷时，再请求 `/api/v2/exams/{exam_id}`
  - 这时后端才读取该试卷详细 JSON
  - 首次读取后会放入后端缓存
- 查看用户进度时，请求 `/api/v2/progress/{user_id}/exams`
- 提交答案时，写入 `data/user/answers/...`
- 用户和角色信息按对应接口读取 `data/user/*.json`

所以整体逻辑是：

1. 服务启动时预热索引和必要基础数据
2. 页面启动时只加载试卷列表摘要
3. 试卷详情、答题记录、进度、用户信息都在交互时按需加载

## 后端结构说明

后端主入口：

- [main.cpp](D:/_develop/_side/exam-online-cpp/cpp-backend/src/main.cpp)

后端按分层组织：

- `transport`
  - 负责注册 HTTP 路由
  - 当前核心路由在 [ApiRouter.cpp](D:/_develop/_side/exam-online-cpp/cpp-backend/src/transport/ApiRouter.cpp)
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

- `/api/v2`

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

- `cpp-backend/build`
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

- [api-v2.md](D:/_develop/_side/exam-online-cpp/cpp-backend/docs/api-v2.md)

## 常用命令

初始化用户基线：

```powershell
powershell -ExecutionPolicy Bypass -File cpp-backend/tools/migrate_user_baseline.ps1 -BaseDir .
```

构建前端：

```powershell
cd frontend
npm run build
cd ..
```

运行 C++ 测试：

```powershell
ctest --test-dir cpp-backend/build -C Release --output-on-failure
```

运行 API 合约烟雾测试：

```powershell
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/contract_v2_smoke.ps1
```

运行集成烟雾测试：

```powershell
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/integration_flow_smoke.ps1
```

运行性能基线测试：

```powershell
powershell -ExecutionPolicy Bypass -File cpp-backend/tests/perf_read_score.ps1
```

## 当前仓库不再包含的内容

以下内容已经从主实现中移除：

- Python 后端源码
- 前端 `legacyBridge` / `loader` 兼容启动链路
- 旧静态平铺版 JS 模块
- 旧 demo 页面和临时模板页

如果你后续继续扩展，建议直接沿现在这套结构走：

- 后端扩展：`cpp-backend/src/application`、`domain`、`transport`
- 前端扩展：`frontend/src/features`、`frontend/src/viewer`
