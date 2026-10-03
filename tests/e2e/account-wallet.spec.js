const { test, expect } = require('@playwright/test');
const { loginApi, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function loginWithApiSession(page, request, loginId = uniqueLoginId('student_wallet')) {
  const session = await loginApi(request, loginId);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.context().addCookies([{
    name: 'exam_session',
    value: session.token,
    url: new URL(page.url()).origin,
    httpOnly: true,
    sameSite: 'Lax'
  }]);
  await page.evaluate(({ token, user }) => {
    localStorage.removeItem('exam_v2_token');
    localStorage.setItem('exam_v2_user', JSON.stringify({ ...user, token: '' }));
  }, { token: session.token, user: session.user || session });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await stubNoisyPersonalCenterApis(page);
  await expect(page.locator('#user-menu-trigger, [aria-label*="打开账号菜单"]').first()).toHaveAttribute('aria-label', /打开账号菜单/);
}

test('超级管理员账号展示预置兑换记录', async ({ page, request }) => {
  await loginWithApiSession(page, request, 'superadmin_demo');
  await page.evaluate(() => window.openPersonalCenter?.());
  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();
  await shell.locator('[data-role-workbench-switch]').selectOption({ label: '学员' });
  await expect(shell.locator('.pc-platform-brand')).toContainText('学员');
  await shell.getByRole('button', { name: '优惠与邀请', exact: true }).click();
  const recordSection = page.locator('[data-inline-wallet-section="records"]');
  await expect(recordSection.locator('[data-inline-redemption-count]')).toHaveText('3 条');
  await recordSection.locator('summary').click();
  await expect(recordSection).toContainText('新用户学习积分包');
  await expect(recordSection).toContainText('PRO 30 天体验卡');
  await expect(recordSection).toContainText('ULTRA 30 天体验卡');
  await expect(recordSection.locator('.pc-redemption-record-row')).toHaveCount(3);
  await expect(recordSection.locator('[data-inline-redemption-body]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('个人账户可以在页内兑换并查看兑换记录和订单详情', async ({ page, request }) => {
  await loginWithApiSession(page, request);
  await page.evaluate(() => window.openPersonalCenter?.());
  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();

  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.getByRole('menuitem', { name: '优惠与邀请', exact: true }).click();
  await expect(page.locator('.pc-subpage')).toContainText('兑换记录');
  await expect(page.locator('.pc-referral-card')).toContainText('邀请好友');
  await expect(page.locator('.pc-referral-card')).not.toContainText('我的推荐码');
  await expect(page.locator('.pc-referral-card')).not.toContainText('已绑定推荐人');
  await expect(page.locator('.pc-referral-card')).not.toContainText('本地测试链接');
  const learningCreditSection = page.locator('.pc-learning-credit-section');
  await expect(learningCreditSection).not.toHaveAttribute('open', '');
  await expect(learningCreditSection).toContainText('成功邀请 0 人');
  await expect(learningCreditSection.locator('.pc-learning-credit-records')).toBeHidden();
  await learningCreditSection.locator('summary').click();
  await expect(learningCreditSection).toHaveAttribute('open', '');
  await expect(learningCreditSection.locator('.pc-learning-credit-records')).toBeVisible();
  await expect(page.locator('.pc-benefit-card')).toContainText('我的优惠');
  await expect(page.locator('.pc-benefit-card')).toContainText('当前可用');
  await expect(page.locator('.pc-benefit-card')).toContainText('累计获得');
  await expect(page.locator('.pc-benefit-card')).not.toContainText('列表来自钱包接口');
  await expect(page.locator('.pc-benefit-action')).toHaveCount(0);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  const copyReferralLinkButton = page.locator('[data-referral-copy-label="推荐链接"]');
  const referralLink = await copyReferralLinkButton.getAttribute('data-referral-copy');
  await copyReferralLinkButton.click();
  await expect(copyReferralLinkButton).toHaveText('已复制');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(referralLink);
  const walletModal = page.locator('#pc-wallet-modal');
  await expect(walletModal).toHaveCount(0);
  const redeemSection = page.locator('[data-inline-wallet-section="redeem"]');
  const recordSection = page.locator('[data-inline-wallet-section="records"]');
  await expect(redeemSection).not.toHaveAttribute('open', '');
  await expect(recordSection).not.toHaveAttribute('open', '');
  await redeemSection.locator('summary').click();
  await expect(redeemSection).toHaveAttribute('open', '');
	const redeemControlStyle = await redeemSection.locator('[data-inline-redeem-code]').evaluate((input) => ({
		height: input.getBoundingClientRect().height,
		borderRadius: getComputedStyle(input).borderRadius,
		fontSize: getComputedStyle(input).fontSize
	}));
	expect(redeemControlStyle.height).toBe(44);
	expect(redeemControlStyle.borderRadius).toBe('14px');
	expect(redeemControlStyle.fontSize).toBe('14px');
	await redeemSection.locator('[data-inline-redeem-code]').fill('');
	await redeemSection.locator('button[type="submit"]').click();
	await expect(redeemSection.locator('[data-inline-redeem-code]')).toHaveAttribute('aria-invalid', 'true');
	await expect(redeemSection.locator('.pc-field-error')).toContainText('请输入兑换码');
  await redeemSection.locator('[data-inline-redeem-code]').fill('WELCOME-100');
  await redeemSection.locator('button[type="submit"]').click();
  await expect(page.locator('#pc-toast')).toHaveText(/兑换成功/, { timeout: 20000 });
  await expect(redeemSection.locator('[data-inline-redeem-result]')).toContainText(/100|积分/);
  await recordSection.locator('summary').click();
  await expect(recordSection).toHaveAttribute('open', '');
  await expect(recordSection).toContainText('新用户学习积分包', { timeout: 20000 });
  await expect(recordSection).toContainText('WELCOME-100');
  await expect(recordSection.locator('[data-inline-redemption-count]')).toHaveText('1 条');
  await expect(walletModal).toHaveCount(0);

  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.getByRole('menuitem', { name: '套餐与订单', exact: true }).click();
  await expect(page.locator('.pc-subpage')).toContainText('套餐');
  const purchasePanel = page.locator('[data-account-recharge-panel]');
  await expect(purchasePanel).toBeVisible();
  await expect(purchasePanel).toContainText('开通 PRO');
	await expect(purchasePanel).toContainText('当前套餐：FREE · 使用中 · 长期有效');
	await expect(purchasePanel.locator('[data-intent="openPaymentLedger"]')).toHaveCount(0);
	const inlineOrders = page.locator('[data-account-order-history]');
	await expect(inlineOrders).toBeVisible();
	await expect(inlineOrders).toHaveClass(/pc-lite-list-card/);
	const currentYear = new Date().getFullYear();
	await expect(inlineOrders.locator('summary')).toContainText(`${currentYear}~至今订单`);
	await expect(inlineOrders).not.toHaveAttribute('open', '');
	await expect(inlineOrders.locator('.pc-account-order-history-body')).toBeHidden();
	await inlineOrders.locator('summary').click();
	await expect(inlineOrders).toHaveAttribute('open', '');
	await expect(inlineOrders.locator('.pc-account-order-history-body')).toBeVisible();
	await expect(page.locator('.pc-subpage > .pc-lite-list-card').filter({ hasText: '我的套餐' })).toHaveCount(0);
  await expect(purchasePanel.locator('[data-recharge-auto-renew]')).not.toBeChecked();
	await expect(purchasePanel.locator('[data-recharge-auto-renew]')).toBeDisabled();
	await expect(purchasePanel).toContainText('渠道签约暂未开放，请到期前手动续费');
  await expect(purchasePanel.locator('[data-recharge-email]')).toBeChecked();
  await expect(page.locator('[data-auto-renew-card][data-renew-scope="personal"]')).toHaveCount(0);
	await expect(page.locator('.pc-message-center-summary')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const renewalLayout = await purchasePanel.evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const controls = Array.from(card.querySelectorAll('.pc-recharge-duration-card, .pc-recharge-provider-field .pc-profile-input, .pc-recharge-preference, [data-recharge-submit]'))
      .map((node) => node.getBoundingClientRect());
    return {
      viewportWidth: window.innerWidth,
      card: { left: cardBox.left, right: cardBox.right },
      controls: controls.map((box) => ({ left: box.left, right: box.right, width: box.width }))
    };
  });
  expect(renewalLayout.card.left).toBeGreaterThanOrEqual(0);
  expect(renewalLayout.card.right).toBeLessThanOrEqual(renewalLayout.viewportWidth + 1);
  for (const control of renewalLayout.controls) {
    expect(control.left).toBeGreaterThanOrEqual(renewalLayout.card.left - 1);
    expect(control.right).toBeLessThanOrEqual(renewalLayout.card.right + 1);
    expect(control.width).toBeGreaterThan(100);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
	await shell.getByRole('button', { name: '消息中心', exact: true }).click();
	await expect(shell.locator('.pc-platform-topbar')).toContainText('消息中心');
	await expect(shell.locator('[data-message-center-category]')).toHaveCount(4);
	await expect(shell.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
	await shell.getByRole('tab', { name: /互动消息/ }).click();
	await expect(shell.locator('[data-message-center-list]')).toContainText('暂时没有互动消息');
	await shell.getByRole('button', { name: '套餐与订单', exact: true }).click();
	const desktopColumns = await purchasePanel.evaluate((card) => {
		const priceCards = Array.from(card.querySelectorAll('.pc-recharge-duration-card')).map((node) => node.getBoundingClientRect());
		const checkoutCards = Array.from(card.querySelectorAll('.pc-recharge-provider-field, .pc-recharge-preference')).map((node) => node.getBoundingClientRect());
		return {
			price: priceCards.map((box) => ({ left: box.left, width: box.width })),
			checkout: checkoutCards.map((box) => ({ left: box.left, width: box.width }))
		};
	});
	expect(desktopColumns.price).toHaveLength(3);
	expect(desktopColumns.checkout).toHaveLength(3);
	for (let index = 0; index < 3; index += 1) {
		expect(Math.abs(desktopColumns.checkout[index].left - desktopColumns.price[index].left)).toBeLessThanOrEqual(1);
		expect(Math.abs(desktopColumns.checkout[index].width - desktopColumns.price[index].width)).toBeLessThanOrEqual(1);
	}
  const rechargeDays = await purchasePanel.locator('[data-recharge-days]').evaluateAll((nodes) => nodes.map((node) => node.value));
  const rechargeProviders = await purchasePanel.locator('[data-recharge-provider]').evaluate((node) => Array.from(node.options).map((option) => option.value));
  expect(rechargeDays).toEqual(['30', '90', '365']);
  expect(rechargeProviders).toEqual(['wechat', 'alipay', 'stripe']);
  await expect(purchasePanel.locator('[data-recharge-days][value="365"]')).toBeChecked();
  await expect(purchasePanel.locator('[data-recharge-provider]')).toHaveValue('wechat');
  await expect(purchasePanel.locator('[data-recharge-preview]')).toContainText('微信支付');
	await expect(purchasePanel.locator('[data-recharge-preview]')).toContainText('365 天 PRO');
	await expect(purchasePanel.locator('[data-recharge-preview]')).not.toContainText('正在确认可用优惠');
	await expect(purchasePanel.locator('[data-recharge-preview]')).not.toContainText('日常价');
	await expect(purchasePanel.locator('.pc-recharge-settlement [data-recharge-submit]')).toBeVisible();
	await expect(purchasePanel).not.toContainText('邀请学习金余额');
	await expect(purchasePanel).not.toContainText('优惠与邀请');

	await purchasePanel.locator('[data-recharge-submit]').click();
	const mockWechat = page.locator('#pc-mock-wechat-payment');
	await expect(mockWechat).toBeVisible();
	await expect(mockWechat).toContainText('微信收款');
	await expect(mockWechat).toContainText('模拟收款码');
	await expect(mockWechat.locator('[data-mock-wechat-success]')).toBeFocused();
	await mockWechat.locator('[data-mock-wechat-success]').click();
	await expect(mockWechat).toContainText('支付成功', { timeout: 20000 });
	await expect(mockWechat).toContainText('PRO 年度套餐已生效');
	await expect(mockWechat).toContainText('¥99.90');
	await expect(purchasePanel).toContainText('当前套餐：PRO · 使用中', { timeout: 20000 });
	await mockWechat.locator('[data-mock-wechat-view-order]').click();
	await expect(mockWechat).toBeHidden();
	await expect(walletModal).toBeHidden();
	const latestOrder = inlineOrders.locator('.pc-order-record').first();
	await expect(latestOrder).toBeVisible({ timeout: 20000 });
	await expect(latestOrder.locator('summary')).toHaveClass(/pc-lite-row/);
	await expect(latestOrder).toHaveAttribute('open', '');
	await expect(latestOrder).toContainText('PRO 年度套餐');
	await expect(latestOrder).toContainText('微信支付');
	await expect(latestOrder).toContainText('已支付');
	await expect(latestOrder).toContainText('日常价');
	await expect(latestOrder).toContainText('优惠金额');
	await expect(latestOrder).toContainText('实付金额');
	await expect(latestOrder).toContainText('¥145.00');
	await expect(latestOrder).toContainText('-¥45.10');
	await expect(latestOrder).toContainText('有效期');
	const expiryValue = latestOrder.locator('.pc-order-detail-grid > div').filter({ hasText: '有效期' }).locator('strong');
	await expect(expiryValue).toHaveText(/^\d{4}\/\d{2}\/\d{2}$/);
	await expect(latestOrder).toContainText('订单进度');
	await expect(latestOrder).toContainText('套餐权益已生效');
	const copyOrderButton = latestOrder.locator('[data-copy-payment-order]');
	await expect(copyOrderButton).toBeVisible();
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
	const copiedOrderId = await copyOrderButton.getAttribute('data-copy-payment-order');
	await copyOrderButton.click();
	await expect(copyOrderButton).toHaveText('已复制');
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(copiedOrderId);
	await expect(latestOrder.locator('.pc-order-record-chevron svg')).toBeVisible();
	await expect(latestOrder.locator('.pc-order-record-product > .pc-plan-badge')).toHaveCount(0);
	await expect(latestOrder.locator('.pc-order-chevron-down')).toHaveAttribute('d', 'M1 4.5 8 11.5 15 4.5');
	await expect(latestOrder.locator('.pc-order-chevron-up')).toHaveAttribute('d', 'M1 11.5 8 4.5 15 11.5');
	expect(await latestOrder.locator('.pc-order-record-total').evaluate((total) => getComputedStyle(total).display)).toBe('flex');
	const orderDetailLayout = await latestOrder.locator('.pc-order-record-detail').evaluate((detail) => {
		const grid = detail.querySelector('.pc-order-detail-grid')?.getBoundingClientRect();
		const main = detail.querySelector('.pc-order-detail-main')?.getBoundingClientRect();
		const timeline = detail.querySelector('.pc-order-timeline')?.getBoundingClientRect();
		const detailRect = detail.getBoundingClientRect();
		const style = getComputedStyle(detail);
		return {
			columns: style.gridTemplateColumns.split(' ').length,
			gap: style.gap,
			paddingTop: style.paddingTop,
			borderRadius: style.borderRadius,
			gridRight: grid?.right || 0,
			timelineLeft: timeline?.left || 0,
			mainBottom: main?.bottom || 0,
			timelineBottom: timeline?.bottom || 0,
			extraHeight: detailRect.height - Math.max(main?.height || 0, timeline?.height || 0)
		};
	});
	expect(orderDetailLayout.columns).toBe(2);
	expect(orderDetailLayout.gap).toBe('4px');
	expect(orderDetailLayout.paddingTop).toBe('6px');
	expect(orderDetailLayout.borderRadius).toBe('8px');
	expect(orderDetailLayout.timelineLeft).toBeGreaterThan(orderDetailLayout.gridRight);
	expect(Math.abs(orderDetailLayout.timelineBottom - orderDetailLayout.mainBottom)).toBeLessThanOrEqual(1);
	expect(orderDetailLayout.extraHeight).toBeLessThanOrEqual(16);
	const alignedOrderActions = await latestOrder.locator('summary').evaluate((summary) => {
		const total = summary.querySelector('.pc-order-record-total')?.getBoundingClientRect();
		const arrow = summary.querySelector('.pc-order-record-chevron svg')?.getBoundingClientRect();
		const row = summary.getBoundingClientRect();
		return total && arrow ? {
			totalRight: total.right,
			arrowLeft: arrow.left,
			arrowRight: arrow.right,
			rowRight: row.right
		} : null;
	});
	expect(alignedOrderActions).not.toBeNull();
	expect((alignedOrderActions?.arrowLeft || 0) - (alignedOrderActions?.totalRight || 0)).toBeLessThanOrEqual(13);
	expect((alignedOrderActions?.rowRight || 0) - (alignedOrderActions?.arrowRight || 0)).toBeLessThanOrEqual(4);
	const arrowCenter = async (selector) => latestOrder.locator(selector).evaluate((path) => {
		const box = path.getBoundingClientRect();
		const row = path.closest('summary')?.getBoundingClientRect();
		return {
			x: row ? (box.left + box.right) / 2 - (row.left + row.right) / 2 : 999,
			y: row ? (box.top + box.bottom) / 2 - (row.top + row.bottom) / 2 : 999
		};
	});
	const openArrowCenter = await arrowCenter('.pc-order-chevron-up');
	await latestOrder.locator('summary').click();
	await expect(latestOrder).not.toHaveAttribute('open', '');
	await page.waitForTimeout(200);
	const closedArrowCenter = await arrowCenter('.pc-order-chevron-down');
	expect(Math.abs(openArrowCenter.x - closedArrowCenter.x)).toBeLessThanOrEqual(0.5);
	expect(Math.abs(openArrowCenter.y - closedArrowCenter.y)).toBeLessThanOrEqual(0.5);
	const commonOrderSurface = await latestOrder.evaluate((order) => ({
		borderRadius: getComputedStyle(order).borderRadius,
		boxShadow: getComputedStyle(order).boxShadow
	}));
	expect(commonOrderSurface.borderRadius).toBe('0px');
	expect(commonOrderSurface.boxShadow).toBe('none');
	const compactOrderHeader = await latestOrder.locator('.pc-order-record-copy').evaluate((copy) => {
		const title = copy.querySelector('strong')?.getBoundingClientRect();
		const meta = copy.querySelector('small')?.getBoundingClientRect();
		return {
			display: getComputedStyle(copy).display,
			centerDelta: title && meta ? Math.abs((title.top + title.bottom) / 2 - (meta.top + meta.bottom) / 2) : 999
		};
	});
	expect(compactOrderHeader.display).toBe('flex');
	expect(compactOrderHeader.centerDelta).toBeLessThanOrEqual(4);
});
