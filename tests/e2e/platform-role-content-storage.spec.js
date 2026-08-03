const { test, expect, request: requestFactory } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');

async function ok(response) {
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  const payload = JSON.parse(body); expect(payload.code).toBe('OK'); return payload.data;
}

async function errorCode(response) {
  const body = await response.text();
  expect(response.ok(), body).toBeFalsy();
  return JSON.parse(body).code;
}

test('用户资料与订阅权益接口拒绝匿名、跨用户和绕过支付的请求', async ({ request }) => {
  const student = await loginApi(request, uniqueLoginId('student_security_boundary'));
  const other = await loginApi(request, uniqueLoginId('student_security_other'));

  const anonymous = await requestFactory.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000'
  });
  try {
    expect(await errorCode(await anonymous.get(`/api/v1/users/${encodeURIComponent(student.user_id)}`))).toBe('AUTH_REQUIRED');
    expect(await errorCode(await anonymous.get('/api/v1/users/by-role/student'))).toBe('AUTH_REQUIRED');
  } finally {
    await anonymous.dispose();
  }
  expect(await errorCode(await request.get(`/api/v1/users/${encodeURIComponent(other.user_id)}?token=${encodeURIComponent(student.token)}`))).toBe('FORBIDDEN');
  expect(await errorCode(await request.get(`/api/v1/users/${encodeURIComponent(other.user_id)}/permissions?token=${encodeURIComponent(student.token)}`))).toBe('FORBIDDEN');
  expect(await errorCode(await request.get(`/api/v1/users/by-role/student?token=${encodeURIComponent(student.token)}`))).toBe('FORBIDDEN');

  const ownUser = await ok(await request.get(`/api/v1/users/${encodeURIComponent(student.user_id)}?token=${encodeURIComponent(student.token)}`));
  expect(ownUser.id).toBe(student.user_id);
  await ok(await request.get(`/api/v1/users/${encodeURIComponent(student.user_id)}/permissions?token=${encodeURIComponent(student.token)}`));

  const paidGrant = await request.post(`/api/v1/subscription/${encodeURIComponent(student.user_id)}/grant`, {
    data: { token: student.token, plan: 'ultra', status: 'active', expires_at: '2099-12-31T23:59:59Z' }
  });
  expect(await errorCode(paidGrant)).toBe('PAYMENT_REQUIRED');
});

test('非超管创建机构不能伪造付费套餐、角色和席位，也不能直接扩席', async ({ request }) => {
  const orgAdmin = await loginApi(request, uniqueLoginId('orgadmin_entitlement_boundary'));
  const organization = await ok(await request.post('/api/v1/organizations', {
    data: {
      token: orgAdmin.token,
      name: `安全边界机构 ${Date.now()}`,
      organization_type: 'school',
      plan: 'ultra',
      status: 'trial',
      expires_at: '2099-12-31T23:59:59Z',
      seats: 999,
      owner_roles: ['superAdmin']
    }
  }));
  const organizationId = organization.organization_id || organization.scope_id || organization.id;
  expect(organization.subscription.plan).toBe('free');
  expect(organization.seats).toBe(5);
  const members = await ok(await request.get(`/api/v1/organizations/${encodeURIComponent(organizationId)}/members?token=${encodeURIComponent(orgAdmin.token)}`));
  const owner = members.find((member) => member.user_id === orgAdmin.user_id);
  expect(owner.roles).toContain('orgAdmin');
  expect(owner.roles).not.toContain('superAdmin');

  const upgrade = await request.post(`/api/v1/subscription/${encodeURIComponent(organizationId)}/grant`, {
    data: { token: orgAdmin.token, scope_type: 'organization', plan: 'pro', seats: 20 }
  });
  expect(await errorCode(upgrade)).toBe('PAYMENT_REQUIRED');
});

test('平台角色模板支持差异、临时授权、会话失效和自我超管保护', async ({ request }) => {
  const admin = await loginApi(request, uniqueLoginId('superadmin_role_template'));
  const student = await loginApi(request, uniqueLoginId('student_temporary_grant'));
  const templates = await ok(await request.get(`/api/v1/admin/role-templates?token=${encodeURIComponent(admin.token)}`));
  const teacher = templates.find((item) => item.id === 'teacher');
  expect(teacher.default_permissions.length).toBeGreaterThan(0);
  expect(teacher).toHaveProperty('allow_organization_override');

  const preview = await ok(await request.post('/api/v1/admin/users/' + encodeURIComponent(student.user_id) + '/platform-access/preview', {
    data: { token: admin.token, temporary_grants: [{ role_id: 'contentAdmin', effect: 'allow', permissions: [], expires_at: '2099-01-01T00:00:00Z' }] }
  }));
  expect(preview.after.roles).toContain('contentAdmin');

  await ok(await request.put('/api/v1/admin/users/' + encodeURIComponent(student.user_id) + '/platform-access', {
    data: { token: admin.token, temporary_grants: [{ role_id: 'contentAdmin', effect: 'allow', permissions: [], expires_at: '2099-01-01T00:00:00Z' }], confirmation: '确认修改平台权限', reauth_password: '' }
  }));
  expect((await request.get(`/api/v1/me/context?token=${encodeURIComponent(student.token)}`)).ok()).toBeFalsy();
  const relogin = await loginApi(request, student.username);
  expect(relogin.roles).toContain('contentAdmin');

  const self = await request.put('/api/v1/admin/users/' + encodeURIComponent(admin.user_id) + '/platform-access', {
    data: { token: admin.token, roles: ['student'], confirmation: '确认修改平台权限', reauth_password: '' }
  });
  expect((await self.json()).code).toBe('SELF_SUPERADMIN_CHANGE_FORBIDDEN');
});

test('内容工作流执行质检、双重复核、发布版本和回滚', async ({ request }) => {
  const admin = await loginApi(request, uniqueLoginId('superadmin_content_workflow'));
  const examId = '2023_02';
  const batch = await ok(await request.post('/api/v1/admin/content/workflow/inspect-batch', {
    data: { token: admin.token, exam_ids: [examId, 'missing_exam_for_batch_e2e'] }
  }));
  expect(batch).toMatchObject({ requested_count: 2, processed_count: 1, unavailable_count: 1 });
  expect(batch.items.find((item) => item.exam_id === examId)).toMatchObject({ processed: true });
  expect(batch.items.find((item) => item.exam_id === 'missing_exam_for_batch_e2e')).toMatchObject({ processed: false });

  const inspection = await ok(await request.post(`/api/v1/admin/content/workflow/${examId}/inspect`, { data: { token: admin.token } }));
  expect(inspection.inspection).toHaveProperty('errors');
  expect(inspection.inspection).toHaveProperty('assets');
  await ok(await request.put(`/api/v1/admin/content/workflow/${examId}/reviews/analysis`, { data: { token: admin.token, status: 'approved', note: '解析审核通过' } }));
  await ok(await request.put(`/api/v1/admin/content/workflow/${examId}/reviews/secondary`, { data: { token: admin.token, status: 'approved', note: '复核通过' } }));
  if (inspection.inspection.passed) {
    const published = await ok(await request.post(`/api/v1/admin/content/workflow/${examId}/publish`, { data: { token: admin.token, confirmation: '确认发布', reauth_password: '' } }));
    const versions = await ok(await request.get(`/api/v1/admin/content/workflow/${examId}/versions?token=${encodeURIComponent(admin.token)}`));
    expect(versions.some((item) => item.id === published.version_id)).toBeTruthy();
    const rollback = await ok(await request.post(`/api/v1/admin/content/workflow/${examId}/versions/${published.version_id}/rollback`, { data: { token: admin.token, confirmation: '确认回滚', reauth_password: '' } }));
    expect(rollback.kind).toBe('rollback');
  }
});
