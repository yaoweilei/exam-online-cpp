const { test, expect } = require('@playwright/test');

async function enterPaper(page) {
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-target="JLPT N3"]').click();
  await home.locator('[data-gw="browse"]:visible').last().click();
  await home.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(home).toBeHidden();
}

test('主题入口位于图标栏底部，选择后保存且不占用练习设置', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const trigger = page.locator('.ls-theme-trigger');
  const themeMenu = page.locator('#ls-theme-menu');
  await expect(trigger).toBeVisible();
  const themeBox = await trigger.boundingBox();
  const collapseBox = await page.locator('.ls-collapse').boundingBox();
  expect(themeBox.y + themeBox.height).toBeLessThanOrEqual(collapseBox.y);
  await expect(page.locator('.ls-settings #theme-mode-select')).toHaveCount(0);
  await trigger.click();
  await themeMenu.locator('[data-theme-mode="dark"]').click();
  await expect(page.locator('body')).not.toHaveClass(/light-theme/);
  await page.reload();
  await trigger.click();
  await expect(themeMenu.locator('[data-theme-mode="dark"]')).toHaveAttribute('aria-checked', 'true');
  await themeMenu.locator('[data-theme-mode="light"]').click();
  await expect(page.locator('body')).toHaveClass(/light-theme/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ls-mobile-toggle').click();
  await trigger.click();
  await expect(themeMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(themeMenu).toBeHidden();
  await expect(page.locator('.ls-menu')).toBeVisible();
});

test('左侧试卷导航复用题型与学习辅助，窄屏可打开菜单', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  await expect(page.locator('.ls-menu [data-ls-guest-action="jlpt"]')).toBeHidden();
  await expect(page.locator('.ls-selected-summary[data-family="jlpt"]')).toContainText('JLPT N3');
  await expect(page.locator('.ls-guest-paper-tools > summary')).toHaveCount(0);
  await expect(page.locator('#ls-current-paper')).toBeVisible();
  await expect(page.locator('#ls-current-paper')).toContainText('JLPT N3');
  await expect(page.locator('.ls-paper-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#ls-paper-fields select').first()).toBeHidden();
  await expect(page.locator('.ls-paper-picker')).toBeHidden();
  await expect(page.locator('#exam-command-bar')).toBeHidden();
  await expect(page.locator('#exam-settings-toggle')).toBeHidden();
  await expect(page.locator('#learning-account #user-menu-trigger')).toBeVisible();
  const desktopAccount = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(desktopAccount.width).toBe(28);
  expect(desktopAccount.y).toBe(10);
  expect(1600 - desktopAccount.x - desktopAccount.width).toBe(10);
  const desktopHome = await page.locator('.ls-guest-rail [data-ls-guest-action="home"]').boundingBox();
  expect(desktopAccount.y + desktopAccount.height / 2).toBe(desktopHome.y + desktopHome.height / 2);
  await expect(page.locator('.ls-category-heading')).toBeHidden();
  await expect(page.locator('#ls-exam-controls')).toBeHidden();
  await expect(page.locator('#practice-scrubber')).toBeVisible();
  await page.locator('.ls-settings summary').click();
  await expect(page.locator('.ls-paper-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#exam-mode-select')).toBeVisible();
  await expect(page.locator('#learning-menu-zh')).toBeVisible();
  const checked = await page.locator('#learning-menu-zh').getAttribute('aria-checked');
  await page.locator('#learning-menu-zh').click();
  await expect(page.locator('#learning-menu-zh')).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAccount = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(mobileAccount.width).toBe(24);
  expect(mobileAccount.y).toBe(6);
  expect(390 - mobileAccount.x - mobileAccount.width).toBe(6);
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('#practice-scrubber')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(page.locator('#practice-scrubber')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('学员工作台在同一框架中切换，返回练习保留试卷', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  const question = await page.locator('.question-text').innerText();
  // Isolate shell navigation from authentication and student account fixtures.
  await page.evaluate(() => {
    window.setUserContext({ id: 'shell-student', username: '学员', guest: false, roles: ['student'] });
    // This fixture bypasses AppStore's login flow; mirror its navigation state.
    document.body.classList.remove('ls-guest-navigation');
  });
  await page.locator('[data-ls-group="study"]').click();
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ls-group="study"]')).toHaveCSS('background-color', 'rgb(226, 228, 231)');
  await expect(page.locator('#platform-admin-shell')).toHaveAttribute('data-learning-role', 'student');
  await expect(page.locator('#platform-admin-shell .pc-platform-sidebar')).toBeHidden();
  await expect(page.locator('#platform-admin-shell .pc-workbench-step').first()).toBeVisible();
  await page.locator('[data-ls-intent="openAssignments"]').click();
  await expect(page.locator('[data-ls-intent="openAssignments"]')).toHaveClass(/is-active/);
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('[data-ls-group="practice"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ls-group="study"]')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await expect(page.locator('.question-text')).toHaveText(question);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
});
