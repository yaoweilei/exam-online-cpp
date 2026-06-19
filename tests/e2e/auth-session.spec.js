const { test, expect } = require('@playwright/test');
const {
  clearBrowserSession,
  expectGuestEntry,
  loginApi,
  loginWithPassword,
  openPersonalCenter,
  readStoredSession,
  stubNoisyPersonalCenterApis,
  uniqueLoginId
} = require('./helpers/session');

async function verifyToken(request, token) {
  const response = await request.get(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`);
  return await response.json();
}

async function getMeContext(request, token) {
  const response = await request.get(`/api/v1/me/context?token=${encodeURIComponent(token)}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function registerUserApi(request, loginId, password) {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      username: loginId,
      email: `${loginId}@example.local`,
      password
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function openLoginModal(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
}

async function fillPasswordLogin(page, loginId, password) {
  await page.locator('[data-mode="password"]').click();
  await page.locator('[data-password-view="login"]').click();
  await page.locator('#login-username').fill(loginId);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-btn-password').click();
}

async function expectLoggedIn(page, loginId) {
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/);
  const stored = await readStoredSession(page);
  expect(stored.token).toBeTruthy();
  expect(stored.user).toContain(loginId);
  return stored;
}

async function logoutFromPersonalCenter(page) {
  await openPersonalCenter(page);
  await page.locator('.pc-logout-action').click();
  await expectGuestEntry(page);
}

function responsePayloadData(payload) {
  expect(payload.code).toBe('OK');
  return payload.data ?? {};
}

test('游客状态只打开登录入口，不写入本地账号 session', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const loginEntry = await expectGuestEntry(page);
  await expect(page.locator('#personal-center.pc-open')).toHaveCount(0);
  await expect(page.locator('#login-modal')).not.toHaveClass(/active/);

  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();

  const stored = await readStoredSession(page);
  expect(stored.token).toBeNull();
  expect(stored.user).toBeNull();
});

test('密码登录后可以刷新恢复 session，退出后旧 token 失效', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_auth');

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, loginId);

  const storedAfterLogin = await readStoredSession(page);
  expect(storedAfterLogin.token).toBeTruthy();
  expect(storedAfterLogin.user).toContain(loginId);

  const verifyBeforeLogout = await verifyToken(request, storedAfterLogin.token);
  expect(verifyBeforeLogout.code).toBe('OK');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/, { timeout: 20000 });
  const restored = await readStoredSession(page);
  expect(restored.token).toBe(storedAfterLogin.token);

  await openPersonalCenter(page);
  await expect(page.locator('#pc-name')).toContainText(loginId);
  await expect(page.locator('#pc-roles')).toContainText(/学员|student/);

  await page.locator('.pc-logout-action').click();
  await expectGuestEntry(page);
  await expect(page.locator('#personal-center.pc-open')).toHaveCount(0);

  const storedAfterLogout = await readStoredSession(page);
  expect(storedAfterLogout.token).toBeNull();
  expect(storedAfterLogout.user).toBeNull();

  const verifyAfterLogout = await verifyToken(request, storedAfterLogin.token);
  expect(verifyAfterLogout.code).toBe('TOKEN_INVALID');
});

test('新用户可以通过注册入口创建账号并自动登录', async ({ page }) => {
  const loginId = uniqueLoginId('student_register');

  await stubNoisyPersonalCenterApis(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('[data-mode="password"]').click();
  await page.locator('[data-password-view="register"]').click();
  await page.locator('#register-username').fill(loginId);
  await page.locator('#register-email').fill(`${loginId}@example.local`);
  await page.locator('#register-password').fill('Register12345');
  await page.locator('#register-password-confirm').fill('Register12345');
  await page.locator('#login-btn-register').click();

  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/);

  const stored = await readStoredSession(page);
  expect(stored.token).toBeTruthy();
  expect(stored.user).toContain(loginId);
});

test('手机号验证码可以通过登录弹窗自动创建账号并登录', async ({ page }) => {
  const phone = `138${Math.floor(10000000 + Math.random() * 89999999)}`;

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
  await page.locator('[data-mode="phone"]').click();
  await page.locator('#login-phone').fill(phone);

  const sendCodeResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/auth/phone/send-code') && response.request().method() === 'POST'
  );
  await page.locator('#login-btn-send-code').click();
  const sendPayload = await (await sendCodeResponse).json();
  const sendData = responsePayloadData(sendPayload);
  expect(sendData.debug_code).toMatch(/^\d{6}$/);
  expect(sendData.daily_limit).toBe(5);
  expect(sendData.daily_remaining).toBeGreaterThanOrEqual(0);

  await page.locator('#login-phone-code').fill(sendData.debug_code);
  await page.locator('#login-btn-phone-verify').click();

  await expectLoggedIn(page, phone);
});

test('密码登录输错时不会建立 session，并展示错误提示', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_bad_password');
  await registerUserApi(request, loginId, 'Correct12345');

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
  await fillPasswordLogin(page, loginId, 'Wrong12345');

  await expect(page.locator('#login-modal')).toBeVisible();
  await expect(page.locator('#login-error')).toContainText(/invalid|登录失败|用户名|密码/i, { timeout: 20000 });
  const stored = await readStoredSession(page);
  expect(stored.token).toBeNull();
  expect(stored.user).toBeNull();
});

test('忘记密码可以通过验证码重置，并用新密码登录', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_reset_password');
  await registerUserApi(request, loginId, 'Before12345');

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
  await page.locator('[data-mode="password"]').click();
  await page.locator('[data-password-view="reset"]').click();
  await page.locator('#reset-login-id').fill(loginId);

  const sendCodeResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/auth/password/reset/send-code') && response.request().method() === 'POST'
  );
  await page.locator('#login-btn-reset-send-code').click();
  const sendPayload = await (await sendCodeResponse).json();
  const sendData = responsePayloadData(sendPayload);
  expect(sendData.debug_code).toMatch(/^\d{6}$/);

  await page.locator('#reset-code').fill(sendData.debug_code);
  await page.locator('#reset-new-password').fill('After12345');
  await page.locator('#login-btn-reset-password').click();
  await expectLoggedIn(page, loginId);

  await logoutFromPersonalCenter(page);
  await page.locator('#user-menu-trigger').first().click();
  await fillPasswordLogin(page, loginId, 'After12345');
  await expectLoggedIn(page, loginId);
});

test('登录后可以在个人中心修改密码，旧密码失效新密码生效', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_change_password');
  await registerUserApi(request, loginId, 'OldPass12345');

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
  await fillPasswordLogin(page, loginId, 'OldPass12345');
  await expectLoggedIn(page, loginId);

  await openPersonalCenter(page);
  await page.locator('button.service-item[data-intent="gotoProfile"]').click();
  await expect(page.locator('form[data-password-change-form]')).toBeVisible();
  await page.locator('#pc-current-password').fill('OldPass12345');
  await page.locator('#pc-new-password').fill('NewPass12345');
  await page.locator('form[data-password-change-form] button[type="submit"]').click();
  await expect(page.locator('#pc-toast')).toContainText('密码已更新', { timeout: 20000 });

  await page.locator('.pc-logout-action').click();
  await expectGuestEntry(page);

  await page.locator('#user-menu-trigger').first().click();
  await fillPasswordLogin(page, loginId, 'OldPass12345');
  await expect(page.locator('#login-error')).toContainText(/invalid|登录失败|用户名|密码/i, { timeout: 20000 });

  await page.locator('#login-password').fill('NewPass12345');
  await page.locator('#login-btn-password').click();
  await expectLoggedIn(page, loginId);
});

test('微信开发存根可以通过登录弹窗建立登录态', async ({ page }) => {
  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
  await expect(page.locator('#wechat-test-id-list')).toBeVisible({ timeout: 20000 });
  await page.locator('#wechat-test-id-list .login-test-id-item', { hasText: 'wxdev_001' }).click();

  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/);
  const stored = await readStoredSession(page);
  expect(stored.token).toBeTruthy();
  expect(stored.user).toContain('wxdev_001');
});

test('OAuth mock 回调可以建立前端登录态', async ({ page }) => {
  await stubNoisyPersonalCenterApis(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('.login-oauth-btn[data-oauth="github"]').click();

  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/, { timeout: 20000 });
  const stored = await readStoredSession(page);
  expect(stored.token).toBeTruthy();
  expect(stored.user).toContain('mock-github@example.com');
});

test('开发测试账号可以识别 student、teacher、orgAdmin、superAdmin 角色与权限', async ({ request }) => {
  const cases = [
    { prefix: 'student_auth_role', role: 'student', features: ['profile'], sections: ['learning'], absentSections: ['admin-hub'] },
    { prefix: 'teacher_auth_role', role: 'teacher', features: ['questions'], sections: ['admin-hub'] },
    { prefix: 'orgadmin_auth_role', role: 'orgAdmin', features: ['memberAdmin'], sections: ['admin-hub'] },
    { prefix: 'superadmin_auth_role', role: 'superAdmin', features: ['sysFlags'], sections: ['admin-hub'] }
  ];

  for (const item of cases) {
    const loginId = uniqueLoginId(item.prefix);
    const session = await loginApi(request, loginId);
    expect(session.roles).toContain(item.role);

    const context = await getMeContext(request, session.token);
    const roles = context.permissions?.roles ?? [];
    const features = (context.permissions?.features ?? []).map((item) => item.id);
    const sections = (context.permissions?.sections ?? []).map((item) => item.id);
    expect(roles).toContain(item.role);
    for (const feature of item.features) {
      expect(features).toContain(feature);
    }
    for (const section of item.sections) {
      expect(sections).toContain(section);
    }
    for (const section of item.absentSections ?? []) {
      expect(sections).not.toContain(section);
    }
    expect(context.user?.username).toBe(loginId);
  }
});
