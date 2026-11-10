const { expect } = require('@playwright/test');

const practiceDraftMocks = new WeakSet();
async function stubPracticeDraftSync(page) {
  if (practiceDraftMocks.has(page)) return;
  practiceDraftMocks.add(page);
  const drafts = new Map();
  await page.route('**/api/v1/practice-drafts/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const user = pathname.split('/')[4], session = pathname.split('/')[5];
    let data;
    if (request.method() === 'POST') {
      const payload = request.postDataJSON(), id = payload.session_draft.submission;
      const key = `${user}/${id}`, previous = drafts.get(key);
      data = { exam_id: id, session_draft: payload.session_draft, revision: (previous?.revision || 0) + 1 };
      drafts.set(key, data);
    } else if (request.method() === 'DELETE') { drafts.delete(`${user}/${decodeURIComponent(session)}`); data = { cleared: true }; }
    else data = { items: [...drafts.entries()].filter(([key]) => key.startsWith(`${user}/`)).map(([, draft]) => draft) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK', data }) });
  });
}

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
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.removeItem('exam_v2_user');
    localStorage.removeItem('exam_v2_token');
  });
}

async function readStoredSession(page) {
  const stored = await page.evaluate(() => ({
    user: localStorage.getItem('exam_v2_user'),
    token: localStorage.getItem('exam_v2_token')
  }));
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'exam_session');
  return {
    ...stored,
    cookieToken: sessionCookie?.value ?? null,
    hasSessionCookie: Boolean(sessionCookie),
    sessionCookie
  };
}

async function expectGuestEntry(page) {
  const loginEntry = page.locator('#user-menu-trigger:visible, [aria-label="登录账号"]:visible, [title="登录账号"]:visible, #login-entry-btn:visible').first();
  await expect(loginEntry).toBeVisible({ timeout: 20000 });
  await expect(loginEntry).toHaveAttribute('aria-label', /登录账号/);
  return loginEntry;
}

async function loginWithPassword(page, loginId) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  // Authenticate outside the page so workspace initialization/navigation cannot
  // cancel the login request. page.request shares this browser context's cookies.
  await loginApi(page.request, loginId);
  const response = await page.request.get('/api/v1/me/context');
  expect(response.ok()).toBe(true);
  const context = (await response.json()).data;
  const user = {
    ...context.user,
    guest: false,
    token: '',
    profile: context.profile,
    membership: context.membership,
    permissions: context.permissions,
    session_expires_at: context.session?.expires_at || '',
    subscription: context.subscription
  };
  await page.evaluate(user => {
    localStorage.setItem('exam_v2_user', JSON.stringify(user));
    localStorage.removeItem('exam_v2_token');
  }, user);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#user-menu-trigger, [aria-label*="打开个人中心"], [aria-label*="打开账号菜单"], [data-platform-admin-account-menu]').first()).toHaveAttribute('aria-label', /打开(个人中心|账号菜单)|账号菜单/);
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe(loginId);
}

async function openPersonalCenter(page) {
  await page.evaluate(() => window.openPersonalCenter?.());
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '个人中心' })).toBeVisible();
}

async function stubNoisyPersonalCenterApis(page, options = {}) {
  const includeInvitations = options.includeInvitations !== false;
  const includeDrafts = options.includeDrafts !== false;
  const ok = (data) => ({
    code: 'OK',
    message: 'ok',
    data,
    request_id: 'e2e_stub',
    ts: new Date().toISOString()
  });
  const rules = [
    [/\/api\/v1\/streaks\/[^/]+\/summary/, {}],
    [/\/api\/v1\/me\/assignments/, Object.prototype.hasOwnProperty.call(options, 'assignments') ? { items: options.assignments } : []],
    [/\/api\/v1\/me\/study-goals/, {}],
    [/\/api\/v1\/me\/daily-practice/, options.dailyPractice || {}]
  ];
  if (includeDrafts) {
    rules.push([/\/api\/v1\/drafts\/[^/?]+/, {}]);
  }
  if (includeInvitations) {
    rules.push([/\/api\/v1\/me\/invitations/, []]);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'recentLearning')) {
    rules.push([/\/api\/v1\/recent-learning\/[^/?]+/, { items: options.recentLearning }]);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'bookmarkFolders')) {
    rules.push([/\/api\/v1\/bookmark-folders\/[^/?]+/, { items: options.bookmarkFolders }]);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'bookmarks')) {
    rules.push([/\/api\/v1\/bookmarks\/[^/?]+/, options.bookmarks]);
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
  uniqueLoginId,
  stubPracticeDraftSync
};
