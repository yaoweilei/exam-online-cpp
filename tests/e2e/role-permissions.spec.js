const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');

const roleCases = [
  {
    prefix: 'student_role_perm',
    role: 'student',
    expectedFeatures: ['profile'],
    absentFeatures: ['questions', 'contentAdmin', 'memberAdmin', 'sysFlags'],
    expectedSections: ['learning'],
    absentSections: ['admin-hub']
  },
  {
    prefix: 'assistant_role_perm',
    role: 'assistant',
    expectedFeatures: ['profile'],
    absentFeatures: ['questions', 'contentAdmin', 'memberAdmin', 'sysFlags'],
    expectedSections: ['learning', 'admin-hub']
  },
  {
    prefix: 'teacher_role_perm',
    role: 'teacher',
    expectedFeatures: ['questions'],
    absentFeatures: ['contentAdmin', 'memberAdmin', 'sysFlags'],
    expectedSections: ['learning', 'admin-hub']
  },
  {
    prefix: 'orgadmin_role_perm',
    role: 'orgAdmin',
    expectedFeatures: ['memberAdmin'],
    absentFeatures: ['questions', 'contentAdmin', 'sysFlags'],
    expectedSections: ['learning', 'admin-hub']
  },
  {
    prefix: 'contentadmin_role_perm',
    role: 'contentAdmin',
    expectedFeatures: ['questions', 'contentAdmin'],
    absentFeatures: ['memberAdmin', 'sysFlags'],
    expectedSections: ['admin-hub'],
    absentSections: ['learning']
  },
  {
    prefix: 'superadmin_role_perm',
    role: 'superAdmin',
    expectedFeatures: ['questions', 'contentAdmin', 'memberAdmin', 'sysFlags'],
    expectedSections: ['learning', 'admin-hub']
  }
];

async function getOkJson(response) {
  const text = await response.text();
  expect(response.ok(), `status=${response.status()} body=${text}`).toBeTruthy();
  const payload = JSON.parse(text);
  expect(payload.code).toBe('OK');
  return payload;
}

async function expectApiCode(response, code) {
  const payload = JSON.parse(await response.text());
  expect(payload.code).toBe(code);
  return payload;
}

async function getMeContext(request, token) {
  const response = await request.get(`/api/v1/me/context?token=${encodeURIComponent(token)}`);
  const payload = await getOkJson(response);
  return payload.data;
}

async function createOrganizationApi(request, token, name) {
  const response = await request.post('/api/v1/organizations', {
    data: {
      token,
      name,
      organization_type: 'school',
      seats: 30,
      owner_roles: ['orgAdmin']
    }
  });
  const payload = await getOkJson(response);
  return payload.data;
}

async function addOrganizationMemberApi(request, token, organizationId, userId, roles) {
  const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members`, {
    data: { token, user_id: userId, roles }
  });
  const payload = await getOkJson(response);
  return payload.data;
}

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
  const payload = await getOkJson(response);
  return payload.data;
}

async function addLearningGroupEnrollmentApi(request, token, organizationId, learningGroupId, userId, role) {
  const response = await request.post(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/enrollments`,
    {
      data: {
        token,
        user_id: userId,
        role,
        status: 'active'
      }
    }
  );
  const payload = await getOkJson(response);
  return payload.data;
}

async function createAssignmentApi(request, token, organizationId, learningGroupId, title) {
  const response = await request.post(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        exam_id: '2023_02',
        title,
        description: 'Role permission matrix assignment',
        due_at: '2026-12-31',
        question_start: 1,
        question_end: 3
      }
    }
  );
  const payload = await getOkJson(response);
  return payload.data;
}

async function prepareRoleFixture(request) {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const sessions = {};
  for (const item of roleCases) {
    sessions[item.role] = await loginApi(request, uniqueLoginId(item.prefix));
    expect(sessions[item.role].roles).toContain(item.role);
  }

  const org = await createOrganizationApi(request, sessions.orgAdmin.token, `E2E 角色权限机构 ${suffix}`);
  const organizationId = org.organization_id || org.scope_id || org.id;
  const group = await createLearningGroupApi(request, sessions.orgAdmin.token, organizationId, `E2E 角色权限学习组 ${suffix}`);
  const learningGroupId = group.learning_group_id || group.group_id || group.id;

  await addOrganizationMemberApi(request, sessions.orgAdmin.token, organizationId, sessions.student.user_id, ['student']);
  await addOrganizationMemberApi(request, sessions.orgAdmin.token, organizationId, sessions.teacher.user_id, ['teacher']);
  await addOrganizationMemberApi(request, sessions.orgAdmin.token, organizationId, sessions.assistant.user_id, ['assistant']);

  await addLearningGroupEnrollmentApi(request, sessions.orgAdmin.token, organizationId, learningGroupId, sessions.student.user_id, 'student');
  await addLearningGroupEnrollmentApi(request, sessions.orgAdmin.token, organizationId, learningGroupId, sessions.teacher.user_id, 'teacher');
  await addLearningGroupEnrollmentApi(request, sessions.orgAdmin.token, organizationId, learningGroupId, sessions.assistant.user_id, 'assistant');

  const assignment = await createAssignmentApi(
    request,
    sessions.orgAdmin.token,
    organizationId,
    learningGroupId,
    `E2E 角色权限作业 ${suffix}`
  );

  return { sessions, organizationId, learningGroupId, assignment };
}

test('各正式角色的上下文、功能入口和工作台权限矩阵正确', async ({ request }) => {
  for (const item of roleCases) {
    const session = await loginApi(request, uniqueLoginId(item.prefix));
    expect(session.roles).toContain(item.role);

    const context = await getMeContext(request, session.token);
    const roles = context.permissions?.roles ?? [];
    const features = (context.permissions?.features ?? []).map((feature) => feature.id);
    const sections = (context.permissions?.sections ?? []).map((section) => section.id);

    expect(roles).toContain(item.role);
    for (const feature of item.expectedFeatures ?? []) {
      expect(features).toContain(feature);
    }
    for (const feature of item.absentFeatures ?? []) {
      expect(features).not.toContain(feature);
    }
    for (const section of item.expectedSections ?? []) {
      expect(sections).toContain(section);
    }
    for (const section of item.absentSections ?? []) {
      expect(sections).not.toContain(section);
    }
  }
});

test('游客和普通角色不能访问高权限 API', async ({ request }) => {
  const sessions = {};
  for (const item of roleCases) {
    sessions[item.role] = await loginApi(request, uniqueLoginId(item.prefix));
  }

  await expectApiCode(await request.get('/api/v1/admin/statistics/overview'), 'VALIDATION_ERROR');
  await expectApiCode(await request.post('/api/v1/chapters/rebuild'), 'VALIDATION_ERROR');

  for (const role of ['student', 'assistant', 'teacher', 'orgAdmin', 'contentAdmin']) {
    const adminResponse = await request.get(
      `/api/v1/admin/statistics/overview?token=${encodeURIComponent(sessions[role].token)}`
    );
    await expectApiCode(adminResponse, 'FORBIDDEN');
  }

  for (const role of ['student', 'assistant', 'teacher', 'orgAdmin']) {
    const rebuildResponse = await request.post(
      `/api/v1/chapters/rebuild?token=${encodeURIComponent(sessions[role].token)}`
    );
    await expectApiCode(rebuildResponse, 'FORBIDDEN');
  }
});

test('平台级权限只开放给 contentAdmin 和 superAdmin 的对应能力', async ({ request }) => {
  const contentAdmin = await loginApi(request, uniqueLoginId('contentadmin_content_perm'));
  const superAdmin = await loginApi(request, uniqueLoginId('superadmin_content_perm'));

  const relatedRebuild = await request.post(
    `/api/v1/related-questions/rebuild?token=${encodeURIComponent(contentAdmin.token)}`
  );
  await getOkJson(relatedRebuild);

  const superStats = await request.get(
    `/api/v1/admin/statistics/overview?token=${encodeURIComponent(superAdmin.token)}`
  );
  await getOkJson(superStats);

  const contentStats = await request.get(
    `/api/v1/admin/statistics/overview?token=${encodeURIComponent(contentAdmin.token)}`
  );
  await expectApiCode(contentStats, 'FORBIDDEN');
});

test('机构和学习组权限按 orgAdmin、teacher、assistant、student、contentAdmin、superAdmin 区分', async ({ request }) => {
  const { sessions, organizationId, learningGroupId, assignment } = await prepareRoleFixture(request);
  const assignmentId = assignment.assignment_id;

  for (const role of ['orgAdmin', 'teacher', 'assistant', 'superAdmin']) {
    const response = await request.get(
      `/api/v1/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/gradebook?token=${encodeURIComponent(sessions[role].token)}`
    );
    await getOkJson(response);
  }

  for (const role of ['student', 'contentAdmin']) {
    const response = await request.get(
      `/api/v1/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/gradebook?token=${encodeURIComponent(sessions[role].token)}`
    );
    const payload = await response.json();
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(payload.code);
  }

  for (const role of ['orgAdmin', 'teacher', 'assistant', 'superAdmin']) {
    const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
      data: { token: sessions[role].token, message: `role ${role} reminder` }
    });
    await getOkJson(response);
  }

  for (const role of ['student', 'contentAdmin']) {
    const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
      data: { token: sessions[role].token, message: `role ${role} reminder` }
    });
    await expectApiCode(response, 'FORBIDDEN');
  }

  const submitResponse = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
    headers: { Authorization: `Bearer ${sessions.student.token}` },
    data: { answers: {} }
  });
  const submitPayload = await getOkJson(submitResponse);
  expect(submitPayload.data?.submission?.status).toBe('submitted');

  for (const role of ['teacher', 'assistant', 'contentAdmin']) {
    const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/submit`, {
      headers: { Authorization: `Bearer ${sessions[role].token}` },
      data: { answers: {} }
    });
    await expectApiCode(response, 'FORBIDDEN');
  }

  for (const role of ['student', 'teacher', 'assistant', 'contentAdmin']) {
    const response = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, {
      data: {
        token: sessions[role].token,
        name: `unauthorized ${role}`,
        type: 'class',
        subject: 'japanese',
        status: 'active'
      }
    });
    await expectApiCode(response, 'FORBIDDEN');
  }

  const superCreateGroup = await request.post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/learning-groups`, {
    data: {
      token: sessions.superAdmin.token,
      name: 'superAdmin 管理学习组',
      type: 'class',
      subject: 'japanese',
      status: 'active'
    }
  });
  await getOkJson(superCreateGroup);
});
