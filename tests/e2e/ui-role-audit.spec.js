const { test, expect } = require('@playwright/test');
const { clearBrowserSession, loginWithPassword } = require('./helpers/session');

const roles = [
  {
    loginId: 'student_demo',
    actions: ['今日复习', '我的作业', '错题本', '学习报告', '最近学习', '收藏题', '生词本', '每日一练', '备考目标', '推荐复习', '章节学习', '社区讨论'],
    modalActions: new Set(['今日复习', '错题本', '学习报告', '生词本', '每日一练', '备考目标', '推荐复习', '章节学习', '社区讨论'])
  },
  { loginId: 'teacher_demo', actions: ['我的学生', '学习组', '课程表', '安排课程', '待批改', '布置作业', '成绩册', '备课'] },
  { loginId: 'assistant_demo', actions: ['催交作业', '学员跟进', '续费风险', '异常提醒', '学习组', '课程表', '课程包', '安排课程'] },
  { loginId: 'orgadmin_demo', actions: ['成员管理', '权限管理', '机构设置', '学习组', '课程包', '机构看板'] },
  { loginId: 'contentadmin_demo', actions: ['内容反馈', '发布工作流', '内容日志'] },
  { loginId: 'superadmin_demo', actions: ['用户管理', '角色权限', '机构管理', '内容工作流', '反馈处理', '订单与退款', '功能开关', '审计日志'] }
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
  const issues = await shell.evaluate((workspace) => {
    const content = workspace.querySelector('.pc-platform-admin-content');
    const workspaceBox = workspace.getBoundingClientRect();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 &&
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
      const insideScrollableNavigation = Boolean(control.closest('.pc-platform-sidebar nav'));
      if (!insideScrollableNavigation && (box.left < workspaceBox.left - 1 || box.right > workspaceBox.right + 1)) problems.push(`控件越界 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName}`);
      if (box.width < 24 || box.height < 24) problems.push(`控件过小 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName} ${Math.round(box.width)}x${Math.round(box.height)}`);
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
    for (const title of ['套餐与订单', '卡券', '帮助与反馈']) {
      await shell.locator('[data-platform-admin-account-menu]').click();
      await shell.getByRole('menuitem', { name: title, exact: true }).click();
      await expect(shell.locator('.pc-platform-topbar')).toContainText(title);
      await expectWorkspaceLayout(shell, `student_demo / ${title}`);
    }
  });
}

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
