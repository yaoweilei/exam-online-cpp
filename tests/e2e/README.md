# Web E2E tests

This project uses Playwright for browser-level automation.

Useful commands:

```powershell
npm run e2e:auto
npm run e2e:auto:headed
npm run e2e:auto:ui
npx playwright test tests/e2e/auth-session.spec.js --ui --ui-host 127.0.0.1 --ui-port 9323
```

`e2e:auto:headed` runs the tests in a visible browser, so product flows can be watched while the assertions run.
`e2e:auto:ui` opens Playwright's interactive runner for step-by-step inspection, screenshots, traces, and retries.
The explicit `auth-session.spec.js --ui-host 127.0.0.1` command is useful on Windows when the Playwright UI tries to open an IPv6 `::1` URL and fails.

Current browser coverage:

- organization invitation flow
- role permission matrix: guest, student, assistant, teacher, orgAdmin, contentAdmin, superAdmin
- institution teaching core flow: learning group/assignment visibility, action entry points, gradebook, student profile, schedule/course-package/student-relationship workbench
- P2 enhancement flow: PWA, lesson prep handout, saved lesson-prep plans, institution workbench API, admin dashboard, community post/like/comment
- personal account wallet flow: redeem code, coupon package, recharge modal, payment ledger
- exam viewer flow: exam selection, answer/explanation toggles, kana/Chinese toggles, question map
- EJU viewer regressions: answer card must not show `Section`; listening/listening-reading answer view must not show the original-layout image block

Backend-only smoke tests still exist under `backend/tests`, but new user-facing flows should prefer Playwright specs in this folder.
