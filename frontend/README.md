# Frontend v2 modules

TypeScript sources live in `frontend/src` and compile to `static/app`.

Legacy migration status:

- Already strict-typed (no `@ts-nocheck`):
  - `legacy/loader.ts`
  - `legacy/core/APIClient.ts`
  - `legacy/core/ExamViewer.ts`
  - `legacy/core/ExamLoader.ts`
  - `legacy/core/UserContextManager.ts`
  - `legacy/personalCenter.ts`
  - `legacy/managers/AnswerManager.ts`
  - `legacy/managers/AudioManager.ts`
  - `legacy/managers/CategoryNavigationManager.ts`
  - `legacy/managers/FuriganaManager.ts`
  - `legacy/managers/NavigationManager.ts`
  - `legacy/managers/QuestionMapManager.ts`
  - `legacy/renderers/QuestionRenderer.ts`
  - `legacy/managers/StateManager.ts`
  - `legacy/utils/*`
- Remaining staged modules (still `@ts-nocheck`): none.

Round 4 enhancements:
- `legacy/personalCenter.ts` keeps strict typing and restores richer UI behavior:
  - dashboard cards + service intents
  - role overview + mock user impersonation
  - system flags table + risk confirmation modal
  - WeChat login modal flow (simulated)

## Build

```bash
cd frontend
npm install
npm run build
```

Runtime entrypoint in HTML:

```html
<script type="module" src="/static/app/main.js"></script>
```
