const { test, expect } = require('@playwright/test');
const { clearBrowserSession, loginWithPassword } = require('./helpers/session');

const roles = [
  {
    loginId: 'student_demo',
    actions: ['今日学习', '我的作业', '专项练习', '复习资料', '学习报告'],
	modalActions: new Set(['今日学习', '专项练习', '学习报告'])
  },
  { loginId: 'teacher_demo', actions: ['我的学生', '学习组', '课程表', '安排课程', '待批改', '布置作业', '成绩册', '备课'] },
  { loginId: 'assistant_demo', actions: ['催交作业', '学员跟进', '续费风险', '异常提醒', '学习组', '课程表', '课程包', '安排课程'] },
  { loginId: 'orgadmin_demo', actions: ['成员管理', '权限管理', '套餐与账单', '机构设置', '学习组', '课程包', '课时管理', '机构看板', '审计日志'] },
  { loginId: 'contentadmin_demo', actions: ['内容反馈', '发布工作流', '内容日志'] },
  { loginId: 'superadmin_demo', actions: ['用户管理', '角色权限', '机构管理', '内容工作流', '反馈处理', '订单与支付', '价格与套餐', '功能开关', '审计日志'] }
];

const viewports = [
  { name: '手机', width: 390, height: 844 },
  { name: '窄桌面', width: 842, height: 900 },
  { name: '桌面', width: 1440, height: 1100 }
];

async function openWorkspace(page, loginId) {
  await loginWithPassword(page, loginId);
  await page.evaluate(() => window.openPersonalCenter?.());
  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible({ timeout: 20000 });
  return shell;
}

async function expectWorkspaceLayout(shell, label) {
  await expect(shell.locator('.pc-platform-admin-content .pc-admin-note:visible').filter({ hasText: /^(正在读取|正在加载|加载中)/ })).toHaveCount(0, { timeout: 30000 });
  const issues = await shell.evaluate((workspace) => {
    const content = workspace.querySelector('.pc-platform-admin-content');
    const workspaceBox = workspace.getBoundingClientRect();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return element.checkVisibility() && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 &&
        box.right > workspaceBox.left && box.left < workspaceBox.right && box.bottom > workspaceBox.top && box.top < workspaceBox.bottom;
    };
    const problems = [];
    if (workspaceBox.left < -1 || workspaceBox.top < -1 || workspaceBox.right > window.innerWidth + 1 || workspaceBox.bottom > window.innerHeight + 1) {
      problems.push(`工作台越过视口 ${Math.round(workspaceBox.left)},${Math.round(workspaceBox.top)},${Math.round(workspaceBox.right)},${Math.round(workspaceBox.bottom)}`);
    }
    if (workspace.scrollWidth > workspace.clientWidth + 1) problems.push(`工作台横向溢出 ${workspace.scrollWidth}/${workspace.clientWidth}`);
    if (content && content.scrollWidth > content.clientWidth + 1) problems.push(`内容横向溢出 ${content.scrollWidth}/${content.clientWidth}`);
    for (const control of Array.from(workspace.querySelectorAll('button,input,select,textarea')).filter(visible)) {
      const box = control.getBoundingClientRect();
      let scrollContainer = control.parentElement;
      while (scrollContainer && scrollContainer !== workspace && !(['auto', 'scroll'].includes(getComputedStyle(scrollContainer).overflowX) && scrollContainer.scrollWidth > scrollContainer.clientWidth)) scrollContainer = scrollContainer.parentElement;
      const insideScrollableNavigation = scrollContainer && scrollContainer !== workspace;
      if (!insideScrollableNavigation && (box.left < workspaceBox.left - 1 || box.right > workspaceBox.right + 1)) problems.push(`控件越界 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName}`);
      const target = control.matches('input[type="checkbox"],input[type="radio"]') ? control.closest('label') || control : control;
      const targetBox = target.getBoundingClientRect();
      if (targetBox.width < 24 || targetBox.height < 24) problems.push(`控件过小 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName} ${Math.round(targetBox.width)}x${Math.round(targetBox.height)}`);
    }
    for (const node of Array.from(workspace.querySelectorAll('h1,h2,h3,.pc-lite-row strong,.pc-role-content-title')).filter(visible)) {
      const text = node.textContent?.trim() || '';
      if (text.length < 3) continue;
      const box = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
      if (box.width < 40 && box.height > lineHeight * 2.4) problems.push(`文字疑似逐字竖排 ${text.slice(0, 30)}`);
    }
    return problems.slice(0, 30);
  });
  expect(issues, label).toEqual([]);
}

for (const viewport of viewports) {
  for (const role of roles) {
    test(`${viewport.name} ${role.loginId} 的全部工作台入口布局有效`, async ({ page }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const shell = await openWorkspace(page, role.loginId);
      await expectWorkspaceLayout(shell, `${role.loginId} / 总览`);

      for (const title of role.actions) {
        const action = shell.getByRole('button', { name: title, exact: true });
        await expect(action).toBeVisible();
        if (role.modalActions?.has(title)) continue;
        await action.click();
        await expect(shell.locator('.pc-platform-topbar')).toContainText(title);
        await expectWorkspaceLayout(shell, `${role.loginId} / ${title}`);
      }

      await shell.locator('[data-platform-admin-close]').click();
      await clearBrowserSession(page);
    });
  }
}

for (const viewport of viewports) {
  test(`${viewport.name} 学员账户子页布局有效`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const shell = await openWorkspace(page, 'student_demo');
    for (const title of ['套餐与订单', '优惠与邀请', '帮助与反馈']) {
      await shell.locator('[data-platform-admin-account-menu]').click();
      await shell.getByRole('menuitem', { name: title, exact: true }).click();
      await expect(shell.locator('.pc-platform-topbar')).toContainText(title);
      await expectWorkspaceLayout(shell, `student_demo / ${title}`);
    }
  });
}

test('帮助与反馈详情支持逐级返回', async ({ page }) => {
  const shell = await openWorkspace(page, 'student_demo');
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.getByRole('menuitem', { name: '帮助与反馈', exact: true }).click();

  await shell.locator('.pc-lite-row').filter({ hasText: '用户协议' }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('用户协议');
  await expect(shell.getByRole('button', { name: '返回帮助与反馈', exact: true })).toBeVisible();
  await shell.getByRole('button', { name: '返回帮助与反馈', exact: true }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('帮助与反馈');

  await shell.locator('.pc-lite-row').filter({ hasText: '客服' }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('客服');
  await shell.locator('.pc-lite-row').filter({ hasText: '在线客服' }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('问题反馈');
  await expect(shell.getByRole('button', { name: '返回客服', exact: true })).toBeVisible();
  await shell.getByRole('button', { name: '返回客服', exact: true }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('客服');
  await shell.getByRole('button', { name: '返回帮助与反馈', exact: true }).click();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('帮助与反馈');
});

test('用户管理页按桌面、平板和手机宽度分级收缩', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const shell = await openWorkspace(page, 'superadmin_demo');
  await shell.getByRole('button', { name: '用户管理', exact: true }).click();
  await expect(shell.locator('[data-platform-user-search-form]')).toBeVisible({ timeout: 20000 });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectWorkspaceLayout(shell, `用户管理 / ${viewport.width}`);
  }
});

test('低高度工作台的左侧导航提供可见纵向滚动区域', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 520 });
  const shell = await openWorkspace(page, 'student_demo');
  const nav = shell.locator('.pc-platform-sidebar nav');
  const footer = shell.locator('.pc-platform-sidebar-footer');
  await expect(footer).toBeVisible();
  const before = await nav.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth
  }));
  expect(before.scrollHeight).toBeGreaterThanOrEqual(before.clientHeight);
  if (before.scrollHeight > before.clientHeight) {
    expect(before.scrollbarWidth).toBe('thin');
    await nav.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await expect(shell.getByRole('button', { name: '帮助与反馈', exact: true })).toBeInViewport();
});

test('机构客户的套餐权益只读，并通过报价支付表单购买', async ({ page }) => {
  const shell = await openWorkspace(page, 'orgadmin_demo');
  await shell.getByRole('button', { name: '套餐与账单', exact: true }).click();
  const organizationCard = shell.locator('.pc-managed-org-card').first();
  await expect(organizationCard).toBeVisible({ timeout: 20000 });
  if (!(await organizationCard.getAttribute('open'))) await organizationCard.locator('summary').first().click();
  const purchase = shell.locator('[data-org-billing-purchase]').first();
  await expect(purchase).toBeVisible({ timeout: 20000 });
  await expect(shell.locator('form[data-org-subscription-form]')).toHaveCount(0);
  await expect(shell.locator('.pc-org-billing-summary')).toContainText('当前套餐');
  await expect(shell.locator('.pc-org-billing-summary')).toContainText('付费内容席位');
  await purchase.locator(':scope > summary').click();
  const form = purchase.locator('form[data-org-self-service-order-form]');
  await expect(form).toBeVisible();
  await expect(form.locator('[data-org-payment-plan]')).toHaveValue('pro');
  await expect(form.locator('[data-org-payment-seats]')).toBeEditable();
  await form.getByLabel('计费周期：年付 · 365 天（推荐）').click();
  await form.getByRole('option', { name: '季付 · 90 天', exact: true }).click();
  await expect(form.locator('[data-org-payment-days]')).toHaveValue('90');
  await form.getByLabel('支付方式：微信支付').click();
  await form.getByRole('option', { name: '支付宝', exact: true }).click();
  await expect(form.locator('[data-org-payment-provider]')).toHaveValue('alipay');
  await expect(form.getByRole('button', { name: '确认报价并支付' })).toBeVisible();
});
