const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');
const fs = require('node:fs');
const path = require('node:path');

const images = path.resolve(__dirname, '../../artifacts/plan-compact-20261103');
fs.mkdirSync(images, { recursive: true });

test('套餐选择只用单层选中边框，鼠标与键盘均能切换真实报价', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_plan_ui'));
  await page.evaluate(() => window.openPersonalCenter());
  await page.waitForLoadState('networkidle');
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-role-account-page=student-account-plan]').click();

  const cards = page.locator('.pc-recharge-duration-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('[data-account-recharge-panel]')).not.toContainText('ULTRA');
  for (const width of [360, 390, 540, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width <= 540 ? 780 : 900 });
    for (let i = 0; i < 3; i++) {
      await cards.nth(i).click();
      await expect(page.locator('[data-recharge-days]:checked')).toHaveCount(1);
      await expect(cards.nth(i).locator('input')).toBeChecked();
      const style = await cards.nth(i).evaluate(element => ({
        outline: getComputedStyle(element).outlineStyle,
        shadow: getComputedStyle(element).boxShadow
      }));
      expect(style).toEqual({ outline: 'none', shadow: 'none' });
      await expect(page.locator('[data-recharge-submit]')).toContainText(['12.9', '29.9', '99.9'][i]);
    }
    expect(await page.locator('#platform-admin-shell main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    if (width <= 540) {
      expect(await page.locator('#platform-admin-shell main').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      await expect(page.locator('[data-recharge-provider]')).toHaveCSS('height', '44px');
      expect(await page.locator('[data-recharge-submit]').evaluate(button => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.mouse.move(0, 0);
    await expect(cards.nth(1)).toHaveCSS('border-top-color', 'rgba(31, 25, 20, 0.12)');
    if ([360, 540, 768].includes(width)) {
      await page.screenshot({ path: path.join(images, `selection-${width}.png`) });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await cards.first().locator('input').focus();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(1).locator('input')).toBeChecked();
  await expect(cards.nth(1)).toHaveCSS('outline-style', 'solid');
});

test('隐藏个人及机构ULTRA价格展示，保存PRO配置仍保留原ULTRA数据', async ({ page }) => {
  await loginWithPassword(page, 'superadmin_demo');
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== 'superAdmin') {
    await page.locator('[data-platform-admin-account-menu]').click();
    await page.locator('.pc-role-identity-menu>summary').click();
    await page.locator('[data-role-workbench=superAdmin]').click();
  }
  await expect(shell).toHaveAttribute('data-learning-role', 'superAdmin');
  await page.waitForLoadState('networkidle');
  await shell.locator('.pc-home-settings-row[data-platform-admin-page=pricing]').click();
  await page.waitForLoadState('networkidle');
  const before = (await (await page.request.get('/api/v1/payments/pricing')).json()).data;
  await expect(shell.locator('[data-pricing-plan-panel=personal]')).not.toContainText('ULTRA');
  await shell.getByRole('tab', { name: '学校 / 教育机构', exact: true }).click();
  const organizationPanels = shell.locator('[data-pricing-plan-panel=organization]:visible');
  await expect(organizationPanels).toHaveCount(2);
  for (const panel of await organizationPanels.all()) await expect(panel).not.toContainText('ULTRA');

  // Inspect the actual submitted form without changing shared pricing data.
  let saved;
  await page.route('**/api/v1/admin/payments/pricing', async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { code: 'OK', data: before } });
  });
  await shell.getByRole('button', { name: '保存更改', exact: true }).click();
  await page.locator('[data-pc-confirm-ok]').click();
  await expect.poll(() => !!saved).toBe(true);
  for (const scope of ['personal', 'organization']) {
    expect(saved.catalogs[scope].prices_cents.cny.ultra).toEqual(before.catalogs[scope].prices_cents.cny.ultra);
    expect(saved.catalogs[scope].plans.ultra).toEqual(before.catalogs[scope].plans.ultra);
  }
  expect(saved.catalogs.organization.seat_tiers.map(tier => tier.prices_cents.cny.ultra))
    .toEqual(before.catalogs.organization.seat_tiers.map(tier => tier.prices_cents.cny.ultra));
});
