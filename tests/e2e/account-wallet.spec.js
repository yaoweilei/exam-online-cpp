const { test, expect } = require('@playwright/test');
const { loginWithPassword, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

test('个人账户可以通过 Web 兑换积分并查看卡券包和支付流水', async ({ page }) => {
  const loginId = uniqueLoginId('student_wallet');

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, loginId);
  await openPersonalCenter(page);

  await page.locator('button.service-item[data-intent="openRedeem"]').click();
  const walletModal = page.locator('#pc-wallet-modal');
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('#wallet-title')).toHaveText('兑换码');
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

  await page.locator('button.service-item[data-intent="openCoupons"]').click();
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('#wallet-title')).toHaveText('卡券包', { timeout: 20000 });
  await expect(walletModal).toContainText('新用户学习积分包');

  await walletModal.locator('#wallet-close').click();
  await expect(walletModal).toBeHidden();

  await page.locator('button.service-item[data-intent="openRecharge"]').click();
  await expect(page.locator('#pc-recharge-modal')).toBeVisible();
  await expect(page.locator('#recharge-body')).toContainText('创建支付订单');
  await page.locator('#recharge-close').click();
  await expect(page.locator('#pc-recharge-modal')).toBeHidden();

  await page.locator('button.service-item[data-intent="openPaymentLedger"]').click();
  await expect(walletModal).toBeVisible();
  await expect(walletModal.locator('#wallet-title')).toHaveText('支付流水', { timeout: 20000 });
  await expect(walletModal).toContainText(/暂无支付流水|支付流水/);
});
