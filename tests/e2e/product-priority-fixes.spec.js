const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const fs = require('fs');
const path = require('path');
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
const root = path.resolve('tmp/role-fixes-20261020/data');
const headers = actor => ({ Authorization: 'Bearer ' + actor.token });
async function unwrap(response) { const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body.data; }
const post = (r, url, body, actor) => r.post(url, { headers: headers(actor), data: body }).then(unwrap);
let f;
test.beforeAll(async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).toBe('8083');
  expect(root.startsWith(path.resolve('tmp') + path.sep)).toBe(true);
  const admin = await loginApi(request, uniqueLoginId('superadmin_priority'));
  const users = {};
  for (const role of ['orgAdmin', 'teacher', 'student', 'student2', 'outsider']) users[role] = await loginApi(request, uniqueLoginId('student_priority_' + role));
  const org = await post(request, '/api/v1/organizations', { name: uniqueLoginId('课时更正验收'), plan: 'ultra', seats: 30, organization_type: 'school' }, admin);
  const oid = org.organization_id;
  for (const role of ['orgAdmin', 'teacher', 'student', 'student2']) await post(request, `/api/v1/organizations/${oid}/members`, { user_id: users[role].user_id, roles: [role === 'student2' ? 'student' : role], confirmation: '确认修改机构成员', reauth_password: '' }, admin);
  const group = await post(request, `/api/v1/organizations/${oid}/learning-groups`, { name: '原始结算班', type: 'class', subject: 'japanese' }, admin);
  const gid = group.learning_group_id;
  for (const role of ['teacher', 'student', 'student2']) await post(request, `/api/v1/organizations/${oid}/learning-groups/${gid}/enrollments`, { user_id: users[role].user_id, role: role === 'teacher' ? role : 'student' }, admin);
  const accounts = [];
  for (const [role,title] of [['student','原账户'],['student','新账户'],['student2','他人账户']]) accounts.push(await post(request, `/api/v1/organizations/${oid}/course-packages`, { title, record_type: 'assignment', student_id: users[role].user_id, total_lessons: 20, status: 'active', expires_at: '2099-12-31T00:00:00Z' }, admin));
  const lp = `/api/v1/institution/organizations/${oid}/learning-groups/${gid}/lessons`;
  const lesson = await post(request, lp, { title: '待更正的已结算课次', starts_at: '2026-10-21T10:00:00Z', ends_at: '2026-10-21T11:00:00Z' }, admin);
  const attendance = [{ student_id: users.student.user_id, status: 'present', charge: 2, course_package_id: accounts[0].course_package_id }, { student_id: users.student2.user_id, status: 'leave', charge: 0, course_package_id: '' }];
  await post(request, lp, { ...lesson, status: 'completed', attendance }, admin);
  const makeup = await post(request, lp, { title: '保留关联的补课', starts_at: '2036-10-21T10:00:00Z', ends_at: '2036-10-21T11:00:00Z', makeup_for: lesson.lesson_id, student_ids: [users.student2.user_id] }, admin);
  f = { admin, ...users, oid, gid, lp, lesson, attendance, accounts, makeup, cp: lp + '/' + lesson.lesson_id + '/corrections' };
  fs.writeFileSync('tmp/product-priority-fixes-20261028/fixture.json', JSON.stringify(f, null, 2));
});

for (const kind of ['progress', 'operations', 'platform-operations']) test(`${kind}：旧结果与旧错误不覆盖新查询，最新失败可重试`, async ({ page }) => {
  await page.route('**/__priority_probe__', route => route.fulfill({ contentType: 'text/html', body: '<main id="probe"></main>' }));
  await page.goto('/__priority_probe__');
  await page.evaluate(async kind => {
    const module = await import('/static/app/viewer/personalCenter/productImprovements.js');
    window.pending = [];
    window.result = marker => ({ target: 'JLPT-N3', targets: ['JLPT-N3'], from: '2026-10-20', to: '2026-10-21', midpoint: '2026-10-21', summary: {}, before: {}, after: {}, total: {}, items: [], note: marker });
    let initial = true;
    window.APIClient = { request: () => initial ? (initial = false, Promise.resolve(window.result('initial'))) : new Promise((resolve,reject) => window.pending.push({ resolve, reject })) };
    window.rebind = () => { const root = document.querySelector('main'); root.innerHTML = module.renderProductPanel(kind, 'org', 'owner'); module.bindProductPanels(root, { owner: 'owner', orgId: 'org', token: '', current: () => true, changed: () => {}, navigate: () => {}, password: async () => null, confirm: async () => false }); };
    window.rebind();
  }, kind);
  const form = page.locator('[data-product-form=filters]');
  await expect(form).toBeAttached();
  if (kind === 'platform-operations') { await page.locator('.pc-platform-reminder-settings > summary').click(); }
  const submit = () => form.evaluate(el => el.requestSubmit());
  await submit(); await submit();
  await page.evaluate(() => window.pending[1].resolve(window.result('latest-result')));
  await expect(page.locator('main')).toContainText('latest-result');
  await page.evaluate(() => window.pending[0].resolve(window.result('stale-result')));
  await expect(page.locator('main')).not.toContainText('stale-result');
  await submit(); await submit();
  await page.evaluate(() => window.pending[3].resolve(window.result('latest-again')));
  await expect(page.locator('main')).toContainText('latest-again');
  await page.evaluate(() => window.pending[2].reject(new Error('stale-error')));
  await expect(page.locator('main')).not.toContainText('stale-error');
  await submit();
  await page.evaluate(() => window.pending[4].reject(new Error('current-error')));
  await expect(page.getByRole('alert')).toHaveText('current-error');
  await page.getByRole('button', { name: '重试读取' }).click();
  await page.evaluate(() => window.pending[5].resolve(window.result('retried-empty-result')));
  await expect(page.locator('main')).toContainText('retried-empty-result');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-product-panel]')).toHaveAttribute('aria-busy', 'false');
  await submit();
  await page.evaluate(() => window.rebind());
  await page.evaluate(() => window.pending[7].resolve(window.result('rebound-result')));
  await expect(page.locator('main')).toContainText('rebound-result');
  await page.evaluate(() => window.pending[6].resolve(window.result('detached-result')));
  await expect(page.locator('main')).not.toContainText('detached-result');
});

test('导出含全部历史且去重，读取真实计时和连续学习路径，不泄漏他人或内部字段', async ({ request }) => {
  const uid = f.student.user_id;
  const write = (file, data) => { const target = path.join(root, 'user', file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(data)); };
  const snapshot = id => ({ user_id: uid, exam_id: 'N3_2010_07', saved_at: '2026-10-20T10:00:00Z', submission_id: id, attempt_id: id, answers: { '0:1': id } });
  write(`answers/${uid}/N3_2010_07.json`, snapshot('last'));
  for (let i = 0; i < 125; i++) write(`answers/${uid}/_history/N3_2010_07/${i}.json`, snapshot('try-' + i));
  write(`answers/${uid}/_attempts/N3_2010_07/duplicate.json`, snapshot('last'));
  write(`answers/${uid}/_history/N3_2010_07/foreign.json`, { ...snapshot('foreign'), user_id: f.student2.user_id });
  write(`timers/${uid}.json`, { user_id: uid, elapsed_seconds: 321 });
  write(`streaks/${uid}.json`, { current_streak: 8 });
  write(`profile/${uid}.json`, { display_name: '导出学员', teacher_notes: 'internal-secret' });
  write(`daily_practice/${uid}__JLPT_N3.json`, { own: true });
  write(`daily_practice/${uid}x__JLPT_N3.json`, { secret: 'foreign' });
  write(`feedback/priority_${uid}.json`, { items: [{ reporter_id: uid, feedback_id: 'own', description: '自己的反馈', internal_note: 'private', processing_history: [{ public_reply: '公开回复', changed_by: 'private-operator' }] }, { reporter_id: f.student2.user_id, description: '他人私密' }] });
  const exported = await unwrap(await request.get('/api/v1/data-export/' + uid, { headers: headers(f.admin) }));
  expect(exported.schema_version).toBe(2); expect(exported.modules.answer_history).toHaveLength(126);
  expect(exported.manifest.answer_duplicate_copies_removed).toBe(1);
  expect(exported.manifest.modules.answer_history.records).toBe(126);
  expect(exported.modules.attempt_timer.elapsed_seconds).toBe(321); expect(exported.modules.streak.current_streak).toBe(8);
  expect(exported.modules.daily_practice).toEqual({ JLPT_N3: { own: true } });
  expect(exported.modules.profile.teacher_notes).toBeUndefined();
  expect(exported.modules.feedback).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toMatch(/internal-secret|private-operator|internal_note|他人私密/);
  expect(exported.manifest.complete).toBe(false);
  expect(exported.manifest.warnings).toContainEqual(expect.objectContaining({ code: 'invalid_or_foreign_record' }));
  fs.unlinkSync(path.join(root, `user/answers/${uid}/_history/N3_2010_07/foreign.json`));
  const complete = await unwrap(await request.get('/api/v1/data-export/' + uid, { headers: headers(f.admin) }));
  expect(complete.manifest.complete).toBe(true);
  const corrupt = path.join(root, `user/answers/${uid}/_history/N3_2010_07/corrupt.json`); fs.writeFileSync(corrupt, '{broken');
  const partial = await unwrap(await request.get('/api/v1/data-export/' + uid, { headers: headers(f.admin) }));
  expect(partial.modules.answer_history).toHaveLength(126); expect(partial.manifest.complete).toBe(false);
  expect(partial.manifest.warnings).toContainEqual(expect.objectContaining({ code: 'unreadable_record' }));
  fs.unlinkSync(corrupt);
  expect((await request.get('/api/v1/data-export/' + f.student2.user_id, { headers: headers(f.student) })).status()).toBe(403);
});

const context = request => request.get(f.lp, { headers: headers(f.orgAdmin) }).then(unwrap);
const changeBody = (revision, attendance) => ({ request_id: uniqueLoginId('correction'), reason: '管理员核对后更正，内部原因不向其他学员展示', expected_revision: revision, attendance });
const commit = async (request, body) => { const preview = await post(request, f.cp + '/preview', body, f.orgAdmin); return post(request, f.cp, { ...body, expected_organization_revision: preview.organization_revision, confirmation: '确认更正课时', reauth_password: '' }, f.orgAdmin); };

test('旧作答编号相同但答案不同仍全部导出，计时损坏会明确提示', async ({ request }) => {
  const uid = f.student.user_id, directory = path.join(root, 'user/answers', uid, '_history/legacy');
  fs.mkdirSync(directory, { recursive: true });
  for (const answer of ['1','2']) fs.writeFileSync(path.join(directory, answer + '.json'), JSON.stringify({ user_id: uid, exam_id: 'legacy', attempt_id: 'reused', answers: { q: answer } }));
  const result = await unwrap(await request.get('/api/v1/data-export/' + uid, { headers: headers(f.admin) }));
  expect(result.manifest.scope).toBe('personal_learning_data');
  expect(result.modules.answer_history.filter(row => row.exam_id === 'legacy')).toHaveLength(2);
  const timer = path.join(root, 'user/timers', uid + '.json'), previous = fs.existsSync(timer) ? fs.readFileSync(timer) : Buffer.from('{}');
  try {
    fs.writeFileSync(timer, '{broken');
    const partial = await unwrap(await request.get('/api/v1/data-export/' + uid, { headers: headers(f.admin) }));
    expect(partial.manifest.complete).toBe(false);
    expect(partial.manifest.warnings).toContainEqual({ module: 'attempt_timer', code: 'unreadable_record' });
  } finally { fs.writeFileSync(timer, previous); }
});

test('更正预览不写账、原始记录保留、补课关联保留，重复请求不重复调整', async ({ request }) => {
  const before = await context(request), original = before.items.find(x => x.lesson_id === f.lesson.lesson_id);
  const body = changeBody(0, [{ ...f.attendance[0], charge: 1, course_package_id: f.accounts[1].course_package_id }, f.attendance[1]]);
  const preview = await post(request, f.cp + '/preview', body, f.orgAdmin);
  expect((await context(request)).items.find(x => x.lesson_id === f.lesson.lesson_id)).toEqual(original);
  expect(preview.balances.find(x => x.course_package_id === f.accounts[0].course_package_id).remaining_lessons).toBe(20);
  const payload = { ...body, expected_organization_revision: preview.organization_revision, confirmation: '确认更正课时', reauth_password: '' };
  const saved = await post(request, f.cp, payload, f.orgAdmin), replay = await post(request, f.cp, payload, f.orgAdmin);
  expect(saved.replayed).toBe(false); expect(replay.replayed).toBe(true);
  expect(replay.correction.correction_id).toBe(saved.correction.correction_id);
  const after = await context(request), lesson = after.items.find(x => x.lesson_id === f.lesson.lesson_id);
  expect(lesson.attendance).toEqual(original.attendance); expect(lesson.corrected_attendance).toEqual(body.attendance);
  expect(lesson.attendance_corrections).toHaveLength(1);
  expect(after.items.find(x => x.lesson_id === f.makeup.lesson_id).makeup_for).toBe(f.lesson.lesson_id);
  const mine = await unwrap(await request.get('/api/v1/me/courses', { headers: headers(f.student) }));
  const row = mine.lessons.find(x => x.lesson_id === f.lesson.lesson_id);
  expect(row.own_attendance.charge).toBe(1); expect(row.own_attendance_corrections).toHaveLength(1);
  expect(row.attendance).toBeUndefined(); expect(row.corrected_attendance).toBeUndefined(); expect(row.attendance_corrections).toBeUndefined();
  expect(JSON.stringify(mine)).not.toContain(body.reason);
  const ledger = mine.ledger.filter(x => x.lesson_id === f.lesson.lesson_id);
  expect(ledger.map(x => x.change)).toEqual([-2, 2, -1]); expect(ledger[1].reverses_ledger_id).toBe(ledger[0].ledger_id);
  expect((await request.post(f.cp, { headers: headers(f.orgAdmin), data: { ...payload, reason: 'different' } })).status()).toBe(409);
});

test('更正拒绝越权、旧版本、错误账户与余额不足，全部回滚', async ({ request }) => {
  const before = await context(request), current = before.items.find(x => x.lesson_id === f.lesson.lesson_id);
  const body = changeBody(1, [{ ...current.corrected_attendance[0], charge: 3 }, current.corrected_attendance[1]]);
  for (const actor of [f.teacher, f.student, f.outsider]) expect((await request.post(f.cp + '/preview', { headers: headers(actor), data: body })).status()).toBe(403);
  for (const attendance of [[{ ...body.attendance[0], course_package_id: f.accounts[2].course_package_id }, body.attendance[1]], [{ ...body.attendance[0], charge: 21 }, body.attendance[1]], [body.attendance[0]]]) expect((await request.post(f.cp + '/preview', { headers: headers(f.orgAdmin), data: { ...body, attendance } })).status()).toBe(422);
  expect((await request.post(f.cp + '/preview', { headers: headers(f.orgAdmin), data: { ...body, expected_revision: 0 } })).status()).toBe(409);
  const preview = await post(request, f.cp + '/preview', body, f.orgAdmin);
  expect((await request.post(f.cp, { headers: headers(f.orgAdmin), data: { ...body, expected_organization_revision: preview.organization_revision - 1, confirmation: '确认更正课时', reauth_password: '' } })).status()).toBe(409);
  expect((await context(request)).items).toEqual(before.items);
  // Exhaust the target account through its normal account-management route, then verify atomic failure.
  await post(request, `/api/v1/organizations/${f.oid}/course-packages`, { ...f.accounts[1], used_lessons: 19, remaining_lessons: 1 }, f.admin);
  expect((await request.post(f.cp + '/preview', { headers: headers(f.orgAdmin), data: { ...body, attendance: [{ ...body.attendance[0], charge: 4 }, body.attendance[1]] } })).status()).toBe(422);
  const after = await context(request); expect(after.items).toEqual(before.items);
});

test('并发重复更正只追加一组流水；连续更正可退款并保留链路', async ({ request }) => {
  const current = (await context(request)).items.find(x => x.lesson_id === f.lesson.lesson_id);
  const body = changeBody(1, [{ ...current.corrected_attendance[0], status: 'leave', charge: 0, course_package_id: '' }, current.corrected_attendance[1]]);
  const preview = await post(request, f.cp + '/preview', body, f.orgAdmin);
  const payload = { ...body, expected_organization_revision: preview.organization_revision, confirmation: '确认更正课时', reauth_password: '' };
  const results = await Promise.all([post(request, f.cp, payload, f.orgAdmin), post(request, f.cp, payload, f.orgAdmin)]);
  expect(results[0].correction.correction_id).toBe(results[1].correction.correction_id);
  const after = (await context(request)).items.find(x => x.lesson_id === f.lesson.lesson_id);
  expect(after.attendance_corrections).toHaveLength(2); expect(after.attendance_revision).toBe(2);
  const mine = await unwrap(await request.get('/api/v1/me/courses', { headers: headers(f.student) }));
  expect(mine.ledger.filter(x => x.lesson_id === f.lesson.lesson_id).map(x => x.change)).toEqual([-2,2,-1,1]);
});

test('更正表单失败保留输入、可重试，窄屏和深色布局无横向溢出', async ({ page }) => {
  await page.route('**/__correction_ui__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><link rel="stylesheet" href="/static/styles/institution-workflow.css"><style>body{margin:0;padding:12px;font-family:Arial}main{max-width:1100px;margin:auto}*{box-sizing:border-box}</style><div id="platform-admin-shell" data-learning-role="orgAdmin"><main></main></div>' }));
  await page.goto('/__correction_ui__');
  await page.evaluate(async f => {
    window.APIClient = { request: async (url, options = {}) => { const response = await fetch('/api/v1' + url, { ...options, headers: { Authorization: 'Bearer ' + f.orgAdmin.token, 'Content-Type': 'application/json' } }); const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error?.message || '请求失败'); return body.data; } };
    const module = await import('/static/app/viewer/personalCenter/institutionWorkflow.js');
    const root = document.querySelector('main'); root.innerHTML = module.renderInstitutionFlow('lessons', f.oid, f.gid);
    module.bindInstitutionFlows(root, { owner: f.orgAdmin.user_id, orgId: f.oid, token: f.orgAdmin.token, current: () => true, changed: () => {}, confirm: async message => { window.lastPreview = message; return true; }, password: async () => '' });
  }, f);
  await page.getByRole('button', { name: '更正出勤 / 扣课' }).click();
  const form = page.locator('[data-flow-form=correction]');
  await form.locator('[data-attendance-status]').first().selectOption('absent');
  await form.locator('[data-attendance-charge]').first().fill('0');
  await form.locator('[name=reason]').fill('网络失败后仍保留的更正原因');
  let fail = true;
  await page.route('**/lessons/*/corrections', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟暂时不可用，请重试' }) }); }
    else await route.continue();
  });
  await form.getByRole('button', { name: '预览并确认更正' }).click();
  await expect(form.getByRole('alert')).toContainText('模拟暂时不可用');
  await expect(form.locator('[name=reason]')).toHaveValue('网络失败后仍保留的更正原因');
  await expect(form.getByRole('button', { name: '预览并确认更正' })).toBeEnabled();
  for (const [width, theme] of [[1440, 'light'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(theme => { document.body.classList.toggle('light-theme', theme === 'light'); document.body.style.background = theme === 'light' ? '#fff' : '#202123'; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `tmp/product-priority-fixes-20261028/correction-${width}-${theme}.png`, fullPage: true });
  }
  await form.getByRole('button', { name: '预览并确认更正' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更正出勤 / 扣课' })).toBeEnabled();
});
