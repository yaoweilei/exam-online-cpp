const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function enableSystemFlags(request, token, flags) {
  const response = await request.put('/api/v1/admin/feature-flags/system', {
    data: { token, ...flags }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
}

async function createProfessionalOrganization(request, token, name) {
  const response = await request.post('/api/v1/organizations', {
    data: {
      token,
      name,
      organization_type: 'school',
      plan: 'professional',
      status: 'active',
      seats: 20
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

test('P2 增强功能：PWA、备课、运营后台、社区可以走通', async ({ page, request }) => {
  const superLogin = uniqueLoginId('superadmin_p2');
  const studentLogin = uniqueLoginId('student_p2');
  const superSession = await loginApi(request, superLogin);
  const studentSession = await loginApi(request, studentLogin);

  await enableSystemFlags(request, superSession.token, {
    community: { enabled: true },
    admin_dashboard: { enabled: true },
    pwa: { enabled: true }
  });

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const manifestJson = await manifest.json();
  expect(manifestJson.name).toContain('EJU');
  expect(manifestJson.shortcuts.length).toBeGreaterThan(0);

  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  expect(await sw.text()).toContain('CACHE_VERSION');

  const org = await createProfessionalOrganization(request, superSession.token, `P2 测试机构 ${Date.now()}`);
  const orgId = org.organization_id || org.scope_id || org.id;
  const prep = await request.post('/api/v1/institution/lesson-prep', {
    data: {
      token: superSession.token,
      org_id: orgId,
      exam_id: '2023_02',
      limit: 5,
      hide_answers: true,
      mode: 'handout'
    }
  });
  expect(prep.ok()).toBeTruthy();
  const prepPayload = await prep.json();
  expect(prepPayload.code).toBe('OK');
  expect(prepPayload.data.question_set.length).toBeGreaterThan(0);
  expect(prepPayload.data.handout_html).toContain('课堂讲义');

  const savedPrep = await request.post('/api/v1/institution/lesson-prep/plans', {
    data: {
      token: superSession.token,
      org_id: orgId,
      exam_id: '2023_02',
      title: 'P2 保存的备课方案',
      limit: 5,
      hide_answers: true,
      mode: 'handout',
      focus_keyword: 'reading'
    }
  });
  expect(savedPrep.ok()).toBeTruthy();
  const savedPrepPayload = await savedPrep.json();
  expect(savedPrepPayload.code).toBe('OK');
  expect(savedPrepPayload.data.lesson_prep_id).toBeTruthy();
  expect(savedPrepPayload.data.title).toBe('P2 保存的备课方案');

  const prepPlans = await request.get(`/api/v1/institution/lesson-prep/plans?token=${encodeURIComponent(superSession.token)}&org_id=${encodeURIComponent(orgId)}`);
  expect(prepPlans.ok()).toBeTruthy();
  const prepPlansPayload = await prepPlans.json();
  expect(prepPlansPayload.code).toBe('OK');
  expect((prepPlansPayload.data || []).some((item) => item.lesson_prep_id === savedPrepPayload.data.lesson_prep_id)).toBeTruthy();

  const workbench = await request.get(`/api/v1/institution/workbench?token=${encodeURIComponent(superSession.token)}&org_id=${encodeURIComponent(orgId)}`);
  expect(workbench.ok()).toBeTruthy();
  const workbenchPayload = await workbench.json();
  expect(workbenchPayload.code).toBe('OK');
  expect(Array.isArray(workbenchPayload.data.schedule)).toBeTruthy();
  expect(Array.isArray(workbenchPayload.data.course_packages)).toBeTruthy();
  expect(Array.isArray(workbenchPayload.data.student_relationships)).toBeTruthy();
  expect(Array.isArray(workbenchPayload.data.lesson_prep_plans)).toBeTruthy();

  await request.post('/api/v1/feedback', {
    data: {
      token: superSession.token,
      paper_id: '2023_02',
      question_id: 'q1',
      category: 'content',
      description: 'P2 e2e feedback'
    }
  });

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, superLogin);
  await openPersonalCenter(page);
  await page.locator('button.service-item', { hasText: '运营仪表盘' }).click();
  const adminModal = page.locator('#admin-dashboard-modal');
  await expect(adminModal).toBeVisible({ timeout: 20000 });
  await expect(adminModal).toContainText('用户总数', { timeout: 20000 });

  await adminModal.locator('#ad-user-query').fill(superLogin);
  await adminModal.locator('#ad-user-search').click();
  await expect(adminModal.locator('#ad-user-results')).toContainText(superLogin, { timeout: 20000 });

  await adminModal.locator('#ad-role-load').click();
  await expect(adminModal.locator('#ad-role-results')).toContainText(/人|暂无用户/, { timeout: 20000 });

  await adminModal.locator('#ad-flags-load').click();
  await expect(adminModal.locator('#ad-flags-results')).toContainText('社区讨论', { timeout: 20000 });

  await adminModal.locator('#ad-feedback-load').click();
  await expect(adminModal.locator('#ad-feedback-results')).toContainText('P2 e2e feedback', { timeout: 20000 });

  await page.locator('#ad-close').click();
  await expect(adminModal).toBeHidden();

  await loginWithPassword(page, studentLogin);
  await page.evaluate(() => window.openCommunityPanel && window.openCommunityPanel('2023_02'));
  const community = page.locator('#community-modal');
  await expect(community).toBeVisible({ timeout: 20000 });
  let dialogIndex = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    dialogIndex += 1;
    await dialog.accept(dialogIndex === 1 ? 'P2 社区帖子' : '这是一条 P2 自动化社区内容。');
  });
  await community.locator('#cm-new').click();
  await expect(community.locator('#cm-body')).toContainText('P2 社区帖子', { timeout: 20000 });
  await community.locator('[data-cm-action="like"]').first().click();
  await expect(community.locator('[data-cm-action="like"]').first()).toContainText('1', { timeout: 20000 });
  await community.locator('[data-cm-comment-input]').first().fill('P2 评论');
  await community.locator('[data-cm-action="comment"]').first().click();
  await expect(community.locator('#cm-body')).toContainText('P2 评论', { timeout: 20000 });
});
