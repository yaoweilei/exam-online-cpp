const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../../artifacts/benefits-flat-20261102');
fs.mkdirSync(output, { recursive: true });

test('优惠与邀请平铺展示，金额箭头右侧对齐且兑换后更新积分和记录', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_flat_benefits'));
  await page.evaluate(() => window.openPersonalCenter());
  await page.waitForLoadState('networkidle');
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-account-destination=student-account-coupons]').click();
  const root = page.locator('.pc-benefits-page');
  await expect(root.locator(':scope > .pc-card')).toHaveCount(4);
  await expect(root.locator('.pc-card .pc-card')).toHaveCount(0);
  await expect(root).not.toContainText('我的优惠');
  const sections = root.locator('[data-inline-benefit-section]');
  for (const section of await sections.all()) await expect(section).not.toHaveAttribute('open', '');
  const redeem = root.locator('[data-inline-benefit-section=redeem]');
  const records = root.locator('[data-inline-benefit-section=records]');
  for (const width of [360, 540, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await root.evaluate(element => ({
      overflow: element.scrollWidth - element.clientWidth,
      border: getComputedStyle(element).borderTopWidth,
      referralBorder: getComputedStyle(element.querySelector('.pc-referral-line')).borderLeftWidth,
      arrows: [...element.querySelectorAll('summary .pc-inline-chevron')].map(arrow => { const box = arrow.getBoundingClientRect(); return box.x + box.width / 2; })
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.border).toBe('0px');
    expect(layout.referralBorder).toBe('0px');
    expect(Math.max(...layout.arrows) - Math.min(...layout.arrows)).toBeLessThanOrEqual(1);
    if ([360, 540, 768].includes(width)) await page.screenshot({ path: path.join(output, `collapsed-${width}.png`) });
    for (const section of await sections.all()) await section.locator('summary').click();
    await expect(records.locator('[data-inline-redemption-body]')).toContainText('暂无兑换记录');
    await expect(records.locator('[data-inline-redemption-body]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await page.locator('#platform-admin-shell main').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    if ([360, 540].includes(width)) await page.screenshot({ path: path.join(output, `expanded-${width}.png`) });
    for (const section of await sections.all()) await section.locator('summary').click();
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  const copy = root.locator('[data-referral-copy]');
  const link = await copy.getAttribute('data-referral-copy');
  await copy.click();
  await expect(copy).toHaveText('已复制');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.setViewportSize({ width: 540, height: 1000 });
  await redeem.locator('summary').click();
  await redeem.locator('button[type=submit]').click();
  await expect(redeem.locator('[data-inline-redeem-code]')).toHaveAttribute('aria-invalid', 'true');
  await redeem.locator('[data-inline-redeem-code]').fill('WELCOME-100');
  await redeem.locator('button[type=submit]').click();
  await expect(page.locator('#pc-toast')).toContainText('兑换成功');
  await expect(root.locator('[data-inline-learning-credits]')).toHaveText('100 积分');
  await records.locator('summary').click();
  await expect(records.locator('[data-inline-redemption-count]')).toHaveText('1 条');
  await expect(records).toContainText('WELCOME-100');
  await expect(records).toContainText('已到账 100 学习积分');
  await expect(root.locator('.pc-card .pc-card')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'redeemed-540.png') });
});
