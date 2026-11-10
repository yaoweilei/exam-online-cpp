const { test, expect } = require('@playwright/test');

async function fixture(page) {
  await page.route('**/__home_management_groups__', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" class="pc-platform-admin-open" data-learning-role="superAdmin"><header class="pc-platform-topbar"></header><aside class="pc-platform-sidebar"></aside><div class="pc-platform-workspace"><main class="pc-platform-admin-content"><div class="pc-workspace-page-heading"><h1>平台总览</h1><p>全站状态、风险与待办</p></div><div class="pc-platform-overview-grid pc-role-admin-overview pc-role-home"><section class="pc-platform-stats"><button class="pc-platform-stat"><span>用户总数</span><strong>2389</strong></button><button class="pc-platform-stat"><span>机构总数</span><strong>316</strong></button><button class="pc-platform-stat"><span>订单总数</span><strong>125</strong></button><button class="pc-platform-stat"><span>内容总数</span><strong>119</strong></button></section><div id="home-functions"></div></div></main></div></div>'
  }));
  await page.goto('/__home_management_groups__');
  await page.evaluate(async () => {
    const { renderHomeManagementGroups, platformAdminNavigation } = await import('/static/app/viewer/personalCenter/homeManagement.js');
    const product = await import('/static/app/viewer/personalCenter/productImprovements.js');
    const groups = platformAdminNavigation().filter(group => group.group).map(group => ({
      label: group.group,
      actions: group.items.filter(item => item.id !== 'reminders').map(item => ({ title: item.label, icon: item.icon, intent: item.id })),
      trailing: group.items.some(item => item.id === 'reminders') ? product.renderProductPanel('platform-operations') : ''
    }));
    document.querySelector('#home-functions').outerHTML = renderHomeManagementGroups(groups);
    window.APIClient = { request: async () => ({ counts: { overdue_order: 36 }, checks: [], items: Array.from({ length: 36 }, (_, i) => ({ id: 'preview-order-' + i, title: '跨日未完成的支付订单，请核查是否仍需处理', type: 'overdue_order', destination: 'order' })) }) };
    product.bindProductPanels(document.querySelector('.pc-home-settings'), { owner: 'home-style-preview', token: '', orgId: '', current: () => true, changed: () => {}, navigate: () => {}, password: async () => null, confirm: async () => false });
    window.destination = '';
    // Observe the production navigation attribute without making business requests.
    document.querySelector('#platform-admin-shell').addEventListener('click', event => {
      const target = event.target.closest('[data-platform-admin-page]');
      if (target) window.destination = target.dataset.platformAdminPage;
    });
  });
}

test('平台首页直接显示全部管理入口，整行及键盘操作保留目标', async ({ page }) => {
  await fixture(page);
  const area = page.getByRole('region', { name: '管理功能', exact: true });
  await expect(area.locator('details')).toHaveCount(0);
  await expect(area.locator('.pc-home-settings-group')).toHaveCount(5);
  const destinations = ['users', 'roles', 'access', 'organizations', 'content', 'feedback', 'payments', 'pricing', 'flags', 'audit', 'reminders'];
  await expect(area.getByRole('button')).toHaveCount(destinations.length);
  for (const destination of destinations) {
    const button = area.locator(`[data-platform-admin-page="${destination}"]`);
    await expect(button).toBeVisible();
    await button.click({ position: { x: 8, y: 20 } });
    expect(await page.evaluate(() => window.destination)).toBe(destination);
    await button.focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.destination)).toBe(destination);
  }
  await expect(area.locator('.pc-grouped-arrow')).toHaveCount(11);
});

test('平台总览只显示提醒数量，入口打开独立页面', async ({ page }) => {
  await fixture(page);
  const overview = page.locator('.pc-home-settings');
  const entry = overview.getByRole('button', { name: /运行提醒/ });
  await expect(entry).toContainText('36 项');
  await expect(overview.getByLabel('筛选运行提醒')).toHaveCount(0);
  await entry.click();
  expect(await page.evaluate(() => window.destination)).toBe('reminders');
});

test('分组列表在窄屏和深色模式保持行高、分隔和清晰层级', async ({ page }, info) => {
  await fixture(page);
  const area = page.locator('.pc-home-settings');
  for (const width of [1440, 650, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await area.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const dimensions = await area.locator('button').evaluateAll(rows => rows.map(row => {
      const rect = row.getBoundingClientRect();
      return { height: rect.height, weight: getComputedStyle(row.querySelector('.pc-home-settings-label')).fontWeight };
    }));
    for (const row of dimensions) { expect(row.height).toBeGreaterThanOrEqual(44); expect(row.weight).toBe('400'); }
    const groups = await area.locator('.pc-home-settings-group').evaluateAll(groups => groups.map(group => {
      const caption = group.querySelector('h3').getBoundingClientRect(), list = group.querySelector('.pc-home-settings-list').getBoundingClientRect();
      return { captionBottom: caption.bottom, listTop: list.top };
    }));
    for (const group of groups) expect(group.captionBottom).toBeLessThan(group.listTop);
    if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`home-groups-${width}-light.png`) });
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  const first = area.locator('button').first();
  const light = await first.evaluate(el => getComputedStyle(el).color);
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  expect(await first.evaluate(el => getComputedStyle(el).color)).not.toBe(light);
  await first.focus();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.screenshot({ path: info.outputPath('home-groups-390-dark.png') });
});
