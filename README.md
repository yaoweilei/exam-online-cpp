# 在线试卷系统（C++ v2）

本项目已完成后端迁移到 **C++20 + Drogon**，并统一使用 **`/api/v2`**。  
旧 Python 后端源码已移除。

## 当前技术栈

- 后端：C++20 + Drogon + CMake
- 前端：TypeScript（`frontend/src`）+ 编译产物 `static/app`
- 数据存储：JSON 文件（含索引、缓存、WAL）

## 目录结构

```text
exam-online-cpp/
├── cpp-backend/               # C++后端工程
│   ├── src/                   # transport/application/domain/infrastructure
│   ├── tools/                 # 迁移工具
│   ├── tests/                 # 合约/集成/性能脚手架
│   └── docs/api-v2.md         # v2接口说明
├── frontend/                  # TypeScript源码
│   └── src/
├── static/
│   ├── index.html             # 页面布局（保持不变）
│   └── app/                   # 前端编译产物（含 legacy TS 化产物）
├── data/                      # 试卷与用户数据
└── start-cpp.bat              # Windows一键启动脚本
```

## 环境准备（Windows）

1. 安装 vcpkg（本机默认：`C:\vcpkg`）
2. 安装 Drogon：

```bash
C:\vcpkg\vcpkg.exe install drogon:x64-windows
```

3. 迁移用户/角色基线（首次）：

```bash
python cpp-backend/tools/migrate_user_baseline.py --base-dir .
```

## 构建与启动

### 方式 1：一键启动

```bash
start-cpp.bat
```

### 方式 2：手动

```bash
cmake -S cpp-backend -B cpp-backend/build -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build cpp-backend/build --config Release
cpp-backend/build/Release/exam_online_cpp.exe
```

启动后访问：

- 应用首页：[http://127.0.0.1:8000](http://127.0.0.1:8000)
- API 根前缀：`/api/v2`

## 前端开发（TypeScript）

```bash
cd frontend
npm install
npm run build
```

编译输出到 `static/app`。  
第二轮迁移已将 legacy 模块转入 `frontend/src/legacy/*.ts` 并编译到 `static/app/legacy`。

## API v2

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

详细接口列表见：

- [cpp-backend/docs/api-v2.md](cpp-backend/docs/api-v2.md)

## 测试

```bash
ctest --test-dir cpp-backend/build --output-on-failure
python cpp-backend/tests/contract_v2_smoke.py
python cpp-backend/tests/integration_flow_smoke.py
python cpp-backend/tests/perf_read_score.py
```
