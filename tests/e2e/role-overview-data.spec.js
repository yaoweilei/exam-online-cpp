const { test, expect } = require('@playwright/test');
const { loginWithPassword, stubNoisyPersonalCenterApis } = require('./helpers/session');

test('教学数据失败可重试，正常学员不计入续费风险', async ({ page }) => {
  await loginWithPassword(page, 'assistant_demo');
  await page.evaluate(() => {
    let fail = true;
    window.APIClient.getInstitutionWorkbench = async () => ({ learning_groups: [], schedule: [], student_relationships: [] });
    window.APIClient.getInstitutionDashboard = async () => {
      if (fail) { fail = false; throw new Error('教学数据暂时不可用'); }
      return { assignments: [], renewal_risks: [
        { level: 'low', student: { id: 'normal', username: '正常学员' }, reason: '学习活跃正常' },
        { level: 'medium', student: { id: 'followup', username: '需要跟进学员' }, reason: '套餐临近到期' }
      ] };
    };
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  await expect(shell.getByRole('alert')).toContainText('教学数据暂时不可用');
  await expect(shell.locator('.pc-platform-stat strong')).toHaveText(['—', '—', '—', '—']);
  await shell.getByRole('button', { name: '重试', exact: true }).click();
  await expect(shell.getByRole('alert')).toHaveCount(0);
  await expect(shell.locator('.pc-platform-stat').filter({ hasText: '续费风险' }).locator('strong')).toHaveText('1');
  await shell.locator('nav').getByRole('button', { name: '续费风险', exact: true }).click();
  await expect(shell.locator('main')).toContainText('需要跟进学员');
  await expect(shell.locator('main')).not.toContainText('正常学员');
  await expect(shell.locator('main')).toContainText('需关注');
});

test('机构内容角色仅加载机构内容数据并显示真实课程包统计', async ({ page }) => {
  await loginWithPassword(page, 'orgadmin_demo');
  await stubNoisyPersonalCenterApis(page);
  await page.evaluate(() => {
    const calls = [];
    window.__roleAuditCalls = calls;
    const api = window.APIClient;
    const org = { organization_id: 'org_content_audit', name: '课程内容测试机构' };
    api.getOrganizations = async () => ({ items: [org], total: 1, page: 1, pages: 1 });
    api.getOrganization = async () => org;
    api.getOrganizationCoursePackages = async () => [
      { course_package_id: 'pkg_active', record_type: 'template', title: '初级课程', status: 'active', total_lessons: 20 },
      { course_package_id: 'pkg_inactive', record_type: 'template', title: '旧课程', status: 'inactive', total_lessons: 10 }
    ];
    for (const method of ['getInstitutionWorkbench', 'getInstitutionDashboard', 'getOrganizationMembers', 'getOrganizationCampuses', 'getOrganizationLearningGroups']) {
      api[method] = async () => { calls.push(method); throw new Error('不应读取管理或教学数据'); };
    }
    window.setUserContext({ ...window.getUserContext(), roles: ['orgContentAdmin'], organizationId: org.organization_id });
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  await expect(shell.locator('h1')).toHaveText('机构内容工作台');
  await expect(shell.locator('.pc-platform-stat strong')).toHaveText(['2', '1', '1', '1']);
  expect(await page.evaluate(() => window.__roleAuditCalls)).toEqual([]);
  await shell.locator('nav').getByRole('button', { name: '课程包', exact: true }).click();
  await expect(shell.locator('main')).toContainText('初级课程');
  expect(await page.evaluate(() => window.__roleAuditCalls)).toEqual([]);
});

test('超级管理员切换学员后可走通计划、复习、专项和复习资料', async ({ page }) => {
  await loginWithPassword(page, 'superadmin_demo');
  await page.evaluate(() => window.openPersonalCenter?.());
  const shell = page.locator('#platform-admin-shell');
  await expect(shell).toBeVisible();
  await shell.getByLabel('切换当前身份').selectOption('student');
  await expect(shell.locator('.pc-platform-topbar')).toContainText('学习工作台');

  const navLabels = await shell.locator('.pc-platform-nav-label').allTextContents();
  expect(navLabels).toEqual(['学习安排', '复习与分析', '账户']);
  for (const name of ['今日学习', '我的作业', '专项练习', '复习资料', '学习报告']) {
    await expect(shell.getByRole('button', { name, exact: true })).toBeVisible();
  }

  await expect(shell.locator('.pc-goal-summary')).toContainText('EJU 日本語');
  await expect(shell.locator('.pc-goal-summary')).toContainText('每天 30 分钟');
  await expect(shell.locator('section[aria-label="今日计划"]')).toContainText('JLPT N1 · 2025年7月真题');
  await expect(shell.locator('section[aria-label="今日计划"]')).toBeVisible();
  await expect(shell.locator('.pc-platform-tasks, .pc-platform-quick-actions')).toHaveCount(0);

  await shell.getByRole('button', { name: '今日学习', exact: true }).click();
  const review = page.locator('#review-workbench-modal');
  await expect(review).toBeVisible();
  await expect(review.locator('#rw-body')).toContainText('到期知识点');
  await expect(review.locator('#rw-body')).toContainText('近期错题');

  await shell.getByRole('button', { name: '专项练习', exact: true }).click();
  const chapter = page.locator('#chapter-modal');
  await expect(chapter).toBeVisible();
  await expect(chapter.locator('#cp-body .cp-row').first()).toBeVisible();
  await expect(chapter).not.toContainText('技能标签');

  await shell.getByRole('button', { name: '复习资料', exact: true }).click();
  await expect(shell.locator('main')).toContainText('错题本');
  await expect(shell.locator('main')).toContainText('收藏题');
  await expect(shell.locator('main')).toContainText('生词本');

  await shell.locator('.pc-lite-row').filter({ hasText: '错题本' }).click();
  await expect(page.locator('#wq-modal')).toContainText('治疗');
  await shell.getByRole('button', { name: '复习资料', exact: true }).click();

  await shell.locator('.pc-lite-row').filter({ hasText: '生词本' }).click();
  await expect(page.locator('#vocab-modal')).toContainText('競う');
  await shell.getByRole('button', { name: '复习资料', exact: true }).click();

  await shell.locator('.pc-lite-row').filter({ hasText: '收藏题' }).click();
  await expect(shell.locator('main')).toContainText('N2 高频词汇');
  await expect(shell.locator('main')).toContainText('读音容易和');
});
