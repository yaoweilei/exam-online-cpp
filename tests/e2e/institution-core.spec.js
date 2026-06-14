const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

const ADMIN_LOGIN_PREFIX = 'orgadmin_teaching';
const STUDENT_LOGIN_PREFIX = 'student_teaching';

async function createClassroomApi(request, token, name) {
  const response = await request.post('/api/v1/classrooms', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      description: 'Playwright 可视化测试预置的班级',
      org_id: ''
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function addClassroomMemberApi(request, token, classId, userId) {
  const response = await request.post(`/api/v1/classrooms/${encodeURIComponent(classId)}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_ids: [userId] }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
}

async function createAssignmentApi(request, token, classId, title) {
  const response = await request.post(`/api/v1/classrooms/${encodeURIComponent(classId)}/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      exam_id: 'eju_2023_02',
      title,
      description: 'Playwright 可视化测试预置的作业',
      due_at: '2026-12-31'
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function prepareTeachingDemo(request) {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const adminLoginId = uniqueLoginId(ADMIN_LOGIN_PREFIX);
  const studentLoginId = uniqueLoginId(STUDENT_LOGIN_PREFIX);
  const admin = await loginApi(request, adminLoginId);
  const student = await loginApi(request, studentLoginId);
  const className = `E2E 核心教学班 ${suffix}`;
  const assignmentTitle = `E2E 读解作业 ${suffix}`;
  const classroom = await createClassroomApi(request, admin.token, className);
  await addClassroomMemberApi(request, admin.token, classroom.class_id, student.user_id);
  await createAssignmentApi(request, admin.token, classroom.class_id, assignmentTitle);
  return {
    admin,
    adminLoginId,
    student,
    studentLoginId,
    classroom,
    className,
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
  await expect(workbench.locator('[data-inst-create-class]')).toBeVisible({ timeout: 20000 });
  return workbench;
}

test('机构核心教学能力可以通过 Web 查看和进入', async ({ page, request }) => {
  const demo = await prepareTeachingDemo(request);

  await stubNoisyPersonalCenterApis(page);
  await loginWithPassword(page, demo.adminLoginId);
  const workbench = await openInstitutionWorkbench(page);

  const classSelect = page.locator('#pc-institution-workbench [data-inst-class]');
  await expect(classSelect).toContainText(demo.className, { timeout: 20000 });
  await expect(workbench.locator('[data-inst-create-class]')).toBeVisible();
  await expect(workbench.locator('[data-inst-add-members]')).toBeVisible();
  await expect(workbench.locator('[data-inst-create-assignment]')).toBeVisible();
  await expect.poll(async () => {
    const currentSelect = page.locator('#pc-institution-workbench [data-inst-class]');
    await currentSelect.selectOption(demo.classroom.class_id);
    return await currentSelect.inputValue();
  }, { timeout: 20000 }).toBe(demo.classroom.class_id);

  const gradebookResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/institution/classes/${demo.classroom.class_id}/gradebook`) &&
    response.request().method() === 'GET'
  );
  await page.locator('#pc-institution-workbench [data-inst-gradebook]').click();
  const gradebookPayload = await (await gradebookResponse).json();
  expect(gradebookPayload.code).toBe('OK');
  const studentIds = (gradebookPayload.data?.students ?? []).map((row) => row?.student?.id);
  expect(studentIds).toContain(demo.student.user_id);

  const detail = page.locator('#pc-institution-detail');
  await expect(detail.locator('.pc-service-header', { hasText: '班级成绩册' })).toBeVisible({ timeout: 20000 });
  await expect(detail).toContainText(demo.studentLoginId);
  await expect(detail.locator(`[data-inst-student="${demo.student.user_id}"]`)).toBeVisible();

  await detail.locator(`[data-inst-student="${demo.student.user_id}"]`).click();
  await expect(detail.locator('.pc-service-header', { hasText: '学员档案' })).toBeVisible({ timeout: 20000 });
  await expect(detail).toContainText(demo.studentLoginId);
});
