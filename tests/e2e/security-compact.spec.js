const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');
const fs = require('node:fs');
const path = require('node:path');
const images = path.resolve(__dirname, '../../artifacts/security-compact-20261103');
fs.mkdirSync(images, { recursive: true });

async function openSecurity(page, user = uniqueLoginId('student_security_compact')) {
  await loginWithPassword(page, user);
  await page.evaluate(() => window.openPersonalCenter());
  await page.waitForLoadState('networkidle');
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-account-destination=account-security]').click();
  const root = page.locator('.pc-security-page');
  await expect(root).toBeVisible();
  return root;
}

test('账号安全使用单一紧凑列表，右侧操作对齐，手机默认一页可见', async ({ page }) => {
  const root = await openSecurity(page);
  await expect(root.locator('.pc-account-row')).toHaveCount(5);
  await expect(root).not.toContainText('数据导出');
  await expect(root).not.toContainText('多端同步');
  await expect(root).not.toContainText('账户数据');
  await expect(root).not.toContainText('Google 绑定');
  await expect(page.locator('[data-intent="openSyncDevices"]')).toHaveCount(0);
  await expect(root.locator('[data-account-action=sessions]')).toBeVisible();
  for (const width of [360, 540, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width <= 540 ? 780 : 1000 });
    const layout = await root.evaluate(element => ({
      overflow: element.scrollWidth - element.clientWidth,
      rows: [...element.querySelectorAll('.pc-account-row')].map(row => ({
        height: row.getBoundingClientRect().height,
        columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
        titleStroke: getComputedStyle(row.querySelector('.pc-account-main strong')).webkitTextStrokeWidth,
        arrowRight: row.querySelector('.pc-account-status svg').getBoundingClientRect().right
      }))
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.rows.map(row => row.titleStroke)).toEqual(Array(5).fill('0px'));
    expect(layout.rows.every(row => row.height >= 44 && row.height <= 90 && row.columns === 3), JSON.stringify(layout.rows)).toBeTruthy();
    expect(Math.max(...layout.rows.map(row => row.arrowRight)) - Math.min(...layout.rows.map(row => row.arrowRight))).toBeLessThanOrEqual(1);
    if (width <= 540) expect(await page.locator('#platform-admin-shell main').evaluate(e => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
    if ([360, 540, 768].includes(width)) await page.screenshot({ path: path.join(images, `security-${width}.png`) });
  }
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-account-destination=account-profile]').click();
  await expect(page.locator('.pc-profile-page')).toBeVisible();
  await page.locator('[data-workspace-back]').click();
  await expect(root).toBeVisible();
});

test('紧凑安全列表的绑定、设备和注销展开仍可用，七角色共用布局', async ({ page }) => {
  let root = await openSecurity(page);
  await page.setViewportSize({ width: 360, height: 900 });
  await root.locator('[data-account-action=password]').click();
  await expect(page.locator('#pc-toast')).toContainText('手机验证码登录');
  await expect(root.locator('[data-account-password-form]')).toHaveCount(0);
  await root.locator('[data-account-action=phone]').click();
  await expect(root.locator('[data-phone-verify-form]')).toBeVisible();
  await expect(root.locator('[data-account-action=phone]')).toHaveAttribute('aria-expanded', 'true');
  await root.locator('[data-account-action=phone]').click();
  await root.locator('[data-account-action=wechat]').click();
  await expect(root.locator('[data-account-wechat-form]')).toBeVisible();
  await root.locator('[data-account-action=wechat]').click();
  await root.locator('[data-account-action=sessions]').click();
  await expect(root.locator('[data-account-refresh-sessions]')).toBeVisible();
  await expect(root.locator('.pc-account-session-row')).not.toHaveCount(0);
  await root.locator('[data-account-action=sessions]').click();
  await root.locator('[data-account-action=delete]').click();
  await expect(root.locator('[data-account-delete-form]')).toBeVisible();
  await expect(root.locator('[data-account-delete-send-phone-code]')).toBeDisabled();
  await root.getByRole('button', { name: '再想想', exact: true }).click();
  await expect(root.locator('[data-account-delete-form]')).toHaveCount(0);
  await openSecurity(page, uniqueLoginId('superadmin_security_compact'));
  for (const role of ['superAdmin', 'student', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin']) {
    await page.locator('[data-platform-admin-account-menu]').click();
    await page.locator('.pc-role-identity-menu>summary').click();
    await page.locator(`[data-role-workbench=${role}]`).click();
    await page.waitForLoadState('networkidle');
    await page.locator('[data-platform-admin-account-menu]').click();
    await page.locator('[data-account-destination=account-security]').click();
    root = page.locator('.pc-security-page');
    await expect(root.locator('.pc-account-row')).toHaveCount(5);
    await expect(root.locator('.pc-account-status').first()).toHaveCSS('grid-column-start', '3');
    expect(await page.locator('#platform-admin-shell main').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  }
});
