# Frontend v2 modules

TypeScript sources live in `frontend/src` and compile to `static/app`.

Viewer module status:

- Already strict-typed (no `@ts-nocheck`):
  - `viewer/core/APIClient.ts`
  - `viewer/core/ExamViewer.ts`
  - `viewer/core/ExamLoader.ts`
  - `viewer/core/UserContextManager.ts`
  - `viewer/personalCenter.ts`
  - `viewer/managers/AnswerManager.ts`
  - `viewer/managers/AudioManager.ts`
  - `viewer/managers/CategoryNavigationManager.ts`
  - `viewer/managers/FuriganaManager.ts`
  - `viewer/managers/NavigationManager.ts`
  - `viewer/managers/QuestionMapManager.ts`
  - `viewer/renderers/QuestionRenderer.ts`
  - `viewer/managers/StateManager.ts`
  - `viewer/utils/*`
- Remaining staged modules (still `@ts-nocheck`): none.

Round 4 enhancements:
- `viewer/personalCenter.ts` keeps strict typing and restores richer UI behavior:
  - dashboard cards + service intents
  - role overview + mock user impersonation
  - system flags table + risk confirmation modal
  - WeChat login modal flow (simulated)

Runtime boot flow:
- `main.ts` now directly imports `viewerBootstrap.ts`
- `viewerBootstrap.ts` loads the viewer modules in-order and initializes the page
- `legacyBridge.ts` and `legacy/loader.ts` are removed; there is no script-injection compatibility boot path anymore
- viewer modules now live under `frontend/src/viewer` and compile to `static/app/viewer`

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
