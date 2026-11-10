const { test, expect } = require('@playwright/test');
const { loginWithPassword } = require('./helpers/session');

async function measure(page, sidebar) {
  return page.evaluate(selector => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const shell = document.querySelector('#platform-admin-shell');
    const content = shell.querySelector('.pc-platform-admin-content');
    return {
      sidebar: rect(document.querySelector(selector)),
      workspace: rect(shell.querySelector('.pc-platform-workspace')),
      header: rect(shell.querySelector('.pc-platform-topbar')),
      heading: rect(content.querySelector('h1')),
      body: rect(content.lastElementChild),
      overflow: content.scrollWidth - content.clientWidth
    };
  }, sidebar);
}

test('教师与学员共用居中布局，窄屏使用抽屉导航', async ({ page }, info) => {
  test.setTimeout(120000);
  await loginWithPassword(page, 'superadmin_demo');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  async function role(name) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator(`[data-role-workbench="${name}"]`).click();
    await expect(shell).toHaveAttribute('data-learning-role', name);
    await page.waitForLoadState('networkidle');
    await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('正在读取学习组和排课数据');
  }
  const layouts = {};
  for (const width of [1440, 2682]) {
    await page.setViewportSize({ width, height: 900 });
    await role('student');
    layouts[width] = { student: await measure(page, '#ls-menu') };
    await page.screenshot({ path: info.outputPath(`student-${width}.png`) });
    await role('teacher');
    await shell.locator('.pc-platform-sidebar [data-role-admin-intent="openRoleContent:teacher-students"]').evaluate(b => b.click());
    await page.waitForLoadState('networkidle');
    await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('正在读取学习组和排课数据');
    layouts[width].teacher = await measure(page, '#pc-platform-sidebar');
    await page.screenshot({ path: info.outputPath(`teacher-${width}.png`) });
  }
  await info.attach('layout', { body: JSON.stringify(layouts, null, 2), contentType: 'application/json' });
  for (const { student, teacher } of Object.values(layouts)) {
    for (const key of ['x', 'width']) {
      expect(teacher.sidebar[key]).toBeCloseTo(student.sidebar[key], 0);
      expect(teacher.workspace[key]).toBeCloseTo(student.workspace[key], 0);
      expect(teacher.body[key]).toBeCloseTo(student.body[key], 0);
    }
    expect(teacher.header.height).toBe(student.header.height);
    expect(teacher.heading.y).toBeLessThan(85);
    expect(teacher.overflow).toBeLessThanOrEqual(1);
  }
  await shell.locator('[data-platform-admin-nav-trigger]').click();
  await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
  const menu = await shell.locator('[data-platform-admin-nav-trigger]').boundingBox();
  const back = await shell.locator('.pc-topbar-back').boundingBox();
  expect(back.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  await shell.locator('[data-platform-admin-nav-trigger]').click();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
    await shell.locator('[data-platform-admin-nav-trigger]').click();
    await expect(shell.locator('.pc-platform-sidebar')).toBeVisible();
    expect((await measure(page, '#pc-platform-sidebar')).sidebar.y).toBe(44);
    await expect(shell.locator('.pc-platform-sidebar [aria-label="总览"] span')).toBeVisible();
    await expect(shell.getByRole('button', { name: '显示主题', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`teacher-drawer-${width}.png`) });
    const overview = shell.locator('.pc-platform-sidebar [data-role-admin-intent="__overview__"]');
    await overview.click();
    await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
    expect((await measure(page, '#pc-platform-sidebar')).overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`teacher-${width}.png`) });
  }
});
