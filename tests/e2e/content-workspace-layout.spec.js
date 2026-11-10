const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');

async function fixture(page) {
  const state = { auditRequests: [], feedbackRequests: [], failAudit: false, failFeedback: false };
  state.feedback = Array.from({ length: 23 }, (_, i) => ({
    feedback_id: `layout-feedback-${i}`, paper_id: 'N3_2024_12', question_id: String(i + 1),
    category: 'analysis', description: `第 ${i + 1} 题的解析需要核对，包含长说明时也应能完整阅读。`,
    status: i === 0 ? 'open' : i === 1 ? 'reviewing' : 'resolved', created_at: '2026-10-22T12:00:00Z'
  }));
  const exams = Array.from({ length: 25 }, (_, i) => ({ id: `layout-exam-${i}`, title: `JLPT N3 · 布局验证试卷 ${i}`, question_count: 10 }));
  await page.route('**/api/v1/feedback**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'PATCH') {
      const item = state.feedback.find(row => row.feedback_id === url.pathname.split('/').pop());
      item.status = req.postDataJSON().status;
      return route.fulfill({ json: { code: 'OK', data: item } });
    }
    state.feedbackRequests.push(url.searchParams.toString());
    if (state.failFeedback) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '反馈服务暂不可用' } });
    const q = url.searchParams.get('q') || '', size = Number(url.searchParams.get('page_size') || 20), pageNo = Number(url.searchParams.get('page') || 1);
    const matching = state.feedback.filter(item => JSON.stringify(item).includes(q));
    await route.fulfill({ json: { code: 'OK', data: { items: matching.slice((pageNo - 1) * size, pageNo * size), total: matching.length, pages: Math.ceil(matching.length / size), summary: { pending_total: 2 } } } });
  });
  await page.route('**/api/v1/exams?**', route => route.fulfill({ json: { code: 'OK', data: exams } }));
  state.workflows = [
    { exam_id: exams[0].id, inspection: { passed: false, errors: [{ message: '缺少答案' }] } },
    { exam_id: exams[1].id, inspection: { passed: true }, reviews: {} }
  ];
  await page.route('**/api/v1/admin/content/workflow?**', route => route.fulfill({ json: { code: 'OK', data: state.workflows } }));
  await page.route('**/api/v1/admin/content/workflow/*/inspect', route => {
    const examId = new URL(route.request().url()).pathname.split('/').at(-2);
    const item = state.workflows.find(row => row.exam_id === examId);
    item.inspection = { passed: true, errors: [], warnings: [] };
    return route.fulfill({ json: { code: 'OK', data: item } });
  });
  await page.route('**/api/v1/admin/audit-logs**', async route => {
    const url = new URL(route.request().url());
    state.auditRequests.push(url.searchParams.toString());
    if (state.failAudit) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '日志服务暂不可用' } });
    const data = url.pathname.endsWith('/actions') ? { actions: ['content.workflow.inspected'], action_options: [{ value: 'content.workflow.inspected', label: '试卷质量检查' }] } : {
      items: url.searchParams.get('actor_id') ? [] : [{ id: 'content-layout-audit', action: 'content.workflow.inspected', action_label: '试卷质量检查', actor_username: '内容教师', summary: '已检查 N3 试卷', created_at: '2026-10-22T12:00:00Z', details: { exam_id: exams[0].id } }],
      total: url.searchParams.get('actor_id') ? 0 : 1
    };
    await route.fulfill({ json: { code: 'OK', data } });
  });
  await loginApi(page.request, 'superadmin_content_layout');
  const ctx = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), { ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, permissions: ctx.permissions, subscription: ctx.subscription });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.locator('.pc-role-identity-menu > summary').click();
  await shell.locator('[data-role-workbench=contentAdmin]').click();
  await expect(shell).toHaveAttribute('data-learning-role', 'contentAdmin');
  return { shell, state };
}

test('内容工作台的常用功能使用单层分组，三个入口可进入独立页面并返回', async ({ page }, info) => {
  const { shell, state } = await fixture(page);
  const functions = shell.getByRole('region', { name: '常用功能' });
  const list = functions.locator('.pc-home-settings-list');
  const rows = list.locator('button');
  await page.evaluate(() => document.body.classList.add('light-theme'));
  await expect(rows).toHaveText(['内容反馈', '发布工作流', '内容日志']);
  await expect(rows.locator('.pc-grouped-arrow')).toHaveCount(3);
  await expect(rows.locator('.pc-home-settings-icon')).toHaveCount(3);
  await expect(functions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(list).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const geometry = await rows.evaluateAll(items => items.map(row => ({ width: row.offsetWidth, height: row.offsetHeight, left: row.offsetLeft })));
    expect(geometry.every(row => row.width === geometry[0].width && row.left === geometry[0].left && row.height === geometry[0].height)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await list.screenshot({ path: info.outputPath('content-home-list-light.png') });
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  await expect(list).toHaveCSS('background-color', 'rgb(28, 28, 30)');
  await list.screenshot({ path: info.outputPath('content-home-list-dark.png') });
  for (const [name, ready] of [
    ['内容反馈', '[data-content-feedback-row]'],
    ['发布工作流', '[data-content-workflow-row]'],
    ['内容日志', '.pc-content-log-record']
  ]) {
    await list.getByRole('button', { name, exact: true }).click();
    await expect(shell.locator('main h1')).toHaveText(name);
    await expect(shell.locator(ready).first()).toBeVisible();
    await expect(functions).toHaveCount(0);
    await shell.locator('.pc-topbar-back').click();
    await expect(shell.locator('main h1')).toHaveText('内容工作台');
    await expect(list).toBeVisible();
  }
  expect(state.auditRequests.length).toBeGreaterThan(1);
  expect(state.auditRequests.every(query => new URLSearchParams(query).get('scope') === 'content')).toBe(true);
  await expect(shell.getByText('查看真实审计日志', { exact: true })).toHaveCount(0);
});

test('反馈筛选、分页和处理可用，已关闭记录没有重复受理按钮', async ({ page }) => {
  const { shell, state } = await fixture(page);
  await navigateWorkspace(shell, 'openRoleContent:content-feedback');
  const rows = shell.locator('[data-content-feedback-row]');
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(2).locator('[data-feedback-update]')).toHaveCount(0);
  await expect(rows.nth(1).locator('[data-feedback-status=reviewing]')).toHaveCount(0);
  await rows.first().locator('[data-content-record] > summary').click();
  const reply = rows.first().getByRole('textbox', { name: '给反馈者的回复' });
  await reply.fill('正在核对题目解析');
  await rows.first().getByRole('button', { name: '受理', exact: true }).click();
  await expect(rows.first()).toContainText('处理中');
  await expect(reply).toBeVisible();
  await expect(reply).toHaveValue('正在核对题目解析');
  await rows.first().getByRole('button', { name: '关闭', exact: true }).click();
  await expect(rows.first()).toContainText('已关闭');
  await expect(rows.first().locator('[data-feedback-update]')).toHaveCount(0);
  await shell.locator('[data-platform-feedback-page=next]').click();
  await expect(rows.first()).toHaveAttribute('data-content-feedback-id', 'layout-feedback-10');
  expect(new URLSearchParams(state.feedbackRequests.at(-1)).get('page')).toBe('2');
  await shell.locator('[data-platform-feedback-page=next]').click();
  await expect(rows).toHaveCount(3);
  expect(new URLSearchParams(state.feedbackRequests.at(-1)).get('page')).toBe('3');
  const filterToggle = shell.locator('summary[aria-label="搜索筛选"]');
  const pageSize = shell.locator('[data-platform-feedback-page-size]');
  await filterToggle.click();
  await pageSize.selectOption('20');
  await expect(rows).toHaveCount(20);
  if (!(await pageSize.isVisible())) await filterToggle.click();
  await pageSize.selectOption('10');
  await expect(rows).toHaveCount(10);
  await shell.locator('[data-platform-feedback-query]').fill('没有这条反馈');
  await shell.locator('[data-platform-feedback-query]').press('Enter');
  await expect(shell.locator('.pc-content-empty')).toContainText('没有符合条件');
  state.failFeedback = true;
  await shell.locator('[data-platform-feedback-query]').fill('');
  await shell.locator('[data-platform-feedback-query]').press('Enter');
  await expect(shell.getByRole('alert')).toContainText('反馈服务暂不可用');
  state.failFeedback = false;
  await shell.locator('[data-platform-feedback-refresh]').click();
  await expect(rows).toHaveCount(10);
});

test('反馈和发布工作流采用可展开的紧凑分组，选择和检查后保留展开状态', async ({ page }, info) => {
  const { shell, state } = await fixture(page);
  state.feedback[2].category = 'account';
  state.feedback[2].paper_id = '';
  state.feedback[2].question_id = '';
  await page.evaluate(() => document.body.classList.add('light-theme'));
  const main = shell.locator('main');
  for (const [intent, rowSelector, name] of [
    ['openRoleContent:content-feedback', '[data-content-feedback-row]', 'feedback'],
    ['openRoleContent:content-publish', '[data-content-workflow-row]', 'workflow']
  ]) {
    await navigateWorkspace(shell, intent);
    if (name === 'feedback') await shell.locator('[data-platform-feedback-query]').press('Enter');
    const rows = shell.locator(rowSelector);
    await expect(rows).toHaveCount(10);
    const first = rows.first();
    const details = first.locator('details[data-content-record]');
    await expect(details).not.toHaveAttribute('open');
    if (name === 'feedback') await expect(rows.nth(2).locator('.pc-content-record-copy > strong')).toHaveText('账号问题');
    else await expect(shell.locator('[data-content-workflow-batch-inspect]')).toBeHidden();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      expect((await first.boundingBox()).height).toBeLessThan(120);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await main.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath(`${name}-mobile.png`) });
    await details.locator(':scope > summary').click();
    if (name === 'workflow') {
      await expect(first.getByText('缺少答案', { exact: true })).toBeVisible();
      await first.locator('[data-content-workflow-select]').check();
      await expect(details).toHaveAttribute('open');
      await expect(shell.locator('[data-content-workflow-batch-inspect]')).toBeVisible();
      await first.locator('[data-content-workflow-action=inspect]').click();
      await expect(first).toContainText('待解析审核');
      await expect(details).toHaveAttribute('open');
      await expect(first.locator('[data-content-workflow-action=analysis]')).toBeVisible();
      await expect(first.locator('[data-content-workflow-select]')).toBeChecked();
    } else {
      await expect(first.getByRole('button', { name: '受理', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`${name}-expanded-mobile.png`) });
    await page.evaluate(() => document.body.classList.remove('light-theme'));
    await expect(shell.locator('.pc-content-queue > .pc-grouped-list')).toHaveCSS('background-color', 'rgb(28, 28, 30)');
    await page.screenshot({ path: info.outputPath(`${name}-dark-mobile.png`) });
    await page.evaluate(() => document.body.classList.add('light-theme'));
  }
});

test('内容日志支持筛选、空结果恢复和失败重试', async ({ page }) => {
  const { shell, state } = await fixture(page);
  await navigateWorkspace(shell, 'openAuditLog');
  await expect(shell.locator('#al-body')).toContainText('已检查 N3 试卷');
  await shell.locator('[data-audit-detail]').click();
  await expect(page.locator('#audit-detail-modal')).toBeVisible();
  await expect(page.locator('#ald-body')).toContainText('已检查 N3 试卷');
  await page.locator('#ald-close').click();
  const download = page.waitForEvent('download');
  await shell.locator('#al-export').click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await shell.locator('#al-actor').fill('missing-actor');
  await shell.locator('#al-search').click();
  await expect(shell.locator('#al-body')).toContainText('没有匹配');
  await shell.locator('[data-audit-reset-empty]').click();
  await expect(shell.locator('#al-body')).toContainText('已检查 N3 试卷');
  state.failAudit = true;
  await shell.locator('#al-search').click();
  await expect(shell.locator('#al-body')).toContainText('日志服务暂不可用');
  state.failAudit = false;
  await shell.locator('#al-search').click();
  await expect(shell.locator('#al-body')).toContainText('已检查 N3 试卷');
  expect(state.auditRequests.every(query => new URLSearchParams(query).get('scope') === 'content')).toBe(true);
});

test('内容日志服务端范围限制分页总数与操作分类，不混入其他业务日志', async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).not.toBe('8080');
  const admin = await loginApi(request, uniqueLoginId('superadmin_content_audit_scope'));
  const headers = { Authorization: `Bearer ${admin.token}` };
  const examsPayload = (await (await request.get('/api/v1/exams', { headers })).json()).data;
  const exams = Array.isArray(examsPayload) ? examsPayload : examsPayload.items;
  const examId = exams[0].id || exams[0].exam_id;
  const inspected = await request.post(`/api/v1/admin/content/workflow/${encodeURIComponent(examId)}/inspect`, { headers, data: {} });
  expect(inspected.ok()).toBe(true);
  const content = (await (await request.get('/api/v1/admin/audit-logs?scope=content&limit=200', { headers })).json()).data;
  expect(content.total).toBeGreaterThan(0);
  expect(content.items.every(item => item.action.startsWith('content.'))).toBe(true);
  const actions = (await (await request.get('/api/v1/admin/audit-logs/actions?scope=content', { headers })).json()).data.actions;
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every(action => action.startsWith('content.'))).toBe(true);
  const outside = (await (await request.get('/api/v1/admin/audit-logs?scope=content&action=user.login', { headers })).json()).data;
  expect(outside.total).toBe(0);
  expect(outside.items).toEqual([]);
});

test('常用功能在首页下方单区展开、再次收起，切换和消息返回保留筛选', async ({ page }, info) => {
  const { shell } = await fixture(page);
  const functions = shell.locator('[data-role-home-functions=contentAdmin]');
  const choice = intent => functions.locator(`[data-content-home-toggle][data-role-admin-intent="${intent}"]`);
  const feedback = choice('openRoleContent:content-feedback');
  const publish = choice('openRoleContent:content-publish');
  const logs = choice('openAuditLog');
  const backLabel = await shell.locator('[data-workspace-back]').getAttribute('aria-label');
  await expect(shell.locator('[data-content-inline-panel]')).toHaveCount(0);
  await feedback.focus();
  await page.keyboard.press('Enter');
  await expect(feedback).toHaveAttribute('aria-expanded', 'true');
  await expect(feedback).toBeFocused();
  await expect(feedback).toHaveClass(/is-active/);
  await expect(functions.locator('[data-content-inline-panel]')).toHaveAttribute('data-content-inline-panel', 'content-feedback');
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('内容工作台');
  await expect(shell.locator('[data-role-overview]')).toHaveAttribute('data-role-overview', 'contentAdmin');
  await expect(shell.locator('.pc-platform-stats')).toBeAttached();
  await expect(shell.locator('[data-workspace-back]')).toHaveAttribute('aria-label', backLabel);
  const position = await functions.evaluate(el => ({ buttons: el.querySelector('.pc-home-function-grid').getBoundingClientRect().bottom, panel: el.querySelector('[data-content-inline-panel]').getBoundingClientRect().top }));
  expect(position.panel).toBeGreaterThanOrEqual(position.buttons);
  await feedback.click();
  await expect(feedback).toHaveAttribute('aria-expanded', 'false');
  await expect(shell.locator('[data-content-inline-panel]')).toHaveCount(0);
  await publish.click();
  await expect(shell.locator('[data-content-inline-panel]')).toHaveCount(1);
  await shell.locator('[data-content-workflow-stage]').selectOption('failed');
  await expect(shell.locator('[data-content-workflow-row]')).toHaveCount(1);
  await feedback.click();
  await expect(publish).toHaveAttribute('aria-expanded', 'false');
  await publish.click();
  await expect(shell.locator('[data-content-workflow-stage]')).toHaveValue('failed');
  await expect(shell.locator('[data-content-workflow-row]')).toHaveCount(1);
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('消息中心');
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('内容工作台');
  await expect(publish).toHaveAttribute('aria-expanded', 'true');
  await expect(shell.locator('[data-content-workflow-stage]')).toHaveValue('failed');
  await logs.click();
  await shell.locator('#al-actor').fill('missing-actor');
  await shell.locator('#al-search').click();
  await expect(shell.locator('#al-body')).toContainText('没有匹配');
  await feedback.click();
  await logs.click();
  await expect(shell.locator('#al-actor')).toHaveValue('missing-actor');
  await expect(shell.locator('#al-body')).toContainText('没有匹配');
  await shell.locator('#al-reset').click();
  await expect(shell.locator('.pc-content-log-record')).toHaveCount(1);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await functions.evaluate(el => el.scrollIntoView({ block: 'start' }));
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(logs).toBeVisible();
    await expect(shell.locator('[data-content-inline-panel]')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`inline-log-${width}.png`) });
  }
  await shell.getByRole('button', { name: '收起内容日志', exact: true }).click();
  await expect(shell.locator('[data-content-inline-panel]')).toHaveCount(0);
  await expect(logs).toBeFocused();
  await navigateWorkspace(shell, 'openRoleContent:content-feedback');
  await expect(feedback).toHaveAttribute('aria-expanded', 'true');
  await expect(shell.locator('[data-content-inline-panel]')).toHaveAttribute('data-content-inline-panel', 'content-feedback');
});

test('三个首页功能展开和切换保持阅读位置，标题与概览不被自动滚走', async ({ page }, info) => {
  const { shell } = await fixture(page);
  const main = shell.locator('main');
  const heading = shell.locator('.pc-workspace-page-heading');
  const choices = shell.locator('[data-content-home-toggle]');
  const ready = ['[data-content-feedback-row]', '[data-content-workflow-row]', '.pc-content-log-record'];
  const afterPaint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await main.evaluate(el => { el.scrollTop = 0; });
    const initialHeading = await heading.boundingBox();
    await expect(choices.locator('svg.pc-home-function-chevron')).toHaveCount(3);
    const heights = await choices.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    for (let index = 0; index < 3; index++) {
      await choices.nth(index).click();
      await expect(shell.locator(ready[index]).first()).toBeVisible();
      await afterPaint();
      expect(await main.evaluate(el => el.scrollTop)).toBe(0);
      expect(Math.abs((await heading.boundingBox()).y - initialHeading.y)).toBeLessThan(1);
      await expect(choices.nth(index)).toBeFocused();
      await expect(choices.nth(index)).toHaveAttribute('aria-expanded', 'true');
      await page.screenshot({ path: info.outputPath(`stable-heading-${width}-${index}.png`) });
    }
    await choices.nth(2).click();
    await afterPaint();
    await expect(shell.locator('[data-content-inline-panel]')).toHaveCount(0);
    expect(await main.evaluate(el => el.scrollTop)).toBe(0);

    // Switching long lists also retains a user's existing scroll position.
    await choices.nth(0).click();
    await expect(shell.locator(ready[0]).first()).toBeVisible();
    await main.evaluate(el => { el.scrollTop = 60; });
    await choices.nth(1).click();
    await expect(shell.locator(ready[1]).first()).toBeVisible();
    await afterPaint();
    expect(await main.evaluate(el => el.scrollTop)).toBe(60);
    await main.evaluate(el => { el.scrollTop = 0; });
    await choices.nth(1).click();
  }
});
