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
    data: { token, user_id: userId, roles, confirmation: '确认修改机构成员', reauth_password: '' }
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

  await expectApiCode(await request.get('/api/v1/admin/statistics/overview'), 'AUTH_REQUIRED');
  await expectApiCode(await request.post('/api/v1/chapters/rebuild'), 'AUTH_REQUIRED');

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

test('系统功能开关只允许超级管理员读取和确认后修改', async ({ request }) => {
  const student = await loginApi(request, uniqueLoginId('student_flag_perm'));
  const superAdminLoginId = uniqueLoginId('superadmin_flag_perm');
  const superAdmin = await loginApi(request, superAdminLoginId);
  const otherSuperAdminSession = await loginApi(request, superAdminLoginId);
  await expectApiCode(await request.get('/api/v1/admin/feature-flags/system', {
    headers: { Authorization: `Bearer ${student.token}` }
  }), 'FORBIDDEN');

  const snapshotResponse = await request.get('/api/v1/admin/feature-flags/system', {
    headers: { Authorization: `Bearer ${superAdmin.token}` }
  });
  const snapshot = await getOkJson(snapshotResponse);
  const original = snapshot.data.flags.related_questions;
  expect(original.key).toBe('related_questions');
  expect(['default', 'system']).toContain(original.source);

  const missingConfirmation = await request.put('/api/v1/admin/feature-flags/system', {
    data: { token: superAdmin.token, related_questions: { enabled: !original.enabled, lock: original.locked } }
  });
  await expectApiCode(missingConfirmation, 'VALIDATION_ERROR');

  const missingReauthentication = await request.put('/api/v1/admin/feature-flags/system', {
    data: {
      token: superAdmin.token,
      confirmation: '确认修改系统开关',
      related_questions: { enabled: !original.enabled, lock: original.locked }
    }
  });
  await expectApiCode(missingReauthentication, 'REAUTH_REQUIRED');

  const invalidReauthentication = await request.put('/api/v1/admin/feature-flags/system', {
    data: {
      token: superAdmin.token,
      confirmation: '确认修改系统开关',
      reauth_password: 'wrong-password',
      related_questions: { enabled: !original.enabled, lock: original.locked }
    }
  });
  await expectApiCode(invalidReauthentication, 'REAUTH_FAILED');

  const updateResponse = await request.put('/api/v1/admin/feature-flags/system', {
    data: {
      token: superAdmin.token,
      confirmation: '确认修改系统开关',
      reauth_password: '',
      related_questions: { enabled: !original.enabled, lock: original.locked }
    }
  });
  await getOkJson(updateResponse);
  await expectApiCode(await request.get(
    `/api/v1/me/context?token=${encodeURIComponent(otherSuperAdminSession.token)}`
  ), 'TOKEN_INVALID');
  const changed = await getOkJson(await request.get('/api/v1/admin/feature-flags/system', {
    headers: { Authorization: `Bearer ${superAdmin.token}` }
  }));
  expect(changed.data.flags.related_questions.enabled).toBe(!original.enabled);
  expect(changed.data.flags.related_questions.source).toBe('system');

  const auditResponse = await request.get(
    `/api/v1/admin/audit-logs?action=${encodeURIComponent('feature_flags.system.updated')}&actor_id=${encodeURIComponent(superAdmin.user_id)}&limit=10`,
    { headers: { Authorization: `Bearer ${superAdmin.token}` } }
  );
  const audit = await getOkJson(auditResponse);
  expect(audit.data.items.some((item) =>
    item.action === 'feature_flags.system.updated'
      && item.action_label === '修改系统功能开关'
      && item.scope === 'platform'
  )).toBeTruthy();
  const actionResponse = await getOkJson(await request.get('/api/v1/admin/audit-logs/actions', {
    headers: { Authorization: `Bearer ${superAdmin.token}` }
  }));
  expect(actionResponse.data.actions).toContain('feature_flags.system.updated');
  expect(actionResponse.data.action_options).toContainEqual({
    value: 'feature_flags.system.updated',
    label: '修改系统功能开关'
  });

  const restorePatch = original.source === 'default'
    ? { related_questions: null }
    : { related_questions: { enabled: original.enabled, lock: original.locked } };
  await getOkJson(await request.put('/api/v1/admin/feature-flags/system', {
    data: { token: superAdmin.token, confirmation: '确认修改系统开关', reauth_password: '', ...restorePatch }
  }));
});

test('机构功能开关校验机构归属，并允许超级管理员显式跨机构管理', async ({ request }) => {
  const firstAdmin = await loginApi(request, uniqueLoginId('orgadmin_flag_owner_a'));
  const secondAdmin = await loginApi(request, uniqueLoginId('orgadmin_flag_owner_b'));
  const superAdmin = await loginApi(request, uniqueLoginId('superadmin_org_flag_cross'));
  const firstOrganization = await createOrganizationApi(request, firstAdmin.token, `开关机构甲-${Date.now()}`);
  const secondOrganization = await createOrganizationApi(request, secondAdmin.token, `开关机构乙-${Date.now()}`);
  const firstOrganizationId = firstOrganization.organization_id || firstOrganization.scope_id || firstOrganization.id;
  const secondOrganizationId = secondOrganization.organization_id || secondOrganization.scope_id || secondOrganization.id;

  const forgedOrganizationId = await request.put(
    `/api/v1/admin/feature-flags/orgs/${encodeURIComponent(secondOrganizationId)}`,
    {
      data: {
        token: firstAdmin.token,
        confirmation: '确认修改机构开关',
        reauth_password: '',
        related_questions: { enabled: false }
      }
    }
  );
  await expectApiCode(forgedOrganizationId, 'ORGANIZATION_ACCESS_DENIED');

  await getOkJson(await request.put(
    `/api/v1/admin/feature-flags/orgs/${encodeURIComponent(firstOrganizationId)}`,
    {
      data: {
        token: firstAdmin.token,
        confirmation: '确认修改机构开关',
        reauth_password: '',
        related_questions: { enabled: false }
      }
    }
  ));

  await getOkJson(await request.put(
    `/api/v1/admin/feature-flags/orgs/${encodeURIComponent(secondOrganizationId)}`,
    {
      data: {
        token: superAdmin.token,
        confirmation: '确认修改机构开关',
        reauth_password: '',
        related_questions: { enabled: true }
      }
    }
  ));
});

test('机构成员角色变更后撤销该成员的全部旧会话', async ({ request }) => {
  const owner = await loginApi(request, uniqueLoginId('orgadmin_member_session_owner'));
  const memberLoginId = uniqueLoginId('student_member_session_target');
  const memberSession = await loginApi(request, memberLoginId);
  const organization = await createOrganizationApi(request, owner.token, `成员会话机构-${Date.now()}`);
  const organizationId = organization.organization_id || organization.scope_id || organization.id;

  await addOrganizationMemberApi(request, owner.token, organizationId, memberSession.user_id, ['student']);
  await getMeContext(request, memberSession.token);

  await getOkJson(await request.put(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    {
      data: {
        token: owner.token,
        user_id: memberSession.user_id,
        roles: ['teacher'],
        confirmation: '确认修改机构成员',
        reauth_password: ''
      }
    }
  ));

  await expectApiCode(await request.get(
    `/api/v1/me/context?token=${encodeURIComponent(memberSession.token)}`
  ), 'TOKEN_INVALID');
});

test('套餐价格配置只允许超级管理员维护，订单金额读取配置', async ({ request }) => {
  const student = await loginApi(request, uniqueLoginId('student_pricing_perm'));
  const superAdmin = await loginApi(request, uniqueLoginId('superadmin_pricing_perm'));

  const publicPricing = await request.get('/api/v1/payments/pricing');
  const publicPayload = await getOkJson(publicPricing);
  expect(publicPayload.data.prices_cents.cny.pro['30']).toBe(1290);

  const pricingPayload = {
    token: student.token,
    default_provider: 'wechat',
    prices_cents: {
      cny: {
        pro: { 30: 1290, 90: 3870, 365: 15480 },
        ultra: { 30: 3900, 90: 9900, 365: 29900 }
      }
    }
  };
  const forbidden = await request.put('/api/v1/admin/payments/pricing', { data: pricingPayload });
  await expectApiCode(forbidden, 'FORBIDDEN');

  const updated = await request.put('/api/v1/admin/payments/pricing', {
    data: { ...pricingPayload, token: superAdmin.token, confirmation: '确认修改套餐价格', reauth_password: '' }
  });
  const updatedPayload = await getOkJson(updated);
  expect(updatedPayload.data.default_provider).toBe('wechat');
  expect(updatedPayload.data.prices_cents.cny.pro['30']).toBe(1290);

  const order = await request.post('/api/v1/payments/orders', {
    data: {
      token: student.token,
      plan: 'pro',
      days: 30,
      provider: 'wechat',
      currency: 'cny'
    }
  });
  const orderPayload = await getOkJson(order);
  expect(orderPayload.data.amount_cents).toBe(1290);
  expect(orderPayload.data.provider).toBe('wechat');
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
    const idempotencyKey = `role-${role}-${Date.now()}`;
    const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
      data: { token: sessions[role].token, message: `role ${role} reminder`, idempotency_key: idempotencyKey }
    });
    const first = await getOkJson(response);
    expect(first.data.idempotent_replay).toBe(false);
    const replayResponse = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
      data: { token: sessions[role].token, message: `role ${role} reminder`, idempotency_key: idempotencyKey }
    });
    const replay = await getOkJson(replayResponse);
    expect(replay.data.reminder_id).toBe(first.data.reminder_id);
    expect(replay.data.idempotent_replay).toBe(true);
  }

  for (const role of ['student', 'contentAdmin']) {
    const response = await request.post(`/api/v1/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
      data: { token: sessions[role].token, message: `role ${role} reminder`, idempotency_key: `forbidden-${role}-${Date.now()}` }
    });
    await expectApiCode(response, 'FORBIDDEN');
  }

  const orgAuditResponse = await request.get(
    `/api/v1/admin/audit-logs?action=${encodeURIComponent('assignment.reminder.sent')}&actor_id=${encodeURIComponent(sessions.orgAdmin.user_id)}&org_id=another-org`,
    { headers: { Authorization: `Bearer ${sessions.orgAdmin.token}` } }
  );
  const orgAudit = await getOkJson(orgAuditResponse);
  expect(orgAudit.data.total).toBe(1);
  expect(orgAudit.data.items[0].org_id).toBe(organizationId);

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
