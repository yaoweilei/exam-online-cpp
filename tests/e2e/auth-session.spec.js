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

test('运行数据、环境文件和源码不能通过静态文件服务读取', async ({ request }) => {
	for (const path of [
		'/data/user/users.json',
		'/data/system/auth_sessions.json',
		'/.env',
		'/backend/src/main.cpp'
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(404);
	}
});

test('存储、核心服务和磁盘空间满足就绪门禁', async ({ request }) => {
  const response = await request.get('/readyz');
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  expect(payload.data.status).toBe('ready');
  expect(payload.data.checks).toMatchObject({
    static: true,
    paper_store: true,
    user_store: true,
    system_store: true,
    core_services: true,
    disk_space: true
  });
  expect(payload.data.checks.available_disk_mb).toBeGreaterThan(0);
});

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
	await page.locator('#login-agreement').check();
  await page.locator('[data-mode="password"]').click();
  await page.locator('#login-password-phone, #login-username').first().fill(loginId);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-btn-password').click();
}

async function expectLoggedIn(page, loginId) {
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/);
  const stored = await readStoredSession(page);
  expect(stored.token).toBeNull();
  expect(stored.hasSessionCookie).toBeTruthy();
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

test('登录弹窗在手机端支持初始焦点、Esc 关闭和焦点归还', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const loginEntry = await expectGuestEntry(page);
  await loginEntry.focus();
  await loginEntry.click();
  const modal = page.locator('#login-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-hidden', 'false');
  await expect(modal.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#login-phone')).toBeFocused();
  expect(await modal.locator('.login-box').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight;
  })).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(modal).toHaveAttribute('aria-hidden', 'true');
  await expect(loginEntry).toBeFocused();
});

test('密码登录后可以刷新恢复 session，退出后旧 token 失效', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_auth');

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, loginId);

  const storedAfterLogin = await readStoredSession(page);
  expect(storedAfterLogin.token).toBeNull();
  expect(storedAfterLogin.hasSessionCookie).toBeTruthy();
  expect(storedAfterLogin.user).toContain(loginId);

  const verifyBeforeLogout = await verifyToken(request, storedAfterLogin.cookieToken);
  expect(verifyBeforeLogout.code).toBe('OK');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/, { timeout: 20000 });
  const restored = await readStoredSession(page);
  expect(restored.token).toBeNull();
  expect(restored.cookieToken).toBe(storedAfterLogin.cookieToken);

  await openPersonalCenter(page);
  await expect(page.locator('#pc-name')).toContainText(loginId);
  await expect(page.locator('#pc-roles')).toContainText(/学员|student/);

  await page.locator('.pc-logout-action').click();
  await expectGuestEntry(page);
  await expect(page.locator('#personal-center.pc-open')).toHaveCount(0);

  const storedAfterLogout = await readStoredSession(page);
  expect(storedAfterLogout.token).toBeNull();
  expect(storedAfterLogout.hasSessionCookie).toBeFalsy();
  expect(storedAfterLogout.user).toBeNull();

  const verifyAfterLogout = await verifyToken(request, storedAfterLogin.cookieToken);
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
	await page.locator('#login-agreement').check();
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
  expect(stored.token).toBeNull();
  expect(stored.hasSessionCookie).toBeTruthy();
  expect(stored.user).toContain(loginId);
});

test('手机号验证码可以通过登录弹窗自动创建账号并登录', async ({ page }) => {
  const phone = `138${Math.floor(10000000 + Math.random() * 89999999)}`;

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
	await page.locator('#login-agreement').check();
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

test('认证会话使用 HttpOnly Cookie，并对连续密码错误执行锁定', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_security');
  await registerUserApi(request, loginId, 'Correct12345');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  const loginResponse = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return { ok: response.ok, payload: await response.json() };
  }, { username: loginId, password: 'Correct12345' });
  expect(loginResponse.ok).toBeTruthy();
  expect(loginResponse.payload.code).toBe('OK');

  const stored = await readStoredSession(page);
  expect(stored.token).toBeNull();
  expect(stored.sessionCookie).toMatchObject({
    name: 'exam_session',
    httpOnly: true,
    sameSite: 'Lax'
  });

  const health = await request.get('/api/v1/health');
  expect(health.headers()['x-content-type-options']).toBe('nosniff');
  expect(health.headers()['x-frame-options']).toBe('DENY');
  expect(health.headers()['content-security-policy']).toContain("object-src 'none'");

  await clearBrowserSession(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.post('/api/v1/auth/login', {
      data: { username: loginId, password: 'Wrong12345' }
    });
    expect(response.status()).toBe(401);
  }
  const locked = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'Wrong12345' }
  });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).code).toBe('AUTH_RATE_LIMITED');

  const correctWhileLocked = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'Correct12345' }
  });
  expect(correctWhileLocked.status()).toBe(429);
});

test('个人中心可以查看并退出其他登录设备', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_session_devices');
  await page.setViewportSize({ width: 390, height: 844 });
  const firstSession = await registerUserApi(request, loginId, 'Session12345');
  const secondLogin = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'Session12345' },
    headers: { 'User-Agent': 'E2E Second Device Chrome Windows' }
  });
  expect(secondLogin.ok()).toBeTruthy();
  const secondSession = (await secondLogin.json()).data;

  await stubNoisyPersonalCenterApis(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.context().addCookies([{
    name: 'exam_session',
    value: secondSession.token,
    url: new URL(page.url()).origin,
    httpOnly: true,
    sameSite: 'Lax'
  }]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/, { timeout: 20000 });

  await openPersonalCenter(page);
  await page.locator('[data-dashboard-page="account-core"]').click();
  await page.locator('[data-account-action="sessions"]').click();
  await expect(page.locator('.pc-account-session-row')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('.pc-account-session-row', { hasText: '当前设备' })).toHaveCount(1);
  expect(await page.locator('.pc-account-editor').evaluate((element) =>
    element.scrollWidth <= element.clientWidth
  )).toBeTruthy();
  const actionWidths = await page.locator('.pc-account-actions button').evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().width))
  );
  expect(actionWidths.every((width) => width > 0 && width <= 350)).toBeTruthy();

  await page.locator('[data-account-revoke-session]').click();
  await page.locator('[data-pc-confirm-ok]').click();
  await expect(page.locator('#pc-toast')).toContainText('该设备已退出', { timeout: 20000 });
  await expect(page.locator('.pc-account-session-row')).toHaveCount(1);

  expect((await verifyToken(request, firstSession.token)).code).toBe('TOKEN_INVALID');
  expect((await verifyToken(request, secondSession.token)).code).toBe('OK');
});

test('Cookie 会话拒绝跨站写请求并允许本站请求', async ({ request }) => {
  const loginId = uniqueLoginId('student_csrf');
  const session = await registerUserApi(request, loginId, 'CsrfTest12345');
  const cookie = `exam_session=${session.token}`;

  const blocked = await request.post('/api/v1/auth/logout', {
    headers: {
      Cookie: cookie,
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site'
    },
    data: { token: '__cookie_session__' }
  });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe('CROSS_SITE_REQUEST_BLOCKED');
  expect((await verifyToken(request, session.token)).code).toBe('OK');

  const allowed = await request.post('/api/v1/auth/logout', {
    headers: {
      Cookie: cookie,
      Origin: 'http://127.0.0.1:8000',
      'Sec-Fetch-Site': 'same-origin'
    },
    data: { token: '__cookie_session__' }
  });
  expect(allowed.ok()).toBeTruthy();
  expect((await allowed.json()).code).toBe('OK');
  expect((await verifyToken(request, session.token)).code).toBe('TOKEN_INVALID');
});

test('忘记密码可以通过验证码重置，并用新密码登录', async ({ page, request }) => {
  const loginId = uniqueLoginId('student_reset_password');
  await registerUserApi(request, loginId, 'Before12345');

  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
	await page.locator('#login-agreement').check();
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

  const initialLogin = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'OldPass12345' }
  });
  expect(initialLogin.ok()).toBeTruthy();
  const initialPayload = await initialLogin.json();
  expect(initialPayload.code).toBe('OK');
  const session = initialPayload.data;
  const context = await getMeContext(request, session.token);

  await stubNoisyPersonalCenterApis(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.context().addCookies([{
    name: 'exam_session',
    value: session.token,
    url: new URL(page.url()).origin,
    httpOnly: true,
    sameSite: 'Lax'
  }]);
  await page.evaluate(({ session, context }) => {
    localStorage.removeItem('exam_v2_token');
    localStorage.setItem('exam_v2_user', JSON.stringify({
      ...context.user,
      guest: false,
      token: '',
      profile: context.profile,
      membership: context.membership,
      permissions: context.permissions,
      session_expires_at: context.session?.expires_at || '',
      subscription: context.subscription
    }));
  }, { session, context });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await openPersonalCenter(page);
  await page.locator('[data-dashboard-page="account-core"]').click();
  await page.locator('[data-account-action="password"]').click();
  const passwordForm = page.locator('form[data-account-password-form]');
  await expect(passwordForm).toBeVisible();
  await passwordForm.locator('[data-account-current-password]').fill('OldPass12345');
  await passwordForm.locator('[data-account-new-password]').fill('NewPass12345');
  await passwordForm.locator('[data-account-confirm-password]').fill('NewPass12345');
  await passwordForm.locator('button[type="submit"]').click();
  await expect(page.locator('#pc-toast')).toContainText('密码已更新', { timeout: 20000 });

  await page.locator('.pc-logout-action').click();
  await expectGuestEntry(page);

  const oldPasswordLogin = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'OldPass12345' }
  });
  const oldPasswordPayload = await oldPasswordLogin.json();
  expect(oldPasswordLogin.ok()).toBeFalsy();
  expect(oldPasswordPayload.code).not.toBe('OK');

  const newPasswordLogin = await request.post('/api/v1/auth/login', {
    data: { username: loginId, password: 'NewPass12345' }
  });
  expect(newPasswordLogin.ok()).toBeTruthy();
  expect((await newPasswordLogin.json()).code).toBe('OK');
});

test('微信开发存根返回的测试账号可以通过登录弹窗建立登录态', async ({ page }) => {
  await stubNoisyPersonalCenterApis(page);
  await openLoginModal(page);
	await page.locator('#login-agreement').check();
	await page.locator('[data-mode="wechat"]').click();
  await expect(page.locator('#wechat-test-id-list')).toBeVisible({ timeout: 20000 });
  await page.locator('#wechat-test-id-list .login-test-id-item', { hasText: 'student_demo' }).click();

  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger').first()).toHaveAttribute('aria-label', /打开个人中心/);
  const stored = await readStoredSession(page);
  expect(stored.token).toBeNull();
  expect(stored.hasSessionCookie).toBeTruthy();
  expect(stored.user).toContain('student_demo');
});

test('OAuth 只展示已支持入口，未配置提供方由后端明确拒绝', async ({ page, request }) => {
  await stubNoisyPersonalCenterApis(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await expect(page.locator('[data-oauth="google"]')).toBeVisible();
  await expect(page.locator('[data-oauth="github"]')).toHaveCount(0);
  const response = await request.get('/api/v1/auth/oauth/github/start');
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe('OAUTH_PROVIDER_DISABLED');
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
