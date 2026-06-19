const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

const ADMIN_LOGIN_PREFIX = 'orgadmin_teaching';
const STUDENT_LOGIN_PREFIX = 'student_teaching';

async function createLearningGroupApi(request, token, organizationId, name) {
  const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, {
    data: {
      token,
      name,
      type: 'class',
      subject: 'japanese',
      status: 'active'
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function createOrganizationApi(request, token, name) {
  const response = await request.post('/api/v1/organizations', {
    data: {
      token,
      name,
      organization_type: 'school',
      seats: 20,
      owner_roles: ['orgAdmin']
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function addOrganizationMemberApi(request, token, organizationId, userId, roles) {
  const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, {
    data: {
      token,
      user_id: userId,
      roles
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function addLearningGroupEnrollmentApi(request, token, organizationId, learningGroupId, userId, role) {
  const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/enrollments`, {
    data: {
      token,
      user_id: userId,
      role,
      status: 'active'
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function createAssignmentApi(request, token, organizationId, learningGroupId, title) {
  const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      exam_id: '2023_02',
      title,
      description: 'Playwright 可视化测试预置的作业',
      due_at: '2026-12-31',
      question_start: 1,
      question_end: 3
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function submitAssignmentApi(request, token, assignmentId) {
  const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { answers: {} }
  });
  if (!response.ok()) {
    throw new Error(`submit assignment failed ${response.status()}: ${await response.text()}`);
  }
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  expect(payload.data?.submission?.status).toBe('submitted');
  return payload.data;
}

async function prepareTeachingDemo(request) {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const adminLoginId = uniqueLoginId(ADMIN_LOGIN_PREFIX);
  const studentLoginId = uniqueLoginId(STUDENT_LOGIN_PREFIX);
  const admin = await loginApi(request, adminLoginId);
  const student = await loginApi(request, studentLoginId);
  const organization = await createOrganizationApi(request, admin.token, `E2E 核心教学机构 ${suffix}`);
  const organizationId = organization.organization_id || organization.scope_id;
  await addOrganizationMemberApi(request, admin.token, organizationId, student.user_id, ['student']);
  const groupName = `E2E 核心学习组 ${suffix}`;
  const assignmentTitle = `E2E 读解作业 ${suffix}`;
  const learningGroup = await createLearningGroupApi(request, admin.token, organizationId, groupName);
  const learningGroupId = learningGroup.learning_group_id || learningGroup.group_id || learningGroup.id;
  await addLearningGroupEnrollmentApi(request, admin.token, organizationId, learningGroupId, student.user_id, 'student');
  const assignment = await createAssignmentApi(request, admin.token, organizationId, learningGroupId, assignmentTitle);
  await submitAssignmentApi(request, student.token, assignment.assignment_id);
  return {
    admin,
    adminLoginId,
    student,
    studentLoginId,
    organization,
    organizationId,
    learningGroup,
    learningGroupId,
    assignment,
    groupName,
    assignmentTitle
  };
}

async function openInstitutionWorkbench(page) {
  await page.locator('#user-menu-trigger').click();
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
  const workbench = page.locator('#pc-institution-workbench');
  await expect(workbench).toBeVisible();
  await expect(workbench.locator('.pc-service-header', { hasText: '机构教学工作台' })).toBeVisible();
  await expect(workbench.locator('[data-inst-create-learning-group]')).toBeVisible({ timeout: 20000 });
  return workbench;
}

async function selectWorkbenchLearningGroup(page, learningGroupId) {
  const learningGroupSelect = page.locator('#pc-institution-workbench [data-inst-learning-group]');
  await expect(learningGroupSelect).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => {
    await learningGroupSelect.selectOption(learningGroupId);
    return await learningGroupSelect.inputValue();
  }, { timeout: 20000 }).toBe(learningGroupId);
}

test('机构核心教学能力可以通过 Web 查看和进入', async ({ page, request }) => {
  const demo = await prepareTeachingDemo(request);

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, demo.adminLoginId);
  const workbench = await openInstitutionWorkbench(page);

  const learningGroupSelect = page.locator('#pc-institution-workbench [data-inst-learning-group]');
  await expect(learningGroupSelect).toContainText(demo.groupName, { timeout: 20000 });
  await expect(workbench.locator('.pc-service-header', { hasText: '学习组平均分趋势' })).toBeVisible({ timeout: 20000 });
  await expect(workbench.locator('.pc-service-header', { hasText: '学员排名' })).toBeVisible();
  await expect(workbench.locator('.pc-service-header', { hasText: '各题型弱项' })).toBeVisible();
  await expect(workbench.locator('.pc-service-header', { hasText: '老师/学员日程' })).toBeVisible({ timeout: 20000 });
  await expect(workbench.locator('.pc-service-header', { hasText: '课程包预警' })).toBeVisible();
  await expect(workbench.locator('.pc-service-header', { hasText: '学生学习关系' })).toBeVisible();
  await expect(workbench.locator('.pc-service-header', { hasText: '已保存备课方案' })).toBeVisible();
  await expect(workbench.locator('[data-inst-create-learning-group]')).toBeVisible();
  await expect(workbench.locator('[data-inst-add-members]')).toBeVisible();
  await expect(workbench.locator('[data-inst-create-assignment]')).toBeVisible();
  await selectWorkbenchLearningGroup(page, demo.learningGroupId);

  const gradebookResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/institution/organizations/${demo.organizationId}/learning-groups/${demo.learningGroupId}/gradebook`) &&
    response.request().method() === 'GET'
  );
  await selectWorkbenchLearningGroup(page, demo.learningGroupId);
  await page.locator('#pc-institution-workbench [data-inst-gradebook]').click();
  const gradebookPayload = await (await gradebookResponse).json();
  expect(gradebookPayload.code).toBe('OK');
  const studentIds = (gradebookPayload.data?.students ?? []).map((row) => row?.student?.id);
  expect(studentIds).toContain(demo.student.user_id);
  const studentRow = (gradebookPayload.data?.students ?? []).find((row) => row?.student?.id === demo.student.user_id);
  expect(studentRow?.answers).toBeTruthy();
  expect(Array.isArray(studentRow?.weaknesses)).toBeTruthy();

  const detail = page.locator('#pc-institution-detail');
  await expect(detail.locator('.pc-service-header', { hasText: '学习组成绩册' })).toBeVisible({ timeout: 20000 });
  await expect(detail).toContainText(demo.studentLoginId);
  await expect(detail.locator(`[data-inst-student="${demo.student.user_id}"]`)).toBeVisible();

  const submissionsResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/assignments/${demo.assignment.assignment_id}/submissions`) &&
    response.request().method() === 'GET'
  );
  await detail.locator(`[data-inst-assignment-submissions="${demo.assignment.assignment_id}"]`).click();
  const submissionsPayload = await (await submissionsResponse).json();
  expect(submissionsPayload.code).toBe('OK');
  expect(submissionsPayload.data?.submissions?.[demo.student.user_id]?.status).toBe('submitted');
  await expect(detail.locator('.pc-service-header', { hasText: '作业提交' })).toBeVisible({ timeout: 20000 });
  await expect(detail).toContainText('已交');

  await selectWorkbenchLearningGroup(page, demo.learningGroupId);
  await page.locator('#pc-institution-workbench [data-inst-gradebook]').click();
  await expect(detail.locator('.pc-service-header', { hasText: '学习组成绩册' })).toBeVisible({ timeout: 20000 });
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept('请今天完成作业。');
  });
  const remindResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/assignments/${demo.assignment.assignment_id}/reminders`) &&
    response.request().method() === 'POST'
  );
  await detail.locator(`[data-inst-assignment-remind="${demo.assignment.assignment_id}"]`).click();
  const remindPayload = await (await remindResponse).json();
  expect(remindPayload.code).toBe('OK');
  expect(Array.isArray(remindPayload.data?.target_student_ids)).toBeTruthy();

  await page.locator('#pc-institution-workbench [data-inst-gradebook]').click();
  await expect(detail.locator('.pc-service-header', { hasText: '学习组成绩册' })).toBeVisible({ timeout: 20000 });
  const profileResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/institution/students/${demo.student.user_id}`) &&
    response.request().method() === 'GET'
  );
  await detail.locator(`[data-inst-student="${demo.student.user_id}"]`).click();
  const profilePayload = await (await profileResponse).json();
  expect(profilePayload.code).toBe('OK');
  expect(profilePayload.data?.student?.id).toBe(demo.student.user_id);
  expect(Array.isArray(profilePayload.data?.wrong_trend)).toBeTruthy();
  expect(Array.isArray(profilePayload.data?.writing_history)).toBeTruthy();
  expect(profilePayload.data?.listening_weaknesses).toBeTruthy();
  expect(Array.isArray(profilePayload.data?.teacher_notes)).toBeTruthy();
  expect(Array.isArray(profilePayload.data?.recommended_homework)).toBeTruthy();
  await expect(detail.locator('.pc-service-header', { hasText: '学员档案' })).toBeVisible({ timeout: 20000 });
  await expect(detail.locator('.pc-service-header', { hasText: '错题变化' })).toBeVisible();
  await expect(detail.locator('.pc-service-header', { hasText: '作文历史' })).toBeVisible();
  await expect(detail.locator('.pc-service-header', { hasText: '听力弱项' })).toBeVisible();
  await expect(detail.locator('.pc-service-header', { hasText: '老师备注' })).toBeVisible();
  await expect(detail.locator('.pc-service-header', { hasText: '建议作业' })).toBeVisible();
  await expect(detail).toContainText(demo.studentLoginId);

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept('E2E 老师备注');
  });
  const noteSaveResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/profile/${demo.student.user_id}`) &&
    response.request().method() === 'PUT'
  );
  await detail.locator(`[data-inst-add-note="${demo.student.user_id}"]`).click();
  const noteSavePayload = await (await noteSaveResponse).json();
  expect(noteSavePayload.code).toBe('OK');
  await expect(detail).toContainText('E2E 老师备注', { timeout: 20000 });
});

test('机构后台可以维护校区、学习组、课程包和学习组成员', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const adminLoginId = uniqueLoginId('orgadmin_learning_model');
  const studentLoginId = uniqueLoginId('student_learning_model');
  const admin = await loginApi(request, adminLoginId);
  const student = await loginApi(request, studentLoginId);
  const orgName = `E2E 学习模型机构 ${suffix}`;
  const campusName = `东京校区 ${suffix}`;
  const packageTitle = `文综约课 20 次 ${suffix}`;
  const groupName = `EJU 日语基础班 ${suffix}`;
  const organization = await createOrganizationApi(request, admin.token, orgName);
  const organizationId = organization.organization_id || organization.scope_id;
  await addOrganizationMemberApi(request, admin.token, organizationId, student.user_id, ['student']);

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, adminLoginId);
  await page.locator('#user-menu-trigger').click();
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  const orgCard = page.locator('.pc-card.pc-info-card', { hasText: orgName }).first();
  await expect(orgCard).toBeVisible({ timeout: 20000 });
  await expect(orgCard.locator('h4', { hasText: '校区管理' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '课程包' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '排课日历' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '学习组' })).toBeVisible();

  const campusResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/campuses`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator('[data-org-campus-name]').fill(campusName);
  await orgCard.locator('[data-org-campus-address]').fill('E2E address');
  await orgCard.locator('form[data-org-campus-form] button[type="submit"]').click();
  expect((await (await campusResponse).json()).code).toBe('OK');
  await expect(orgCard).toContainText(campusName, { timeout: 20000 });

  const packageResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/course-packages`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator('[data-org-course-package-title]').fill(packageTitle);
  await orgCard.locator('[data-org-course-package-subject]').fill('sogo');
  await orgCard.locator('[data-org-course-package-total]').fill('20');
  await orgCard.locator('[data-org-course-package-used]').fill('0');
  await orgCard.locator('form[data-org-course-package-form] button[type="submit"]').click();
  const packagePayload = await (await packageResponse).json();
  expect(packagePayload.code).toBe('OK');
  const coursePackageId = packagePayload.data?.course_package_id || packagePayload.data?.id;
  await expect(orgCard).toContainText(packageTitle, { timeout: 20000 });

  const groupResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/learning-groups`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator('[data-org-learning-group-name]').fill(groupName);
  await orgCard.locator('[data-org-learning-group-subject]').fill('japanese');
  await orgCard.locator('[data-org-learning-group-type]').selectOption('booking');
  await orgCard.locator('[data-org-learning-group-package]').selectOption(coursePackageId);
  await orgCard.locator('[data-org-learning-group-starts]').fill('2026-07-01T19:00');
  await orgCard.locator('[data-org-learning-group-ends]').fill('2026-07-01T20:30');
  await orgCard.locator('form[data-org-learning-group-form] button[type="submit"]').click();
  const groupPayload = await (await groupResponse).json();
  expect(groupPayload.code).toBe('OK');
  const learningGroupId = groupPayload.data?.learning_group_id || groupPayload.data?.group_id;
  await expect(orgCard).toContainText(groupName, { timeout: 20000 });
  await expect(orgCard).toContainText('2026/07/01 19:00', { timeout: 20000 });

  const enrollmentResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/learning-groups/${learningGroupId}/enrollments`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator('[data-org-enrollment-group]').selectOption(learningGroupId);
  await orgCard.locator('[data-org-enrollment-user]').selectOption(student.user_id);
  await orgCard.locator('[data-org-enrollment-role]').selectOption('student');
  await orgCard.locator('form[data-org-learning-enrollment-form] button[type="submit"]').click();
  const enrollmentPayload = await (await enrollmentResponse).json();
  expect(enrollmentPayload.code).toBe('OK');
  await expect(orgCard).toContainText(`${studentLoginId}(student)`, { timeout: 20000 });

  let dialogCount = 0;
  page.on('dialog', async (dialog) => {
    dialogCount += 1;
    if (dialog.type() === 'confirm') {
      await dialog.accept();
      return;
    }
    if (dialog.type() === 'prompt') {
      await dialog.accept('E2E 课后完成');
      return;
    }
    await dialog.dismiss();
  });
  const completeResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/learning-groups/${learningGroupId}/complete`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator(`[data-org-learning-group-complete][data-learning-group-id="${learningGroupId}"]`).first().click();
  const completePayload = await (await completeResponse).json();
  expect(completePayload.code).toBe('OK');
  expect(completePayload.data?.deducted).toBeTruthy();
  expect(completePayload.data?.course_package?.remaining_lessons).toBe(19);
  expect(dialogCount).toBeGreaterThanOrEqual(2);
  await expect(orgCard).toContainText('19/20 次', { timeout: 20000 });
  await expect(orgCard).toContainText('已完成', { timeout: 20000 });
});
