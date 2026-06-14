# Web E2E tests

This project uses Playwright for browser-level automation.

Useful commands:

```powershell
npm run e2e:auto
npm run e2e:auto:headed
npm run e2e:auto:ui
```

`e2e:auto:headed` runs the tests in a visible browser, so product flows can be watched while the assertions run.
`e2e:auto:ui` opens Playwright's interactive runner for step-by-step inspection, screenshots, traces, and retries.

Current browser coverage:

- organization invitation flow
- institution teaching core flow: class/assignment visibility, action entry points, gradebook, student profile
- personal account wallet flow: redeem code, coupon package, recharge modal, payment ledger
- exam viewer flow: exam selection, answer/explanation toggles, kana/Chinese toggles, question map
- EJU viewer regressions: answer card must not show `Section`; listening/listening-reading answer view must not show the original-layout image block

Backend-only smoke tests still exist under `backend/tests`, but new user-facing flows should prefer Playwright specs in this folder.
