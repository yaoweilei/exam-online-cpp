const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');

async function ok(response) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body.data;
}
const auth = token => ({ Authorization: `Bearer ${token}` });

test('用户列表真实分页、完整搜索总数与平台权限隔离', async ({ request, playwright }, info) => {
  expect(new URL(info.project.use.baseURL).port).not.toBe('8080');
  const admin = await loginApi(request, 'superadmin_usability');
  const prefix = uniqueLoginId('student_directory');
  let first;
  for (let i = 0; i < 55; i++) {
    const user = await loginApi(request, `${prefix}_${String(i).padStart(2, '0')}`);
    if (!first) first = user;
  }
  const pages = [];
  for (let page = 1; page <= 6; page++) {
    const result = await ok(await request.get('/api/v1/admin/users', { headers: auth(admin.token), params: { q: prefix, page, page_size: 10 } }));
    expect(result.total).toBe(55);
    expect(result.pages).toBe(6);
    expect(result.page).toBe(page);
    expect(result.items).toHaveLength(page === 6 ? 5 : 10);
    expect(result.items.every(user => !('password_hash' in user))).toBe(true);
    pages.push(...result.items.map(user => user.id));
  }
  expect(new Set(pages).size).toBe(55);
  const clamp = await ok(await request.get('/api/v1/admin/users', { headers: auth(admin.token), params: { q: prefix, page: 999, page_size: 20 } }));
  expect(clamp.page).toBe(3); expect(clamp.items).toHaveLength(15);
  await ok(await request.put(`/api/v1/profile/${first.user_id}`, { headers: auth(first.token), data: { display_name: prefix + '姓名' } }));
  const byName = await ok(await request.get('/api/v1/admin/users', { headers: auth(admin.token), params: { q: prefix + '姓名' } }));
  expect(byName.total).toBe(1); expect(byName.items[0].id).toBe(first.user_id);
  expect((await request.get('/api/v1/admin/users', { headers: auth(first.token) })).status()).toBe(403);
  const anonymous = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  expect((await anonymous.get('/api/v1/admin/users')).status()).toBe(401);
  await anonymous.dispose();
});

async function openUsers(page, state) {
  state.requests = [];
  await page.route('**/api/v1/admin/users?**', async route => {
    const url = new URL(route.request().url()), q = url.searchParams.get('q') || '';
    state.requests.push({ q, page: Number(url.searchParams.get('page')), size: Number(url.searchParams.get('page_size')) });
    if (state.wait && (!q || q === '较慢')) await state.wait;
    if (state.fail) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '用户服务暂不可用' } });
    const size = Number(url.searchParams.get('page_size')), total = q === '没有匹配' ? 0 : q ? 1 : 24;
    const pages = Math.max(1, Math.ceil(total / size)), pageNumber = Math.min(pages, Number(url.searchParams.get('page')));
    const start = (pageNumber - 1) * size;
    const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, index) => ({
      id: `usability_${start + index}`, username: `account_${start + index}`, display_name: q || `测试用户 ${start + index}`,
      roles: ['student'], status: index === 1 ? 'disabled' : 'active', last_active_at: '2026-10-20T08:00:00Z'
    }));
    await route.fulfill({ json: { code: 'OK', data: { items, total, page: pageNumber, pages, page_size: size } } });
  });
  await loginApi(page.request, 'superadmin_usability_ui');
  const ctx = await ok(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), { ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, permissions: ctx.permissions, subscription: ctx.subscription });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe('superadmin_usability_ui');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== 'superAdmin') {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('[data-role-workbench="superAdmin"]').click();
  }
  await navigateWorkspace(shell, 'users', true);
  return shell;
}

test('用户页只有一个加载状态，搜索分页、空结果、失败重试与详情返回自然衔接', async ({ page }, info) => {
  let release;
  const state = { wait: new Promise(resolve => { release = resolve; }) };
  const shell = await openUsers(page, state);
  await expect(shell.locator('.pc-user-loading')).toBeVisible();
  await expect(shell.locator('.pc-user-skeleton')).toHaveCount(5);
  await expect(shell.locator('.pc-admin-list-pagination')).toHaveCount(0);
  await expect(shell.locator('.pc-user-empty')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('users-loading.png') });
  state.wait = null; release();
  await expect(shell.locator('.pc-user-table tbody tr')).toHaveCount(10);
  await expect(shell.locator('.pc-admin-list-page-status')).toHaveText('共 24 人');
  await page.screenshot({ path: info.outputPath('users-list-desktop.png') });
  const footerBelowTable = await shell.locator('.pc-user-results').evaluate(root => root.querySelector('.pc-admin-list-pagination').getBoundingClientRect().top >= root.querySelector('table').getBoundingClientRect().bottom);
  expect(footerBelowTable).toBe(true);
  await shell.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(shell.locator('.pc-user-name').first()).toHaveText('测试用户 10');
  await shell.locator('[data-platform-user-page-size]').selectOption('20', { force: true });
  await expect(shell.locator('.pc-user-table tbody tr')).toHaveCount(20);
  expect(state.requests.at(-1)).toMatchObject({ page: 1, size: 20 });
  await shell.getByLabel('搜索用户').fill('没有匹配');
  await shell.getByLabel('搜索用户').press('Enter');
  await expect(shell.locator('.pc-user-empty')).toContainText('没有找到相关用户');
  await expect(shell.getByLabel('跳至页码')).toHaveCount(0);
  await shell.locator('form[data-platform-user-search-form] [data-platform-user-clear]').click();
  await expect(shell.locator('.pc-user-table tbody tr')).toHaveCount(20);
  state.fail = true;
  await shell.getByLabel('搜索用户').fill('保留关键词');
  await shell.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(shell.getByRole('alert')).toContainText('用户服务暂不可用');
  await expect(shell.getByLabel('搜索用户')).toHaveValue('保留关键词');
  state.fail = false;
  await shell.getByRole('button', { name: '重试', exact: true }).click();
  await expect(shell.locator('.pc-user-table tbody tr')).toHaveCount(1);
  await expect(shell.getByLabel('跳至页码')).toHaveCount(0);
  await shell.locator('.pc-user-name').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toContainText('保留关键词');
  await shell.locator('.pc-topbar-back').click();
  await expect(shell.getByLabel('搜索用户')).toHaveValue('保留关键词');
  await page.screenshot({ path: info.outputPath('users-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await shell.locator('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(shell.locator('.pc-user-detail')).toBeVisible();
  await page.screenshot({ path: info.outputPath('users-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.ls-theme-control').getByRole('button', { name: '显示主题', exact: true }).click();
  await page.locator('[data-theme-mode="dark"]').click();
  expect(await shell.locator('.pc-user-results').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await expect.poll(() => shell.evaluate(element => {
    const back = getComputedStyle(element.querySelector('.pc-topbar-back'));
    return back.backgroundColor === getComputedStyle(element.querySelector('.pc-platform-topbar')).backgroundColor;
  })).toBe(true);
  const contrast = await shell.locator('.pc-user-results').evaluate(element => {
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const background = luminance(getComputedStyle(element).backgroundColor);
    const foreground = luminance(getComputedStyle(element.querySelector('.pc-admin-list-page-status')).color);
    return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await shell.locator('.pc-admin-list-page-size > summary').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(248, 246, 243)');
  await page.screenshot({ path: info.outputPath('users-dark.png') });
});

test('过期搜索响应不覆盖新结果，分区切换保留用户搜索', async ({ page }) => {
  const state = {};
  const shell = await openUsers(page, state);
  await expect(shell.locator('.pc-user-table tbody tr')).toHaveCount(10);
  let release;
  state.wait = new Promise(resolve => { release = resolve; });
  await shell.getByLabel('搜索用户').fill('较慢');
  await shell.getByLabel('搜索用户').press('Enter');
  await expect.poll(() => state.requests.some(request => request.q === '较慢')).toBe(true);
  await shell.getByLabel('搜索用户').fill('新结果');
  await shell.getByLabel('搜索用户').press('Enter');
  await expect(shell.locator('.pc-user-name')).toHaveText('新结果');
  release(); state.wait = null;
  await page.waitForLoadState('networkidle');
  await expect(shell.locator('.pc-user-name')).toHaveText('新结果');
  await expect(shell.locator('.pc-platform-nav-toggle')).toHaveCount(0);
  await navigateWorkspace(shell, 'organizations', true);
  await expect(shell.locator('.pc-workspace-section-tabs')).toHaveCount(0);
  await navigateWorkspace(shell, 'users', true);
  await expect(shell.getByLabel('搜索用户')).toHaveValue('新结果');
});
