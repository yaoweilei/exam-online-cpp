const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');

async function ok(response) {
  const text = await response.text();
  expect(response.ok(), `status=${response.status()} body=${text}`).toBeTruthy();
  const payload = JSON.parse(text);
  expect(payload.code).toBe('OK');
  return payload.data;
}

async function createStripeOrder(request, token) {
  return ok(await request.post('/api/v1/payments/orders', {
    data: { token, plan: 'pro', days: 30, provider: 'stripe', currency: 'cny' }
  }));
}

async function markPaid(request, order) {
  return ok(await request.post('/api/v1/payments/webhooks/stripe', {
    data: {
      id: `evt_paid_${order.id}`,
      type: 'checkout.session.completed',
      data: { object: { id: `cs_${order.id}`, client_reference_id: order.id, payment_intent: `pi_${order.id}` } }
    }
  }));
}

async function requestRefund(request, token, orderId, suffix) {
  return ok(await request.post('/api/v1/payments/refunds', {
    data: {
      token,
      order_id: orderId,
      reason: 'e2e_closure',
      confirmation: '确认退款',
      reauth_password: '',
      idempotency_key: `refund-e2e-${suffix}-${Date.now()}`
    }
  }));
}

test('平台支付形成订单、支付、权益、退款、流水和对账闭环', async ({ request }) => {
  const student = await loginApi(request, uniqueLoginId('student_payment_closure'));
  const admin = await loginApi(request, uniqueLoginId('superadmin_payment_closure'));

  const forbidden = await request.get(`/api/v1/admin/payments/orders?token=${encodeURIComponent(student.token)}`);
  expect((await forbidden.json()).code).toBe('FORBIDDEN');

  const order = await createStripeOrder(request, student.token);
  const paid = await markPaid(request, order);
  expect(paid.status).toBe('paid');
  expect(paid.subscription.plan).toBe('pro');

  const orderList = await ok(await request.get(`/api/v1/admin/payments/orders?token=${encodeURIComponent(admin.token)}&q=${encodeURIComponent(order.id)}&page_size=10`));
  expect(orderList.items.some((item) => item.id === order.id && item.status === 'paid')).toBeTruthy();

  const refund = await requestRefund(request, admin.token, order.id, 'success');
  expect(['requested', 'requires_provider_console', 'requires_manual_review']).toContain(refund.status);

  const processing = await ok(await request.patch(`/api/v1/admin/payments/refunds/${encodeURIComponent(refund.id)}/status`, {
    data: { token: admin.token, status: 'processing', note: '已核对渠道退款单', confirmation: '确认更新退款', reauth_password: '' }
  }));
  expect(processing.status).toBe('processing');

  const succeeded = await ok(await request.post('/api/v1/payments/webhooks/stripe', {
    data: {
      id: `evt_refund_success_${refund.id}`,
      type: 'refund.updated',
      data: { object: { id: `re_${refund.id}`, status: 'succeeded', metadata: { refund_id: refund.id, order_id: order.id } } }
    }
  }));
  expect(succeeded.status).toBe('succeeded');
  expect(succeeded.entitlement_reversal_status).toBe('succeeded');

  const refundedOrder = await ok(await request.get(`/api/v1/payments/orders/${encodeURIComponent(order.id)}?token=${encodeURIComponent(admin.token)}`));
  expect(refundedOrder.status).toBe('refunded');

  const refunds = await ok(await request.get(`/api/v1/admin/payments/refunds?token=${encodeURIComponent(admin.token)}&order_id=${encodeURIComponent(order.id)}`));
  expect(refunds.items.some((item) => item.id === refund.id && item.status === 'succeeded')).toBeTruthy();

  const ledger = await ok(await request.get(`/api/v1/admin/payments/ledger?token=${encodeURIComponent(admin.token)}&order_id=${encodeURIComponent(order.id)}&page_size=100`));
  const types = ledger.items.map((item) => item.type);
  expect(types).toEqual(expect.arrayContaining(['order.created', 'payment.succeeded', 'subscription.granted', 'refund.requested', 'refund.succeeded', 'subscription.reversed']));

  const reconciliation = await ok(await request.get(`/api/v1/admin/payments/reconciliation?token=${encodeURIComponent(admin.token)}`));
  expect(reconciliation.items.filter((item) => item.order_id === order.id)).toEqual([]);
});

test('退款失败回调落库，机构扩席订单可查询', async ({ request }) => {
  const student = await loginApi(request, uniqueLoginId('student_payment_failed'));
  const admin = await loginApi(request, uniqueLoginId('superadmin_payment_org'));
  const order = await createStripeOrder(request, student.token);
  await markPaid(request, order);
  const refund = await requestRefund(request, admin.token, order.id, 'failed');

  const failed = await ok(await request.post('/api/v1/payments/webhooks/stripe', {
    data: {
      id: `evt_refund_failed_${refund.id}`,
      type: 'refund.updated',
      data: { object: { id: `re_${refund.id}`, status: 'failed', metadata: { refund_id: refund.id, order_id: order.id } } }
    }
  }));
  expect(failed.status).toBe('failed');

  const organization = await ok(await request.post('/api/v1/organizations', {
    data: { token: admin.token, name: `支付扩席机构-${Date.now()}`, organization_type: 'school', seats: 3, owner_roles: ['orgAdmin'] }
  }));
  const organizationId = organization.organization_id || organization.scope_id || organization.id;
  const organizationOrder = await ok(await request.post('/api/v1/admin/payments/organization-orders', {
    data: {
      token: admin.token,
      organization_id: organizationId,
      plan: 'pro', days: 30, seats: 3, provider: 'stripe', currency: 'cny',
      confirmation: '确认创建扩席订单', reauth_password: ''
    }
  }));
  expect(organizationOrder.scope_type).toBe('organization');
  expect(organizationOrder.organization_id).toBe(organizationId);
  expect(organizationOrder.amount_cents).toBe(organizationOrder.unit_price_cents * 3);

  const organizationOrders = await ok(await request.get(`/api/v1/admin/payments/orders?token=${encodeURIComponent(admin.token)}&scope_type=organization&page_size=100`));
  expect(organizationOrders.items.some((item) => item.id === organizationOrder.id)).toBeTruthy();
});
