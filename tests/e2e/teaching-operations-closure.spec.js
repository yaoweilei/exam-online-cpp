const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');

async function ok(response, label) {
  if (!response.ok()) throw new Error(`${label} failed ${response.status()}: ${await response.text()}`);
  const payload = await response.json();
  expect(payload.code).toBe('OK');
  return payload.data;
}

test('教师批改退回、运营跟进和排课状态形成真实闭环', async ({ request }) => {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const admin = await loginApi(request, uniqueLoginId('closure_admin'));
  const teacher = await loginApi(request, uniqueLoginId('closure_teacher'));
  const assistant = await loginApi(request, uniqueLoginId('closure_assistant'));
  const student = await loginApi(request, uniqueLoginId('closure_student'));

  const organization = await ok(await request.post('/api/v1/organizations', { data: {
    token: admin.token,
    name: `E2E 教学闭环 ${suffix}`,
    organization_type: 'school',
    seats: 12,
    owner_roles: ['orgAdmin']
  } }), 'create organization');
  const organizationId = organization.organization_id || organization.scope_id || organization.id;

  for (const [session, roles] of [[teacher, ['teacher']], [assistant, ['assistant']], [student, ['student']]]) {
    await ok(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, { data: {
      token: admin.token,
      user_id: session.user_id,
      roles,
      confirmation: '确认修改机构成员',
      reauth_password: ''
    } }), 'add organization member');
  }

  const group = await ok(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, { data: {
    token: admin.token,
    name: `闭环学习组 ${suffix}`,
    type: 'booking',
    subject: 'japanese',
    starts_at: '2026-08-01T10:00:00Z',
    ends_at: '2026-08-01T11:00:00Z',
    status: 'scheduled'
  } }), 'create learning group');
  const learningGroupId = group.learning_group_id || group.group_id || group.id;

  for (const [session, role] of [[teacher, 'teacher'], [assistant, 'assistant'], [student, 'student']]) {
    await ok(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/enrollments`, { data: {
      token: admin.token,
      user_id: session.user_id,
      role,
      status: 'active'
    } }), 'add learning group enrollment');
  }

  const assignment = await ok(await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`, {
    headers: { Authorization: `Bearer ${teacher.token}` },
    data: { exam_id: '2023_02', title: `闭环作业 ${suffix}`, due_at: '2026-08-02T12:00:00Z', question_start: 1, question_end: 3 }
  }), 'create assignment');
  const assignmentId = assignment.assignment_id;

  await ok(await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
    headers: { Authorization: `Bearer ${student.token}` },
    data: { answers: {} }
  }), 'submit assignment');

  const returned = await ok(await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(student.user_id)}/review`, {
    headers: { Authorization: `Bearer ${teacher.token}` },
    data: { action: 'returned', comment: '请订正错题后重新提交。' }
  }), 'return submission');
  expect(returned.review_status).toBe('returned');
  expect(returned.teacher_comment).toContain('重新提交');

  const studentAssignment = await ok(await request.get(`/api/v1/assignments/${encodeURIComponent(assignmentId)}`, {
    headers: { Authorization: `Bearer ${student.token}` }
  }), 'get student assignment');
  expect(studentAssignment.own_submission.review_status).toBe('returned');

  await ok(await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
    headers: { Authorization: `Bearer ${student.token}` },
    data: { answers: {} }
  }), 'resubmit assignment');
  const reviewed = await ok(await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(student.user_id)}/review`, {
    headers: { Authorization: `Bearer ${assistant.token}` },
    data: { action: 'reviewed', comment: '订正完成。', manual_score: 88 }
  }), 'review submission');
  expect(reviewed.review_status).toBe('reviewed');
  expect(reviewed.manual_score).toBe(88);
	expect(reviewed.review_history).toHaveLength(2);

  const rescheduled = await ok(await request.patch(`/api/v1/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/schedule`, {
    headers: { Authorization: `Bearer ${assistant.token}` },
    data: { starts_at: '2026-08-03T10:00:00Z', ends_at: '2026-08-03T11:00:00Z', status: 'rescheduled' }
  }), 'reschedule class');
  expect(rescheduled.status).toBe('rescheduled');

  const noShow = await ok(await request.patch(`/api/v1/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/schedule`, {
    headers: { Authorization: `Bearer ${teacher.token}` },
    data: { status: 'no_show' }
  }), 'mark no show');
  expect(noShow.status).toBe('no_show');

  const forbidden = await request.patch(`/api/v1/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/schedule`, {
    headers: { Authorization: `Bearer ${student.token}` },
    data: { status: 'cancelled' }
  });
  expect(forbidden.status()).toBe(403);

  const profile = await ok(await request.post(`/api/v1/institution/students/${encodeURIComponent(student.user_id)}/teacher-notes`, {
    headers: { Authorization: `Bearer ${assistant.token}` },
    data: { text: '电话跟进：已确认下次上课时间。' }
  }), 'save follow-up');
  expect(profile.teacher_notes.some((item) => item.text.includes('电话跟进'))).toBeTruthy();
});
