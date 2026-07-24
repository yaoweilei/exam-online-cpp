const { test, expect } = require('@playwright/test');
const { loginApi, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function loginWithApiSession(page, request) {
  const session = await loginApi(request, uniqueLoginId('student_wallet'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('exam_v2_token', token);
    localStorage.setItem('exam_v2_user', JSON.stringify(user));
  }, { token: session.token, user: session.user || session });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await stubNoisyPersonalCenterApis(page);
  await expect(page.locator('#user-menu-trigger, [aria-label*="打开个人中心"]').first()).toHaveAttribute('aria-label', /打开个人中心/);
}

test('个人账户可以通过 Web 兑换积分并查看卡券包和支付流水', async ({ page, request }) => {
  await loginWithApiSession(page, request);
  await openPersonalCenter(page);

  await page.locator('button.pc-account-entry[data-dashboard-page="account-coupons"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('卡券');
  const redeemEntry = page.locator('button.pc-lite-row[data-intent="openRedeem"]');
  await redeemEntry.click();
  const walletModal = page.locator('#pc-wallet-modal');
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'wallet-title');
  await expect(page.locator('#wallet-close')).toBeFocused();
  await expect(walletModal.locator('#wallet-title')).toHaveText('兑换码');
	await walletModal.locator('#wallet-redeem-code').fill('');
	await walletModal.locator('#wallet-redeem-submit').click();
	await expect(walletModal.locator('#wallet-redeem-code')).toHaveAttribute('aria-invalid', 'true');
	await expect(walletModal.locator('#wallet-redeem-form .pc-field-error')).toContainText('请输入兑换码');
  await walletModal.locator('#wallet-redeem-code').fill('WELCOME-100');
  await walletModal.locator('#wallet-redeem-submit').click();
  await expect(page.locator('#pc-toast')).toHaveText(/兑换成功/, { timeout: 20000 });
  await expect(walletModal.locator('#wallet-redeem-result')).toContainText(/100|积分/);

  await walletModal.locator('#wallet-show-coupons').click();
  await expect(walletModal.locator('#wallet-title')).toHaveText('卡券包', { timeout: 20000 });
  await expect(walletModal).toContainText('新用户学习积分包');
  await expect(walletModal).toContainText('WELCOME-100');

  await walletModal.locator('#wallet-close').click();
  await expect(walletModal).toBeHidden();
  await expect(redeemEntry).toBeFocused();

  const couponEntry = page.locator('button.pc-lite-row[data-intent="openCoupons"]').first();
  await couponEntry.click();
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('#wallet-title')).toHaveText('卡券包', { timeout: 20000 });
  await expect(walletModal).toContainText('新用户学习积分包');

  await page.keyboard.press('Escape');
  await expect(walletModal).toBeHidden();
  await expect(couponEntry).toBeFocused();

  await page.locator('#pc-header-back, [data-dashboard-back]').first().click();
  await expect(page.locator('.pc-my-account-card')).toBeVisible();
  await page.locator('button.pc-account-entry[data-dashboard-page="account-plan"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('套餐');
  const rechargeEntry = page.locator('button.pc-lite-row[data-intent="openRecharge"]');
  await rechargeEntry.click();
  const rechargeModal = page.locator('#pc-recharge-modal');
  await expect(rechargeModal).toBeVisible();
  await expect(rechargeModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'recharge-title');
  await expect(page.locator('#recharge-close')).toBeFocused();
  await expect(page.locator('#recharge-body')).toContainText('创建支付订单');
  await expect(page.locator('#recharge-body')).toContainText('¥12.9 / 30天起');
  const modalWidth = await rechargeModal.locator('> div').evaluate((node) => node.getBoundingClientRect().width);
  expect(modalWidth).toBeLessThanOrEqual(760);
  const rechargeDays = await page.locator('#recharge-days').evaluate((node) => Array.from(node.options).map((option) => option.value));
  const rechargeProviders = await page.locator('#recharge-provider').evaluate((node) => Array.from(node.options).map((option) => option.value));
  expect(rechargeDays).toEqual(['30', '90', '365']);
  expect(rechargeProviders).toEqual(['wechat', 'alipay', 'stripe']);
  await expect(page.locator('#recharge-days')).toHaveValue('30');
  await expect(page.locator('#recharge-provider')).toHaveValue('wechat');
  await page.locator('input[name="recharge-plan"][value="pro"]').check();
  await expect(page.locator('#recharge-preview')).toContainText('渠道为 微信支付');
  await page.keyboard.press('Escape');
  await expect(rechargeModal).toBeHidden();
  await expect(rechargeEntry).toBeFocused();

  await page.locator('button.pc-lite-row[data-intent="openPaymentLedger"]').first().click();
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('#wallet-title')).toHaveText('支付流水', { timeout: 20000 });
  await expect(walletModal).toContainText(/暂无支付流水|支付流水/);
});
