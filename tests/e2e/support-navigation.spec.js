const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../../artifacts/support-back-20261102');
fs.mkdirSync(output, { recursive: true });

async function help(page, practice = false) {
  if (practice) {
    await page.evaluate(() => window.closeLearningWorkspace());
    await page.locator('#user-menu-trigger').click();
  } else {
    await page.evaluate(() => window.openPersonalCenter());
    await page.waitForLoadState('networkidle');
    await page.locator('[data-platform-admin-account-menu]').click();
  }
  await page.locator('[data-account-destination=student-account-feedback]').click();
  await expect(page.locator('[aria-label="帮助入口"]')).toBeVisible();
}

const feedbackLink = '[data-intent="openRoleContent:support-feedback"]';
test('帮助子页在手机平板桌面均可原路返回，反馈草稿再次进入不丢失', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_support_back'));
  await help(page);
  const shell = page.locator('#platform-admin-shell');
  const form = shell.locator('[data-support-feedback-form]');
  const back = shell.locator('[data-workspace-back]');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const destination of ['support-feedback', 'support-customer-service', 'support-user-agreement', 'support-privacy-policy']) {
      await shell.locator(`[data-intent="openRoleContent:${destination}"]`).click();
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute('aria-label', '返回帮助与反馈');
      const box = await back.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (destination === 'support-feedback') {
        await form.locator('[data-support-feedback-category]').selectOption('answer');
        await form.locator('[data-support-feedback-paper-id]').fill('JLPT_N2_2024_12');
        await form.locator('[data-support-feedback-question-id]').fill('42');
        await form.locator('[data-support-feedback-description]').fill('返回后保留这一段未提交的反馈 <草稿>');
        await page.screenshot({ path: path.join(output, `feedback-${width}.png`) });
      }
      await back.click();
      await expect(shell.locator('[aria-label="帮助入口"]')).toBeVisible();
    }
    await shell.locator(feedbackLink).click();
    await expect(form.locator('[data-support-feedback-category]')).toHaveValue('answer');
    await expect(form.locator('[data-support-feedback-paper-id]')).toHaveValue('JLPT_N2_2024_12');
    await expect(form.locator('[data-support-feedback-question-id]')).toHaveValue('42');
    await expect(form.locator('[data-support-feedback-description]')).toHaveValue('返回后保留这一段未提交的反馈 <草稿>');
    await back.click();
  }
  // A second-level support link returns to its immediate parent.
  await shell.locator('[data-intent="openRoleContent:support-customer-service"]').click();
  await shell.locator('[data-intent="openRoleContent:support-account-payment"]').click();
  await expect(back).toHaveAttribute('aria-label', '返回客服');
  await back.click();
  await expect(shell.getByRole('heading', { name: '客服', exact: true })).toBeVisible();
  await back.click();
  await expect(shell.locator('[aria-label="帮助入口"]')).toBeVisible();
});

test('从学习页进入问题反馈，先返回帮助页再返回学习页', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_support_practice'));
  await page.setViewportSize({ width: 390, height: 844 });
  await help(page, true);
  const shell = page.locator('#platform-admin-shell');
  await shell.locator(feedbackLink).click();
  await expect(shell.locator('[data-workspace-back]')).toHaveAttribute('aria-label', '返回帮助与反馈');
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('[aria-label="帮助入口"]')).toBeVisible();
  await shell.locator('[data-workspace-back]').click();
  await expect(shell).not.toHaveClass(/pc-platform-admin-open/);
  await expect(page.locator('#user-menu-trigger')).toBeVisible();
});
