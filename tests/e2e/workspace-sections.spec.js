const { test, expect } = require('@playwright/test');
const { loginApi } = require('./helpers/session');
const { navigateWorkspace, workspaceDestinations } = require('./helpers/workspace-navigation');

async function workspace(page) {
  await loginApi(page.request, 'superadmin_sections');
  const ctx = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), { ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, permissions: ctx.permissions, subscription: ctx.subscription });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe('superadmin_sections');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  return page.locator('#platform-admin-shell');
}

async function role(shell, id) {
  if (await shell.getAttribute('data-learning-role') !== id) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('.pc-role-identity-menu > summary').click();
    await shell.locator(`[data-role-workbench="${id}"]`).click();
  }
  await expect(shell).toHaveAttribute('data-learning-role', id);
  await navigateWorkspace(shell, '__overview__', false);
}

test('平台管理功能在侧栏直接进入独立页面', async ({ page }) => {
  const shell = await workspace(page);
  await expect(shell).toHaveAttribute('data-learning-role', 'superAdmin');
  const sidebar = shell.locator('.pc-platform-sidebar');
  const main = shell.locator('main');
  const pages = [
    ['users', '用户管理'],
    ['roles', '角色权限'],
    ['access', '临时授权'],
    ['organizations', '机构管理'],
    ['content', '内容工作流'],
    ['feedback', '反馈处理'],
    ['payments', '订单与支付'],
    ['pricing', '价格与套餐'],
    ['flags', '功能开关'],
    ['audit', '审计日志']
  ];
  expect(await workspaceDestinations(shell, true)).toEqual([
    { key: 'overview', name: '总览' }, ...pages.map(([key, name]) => ({ key, name }))
  ]);
  for (const [key, title] of pages) {
    await sidebar.getByRole('button', { name: title, exact: true }).press('Enter');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(main.locator('.pc-workspace-section-tabs')).toHaveCount(0);
    await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute('data-platform-admin-page', key);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateWorkspace(shell, 'users', true);
  await expect(sidebar).toBeHidden();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('用户管理');
  await shell.locator('.pc-platform-topbar [data-workspace-back]').click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('审计日志');
  await shell.locator('.pc-platform-topbar [data-workspace-home]').click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('平台总览');
});

test('教师和其他职员的跨功能入口都独立，窄屏菜单可直达', async ({ page }, info) => {
  const shell = await workspace(page);
  const expected = {
    teacher: ['总览', '我的学生', '学习组', '成绩册', '课程表', '作业', '备课'],
    assistant: ['总览', '学员跟进', '学习组', '课程表', '课程与课时'],
    orgAdmin: ['总览', '成员管理', '权限管理', '课程包', '课时管理', '学习组', '课程表', '机构看板', '套餐与账单', '机构设置', '审计日志'],
    contentAdmin: ['总览', '内容反馈', '发布工作流', '内容日志']
  };
  const main = shell.locator('main');
  for (const [id, labels] of Object.entries(expected)) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await role(shell, id);
    const sidebar = shell.locator('.pc-platform-sidebar');
    await expect(sidebar.locator('[data-workspace-section]')).toHaveText(labels);
    await expect(main.locator('.pc-workspace-section-tabs')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    if (id === 'teacher') {
      await shell.locator('[data-platform-admin-nav-trigger]').click();
      await expect(sidebar.getByRole('button', { name: '学习组', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('teacher-menu-mobile.png') });
    }
    const pages = (await workspaceDestinations(shell)).filter(({ key }) => key !== '__overview__');
    for (const { key, name } of pages) {
      await navigateWorkspace(shell, key);
      await expect(sidebar).toBeHidden();
      await expect(sidebar.locator('[aria-current="page"]')).toHaveAttribute('data-role-admin-intent', key);
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(main.locator('.pc-workspace-section-tabs, .pc-teaching-links')).toHaveCount(0);
      expect(await main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (id === 'teacher' && name === '学习组') {
        await expect(main.getByText('正在读取学习组和排课数据...', { exact: true })).toBeHidden();
        await page.screenshot({ path: info.outputPath('teacher-groups-mobile.png') });
      }
    }
    await shell.locator('[data-global-messages]').click();
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('消息中心');
    await expect(main.locator('.pc-workspace-section-tabs')).toHaveCount(0);
  }
});
