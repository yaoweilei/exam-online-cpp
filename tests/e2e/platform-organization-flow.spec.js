const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function okJson(response) {
  const text = await response.text();
  expect(response.ok(), `status=${response.status()} body=${text}`).toBeTruthy();
  const payload = JSON.parse(text);
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function createOrganization(request, token, name) {
  return okJson(await request.post('/api/v1/organizations', {
    data: {
      token,
      name,
      organization_type: 'school',
      seats: 30,
      owner_roles: ['orgAdmin']
    }
  }));
}

async function addOrganizationMember(request, token, organizationId, userId, roles) {
  return okJson(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, {
    data: { token, user_id: userId, roles, confirmation: '确认修改机构成员', reauth_password: '' }
  }));
}

async function createLearningGroup(request, token, organizationId, name) {
  return okJson(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, {
    data: {
      token,
      name,
      type: 'class',
      subject: 'japanese',
      status: 'active'
    }
  }));
}

async function addEnrollment(request, token, organizationId, learningGroupId, userId, role) {
  return okJson(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/enrollments`, {
    data: { token, user_id: userId, role, status: 'active' }
  }));
}

async function createAssignment(request, token, organizationId, learningGroupId, title) {
  return okJson(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      exam_id: '2023_02',
      title,
      description: '真实机构链路测试作业',
      due_at: '2026-12-31',
      question_start: 1,
      question_end: 3
    }
  }));
}

async function submitAssignment(request, token, assignmentId) {
  return okJson(await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { answers: { '1': '1', '2': '2', '3': '3' } }
  }));
}

async function submitFeedback(request, token, text) {
  return okJson(await request.post('/api/v1/feedback', {
    data: {
      token,
      paper_id: '2023_02',
      exam_id: '2023_02',
      question_id: '29',
      category: 'analysis',
      description: text
    }
  }));
}

test('平台到机构教学再到内容反馈形成真实闭环', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const superAdmin = await loginApi(request, 'superadmin_demo');
  const orgAdminLoginId = uniqueLoginId('orgadmin_flow');
  const contentAdminLoginId = uniqueLoginId('contentadmin_flow');
  const teacherLoginId = uniqueLoginId('teacher_flow');
  const studentLoginId = uniqueLoginId('student_flow');
  const assistantLoginId = uniqueLoginId('assistant_flow');
  const orgAdmin = await loginApi(request, orgAdminLoginId);
  const contentAdmin = await loginApi(request, contentAdminLoginId);
  const teacher = await loginApi(request, teacherLoginId);
  const student = await loginApi(request, studentLoginId);
  const assistant = await loginApi(request, assistantLoginId);

  const orgName = `E2E 全链路机构 ${suffix}`;
  const groupName = `E2E 全链路学习组 ${suffix}`;
  const assignmentTitle = `E2E 全链路作业 ${suffix}`;
  const feedbackText = `E2E 全链路反馈 ${suffix}`;

  const organization = await createOrganization(request, superAdmin.token, orgName);
  const organizationId = organization.organization_id || organization.scope_id || organization.id;
  await addOrganizationMember(request, superAdmin.token, organizationId, orgAdmin.user_id, ['orgAdmin']);
  await addOrganizationMember(request, orgAdmin.token, organizationId, teacher.user_id, ['teacher']);
  await addOrganizationMember(request, orgAdmin.token, organizationId, assistant.user_id, ['assistant']);
  await addOrganizationMember(request, orgAdmin.token, organizationId, student.user_id, ['student']);

  const group = await createLearningGroup(request, orgAdmin.token, organizationId, groupName);
  const learningGroupId = group.learning_group_id || group.group_id || group.id;
  await addEnrollment(request, orgAdmin.token, organizationId, learningGroupId, teacher.user_id, 'teacher');
  await addEnrollment(request, orgAdmin.token, organizationId, learningGroupId, assistant.user_id, 'assistant');
  await addEnrollment(request, orgAdmin.token, organizationId, learningGroupId, student.user_id, 'student');

  const assignment = await createAssignment(request, teacher.token, organizationId, learningGroupId, assignmentTitle);
  await submitAssignment(request, student.token, assignment.assignment_id);
  await submitFeedback(request, student.token, feedbackText);

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, orgAdminLoginId);
  await openPersonalCenter(page);
  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="权限管理"]').click();
  const memberOrganizationCard = page.locator('.pc-managed-org-card').filter({ hasText: orgName }).first();
  await expect(memberOrganizationCard).toBeVisible({ timeout: 20000 });
  await memberOrganizationCard.locator('summary').click();
  await expect(page.locator('.pc-subpage')).toContainText(studentLoginId, { timeout: 20000 });
  await page.locator('[data-org-member-role][data-role-id="teacher"]').click();
  await expect(page.locator('.pc-subpage')).toContainText(teacherLoginId, { timeout: 20000 });
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="学习组"]').click();
  const learningOrganizationCard = page.locator('.pc-managed-org-card').filter({ hasText: orgName }).first();
  await expect(learningOrganizationCard).toBeVisible({ timeout: 20000 });
  await learningOrganizationCard.locator('summary').click();
  await expect(page.locator('.pc-subpage')).toContainText(groupName, { timeout: 20000 });
  await expect(page.locator('.pc-subpage')).toContainText(studentLoginId);

  await page.evaluate(() => {
    localStorage.removeItem('exam_v2_user');
    localStorage.removeItem('exam_v2_token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, contentAdminLoginId);
  await openPersonalCenter(page);
  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="内容反馈"]').click();
  await expect(page.locator('.pc-subpage')).toContainText(feedbackText, { timeout: 20000 });
  const feedbackRow = page.locator('.pc-feedback-row').filter({ hasText: feedbackText }).first();
  await feedbackRow.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已关闭', { timeout: 20000 });
  await expect(feedbackRow).toContainText('已关闭');
});
