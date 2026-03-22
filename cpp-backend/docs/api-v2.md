# API v2

Base prefix: `/api/v2`

## Envelope

```json
{
  "code": "OK",
  "message": "ok",
  "data": {},
  "request_id": "req_...",
  "ts": "2026-01-01T00:00:00.000Z"
}
```

## Endpoints

- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/logout`
- `GET /auth/verify?token=...`
- `GET /exams`
- `GET /exams/{exam_id}`
- `POST /exams`
- `DELETE /exams/{exam_id}`
- `POST /answers/submit`
- `GET /answers/{user_id}/{exam_id}`
- `GET /progress/{user_id}`
- `GET /progress/{user_id}/exams`
- `GET /statistics/{user_id}`
- `GET /statistics/{user_id}/weak-points`
- `GET /statistics/{user_id}/learning-curve?days=30`
- `GET /recommendations/{user_id}?limit=5`
- `GET /users/{user_id}`
- `GET /users/by-role/{role_id}`
- `GET /users/{user_id}/permissions`
- `GET /roles`
- `POST /furigana/add`
- `GET /furigana/reading/{word}`
