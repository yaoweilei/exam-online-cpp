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
- `BASE_DIR` (default current workspace)
- `DOCUMENT_ROOT` (default `BASE_DIR`)
- `LOG_LEVEL` (`DEBUG|INFO|WARN|ERROR`)

## User/Role baseline migration

```bash
python cpp-backend/tools/migrate_user_baseline.py --base-dir .
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
