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
      roles,
      confirmation: '确认修改机构成员',
      reauth_password: ''
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
  const memberPageResponse = await request.get(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, {
    params: { token: admin.token, role: 'student', q: studentLoginId, page: 1, page_size: 1, sort: 'username', order: 'asc' }
  });
  expect(memberPageResponse.ok()).toBeTruthy();
  const memberPagePayload = await memberPageResponse.json();
  expect(memberPagePayload.data.page).toBe(1);
  expect(memberPagePayload.data.page_size).toBe(1);
  expect(memberPagePayload.data.total).toBe(1);
  expect(memberPagePayload.data.items[0].user_id).toBe(student.user_id);
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
	await expect(detail).toContainText('已提交');
	const submissionCard = detail.locator(`[data-assignment-student="${demo.student.user_id}"]`);
	await submissionCard.locator('[data-submission-comment]').fill('E2E 批改评语');
	await submissionCard.locator('[data-submission-score]').fill('91');
	const reviewResponse = page.waitForResponse((response) =>
		response.url().includes(`/api/v1/assignments/${demo.assignment.assignment_id}/submissions/${demo.student.user_id}/review`) &&
		response.request().method() === 'POST'
	);
	await submissionCard.locator('[data-review-action="reviewed"]').click();
	const reviewPayload = await (await reviewResponse).json();
	expect(reviewPayload.code).toBe('OK');
	expect(reviewPayload.data?.manual_score).toBe(91);
	await expect(detail).toContainText('已批改', { timeout: 20000 });
	await expect(detail).toContainText('E2E 批改评语');

	await selectWorkbenchLearningGroup(page, demo.learningGroupId);
  await page.locator('#pc-institution-workbench [data-inst-gradebook]').click();
  await expect(detail.locator('.pc-service-header', { hasText: '学习组成绩册' })).toBeVisible({ timeout: 20000 });
  const remindResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/assignments/${demo.assignment.assignment_id}/reminders`) &&
    response.request().method() === 'POST'
  );
  await detail.locator(`[data-inst-assignment-remind="${demo.assignment.assignment_id}"]`).click();
  await page.locator('.pc-confirm-dialog [data-pc-input]').fill('请今天完成作业。');
  await page.locator('.pc-confirm-dialog [data-pc-input-ok]').click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
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
	await expect(detail.locator('.pc-service-header', { hasText: '跟进记录' })).toBeVisible();
  await expect(detail.locator('.pc-service-header', { hasText: '建议作业' })).toBeVisible();
  await expect(detail).toContainText(demo.studentLoginId);

  const noteSaveResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/institution/students/${demo.student.user_id}/teacher-notes`) &&
    response.request().method() === 'POST'
  );
  await detail.locator(`[data-inst-add-note="${demo.student.user_id}"]`).click();
  await page.locator('.pc-confirm-dialog [data-pc-input]').fill('E2E 老师备注');
  await page.locator('.pc-confirm-dialog [data-pc-input-ok]').click();
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
  const invitationContact = `cancel_${suffix}@example.com`;
  const invitationResponse = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/invitations`, {
    data: { token: admin.token, email: invitationContact, roles: ['student'] }
  });
  expect(invitationResponse.ok()).toBeTruthy();

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, adminLoginId);
  await page.locator('#user-menu-trigger').click();
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="成员管理"]').click();
  const memberListForm = page.locator('[data-org-member-list-form]').first();
  await expect(memberListForm).toBeVisible({ timeout: 20000 });
  const addMemberForm = page.locator('form[data-org-add-form]').first();
  await addMemberForm.locator('[data-org-search-query]').fill('invalid-contact');
  await addMemberForm.locator('button[type="submit"]').click();
  await expect(addMemberForm.locator('[data-org-search-query]')).toHaveAttribute('aria-invalid', 'true');
  await expect(addMemberForm.locator('.pc-field-error')).toContainText('完整邮箱/手机号');
  const cancelInvitationButton = page.locator('[data-org-invitation-cancel]', { hasText: '取消' }).first();
  await expect(cancelInvitationButton).toBeVisible();
  await cancelInvitationButton.click();
  await expect(cancelInvitationButton).toBeDisabled();
  await expect(cancelInvitationButton).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(cancelInvitationButton).toBeEnabled();
  await expect(cancelInvitationButton).toBeFocused();
  const memberListResponse = page.waitForResponse((response) =>
    response.url().includes(`/organizations/${organizationId}/members?`) && response.url().includes('page=1') && response.request().method() === 'GET'
  );
  await memberListForm.locator('[data-org-member-list-query]').fill(studentLoginId);
  await memberListForm.locator('button[type="submit"]').click();
  const memberListPayload = await (await memberListResponse).json();
  expect(memberListPayload.data).toHaveProperty('page', 1);
  expect(memberListPayload.data.total).toBe(1);
  await expect(page.locator('[data-org-member-list-query]').first()).toHaveValue(studentLoginId);
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="学习组"]').click();
  const learningListForm = page.locator('[data-org-learning-list-form]').first();
  await expect(learningListForm).toBeVisible({ timeout: 20000 });
  const learningListResponse = page.waitForResponse((response) =>
    response.url().includes(`/organizations/${organizationId}/learning-groups?`) && response.url().includes('page=1') && response.request().method() === 'GET'
  );
  await learningListForm.locator('[data-org-learning-list-query]').fill('EJU');
  await learningListForm.locator('button[type="submit"]').click();
  expect((await (await learningListResponse).json()).data).toHaveProperty('page', 1);
  await expect(page.locator('[data-org-learning-list-query]').first()).toHaveValue('EJU');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="机构设置"]').click();
  await expect(page.locator('[data-org-campus-list-form]').first()).toBeVisible({ timeout: 20000 });
  const subscriptionForm = page.locator('form[data-org-subscription-form]').first();
  await subscriptionForm.locator('[data-org-seats]').fill('0');
  await subscriptionForm.locator('button[type="submit"]').click();
  await expect(subscriptionForm.locator('[data-org-seats]')).toHaveAttribute('aria-invalid', 'true');
  await expect(subscriptionForm.locator('.pc-field-error')).toContainText('大于 0 的整数');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="课程包"]').click();
  await expect(page.locator('[data-org-package-list-form]').first()).toBeVisible({ timeout: 20000 });
  await page.locator('[data-dashboard-back]').click();

  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();

  const orgCard = page.locator('.pc-card.pc-info-card', { hasText: orgName }).first();
  await expect(orgCard).toBeVisible({ timeout: 20000 });
  await expect(orgCard.locator('h4', { hasText: '校区管理' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '课程包' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '排课日历' })).toBeVisible();
  await expect(orgCard.locator('h4', { hasText: '学习组' })).toBeVisible();

  let campusPostCount = 0;
  await page.route('**/api/v1/organizations/*/campuses', async (route) => {
    if (route.request().method() === 'POST') {
      campusPostCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });
  const campusResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/campuses`) &&
    response.request().method() === 'POST'
  );
  await orgCard.locator('[data-org-campus-name]').fill(campusName);
  await orgCard.locator('[data-org-campus-address]').fill('E2E address');
  const campusSubmit = orgCard.locator('form[data-org-campus-form] button[type="submit"]');
  await campusSubmit.click();
  await expect(campusSubmit).toBeDisabled();
  await campusSubmit.evaluate((button) => button.click());
  expect((await (await campusResponse).json()).code).toBe('OK');
  expect(campusPostCount).toBe(1);
  const campusPageResponse = await request.get(`/api/v1/organizations/${encodeURIComponent(organizationId)}/campuses`, {
    params: { token: admin.token, q: '东京校区', page: 1, page_size: 1, sort: 'name', order: 'asc' }
  });
  const campusPagePayload = await campusPageResponse.json();
  expect(campusPagePayload.data.total).toBe(1);
  expect(campusPagePayload.data.items[0].name).toContain('东京校区');
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
  const packagePageResponse = await request.get(`/api/v1/organizations/${encodeURIComponent(organizationId)}/course-packages`, {
    params: { token: admin.token, q: '文综约课', page: 1, page_size: 1, sort: 'remaining_lessons', order: 'desc' }
  });
  const packagePagePayload = await packagePageResponse.json();
  expect(packagePagePayload.data.total).toBe(1);
  expect(packagePagePayload.data.items[0].course_package_id).toBe(coursePackageId);
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

  const groupPageResponse = await request.get(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, {
    params: { token: admin.token, q: 'EJU', page: 1, page_size: 1, sort: 'name', order: 'asc' }
  });
  expect(groupPageResponse.ok()).toBeTruthy();
  const groupPagePayload = await groupPageResponse.json();
  expect(groupPagePayload.data.page).toBe(1);
  expect(groupPagePayload.data.page_size).toBe(1);
  expect(groupPagePayload.data.total).toBe(1);
  expect(groupPagePayload.data.items[0].learning_group_id).toBe(learningGroupId);
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

  const completeResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/organizations/${organizationId}/learning-groups/${learningGroupId}/complete`) &&
    response.request().method() === 'POST'
  );
  const completeButton = orgCard.locator(`[data-org-learning-group-complete][data-learning-group-id="${learningGroupId}"]`).first();
  await completeButton.click();
  await expect(completeButton).toBeDisabled();
  await expect(completeButton).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(completeButton).toBeEnabled();
  await expect(completeButton).toBeFocused();
  await completeButton.click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await page.locator('.pc-confirm-dialog [data-pc-input]').fill('E2E 课后完成');
  await page.locator('.pc-confirm-dialog [data-pc-input-ok]').click();
  const completePayload = await (await completeResponse).json();
  expect(completePayload.code).toBe('OK');
  expect(completePayload.data?.deducted).toBeTruthy();
  expect(completePayload.data?.course_package?.remaining_lessons).toBe(19);
  await expect(orgCard).toContainText('19/20 次', { timeout: 20000 });
  await expect(orgCard).toContainText('已完成', { timeout: 20000 });
});
