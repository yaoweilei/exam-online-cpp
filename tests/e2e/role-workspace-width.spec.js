const { test, expect } = require('@playwright/test');
const { loginWithPassword, stubNoisyPersonalCenterApis } = require('./helpers/session');
const { navigateWorkspace, workspaceDestinations } = require('./helpers/workspace-navigation');

test('all role workspace pages fit the shared paper at desktop and narrow widths', async ({ page }, info) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithPassword(page, 'superadmin_demo');
  await stubNoisyPersonalCenterApis(page);
  await page.evaluate(() => window.openPersonalCenter());

  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();
  let checkedPages = 0;
  const requiredDestinations = {
    superAdmin: ['overview', 'users', 'organizations', 'content', 'feedback', 'payments', 'flags'],
    teacher: ['openRoleContent:teacher-students', 'openRoleContent:teacher-groups', 'openRoleContent:teacher-review', 'openRoleContent:teacher-prep'],
    assistant: ['openRoleContent:assistant-followup', 'openRoleContent:teacher-schedule', 'openRoleContent:assistant-package'],
    orgAdmin: ['openRoleContent:org-members', 'openRoleContent:org-permissions', 'openRoleContent:org-course-packages', 'openRoleContent:org-dashboard'],
    contentAdmin: ['openRoleContent:content-feedback', 'openRoleContent:content-publish', 'openAuditLog'],
    student: ['openReviewWorkbench', 'openAssignments', 'openChapterPath']
  };
  for (const role of ['superAdmin', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin', 'student']) {
    if (await shell.getAttribute('data-learning-role') !== role) {
      await shell.locator('[data-platform-admin-account-menu]').click();
      await shell.locator(`[data-role-workbench="${role}"]`).click();
    }
    await expect(shell).toHaveAttribute('data-learning-role', role);
    await page.waitForLoadState('networkidle');
    for (const width of [1440, 2682, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const frame = await shell.evaluate((element, currentRole) => {
        const menu = document.querySelector(currentRole === 'student' ? '#ls-menu' : '#pc-platform-sidebar');
        const main = element.querySelector('.pc-platform-workspace').getBoundingClientRect();
        const header = element.querySelector('.pc-platform-topbar').getBoundingClientRect();
        return { x: main.x, width: main.width, header: header.height, menuVisible: menu.checkVisibility() };
      }, role);
      const menuWidth = width >= 1100 ? 240 : 0;
      const inset = Math.max(0, (width - menuWidth - 994) / 2);
      expect(frame.x, `${role} / ${width}px main position`).toBeCloseTo(inset + menuWidth, 0);
      expect(frame.width, `${role} / ${width}px main width`).toBeCloseTo(width - menuWidth - 2 * inset, 0);
      expect(frame.header, `${role} header`).toBe(44);
      expect(frame.menuVisible).toBe(width >= 1100);
      if (width < 1100) {
        await shell.locator('[data-platform-admin-nav-trigger]').click();
        const menu = page.locator(role === 'student' ? '#ls-menu' : '#pc-platform-sidebar');
        await expect(menu).toBeVisible();
        expect((await menu.boundingBox()).y).toBe(44);
        await expect(menu.getByRole('button', { name: '显示主题', exact: true })).toBeVisible();
        await shell.locator('[data-platform-admin-nav-trigger]').click();
        await expect(menu).toBeHidden();
      }
      await page.screenshot({ path: info.outputPath(`${role}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const theme = page.locator('.ls-theme-control');
    await theme.getByRole('button', { name: '显示主题', exact: true }).click();
    await theme.locator('[data-theme-mode="dark"]').click();
    await expect(page.locator('body')).not.toHaveClass(/light-theme/);
    if (role !== 'student' && await shell.locator('.pc-topbar-back').count()) {
      await expect.poll(() => shell.evaluate(element => {
        const back = getComputedStyle(element.querySelector('.pc-topbar-back'));
        const header = getComputedStyle(element.querySelector('.pc-platform-topbar'));
        return back.backgroundColor === header.backgroundColor && back.color === getComputedStyle(element).color;
      })).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`${role}-dark.png`) });
    await theme.getByRole('button', { name: '显示主题', exact: true }).click();
    await theme.locator('[data-theme-mode="light"]').click();
    if (role !== 'student') {
      await shell.locator('[data-platform-admin-nav-trigger]').click();
      await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
      if (await shell.locator('.pc-topbar-back').count()) {
        const menu = await shell.locator('[data-platform-admin-nav-trigger]').boundingBox();
        const back = await shell.locator('.pc-topbar-back').boundingBox();
        expect(back.x).toBeGreaterThanOrEqual(menu.x + menu.width);
      }
      await shell.locator('[data-platform-admin-nav-trigger]').click();
      await expect(shell.locator('.pc-platform-sidebar')).toBeVisible();
    }
    const pages = await workspaceDestinations(shell, role === 'superAdmin');
    // Consolidated menus have fewer entries; check required modules rather than a historical total.
    expect(pages.map(page => page.key), `${role} required destinations`).toEqual(expect.arrayContaining(requiredDestinations[role]));
    expect(new Set(pages.map(page => page.key)).size, `${role} duplicate destinations`).toBe(pages.length);

    for (const destination of pages) {
      await navigateWorkspace(shell, destination.key, role === 'superAdmin');
      for (const width of [1440, 500]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await shell.locator('.pc-platform-admin-content').evaluate(content => ({
          overflow: content.scrollWidth - content.clientWidth,
          childWidths: [...content.children].map(child => child.getBoundingClientRect().width),
          organizationRows: (() => {
            const toolbar = content.querySelector('.pc-organization-workspace-toolbar');
            return toolbar?.checkVisibility() ? toolbar.querySelector('label').getBoundingClientRect().top - toolbar.querySelector('form').getBoundingClientRect().top : null;
          })()
        }));
        expect(layout.overflow, `${role} / ${destination.name} / ${width}px`).toBeLessThanOrEqual(1);
        expect(layout.childWidths.every(childWidth => childWidth <= 754 + 1), `${role} / ${destination.name} / ${width}px`).toBeTruthy();
        if (layout.organizationRows !== null) expect(layout.organizationRows, `${role} / ${destination.name} / ${width}px`).toBeGreaterThan(0);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      checkedPages += 1;
    }
  }
  await info.attach('checked-pages', { body: String(checkedPages), contentType: 'text/plain' });
});
