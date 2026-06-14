# exam_online_cpp_v2

C++20 + Drogon backend for `/api/v1` with JSON storage, indexing, cache and WAL support.

## Build

```bash
cmake -S backend -B backend/build
cmake --build backend/build --config Release
```

## Run

```bash
./backend/build/exam_online_cpp
```

Environment variables:

- `HOST` (default `0.0.0.0`)
- `PORT` (default `8000`)
- `THREADS` (default `4`)
- `APP_ENV` (`development|production`, default `development`)
- `BASE_DIR` (default current workspace)
- `DOCUMENT_ROOT` (default `BASE_DIR`)
- `PUBLIC_WEB_BASE_URL` (default `http://127.0.0.1:8000`, used when composing invitation links)
- `REFERRAL_REWARD_CREDITS` (default `10`, credits granted to the referrer when a referred user activates a paid personal subscription)
- `LOG_DIR` (default `BASE_DIR/logs/backend`)
- `LOG_FILE_BASENAME` (default `exam-online-cpp`)
- `LOG_FILE_SIZE` (default `100000000`)
- `LOG_MAX_FILES` (default `10`)
- `LOG_LEVEL` (`DEBUG|INFO|WARN|ERROR`)
- `SMS_PROVIDER` (`stub|twilio`, default `stub`)
- `SMS_ACCOUNT_SID`, `SMS_AUTH_TOKEN`, `SMS_FROM_NUMBER`, `SMS_API_BASE_URL`
- `EMAIL_PROVIDER` (`stub|resend`, default `stub`)
- `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_API_BASE_URL`
- `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `WECHAT_CALLBACK_BASE_URL`

Logging defaults:

- `APP_ENV=development` -> default `LOG_LEVEL=DEBUG`
- `APP_ENV=production` -> default `LOG_LEVEL=INFO`
- You can force quieter production logs with `LOG_LEVEL=ERROR`

Invitation delivery and verification:

- In local development, keep `SMS_PROVIDER=stub` and `EMAIL_PROVIDER=stub`; the backend prints outgoing messages to stdout.
- To send real email invitations, set `EMAIL_PROVIDER=resend` and provide `EMAIL_API_KEY` plus `EMAIL_FROM_ADDRESS`.
- To send real SMS invitations, set `SMS_PROVIDER=twilio` and provide `SMS_ACCOUNT_SID`, `SMS_AUTH_TOKEN`, and `SMS_FROM_NUMBER`.
- Invitation acceptance is now strict: the receiving user must log in and verify the exact invited email or phone before `/api/v1/organizations/invitations/accept` succeeds.

Referral rewards:

- By default, the referrer receives `10` credits when the referred user activates a paid personal `pro` or `ultra` subscription.
- You can change that amount with `REFERRAL_REWARD_CREDITS` without recompiling the application.

## User/Role baseline migration

```bash
powershell -ExecutionPolicy Bypass -File backend/tools/migrate_user_baseline.ps1 -BaseDir .
```

## API

All new endpoints are under `/api/v1` and return:

```json
{
  "code": "OK",
  "message": "ok",
  "data": {},
  "request_id": "req_xxx",
  "ts": "2026-01-01T00:00:00.000Z"
}
```
