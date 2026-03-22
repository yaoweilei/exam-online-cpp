# exam_online_cpp_v2

C++20 + Drogon backend for `/api/v2` with JSON storage, indexing, cache and WAL support.

## Build

```bash
cmake -S cpp-backend -B cpp-backend/build
cmake --build cpp-backend/build --config Release
```

## Run

```bash
./cpp-backend/build/exam_online_cpp
```

Environment variables:

- `HOST` (default `0.0.0.0`)
- `PORT` (default `8000`)
- `THREADS` (default `4`)
- `APP_ENV` (`development|production`, default `development`)
- `BASE_DIR` (default current workspace)
- `DOCUMENT_ROOT` (default `BASE_DIR`)
- `LOG_DIR` (default `BASE_DIR/logs/backend`)
- `LOG_FILE_BASENAME` (default `exam-online-cpp`)
- `LOG_FILE_SIZE` (default `100000000`)
- `LOG_MAX_FILES` (default `10`)
- `LOG_LEVEL` (`DEBUG|INFO|WARN|ERROR`)

Logging defaults:

- `APP_ENV=development` -> default `LOG_LEVEL=DEBUG`
- `APP_ENV=production` -> default `LOG_LEVEL=INFO`
- You can force quieter production logs with `LOG_LEVEL=ERROR`

## User/Role baseline migration

```bash
powershell -ExecutionPolicy Bypass -File cpp-backend/tools/migrate_user_baseline.ps1 -BaseDir .
```

## API

All new endpoints are under `/api/v2` and return:

```json
{
  "code": "OK",
  "message": "ok",
  "data": {},
  "request_id": "req_xxx",
  "ts": "2026-01-01T00:00:00.000Z"
}
```
