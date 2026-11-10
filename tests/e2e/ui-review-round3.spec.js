const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');
const fs = require('fs');
const path = require('path');
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
let fixture;
const auth = token => ({ Authorization: 'Bearer ' + token });
async function data(response) { const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body.data; }
test.beforeAll(async ({ request }) => {
  if (new URL(process.env.PLAYWRIGHT_BASE_URL).port !== '8083') throw Error('Isolated 8083 required');
  const names = { superAdmin: uniqueLoginId('superadmin_ui_r3'), contentAdmin: uniqueLoginId('contentadmin_ui_r3'), student: uniqueLoginId('student_ui_r3'), orgAdmin: uniqueLoginId('student_ui_r3_manager') }, users = {};
  for (const [role, name] of Object.entries(names)) users[role] = await loginApi(request, name);
  for (const [role, user] of Object.entries(users)) await data(await request.put('/api/v1/profile/' + user.user_id, { headers: auth(user.token), data: { display_name: role === 'student' ? '陈同学 · 三轮验收' : role === 'superAdmin' ? '平台负责人 · 三轮验收' : role === 'orgAdmin' ? '机构负责人 · 三轮验收' : '内容编辑 · 三轮验收' } }));
  const organization = await data(await request.post('/api/v1/organizations', { headers: auth(users.superAdmin.token), data: { name: uniqueLoginId('三轮布局验收学校'), organization_type: 'school', plan: 'ultra', seats: 30 } }));
  const oid = organization.organization_id;
  for (const role of ['orgAdmin', 'student']) await data(await request.post('/api/v1/organizations/' + oid + '/members', { headers: auth(users.superAdmin.token), data: { user_id: users[role].user_id, roles: [role], confirmation: '确认修改机构成员', reauth_password: '' } }));
  await data(await request.post('/api/v1/organizations/' + oid + '/course-packages', { headers: auth(users.superAdmin.token), data: { title: '学员课程入口验收', record_type: 'assignment', student_id: users.student.user_id, total_lessons: 10, status: 'active' } }));
  await data(await request.post('/api/v1/admin/content/workflow/N3_2010_07/inspect', { headers: auth(users.superAdmin.token), data: {} }));
  fixture = { names, users, oid };
  fs.writeFileSync(path.resolve('tmp/ui-round3-fixes-20261028/fixture.json'), JSON.stringify(fixture));
  const history = path.resolve('tmp/role-fixes-20261020/data/user/answers', users.student.user_id, '_history/N3_2010_07'); fs.mkdirSync(history, { recursive: true });
  for (const [index, saved_at] of ['2026-10-25T16:30:00Z', '2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z', '2026-03-09T06:30:00Z', '2026-03-08T07:30:00Z', '2026-10-25T16:00:00+08:00'].entries()) {
    fs.writeFileSync(path.join(history, index + '.json'), JSON.stringify({ user_id: users.student.user_id, exam_id: 'N3_2010_07', saved_at, submission_id: 'local-zone-' + index, attempt_id: 'local-zone-' + index, statistics: { results: { '0:1': { status: 'correct', section_index: 0, question_id: '1' } } } }));
  }
});
async function enter(page, role) {
  await loginApi(page.request, fixture.names[role]);
  const ctx = await data(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(ctx => localStorage.setItem('exam_v2_user', JSON.stringify({ ...ctx.user, token: '', guest: false, profile: ctx.profile, membership: ctx.membership, memberships: ctx.memberships, organizations: ctx.organizations, permissions: ctx.permissions, subscription: ctx.subscription })), ctx);
  await page.goto('/', { waitUntil: 'networkidle' }); await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) { await shell.locator('[data-platform-admin-account-menu]').click(); await shell.locator('[data-role-workbench="' + role + '"]').click(); }
  await expect(shell).toHaveAttribute('data-learning-role', role); await page.waitForLoadState('networkidle'); return shell;
}
async function noOverflow(root) { expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); }
async function fits(locator, width = 390) { const b = await locator.boundingBox(); expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.x + b.width).toBeLessThanOrEqual(width + 1); }

test('UI10 手机套餐逐项编辑，无内部横滚且切换套餐保留输入', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin'); await navigateWorkspace(shell, 'pricing', true); await page.setViewportSize({ width: 390, height: 844 });
  const form = shell.locator('[data-pricing-form]'), personal = form.locator('[data-pricing-plan-panel="personal"]');
  const pro = personal.getByRole('button', { name: 'PRO 套餐' }), ultra = personal.getByRole('button', { name: 'ULTRA 套餐' });
  await expect(pro).toHaveAttribute('aria-expanded', 'true');
  const price = personal.getByRole('spinbutton', { name: '个人 PRO 30 天当前售价', exact: true });
  await price.fill('29.99'); await fits(price); await noOverflow(personal.locator('.pc-responsive-table-region'));
  await ultra.click(); await expect(price).not.toBeVisible(); await pro.click(); await expect(price).toHaveValue('29.99');
  await form.getByRole('tab', { name: '学校 / 教育机构', exact: true }).first().click();
  const organization = form.locator('[data-pricing-plan-panel="organization"]').first(); await fits(organization.getByRole('spinbutton', { name: '机构 PRO 30 天当前售价', exact: true }));
  for (const region of await form.locator('.pc-responsive-table-region:visible').all()) await noOverflow(region);
  await noOverflow(shell.locator('main')); await page.screenshot({ path: info.outputPath('pricing-mobile.png') });
});

test('UI10 机构名单在手机和桌面统一为整行详情列表', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin'); await navigateWorkspace(shell, 'organizations', true); await page.setViewportSize({ width: 390, height: 844 });
  const table = shell.locator('.pc-org-directory-list'); await expect(table.locator('[role=listitem]').first()).toBeVisible();
  await noOverflow(table); await fits(table.locator('[role=listitem]').first().getByRole('button'));
  await page.screenshot({ path: info.outputPath('org-cards-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(table.locator('[role=listitem]').first().getByRole('button')).toBeVisible();
});

test('UI10 审计筛选简洁，手机记录详情就近可见并支持深色', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin'); await navigateWorkspace(shell, 'audit', true); await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell.locator('#al-body tbody tr').first()).toBeVisible();
  await expect(shell.locator('#al-actor')).not.toBeVisible(); await expect(shell.locator('#al-limit')).toHaveValue('20');
  await noOverflow(shell.locator('.pc-audit-table')); await noOverflow(shell.locator('#al-body'));
  const first = shell.locator('#al-body [data-audit-detail]').first(); await fits(first); await first.click();
  const detail = shell.locator('.pc-platform-audit-detail'); await expect(detail).toBeVisible(); await fits(detail); await shell.getByRole('button', { name: '返回审计日志' }).click();
  await page.evaluate(() => document.body.classList.remove('light-theme')); await page.screenshot({ path: info.outputPath('audit-mobile-dark.png') });
});

test('UI11 运行提醒在独立页展示，平台总览显示提醒数量', async ({ page }, info) => {
  await page.route('**/api/v1/admin/operations?*', route => route.fulfill({ json: { code: 'OK', data: { counts: { failed_payment: 17 }, items: Array.from({ length: 17 }, (_, i) => ({ id: 'reminder-' + i, title: '失败支付提醒 ' + (i + 1), type: 'failed_payment', destination: 'payments', created_at: '2026-10-26T16:30:00Z' })), checks: [], note: 'UTC 当日失败支付与跨日未处理事项' } } }));
  const shell = await enter(page, 'superAdmin'), panel = shell.locator('[data-product-panel="platform-operations"]');
  const entry = panel.locator('[data-platform-admin-page="reminders"]');
  await expect(entry).toContainText('17 项');
  await expect(panel.locator('.pc-grouped-entry')).toHaveCount(0);
  await entry.click();
  await expect(shell.getByRole('heading', { name: '运行提醒', exact: true })).toBeVisible();
  await expect(panel.locator('.pc-grouped-entry')).toHaveCount(17);
  await shell.locator('[data-workspace-back]').click();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(shell.locator('.pc-home-functions')).toBeVisible(); await noOverflow(shell.locator('main'));
  await page.screenshot({ path: info.outputPath('platform-home-mobile.png') });
});

test('UI12 学员课程页有标题和首页入口，首页不重复出现诊断浮条', async ({ page }, info) => {
  const shell = await enter(page, 'student'); await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await shell.getByRole('button', { name: '课程与课时 →', exact: true }).click();
  await expect(shell.locator('main').getByRole('heading', { name: '我的课程', exact: true })).toBeVisible();
  await expect(shell.locator('main h1:visible')).toHaveCount(1);
  await expect(shell.locator('.pc-topbar-back')).toBeVisible(); await noOverflow(shell.locator('main')); await page.screenshot({ path: info.outputPath('student-courses-title.png') });
  await shell.locator('.pc-topbar-back').click(); await expect(shell.locator('main').getByRole('heading', { name: '学习首页', exact: true })).toBeVisible(); await expect(shell.locator('main h1:visible')).toHaveCount(1); await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
});

test('UI14 内容日志显示试卷、操作、姓名，技术字段留在详情', async ({ page }, info) => {
  await page.route('**/api/v1/admin/audit-logs?*', route => route.fulfill({ json: { code: 'OK', data: { items: [{ audit_id: 'audit-object-proof', object_id: 'N3_2024_12', action: 'content.exam.updated', action_label: '修改试卷内容', summary: '修改试卷内容', actor_display_name: '林老师', actor_user_id: 'usr-technical-long-id', created_at: '2026-10-26T16:30:00Z', details: { exam_id: 'N3_2024_12', version_id: 'version-proof' } }], total: 1 } } }));
  const shell = await enter(page, 'contentAdmin'); await navigateWorkspace(shell, 'openAuditLog'); await page.setViewportSize({ width: 390, height: 844 });
  const record = shell.locator('.pc-content-log-record').first(); await expect(record).toContainText('JLPT N3 · 2024年12月真题'); await expect(record).toContainText('林老师'); await expect(record.getByText('修改试卷内容', { exact: true })).toHaveCount(1); await expect(record).not.toContainText('usr-technical-long-id');
  await record.getByRole('button', { name: '查看详情' }).click(); await expect(page.locator('#ald-body')).toContainText('version-proof'); await expect(page.locator('#ald-body')).toContainText('usr-technical-long-id'); await page.locator('#ald-close').click();
  await noOverflow(shell.locator('main')); await page.screenshot({ path: info.outputPath('content-log-mobile.png') });
});

test('UI15 学习日期按用户时区划分，支持跨日、显式偏移和夏令时边界', async ({ request }) => {
  const progress = async (from, to, timezone) => data(await request.get('/api/v1/me/learning-progress?' + new URLSearchParams({ from, to, target: 'JLPT-N3', timezone }), { headers: auth(fixture.users.student.token) }));
  const shanghai = await progress('2026-10-26', '2026-10-26', 'Asia/Shanghai'); expect(shanghai.total.questions).toBe(1); expect(shanghai.timezone).toBe('Asia/Shanghai'); expect(shanghai.daily[0].date).toBe('2026-10-26');
  const utc = await progress('2026-10-26', '2026-10-26', 'UTC'); expect(utc.total.questions).toBe(0);
  const offset = await progress('2026-10-25', '2026-10-25', 'Asia/Shanghai'); expect(offset.total.questions).toBe(1);
  const dst = await progress('2026-03-08', '2026-03-08', 'America/Los_Angeles'); expect(dst.total.questions).toBe(3); expect(dst.total.attempts).toBe(3); expect(dst.daily).toHaveLength(1);
  expect((await request.get('/api/v1/me/learning-progress?timezone=Invalid/Zone', { headers: auth(fixture.users.student.token) })).status()).toBe(422);
});

test('UI15 成员按姓名搜索展示，审计仅补充必要姓名，不暴露联系方式', async ({ request, page }) => {
  const members = await data(await request.get('/api/v1/organizations/' + fixture.oid + '/members?q=' + encodeURIComponent('陈同学') + '&page=1', { headers: auth(fixture.users.orgAdmin.token) }));
  expect(members.items).toHaveLength(1); expect(members.items[0].display_name).toBe('陈同学 · 三轮验收'); expect(members.items[0].email).toBeUndefined();
  const logs = await data(await request.get('/api/v1/admin/audit-logs?actor_id=' + fixture.users.superAdmin.user_id, { headers: auth(fixture.users.superAdmin.token) }));
  expect(logs.items.length).toBeGreaterThan(0); expect(logs.items[0].actor_display_name).toBe('平台负责人 · 三轮验收'); expect(logs.items[0].email).toBeUndefined();
  const shell = await enter(page, 'orgAdmin'); await navigateWorkspace(shell, 'openRoleContent:org-members'); await expect(shell.locator('.pc-org-member-meta').filter({ hasText: '陈同学' }).first()).toBeVisible();
});

test('UI15 进步页面按浏览器时区查询并展示实际比较范围', async ({ page }) => {
  const shell = await enter(page, 'student'); await shell.locator('[data-archive-section=report]').click(); await shell.getByRole('button', { name: /^按目标比较学习进步/ }).click();
  const panel = shell.locator('[data-product-panel=progress]'); await expect(panel.locator('[name=from]')).toBeVisible();
  await panel.locator('[name=from]').fill('2026-10-26'); await panel.locator('[name=to]').fill('2026-10-26'); await panel.locator('[name=target]').selectOption('JLPT-N3');
  const response = page.waitForResponse(r => r.url().includes('/learning-progress?') && r.url().includes('timezone=Asia%2FShanghai'));
  await panel.getByRole('button', { name: '查看进步', exact: true }).click(); await response;
  await expect(panel).toContainText('共 1 题；时区 Asia/Shanghai'); await expect(panel).toContainText('2026-10-26 — 2026-10-26');
});

test('UI16 手机折叠可键盘操作，暗色审计详情保持可读并返回原按钮', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin'); await navigateWorkspace(shell, 'audit', true); await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell.locator('#al-body tbody tr').first()).toBeVisible();
  const more = shell.locator('.pc-audit-compact-filters summary'); await more.focus(); await page.keyboard.press('Space'); await expect(shell.locator('#al-actor')).toBeVisible();
  await page.keyboard.press('Space'); await expect(shell.locator('#al-actor')).not.toBeVisible();
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  const trigger = shell.locator('[data-audit-detail]').first(); await trigger.click(); const detail = shell.locator('.pc-platform-audit-detail'); await expect(detail).toBeVisible();
  const colors = await detail.locator('> dl').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  expect(colors.background).not.toBe('rgb(255, 255, 255)'); expect(colors.background).not.toBe(colors.color); await page.screenshot({ path: info.outputPath('audit-detail-dark.png') });
  await shell.getByRole('button', { name: '返回审计日志' }).click(); await expect(detail).not.toBeVisible(); await expect(trigger).toBeFocused();
});

test('套餐价格读取失败时不展示默认价格供编辑，恢复后可重新读取', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/payments/pricing', route => fail ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '价格读取暂不可用' } }) : route.fallback());
  const shell = await enter(page, 'superAdmin'); await navigateWorkspace(shell, 'pricing', true);
  await expect(shell.locator('main')).toContainText('价格读取暂不可用'); await expect(shell.locator('[data-pricing-form]')).toHaveCount(0);
  fail = false; await shell.getByRole('button', { name: '重新读取价格', exact: true }).click(); await expect(shell.locator('[data-pricing-form]')).toBeVisible();
});
