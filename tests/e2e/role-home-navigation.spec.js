const { test, expect } = require('@playwright/test');
const { loginApi } = require('./helpers/session');
const { workspaceDestinations } = require('./helpers/workspace-navigation');
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });

async function fixture(page, state = {}) {
  const now = Date.now();
  state.packages ||= [
    { course_package_id: 'home-active', record_type: 'template', title: '日语基础', subject: 'japanese', total_lessons: 20, status: 'active' },
    { course_package_id: 'home-paused', record_type: 'template', title: '暂停招生课程', subject: 'math', total_lessons: 10, status: 'paused' },
    { course_package_id: 'home-expired', record_type: 'template', title: '已到期课程', subject: 'japanese', total_lessons: 8, status: 'active', expires_at: '2020-01-01T00:00:00Z' }
  ];
  const org = { organization_id: 'org_role_home', name: '首页验证机构', member_count: 2, billable_member_count: 1, seats: 30, status: 'active', subscription: { plan: 'pro', seats: 30, status: 'active' }, invitations: [] };
  const schedule = [
    { organization_id: org.organization_id, learning_group_id: 'ongoing', name: '进行中的课程', starts_at: new Date(now - 1800000).toISOString(), ends_at: new Date(now + 1800000).toISOString(), status: 'scheduled' },
    { organization_id: org.organization_id, learning_group_id: 'future', name: '接下来的课程', starts_at: new Date(now + 10800000).toISOString(), ends_at: new Date(now + 14400000).toISOString(), status: 'scheduled' },
    { organization_id: org.organization_id, learning_group_id: 'cancelled', name: '已经取消的课', starts_at: new Date(now + 3600000).toISOString(), ends_at: new Date(now + 7200000).toISOString(), status: 'cancelled' }
  ];
  const reviews = { analysis: { status: 'approved' }, secondary: { status: 'approved' } };
  const workflows = [
    { exam_id: 'home-ready', status: 'draft', inspection: { passed: true }, reviews },
    { exam_id: 'home-progress', status: 'draft', inspection: { passed: true }, reviews: {} },
    { exam_id: 'home-published', status: 'published', inspection: { passed: true }, reviews }
  ];
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    let data;
    if (path === '/api/v1/organizations') data = { items: [org], total: 1, page: 1, pages: 1 };
    else if (path === `/api/v1/organizations/${org.organization_id}`) data = org;
    else if (path === `/api/v1/organizations/${org.organization_id}/course-packages`) {
      if (req.method() === 'POST') {
        if (state.failSave) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '课程包保存失败，请重试' } });
        state.saved = req.postDataJSON();
        const id = state.saved.course_package_id || `home-created-${state.packages.length}`;
        const item = { ...state.saved, course_package_id: id };
        state.packages = [...state.packages.filter(pkg => pkg.course_package_id !== id), item];
        data = item;
      } else {
        if (state.pausePackageRead) await new Promise(resolve => (state.pendingPackageReads ||= []).push(resolve));
        data = state.packages;
      }
    } else if (path.startsWith(`/api/v1/organizations/${org.organization_id}/`)) data = [];
    else if (path.startsWith('/api/v1/institution/workbench') || path.startsWith('/api/v1/institution/dashboard')) data = { organizations: [{ ...org, course_packages: state.packages }], student_relationships: [{ student: { id: 'home-student' } }], learning_groups: [], schedule, assignments: [{ id: 'home-assignment', title: '待处理作业', student_count: 4, submitted_count: 1, pending_review_count: 1, due_at: '2020-01-01T00:00:00Z' }], renewal_risks: [{ student: { id: 'home-student' }, level: 'high' }] };
    else if (path === '/api/v1/admin/statistics/overview') data = { users: { total: 12 }, organizations: { total: 1 } };
    else if (path.startsWith('/api/v1/admin/payments/')) data = { items: [], total: 0, pages: 1 };
    else if (path === '/api/v1/admin/content/workflow') data = workflows;
    else if (path === '/api/v1/exams') data = workflows.map(row => ({ id: row.exam_id, title: row.exam_id, question_count: 10 }));
    else if (path === '/api/v1/feedback') data = { items: [], total: 0, summary: { pending_total: 2 } };
    else return route.fallback();
    await route.fulfill({ json: { code: 'OK', data } });
  });
  await loginApi(page.request, 'superadmin_role_home');
  const ctx = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => localStorage.setItem('exam_v2_user', JSON.stringify(user)), { ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, permissions: ctx.permissions, subscription: ctx.subscription });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.getUserContext?.().username)).toBe('superadmin_role_home');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.openPersonalCenter());
  return page.locator('#platform-admin-shell');
}

async function role(shell, name) {
  if (await shell.getAttribute('data-learning-role') !== name) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('.pc-role-identity-menu > summary').click();
    await shell.locator(`[data-role-workbench="${name}"]`).click();
  }
  await expect(shell.locator('[data-role-overview]')).toHaveAttribute('data-role-overview', name);
}

test('五个管理工作台在菜单收起时，全部业务入口都可从首页到达并返回', async ({ page }, info) => {
  test.setTimeout(180000);
  const shell = await fixture(page);
  for (const name of ['superAdmin', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await role(shell, name);
    await page.waitForLoadState('networkidle');
    const platform = name === 'superAdmin', attr = platform ? 'data-platform-admin-page' : 'data-role-admin-intent';
    const targets = (await workspaceDestinations(shell, platform)).filter(item => !['overview', '__overview__'].includes(item.key));
    const available = await shell.locator(`.pc-role-home [${attr}]`).evaluateAll((buttons, attr) => buttons.map(button => button.getAttribute(attr)), attr);
    expect(targets.filter(item => !available.includes(item.key)), name).toEqual([]);
    expect(new Set(available).size, name).toBe(available.length);
    await expect(shell.locator('.pc-role-home .pc-platform-stats, .pc-role-home .pc-workspace-pending')).toHaveCount(0);
    await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
    for (const target of targets) {
      const button = shell.locator(`.pc-role-home [${attr}=${JSON.stringify(target.key)}]`).last();
      const disclosure = button.locator('xpath=ancestor::details[@data-role-home-section]');
      if (await disclosure.count() && !await disclosure.evaluate(el => el.open)) await disclosure.locator(':scope > summary').click();
      await button.click();
      await expect(shell.locator('[data-role-overview]')).toHaveCount(0);
      await expect(shell.locator('.pc-platform-sidebar')).toBeHidden();
      await shell.locator('[data-workspace-back]').click();
      await expect(shell.locator('[data-role-overview]')).toHaveAttribute('data-role-overview', name);
    }
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${name}-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${name}-desktop.png`) });
  }
});

test('教师、教务和机构的数字与待办显示在对应入口', async ({ page }, info) => {
  const shell = await fixture(page);
  const entry = key => shell.locator(`.pc-role-home [data-role-admin-intent="openRoleContent:${key}"]`);
  await role(shell, 'teacher');
  await expect(entry('teacher-schedule')).toContainText('2 节近期课程');
  await expect(entry('teacher-schedule')).toContainText('进行中的课程');
  await expect(entry('teacher-schedule')).not.toContainText('已经取消的课');
  await expect(entry('teacher-review')).toContainText('1 份待批改');
  await expect(entry('teacher-review')).toContainText('3 人次未交或待重做');
  await entry('teacher-review').click();
  await expect(shell.locator('[data-teacher-assignment-filter="pending"]')).toHaveAttribute('aria-pressed', 'true');
  await shell.locator('[data-teacher-assignment-filter="unsubmitted"]').click();
  await expect(shell.locator('[data-teacher-assignment-filter="unsubmitted"]')).toHaveAttribute('aria-pressed', 'true');
  await shell.locator('[data-workspace-back]').click();
  await role(shell, 'assistant');
  await expect(entry('assistant-followup')).toContainText('3 人次待催交');
  await expect(entry('assistant-followup')).toContainText('1 人有续费风险');
  await expect(entry('teacher-schedule')).toContainText('2 节近期课程');
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  await page.screenshot({ path: info.outputPath('assistant-dark.png') });
  await role(shell, 'orgAdmin');
  await expect(entry('org-members').locator('.pc-home-settings-value')).toHaveText('2 人');
  await expect(entry('org-plan').locator('.pc-home-settings-value')).toHaveText('1/30 席');
  await expect(entry('org-setup')).toHaveCount(1);
});

test('内容工作流入口合计待处理事项，页面内仍可按阶段筛选', async ({ page }) => {
  const shell = await fixture(page);
  await role(shell, 'contentAdmin');
  const workflow = shell.locator('.pc-role-home [data-role-admin-intent="openRoleContent:content-publish"]');
  await expect(workflow).toHaveCount(1);
  await expect(workflow).toContainText('2 项待处理');
  await expect(workflow).toContainText('1 项待质检或复核 · 1 项待发布');
  await workflow.click();
  await shell.getByLabel('搜索筛选', { exact: true }).click();
  await shell.locator('[data-content-workflow-stage]').selectOption('ready');
  await expect(shell.locator('[data-content-workflow-stage]')).toHaveValue('ready');
  await expect(shell.locator('[data-content-workflow-row]')).toHaveCount(1);
  await expect(shell.locator('[data-content-workflow-row]')).toHaveAttribute('data-exam-id', 'home-ready');
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('发布工作流');
  if (!await shell.locator('[data-content-workflow-stage]').isVisible()) await shell.getByLabel('搜索筛选', { exact: true }).click();
  await shell.locator('[data-content-workflow-stage]').selectOption('in_progress');
  await expect(shell.locator('[data-content-workflow-stage]')).toHaveValue('in_progress');
  await expect(shell.locator('[data-content-workflow-row]')).toHaveCount(1);
  await expect(shell.locator('[data-content-workflow-row]')).toHaveAttribute('data-exam-id', 'home-progress');
});

test('机构内容首页能搜索、新建与编辑，失败保留输入，停用课程不误报过期', async ({ page }, info) => {
  const state = { failSave: true };
  const shell = await fixture(page, state);
  await page.evaluate(() => window.setUserContext({ ...window.getUserContext(), roles: ['orgContentAdmin'], organizationId: 'org_role_home' }));
  await expect(shell.locator('[data-role-overview]')).toHaveAttribute('data-role-overview', 'orgContentAdmin');
  await expect(shell.locator('[data-home-package-id]')).toHaveCount(3);
  await expect(shell.locator('.pc-home-package-summary')).toHaveText('共 3 个 · 启用 1 个 · 已过期 1 个');
  await expect(shell.locator('.pc-platform-stats, .pc-workspace-pending')).toHaveCount(0);
  await shell.locator('[data-role-home-package-query]').fill('暂停');
  await shell.locator('[data-role-home-package-query]').press('Enter');
  await expect(shell.locator('[data-home-package-id]')).toHaveCount(1);
  await shell.locator('[data-role-home-package-edit]').click();
  const editor = shell.locator('[data-role-home-package-editor]');
  await expect(editor.locator('[data-org-course-package-title]')).toHaveValue('暂停招生课程');
  await editor.locator('[data-org-course-package-title]').fill('暂停课程更新');
  await editor.locator('[data-org-course-package-total]').fill('15');
  await editor.locator('[data-org-course-package-expires]').fill('2030-01-01T12:30');
  await editor.getByRole('button', { name: '保存课程包', exact: true }).click();
  await expect(editor).toContainText('课程包保存失败');
  await expect(editor.locator('[data-org-course-package-title]')).toHaveValue('暂停课程更新');
  state.failSave = false;
  await editor.getByRole('button', { name: '保存课程包', exact: true }).click();
  await expect(shell.locator('[data-home-package-id="home-paused"]')).toContainText('暂停课程更新');
  await expect(shell.locator('[data-role-home-package-query]')).toHaveValue('');
  await expect(shell.locator('[data-home-package-id]')).toHaveCount(3);
  expect(state.saved.course_package_id).toBe('home-paused');
  expect(state.saved.record_type).toBe('template');
  expect(state.saved.status).toBe('paused');
  expect(state.saved.expires_at).toBe('2030-01-01T04:30:00.000Z');
  await shell.locator('.pc-home-package-editor > summary').click();
  await editor.locator('[data-org-course-package-title]').fill('首页新建课程');
  await editor.locator('[data-org-course-package-subject]').fill('日语');
  await editor.getByRole('button', { name: '保存课程包', exact: true }).click();
  await expect(shell.locator('[data-home-package-id]')).toHaveCount(4);
  await expect(shell.locator('[data-role-home-package-query]')).toHaveValue('');
  const createdRow = shell.locator('[data-home-package-id]').filter({ hasText: '首页新建课程' });
  await expect(createdRow).toBeVisible();
  expect(state.saved.course_package_id).toBe('');
  expect(state.packages).toHaveLength(4);
  await createdRow.locator('[data-role-home-package-edit]').click();
  await editor.locator('[data-org-course-package-title]').fill('尚未保存的修改');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(shell.locator('.pc-home-package-editor')).not.toHaveAttribute('open');
  await expect(createdRow).toContainText('首页新建课程');
  expect(state.packages.some(pkg => pkg.title === '尚未保存的修改')).toBe(false);
  await page.screenshot({ path: info.outputPath('packages-created.png') });
});

test('机构内容角色停止新增，教务可以查看课程包，机构管理员保留管理入口', async ({ page }) => {
  const shell = await fixture(page);
  await expect(shell).toHaveAttribute('data-learning-role', 'superAdmin');
  await shell.locator('[data-platform-admin-account-menu]').click();
  await expect.poll(() => shell.locator('[data-role-workbench]').evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('aria-label'))
  )).toEqual(['切换到学员', '切换到教师', '切换到教务管理员', '切换到机构管理员', '切换到内容管理员', '切换到超级管理员']);
  await shell.locator('.pc-role-identity-menu > summary').click();
  await shell.locator('[data-role-workbench="assistant"]').click();
  await shell.locator('.pc-role-home [data-role-admin-intent="openRoleContent:assistant-package"]').last().click();
  const templates = shell.getByRole('region', { name: '可用课程包' });
  await expect(templates).toContainText('日语基础');
  await expect(templates).not.toContainText('暂停招生课程');
  await expect(templates).not.toContainText('已到期课程');
  await expect(shell.locator('[data-org-course-package-form]')).toHaveCount(0);
  await role(shell, 'orgAdmin');
  await shell.locator('.pc-role-home [data-role-admin-intent="openRoleContent:org-course-packages"]').last().click();
  await expect(shell.locator('[data-org-course-package-form]')).toBeAttached();

  await page.evaluate(() => window.setUserContext({
    ...window.getUserContext(),
    roles: ['student', 'teacher', 'assistant', 'orgAdmin'],
    organizationId: 'org_role_home'
  }));
  await shell.locator('[data-platform-admin-account-menu]').click();
  await expect(shell.locator('[data-role-workbench]')).toHaveCount(4);
  await expect(shell.locator('[data-role-workbench="superAdmin"], [data-role-workbench="contentAdmin"]')).toHaveCount(0);
});

test('机构内容管理合为一个课程包页面，空列表不显示分页，消息返回后保持页面', async ({ page }, info) => {
  const state = { packages: [], pausePackageRead: true };
  const shell = await fixture(page, state);
  await page.evaluate(() => window.setUserContext({ ...window.getUserContext(), roles: ['orgContentAdmin'], organizationId: 'org_role_home' }));
  await expect(shell.locator('[data-role-overview]')).toHaveAttribute('data-role-overview', 'orgContentAdmin');
  await expect.poll(() => state.pendingPackageReads?.length || 0).toBeGreaterThan(0);
  await shell.locator('.pc-home-package-editor > summary').click();
  state.pausePackageRead = false;
  state.pendingPackageReads.forEach(resolve => resolve());
  await expect(shell.locator('[data-role-home-package-editor] [data-org-course-package-title]')).toBeVisible();
  await expect(shell.locator('[data-home-package-org]')).toContainText('还没有课程包');
  await expect(shell.locator('[data-role-home-package-editor] [data-org-course-package-title]')).toBeVisible();
  await shell.locator('.pc-home-package-editor > summary').click();
  await expect(shell.locator('.pc-platform-sidebar [data-workspace-section]')).toHaveText(['课程包']);
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('课程包');
  await expect(shell.locator('[data-home-package-org]')).toContainText('还没有课程包');
  await expect(shell.locator('.pc-workspace-section-tabs, .pc-teaching-links')).toHaveCount(0);
  await expect(shell.locator('[aria-label="管理课程包"], .pc-workflow-pagination')).toHaveCount(0);
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('消息中心');
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('课程包');
  await expect(shell.locator('[data-home-package-org]')).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(shell.locator('.pc-home-package-editor > summary')).toBeVisible();
    expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`packages-single-${width}.png`) });
  }
});
