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

async function savePricing(request, token, pricing) {
  return ok(await request.put('/api/v1/admin/payments/pricing', {
    data: {
      ...pricing,
      token,
      confirmation: '确认修改套餐价格',
      reauth_password: ''
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
    data: { token: admin.token, name: `支付扩席机构-${Date.now()}`, organization_type: 'school', seats: 20, owner_roles: ['orgAdmin'] }
  }));
  const organizationId = organization.organization_id || organization.scope_id || organization.id;
  const belowMinimum = await request.post('/api/v1/admin/payments/organization-orders', {
    data: {
      token: admin.token,
      organization_id: organizationId,
      plan: 'pro', days: 30, seats: 19, provider: 'stripe', currency: 'cny',
      confirmation: '确认创建扩席订单', reauth_password: ''
    }
  });
  expect(belowMinimum.status()).toBe(422);
  expect((await belowMinimum.json()).code).toBe('PAYMENT_MINIMUM_SEATS');

  const organizationOrder = await ok(await request.post('/api/v1/admin/payments/organization-orders', {
    data: {
      token: admin.token,
      organization_id: organizationId,
      plan: 'pro', days: 30, seats: 20, provider: 'stripe', currency: 'cny',
      confirmation: '确认创建扩席订单', reauth_password: ''
    }
  }));
  expect(organizationOrder.scope_type).toBe('organization');
  expect(organizationOrder.organization_id).toBe(organizationId);
  expect(organizationOrder.unit_price_cents).toBe(1500);
  expect(organizationOrder.minimum_seats).toBe(20);
  expect(organizationOrder.amount_cents).toBe(organizationOrder.unit_price_cents * 20);
  await markPaid(request, organizationOrder);

  const organizationRenewal = await ok(await request.put('/api/v1/payments/auto-renewal', {
    data: {
      token: admin.token,
      scope_type: 'organization',
      organization_id: organizationId,
      enabled: true,
      consent: true,
      confirmation: '确认开启自动续费',
      days: 365,
      provider: 'stripe',
      currency: 'cny',
      reauth_password: ''
    }
  }));
  expect(organizationRenewal.enabled).toBe(true);
  expect(organizationRenewal.plan).toBe('pro');
  expect(organizationRenewal.seats).toBe(20);
  expect(organizationRenewal.price_snapshot_cents).toBe(11900 * 20);
  expect(organizationRenewal.charge_ready).toBe(false);
  await ok(await request.put('/api/v1/payments/auto-renewal', {
    data: {
      token: admin.token,
      scope_type: 'organization',
      organization_id: organizationId,
      enabled: false,
      confirmation: '确认关闭自动续费'
    }
  }));

  const annualTierOrder = await ok(await request.post('/api/v1/admin/payments/organization-orders', {
    data: {
      token: admin.token,
      organization_id: organizationId,
      plan: 'pro', days: 365, seats: 50, provider: 'stripe', currency: 'cny',
      confirmation: '确认创建扩席订单', reauth_password: ''
    }
  }));
  expect(annualTierOrder.unit_price_cents).toBe(10900);
  expect(annualTierOrder.amount_cents).toBe(10900 * 50);

  const customQuote = await request.post('/api/v1/admin/payments/organization-orders', {
    data: {
      token: admin.token,
      organization_id: organizationId,
      plan: 'ultra', days: 365, seats: 200, provider: 'stripe', currency: 'cny',
      confirmation: '确认创建扩席订单', reauth_password: ''
    }
  });
  expect(customQuote.status()).toBe(422);
  expect((await customQuote.json()).code).toBe('PAYMENT_CUSTOM_QUOTE_REQUIRED');

  const organizationOrders = await ok(await request.get(`/api/v1/admin/payments/orders?token=${encodeURIComponent(admin.token)}&scope_type=organization&page_size=100`));
  expect(organizationOrders.items.some((item) => item.id === organizationOrder.id)).toBeTruthy();
  expect(organizationOrders.items.some((item) => item.id === annualTierOrder.id)).toBeTruthy();
});

test('报价自动选择首购、续费和活动中的最优优惠并固化到订单', async ({ request }) => {
  const admin = await loginApi(request, uniqueLoginId('superadmin_payment_offer'));
  const student = await loginApi(request, uniqueLoginId('student_payment_offer'));
  const original = await ok(await request.get('/api/v1/payments/pricing'));
  const pricing = JSON.parse(JSON.stringify(original));
  const offers = pricing.catalogs.personal.offers;
  for (const offer of offers) {
    offer.enabled = offer.id === 'first_purchase' || offer.id === 'renewal';
    offer.starts_at = '';
    offer.ends_at = '';
    if (offer.id === 'first_purchase') offer.discount_percent = 20;
    if (offer.id === 'renewal') offer.discount_percent = 10;
    if (offer.id === 'campaign') offer.discount_percent = 25;
  }

  try {
    await savePricing(request, admin.token, pricing);
    const firstQuote = await ok(await request.post('/api/v1/payments/quote', {
      data: { token: student.token, scope_type: 'personal', plan: 'pro', days: 30, currency: 'cny' }
    }));
    expect(firstQuote.base_amount_cents).toBe(1900);
    expect(firstQuote.amount_cents).toBe(1520);
    expect(firstQuote.offer.id).toBe('first_purchase');

    const firstOrder = await createStripeOrder(request, student.token);
    expect(firstOrder.base_amount_cents).toBe(1900);
    expect(firstOrder.amount_cents).toBe(1520);
    expect(firstOrder.discount_cents).toBe(380);
    expect(firstOrder.offer.id).toBe('first_purchase');
    expect(firstOrder.pricing_quoted_at).toBeTruthy();
    await markPaid(request, firstOrder);

    const renewalQuote = await ok(await request.post('/api/v1/payments/quote', {
      data: { token: student.token, scope_type: 'personal', plan: 'pro', days: 30, currency: 'cny' }
    }));
    expect(renewalQuote.first_purchase_eligible).toBe(false);
    expect(renewalQuote.renewal_eligible).toBe(true);
    expect(renewalQuote.amount_cents).toBe(1710);
    expect(renewalQuote.offer.id).toBe('renewal');

    const campaign = offers.find((offer) => offer.id === 'campaign');
    campaign.enabled = true;
    await savePricing(request, admin.token, pricing);
    const campaignQuote = await ok(await request.post('/api/v1/payments/quote', {
      data: { token: student.token, scope_type: 'personal', plan: 'pro', days: 30, currency: 'cny' }
    }));
    expect(campaignQuote.amount_cents).toBe(1425);
    expect(campaignQuote.offer.id).toBe('campaign');
  } finally {
    await savePricing(request, admin.token, original);
  }
});

test('自动续费默认关闭、要求独立授权并提示下期价格变化', async ({ request }) => {
  const admin = await loginApi(request, uniqueLoginId('superadmin_auto_renewal'));
  const student = await loginApi(request, uniqueLoginId('student_auto_renewal'));
  const originalPricing = await ok(await request.get('/api/v1/payments/pricing'));

  const initial = await ok(await request.get(
    `/api/v1/payments/auto-renewal?token=${encodeURIComponent(student.token)}&scope_type=personal`
  ));
  expect(initial.enabled).toBe(false);
  expect(initial.status).toBe('disabled');
  expect(initial.charge_ready).toBe(false);

  const order = await createStripeOrder(request, student.token);
  await markPaid(request, order);

  const missingConsent = await request.put('/api/v1/payments/auto-renewal', {
    data: {
      token: student.token,
      scope_type: 'personal',
      enabled: true,
      consent: false,
      confirmation: '确认开启自动续费',
      days: 365,
      provider: 'stripe',
      currency: 'cny',
      reauth_password: ''
    }
  });
  expect(missingConsent.status()).toBe(422);
  expect((await missingConsent.json()).code).toBe('AUTO_RENEWAL_CONSENT_REQUIRED');

  let enabled = false;
  try {
    const authorization = await ok(await request.put('/api/v1/payments/auto-renewal', {
      data: {
        token: student.token,
        scope_type: 'personal',
        enabled: true,
        consent: true,
        confirmation: '确认开启自动续费',
        days: 365,
        provider: 'stripe',
        currency: 'cny',
        notify_email: true,
        reauth_password: ''
      }
    }));
    enabled = true;
    expect(authorization.enabled).toBe(true);
    expect(authorization.status).toBe('pending_provider_authorization');
    expect(authorization.charge_ready).toBe(false);
    expect(authorization.plan).toBe('pro');
    expect(authorization.days).toBe(365);
    expect(authorization.price_snapshot_cents).toBe(
      originalPricing.catalogs.personal.prices_cents.cny.pro['365']
    );
    expect(authorization.consent_at).toBeTruthy();
    expect(authorization.reminder_schedule.map((item) => item.days_before)).toEqual([7, 3, 1]);

    const authorized = await ok(await request.post('/api/v1/payments/auto-renewal/webhooks/stripe', {
      data: {
        id: `evt_renewal_authorized_${order.id}`,
        type: 'setup_intent.succeeded',
        data: {
          object: {
            id: `seti_${order.id}`,
            metadata: { scope_type: 'personal', scope_id: student.user_id }
          }
        }
      }
    }));
    expect(authorized.outcome).toBe('authorized');
    expect(authorized.renewal.charge_ready).toBe(true);
    expect(authorized.renewal.status).toBe('active');

    const jobRun = await ok(await request.post('/api/v1/admin/payments/renewal-jobs/run', {
      data: {
        token: admin.token,
        as_of_date: authorization.next_charge_at.slice(0, 10),
        confirmation: '确认执行续费任务',
        reauth_password: ''
      }
    }));
	    expect(jobRun.scanned).toBeGreaterThanOrEqual(1);
	    expect(jobRun.charge_requests_created).toBeGreaterThanOrEqual(1);
	    expect(jobRun.notification_delivery).toEqual(expect.objectContaining({
	      scanned: expect.any(Number),
	      attempted: expect.any(Number),
	      delivered: expect.any(Number),
	      retry_scheduled: expect.any(Number),
	      dead_letter: expect.any(Number)
	    }));

    const failedRenewal = await ok(await request.post('/api/v1/payments/auto-renewal/webhooks/stripe', {
      data: {
        id: `evt_renewal_failed_${order.id}`,
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: `in_failed_${order.id}`,
            metadata: { scope_type: 'personal', scope_id: student.user_id },
            last_payment_error: { message: '测试卡余额不足' }
          }
        }
      }
    }));
    expect(failedRenewal.outcome).toBe('failed');
    expect(failedRenewal.renewal.status).toBe('payment_failed_grace');
    expect(failedRenewal.renewal.failure_count).toBe(1);
    expect(failedRenewal.renewal.grace_expires_at).toBeTruthy();
    expect(failedRenewal.renewal.next_retry_at).toBeTruthy();

    const notifications = await ok(await request.get(
      `/api/v1/payments/notifications?token=${encodeURIComponent(student.token)}&page_size=20`
    ));
	    expect(notifications.unread_count).toBeGreaterThanOrEqual(2);
	    expect(notifications.items.some((item) => item.type === 'renewal_payment_failed')).toBeTruthy();
	    expect(notifications.items.every((item) =>
	      typeof item.delivery?.email?.status === 'string' &&
	      Number.isInteger(item.delivery?.email?.attempts)
	    )).toBeTruthy();
    const firstUnread = notifications.items.find((item) => !item.read_at);
    await ok(await request.patch(`/api/v1/payments/notifications/${encodeURIComponent(firstUnread.id)}/read`, {
      data: { token: student.token }
    }));
    const readAll = await ok(await request.post('/api/v1/payments/notifications/read-all', {
      data: { token: student.token }
    }));
    expect(readAll.unread_count).toBe(0);

    const successfulRenewal = await ok(await request.post('/api/v1/payments/auto-renewal/webhooks/stripe', {
      data: {
        id: `evt_renewal_paid_${order.id}`,
        type: 'invoice.paid',
        data: {
          object: {
            id: `in_paid_${order.id}`,
            payment_intent: `pi_renewal_${order.id}`,
            metadata: { scope_type: 'personal', scope_id: student.user_id }
          }
        }
      }
    }));
    expect(successfulRenewal.outcome).toBe('succeeded');
    expect(successfulRenewal.order.status).toBe('paid');
    expect(successfulRenewal.order.metadata.auto_renewal).toBe(true);
    expect(successfulRenewal.renewal.status).toBe('active');
    expect(successfulRenewal.renewal.failure_count).toBe(0);

    const operations = await ok(await request.get(
      `/api/v1/admin/payments/renewal-operations?token=${encodeURIComponent(admin.token)}`
    ));
    expect(operations.agreements_total).toBeGreaterThanOrEqual(1);
    expect(operations.attempts_total).toBeGreaterThanOrEqual(1);
	    expect(operations.notifications_total).toBeGreaterThanOrEqual(2);
	    expect(Object.values(operations.email_delivery_counts || {})
	      .reduce((total, count) => total + Number(count || 0), 0)).toBe(operations.notifications_total);
	    expect(operations.last_run.as_of_date).toBe(authorization.next_charge_at.slice(0, 10));

    const changedPricing = JSON.parse(JSON.stringify(originalPricing));
    changedPricing.catalogs.personal.prices_cents.cny.pro['365'] += 1000;
    await savePricing(request, admin.token, changedPricing);

    const changed = await ok(await request.get(
      `/api/v1/payments/auto-renewal?token=${encodeURIComponent(student.token)}&scope_type=personal`
    ));
    expect(changed.price_change_notice.type).toBe('renewal_price_changed');
    expect(changed.price_change_notice.previous_amount_cents).toBe(
      originalPricing.catalogs.personal.prices_cents.cny.pro['365']
    );
    expect(changed.price_change_notice.current_amount_cents).toBe(
      originalPricing.catalogs.personal.prices_cents.cny.pro['365'] + 1000
    );
    expect(changed.price_change_notice.message).toContain('不影响当前已支付周期');
  } finally {
    await savePricing(request, admin.token, originalPricing);
    if (enabled) {
      const disabled = await ok(await request.put('/api/v1/payments/auto-renewal', {
        data: {
          token: student.token,
          scope_type: 'personal',
          enabled: false,
          confirmation: '确认关闭自动续费'
        }
      }));
      expect(disabled.enabled).toBe(false);
      expect(disabled.status).toBe('disabled');
    }
  }
});
