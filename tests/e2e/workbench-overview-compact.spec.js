const { test, expect } = require('@playwright/test');
const { loginApi } = require('./helpers/session');

async function fixture(page, state = {}) {
  const org = { organization_id: 'org_compact', name: '布局验证机构', seats: 30, status: 'active', members: [], course_packages: [], learning_groups: [], invitations: [] };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data;
    if (path === '/api/v1/admin/statistics/overview') {
      if (state.fail) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '统计暂不可用' } });
      data = { users: { total: 12 }, organizations: { total: 1 } };
    } else if (path === '/api/v1/organizations') data = { items: [org], total: 1, page: 1, pages: 1 };
    else if (path === '/api/v1/organizations/org_compact') data = org;
    else if (path.startsWith('/api/v1/organizations/org_compact/')) data = [];
    else if (path.startsWith('/api/v1/institution/workbench') || path.startsWith('/api/v1/institution/dashboard')) data = { organizations: [org], learning_groups: [], schedule: [], student_relationships: [], assignments: [], renewal_risks: [], course_packages: [] };
    else if (path === '/api/v1/admin/content/workflow') data = state.populated ? [{ id: 'a', status: 'draft' }, { id: 'b', status: 'secondary_approved', inspection: { passed: true }, reviews: { analysis: { status: 'approved' }, secondary: { status: 'approved' } } }] : [];
    else if (path === '/api/v1/feedback') data = { items: state.populated ? [{ id: 'f', status: 'open' }] : [], total: state.populated ? 1 : 0 };
    else if (path.startsWith('/api/v1/admin/payments/')) data = { items: [], total: path.endsWith('/orders') && !url.searchParams.has('q') ? 5 : 0, page: 1, pages: 1 };
    else if (path === '/api/v1/admin/operations') data = { items: [{ type: 'service_issue', title: '测试服务提醒', destination: 'checks' }] };
    else return route.fallback();
    return route.fulfill({ json: { code: 'OK', data } });
  });
  const username = 'superadmin_role_home_compact';
  await loginApi(page.request, username);
  const context = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), {
    ...context.user, guest: false, token: '', profile: context.profile,
    membership: context.membership, permissions: context.permissions,
    session_expires_at: context.session?.expires_at || '', subscription: context.subscription
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe(username);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  return page.locator('#platform-admin-shell');
}

async function role(page, shell, name) {
  if (await shell.getAttribute('data-learning-role') !== name) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('.pc-role-identity-menu > summary').click();
    await shell.locator(`[data-role-workbench="${name}"]`).click();
  }
  await expect(shell).toHaveAttribute('data-learning-role', name);
  await page.waitForLoadState('networkidle');
}

test('教学和内容工作台统计紧凑排列，机构可展开，零待办给出引导', async ({ page }, info) => {
  test.setTimeout(180000);
  const shell = await fixture(page);
  for (const name of ['teacher', 'assistant', 'orgAdmin', 'contentAdmin']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await role(page, shell, name);
    const home = shell.locator(`[data-role-overview="${name}"]`);
    await expect(home.locator('.pc-home-settings-groups')).toBeVisible();
    await expect(home.locator('.pc-platform-stats, .pc-workspace-pending')).toHaveCount(0);
    if (['teacher', 'assistant', 'orgAdmin'].includes(name)) {
      const context = shell.locator('.pc-workspace-org-switch');
      await expect(context).toBeVisible();
      expect(await context.evaluate(element => element.open)).toBe(false);
      await context.locator('summary').click();
      await expect(shell.getByLabel('当前工作台机构')).toBeVisible();
      await expect(shell.getByLabel('当前工作台机构')).toHaveValue('org_compact');
      if (name === 'orgAdmin') {
        await shell.getByLabel('搜索工作台机构').fill('布局');
        await shell.locator('[data-managed-org-list-form]').getByRole('button', { name: '搜索', exact: true }).click();
        await page.waitForLoadState('networkidle');
        expect(await context.evaluate(element => element.open)).toBe(true);
        await expect(shell.getByLabel('当前工作台机构')).toHaveValue('org_compact');
      }
      await context.locator('summary').click();
    }
    await page.screenshot({ path: info.outputPath(`${name}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await shell.locator('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${name}-mobile.png`) });
    if (name === 'teacher') {
      await home.locator('[data-role-admin-intent="openRoleContent:teacher-students"]').click();
      await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('我的学生');
    }
  }
});

test('平台总览将统计与待办并入唯一入口，失败可以重试', async ({ page }, info) => {
  test.setTimeout(180000);
  const state = { fail: true, populated: false };
  const shell = await fixture(page, state);
  await role(page, shell, 'superAdmin');
  const overview = shell.locator('[data-role-overview="superAdmin"]');
  const entry = name => overview.locator(`[data-platform-admin-page="${name}"]`);
  await expect(shell.getByRole('alert')).toContainText('统计暂不可用');
  await expect(entry('users').locator('.pc-home-settings-value')).toHaveText('—');
  state.fail = false; state.populated = true;
  await shell.locator('[data-overview-retry]').click();
  await expect(shell.getByRole('alert')).toHaveCount(0);
  for (const [name, value] of Object.entries({
    users: '12 人', organizations: '1 家', payments: '5 笔订单', content: '2 项待处理', feedback: '1 条待处理'
  })) {
    await expect(entry(name)).toHaveCount(1);
    await expect(entry(name).locator('.pc-home-settings-value')).toHaveText(value);
  }
  await expect(overview.locator('.pc-platform-stats, .pc-workspace-pending')).toHaveCount(0);
  const system = overview.locator('.pc-home-settings-group').filter({ has: page.getByRole('heading', { name: '系统设置', exact: true }) });
  const reminders = system.locator('[data-platform-admin-page="reminders"]');
  await expect(reminders).toContainText('1 项');
  await page.mouse.move(0, 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`platform-directory-${width}.png`) });
  }
  await reminders.click();
  await expect(shell.getByText('测试服务提醒')).toBeVisible();
  await shell.locator('[data-workspace-back]').click();
  await entry('feedback').click();
  await expect(shell.getByRole('list', { name: '反馈列表' })).toBeVisible();
  await shell.locator('[data-workspace-back]').click();
  await expect(overview).toBeVisible();
  await entry('payments').click();
  const form = shell.locator('[data-platform-payment-search-form]');
  await form.locator('[data-platform-payment-query]').fill('不存在的订单');
  await form.locator('[data-platform-payment-query]').press('Enter');
  await expect(shell.locator('[data-platform-payment-tab="orders"] strong')).toHaveText('0');
  await shell.locator('[data-workspace-back]').click();
  await expect(entry('payments').locator('.pc-home-settings-value')).toHaveText('5 笔订单');
});
