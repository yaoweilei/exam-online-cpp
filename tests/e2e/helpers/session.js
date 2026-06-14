const { expect } = require('@playwright/test');

function uniqueLoginId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function loginApi(request, loginId) {
  const response = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: '' }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function clearBrowserSession(page) {
  await page.evaluate(() => {
    localStorage.removeItem('exam_v2_user');
    localStorage.removeItem('exam_v2_token');
  });
}

async function readStoredSession(page) {
  return await page.evaluate(() => ({
    user: localStorage.getItem('exam_v2_user'),
    token: localStorage.getItem('exam_v2_token')
  }));
}

async function expectGuestEntry(page) {
  const loginEntry = page.locator('#user-menu-trigger, [aria-label="登录账号"], [title="登录账号"], #login-entry-btn').first();
  await expect(loginEntry).toBeVisible({ timeout: 20000 });
  await expect(loginEntry).toHaveAttribute('aria-label', /登录账号/);
  return loginEntry;
}

async function loginWithPassword(page, loginId) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('[data-mode="password"]').click();
  await page.locator('#login-username').fill(loginId);
  await page.locator('#login-password').fill('');
  await page.locator('#login-btn-password').click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger, [aria-label*="打开个人中心"]').first()).toHaveAttribute('aria-label', /打开个人中心/);
}

async function openPersonalCenter(page) {
  await page.locator('#user-menu-trigger, [aria-label*="打开个人中心"]').first().click();
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '个人中心' })).toBeVisible();
}

async function stubNoisyPersonalCenterApis(page, options = {}) {
  const includeInvitations = options.includeInvitations !== false;
  const ok = (data) => ({
    code: 'OK',
    message: 'ok',
    data,
    request_id: 'e2e_stub',
    ts: new Date().toISOString()
  });
  const rules = [
    [/\/api\/v1\/streaks\/[^/]+\/summary/, {}],
    [/\/api\/v1\/drafts\/[^/?]+/, {}],
    [/\/api\/v1\/me\/assignments/, []],
    [/\/api\/v1\/me\/study-goals/, {}],
    [/\/api\/v1\/me\/daily-practice/, {}]
  ];
  if (includeInvitations) {
    rules.push([/\/api\/v1\/me\/invitations/, []]);
  }

  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const matched = rules.find(([pattern]) => pattern.test(url));
    if (!matched) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok(matched[1]))
    });
  });
}

module.exports = {
  clearBrowserSession,
  expectGuestEntry,
  loginApi,
  loginWithPassword,
  openPersonalCenter,
  readStoredSession,
  stubNoisyPersonalCenterApis,
  uniqueLoginId
};
