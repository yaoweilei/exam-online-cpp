const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');

test.use({ actionTimeout: 15000 });

async function fixture(page, { student = false, count = 2, teaching = false } = {}) {
  const state = { fail: false, failRead: false, requests: [], items: Array.from({ length: count }, (_, i) => ({
    id: `notification-${i}`, title: `系统通知 ${i}`, message: `消息内容 ${i}`, created_at: new Date(Date.now() - i * 60000).toISOString(), read_at: ''
  })) };
  await page.route('**/api/v1/payments/notifications**', async route => {
    const req = route.request(), url = new URL(req.url());
    state.requests.push(url.searchParams.toString());
    if (state.fail || req.method() !== 'GET' && state.failRead) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '消息服务暂不可用，请重试' } });
    if (req.method() !== 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').at(-2));
      for (const item of state.items) if (url.pathname.endsWith('/read-all') || item.id === id) item.read_at = new Date().toISOString();
      return route.fulfill({ json: { code: 'OK', data: {} } });
    }
    const unread = url.searchParams.get('unread_only') === 'true';
    const items = state.items.filter(item => !unread || !item.read_at);
    const p = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('page_size') || 20);
    await route.fulfill({ json: { code: 'OK', data: { items: items.slice((p - 1) * size, p * size), total: items.length, unread_count: state.items.filter(item => !item.read_at).length } } });
  });
  if (teaching) await page.route('**/api/v1/me/assignments**', route => route.fulfill({ json: { code: 'OK', data: { items: [{ assignment_id: 'shared-message-assignment', title: '教学消息验证作业', exam_id: 'N3_2024_12', own_reminders: [{ reminder_id: 'global-test-reminder', message: '请及时完成这份作业', created_at: '2026-10-22T01:00:00Z' }] }] } } }));
  const name = uniqueLoginId(student ? 'student_messages' : 'superadmin_messages');
  await loginApi(page.request, name);
  const ctx = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), { ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, permissions: ctx.permissions, subscription: ctx.subscription });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe(name);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  return { state, shell: page.locator('#platform-admin-shell') };
}

test('七个身份共用顶栏消息入口，窄屏可见，返回保留角色与业务页面', async ({ page }, info) => {
  test.setTimeout(150000);
  const { shell } = await fixture(page);
  for (const role of ['superAdmin', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin', 'student']) {
    if (await shell.getAttribute('data-learning-role') !== role) {
      await shell.locator('[data-platform-admin-account-menu]').click();
      await shell.locator('.pc-role-identity-menu > summary').click();
      await shell.locator(`[data-role-workbench="${role}"]`).click();
    }
    await expect(shell).toHaveAttribute('data-learning-role', role);
    await page.waitForLoadState('networkidle');
    await expect(shell.locator('.pc-platform-sidebar')).not.toContainText('消息中心');
    await expect(shell.locator('.pc-home-message, .pc-home-footer')).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const bell = shell.locator('[data-global-messages]');
      await expect(bell).toBeVisible();
      const { bounds, avatar } = await bell.evaluate(button => ({ bounds: button.getBoundingClientRect().toJSON(), avatar: button.parentElement.querySelector('[data-platform-admin-account-menu]').getBoundingClientRect().toJSON() }));
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(avatar.x + 1);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await bell.click();
      await expect(shell.locator('[data-message-center-list]')).toBeVisible();
      await expect(shell).toHaveAttribute('data-learning-role', role);
      await expect(shell.locator('[data-message-center-category]')).toHaveText(['全部', '未读 (2)']);
      expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await shell.locator('[data-workspace-back]').click();
      await expect(shell.locator('[data-message-center-list]')).toHaveCount(0);
      await expect(shell).toHaveAttribute('data-learning-role', role);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.locator('.pc-role-identity-menu > summary').click();
  await shell.locator('[data-role-workbench="superAdmin"]').click();
  await navigateWorkspace(shell, 'users', true);
  const titleBeforeMessages = await shell.locator('.pc-workspace-page-heading h1').innerText();
  await shell.locator('[data-global-messages]').click();
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText(titleBeforeMessages);
  await expect(shell.locator('.pc-platform-sidebar [aria-current="page"]')).toHaveText('用户管理');
  await shell.locator('[data-global-messages]').click();
  await page.screenshot({ path: info.outputPath('messages-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  await expect(shell.locator('.pc-message-center-row').first()).toHaveCSS('background-color', 'rgb(48, 43, 39)');
  await expect(shell.locator('.pc-message-center-row-title strong').first()).toHaveCSS('color', 'rgb(232, 230, 227)');
  await page.screenshot({ path: info.outputPath('messages-mobile-dark.png') });
});

test('未读筛选在服务器执行，角标支持99+，单条与全部已读跨角色保持一致', async ({ page }) => {
  const { shell, state } = await fixture(page, { count: 105 });
  await expect(shell.locator('.pc-global-message-badge')).toHaveText('99+');
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-message-center-row')).toHaveCount(20);
  await shell.locator('[data-message-center-more]').click();
  await expect(shell.locator('.pc-message-center-row')).toHaveCount(40);
  // Place the only unread message beyond the first all-message page.
  state.items.forEach((item, index) => item.read_at = index === 104 ? '' : new Date().toISOString());
  await shell.locator('[data-message-center-category="unread"]').click();
  await expect(shell.locator('.pc-message-center-row')).toHaveCount(1);
  await expect(shell.locator('.pc-message-center-row')).toContainText('系统通知 104');
  expect(state.requests.some(query => query.includes('unread_only=true'))).toBeTruthy();
  state.failRead = true;
  await shell.locator('[data-message-read]').click();
  await expect(shell.locator('[data-message-read]')).toBeEnabled();
  await expect(shell.locator('.pc-global-message-badge')).toHaveText('1');
  state.failRead = false;
  await shell.locator('[data-message-read]').click();
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
  await expect(shell.locator('.pc-message-center-empty')).toHaveText('没有未读消息。');
  state.items[0].read_at = ''; state.items[1].read_at = '';
  await shell.locator('[data-message-center-refresh]').click();
  await expect(shell.locator('.pc-global-message-badge')).toHaveText('2');
  await shell.locator('[data-message-read-all]').click();
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.locator('.pc-role-identity-menu > summary').click();
  await shell.locator('[data-role-workbench="teacher"]').click();
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
});

test('教学提醒已读记录保存到账号，刷新保留，学员顶部同样可达', async ({ page }, info) => {
  const { shell } = await fixture(page, { student: true, count: 0, teaching: true });
  await expect(shell.locator('.pc-global-message-badge')).toHaveText('1');
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-message-center-row')).toContainText('请及时完成这份作业');
  await shell.locator('[data-message-read]').click();
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
  const receipts = (await (await page.request.get('/api/v1/me/message-reads')).json()).data;
  expect(receipts['global-test-reminder']).toBeTruthy();
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('[data-message-read]')).toHaveCount(0);
  await expect(shell.locator('.pc-message-center-row')).toContainText('教学消息');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('learner-messages.png') });
  await page.evaluate(() => window.closeLearningWorkspace());
  const practiceBell = page.locator('#learning-account [data-global-messages]');
  await expect(practiceBell).toBeVisible();
  await practiceBell.click();
  await expect(shell.locator('[data-message-center-list]')).toBeVisible();
  await shell.locator('[data-workspace-back]').click();
  await expect(shell).toBeHidden();
  await expect(practiceBell).toBeVisible();
});

test('消息读取失败有明确提示，可以重试，游客不显示铃铛', async ({ page }) => {
  const { shell, state } = await fixture(page, { count: 0 });
  state.fail = true;
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('[data-message-center-list] [role="alert"]')).toContainText('消息服务暂不可用');
  await expect(shell.locator('.pc-message-center-empty')).toHaveCount(0);
  state.fail = false;
  await shell.locator('[data-message-center-refresh]').click();
  await expect(shell.locator('.pc-message-center-empty')).toHaveText('暂时没有消息。');
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.removeItem('exam_v2_user'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-global-messages]:visible')).toHaveCount(0);
});

test('非学员身份也收到自己的课程和反馈结果，不混入学员预览作业，已读可保存', async ({ page }) => {
  await page.route('**/api/v1/institution/organizations/staff-org/learning-groups/staff-group/lessons**', route => route.fulfill({ json: { code: 'OK', data: { organization_name: '消息指定机构', group: { name: '消息指定班级' }, items: [], students: [], course_packages: [], assignments: [] } } }));
  await page.route('**/api/v1/me/courses**', route => route.fulfill({ json: { code: 'OK', data: { notifications: [{ id: 'staff-course-notice', title: '机构课程已改期', message: '任课教师的班级课程安排有更新', created_at: '2026-10-26T12:00:00Z', staff_recipient: true, organization_id: 'staff-org', group_id: 'staff-group' }] } } }));
  await page.route('**/api/v1/me/feedback-results**', route => route.fulfill({ json: { code: 'OK', data: [{ feedback_id: 'staff-feedback-result', status: 'resolved', public_reply: '已修正你反馈的题目', updated_at: '2026-10-26T12:01:00Z' }] } }));
  const { shell } = await fixture(page, { count: 0, teaching: true });
  await expect(shell).toHaveAttribute('data-learning-role', 'superAdmin');
  await expect(shell.locator('.pc-global-message-badge')).toHaveText('2');
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-message-center-row')).toHaveCount(2);
  await expect(shell.locator('.pc-message-center-list')).toContainText('任课教师的班级课程安排有更新');
  await expect(shell.locator('.pc-message-center-list')).toContainText('已修正你反馈的题目');
  await expect(shell.locator('.pc-message-center-list')).not.toContainText('请及时完成这份作业');
  await shell.getByRole('button', { name: '查看课程', exact: true }).click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('课程安排');
  await expect(shell.locator('[data-institution-flow=lessons]')).toContainText('消息指定机构');
  await expect(shell.locator('[data-institution-flow=lessons]')).toContainText('消息指定班级');
  await expect(shell).toHaveAttribute('data-learning-role', 'superAdmin');
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('.pc-message-center-row')).toHaveCount(2);
  await shell.locator('[data-message-read-all]').click();
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
  const receipts = (await (await page.request.get('/api/v1/me/message-reads')).json()).data;
  expect(receipts['staff-course-notice']).toBeTruthy();
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  await expect(shell.locator('.pc-global-message-badge')).toBeHidden();
});

test('已读接口只使用当前会话，合并保存，输入校验与账号隔离', async ({ request, playwright, baseURL }) => {
  const a = await playwright.request.newContext({ baseURL });
  const b = await playwright.request.newContext({ baseURL });
  try {
    expect((await request.get('/api/v1/me/message-reads')).status()).toBe(401);
    await loginApi(a, uniqueLoginId('message_receipts_a'));
    await loginApi(b, uniqueLoginId('message_receipts_b'));
    const results = await Promise.all(['a', 'b'].map(id => a.post('/api/v1/me/message-reads', { data: { ids: [id] } })));
    expect(results.every(response => response.ok())).toBeTruthy();
    expect(Object.keys((await (await a.get('/api/v1/me/message-reads')).json()).data).sort()).toEqual(['a', 'b']);
    expect((await (await b.get('/api/v1/me/message-reads')).json()).data).toEqual({});
    for (const ids of [[], [123], ['x'.repeat(257)], Array(201).fill('x')]) expect((await a.post('/api/v1/me/message-reads', { data: { ids } })).status()).toBe(400);
  } finally { await a.dispose(); await b.dispose(); }
});

