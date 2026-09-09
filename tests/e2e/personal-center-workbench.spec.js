const { test, expect } = require('@playwright/test');
const { clearBrowserSession, expectGuestEntry, loginApi, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function loginWithDevUser(page, loginId, apiFixtures = {}, options = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!options.skipApiStubs) {
    await stubNoisyPersonalCenterApis(page, apiFixtures);
  }

  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  const button = page.locator(`[data-dev-login="${loginId}"]`);
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  if (!options.skipPersonalCenter) await openPersonalCenter(page);
}

async function openPlatformAdminPage(page, name = '总览') {
  const shell = page.locator('#platform-admin-shell');
  const isOpen = await shell.count() > 0 && await shell.evaluate((element) => element.classList.contains('pc-platform-admin-open'));
  if (!isOpen) {
		await page.locator('#user-menu-trigger').click();
		await page.getByRole('menuitem', { name: /进入(?:管理后台|平台管理|管理)/ }).click();
  }
  await expect(shell).toBeVisible();
  await shell.getByRole('button', { name, exact: true }).click();
}

async function openRefundFromPaidOrder(page) {
	await openPlatformAdminPage(page, '订单与支付');
	const shell = page.locator('#platform-admin-shell');
	await expect(shell.locator('[data-platform-payment-tab="orders"]')).toBeVisible({ timeout: 20000 });
	const paidOrder = shell.locator('.pc-platform-payment-row:has(.pc-platform-payment-status.is-paid), .pc-platform-payment-row:has(.pc-platform-payment-status.is-partially_refunded)').first();
	await expect(paidOrder).toBeVisible({ timeout: 20000 });
	const orderId = (await paidOrder.locator('code').innerText()).trim();
	await paidOrder.locator('[data-platform-payment-order-link]').click();
	await shell.getByRole('button', { name: '发起退款', exact: true }).click();
	const orderInput = shell.locator('[data-platform-refund-order-id]');
	await expect(orderInput).toHaveValue(orderId);
	return orderInput;
}

test('旧学员首页入口已删除并统一进入学习工作台', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {}, { skipPersonalCenter: true });
  await page.evaluate(() => window.openPersonalCenter?.());

  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();
  await expect(shell.locator('.pc-platform-topbar')).toContainText('学习工作台');
  await expect(shell.getByRole('button', { name: '我的作业', exact: true })).toBeVisible();
  await expect(page.locator('#personal-center.pc-open')).toHaveCount(0);
  await expect(page.locator('.pc-my-content-card, .pc-my-account-card, .pc-student-content-group')).toHaveCount(0);
});

test('学习工作台旧功能弹层显示在工作台上方并可返回原入口', async ({ page }) => {
	await loginWithDevUser(page, 'student_demo', {}, { skipPersonalCenter: true });
	await page.evaluate(() => window.openPersonalCenter?.());

	const shell = page.locator('#platform-admin-shell');
	await expect(shell).toBeVisible();
	const entries = [
		{ name: '今日复习', modal: '#review-workbench-modal' },
		{ name: '错题本', modal: '#wq-modal' },
		{ name: '学习报告', modal: '#learning-report-modal' },
		{ name: '生词本', modal: '#vocab-modal' },
		{ name: '每日一练', modal: '#daily-practice-modal' },
		{ name: '备考目标', modal: '#study-goal-modal' },
		{ name: '推荐复习', modal: '#pc-recharge-modal' },
		{ name: '章节学习', modal: '#chapter-modal' }
	];

	for (const entry of entries) {
		const trigger = shell.getByRole('button', { name: entry.name, exact: true });
		await expect(trigger).toBeVisible();
		await trigger.click();
		const modal = page.locator(entry.modal);
		await expect(modal).toBeVisible({ timeout: 20000 });
		const layers = await page.evaluate((selector) => ({
			shell: Number.parseInt(window.getComputedStyle(document.querySelector('#platform-admin-shell')).zIndex || '0', 10),
			modal: Number.parseInt(window.getComputedStyle(document.querySelector(selector)).zIndex || '0', 10)
		}), entry.modal);
		expect(layers.modal, `${entry.name} 应显示在学习工作台上方`).toBeGreaterThan(layers.shell);
		await page.keyboard.press('Escape');
		await expect(modal).toBeHidden();
		await expect(trigger).toBeFocused();
		await expect(shell).toBeVisible();
	}

	for (const name of ['我的作业', '最近学习', '收藏题']) {
		await shell.getByRole('button', { name, exact: true }).click();
		await expect(shell.locator('.pc-platform-topbar')).toContainText(name);
		await expect(shell.locator('.pc-platform-admin-content')).toBeVisible();
	}

	const communityTrigger = shell.getByRole('button', { name: '社区讨论', exact: true });
	await communityTrigger.click();
	const communityPrompt = page.locator('.pc-confirm-overlay');
	await expect(communityPrompt).toBeVisible();
	const promptLayer = await communityPrompt.evaluate((element) => Number.parseInt(window.getComputedStyle(element).zIndex || '0', 10));
	const shellLayer = await shell.evaluate((element) => Number.parseInt(window.getComputedStyle(element).zIndex || '0', 10));
	expect(promptLayer).toBeGreaterThan(shellLayer);
	await communityPrompt.locator('[data-pc-input]').fill('2023_02');
	await communityPrompt.locator('[data-pc-input-ok]').click();
	await expect(page.locator('#community-modal')).toBeVisible({ timeout: 20000 });
	await page.keyboard.press('Escape');
	await expect(page.locator('#community-modal')).toBeHidden();
	await expect(communityTrigger).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	const mobileReportTrigger = shell.getByRole('button', { name: '学习报告', exact: true });
	await mobileReportTrigger.click();
	const mobileReport = page.locator('#learning-report-modal');
	await expect(mobileReport).toBeVisible();
	const mobileBounds = await mobileReport.locator('.pc-legacy-modal-panel').evaluate((panel) => {
		const box = panel.getBoundingClientRect();
		return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: window.innerWidth, height: window.innerHeight };
	});
	expect(mobileBounds.left).toBeGreaterThanOrEqual(0);
	expect(mobileBounds.top).toBeGreaterThanOrEqual(0);
	expect(mobileBounds.right).toBeLessThanOrEqual(mobileBounds.width);
	expect(mobileBounds.bottom).toBeLessThanOrEqual(mobileBounds.height);
	await page.keyboard.press('Escape');
});

test('教师运营机构和内容工作台全部菜单入口均能打开', async ({ page }) => {
	test.setTimeout(180000);
	const cases = [
		{ loginId: 'teacher_demo', entry: '进入教学管理', items: ['我的学生', '学习组', '课程表', '安排课程', '待批改', '布置作业', '成绩册', '备课'] },
		{ loginId: 'assistant_demo', entry: '进入教学运营', items: ['催交作业', '学员跟进', '续费风险', '异常提醒', '学习组', '课程表', '课程包', '安排课程'] },
		{ loginId: 'orgadmin_demo', entry: '进入机构管理', items: ['成员管理', '权限管理', '机构设置', '学习组', '课程包', '机构看板'] },
		{ loginId: 'contentadmin_demo', entry: '进入内容管理', items: ['内容反馈', '发布工作流', '内容日志'] }
	];

	for (const item of cases) {
		await loginWithDevUser(page, item.loginId, {}, { skipPersonalCenter: true });
		await page.locator('#user-menu-trigger').click();
		await page.getByRole('menuitem', { name: item.entry }).click();
		const shell = page.locator('#platform-admin-shell');
		await expect(shell).toBeVisible();
		for (const name of item.items) {
			await shell.getByRole('button', { name, exact: true }).click();
			await expect(shell.locator('.pc-platform-topbar')).toContainText(name);
			await expect(shell.locator('.pc-platform-admin-content')).toBeVisible();
			await expect(shell.locator('.pc-platform-admin-content')).not.toBeEmpty();
		}
		await shell.locator('[data-platform-admin-close]').click();
	}
});

test('不同角色的个人中心共用相同面板和头像坐标', async ({ page }) => {
	const layouts = [];
	for (const loginId of ['student_demo', 'teacher_demo', 'orgadmin_demo', 'superadmin_demo']) {
		await loginWithDevUser(page, loginId, {}, { skipPersonalCenter: true });
		await page.locator('#user-menu-trigger').click();
		await page.getByRole('menuitem', { name: /^个人资料/ }).click();
		layouts.push(await page.locator('#personal-center .pc-panel').evaluate((panel) => {
			const panelBox = panel.getBoundingClientRect();
			const avatarBox = panel.querySelector('.pc-avatar')?.getBoundingClientRect();
			return {
				x: panelBox.x,
				y: panelBox.y,
				width: panelBox.width,
				avatarX: (avatarBox?.x || 0) - panelBox.x,
				avatarY: (avatarBox?.y || 0) - panelBox.y,
				avatarWidth: avatarBox?.width || 0
			};
		}));
	}
	for (const layout of layouts.slice(1)) {
		expect(Math.abs(layout.x - layouts[0].x)).toBeLessThanOrEqual(1);
		expect(Math.abs(layout.y - layouts[0].y)).toBeLessThanOrEqual(1);
		expect(Math.abs(layout.width - layouts[0].width)).toBeLessThanOrEqual(1);
		expect(Math.abs(layout.avatarX - layouts[0].avatarX)).toBeLessThanOrEqual(1);
		expect(Math.abs(layout.avatarY - layouts[0].avatarY)).toBeLessThanOrEqual(1);
		expect(Math.abs(layout.avatarWidth - layouts[0].avatarWidth)).toBeLessThanOrEqual(1);
	}
});

test('所有角色共用账号菜单、资料安全页和响应式工作台外壳', async ({ page }) => {
	test.setTimeout(180000);
	const cases = [
		{ loginId: 'student_demo', entry: '进入学习中心', workspace: '学习工作台', brand: '学员', shell: true, nav: '我的作业', groups: ['学习', '更多'] },
		{ loginId: 'teacher_demo', entry: '进入教学管理', workspace: '教学工作台', brand: '老师', shell: true, nav: '我的学生', groups: ['学员', '教学'] },
		{ loginId: 'assistant_demo', entry: '进入教学运营', workspace: '运营工作台', brand: '教学运营', shell: true, nav: '催交作业', groups: ['学员运营', '教学支持'] },
		{ loginId: 'orgadmin_demo', entry: '进入机构管理', workspace: '机构工作台', brand: '机构管理', shell: true, nav: '成员管理', groups: ['成员与权限', '教学运营', '机构'] },
		{ loginId: 'contentadmin_demo', entry: '进入内容管理', workspace: '内容工作台', brand: '内容管理', shell: true, nav: '内容反馈', groups: ['内容'] }
	];

	for (const item of cases) {
		await loginWithDevUser(page, item.loginId, {}, { skipPersonalCenter: true });
		const trigger = page.locator('#user-menu-trigger');
		await expect(trigger).toHaveAttribute('aria-label', '打开账号菜单');
		await trigger.click();
		const menu = page.locator('#superadmin-account-menu');
		await expect(menu).toBeVisible();
		await expect(menu).toContainText(item.loginId);
		await expect(menu.getByRole('menuitem', { name: /^个人资料/ })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: /^账号安全/ })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: item.entry })).toBeVisible();

		await menu.getByRole('menuitem', { name: /^个人资料/ }).click();
		await expect(page.locator('#personal-center')).toHaveClass(/pc-superadmin-account/);
		await expect(page.locator('.pc-superadmin-detail-head')).toContainText('个人资料');
		await expect(page.locator('button.pc-nav-item', { hasText: '管理' })).toHaveCount(0);
		await expect(page.locator('.pc-account-card')).toHaveCount(0);
		await page.locator('#personal-center .pc-close').click();

		await trigger.click();
		await menu.getByRole('menuitem', { name: item.entry }).click();
		const shell = page.locator('#platform-admin-shell');
		await expect(shell).toBeVisible();
		const overviewLayout = await shell.evaluate((element) => {
			const content = element.querySelector('.pc-platform-admin-content');
			const overview = element.querySelector('.pc-role-admin-overview');
			const launcher = element.querySelector('.pc-role-admin-launcher');
			const contentStyle = content ? window.getComputedStyle(content) : null;
			return {
				padding: contentStyle ? [contentStyle.paddingTop, contentStyle.paddingRight, contentStyle.paddingBottom, contentStyle.paddingLeft] : [],
				overviewGap: overview ? window.getComputedStyle(overview).gap : '',
				launcherGap: launcher ? window.getComputedStyle(launcher).gap : ''
			};
		});
		expect(overviewLayout).toEqual({
			padding: ['4px', '4px', '4px', '4px'],
			overviewGap: '4px',
			launcherGap: '4px'
		});
		await expect(shell.locator('.pc-platform-brand')).toContainText(item.brand);
		await expect(shell.locator('.pc-platform-topbar')).toContainText(item.workspace);
		await expect(shell.locator('.pc-platform-nav-label')).toHaveText(item.groups);
		await expect(shell.getByRole('button', { name: item.nav, exact: true })).toBeVisible();
		await shell.getByRole('button', { name: item.nav, exact: true }).click();
		await expect(shell.locator('.pc-platform-topbar')).toContainText(item.nav);
		await expect(shell.locator('.pc-platform-admin-content')).toBeVisible();
		const detailGaps = await shell.locator('.pc-platform-admin-content').evaluate((content) => Array.from(content.querySelectorAll('.pc-dashboard, .pc-profile-stack, .pc-subpage'))
			.filter((element) => {
				const style = window.getComputedStyle(element);
				const box = element.getBoundingClientRect();
				return style.display !== 'none' && box.width > 0 && box.height > 0 && (style.display === 'flex' || style.display === 'grid');
			})
			.map((element) => window.getComputedStyle(element).gap));
		expect(detailGaps.every((gap) => gap === '4px')).toBeTruthy();
		await shell.locator('[data-platform-admin-close]').click();
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await loginWithDevUser(page, 'teacher_demo', {}, { skipPersonalCenter: true });
	await page.locator('#user-menu-trigger').click();
	await page.getByRole('menuitem', { name: '进入教学管理' }).click();
	const mobileShell = page.locator('#platform-admin-shell');
	const mobileLayout = await mobileShell.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const title = element.querySelector('.pc-platform-topbar > div:first-child')?.getBoundingClientRect();
		const account = element.querySelector('.pc-platform-account')?.getBoundingClientRect();
		const actions = element.querySelector('.pc-platform-window-actions')?.getBoundingClientRect();
		return {
			left: box.left,
			top: box.top,
			right: window.innerWidth - box.right,
			bottom: window.innerHeight - box.bottom,
			overflow: element.scrollWidth - element.clientWidth,
			headerTops: [title?.top || 0, account?.top || 0, actions?.top || 0]
		};
	});
	expect(mobileLayout.left).toBeGreaterThanOrEqual(3);
	expect(mobileLayout.top).toBeGreaterThanOrEqual(3);
	expect(mobileLayout.right).toBeGreaterThanOrEqual(3);
	expect(mobileLayout.bottom).toBeGreaterThanOrEqual(3);
	expect(mobileLayout.overflow).toBeLessThanOrEqual(1);
	expect(Math.max(...mobileLayout.headerTops) - Math.min(...mobileLayout.headerTops)).toBeLessThanOrEqual(8);
	await mobileShell.locator('[data-platform-admin-close]').click();

	await loginWithDevUser(page, 'student_demo', {}, { skipPersonalCenter: true });
	await page.locator('#user-menu-trigger').click();
	await page.getByRole('menuitem', { name: '进入学习中心' }).click();
	await expect(mobileShell.locator('.pc-platform-topbar')).toContainText('学习工作台');
	await expect(mobileShell.getByRole('button', { name: '我的作业', exact: true })).toBeVisible();
	const studentMobileOverflow = await mobileShell.evaluate((element) => element.scrollWidth - element.clientWidth);
	expect(studentMobileOverflow).toBeLessThanOrEqual(1);
});

test('我的作业进入真实列表而不是只滚动首页横幅', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    assignments: [{
      assignment_id: 'asg_student_ui',
      exam_id: '2023_02',
      title: 'EJU 听读解周练',
      due_at: '2030-08-15T10:00:00Z',
      own_submission: {
        submitted_at: '2030-08-10T08:30:00Z',
        teacher_comment: '订正第 3 题后再复习'
      },
      own_reminders: []
    }]
  });

  await page.locator('[data-intent="openAssignments"]').first().click();
  const subpage = page.locator('.pc-subpage');
  await expect(subpage).toContainText('我的作业');
  await expect(subpage).toContainText('EJU 听读解周练');
  await expect(subpage).toContainText('已提交');
  await expect(subpage).toContainText('订正第 3 题后再复习');
  await expect(subpage.locator('[data-intent^="openAssignmentExam:"]')).toHaveCount(1);
  await expect(page.locator('#pc-assignments-banner')).toHaveCount(0);
});

test('多端同步使用统一确认、按钮忙碌态和可访问表格', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  let stateRequests = 0;
  let pushRequests = 0;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'sync_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/me/sync/state', async (route) => {
    stateRequests += 1;
    if (stateRequests > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({
        server_time: '2026-07-18T12:00:00.000Z',
        modules: { progress: { exists: true, modified_at: '2026-07-18T11:00:00.000Z', size: 12 } }
      }))
    });
  });
  await page.route('**/api/v1/me/sync/push', async (route) => {
    pushRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({ status: 'conflict', written: {}, conflicts: { progress: { reason: 'newer_remote' } } }))
    });
  });

  await page.evaluate(() => {
    const manager = window.UserContextManager?.getInstance?.();
    const userId = manager?.getUserContext?.()?.id || 'usr_demo_student_001';
    localStorage.setItem(`sync.snapshot.${userId}.progress`, JSON.stringify({
      modified_at: '2026-07-18T10:00:00.000Z',
      content: { completed: 3 }
    }));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-dashboard-page="account-core"]').click();
  const syncEntry = page.locator('[data-intent="openSyncDevices"]');
  await expect(syncEntry).toContainText('多端同步');
  await syncEntry.click();
  const modal = page.locator('#sync-devices-modal');
  await expect(modal).toBeVisible();
  const dialog = modal.locator('[role="dialog"]');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  })).toBeTruthy();
  const tableRegion = modal.locator('.pc-responsive-table-region');
  await expect(tableRegion).toHaveAttribute('role', 'region');
  await expect(tableRegion).toHaveAttribute('tabindex', '0');
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();

  const refreshButton = modal.locator('#sd-refresh');
  await refreshButton.click();
  await expect(refreshButton).toBeDisabled();
  await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
  await expect(refreshButton).toBeEnabled();

  const pushButton = modal.locator('#sd-push');
  await pushButton.click();
  await expect(pushButton).toBeDisabled();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('同步冲突');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pc-confirm-dialog')).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(pushButton).toBeEnabled();
  await expect(pushButton).toBeFocused();
  expect(pushRequests).toBe(1);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(syncEntry).toBeFocused();
});

test('学习报告支持移动端对话框、周期忙碌态和 FREE 月报升级提示', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  const requestedPeriods = [];
  await page.route('**/api/v1/me/learning-report?period=*', async (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') || 'week';
    requestedPeriods.push(period);
    if (requestedPeriods.length > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        code: 'OK', message: 'ok',
        data: {
          period, since: '2026-07-01',
          answers: { exams: 2, questions: 20, accuracy: 0.8, wrong: 4, papers: [] },
          wrong_questions: { added_in_period: 4 }, srs: { due: 3 }, streak: { current: 5, best: 8 }
        }
      })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator('[data-intent="openLearningReport"]');
  await expect(entry).toBeVisible();
  await entry.click();

  const modal = page.locator('#learning-report-modal');
  const dialog = modal.locator('[role="dialog"]');
  await expect(modal).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-labelledby', 'lr-title');
  await expect(modal.locator('#lr-close')).toBeFocused();
  expect(await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  })).toBeTruthy();
  await expect(modal).toContainText('80.0%');

  const week = modal.locator('#lr-week');
  await week.click();
  await expect(week).toBeDisabled();
  await expect(week).toHaveAttribute('aria-busy', 'true');
  await expect(week).toBeEnabled();

  const month = modal.locator('#lr-month');
  await expect(month).toHaveAttribute('data-entitlement-locked', 'true');
  await expect(month).toContainText('PRO');
  await month.click();
  await expect(page.locator('#pc-recharge-modal')).toBeVisible();
  expect(requestedPeriods).not.toContain('month');
  await page.locator('#recharge-close').click();
  await expect(page.locator('#pc-recharge-modal')).toBeHidden();

  await modal.locator('#lr-close').click();
  await expect(modal).toBeHidden();
  await expect(entry).toBeFocused();
});

test('学习工具旧弹窗统一支持移动端、Esc 和焦点归还', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    bookmarkFolders: [], bookmarks: { questions: [] }, dailyPractice: { items: [], completed_question_ids: [] }
  });

  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'learning_tools_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/wrong-questions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({
        items: [{
          question_id: 'q_entitlement',
          exam_id: 'exam_entitlement',
          wrong_count: 1,
          question_snapshot: { question: '权益测试题', correct_answer: 'A', explanation: '基础解析' }
        }],
        summary: { total: 1, active: 1, mastered: 0 }
      }))
    });
  });
  await page.route('**/api/v1/srs/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [] })) });
  });
  await page.route('**/api/v1/me/study-goals*', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 250));
    const data = route.request().method() === 'POST' ? { goal_id: 'goal_e2e' } : { items: [] };
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok(data)) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const openTool = async ({ intent, modalId, closeId, titleId, synthetic = false }) => {
    let entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator(`[data-intent="${intent}"]`);
    if (synthetic) {
      const entryId = `learning-tool-entry-${intent}`;
      await page.evaluate(({ intent, entryId }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = entryId;
        button.className = 'service-item';
        button.dataset.intent = intent;
        button.textContent = intent;
        document.querySelector('#pc-content')?.appendChild(button);
      }, { intent, entryId });
      entry = page.locator(`#${entryId}`);
    }
    await expect(entry).toBeVisible();
    await entry.click();
    const modal = page.locator(`#${modalId}`);
    const dialog = modal.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', titleId);
    await expect(modal.locator(`#${closeId}`)).toBeFocused();
    expect(await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth;
    })).toBeTruthy();
    return { entry, modal };
  };

  const cases = [
    { intent: 'openWrongQuestions', modalId: 'wq-modal', closeId: 'wq-close', titleId: 'wq-title' },
    { intent: 'openSrsReview', modalId: 'srs-modal', closeId: 'srs-close', titleId: 'srs-title', synthetic: true },
    { intent: 'openReviewWorkbench', modalId: 'review-workbench-modal', closeId: 'rw-close', titleId: 'rw-title' }
  ];
  for (const item of cases) {
    const { entry, modal } = await openTool(item);
    if (item.intent === 'openWrongQuestions') {
      const related = modal.locator('[data-wq-action="related"]');
      await expect(related).toHaveAttribute('data-entitlement-locked', 'true');
      await expect(related).toContainText('PRO');
      await related.click();
      await expect(page.locator('#pc-recharge-modal')).toBeVisible();
      await page.locator('#recharge-close').click();
      await expect(page.locator('#pc-recharge-modal')).toBeHidden();

      const reset = modal.locator('#wq-reset');
      await reset.click();
      const riskModal = page.locator('#risk-modal');
      await expect(riskModal).toBeVisible();
      await expect(riskModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'risk-title');
      await expect(riskModal.locator('#risk-input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(riskModal).toBeHidden();
      await expect(reset).toBeFocused();
      await expect(modal).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(entry).toBeFocused();
  }

  const { entry: goalEntry, modal: goalModal } = await openTool({
    intent: 'openStudyGoal', modalId: 'study-goal-modal', closeId: 'sg-close', titleId: 'sg-modal-title'
  });
  await goalModal.locator('#sg-title').fill('N1 冲刺');
  await goalModal.locator('#sg-date').fill('2026-12-01');
  const submit = goalModal.locator('#sg-form button[type="submit"]');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(goalModal).toBeHidden();
  await expect(goalEntry).toBeFocused();
});

test('每日一练、排行榜、生词本、学习路径和社区统一弹窗体验', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', { dailyPractice: { items: [], completed_question_ids: [] } });
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'remaining_modals_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/leaderboard*', async (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') || 'week';
    if (period === 'month') await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ period, generated_at: '2026-07-19T00:00:00Z', items: [] })) });
  });
  await page.route('**/api/v1/vocab-notebook/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [] })) });
  });
  await page.route('**/api/v1/chapters*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [], count: 0 })) });
  });
  await page.route('**/api/v1/community/2023_02*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ posts: [] })) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const openTool = async ({ intent, modalId, closeId, titleId, synthetic = false }) => {
    let entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator(`[data-intent="${intent}"]`);
    if (synthetic) {
      const entryId = `remaining-modal-entry-${intent}`;
      await page.evaluate(({ intent, entryId }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = entryId;
        button.className = 'service-item';
        button.dataset.intent = intent;
        button.textContent = intent;
        document.querySelector('#pc-content')?.appendChild(button);
      }, { intent, entryId });
      entry = page.locator(`#${entryId}`);
    }
    await expect(entry).toBeVisible();
    await entry.click();
    const modal = page.locator(`#${modalId}`);
    const dialog = modal.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', titleId);
    await expect(modal.locator(`#${closeId}`)).toBeFocused();
    expect(await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth;
    })).toBeTruthy();
    return { entry, modal };
  };

  const cases = [
    { intent: 'openDailyPractice', modalId: 'daily-practice-modal', closeId: 'dp-close', titleId: 'dp-title' },
    { intent: 'openLeaderboard', modalId: 'leaderboard-modal', closeId: 'lb-close', titleId: 'lb-title', synthetic: true },
    { intent: 'openVocabNotebook', modalId: 'vocab-modal', closeId: 'vocab-close', titleId: 'vocab-title' },
    { intent: 'openChapterPath', modalId: 'chapter-modal', closeId: 'cp-close', titleId: 'cp-title' }
  ];
  for (const item of cases) {
    const { entry, modal } = await openTool(item);
    if (item.intent === 'openLeaderboard') {
      const month = modal.locator('#lb-month');
      await month.click();
      await expect(month).toBeDisabled();
      await expect(month).toHaveAttribute('aria-busy', 'true');
      await expect(month).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(entry).toBeFocused();
  }

  const communityEntry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator('[data-intent="openCommunity"]');
  await expect(communityEntry).toBeVisible();
  await communityEntry.click();
  const paperInputDialog = page.locator('.pc-confirm-dialog');
  await expect(paperInputDialog).toBeVisible();
  await paperInputDialog.locator('[data-pc-input]').fill('2023_02');
  await paperInputDialog.locator('[data-pc-input-ok]').click();
  const community = page.locator('#community-modal');
  await expect(community).toBeVisible();
  await expect(community.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'cm-title');
  await expect(community.locator('#cm-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(community).toBeHidden();
  await expect(communityEntry).toBeFocused();
});

test('超级管理员运营仪表盘支持键盘关闭和焦点归还', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
  await page.evaluate(() => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.id = 'admin-dashboard-e2e-entry';
    entry.className = 'service-item';
    entry.dataset.intent = 'openAdminDashboard';
    entry.textContent = '运营仪表盘';
    document.querySelector('#pc-content')?.appendChild(entry);
  });
  const entry = page.locator('#admin-dashboard-e2e-entry');
  await entry.click();
  const modal = page.locator('#admin-dashboard-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'ad-title');
  await expect(modal.locator('#ad-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(entry).toBeFocused();
});

test('学员我的内容支持最近学习和收藏子页面', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    recentLearning: [
      {
        exam_id: '2023_02', exam_title: 'EJU 2023年第2回 读解', status: 'draft',
        answered_count: 8, total_questions: 10, last_section_index: 1, last_question_index: 32,
        updated_at: '2026-07-17T08:00:00.000Z'
      },
      {
        exam_id: 'N2_2024_12', exam_title: 'JLPT N2 2024年12月 文字词汇', status: 'submitted',
        answered_count: 25, total_questions: 25, last_section_index: 0, last_question_index: 20,
        updated_at: '2026-07-16T08:00:00.000Z'
      }
    ],
    bookmarkFolders: [
      { folder_id: 'reading', name: '读解易错题' },
      { folder_id: 'listening', name: '听力表格题' }
    ],
    bookmarks: {
      questions: [
        { bookmark_id: 'bookmark-reading', exam_id: '2023_02', question_id: '29', question_no: '29', section_index: 1, folder_id: 'reading', reason: '段落主旨' },
        { bookmark_id: 'bookmark-listening', exam_id: '2023_02', question_id: '35', question_no: '35', section_index: 2, folder_id: 'listening', reason: '表格信息' }
      ]
    }
  });

  await page.locator('[data-dashboard-page="recent"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('最近学习');
  await expect(page.locator('.pc-subpage')).toContainText('EJU 2023年第2回 读解');
  await expect(page.locator('.pc-subpage .pc-lite-row').filter({ hasText: 'EJU 2023年第2回 读解' })).toHaveAttribute('data-intent', 'openExamQuestion:2023_02:33:1');
  await expect(page.locator('.pc-subpage .pc-lite-row').filter({ hasText: 'JLPT N2 2024年12月 文字词汇' })).toHaveAttribute('data-intent', 'openExamQuestion:N2_2024_12:21:0');
  await expect(page.locator('#pc-header-back')).toBeVisible();
  await page.locator('[data-dashboard-back]').click();
  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('收藏');

  await page.locator('[data-dashboard-page="favorites"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('收藏');
  await expect(page.locator('.pc-subpage')).toContainText('收藏题：读解易错题');
  await expect(page.locator('.pc-subpage [data-favorite-question-open]').filter({ hasText: '收藏题：读解易错题' }).first()).toHaveAttribute('data-question-id', '29');
  await expect(page.locator('.pc-subpage [data-favorite-question-open]').filter({ hasText: '收藏题：听力表格题' }).first()).toHaveAttribute('data-question-id', '35');
  await page.locator('#pc-header-back').click();
  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('最近学习');
});

test('每日一练重新生成期间阻止重复提交', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    dailyPractice: {
      date: '2026-07-17', target_count: 1, completed_question_ids: [],
      items: [{ exam_id: '2023_02', question_id: '29', source: 'wrong_question' }]
    }
  });
  let regenerateCalls = 0;
  await page.route('**/api/v1/me/daily-practice/regenerate', async (route) => {
    regenerateCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { items: [] } })
    });
  });

  await page.locator('[data-daily-action="open"]').click();
  await expect(page.locator('#daily-practice-modal')).toBeVisible();
  const regenerate = page.locator('#dp-regen');
  await regenerate.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(regenerate).toBeDisabled();
  await expect(regenerate).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => regenerateCalls).toBe(1);
  await expect(regenerate).toBeEnabled();
  expect(regenerateCalls).toBe(1);
});

test('我的账户作为首页同级卡片显示四个固定入口', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  const accountCard = page.locator('.pc-my-account-card');
  await expect(accountCard).toBeVisible();
  await expect(accountCard.locator('.pc-account-entry')).toHaveCount(4);
  await expect(accountCard.locator('[data-dashboard-page="account-core"]')).toContainText('账户');
  await expect(accountCard.locator('[data-dashboard-page="account-plan"]')).toContainText('套餐');
  await expect(accountCard.locator('[data-dashboard-page="account-coupons"]')).toContainText('卡券');
  await expect(accountCard.locator('[data-dashboard-page="account-feedback"]')).toContainText('反馈');
});

test('超级管理员个人首页只保留个人资料和账号安全', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');

  const accountCard = page.locator('.pc-my-account-card');
  await expect(accountCard.locator('.pc-account-entry')).toHaveCount(2);
	await expect(accountCard.locator('[data-intent="gotoProfile"]')).toContainText('个人资料');
	await expect(accountCard.locator('[data-dashboard-page="account-core"]')).toContainText('账号安全');
  await expect(accountCard.locator('[data-dashboard-page="account-plan"]')).toHaveCount(0);
  await expect(accountCard.locator('[data-dashboard-page="account-coupons"]')).toHaveCount(0);
	await expect(accountCard.locator('[data-dashboard-page="account-feedback"]')).toHaveCount(0);
	await expect(page.locator('#pc-header-overview')).toBeHidden();
});

test('超级管理员头像使用统一账号菜单并直接进入目标页面', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo');
	await page.locator('[data-action="pc-close"]').first().click();

	const trigger = page.locator('#user-menu-trigger');
	await expect(trigger).toHaveAttribute('aria-label', '打开账号菜单');
	await trigger.click();
	const menu = page.getByRole('menu', { name: '超级管理员账号菜单' });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem')).toHaveCount(5);
	await expect(menu).toContainText('进入平台管理');
	await expect(menu).toContainText('个人资料');
	await expect(menu).toContainText('账号安全');
	await expect(menu).toContainText('切换账号');
	await expect(menu.getByRole('button', { name: '关闭账号菜单', exact: true })).toBeVisible();
	const triggerBox = await trigger.boundingBox();
	const menuBox = await menu.boundingBox();
	expect(triggerBox).not.toBeNull();
	expect(menuBox).not.toBeNull();
	expect(menuBox.y).toBeLessThan(triggerBox.y + triggerBox.height);
	expect(menuBox.x).toBeLessThanOrEqual(triggerBox.x);
	const menuAvatarBox = await menu.locator('.pc-superadmin-account-summary > span').boundingBox();
	const menuAvatarImageBox = await menu.locator('.pc-superadmin-account-summary .pc-avatar-image').boundingBox();

	await menu.getByRole('menuitem', { name: /个人资料/ }).click();
	await expect(page.locator('#personal-center')).toHaveClass(/pc-open/);
	const panelBox = await page.locator('#personal-center .pc-panel').boundingBox();
	const detailAvatarBox = await page.locator('#personal-center .pc-avatar').boundingBox();
	const detailAvatarImageBox = await page.locator('#personal-center .pc-avatar-image').boundingBox();
	expect(panelBox).not.toBeNull();
	expect(menuAvatarBox).not.toBeNull();
	expect(menuAvatarImageBox).not.toBeNull();
	expect(detailAvatarBox).not.toBeNull();
	expect(detailAvatarImageBox).not.toBeNull();
	expect(Math.abs(menuBox.width - panelBox.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarBox.x - detailAvatarBox.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarBox.y - detailAvatarBox.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarBox.width - detailAvatarBox.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarImageBox.x - detailAvatarImageBox.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarImageBox.y - detailAvatarImageBox.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarImageBox.width - detailAvatarImageBox.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(menuAvatarImageBox.height - detailAvatarImageBox.height)).toBeLessThanOrEqual(1);
	await expect(page.locator('#pc-content')).toContainText('基础资料');
	await expect(page.locator('#pc-content')).toContainText('个人资料');
	await expect(page.locator('#pc-content')).not.toContainText('修改密码');
	await expect(page.locator('#pc-content')).not.toContainText('身份与套餐');
	await expect(page.locator('#pc-header-back')).toBeVisible();
	await page.locator('#pc-header-back').click();
	await expect(page.locator('#personal-center')).not.toHaveClass(/pc-open/);
	await expect(menu).toBeVisible();
	await expect(menu).not.toContainText('我的账户');
	await menu.getByRole('menuitem', { name: /个人资料/ }).click();
	await page.locator('[data-action="pc-close"]').first().click();

	await trigger.click();
	await menu.getByRole('menuitem', { name: /账号安全/ }).click();
	await expect(page.locator('#personal-center')).toHaveClass(/pc-open/);
	await expect(page.locator('#pc-content')).toContainText('管理手机号、密码、第三方绑定和注销账号');
	await expect(page.locator('#pc-content')).toContainText('账号安全');
	await expect(page.locator('#pc-content')).not.toContainText('账户数据');
	await expect(page.locator('#pc-content [data-dashboard-back]')).toHaveCount(0);
	await expect(page.locator('#pc-header-back')).toBeVisible();
});

test('账户安全表单提供字段错误并阻止重复提交', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  await page.evaluate(() => {
    const current = window.getUserContext?.() || {};
    window.setUserContext?.({ ...current, authenticationMethod: 'phone_code' });
  });
  let passwordCalls = 0;
  await page.route('**/api/v1/auth/password/change', async (route) => {
    passwordCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { changed: true } })
    });
  });

  await page.locator('[data-dashboard-page="account-core"]').click();
  await page.locator('[data-account-action="password"]').click();
  let form = page.locator('form[data-account-password-form]');
  const newPassword = form.locator('[data-account-new-password]');
  const confirmPassword = form.locator('[data-account-confirm-password]');
  await form.locator('button[type="submit"]').click();
  await expect(newPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('请输入新密码');

  await newPassword.fill('abc');
  await confirmPassword.fill('abc');
  await form.locator('button[type="submit"]').click();
  await expect(newPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('至少 8 位');

  await newPassword.fill('ValidPass123');
  await confirmPassword.fill('Different123');
  await form.locator('button[type="submit"]').click();
  await expect(confirmPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('两次输入');

  await confirmPassword.fill('ValidPass123');
  const submit = form.locator('button[type="submit"]');
  await submit.evaluate((button) => { button.click(); button.click(); });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => passwordCalls).toBe(1);
  await expect(page.locator('#pc-toast')).toContainText('密码已更新');

  await page.locator('[data-account-action="wechat"]').click();
  form = page.locator('form[data-account-wechat-form]');
  await form.locator('[data-account-wechat-code]').fill('');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-account-wechat-code]')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('请先完成微信授权');
});

test('账户安全展开内容与两侧保持 4px 间距', async ({ page }) => {
	await page.setViewportSize({ width: 430, height: 900 });
	await loginWithDevUser(page, 'superadmin_demo');
	await page.locator('[data-dashboard-page="account-core"]').click();

	for (const action of ['phone', 'sessions']) {
		await page.locator(`[data-account-action="${action}"]`).click();
		const editor = page.locator('.pc-account-editor').first();
		await expect(editor).toBeVisible({ timeout: 20000 });
		const layout = await editor.evaluate((element) => {
			const style = window.getComputedStyle(element);
			return {
				padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
				overflow: element.scrollWidth - element.clientWidth
			};
		});
		expect(layout.padding).toEqual(['4px', '4px', '4px', '4px']);
		expect(layout.overflow).toBeLessThanOrEqual(1);
		await page.locator(`[data-account-action="${action}"]`).click();
	}
});

test('平台角色模板单次保存并自动校验，临时授权仍需预览确认', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
  let templatePreviewCalls = 0;
  let templateUpdateCalls = 0;
  let accessPreviewCalls = 0;
  let accessUpdateCalls = 0;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'platform_access_e2e', ts: new Date().toISOString() });

  await page.route('**/api/v1/admin/role-templates?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok([
      { id: 'teacher', name: '老师', description: '测试模板', default_permissions: ['assignment.review'], organization_override_eligible: true, allow_organization_override: true, protected: false },
      { id: 'contentAdmin', name: '内容管理员', description: '平台内容角色', default_permissions: ['content.exam.edit'], organization_override_eligible: false, allow_organization_override: false, protected: false }
    ]))
  }));
  await page.route('**/api/v1/admin/role-templates/teacher/preview', async (route) => {
    templatePreviewCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ added: ['assignment.create'], removed: [], conflicts: [] })) });
  });
  await page.route('**/api/v1/admin/role-templates/teacher', (route) => {
    templateUpdateCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ updated: true })) });
  });
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok({ temporary_grants: [] }))
  }));
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access/preview', async (route) => {
    accessPreviewCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ before: { temporary_grants: [] }, after: { temporary_grants: [{}], conflicts: [] } })) });
  });
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access', (route) => {
    accessUpdateCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ updated: true })) });
  });

  await openPlatformAdminPage(page, '角色权限');
  const templateForm = page.locator('[data-platform-role-template-form][data-role-id="teacher"]');
  await expect(templateForm).toBeVisible({ timeout: 20000 });
  const contentAdminRole = page.locator('[data-platform-role-select="contentAdmin"]');
  await expect(contentAdminRole).toContainText('平台角色');
  await contentAdminRole.click();
  const contentAdminForm = page.locator('[data-platform-role-template-form][data-role-id="contentAdmin"]');
  await expect(contentAdminForm.locator('.pc-platform-role-policy')).toContainText('平台级角色');
  await expect(contentAdminForm.locator('.pc-platform-role-policy')).toContainText('不进入机构管理人员角色');
  await expect(contentAdminForm.locator('[data-role-org-override]')).toBeDisabled();
  await page.locator('[data-platform-role-select="teacher"]').click();
  await expect(templateForm).toBeVisible();
  const permissions = templateForm.locator('[data-role-permissions]');
	await expect(templateForm.locator('button[type="submit"]')).toBeDisabled();
	await templateForm.locator('[data-role-advanced-editor] > summary').click();
  await permissions.fill('');
	await expect(templateForm.locator('button[type="submit"]')).toHaveText('保存修改');
	await expect(templateForm.locator('[data-role-save-note]')).toContainText('未保存修改');
  await templateForm.locator('button[type="submit"]').click();
  await expect(permissions).toHaveAttribute('aria-invalid', 'true');
  await expect(templateForm.locator('.pc-field-error')).toContainText('不能为空');

	await permissions.fill('assignment.create');
	await expect(templateForm.locator('[data-role-selected-count]')).toContainText('移除 1');
	await expect(templateForm.locator('[data-role-permission-removals]')).toBeVisible();
	await expect(templateForm.locator('[data-role-permission-removals] .is-removed')).toContainText('批改作业');
	await expect(templateForm.locator('[data-role-permission-removals] .is-removed em')).toHaveText('待移除');

  await permissions.fill('assignment.review\nassignment.create');
	await expect(templateForm.locator('[data-role-current-title]')).toHaveText('修改后的权限');
	await expect(templateForm.locator('[data-role-selected-count]')).toContainText('新增 1');
	await expect(templateForm.locator('[data-role-permission-summary] .is-added')).toContainText('布置作业');
	await expect(templateForm.locator('[data-role-permission-summary] .is-added em')).toHaveText('新增');
  let templateSubmit = templateForm.locator('button[type="submit"]');
  await templateSubmit.evaluate((button) => { button.click(); button.click(); });
  await expect(templateSubmit).toBeDisabled();
  await expect(templateSubmit).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => templatePreviewCalls).toBe(1);
	const saveDialog = page.getByRole('alertdialog');
	await expect(saveDialog).toBeVisible();
	await expect(saveDialog.locator('.pc-confirm-message')).toContainText('新增 1 项，移除 0 项');
	await expect(templateForm.locator('[data-role-permission-summary] .is-added')).toContainText('布置作业');
  expect(templateUpdateCalls).toBe(0);
	await saveDialog.getByRole('button', { name: '取消' }).click();
	await expect(templateForm.locator('button[type="submit"]')).toBeEnabled();
	await expect(templateForm.locator('button[type="submit"]')).toHaveText('保存修改');

  await permissions.fill('assignment.review\nassignment.create\ngradebook.view');
	await expect(templateForm.locator('button[type="submit"]')).toHaveText('保存修改');
  await templateForm.locator('button[type="submit"]').click();
  await expect.poll(() => templatePreviewCalls).toBe(2);
  expect(templateUpdateCalls).toBe(0);
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.getByRole('alertdialog').getByRole('button', { name: '确认保存' }).click();
  await expect.poll(() => templateUpdateCalls).toBe(1);

  const accessForm = page.locator('[data-platform-user-access-form]');
	await page.locator('.pc-platform-access-panel > summary').click();
  await accessForm.locator('[data-platform-access-user-id]').fill('usr_access_e2e');
  await accessForm.locator('[data-platform-access-role]').selectOption('assistant');
  await accessForm.locator('[data-platform-access-expiry]').fill('2027-07-19T12:00');
  let accessSubmit = accessForm.locator('button[type="submit"]');
  await accessSubmit.click();
  await accessSubmit.evaluate((button) => button.click());
  await expect.poll(() => accessPreviewCalls).toBe(1);
  await expect(page.locator('[data-platform-access-diff]')).toBeVisible();
  expect(accessUpdateCalls).toBe(0);
  accessSubmit = accessForm.locator('button[type="submit"]');
  await accessSubmit.click();
  await expect.poll(() => accessUpdateCalls).toBe(1);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator('.pc-platform-role-selector')).toBeVisible();
	const mobileLayout = await page.locator('.pc-platform-admin-content').evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
		selectorDirection: getComputedStyle(element.querySelector('.pc-platform-role-selector')).flexDirection
	}));
	expect(mobileLayout.selectorDirection).toBe('row');
	expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
});

test('内容发布与回滚使用确认、顺序门禁和行内错误', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
  let publishCalls = 0;
  let rollbackCalls = 0;
  let inspectCalls = 0;
  let batchInspectCalls = 0;
	let openExamCalls = 0;
  let batchInspectBody = null;
  let publishBody = null;
  let rollbackBody = null;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'content_workflow_e2e', ts: new Date().toISOString() });
  const workflow = [{
    exam_id: 'workflow_e2e', status: 'secondary_approved',
    inspection: { passed: true, errors: [] },
    reviews: { analysis: { status: 'approved' }, secondary: { status: 'approved' } },
    versions: [{ id: 'ver_workflow_e2e', kind: 'published', created_at: '2026-07-19T10:00:00Z' }]
  }, {
    exam_id: 'workflow_pending_e2e', status: 'quality_failed',
    inspection: { passed: false, checked_at: '2026-07-19T10:00:00Z', errors: [{ code: 'QUESTION_TEXT_MISSING', path: '/sections/0/questions/0', message: '题干为空' }], warnings: [] }, reviews: {}, versions: []
  }];

  await page.route('**/api/v1/exams?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok([{ id: 'workflow_e2e', title: '内容工作流测试卷' }, { id: 'workflow_pending_e2e', title: '待质检测试卷' }]))
  }));
  await page.route('**/api/v1/admin/content/workflow?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok(workflow))
  }));
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/inspect', async (route) => {
    inspectCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 500, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: 'INSPECTION_FAILED', message: '图片资源检查失败' }) });
  });
	await page.route('**/api/v1/exams/workflow_e2e*', async (route) => {
		openExamCalls += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json; charset=utf-8',
			body: JSON.stringify(ok({ id: 'workflow_e2e', title: '内容工作流测试卷', exam_info: { sections: [] } }))
		});
	});
  await page.route('**/api/v1/admin/content/workflow/inspect-batch', async (route) => {
    batchInspectCalls += 1;
    batchInspectBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({ requested_count: 2, processed_count: 2, passed_count: 1, failed_count: 1, unavailable_count: 0, items: [] }))
    });
  });
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/publish', async (route) => {
    publishCalls += 1;
    publishBody = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ version_id: 'ver_new_e2e', status: 'published' })) });
  });
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/versions/ver_workflow_e2e/rollback', async (route) => {
    rollbackCalls += 1;
    rollbackBody = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ id: 'ver_rollback_e2e', kind: 'rollback' })) });
  });

	await openPlatformAdminPage(page, '内容工作流');
	await expect(page.locator('#platform-admin-shell')).toHaveClass(/pc-platform-content-active/);
  const row = page.locator('[data-content-workflow-row][data-exam-id="workflow_e2e"]');
  await expect(row).toBeVisible({ timeout: 20000 });
	await expect(row.locator('.pc-content-workflow-state')).toHaveCount(1);
	await expect(row.locator('.pc-content-workflow-meta')).toContainText('待发布');
	await expect(row.locator('.pc-content-workflow-meta')).not.toContainText('错误 0');
	const normalizedStyles = await page.locator('.pc-content-workflow-card').evaluate((card) => {
		const heading = card.querySelector('.pc-my-content-head');
		const rowElement = card.querySelector('.pc-content-workflow-row');
		const checkbox = card.querySelector('[data-content-workflow-select]');
		const action = card.querySelector('[data-content-workflow-action="open"]');
		return {
			headingAbsent: !heading,
			rowPaddingTop: getComputedStyle(rowElement).paddingTop,
			checkboxAccent: getComputedStyle(checkbox).accentColor,
			actionWidth: getComputedStyle(action).width,
			actionHeight: getComputedStyle(action).height,
			actionRadius: getComputedStyle(action).borderRadius,
			actionFontSize: getComputedStyle(action).fontSize,
			actionPaddingLeft: getComputedStyle(action).paddingLeft,
			actionPaddingRight: getComputedStyle(action).paddingRight
		};
	});
	expect(normalizedStyles).toMatchObject({
		headingAbsent: true,
		rowPaddingTop: '10px',
		checkboxAccent: 'rgb(255, 122, 47)',
		actionHeight: '32px',
		actionRadius: '16px',
		actionFontSize: '12px',
		actionPaddingLeft: '12px',
		actionPaddingRight: '12px'
	});
	expect(Number.parseFloat(normalizedStyles.actionWidth)).toBeLessThan(88);
	await expect(row.locator('[data-content-workflow-action="open"]')).toHaveText('查看');
	await expect(row.locator('.pc-content-workflow-actions > button')).toHaveCount(3);
	await expect(row.locator('[data-content-workflow-action="inspect"]')).toHaveText('检查');
	await expect(row.locator('.pc-content-workflow-more')).toHaveCount(0);
	await expect(page.locator('.pc-content-workflow-toolbar .pc-admin-note')).toHaveText('自动检查题目完整性与资源引用；检查、解析审核和复核通过后方可发布。');
	await expect(page.locator('.pc-content-workflow-select-all')).toContainText('全选本页（2）');
	const batchActionStyles = await page.locator('[data-content-workflow-batch-inspect]').evaluate((button) => ({
		height: getComputedStyle(button).height,
		fontSize: getComputedStyle(button).fontSize,
		whiteSpace: getComputedStyle(button).whiteSpace,
		backgroundColor: getComputedStyle(button).backgroundColor
	}));
	expect(batchActionStyles).toEqual({
		height: '32px',
		fontSize: '12px',
		whiteSpace: 'nowrap',
		backgroundColor: 'rgb(241, 239, 236)'
	});
	await page.setViewportSize({ width: 1100, height: 1100 });
	const wideCardLayout = await page.locator('.pc-content-workflow-card').evaluate((card) => {
		const main = card.querySelector('.pc-content-workflow-main');
		const actions = card.querySelector('.pc-content-workflow-actions');
		if (!(main instanceof HTMLElement) || !(actions instanceof HTMLElement)) return null;
		const cardRect = card.getBoundingClientRect();
		const mainRect = main.getBoundingClientRect();
		const actionRect = actions.getBoundingClientRect();
		return {
			cardIsWide: cardRect.width > 720,
			actionsRemainOnSameRow: Math.abs(actionRect.top - mainRect.top) <= 1,
			actionsInsideCard: actionRect.right <= cardRect.right + 1
		};
	});
	expect(wideCardLayout).toEqual({
		cardIsWide: true,
		actionsRemainOnSameRow: true,
		actionsInsideCard: true
	});
	await page.setViewportSize({ width: 1440, height: 1100 });
	const narrowCardLayout = await page.locator('.pc-content-workflow-card').evaluate(async (card) => {
		const rowElement = card.querySelector('.pc-content-workflow-row');
		const main = card.querySelector('.pc-content-workflow-main');
		const actions = card.querySelector('.pc-content-workflow-actions');
		if (!(rowElement instanceof HTMLElement) || !(main instanceof HTMLElement) || !(actions instanceof HTMLElement)) return null;
		card.style.width = '520px';
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		const cardRect = card.getBoundingClientRect();
		const mainRect = main.getBoundingClientRect();
		const actionRect = actions.getBoundingClientRect();
		const result = {
			actionsBelowContent: actionRect.top > mainRect.top,
			actionsInsideCard: actionRect.right <= cardRect.right + 1,
			actionsAlignedWithContent: Math.abs(actionRect.left - mainRect.left) <= 1
		};
		card.style.removeProperty('width');
		return result;
	});
	expect(narrowCardLayout).toEqual({
		actionsBelowContent: true,
		actionsInsideCard: true,
		actionsAlignedWithContent: true
	});
	const publish = row.locator('[data-content-workflow-action="publish"]');
  await expect(publish).toBeEnabled();
	const pendingRow = page.locator('[data-content-workflow-row][data-exam-id="workflow_pending_e2e"]');
	await expect(pendingRow.locator('.pc-content-workflow-inspection summary')).toContainText('1 个阻断问题');
	await pendingRow.locator('.pc-content-workflow-inspection summary').click();
	await expect(pendingRow.locator('.pc-content-workflow-inspection')).toContainText('题干为空');
	await expect(pendingRow.locator('.pc-content-workflow-meta')).toContainText('质检未通过');
	await expect(pendingRow.locator('.pc-content-workflow-meta')).toContainText('暂无版本');
	await expect(pendingRow.locator('[data-content-workflow-action="analysis"]')).toHaveCount(0);
	await expect(pendingRow.locator('[data-content-workflow-action="secondary"]')).toHaveCount(0);
	await expect(pendingRow.locator('[data-content-workflow-action="publish"]')).toHaveCount(0);
	await expect(pendingRow.locator('.pc-content-workflow-actions > button')).toHaveCount(2);
	await expect(pendingRow.locator('[data-content-workflow-action="inspect"]')).toHaveText('检查');

  await row.locator('[data-content-workflow-select]').check();
  await pendingRow.locator('[data-content-workflow-select]').check();
  const batchInspect = page.locator('[data-content-workflow-batch-inspect]');
	await expect(batchInspect).toContainText('批量检查（2）');
  await batchInspect.click();
  await expect.poll(() => batchInspectCalls).toBe(1);
  expect(batchInspectBody.exam_ids.sort()).toEqual(['workflow_e2e', 'workflow_pending_e2e'].sort());
  await expect(page.locator('[data-content-workflow-batch-message]')).toContainText('已检查 2 份：通过 1，发现阻断问题 1');

  await publish.click();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.pc-confirm-dialog')).toContainText('生成正式版本');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-cancel]').click();
  await expect(publish).toBeEnabled();
  await expect(publish).toBeFocused();
  expect(publishCalls).toBe(0);

  await publish.evaluate((button) => { button.click(); button.click(); });
  await expect(page.locator('.pc-confirm-dialog')).toHaveCount(1);
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect.poll(() => publishCalls).toBe(1);
  await expect(page.locator('#pc-toast')).toContainText('内容已发布并生成版本');
  expect(publishBody.confirmation).toBe('确认发布');

  const rollback = row.locator('[data-content-workflow-action="rollback"][data-version-id="ver_workflow_e2e"]');
  await rollback.click();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('历史快照覆盖');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect.poll(() => rollbackCalls).toBe(1);
  expect(rollbackBody.confirmation).toBe('确认回滚');
	await expect(row.locator('[data-content-workflow-action="inspect"]')).toBeDisabled();
	await expect(page.locator('#pc-toast')).toContainText('已回滚并生成新的版本记录');

	const inspect = row.locator('[data-content-workflow-action="inspect"]');
	await inspect.click();
  await expect(inspect).toBeDisabled();
  await expect.poll(() => inspectCalls).toBe(1);
  await expect(row.locator('[data-content-workflow-message]')).toContainText('图片资源检查失败');
  await expect(inspect).toBeEnabled();

	const openExam = row.locator('[data-content-workflow-action="open"]');
	await openExam.click();
	await expect(page.locator('.pc-confirm-dialog')).toContainText('隐藏平台管理页面并打开试卷');
	await page.locator('.pc-confirm-dialog [data-pc-confirm-cancel]').click();
	expect(openExamCalls).toBe(0);
	await expect(page.locator('#platform-admin-shell')).toBeVisible();
	await openExam.click();
	await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
	await expect.poll(() => openExamCalls).toBe(1);
	await expect(page.locator('#platform-admin-shell')).toBeHidden();
	await expect(page.locator('#pc-toast')).toContainText('已打开内容工作流试卷');
});

test('联系人验证和推荐码表单提供字段错误与重复提交保护', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  let sendCodeCalls = 0;
  await page.route('**/api/v1/auth/phone/send-code', async (route) => {
    sendCodeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { daily_remaining: 4 } })
    });
  });

	await page.locator('[data-dashboard-page="account-core"]').click();
	await page.locator('[data-intent="gotoProfile"]').click();
  await expect(page.locator('.pc-contact-verify-card')).toBeVisible();
  await page.locator('[data-contact-verify-toggle="phone"]').first().click();
  const phoneForm = page.locator('form[data-phone-verify-form]');
  const phoneInput = phoneForm.locator('[data-verify-phone]');
  const codeInput = phoneForm.locator('[data-verify-phone-code]');
  await phoneInput.fill('');
  await codeInput.fill('');
  await phoneForm.locator('button[type="submit"]').click();
  await expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
  await expect(phoneForm.locator('.pc-field-error')).toContainText('请输入手机号');

  await phoneInput.fill('13900001234');
  await phoneForm.locator('button[type="submit"]').click();
  await expect(codeInput).toHaveAttribute('aria-invalid', 'true');
  await expect(phoneForm.locator('.pc-field-error')).toContainText('请输入短信验证码');

  const sendButton = phoneForm.locator('[data-phone-send-code]');
  await sendButton.evaluate((button) => { button.click(); button.click(); });
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => sendCodeCalls).toBe(1);
  await expect(sendButton).toBeEnabled();
  await expect(page.locator('#pc-toast')).toContainText('手机验证码已发送');

  const referralForm = page.locator('form[data-referral-claim-form]');
  if (await referralForm.count()) {
    const referralInput = referralForm.locator('[data-referral-code]');
    await referralInput.fill('');
    await referralForm.locator('button[type="submit"]').click();
    await expect(referralInput).toHaveAttribute('aria-invalid', 'true');
    await expect(referralForm.locator('.pc-field-error')).toContainText('请输入推荐码');
  }
});

test('我的账户四个子页面都有返回和业务数据', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  await page.locator('[data-dashboard-page="account-core"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('账户');
  await expect(page.locator('.pc-subpage')).toContainText('修改密码');
  await expect(page.locator('.pc-subpage')).toContainText('数据导出');
  await page.locator('[data-dashboard-back]').click();
  await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');

  await page.locator('[data-dashboard-page="account-plan"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('套餐');
	await expect(page.locator('.pc-subpage')).toContainText('当前套餐');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('[data-dashboard-page="account-coupons"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('卡券');
	await expect(page.locator('.pc-subpage')).toContainText('列表来自钱包接口');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('[data-dashboard-page="account-feedback"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('反馈');
  await expect(page.locator('.pc-subpage')).toContainText('用户协议');
  await page.locator('#pc-header-back').click();
  await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');
});

test('反馈帮助子页入口可以打开详情并提交反馈', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  await page.locator('[data-dashboard-page="account-feedback"]').click();

  await page.locator('.pc-lite-row').filter({ hasText: '问题反馈' }).click();
  await expect(page.locator('.pc-subpage')).toContainText('提交反馈');
  await page.locator('[data-support-feedback-description]').fill('Playwright 反馈：解析表达需要复核');
  await page.locator('[data-support-feedback-form] button[type="submit"]').click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已提交');
  await page.locator('#pc-header-back').click();
  await page.locator('[data-dashboard-page="account-feedback"]').click();

  await page.locator('.pc-lite-row').filter({ hasText: '客服' }).click();
  await expect(page.locator('.pc-subpage')).toContainText('在线客服');
  await expect(page.locator('.pc-subpage')).toContainText('工作日 10:00-19:00');
});

test('账户相关子页列表保持左对齐', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  for (const pageName of ['account-plan', 'account-coupons', 'account-feedback']) {
    await page.locator(`[data-dashboard-page="${pageName}"]`).click();
    await expect(page.locator('.pc-lite-row').first()).toBeVisible();
    let styles = [];
    await expect.poll(async () => {
      styles = await page.locator('.pc-lite-row').evaluateAll((rows) => {
        return rows.map((row) => {
          const rowStyle = window.getComputedStyle(row);
          const strong = row.querySelector('strong');
          const strongStyle = strong ? window.getComputedStyle(strong) : null;
          return {
            display: rowStyle.display,
            flexDirection: rowStyle.flexDirection,
            justifyContent: rowStyle.justifyContent,
            textAlign: rowStyle.textAlign,
            strongTextAlign: strongStyle?.textAlign || ''
          };
        });
      });
      return styles.length > 0 && styles.every((style) => style.display === 'flex');
    }).toBe(true);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style.display).toBe('flex');
      expect(style.flexDirection).toBe('row');
      expect(style.justifyContent).toBe('space-between');
      expect(style.textAlign).toBe('left');
      expect(style.strongTextAlign).toBe('left');
    }
    await page.locator('[data-dashboard-back]').click();
  }

  await page.locator('[data-dashboard-page="account-core"]').click();
  const phoneAlign = await page.locator('.pc-account-phone').evaluate((el) => window.getComputedStyle(el).textAlign);
  expect(phoneAlign).toBe('left');
});

test('窄面板中的系统功能开关不会把标题挤成竖排', async ({ page }) => {
  await page.setViewportSize({ width: 842, height: 900 });
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });

	await openPlatformAdminPage(page, '功能开关');
	await page.locator('[data-platform-flag-group="management"] > summary').click();
  const flagRow = page.locator('[data-platform-system-flag-row="admin_dashboard"]');
  await expect(flagRow).toContainText('管理员仪表盘', { timeout: 20000 });

  const layout = await flagRow.evaluate((row) => {
    const content = row.querySelector(':scope > .pc-platform-flag-copy');
    const title = content?.querySelector('strong');
		const actions = row.querySelector(':scope > .pc-platform-flag-edit');
		const panel = document.querySelector('#platform-admin-shell .pc-platform-workspace');
    const contentBox = content?.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    const actionsBox = actions?.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const titleLineHeight = title ? Number.parseFloat(window.getComputedStyle(title).lineHeight) : 0;
		const personalCenter = document.querySelector('#platform-admin-shell');
    return {
      rowWidth: rowBox.width,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
      contentWidth: contentBox?.width ?? 0,
      titleHeight: titleBox?.height ?? 0,
      titleLineHeight,
      actionsLeft: actionsBox?.left ?? 0,
      actionsRight: actionsBox?.right ?? 0,
      rowLeft: rowBox.left,
      rowRight: rowBox.right,
      centerScrollWidth: personalCenter?.scrollWidth ?? 0,
      centerClientWidth: personalCenter?.clientWidth ?? 0
    };
  });

  expect(layout.panelWidth).toBeGreaterThanOrEqual(700);
  expect(layout.contentWidth).toBeGreaterThanOrEqual(Math.min(260, layout.rowWidth - 2));
  expect(layout.titleHeight).toBeLessThanOrEqual(layout.titleLineHeight * 1.5);
  expect(layout.actionsLeft).toBeGreaterThanOrEqual(layout.rowLeft - 1);
  expect(layout.actionsRight).toBeLessThanOrEqual(layout.rowRight + 1);
  expect(layout.centerScrollWidth).toBeLessThanOrEqual(layout.centerClientWidth + 1);
});

test('平台功能开关按钮在后台上方显示高风险确认', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page, '功能开关');
	const shell = page.locator('#platform-admin-shell');
	await shell.locator('[data-platform-flag-group="learning"] > summary').click();
	const flagRow = shell.locator('[data-platform-system-flag-row]').first();
	await expect(flagRow).toBeVisible({ timeout: 20000 });

	await flagRow.locator('[data-platform-system-flag-edit]').click();
	const editor = page.locator('.pc-platform-flag-editor-overlay');
	await expect(editor).toBeVisible();
	await expect(editor.getByText('功能状态', { exact: true })).toBeVisible();
	await expect(editor.getByText('管理方式', { exact: true })).toBeVisible();
	await editor.getByRole('button', { name: '保存设置', exact: true }).click();
	const riskModal = page.locator('#risk-modal');
	await expect(riskModal).toBeVisible();
	await expect(riskModal.locator('#risk-input')).toBeFocused();
	const layers = await page.evaluate(() => ({
		shell: Number.parseInt(window.getComputedStyle(document.querySelector('#platform-admin-shell')).zIndex || '0', 10),
		risk: Number.parseInt(window.getComputedStyle(document.querySelector('#risk-modal')).zIndex || '0', 10)
	}));
	expect(layers.risk).toBeGreaterThan(layers.shell);
	await riskModal.getByRole('button', { name: '取消', exact: true }).click();
	await expect(riskModal).toBeHidden();

	await flagRow.locator('[data-platform-system-flag-edit]').click();
	const defaultButton = editor.locator('[data-platform-flag-use-default]');
	if (await defaultButton.count()) {
		await defaultButton.click();
		await expect(riskModal).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(riskModal).toBeHidden();
	} else {
		await editor.locator('[data-platform-flag-editor-close]').first().click();
	}
});

test('教学与管理角色显示对应简约工作台入口', async ({ page }) => {
  const cases = [
    { loginId: 'teacher_demo', removedFocus: '今日教学', removedTitle: '教学工作台', entries: ['我的学生', '学习组', '课程表', '安排课程', '待批改', '布置作业', '成绩册', '备课'], open: '我的学生', subpageText: /student_demo|暂无真实数据/ },
    { loginId: 'assistant_demo', removedFocus: '今日运营', removedTitle: '运营工作台', entries: ['催交作业', '学员跟进', '续费风险', '异常提醒', '学习组', '课程表', '课程包', '安排课程'], open: '催交作业', pageTitle: '作业', subpageText: /5 人未提交|暂无真实数据/ },
    { loginId: 'orgadmin_demo', removedFocus: '今日管理', removedTitle: '机构工作台', entries: ['成员管理', '权限管理', '机构设置', '学习组', '课程包', '机构看板'], open: '成员管理', subpageText: /成员管理|还没有可管理机构|正在读取机构数据/ },
    { loginId: 'contentadmin_demo', removedFocus: '今日内容', removedTitle: '内容工作台', entries: ['内容反馈', '发布工作流', '内容日志'], open: '内容反馈', subpageText: '列表来自反馈接口' }
  ];

  for (const item of cases) {
    await loginWithDevUser(page, item.loginId);
    await expect(page.locator('.pc-role-workbench-card')).toHaveCount(0);
    await expect(page.locator('.pc-role-home-strip')).toContainText('个人信息与账户设置');
    await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');
    const homeLayout = await page.locator('#pc-content').evaluate((content) => ({ clientHeight: content.clientHeight, scrollHeight: content.scrollHeight }));
    expect(homeLayout.scrollHeight).toBeLessThanOrEqual(homeLayout.clientHeight + 1);

    await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
    const adminCard = page.locator('.pc-admin-shortcuts');
    await expect(adminCard.locator('.pc-workbench-action .svc-title')).toHaveText(item.entries);
    const actionStyles = await adminCard.locator('.pc-workbench-action').evaluateAll((buttons) => {
      return buttons.map((button) => {
        const buttonStyle = window.getComputedStyle(button);
        const title = button.querySelector('.svc-title');
        const titleStyle = title ? window.getComputedStyle(title) : null;
        return {
          display: buttonStyle.display,
          flexDirection: buttonStyle.flexDirection,
          alignItems: buttonStyle.alignItems,
          textAlign: buttonStyle.textAlign,
          titleTextAlign: titleStyle?.textAlign || ''
        };
      });
    });
    for (const style of actionStyles) {
      expect(style.display).toBe('flex');
      expect(style.flexDirection).toBe('row');
      expect(style.alignItems).toBe('center');
      expect(style.textAlign).toBe('left');
      expect(style.titleTextAlign).toBe('left');
    }

    await adminCard.locator('.pc-workbench-action').filter({ hasText: item.open }).click();
    await expect(page.locator('.pc-subpage')).toContainText(item.pageTitle || item.open);
    await expect(page.locator('.pc-subpage')).toContainText(item.subpageText);
    await expect(page.locator('.pc-subpage')).not.toContainText('管理面板');
    await page.locator('[data-dashboard-back]').click();
    await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
    await expect(adminCard.locator('.pc-workbench-action .svc-title')).toHaveText(item.entries);
    await expect(page.locator('#pc-institution-workbench')).toHaveCount(0);

    await clearBrowserSession(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
});

test('订单与支付页面使用统一的紧凑间距和控件尺寸', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page, '订单与支付');
	const shell = page.locator('#platform-admin-shell');
	await expect(shell.locator('[data-platform-payment-tab="orders"]')).toBeVisible({ timeout: 20000 });
	const paymentStyle = await shell.locator('.pc-platform-payment-overview').evaluate((overview) => {
		const listCard = overview.parentElement?.querySelector('.pc-platform-payment-list-card');
		const tab = overview.querySelector('.pc-platform-payment-tab');
		const tabCount = tab?.querySelector('strong');
		const tabItems = Array.from(overview.querySelectorAll('.pc-platform-payment-tab'));
		const search = overview.querySelector('.pc-platform-payment-search');
		const searchInput = search?.querySelector('[data-platform-payment-query]');
		const searchActions = search?.querySelector('.pc-platform-payment-search-actions');
		const searchButton = search?.querySelector('button[type="submit"]');
		const advanced = overview.querySelector('.pc-platform-payment-advanced');
		const thirdTabBox = tabItems[2]?.getBoundingClientRect();
		const fourthTabBox = tabItems[3]?.getBoundingClientRect();
		const searchInputBox = searchInput?.getBoundingClientRect();
		const searchActionsBox = searchActions?.getBoundingClientRect();
		return {
			overviewDisplay: getComputedStyle(overview).display,
			overviewGap: getComputedStyle(overview).gap,
			overviewPadding: getComputedStyle(overview).padding,
			listGap: listCard ? getComputedStyle(listCard).gap : '',
			listPadding: listCard ? getComputedStyle(listCard).padding : '',
			tabHeight: tab ? getComputedStyle(tab).minHeight : '',
			tabFontSize: tab ? getComputedStyle(tab).fontSize : '',
			tabCountFontSize: tabCount ? getComputedStyle(tabCount).fontSize : '',
			searchGap: search ? getComputedStyle(search).gap : '',
			searchMarginTop: search ? getComputedStyle(search).marginTop : '',
			searchButtonHeight: searchButton ? getComputedStyle(searchButton).height : '',
			searchButtonWidth: searchButton ? searchButton.getBoundingClientRect().width : 0,
			advancedMarginTop: advanced ? getComputedStyle(advanced).marginTop : '',
			alignmentDeltas: [
				Math.abs((thirdTabBox?.right || 0) - (searchInputBox?.right || 0)),
				Math.abs((fourthTabBox?.left || 0) - (searchActionsBox?.left || 0)),
				Math.abs((fourthTabBox?.right || 0) - (searchActionsBox?.right || 0))
			]
		};
	});
	const { alignmentDeltas, searchButtonWidth, ...basePaymentStyle } = paymentStyle;
	expect(basePaymentStyle).toEqual({
		overviewDisplay: 'grid',
		overviewGap: '4px',
		overviewPadding: '6px',
		listGap: '4px',
		listPadding: '6px',
		tabHeight: '52px',
		tabFontSize: '14px',
		tabCountFontSize: '18px',
		searchGap: '4px',
		searchMarginTop: '0px',
		searchButtonHeight: '44px',
		advancedMarginTop: '0px'
	});
	expect(searchButtonWidth).toBeGreaterThanOrEqual(96);
	expect(alignmentDeltas.every((delta) => delta <= 1)).toBeTruthy();
});

test('订单详情展示购买主体并按用户 ID 加载真实资料', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page, '订单与支付');
	const shell = page.locator('#platform-admin-shell');
	const orderRows = shell.locator('.pc-platform-payment-row');
	const personalOrder = orderRows.filter({ hasText: '个人订阅' }).first();
	await expect(personalOrder).toBeVisible({ timeout: 20000 });
	await expect(shell.getByRole('button', { name: '用户', exact: true })).toHaveCount(0);
	await expect(shell.getByRole('button', { name: '详情', exact: true })).toHaveCount(0);
	const orderTitleLink = personalOrder.locator('[data-platform-payment-order-link]');
	await expect(orderTitleLink).toHaveAccessibleName(/查看订单：个人订阅/);
	await orderTitleLink.click();
	const partyCard = shell.locator('.pc-platform-payment-party-card');
	await expect(partyCard).toContainText('购买主体');
	await expect(shell.locator('.pc-platform-admin-content')).toContainText('本订单退款记录');
	await expect(shell.locator('.pc-platform-admin-content')).toContainText('本订单资金与权益流水');
	const userRequest = page.waitForResponse((response) => response.url().includes('/api/v1/users/') && response.request().method() === 'GET');
	await partyCard.getByRole('button', { name: '查看用户', exact: true }).click();
	expect((await userRequest).ok()).toBeTruthy();
	await expect(shell.locator('.pc-platform-admin-content')).toContainText('账号状态', { timeout: 20000 });
	await expect(shell.locator('.pc-platform-admin-content')).toContainText('角色');
	await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('正在加载用户资料');
});

test('功能开关和审计日志页面使用统一的系统管理式样', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page, '功能开关');
	const shell = page.locator('#platform-admin-shell');
	const flagsCard = shell.locator('.pc-platform-flags-card');
	await expect(flagsCard.locator('[data-platform-flag-group]').first()).toBeVisible({ timeout: 20000 });
	const flagStyle = await flagsCard.evaluate((card) => {
		const shellElement = document.querySelector('#platform-admin-shell');
		const pageTitle = shellElement?.querySelector('.pc-platform-topbar h1');
		const toolbar = card.querySelector('.pc-platform-flag-toolbar');
		const input = toolbar?.querySelector('.pc-profile-input');
		const groups = card.querySelector('.pc-platform-flag-groups');
		const summary = groups?.querySelector('.pc-platform-flag-group > summary');
		return {
			activeClass: shellElement?.classList.contains('pc-platform-flags-active') || false,
			titleFontSize: pageTitle ? getComputedStyle(pageTitle).fontSize : '',
			cardGap: getComputedStyle(card).gap,
			cardPadding: getComputedStyle(card).padding,
			toolbarGap: toolbar ? getComputedStyle(toolbar).gap : '',
			inputMinHeight: input ? getComputedStyle(input).minHeight : '',
			groupsGap: groups ? getComputedStyle(groups).gap : '',
			summaryMinHeight: summary ? getComputedStyle(summary).minHeight : '',
			summaryPadding: summary ? getComputedStyle(summary).padding : ''
		};
	});
	expect(flagStyle).toEqual({
		activeClass: true,
		titleFontSize: '18px',
		cardGap: '4px',
		cardPadding: '6px',
		toolbarGap: '4px',
		inputMinHeight: '44px',
		groupsGap: '4px',
		summaryMinHeight: '44px',
		summaryPadding: '8px 10px'
	});

	await openPlatformAdminPage(page, '审计日志');
	const auditPage = shell.locator('[data-audit-log-surface="embedded"]');
	await expect(auditPage).toBeVisible({ timeout: 20000 });
	await expect(auditPage.locator('#al-body')).not.toContainText('加载中', { timeout: 20000 });
	const auditStyle = await auditPage.evaluate((surface) => {
		const shellElement = document.querySelector('#platform-admin-shell');
		const pageTitle = shellElement?.querySelector('.pc-platform-topbar h1');
		const head = surface.querySelector('.pc-audit-page-head');
		const filters = surface.querySelector('.pc-audit-filters');
		const filterInput = filters?.querySelector('input, select');
		const primary = surface.querySelector('.pc-audit-primary');
		const exportButton = surface.querySelector('.pc-audit-export');
		const tableRegion = surface.querySelector('.pc-responsive-table-region');
		return {
			activeClass: shellElement?.classList.contains('pc-platform-audit-active') || false,
			titleFontSize: pageTitle ? getComputedStyle(pageTitle).fontSize : '',
			pageDisplay: getComputedStyle(surface).display,
			pageGap: getComputedStyle(surface).gap,
			pagePadding: getComputedStyle(surface).padding,
			headMarginBottom: head ? getComputedStyle(head).marginBottom : '',
			filterGap: filters ? getComputedStyle(filters).gap : '',
			filterPadding: filters ? getComputedStyle(filters).padding : '',
			filterInputHeight: filterInput ? getComputedStyle(filterInput).height : '',
			primaryHeight: primary ? getComputedStyle(primary).height : '',
			primaryBackground: primary ? getComputedStyle(primary).backgroundColor : '',
			exportHeight: exportButton ? getComputedStyle(exportButton).height : '',
			tableRadius: tableRegion ? getComputedStyle(tableRegion).borderRadius : ''
		};
	});
	expect(auditStyle).toEqual({
		activeClass: true,
		titleFontSize: '18px',
		pageDisplay: 'grid',
		pageGap: '4px',
		pagePadding: '6px',
		headMarginBottom: '0px',
		filterGap: '4px',
		filterPadding: '6px',
		filterInputHeight: '44px',
		primaryHeight: '44px',
		primaryBackground: 'rgb(31, 25, 20)',
		exportHeight: '32px',
		tableRadius: '8px'
	});
});

test('平台后台全部一级页面遵循统一式样且窄屏不产生页面级溢出', async ({ page }) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 1440, height: 1100 });
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	const shell = page.locator('#platform-admin-shell');
	const pages = [
		{ name: '总览', title: '平台总览', surface: '.pc-platform-stat' },
		{ name: '用户管理', title: '用户管理', surface: '.pc-lite-list-card:has([data-platform-user-search-form])' },
		{ name: '角色权限', title: '角色权限', surface: '.pc-platform-role-selector' },
		{ name: '机构管理', title: '机构管理', surface: '.pc-managed-org-toolbar' },
		{ name: '内容工作流', title: '内容工作流', surface: '.pc-content-workflow-card' },
		{ name: '反馈处理', title: '反馈处理', surface: '.pc-lite-list-card:has([data-platform-feedback-search-form])' },
		{ name: '订单与支付', title: '订单与支付', surface: '.pc-platform-payment-overview' },
		{ name: '价格与套餐', title: '价格与套餐', surface: '.pc-card[data-pricing-plan-panel="personal"]' },
		{ name: '功能开关', title: '功能开关', surface: '.pc-platform-flags-card' },
		{ name: '审计日志', title: '审计日志', surface: '.pc-audit-page' }
	];

	for (const item of pages) {
		await openPlatformAdminPage(page, item.name);
		const surface = shell.locator(item.surface).first();
		await expect(surface).toBeVisible({ timeout: 20000 });
		const style = await surface.evaluate((element, expectedTitle) => {
			const shellElement = document.querySelector('#platform-admin-shell');
			const content = shellElement?.querySelector('.pc-platform-admin-content');
			const pageRoot = element.closest('.pc-platform-overview-grid, .pc-subpage') || element;
			const title = shellElement?.querySelector('.pc-platform-topbar h1');
			const subtitle = shellElement?.querySelector('.pc-platform-topbar p');
			const duplicatedTitles = content ? Array.from(content.querySelectorAll('.pc-my-content-head, .pc-audit-page-head h2'))
				.filter((node) => {
					const box = node.getBoundingClientRect();
					return box.width > 0 && box.height > 0 && (node.textContent || '').trim() === expectedTitle;
				}).length : -1;
			const sectionTitleSizes = content ? Array.from(content.querySelectorAll('.pc-my-content-head, .pc-service-header'))
				.filter((node) => {
					const box = node.getBoundingClientRect();
					return box.width > 0 && box.height > 0;
				})
				.map((node) => getComputedStyle(node).fontSize) : [];
			const standardControlHeights = Array.from(element.querySelectorAll('.pc-profile-input'))
				.filter((node) => {
					const box = node.getBoundingClientRect();
					return box.width > 0 && box.height > 0;
				})
				.map((node) => node.getBoundingClientRect().height);
			return {
				titleText: title?.textContent?.trim() || '',
				titleFontSize: title ? getComputedStyle(title).fontSize : '',
				titleLineHeight: title ? getComputedStyle(title).lineHeight : '',
				subtitleFontSize: subtitle ? getComputedStyle(subtitle).fontSize : '',
				subtitleLineHeight: subtitle ? getComputedStyle(subtitle).lineHeight : '',
				contentPadding: content ? getComputedStyle(content).padding : '',
				pageGap: pageRoot ? getComputedStyle(pageRoot).gap : '',
				surfacePadding: getComputedStyle(element).padding,
				surfaceRadius: getComputedStyle(element).borderRadius,
				surfaceShadow: getComputedStyle(element).boxShadow,
				duplicatedTitles,
				sectionTitleSizes,
				standardControlHeights
			};
		}, item.title);
		expect(style.titleText).toBe(item.title);
		expect(style.titleFontSize).toBe('18px');
		expect(style.titleLineHeight).toBe('24px');
		expect(style.subtitleFontSize).toBe('12px');
		expect(style.subtitleLineHeight).toBe('18px');
		expect(style.contentPadding).toBe('4px');
		expect(style.pageGap, `${item.name} 页面根间距`).toBe('4px');
		expect(style.surfacePadding).toBe('6px');
		expect(style.surfaceRadius).toBe('8px');
		expect(style.surfaceShadow).toBe('none');
		expect(style.duplicatedTitles).toBe(0);
		expect(style.sectionTitleSizes.every((size) => size === '14px')).toBeTruthy();
		expect(style.standardControlHeights.every((height) => height >= 43.5)).toBeTruthy();
	}

	await page.setViewportSize({ width: 500, height: 900 });
	for (const item of pages) {
		await openPlatformAdminPage(page, item.name);
		await expect(shell.locator(item.surface).first()).toBeVisible({ timeout: 20000 });
		const overflow = await shell.locator('.pc-platform-admin-content').evaluate((content) => ({
			clientWidth: content.clientWidth,
			scrollWidth: content.scrollWidth
		}));
		expect(overflow.scrollWidth, `${item.name} 不应撑宽后台内容区`).toBeLessThanOrEqual(overflow.clientWidth + 1);
	}
});

test('超级管理员使用独立全屏后台并连接真实管理页面', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
  await expect(page.locator('button.pc-nav-item', { hasText: '管理' })).toHaveCount(0);
  await openPlatformAdminPage(page);

  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();
	await expect(shell.locator('.pc-platform-sidebar')).toContainText('用户权限');
  await expect(shell.locator('.pc-platform-sidebar')).toContainText('机构');
  await expect(shell.locator('.pc-platform-sidebar')).toContainText('内容');
  await expect(shell.locator('.pc-platform-sidebar')).toContainText('交易');
  await expect(shell.locator('.pc-platform-sidebar')).toContainText('系统');
  await expect(shell.locator('.pc-platform-stat')).toHaveCount(4);
	await expect(shell.locator('.pc-platform-admin-avatar .pc-avatar-image')).toBeVisible();
	const visualStyle = await shell.evaluate((element) => {
		const sidebar = element.querySelector('.pc-platform-sidebar');
		const content = element.querySelector('.pc-platform-admin-content');
		const card = element.querySelector('.pc-platform-stat');
		return {
			sidebarBackground: sidebar ? window.getComputedStyle(sidebar).backgroundColor : '',
			contentBackground: content ? window.getComputedStyle(content).backgroundColor : '',
			cardRadius: card ? Number.parseFloat(window.getComputedStyle(card).borderRadius) : 0
		};
	});
	expect(visualStyle.sidebarBackground).toBe('rgb(255, 255, 255)');
	expect(visualStyle.contentBackground).toBe('rgb(248, 246, 243)');
	expect(visualStyle.cardRadius).toBe(8);

  await shell.getByRole('button', { name: '用户管理', exact: true }).click();
  await expect(shell.locator('[data-platform-user-search-form]')).toBeVisible();
	const firstUser = shell.locator('.pc-lite-list button.pc-lite-row').first();
	await expect(firstUser).toBeVisible({ timeout: 20000 });
	await firstUser.click();
	await expect(shell.getByRole('button', { name: '返回用户列表', exact: true })).toBeVisible();
	await expect(shell.locator('[data-platform-user-search-form]')).toHaveCount(0);
	await shell.getByRole('button', { name: '返回用户列表', exact: true }).click();
	await expect(shell.locator('[data-platform-user-search-form]')).toBeVisible();
	await expect(shell.getByRole('button', { name: '返回用户列表', exact: true })).toHaveCount(0);
  await shell.getByRole('button', { name: '机构管理', exact: true }).click();
  await expect(shell.locator('[data-managed-org-list-form]')).toBeVisible({ timeout: 20000 });
	await shell.getByRole('button', { name: '订单与支付', exact: true }).click();
	await expect(shell.locator('[data-platform-payment-tab="orders"]')).toBeVisible({ timeout: 20000 });
	await expect(shell.getByRole('button', { name: '价格配置', exact: true })).toHaveCount(0);
	await expect(shell.getByRole('button', { name: '创建机构订单', exact: true })).toHaveCount(0);
	await expect(shell.getByRole('button', { name: '发起退款', exact: true })).toHaveCount(0);
	await shell.getByRole('button', { name: '价格与套餐', exact: true }).click();
	await expect(shell.locator('[data-pricing-form]')).toBeVisible({ timeout: 20000 });
	await shell.getByRole('button', { name: '订单与支付', exact: true }).click();
	await expect(shell.locator('[data-platform-payment-tab="orders"]')).toBeVisible({ timeout: 20000 });

  await shell.getByRole('button', { name: '个人资料', exact: true }).first().click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#personal-center')).toHaveClass(/pc-open/);
});

test('平台审计日志直接嵌入后台且详情显示在后台之上', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page, '审计日志');
	const shell = page.locator('#platform-admin-shell');
	const auditPage = shell.locator('[data-audit-log-surface="embedded"]');
	await expect(auditPage).toBeVisible({ timeout: 20000 });
	await expect(page.locator('#audit-log-modal')).toHaveCount(0);
	await expect(auditPage.locator('#al-body')).not.toContainText('加载中', { timeout: 20000 });
	const table = auditPage.locator('.pc-audit-table');
	await expect(table).toBeVisible();
	const auditLayout = await table.evaluate((element) => {
		const cells = Array.from(element.querySelectorAll('tbody tr:first-child td')).map((cell) => ({
			width: cell.getBoundingClientRect().width,
			whiteSpace: window.getComputedStyle(cell).whiteSpace,
			text: (cell.textContent || '').trim()
		}));
		const region = element.closest('.pc-responsive-table-region');
		return { cells, tableWidth: element.getBoundingClientRect().width, regionWidth: region?.getBoundingClientRect().width || 0 };
	});
	expect(auditLayout.cells).toHaveLength(6);
	expect(auditLayout.cells[4].width).toBeGreaterThanOrEqual(140);
	expect(auditLayout.cells[5].width).toBeGreaterThanOrEqual(88);
	expect(auditLayout.cells[5].whiteSpace).toBe('nowrap');
	expect(auditLayout.cells[5].text).toContain('查看详情');
	const firstDetail = auditPage.locator('button[data-audit-detail]').first();
	if (await firstDetail.count()) {
		await firstDetail.click();
		const detailModal = page.locator('#audit-detail-modal');
		await expect(detailModal).toBeVisible();
		const layers = await page.evaluate(() => ({
			shell: Number.parseInt(window.getComputedStyle(document.querySelector('#platform-admin-shell')).zIndex || '0', 10),
			detail: Number.parseInt(window.getComputedStyle(document.querySelector('#audit-detail-modal')).zIndex || '0', 10)
		}));
		expect(layers.detail).toBeGreaterThan(layers.shell);
		await page.keyboard.press('Escape');
		await expect(detailModal).toBeHidden();
		await expect(auditPage).toBeVisible();
	}
});

test('平台管理各一级页面均在当前后台内正常打开', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	await openPlatformAdminPage(page);
	const shell = page.locator('#platform-admin-shell');
	const pages = [
		{ nav: '用户管理', selector: '[data-platform-user-search-form]' },
		{ nav: '角色权限', text: '成员临时授权' },
		{ nav: '机构管理', selector: '[data-managed-org-list-form]' },
		{ nav: '内容工作流', text: '发布队列' },
		{ nav: '反馈处理', selector: '[data-platform-feedback-search-form]' },
		{ nav: '订单与支付', selector: '[data-platform-payment-tab="orders"]' },
		{ nav: '价格与套餐', selector: '[data-pricing-form]' },
		{ nav: '功能开关', text: '功能开关' },
		{ nav: '审计日志', selector: '[data-audit-log-surface="embedded"]' }
	];
	for (const item of pages) {
		await shell.getByRole('button', { name: item.nav, exact: true }).click();
		if (item.selector) await expect(shell.locator(item.selector)).toBeVisible({ timeout: 20000 });
		if (item.text) await expect(shell.locator('.pc-platform-admin-content')).toContainText(item.text, { timeout: 20000 });
		await expect(shell).toBeVisible();
		await expect(page.locator('#personal-center.pc-open')).toHaveCount(0);
		const detailGaps = await shell.locator('.pc-platform-admin-content').evaluate((content) => Array.from(content.querySelectorAll('.pc-dashboard, .pc-profile-stack, .pc-subpage'))
			.filter((element) => {
				const style = window.getComputedStyle(element);
				const box = element.getBoundingClientRect();
				return style.display !== 'none' && box.width > 0 && box.height > 0 && (style.display === 'flex' || style.display === 'grid');
			})
			.map((element) => window.getComputedStyle(element).gap));
		expect(detailGaps.every((gap) => gap === '4px')).toBeTruthy();
	}

	await page.setViewportSize({ width: 430, height: 900 });
	for (const item of pages) {
		await shell.getByRole('button', { name: item.nav, exact: true }).click();
		await expect(shell).toBeVisible();
		const overflow = await shell.locator('.pc-platform-admin-content').evaluate((element) => element.scrollWidth - element.clientWidth);
		expect(overflow).toBeLessThanOrEqual(1);
	}
});

test('平台后台在 PC、Pad 和手机端自适应并可切换全屏', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
  await openPlatformAdminPage(page);
  const shell = page.locator('#platform-admin-shell');
	const contentPadding = await shell.locator('.pc-platform-admin-content').evaluate((element) => {
		const style = window.getComputedStyle(element);
		return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
	});
	expect(contentPadding).toEqual(['4px', '4px', '4px', '4px']);
	const overviewGaps = await shell.evaluate((element) => ({
		overview: window.getComputedStyle(element.querySelector('.pc-platform-overview-grid')).gap,
		stats: window.getComputedStyle(element.querySelector('.pc-platform-stats')).gap
	}));
	expect(overviewGaps).toEqual({ overview: '4px', stats: '4px' });

  let layout = await shell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const sidebar = element.querySelector('.pc-platform-sidebar')?.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, sidebarWidth: sidebar?.width || 0 };
  });
	expect(layout.x).toBeGreaterThanOrEqual(3);
	expect(layout.x).toBeLessThanOrEqual(5);
	expect(layout.y).toBeGreaterThanOrEqual(3);
	expect(layout.y).toBeLessThanOrEqual(5);
	expect(layout.width).toBeGreaterThanOrEqual(1430);
	expect(layout.height).toBeGreaterThanOrEqual(990);
	expect(layout.sidebarWidth).toBeGreaterThanOrEqual(186);
	expect(layout.sidebarWidth).toBeLessThanOrEqual(190);

  await shell.getByRole('button', { name: '展开全屏', exact: true }).click();
  await expect(shell).toHaveClass(/pc-platform-admin-expanded/);
  layout = await shell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const sidebar = element.querySelector('.pc-platform-sidebar')?.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, sidebarWidth: sidebar?.width || 0 };
  });
  expect(layout.x).toBe(0);
  expect(layout.y).toBe(0);
  expect(layout.width).toBe(1440);
  expect(layout.height).toBe(1000);
  await shell.getByRole('button', { name: '退出全屏', exact: true }).click();

  await page.setViewportSize({ width: 820, height: 1000 });
  layout = await shell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const sidebar = element.querySelector('.pc-platform-sidebar')?.getBoundingClientRect();
    return { x: box.x, sidebarWidth: sidebar?.width || 0 };
  });
	expect(layout.x).toBeGreaterThanOrEqual(3);
	expect(layout.x).toBeLessThanOrEqual(5);
  expect(layout.sidebarWidth).toBeGreaterThanOrEqual(70);
  expect(layout.sidebarWidth).toBeLessThanOrEqual(74);

  await page.setViewportSize({ width: 430, height: 900 });
	expect(await shell.locator('.pc-platform-overview-grid').evaluate((element) => window.getComputedStyle(element).gap)).toBe('4px');
	expect(await shell.locator('.pc-platform-stats').evaluate((element) => window.getComputedStyle(element).gap)).toBe('4px');
  const mobile = await shell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const sidebar = element.querySelector('.pc-platform-sidebar');
    const nav = element.querySelector('.pc-platform-sidebar nav');
    const workspace = element.querySelector('.pc-platform-workspace')?.getBoundingClientRect();
    const sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null;
    return {
      x: box.x,
      y: box.y,
      sidebarDirection: sidebarStyle?.flexDirection,
      sidebarHeight: sidebar?.getBoundingClientRect().height || 0,
      workspaceY: workspace?.y || 0,
      navScrollWidth: nav?.scrollWidth || 0,
      navClientWidth: nav?.clientWidth || 0
    };
  });
	expect(mobile.x).toBeGreaterThanOrEqual(3);
	expect(mobile.x).toBeLessThanOrEqual(5);
	expect(mobile.y).toBeGreaterThanOrEqual(3);
	expect(mobile.y).toBeLessThanOrEqual(5);
  expect(mobile.sidebarDirection).toBe('row');
  expect(mobile.sidebarHeight).toBeGreaterThanOrEqual(60);
  expect(mobile.workspaceY).toBeGreaterThan(mobile.y + 58);
  expect(mobile.navScrollWidth).toBeGreaterThan(mobile.navClientWidth);
  await expect(shell.getByRole('button', { name: '机构管理', exact: true })).toBeVisible();
});

test('手机端可从账号菜单安全退出并切换用户', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await loginWithDevUser(page, 'superadmin_demo');
  await openPlatformAdminPage(page);
  const shell = page.locator('#platform-admin-shell');

  const accountMenuButton = shell.getByRole('button', { name: '账号菜单', exact: true });
  await expect(accountMenuButton).toBeVisible();
  await accountMenuButton.click();
  await expect(accountMenuButton).toHaveAttribute('aria-expanded', 'true');
  const menu = shell.getByRole('menu');
  await expect(menu).toContainText('superadmin_demo');
  await expect(menu.getByRole('menuitem', { name: '个人资料', exact: true })).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: '账号安全', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '切换账号', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '退出登录', exact: true })).toBeVisible();

  await menu.getByRole('menuitem', { name: '切换账号', exact: true }).click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#login-modal')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-dev-login="student_demo"]')).toBeVisible();
  await page.locator('[data-dev-login="student_demo"]').click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await openPersonalCenter(page);
  await expect(page.locator('#pc-name')).toContainText('student_demo');
});

test('退出并切换角色后回到新角色首页且滚动位置归零', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
	await openPlatformAdminPage(page, '订单与支付');
	await expect(page.locator('#platform-admin-shell')).toContainText('订单与支付');
	await page.locator('.pc-platform-admin-content').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	expect(await page.locator('.pc-platform-admin-content').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

	await page.locator('#platform-admin-shell [data-platform-admin-logout]').click();
  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await page.locator('[data-dev-login="student_demo"]').click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await openPersonalCenter(page);

  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('最近学习');
  await expect(page.locator('.pc-subpage')).toHaveCount(0);
  await expect(page.locator('#personal-center')).not.toContainText('支付退款 · 平台支付管理');
  expect(await page.locator('#pc-content').evaluate((element) => element.scrollTop)).toBe(0);
});

test('教学运营入口只展示机构接口返回的数据', async ({ page }) => {
  await loginWithDevUser(page, 'assistant_demo');

  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  const expectations = [
    { entry: '催交作业', source: '真实作业' },
    { entry: '学员跟进', source: '真实套餐到期时间和学习活跃度' },
    { entry: '续费风险', source: '真实套餐到期时间和学习活跃度' },
    { entry: '异常提醒', source: '真实未交作业和续费风险' },
    { entry: '学习组', source: '当前老师参与的班级' },
    { entry: '课程表', source: '已排时间的班课' },
    { entry: '课程包', source: '机构课程包接口' },
    { entry: '安排课程', source: '选择学习组进入排课详情' }
  ];

  for (const item of expectations) {
    const roleCard = page.locator('.pc-admin-shortcuts');
    await roleCard.locator(`.pc-workbench-action[title="${item.entry}"]`).click();
    const subpage = page.locator('.pc-subpage');
    await expect(subpage).toContainText(item.entry);
    const subpageText = await subpage.textContent() || '';
    expect(subpageText.includes(item.source) || subpageText.includes('暂无真实数据')).toBeTruthy();
    await expect(subpage).not.toContainText(/张同学|王同学|5 人未提交|新建约课|已电话提醒补交作业/);
    await page.locator('[data-dashboard-back]').click();
    await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
  }
});

test('老师和内容管理员入口连接真实工作台、反馈、试卷及审计接口', async ({ page }) => {
  await loginWithDevUser(page, 'teacher_demo');

  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  const teacherExpectations = [
    { entry: '我的学生', source: '分配给当前老师的学习组' },
    { entry: '学习组', source: '当前老师参与的班级' },
    { entry: '课程表', source: '已排时间的班课' },
    { entry: '安排课程', source: '选择学习组进入排课详情' },
    { entry: '待批改', source: '机构成绩接口' },
    { entry: '布置作业', source: '真实学习组' },
    { entry: '成绩册', source: '真实作答记录' },
    { entry: '备课', source: '机构备课接口' }
  ];
  for (const item of teacherExpectations) {
    await page.locator(`.pc-role-workbench-card .pc-workbench-action[title="${item.entry}"]`).click();
    await expect(page.locator('.pc-subpage')).toContainText(item.source);
    await expect(page.locator('.pc-subpage')).not.toContainText(/7 份提交|新建作业|听读解弱项最高|按考点组卷/);
    await page.locator('[data-dashboard-back]').click();
    await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
  }

  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await loginWithDevUser(page, 'contentadmin_demo');

  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="内容反馈"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('列表来自反馈接口');
  await expect(page.locator('.pc-subpage')).toContainText('题目、答案、解析、图片和音频问题');
  await page.locator('[data-dashboard-back]').click();
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="发布工作流"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('题目导入 → 质量检查 → 解析审核 → 复核 → 发布版本');
	await expect(page.locator('.pc-subpage')).toContainText('旧内容暂无快照；下次修改或发布后生成');
  await expect(page.locator('.pc-subpage')).not.toContainText('音频切割完成后可发布');
  await page.locator('[data-dashboard-back]').click();
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="内容日志"]').click();
  await expect(page.locator('#audit-log-modal')).toBeVisible();
});

test('机构与平台管理我的内容入口打开具体子页面', async ({ page }) => {
  const cases = [
    {
      loginId: 'orgadmin_demo',
      expectations: [
        { entry: '成员管理', detail: /成员管理|添加 \/ 邀请|还没有可管理机构|正在读取机构数据/ },
        { entry: '权限管理', detail: /权限管理|成员权限|高级：角色默认权限|还没有可管理机构|正在读取机构数据/ },
        { entry: '机构设置', detail: /机构设置|套餐与席位|校区管理|操作审计|还没有可管理机构|正在读取机构数据/ },
        { entry: '学习组', detail: /学习组|还没有可管理机构|正在读取机构数据/ },
        { entry: '课程包', detail: /课程包|还没有可管理机构|正在读取机构数据/ },
		{ entry: '机构看板', detail: /学习组平均分趋势|暂无趋势数据|正在读取真实学习组/ }
      ]
    }
  ];

  for (const roleCase of cases) {
    await loginWithDevUser(page, roleCase.loginId);
    await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
    for (const item of roleCase.expectations) {
      const roleCard = page.locator('.pc-admin-shortcuts');
      await roleCard.locator(`.pc-workbench-action[title="${item.entry}"]`).click();
      if (item.entry === '审计日志') {
        const auditModal = page.locator('#audit-log-modal');
        await expect(auditModal).toBeVisible({ timeout: 20000 });
        await expect(auditModal).toContainText(item.detail);
        await auditModal.locator('#al-close').click();
        continue;
      }
      await expect(page.locator('.pc-subpage')).toContainText(item.entry);
      await expect(page.locator('.pc-subpage')).toContainText(item.detail);
      await expect(page.locator('.pc-subpage')).not.toContainText('管理面板');
      await expect(page.locator('.pc-subpage')).not.toContainText('待配置');
      await page.locator('[data-dashboard-back]').click();
      await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
      await expect(page.locator('.pc-admin-shortcuts')).toContainText('管理功能');
    }
    await clearBrowserSession(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
});

test('机构管理授权和席位入口使用真实管理页面', async ({ page }) => {
  await loginWithDevUser(page, 'orgadmin_demo');

  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="权限管理"]').click();
	await expect(page.locator('.pc-subpage')).toContainText(/角色默认权限|成员权限|正在读取机构数据|还没有可管理机构/);
  await expect(page.locator('.pc-subpage')).not.toContainText('已追加学习组排课权限');
  await page.locator('[data-dashboard-back]').click();
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="机构设置"]').click();
	await expect(page.locator('.pc-subpage')).toContainText(/套餐与席位|校区管理|操作审计|正在读取机构数据|还没有可管理机构/);
  await expect(page.locator('.pc-subpage')).not.toContainText('可回收席位');
});

test('平台管理入口支持功能开关、退款和反馈处理闭环', async ({ page, request }) => {
  const feedbackUser = await loginApi(request, uniqueLoginId('feedback_flow_student'));
  const feedbackResponse = await request.post('/api/v1/feedback', {
    data: {
      token: feedbackUser.token,
      paper_id: '2023_02',
      exam_id: '2023_02',
      question_id: '29',
      category: 'question',
      description: 'Playwright 平台反馈处理闭环'
    }
  });
  expect(feedbackResponse.ok()).toBeTruthy();

  const feedbackAdmin = await loginApi(request, 'superadmin_demo');
  const feedbackPageResponse = await request.get('/api/v1/feedback', {
    params: {
      token: feedbackAdmin.token,
      q: 'Playwright',
      page: 1,
      page_size: 1,
      sort: 'created_at',
      order: 'desc'
    }
  });
  expect(feedbackPageResponse.ok()).toBeTruthy();
  const feedbackPagePayload = await feedbackPageResponse.json();
  expect(feedbackPagePayload.data.page).toBe(1);
  expect(feedbackPagePayload.data.page_size).toBe(1);
  expect(feedbackPagePayload.data.total).toBeGreaterThanOrEqual(1);
  expect(feedbackPagePayload.data.items).toHaveLength(1);
  expect(feedbackPagePayload.data.items[0].description).toContain('Playwright 平台反馈处理闭环');

  await loginWithDevUser(page, 'superadmin_demo', {}, { skipApiStubs: true, skipPersonalCenter: true });

	await openPlatformAdminPage(page, '功能开关');
	await page.locator('[data-platform-flag-group="learning"] > summary').click();
  const flagRow = page.locator('[data-platform-system-flag-row="wrong_question_tags"]');
  await expect(flagRow).toContainText('错题归因维度', { timeout: 20000 });
	const startedFromDefault = await flagRow.getByText('系统默认', { exact: true }).isVisible();
	const originalStatus = (await flagRow.locator('.pc-platform-flag-chip').first().textContent() || '').trim();
	await flagRow.locator('[data-platform-system-flag-edit]').click();
	const editor = page.locator('.pc-platform-flag-editor-overlay');
	const originalEnabled = await editor.locator('input[name="flag-enabled"][value="true"]').isChecked();
	await editor.locator(`input[name="flag-enabled"][value="${originalEnabled ? 'false' : 'true'}"]`).check();
	await editor.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#risk-input').fill('WRONG_QUESTION_TAGS');
  await page.locator('#risk-ok').click();
	await expect(flagRow.locator('.pc-platform-flag-chip').first()).not.toHaveText(originalStatus);
	await expect(flagRow).toContainText('平台设置');
	await flagRow.locator('[data-platform-system-flag-edit]').click();
  if (startedFromDefault) {
		await editor.locator('[data-platform-flag-use-default]').click();
  } else {
		await editor.locator(`input[name="flag-enabled"][value="${originalEnabled ? 'true' : 'false'}"]`).check();
		await editor.getByRole('button', { name: '保存设置', exact: true }).click();
  }
  await page.locator('#risk-input').fill('WRONG_QUESTION_TAGS');
  await page.locator('#risk-ok').click();
	await expect(flagRow.locator('.pc-platform-flag-chip').first()).toHaveText(originalStatus);
	if (startedFromDefault) await expect(flagRow).toContainText('系统默认');
	await openPlatformAdminPage(page, '价格与套餐');
  await expect(page.locator('.pc-subpage')).toContainText('设置套餐售价、优惠与续费策略');
	await expect(page.locator('[data-pricing-section-tab]')).toHaveCount(4);
	await expect(page.locator('[data-pricing-section-tab="plans"]')).toHaveAttribute('aria-pressed', 'true');
	const pricingTabStyle = await page.locator('[data-pricing-section-tab="plans"]').evaluate((tab) => {
		const style = getComputedStyle(tab);
		return { background: style.backgroundColor, border: style.borderTopColor, color: style.color, shadow: style.boxShadow };
	});
	expect(pricingTabStyle).toEqual({
		background: 'rgb(255, 247, 241)',
		border: 'rgb(255, 122, 47)',
		color: 'rgb(31, 25, 20)',
		shadow: 'rgb(255, 122, 47) 3px 0px 0px 0px inset'
	});
	await expect(page.locator('[data-pricing-section-panel="plans"]').first()).toBeVisible();
	await expect(page.locator('[data-pricing-section-panel="offers"]')).toBeHidden();
	const personalProMonthlyPrice = page.locator('[data-price-scope="personal"][data-price-plan="pro"][data-price-days="30"]');
  await expect(personalProMonthlyPrice).toHaveValue('19');
	await expect(page.locator('[data-pricing-plan-panel="personal"]')).toBeVisible();
	await expect(page.locator('[data-pricing-plan-panel="organization"]').first()).toBeHidden();
	await page.locator('[data-pricing-plan-scope="organization"]').click();
	await expect(page.locator('[data-pricing-plan-panel="organization"]').first()).toBeVisible();
  await expect(page.locator('[data-price-scope="organization"][data-price-plan="pro"][data-price-days="30"]')).toHaveValue('15');
  await expect(page.locator('[data-price-min-seats="pro"]')).toHaveValue('20');
  await expect(page.locator('[data-price-tier="2"][data-price-plan="ultra"]')).toHaveValue('219');
	await expect(page.locator('.pc-pricing-boundary-warning')).toContainText('阶梯边界提醒');
	await page.locator('[data-pricing-plan-scope="personal"]').click();
	await personalProMonthlyPrice.fill('19.01');
	await page.locator('[data-pricing-section-tab="offers"]').click();
	await expect(page.locator('[data-pricing-section-tab="offers"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-pricing-section-panel="offers"]')).toBeVisible();
  await expect(page.locator('[data-price-offer-card]')).toHaveCount(6);
  await expect(page.locator('[data-price-offer-card][data-offer-scope="personal"][data-offer-id="first_purchase"] [data-offer-discount]')).toHaveValue('20');
  await expect(page.locator('[data-price-offer-card][data-offer-scope="organization"][data-offer-id="renewal"] [data-offer-discount]')).toHaveValue('5');
	await expect(page.locator('[data-pricing-offer-panel="personal"]')).toBeVisible();
	await expect(page.locator('[data-pricing-offer-panel="organization"]')).toBeHidden();
	const firstOfferCard = page.locator('[data-price-offer-card][data-offer-scope="personal"][data-offer-id="first_purchase"]');
	await expect(firstOfferCard.locator('[data-pricing-offer-editor]')).toBeHidden();
	await firstOfferCard.locator('[data-pricing-offer-edit]').click();
	await expect(firstOfferCard.locator('[data-pricing-offer-editor]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const offerLayout = await page.locator('[data-pricing-form]').evaluate((form) => ({
    viewportWidth: window.innerWidth,
    cards: Array.from(form.querySelectorAll('[data-pricing-offer-panel="personal"] [data-price-offer-card]')).map((card) => {
      const box = card.getBoundingClientRect();
      const fields = Array.from(card.querySelectorAll('.pc-profile-input')).map((input) => input.getBoundingClientRect().width);
      return { left: box.left, right: box.right, width: box.width, fields };
    })
  }));
  for (const card of offerLayout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(offerLayout.viewportWidth + 1);
    expect(card.width).toBeGreaterThan(240);
    expect(Math.max(...card.fields) - Math.min(...card.fields)).toBeLessThanOrEqual(1);
  }
	await page.locator('[data-pricing-offer-scope="organization"]').click();
	await expect(page.locator('[data-pricing-offer-panel="organization"]')).toBeVisible();
	await expect(page.locator('[data-pricing-offer-panel="personal"]')).toBeHidden();
	await page.locator('[data-pricing-section-tab="renewal"]').click();
	await expect(page.locator('[data-renewal-reminder-days]')).toBeVisible();
  await expect(page.locator('[data-renewal-reminder-days]')).toHaveValue('7, 3, 1');
  await expect(page.locator('[data-renewal-price-notice-days]')).toHaveValue('7');
  await expect(page.locator('[data-renewal-grace-days]')).toHaveValue('7');
	const renewalLayout = await page.locator('[data-pricing-form]').evaluate((form) => ({
		viewportWidth: window.innerWidth,
		fields: Array.from(form.querySelectorAll('.pc-pricing-renewal-controls .pc-profile-input')).map((input) => {
			const box = input.getBoundingClientRect();
			return { left: box.left, right: box.right, width: box.width };
		})
	}));
  for (const field of renewalLayout.fields) {
    expect(field.left).toBeGreaterThanOrEqual(0);
    expect(field.right).toBeLessThanOrEqual(renewalLayout.viewportWidth + 1);
    expect(field.width).toBeGreaterThan(240);
	  }
	await page.locator('[data-pricing-section-tab="runtime"]').click();
	await expect(page.locator('[data-pricing-savebar]')).toBeHidden();
	await expect(page.locator('.pc-renewal-operations')).toContainText('续费任务运行状态');
	await expect(page.locator('.pc-renewal-operations')).toContainText('邮件待重试');
	await expect(page.locator('.pc-renewal-operations')).toContainText('投递异常');
	await expect(page.locator('.pc-renewal-operations [data-renewal-job-run]')).toBeVisible();
	  await page.setViewportSize({ width: 1440, height: 1100 });
	  await page.locator('[data-pricing-section-tab="plans"]').click();
	  await expect(page.locator('[data-pricing-savebar]')).toBeVisible();
	  await expect(personalProMonthlyPrice).toHaveValue('19.01');
	  await personalProMonthlyPrice.fill('19');
	  const desktopPricingOverflow = await page.locator('#platform-admin-shell .pc-platform-admin-content').evaluate((content) => {
	    const form = content.querySelector('[data-pricing-form]');
	    return {
	      contentClientWidth: content.clientWidth,
	      contentScrollWidth: content.scrollWidth,
	      formClientWidth: form?.clientWidth ?? 0,
	      formScrollWidth: form?.scrollWidth ?? 0
	    };
	  });
	  expect(desktopPricingOverflow.contentScrollWidth).toBeLessThanOrEqual(desktopPricingOverflow.contentClientWidth + 1);
	  expect(desktopPricingOverflow.formScrollWidth).toBeLessThanOrEqual(desktopPricingOverflow.formClientWidth + 1);
	  await page.locator('[data-pricing-form] button[type="submit"]').click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect(page.locator('#pc-toast')).toContainText('套餐价格、续费提醒与优惠规则已保存');
	const refundOrderInput = await openRefundFromPaidOrder(page);
  await refundOrderInput.fill('pay_missing_for_e2e');
  await page.locator('[data-platform-refund-form] button[type="submit"]').click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect(page.locator('#pc-toast')).toContainText(/退款申请失败|Payment order not found|not found/);
	await openPlatformAdminPage(page, '反馈处理');
  await expect(page.locator('.pc-subpage')).toContainText('Playwright 平台反馈处理闭环');
	await page.locator('[data-feedback-update][data-feedback-status="reviewing"]').first().click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已受理');
  await page.locator('[data-feedback-update][data-feedback-status="resolved"]').first().click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已关闭');
	await openPlatformAdminPage(page, '审计日志');
	const auditPage = page.locator('#platform-admin-shell [data-audit-log-surface="embedded"]');
	await expect(auditPage).toBeVisible({ timeout: 20000 });
	await expect(page.locator('#audit-log-modal')).toHaveCount(0);
	await expect(auditPage).toContainText('修改反馈状态', { timeout: 20000 });
	await expect(auditPage).toContainText('平台');
	await auditPage.locator('#al-actor').fill('missing_actor_for_empty_state');
	await auditPage.locator('#al-search').click();
	await expect(auditPage.locator('[data-audit-reset-empty]')).toBeVisible();
	await auditPage.locator('[data-audit-reset-empty]').click();
	await expect(auditPage).toContainText('修改反馈状态', { timeout: 20000 });
	const detailEntry = auditPage.locator('button[data-audit-detail]').first();
	await detailEntry.click();
  const detailModal = page.locator('#audit-detail-modal');
  await expect(detailModal).toBeVisible();
  await expect(detailModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'ald-title');
  await expect(detailModal.locator('#ald-close')).toBeFocused();
  await expect(detailModal).toContainText(/记录 ID|audit_/);
  await expect(detailModal).toContainText('结构化详情');
	await page.keyboard.press('Escape');
	await expect(detailModal).toBeHidden();
	await expect(detailEntry).toBeFocused();
	await expect(auditPage).toBeVisible();
	await openPlatformAdminPage(page, '反馈处理');
	const openOriginalQuestion = page.locator('[data-feedback-open-question]').first();
	await expect(openOriginalQuestion).toHaveText('查看原题');
	await openOriginalQuestion.click();
	const openQuestionConfirmation = page.locator('.pc-confirm-dialog');
	await expect(openQuestionConfirmation).toContainText('将隐藏平台管理页面并打开试卷');
	await expect(openQuestionConfirmation).toContainText('题目 29');
	await openQuestionConfirmation.locator('[data-pc-confirm-ok]').click();
	await expect(page.locator('#platform-admin-shell')).toBeHidden();
	await expect(page.locator('#pc-toast')).toContainText('已打开反馈关联题目');
});

test('机构管理首屏只加载分页摘要并在独立详情页按需加载详情', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipApiStubs: true, skipPersonalCenter: true });
  const organizationRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/organizations')) organizationRequests.push(url);
  });

	await openPlatformAdminPage(page, '机构管理');
  await expect(page.locator('[data-managed-org-list-form]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.pc-managed-org-card').first()).toBeVisible({ timeout: 20000 });
  expect(organizationRequests.some((url) => url.pathname === '/api/v1/organizations' && url.searchParams.get('summary') === '1' && url.searchParams.get('page_size') === '20')).toBeTruthy();
  expect(organizationRequests.filter((url) => url.pathname !== '/api/v1/organizations')).toHaveLength(0);
  await expect(page.locator('.pc-managed-org-card .pc-managed-org-body')).toHaveCount(0);
	const toolbarLayout = await page.locator('.pc-managed-org-toolbar').evaluate((toolbar) => {
		const outer = toolbar.getBoundingClientRect();
		const selectors = ['[data-managed-org-query]', 'button[type="submit"]', '.pc-admin-list-page-status', '[data-managed-org-page="prev"]', '[data-managed-org-page="next"]'];
		return { outer, children: selectors.map((selector) => toolbar.querySelector(selector)?.getBoundingClientRect()) };
	});
	for (const child of toolbarLayout.children) {
		expect(child.x).toBeGreaterThanOrEqual(toolbarLayout.outer.x);
		expect(child.x + child.width).toBeLessThanOrEqual(toolbarLayout.outer.x + toolbarLayout.outer.width);
	}
	expect(Math.abs(toolbarLayout.children[0].y - toolbarLayout.children[1].y)).toBeLessThanOrEqual(1);
	expect(Math.abs(toolbarLayout.children[0].height - toolbarLayout.children[1].height)).toBeLessThanOrEqual(1);
	expect(toolbarLayout.children[2].y).toBeGreaterThan(toolbarLayout.children[0].y);
	const createPanel = page.locator('[data-platform-org-create-panel]');
	await expect(createPanel.locator('[data-platform-org-create-form]')).toBeHidden();
	await createPanel.locator(':scope > summary').click();
	await expect(createPanel.locator('[data-platform-org-create-form]')).toBeVisible();
	const createControlLayout = await createPanel.evaluate((panel) => {
		const name = panel.querySelector('[data-platform-org-name]').getBoundingClientRect();
		const button = panel.querySelector('button[type="submit"]').getBoundingClientRect();
		return { name, button };
	});
	expect(Math.abs((createControlLayout.name.y + createControlLayout.name.height) - (createControlLayout.button.y + createControlLayout.button.height))).toBeLessThanOrEqual(1);
	expect(Math.abs(createControlLayout.name.height - createControlLayout.button.height)).toBeLessThanOrEqual(1);
	await expect(createPanel.locator('[data-platform-org-plan]')).toBeHidden();
	const planSelect = createPanel.locator('[data-admin-select-menu]:has([data-platform-org-plan])');
	await expect(planSelect.locator(':scope > summary')).toBeVisible();
	await planSelect.locator(':scope > summary').click();
	const planOptions = planSelect.locator('[data-admin-select-option]');
	await expect(planOptions).toHaveCount(3);
	for (const option of await planOptions.all()) {
		await expect(option).toBeVisible();
		expect(await option.evaluate((element) => {
			const box = element.getBoundingClientRect();
			const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
			return hit === element || element.contains(hit);
		})).toBeTruthy();
	}
	await planSelect.locator(':scope > summary').click();

  await page.setViewportSize({ width: 430, height: 900 });
  const mobileLayout = await page.locator('.pc-managed-org-toolbar').evaluate((toolbar) => {
    const box = (selector) => toolbar.querySelector(selector)?.getBoundingClientRect();
    const input = box('[data-managed-org-query]');
    const search = box('button[type="submit"]');
    const status = box('.pc-admin-list-page-status');
    const previous = box('[data-managed-org-page="prev"]');
    const next = box('[data-managed-org-page="next"]');
    return { input, search, status, previous, next };
  });
	const mobileCreateButtonWidth = await createPanel.locator('button[type="submit"]').evaluate((button) => button.getBoundingClientRect().width);
  expect(mobileLayout.search.x).toBeGreaterThanOrEqual(mobileLayout.input.x + mobileLayout.input.width);
	expect(Math.abs(mobileLayout.search.y - mobileLayout.input.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(mobileLayout.search.height - mobileLayout.input.height)).toBeLessThanOrEqual(1);
	expect(Math.abs(mobileLayout.search.width - 174)).toBeLessThanOrEqual(1);
	expect(Math.abs(mobileCreateButtonWidth - mobileLayout.search.width)).toBeLessThanOrEqual(1);
	expect(Math.abs((mobileLayout.previous.y + mobileLayout.previous.height / 2) - (mobileLayout.status.y + mobileLayout.status.height / 2))).toBeLessThanOrEqual(1);
  expect(mobileLayout.next.x).toBeGreaterThanOrEqual(mobileLayout.previous.x + mobileLayout.previous.width);
	const organizationCardLayout = await page.locator('.pc-managed-org-card').evaluateAll((cards) => {
		const first = cards[0].getBoundingClientRect();
		const second = cards[1]?.getBoundingClientRect();
		const metrics = cards[0].querySelector('.pc-org-meta').getBoundingClientRect();
		return {
			cardGap: second ? second.top - first.bottom : 4,
			bottomInset: first.bottom - metrics.bottom
		};
	});
	expect(organizationCardLayout.cardGap).toBeGreaterThanOrEqual(3);
	expect(organizationCardLayout.cardGap).toBeLessThanOrEqual(5);
	expect(organizationCardLayout.bottomInset).toBeLessThanOrEqual(20);
	await page.setViewportSize({ width: 1440, height: 1100 });

	const targetCard = page.locator('.pc-managed-org-card').nth(5);
	await targetCard.scrollIntoViewIfNeeded();
	const targetOrganizationId = await targetCard.getAttribute('data-managed-org-id');
	const targetOrganizationName = await targetCard.locator('.pc-org-name').textContent();
	const listScrollTop = await page.locator('.pc-platform-admin-content').evaluate((content) => content.scrollTop);
	await targetCard.locator('summary').click();
	await expect(page.getByRole('button', { name: /返回机构列表/ })).toBeVisible();
	const detailCard = page.locator('.pc-managed-org-detail-card');
	await expect(detailCard).toBeVisible({ timeout: 20000 });
	await expect(detailCard.locator('.pc-org-name')).toHaveText(targetOrganizationName || '');
	await expect(detailCard).toHaveAttribute('data-managed-org-id', targetOrganizationId || '');
	await expect(detailCard.locator('.pc-managed-org-body')).toContainText(/套餐与席位|管理人员配置/, { timeout: 20000 });
	await expect(detailCard).not.toHaveClass(/is-expanded/);
	const organizationDetailStyle = await detailCard.evaluate((card) => {
		const workspace = card.querySelector('.pc-org-simple-workspace');
		const body = card.querySelector('.pc-managed-org-body');
		const overviewMetric = card.querySelector('.pc-org-metric');
		const subscriptionField = card.querySelector('.pc-org-subscription-fields > .pc-org-field');
		const subscriptionSave = card.querySelector('.pc-org-subscription-save');
		const inviteDrawer = card.querySelector('.pc-org-manager-invite-drawer');
		const memberEditor = card.querySelector('.pc-org-member-editor');
		const roleToggle = card.querySelector('.pc-role-toggle');
		const searchButton = card.querySelector('[data-org-search]');
		return {
			cardRadius: getComputedStyle(card).borderRadius,
			workspacePaddingLeft: workspace ? getComputedStyle(workspace).paddingLeft : '',
			workspaceBorderLeftWidth: workspace ? getComputedStyle(workspace).borderLeftWidth : '',
			workspaceRadius: workspace ? getComputedStyle(workspace).borderRadius : '',
			workspaceBackground: workspace ? getComputedStyle(workspace).backgroundColor : '',
			overviewMetricBackground: overviewMetric ? getComputedStyle(overviewMetric).backgroundColor : '',
			bodyPaddingTop: body ? getComputedStyle(body).paddingTop : '',
			inviteRadius: inviteDrawer ? getComputedStyle(inviteDrawer).borderRadius : '',
			memberRadius: memberEditor ? getComputedStyle(memberEditor).borderRadius : '',
			roleFontSize: roleToggle ? getComputedStyle(roleToggle).fontSize : '',
			searchButtonFontSize: searchButton ? getComputedStyle(searchButton).fontSize : '',
			searchButtonWidth: searchButton?.getBoundingClientRect().width || 0,
			fieldWidth: subscriptionField?.getBoundingClientRect().width || 0,
			saveWidth: subscriptionSave?.getBoundingClientRect().width || 0
		};
	});
	expect(organizationDetailStyle.cardRadius).toBe('8px');
	expect(organizationDetailStyle.workspacePaddingLeft).toBe('0px');
	expect(organizationDetailStyle.workspaceBorderLeftWidth).toBe('0px');
	expect(organizationDetailStyle.workspaceRadius).toBe('0px');
	expect(organizationDetailStyle.workspaceBackground).toBe('rgb(255, 255, 255)');
	expect(organizationDetailStyle.overviewMetricBackground).not.toBe('rgb(255, 255, 255)');
	expect(organizationDetailStyle.bodyPaddingTop).toBe('8px');
	expect(organizationDetailStyle.inviteRadius).toBe('8px');
	if (organizationDetailStyle.memberRadius) expect(organizationDetailStyle.memberRadius).toBe('8px');
	expect(organizationDetailStyle.roleFontSize).toBe('14px');
	expect(organizationDetailStyle.searchButtonFontSize).toBe('14px');
	expect(Math.abs(organizationDetailStyle.searchButtonWidth - organizationDetailStyle.fieldWidth)).toBeLessThanOrEqual(1);
	expect(Math.abs(organizationDetailStyle.saveWidth - organizationDetailStyle.fieldWidth)).toBeLessThanOrEqual(1);
	await expect(detailCard.locator('[data-org-manager-selection]')).toHaveCount(0);
	await expect(detailCard.locator('.pc-org-manager-add-button')).toHaveCount(0);
	await expect(detailCard.locator('.pc-org-manager-invite-drawer').first()).not.toHaveAttribute('open', '');
	await expect(detailCard.locator('.pc-org-audit-drawer')).not.toHaveAttribute('open', '');
	await detailCard.locator('[data-org-search-query]').fill('3');
	await detailCard.locator('[data-org-search]').click();
	const candidateResults = detailCard.locator('.pc-org-candidate');
	await expect.poll(async () => candidateResults.count()).toBeGreaterThan(5);
	await expect(detailCard.locator('.pc-org-candidate-summary')).toContainText(/找到 \d+ 个账号，点击一行选择/);
	await expect(candidateResults.first().locator('.pc-org-candidate-choice')).toHaveText('选择');
	const selectedCandidate = candidateResults.nth(5);
	await selectedCandidate.scrollIntoViewIfNeeded();
	const candidateListScrollTop = await detailCard.locator('.pc-org-candidate-list').evaluate((list) => list.scrollTop);
	expect(candidateListScrollTop).toBeGreaterThan(0);
	await selectedCandidate.click();
	await expect(selectedCandidate).toHaveAttribute('aria-pressed', 'true');
	await expect(selectedCandidate).toBeFocused();
	await expect(selectedCandidate.locator('.pc-org-candidate-selected')).toHaveText('✓ 已选择');
	await expect(detailCard.locator('[data-org-manager-selection]')).toBeVisible();
	await expect(detailCard.locator('[data-org-selected-user]')).toContainText((await selectedCandidate.locator('strong').textContent()) || '');
	const managerAddWidth = await detailCard.locator('.pc-org-manager-add-button').evaluate((button) => button.getBoundingClientRect().width);
	expect(Math.abs(managerAddWidth - organizationDetailStyle.fieldWidth)).toBeLessThanOrEqual(1);
	await expect(detailCard).not.toContainText('提交后会加入当前组织');
	const restoredCandidateListScrollTop = await detailCard.locator('.pc-org-candidate-list').evaluate((list) => list.scrollTop);
	expect(Math.abs(restoredCandidateListScrollTop - candidateListScrollTop)).toBeLessThanOrEqual(1);
	expect(await selectedCandidate.evaluate((candidate) => getComputedStyle(candidate).backgroundColor)).toBe('rgb(255, 247, 241)');
	await expect(selectedCandidate.locator('.pc-org-candidate-selected')).toHaveCSS('background-color', 'rgb(255, 122, 47)');
	const unselectedCandidate = candidateResults.first();
	await expect(unselectedCandidate).toHaveAttribute('aria-pressed', 'false');
	await unselectedCandidate.hover();
	await expect(unselectedCandidate).toHaveCSS('background-color', 'rgb(242, 239, 235)');
	const firstMemberEditor = detailCard.locator('.pc-org-member-editor').first();
	await firstMemberEditor.locator(':scope > summary').click();
	await expect(firstMemberEditor.locator('form[data-org-member-form]')).toContainText('角色与权限');
	await expect(firstMemberEditor.locator('[data-org-role-permission-count]')).toContainText(/已包含 \d+ 项基础权限/);
	await expect(firstMemberEditor.locator('[data-org-role][value="student"]')).toHaveCount(0);
	await expect(firstMemberEditor.locator('[data-org-role]')).toHaveCount(4);
	await expect(firstMemberEditor.locator('[data-org-role][value="orgContentAdmin"]')).toHaveCount(1);
	await expect(firstMemberEditor.locator('.pc-role-toggle', { hasText: '机构内容管理员' })).toBeVisible();
	await expect(firstMemberEditor).not.toContainText('职责模板');
	await expect(firstMemberEditor.locator('[data-org-template-option]')).toHaveCount(0);
	await expect(firstMemberEditor.locator('[data-org-role-permission-list] input:disabled').first()).toBeChecked();
	await expect(firstMemberEditor.locator('[data-org-role-permission-list]')).toContainText('角色自带');
	await expect(firstMemberEditor.locator('[data-org-extra-permission-count]')).toContainText(/已选择 \d+ 项/);
	const memberSaveButton = firstMemberEditor.locator('[data-org-member-save]');
	await expect(memberSaveButton).toHaveText('保存成员设置');
	await expect(memberSaveButton).toBeDisabled();
	await expect(firstMemberEditor.locator('[data-org-member-save-status]')).toHaveText('暂无待保存修改');
	const memberNumberEditor = firstMemberEditor.locator('.pc-org-member-number-editor');
	const memberNumberInput = memberNumberEditor.locator('[data-org-member-no]');
	const originalMemberNumber = await memberNumberInput.inputValue();
	await memberNumberEditor.locator('[data-org-member-number-edit]').click();
	await expect(memberNumberEditor.locator('[data-org-member-number-view]')).toBeHidden();
	await expect(memberNumberEditor.locator('[data-org-member-number-edit-panel]')).toBeVisible();
	await expect(memberNumberInput).toBeFocused();
	const memberNumberEditStyle = await memberNumberEditor.evaluate((editor) => {
		const field = editor.querySelector('.pc-org-member-number-input');
		const label = field?.querySelector(':scope > span');
		const input = field?.querySelector('input');
		const labelBox = label?.getBoundingClientRect();
		const inputBox = input?.getBoundingClientRect();
		const inputStyle = input ? getComputedStyle(input) : null;
		return {
			fieldDisplay: field ? getComputedStyle(field).display : '',
			columnCount: field ? getComputedStyle(field).gridTemplateColumns.split(' ').length : 0,
			centerDifference: labelBox && inputBox
				? Math.abs((labelBox.y + labelBox.height / 2) - (inputBox.y + inputBox.height / 2))
				: Number.POSITIVE_INFINITY,
			inputOutline: inputStyle?.outlineStyle || '',
			inputBorderWidth: inputStyle?.borderWidth || ''
		};
	});
	expect(memberNumberEditStyle.fieldDisplay).toBe('grid');
	expect(memberNumberEditStyle.columnCount).toBe(2);
	expect(memberNumberEditStyle.centerDifference).toBeLessThanOrEqual(1);
	expect(memberNumberEditStyle.inputOutline).toBe('none');
	expect(memberNumberEditStyle.inputBorderWidth).toBe('0px');
	await memberNumberInput.fill(`${originalMemberNumber}-EDIT`);
	await expect(memberSaveButton).toBeEnabled();
	await expect(firstMemberEditor.locator('[data-org-member-save-status]')).toHaveText('有尚未保存的修改');
	await memberNumberEditor.locator('[data-org-member-number-cancel]').click();
	await expect(memberNumberEditor.locator('[data-org-member-number-view]')).toBeVisible();
	await expect(memberNumberEditor.locator('[data-org-member-number-edit-panel]')).toBeHidden();
	expect(await memberNumberInput.inputValue()).toBe(originalMemberNumber);
	await expect(memberSaveButton).toBeDisabled();
	await firstMemberEditor.locator('[data-org-role][value="assistant"]').check();
	await expect(firstMemberEditor.locator('[data-org-member-permission-summary]')).toContainText(/基础权限 · \d+ 项额外权限/);
	await expect(firstMemberEditor.locator('[data-org-extra-permission-option][data-permission-id="assignment.remind"]')).toBeHidden();
	await expect(memberSaveButton).toBeEnabled();
	await expect(memberNumberEditor.locator('[data-org-member-number-view]')).toContainText(/学号|工号|成员编号/);
	await expect(memberNumberEditor.locator('[data-org-member-number-edit]')).toContainText(/修改|设置/);
	const memberNumberSummaryStyle = await memberNumberEditor.evaluate((editor) => {
		const value = editor.querySelector('.pc-org-member-number-value');
		const action = editor.querySelector('.pc-org-member-number-action');
		const save = editor.closest('form')?.querySelector('[data-org-member-save]');
		const actionBox = action?.getBoundingClientRect();
		const saveBox = save?.getBoundingClientRect();
		return {
			valueRadius: value ? getComputedStyle(value).borderRadius : '',
			actionHeight: actionBox?.height || 0,
			saveHeight: saveBox?.height || 0,
			actionCenterY: actionBox ? actionBox.y + actionBox.height / 2 : 0,
			saveCenterY: saveBox ? saveBox.y + saveBox.height / 2 : 0,
			actionFontSize: action ? getComputedStyle(action).fontSize : '',
			saveFontSize: save ? getComputedStyle(save).fontSize : ''
		};
	});
	expect(memberNumberSummaryStyle.valueRadius).toBe('14px');
	expect(memberNumberSummaryStyle.actionHeight).toBe(44);
	expect(memberNumberSummaryStyle.saveHeight).toBe(44);
	expect(memberNumberSummaryStyle.actionFontSize).toBe('14px');
	expect(memberNumberSummaryStyle.saveFontSize).toBe('14px');
  const detailPaths = organizationRequests.map((url) => url.pathname);
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/members$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/campuses$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/learning-groups$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/course-packages$/.test(path))).toBeTruthy();
	await page.getByRole('button', { name: /返回机构列表/ }).click();
	await expect(page.locator('[data-managed-org-list-form]')).toBeVisible();
	await expect(page.locator(`.pc-managed-org-card[data-managed-org-id="${targetOrganizationId}"] summary`)).toBeFocused();
	const restoredScrollTop = await page.locator('.pc-platform-admin-content').evaluate((content) => content.scrollTop);
	expect(Math.abs(restoredScrollTop - listScrollTop)).toBeLessThanOrEqual(1);
});

test('平台退款提交需要明确确认并恢复按钮状态', async ({ page }) => {
	await loginWithDevUser(page, 'superadmin_demo', {}, { skipPersonalCenter: true });
	const refundOrderInput = await openRefundFromPaidOrder(page);
  await refundOrderInput.fill('pay_missing_confirmation_e2e');
  const submit = page.locator('[data-platform-refund-form] button[type="submit"]');

  const refundResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/payments/refunds') && response.request().method() === 'POST'
  );
  await submit.click();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('pay_missing_confirmation_e2e');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  expect((await refundResponse).status()).toBe(404);
  await expect(page.locator('#pc-toast')).toContainText(/退款申请失败|Payment order not found|not found/, { timeout: 30000 });
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText('提交退款申请');
});
