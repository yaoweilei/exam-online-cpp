const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
let fixture;
async function payload(response) {
  const json = await response.json();
  expect(response.ok(), JSON.stringify(json)).toBeTruthy();
  return json.data;
}
test.beforeAll(async ({ request }) => {
  if ((process.env.PLAYWRIGHT_BASE_URL || '').includes(':8080')) throw new Error('Use an isolated test server');
  const names = { superAdmin: uniqueLoginId('superadmin_ui_round1'), contentAdmin: uniqueLoginId('contentadmin_ui_round1'), student: uniqueLoginId('student_ui_round1'), orgAdmin: uniqueLoginId('student_ui_round1_manager') };
  const users = {};
  for (const [role, name] of Object.entries(names)) users[role] = await loginApi(request, name);
  const headers = { Authorization: 'Bearer ' + users.superAdmin.token };
  const post = (url, data) => request.post('/api/v1' + url, { headers, data }).then(payload);
  const org = await post('/organizations', { name: uniqueLoginId('UI验收机构'), organization_type: 'school', plan: 'ultra', seats: 30 });
  const oid = org.organization_id;
  for (const role of ['orgAdmin', 'student']) await post('/organizations/' + oid + '/members', { user_id: users[role].user_id, roles: [role], confirmation: '确认修改机构成员', reauth_password: '' });
  const templates = [];
  for (const title of ['综合课程', '听力课程']) templates.push(await post('/organizations/' + oid + '/course-packages', { title, record_type: 'template', total_lessons: 20, status: 'active' }));
  for (const title of ['学员课时一', '学员课时二']) await post('/organizations/' + oid + '/course-packages', { title, record_type: 'assignment', template_id: templates[0].course_package_id, student_id: users.student.user_id, total_lessons: 20, status: 'active' });
  fixture = { names, users, oid };
});
async function enter(page, role) {
  await loginApi(page.request, fixture.names[role]);
  const ctx = await payload(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(ctx => localStorage.setItem('exam_v2_user', JSON.stringify({ ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, memberships: ctx.memberships, organizations: ctx.organizations, permissions: ctx.permissions, subscription: ctx.subscription })), ctx);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('[data-role-workbench="' + role + '"]').click();
  }
  await expect(shell).toHaveAttribute('data-learning-role', role);
  await page.waitForLoadState('networkidle');
  return shell;
}
async function fits(locator, width) {
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
}

test('听力图片恢复桌面宽度后仍适应手机，放大可查看右侧并返回原题', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('exam-image-width', '1200'));
  await enter(page, 'student');
  await page.evaluate(async () => {
    const data = await window.APIClient.getExam('N3_2010_07');
    window.closeLearningWorkspace();
    window.postMessage({ type: 'loadExam', examId: 'N3_2010_07', data }, location.origin);
  });
  await page.locator('#current-question-container .option').first().waitFor();
  await page.evaluate(() => {
    const v = window.examViewer;
    v.jumpToQuestion(v.currentExam.exam_info.sections.findIndex(s => s.section_type === 'listening'), 0, false);
  });
  const image = page.locator('.question-passage .exam-image-wrapper').first();
  await expect(image.locator('img')).toBeVisible();
  for (const width of [390, 842, 1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await fits(image, width);
    expect(await page.locator('#exam-content').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('listening-mobile.png') });
  const trigger = page.getByRole('button', { name: '放大图片', exact: true }).first();
  await trigger.click();
  const detail = page.getByRole('dialog', { name: '题目图片详情' });
  await expect(detail).toBeVisible();
  await fits(detail, 390);
  const viewport = detail.locator('.exam-image-detail-viewport');
  expect(await viewport.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy();
  await viewport.evaluate(el => el.scrollLeft = el.scrollWidth);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('#current-question-container .option')).toHaveCount(4);
});

test('390px 新建机构完整显示按钮，保留字段并成功创建', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin');
  await navigateWorkspace(shell, 'organizations', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await shell.locator('[data-platform-org-create-panel] > summary').click();
  const form = shell.locator('[data-platform-org-create-form]');
  const create = form.getByRole('button', { name: '创建机构', exact: true });
  await fits(create, 390);
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await create.click();
  expect(await form.locator('[data-platform-org-name]').evaluate(el => el.validity.valueMissing)).toBeTruthy();
  const name = uniqueLoginId('窄屏机构名称验收');
  await form.locator('[data-platform-org-name]').fill(name);
  await form.locator('[data-platform-org-seats]').fill('27');
  await page.screenshot({ path: info.outputPath('create-organization-mobile.png') });
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/v1/organizations') && r.request().method() === 'POST');
  await create.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({ name, seats: 27 });
  await expect(shell.locator('.pc-org-directory-list')).toContainText(name);
});

for (const role of ['contentAdmin', 'superAdmin']) test(role + ' 慢请求不会覆盖最新反馈搜索，支持空结果和失败重试', async ({ page }) => {
  let releaseOld, oldStarted = false, fail = false;
  const requests = [];
  await page.route('**/api/v1/feedback?**', async route => {
    const url = new URL(route.request().url()), q = url.searchParams.get('q') || '';
    requests.push(q);
    if (!q && url.searchParams.get('page_size') === '50') {
      oldStarted = true;
      await new Promise(resolve => releaseOld = resolve);
      if (role === 'contentAdmin') return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '过期请求失败' } });
    }
    if (q === '触发失败' && fail) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '临时不可用' } });
    const items = q === '没有匹配' ? [] : Array.from({ length: q ? 1 : 20 }, (_, i) => ({ feedback_id: 'round1-' + i, paper_id: 'N3_2010_07', question_id: '1', category: 'analysis', status: 'open', description: q || '旧反馈 ' + i }));
    await route.fulfill({ json: { code: 'OK', data: { items, total: q ? items.length : 40, pages: q ? 1 : 2, summary: { pending_total: 40 } } } });
  });
  const shell = await enter(page, role);
  await navigateWorkspace(shell, role === 'superAdmin' ? 'feedback' : 'openRoleContent:content-feedback', role === 'superAdmin');
  await expect(shell.locator('[data-content-feedback-row]')).toHaveCount(20);
  await shell.getByText('更多筛选', { exact: true }).click();
  await shell.locator('[data-platform-feedback-page-size]').selectOption('50');
  await expect.poll(() => oldStarted).toBeTruthy();
  const input = shell.locator('[data-platform-feedback-query]');
  await input.fill('最新解析');
  await input.press('Enter');
  await expect(shell.locator('[data-content-feedback-row]')).toHaveCount(1);
  releaseOld();
  await page.waitForLoadState('networkidle');
  await expect(input).toHaveValue('最新解析');
  await expect(shell.locator('.pc-content-list-heading')).toContainText('共 1 条');
  await expect(shell.locator('[data-content-feedback-row]')).toContainText('最新解析');
  await expect(shell.getByRole('alert')).toHaveCount(0);
  for (const query of ['没有匹配', '触发失败']) {
    fail = query === '触发失败';
    await input.fill(query); await input.press('Enter');
    await expect(shell.locator('[data-content-feedback-row]')).toHaveCount(0);
    await expect(shell.locator(query === '没有匹配' ? '.pc-content-empty' : '[role=alert]')).toContainText(query === '没有匹配' ? '没有符合条件' : '临时不可用');
  }
  fail = false;
  await shell.locator('[data-platform-feedback-refresh]').click();
  await expect(shell.locator('[data-content-feedback-row]')).toHaveCount(1);
  expect(requests).toContain('最新解析');
});

test('机构首页模板数与课程包列表一致，不计入学员课时账户', async ({ page }) => {
  const shell = await enter(page, 'orgAdmin');
  const stat = shell.locator('.pc-platform-stat[data-role-admin-intent="openRoleContent:org-course-packages"]');
  await expect(stat.locator('strong')).toHaveText('2');
  await stat.click();
  await expect(shell.locator('.pc-package-row.pc-package-template-grid')).toHaveCount(2);
  await payload(await page.request.post('/api/v1/organizations/' + fixture.oid + '/course-packages', { headers: { Authorization: 'Bearer ' + fixture.users.superAdmin.token }, data: { title: '旧规格课程', record_type: 'assignment', student_id: fixture.users.student.user_id, total_lessons: 8, status: 'active' } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  await expect(stat.locator('strong')).toHaveText('3');
  await stat.click();
  await expect(shell.locator('.pc-package-row.pc-package-template-grid')).toHaveCount(3);
});

for (const role of ['student', 'orgAdmin', 'superAdmin']) test(role + ' 公共资料与安全页紧凑、深色可读，并返回原角色', async ({ page }, info) => {
  let shell = await enter(page, role);
  await page.setViewportSize({ width: 390, height: 844 });
  await shell.locator('[data-platform-admin-account-menu]').click();
  await page.getByRole('menuitem', { name: '个人资料', exact: true }).click();
  const root = page.locator('#personal-center');
  await expect(root).toBeVisible();
  expect((await root.locator('#pc-header-back').boundingBox()).y).toBeGreaterThanOrEqual(44);
  expect((await root.locator('[data-profile-destination=account-nickname]').boundingBox()).y).toBeLessThan(400);
  await expect(root.getByText('邀请好友', { exact: true })).toHaveCount(0);
  const contacts = root.locator('[data-profile-contacts]');
  await expect(contacts).not.toHaveAttribute('open');
  await contacts.locator('summary').click();
  await contacts.getByRole('button', { name: /^(绑定|去验证|修改)$/ }).first().click();
  await expect(root.locator('[data-verify-email]')).toBeVisible();
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  expect(await root.locator('.pc-verify-row-card').first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: info.outputPath('profile-mobile.png') });
  await root.locator('#pc-header-back').click();
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute('data-learning-role', role);
  await shell.locator('[data-platform-admin-account-menu]').click();
  await page.getByRole('menuitem', { name: '账号安全', exact: true }).click();
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  const card = root.locator('.pc-account-card');
  expect(await card.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await fits(card, 390);
  await root.locator('[data-account-action=sessions]').click();
  await expect(root.locator('.pc-account-session-list')).toBeVisible();
  const darkText = await root.locator('.pc-subpage-title, .pc-account-session-main > span').evaluateAll(nodes => nodes.filter(el => el.checkVisibility()).map(el => {
    const rgb = getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    return Math.max(...rgb);
  }));
  expect(darkText.length).toBeGreaterThan(1);
  expect(Math.min(...darkText)).toBeGreaterThan(120);
  expect(await root.locator('.pc-content').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('security-dark-mobile.png') });
  await root.locator('#pc-header-back').click();
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute('data-learning-role', role);
});
