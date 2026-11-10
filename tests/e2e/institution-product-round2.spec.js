const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
let f;
const root = path.resolve(__dirname, '../../tmp/role-fixes-20261020/data');
const auth = token => ({ Authorization: 'Bearer ' + token });
const iso = (offset, hour = 10) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const day = offset => iso(offset).slice(0, 10);
async function data(response) { const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body.data; }
const post = (request, url, value, token) => request.post(url, { headers: auth(token), data: value }).then(data);
const lessonPath = (org, group) => '/api/v1/institution/organizations/' + org + '/learning-groups/' + group + '/lessons';

test.beforeAll(async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).toBe('8083');
  expect(root.startsWith(path.resolve(__dirname, '../../tmp') + path.sep)).toBe(true);
  const adminName = uniqueLoginId('superadmin_round2'), admin = await loginApi(request, adminName);
  const contentName = uniqueLoginId('contentadmin_round2'), content = await loginApi(request, contentName);
  const users = {}, names = {};
  for (const role of ['teacher', 'assistant', 'orgAdmin', 'student', 'student2', 'observer', 'future', 'otherTeacher']) { names[role] = uniqueLoginId('student_round2_' + role); users[role] = await loginApi(request, names[role]); }
  const org = await post(request, '/api/v1/organizations', { name: uniqueLoginId('连续教学验收'), organization_type: 'school', plan: 'ultra', seats: 80 }, admin.token);
  const other = await post(request, '/api/v1/organizations', { name: uniqueLoginId('隔离机构'), organization_type: 'school', plan: 'ultra', seats: 20 }, admin.token);
  const oid = org.organization_id, bid = other.organization_id;
  for (const role of ['teacher', 'assistant', 'orgAdmin', 'student', 'student2', 'observer', 'future']) await post(request, '/api/v1/organizations/' + oid + '/members', { user_id: users[role].user_id, roles: [['student2', 'observer', 'future'].includes(role) ? 'student' : role], confirmation: '确认修改机构成员', reauth_password: '' }, admin.token);
  for (const role of ['otherTeacher', 'student']) await post(request, '/api/v1/organizations/' + bid + '/members', { user_id: users[role].user_id, roles: [role === 'otherTeacher' ? 'teacher' : 'student'], confirmation: '确认修改机构成员', reauth_password: '' }, admin.token);
  const groups = {};
  for (const [name, orgId, actors] of [['main', oid, ['teacher', 'assistant', 'student', 'student2']], ['dormant', oid, ['teacher', 'observer']], ['future', oid, ['teacher', 'future']], ['other', bid, ['otherTeacher', 'student']]]) {
    groups[name] = await post(request, '/api/v1/organizations/' + orgId + '/learning-groups', { name: '验收班级 ' + name, type: 'class', subject: 'japanese' }, admin.token);
    for (const role of actors) await post(request, '/api/v1/organizations/' + orgId + '/learning-groups/' + groups[name].learning_group_id + '/enrollments', { user_id: users[role].user_id, role: role === 'otherTeacher' ? 'teacher' : ['student', 'student2', 'observer', 'future'].includes(role) ? 'student' : role }, admin.token);
  }
  const gid = groups.main.learning_group_id;
  const template = await post(request, '/api/v1/organizations/' + oid + '/course-packages', { title: '连续教学20课时', record_type: 'template', subject: 'japanese', total_lessons: 20, status: 'active' }, admin.token);
  const accounts = {};
  for (const role of ['student', 'student2']) accounts[role] = await post(request, '/api/v1/organizations/' + oid + '/course-packages', { title: '个人课时 ' + role, record_type: 'assignment', student_id: users[role].user_id, total_lessons: 20, status: 'active', expires_at: '2099-12-31T00:00:00Z' }, admin.token);
  for (const role of Object.keys(users)) users[role] = await loginApi(request, names[role]);
  const assignment = await post(request, '/api/v1/organizations/' + oid + '/learning-groups/' + gid + '/assignments', { title: '批改快捷验收', exam_id: 'N3_2010_07', question_start: 1, question_end: 3 }, users.teacher.token);
  for (const role of ['student', 'student2']) await post(request, '/api/v1/assignments/' + assignment.assignment_id + '/submit', { answers: { '0:1': '1', '0:2': '1', '0:3': '1' }, submission_id: uniqueLoginId('round2_submission') }, users[role].token);
  const completed = await post(request, lessonPath(oid, gid), { title: '已完成考勤验收', starts_at: iso(-2, 9), ends_at: iso(-2, 10) }, users.teacher.token);
  await post(request, lessonPath(oid, gid), { ...completed, status: 'completed', attendance: [{ student_id: users.student.user_id, status: 'present', charge: 1, course_package_id: accounts.student.course_package_id }, { student_id: users.student2.user_id, status: 'leave', charge: 0, course_package_id: '' }] }, users.teacher.token);
  const overdue = await post(request, lessonPath(oid, gid), { title: '待结算考勤验收', starts_at: iso(-1, 11), ends_at: iso(-1, 12) }, users.teacher.token);
  const next = await post(request, lessonPath(oid, gid), { title: '待确认请假验收', starts_at: iso(1, 13), ends_at: iso(1, 14) }, users.teacher.token);
  await post(request, '/api/v1/me/lessons/' + next.lesson_id + '/leave', { org_id: oid, reason: '站内请假验收' }, users.student2.token);
  await post(request, lessonPath(oid, groups.future.learning_group_id), { title: '尚未开课验收', starts_at: '2035-01-01T10:00:00Z', ends_at: '2035-01-01T11:00:00Z' }, users.teacher.token);
  await post(request, '/api/v1/institution/organizations/' + oid + '/followups', { student_id: users.student.user_id, owner_id: users.assistant.user_id, text: '教学看板跟进验收', next_at: iso(-1, 9) }, users.teacher.token);
  // Answer history files are read on demand. Seed only this run's isolated user's records.
  const dir = path.join(root, 'user/answers', users.student.user_id), history = path.join(dir, '_history/N3_2010_07'), attempts = path.join(dir, '_attempts/N3_2010_07');
  fs.mkdirSync(history, { recursive: true }); fs.mkdirSync(attempts, { recursive: true });
  const snapshot = (exam, offset, correct, id) => ({ user_id: users.student.user_id, exam_id: exam, saved_at: iso(offset), submission_id: id, attempt_id: id, statistics: { score: correct / 3 * 100, results: Object.fromEntries([1, 2, 3].map((n, i) => ['0:' + n, { status: i < correct ? 'correct' : 'wrong', question_id: String(n), section_index: 0 }])) } });
  const early = snapshot('N3_2010_07', -25, 0, 'early'), late = snapshot('N3_2010_07', -5, 2, 'late');
  fs.writeFileSync(path.join(history, 'early.json'), JSON.stringify(early)); fs.writeFileSync(path.join(history, 'late.json'), JSON.stringify(late));
  fs.writeFileSync(path.join(attempts, 'duplicate.json'), JSON.stringify(late)); fs.writeFileSync(path.join(dir, 'N3_2010_07.json'), JSON.stringify(late));
  fs.writeFileSync(path.join(dir, 'N2_2025_07.json'), JSON.stringify(snapshot('N2_2025_07', -5, 3, 'different-target')));
  for (const role of ['observer', 'future']) {
    const personal = path.join(root, 'user/answers', users[role].user_id); fs.mkdirSync(personal, { recursive: true });
    fs.writeFileSync(path.join(personal, 'N3_2010_07.json'), JSON.stringify({ ...snapshot('N3_2010_07', -40, 1, 'before-institution'), user_id: users[role].user_id }));
  }
  const synthetic = { id: uniqueLoginId('round2_order'), user_id: users.student.user_id, scope_type: 'user', scope_id: users.student.user_id, status: 'failed', provider: 'test', created_at: iso(-365), updated_at: iso(0), amount_cents: 100, currency: 'CNY' };
  const syntheticRefund = { ...synthetic, id: uniqueLoginId('round2_refund'), order_id: synthetic.id, status: 'processing', created_at: iso(-366), updated_at: iso(-2) };
  const seed = path.resolve('tmp/institution-review-round2-20261026/payment-seed.json'); fs.writeFileSync(seed, JSON.stringify({ dataRoot: root, item: synthetic, refund: syntheticRefund }));
  execFileSync('python', ['-X', 'utf8', '-c', "import json,pathlib,sqlite3,sys; f=json.loads(pathlib.Path(sys.argv[1]).read_text()); r=pathlib.Path(f['dataRoot']).resolve(); assert 'tmp' in r.parts; db=sqlite3.connect(r/'user/payments/payments.sqlite3'); x=f['item']; db.execute('INSERT OR REPLACE INTO json_entities(namespace,entity_key,payload) VALUES(?,?,?)',('payment_orders',x['id'],json.dumps(x))); y=f['refund']; db.execute('INSERT OR REPLACE INTO json_entities(namespace,entity_key,payload) VALUES(?,?,?)',('payment_refunds',y['id'],json.dumps(y))); db.commit()", seed]);
  f = { admin, adminName, content, contentName, users, names, oid, bid, gid, groups, template, accounts, assignment, completed, overdue, next, synthetic, syntheticRefund };
});

async function enter(page, role) {
  await loginApi(page.request, role === 'superAdmin' ? f.adminName : role === 'contentAdmin' ? f.contentName : f.names[role]);
  const ctx = await data(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(ctx => localStorage.setItem('exam_v2_user', JSON.stringify({ ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, memberships: ctx.memberships, organizations: ctx.organizations, permissions: ctx.permissions, subscription: ctx.subscription })), ctx);
  await page.goto('/', { waitUntil: 'networkidle' }); await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) { await shell.locator('[data-platform-admin-account-menu]').click(); await shell.locator('[data-role-workbench="' + role + '"]').click(); }
  await expect(shell).toHaveAttribute('data-learning-role', role); await page.waitForLoadState('networkidle'); return shell;
}

test('首课未安排或尚未开始时保持观察，并说明原因', async ({ request }) => {
  const rows = await data(await request.get('/api/v1/institution/organizations/' + f.oid + '/followups', { headers: auth(f.users.orgAdmin.token) }));
  expect(rows.students.find(row => row.id === f.users.observer.user_id).activity_risk.observation_stage).toBe('awaiting_schedule');
  const future = rows.students.find(row => row.id === f.users.future.user_id).activity_risk;
  expect(future.observation_stage).toBe('awaiting_course'); expect(future.level).toBe('low'); expect(future.reason).toContain('尚未开始');
});

test('同目标进步使用真实历史且去重，分时段和题型并显示样本量，跨机构拒绝', async ({ request }) => {
  const url = '/api/v1/institution/students/' + f.users.student.user_id + '/progress?org_id=' + f.oid + '&target=JLPT-N3&from=' + day(-30) + '&to=' + day(-1);
  const result = await data(await request.get(url, { headers: auth(f.users.teacher.token) }));
  expect(result.total.questions).toBe(6); expect(result.total.attempts).toBe(2); expect(result.before.accuracy).toBe(0); expect(result.after.accuracy).toBeCloseTo(200 / 3);
  expect(result.sufficient).toBe(false); expect(result.targets).toContain('JLPT-N2');
  expect((await request.get(url, { headers: auth(f.users.otherTeacher.token) })).status()).toBe(403);
  expect((await request.get(url.replace('from=' + day(-30), 'from=2026-02-30'), { headers: auth(f.users.teacher.token) })).status()).toBe(422);
});

test('启用向导一次关联班级、老师和课时，重复提交不重复建班，越权和错误不部分保存', async ({ request }) => {
  const url = '/api/v1/institution/organizations/' + f.oid + '/setup';
  const input = { name: '向导 API 验收班', subject: 'japanese', student_ids: [f.users.observer.user_id], teacher_ids: [f.users.teacher.user_id], template_id: f.template.course_package_id, request_id: uniqueLoginId('setup') };
  const created = await post(request, url, input, f.users.orgAdmin.token), again = await post(request, url, input, f.users.orgAdmin.token);
  expect(created.learning_group_id).toBe(again.learning_group_id); expect(created.enrollments).toHaveLength(2);
  const context = await data(await request.get(url, { headers: auth(f.users.orgAdmin.token) }));
  expect(context.groups.filter(row => row.name === input.name)).toHaveLength(1);
  const packages = await data(await request.get('/api/v1/organizations/' + f.oid + '/course-packages', { headers: auth(f.users.orgAdmin.token) }));
  expect(packages.filter(row => row.student_id === f.users.observer.user_id && row.template_id === f.template.course_package_id)).toHaveLength(1);
  const account = packages.find(row => row.student_id === f.users.observer.user_id && row.template_id === f.template.course_package_id);
  await post(request, '/api/v1/organizations/' + f.oid + '/course-packages', { ...account, used_lessons: 20, remaining_lessons: 0, status: 'depleted' }, f.users.orgAdmin.token);
  await post(request, url, { ...input, name: '账户耗尽后重新启用班级', request_id: uniqueLoginId('setup-new-account') }, f.users.orgAdmin.token);
  const renewed = await data(await request.get('/api/v1/organizations/' + f.oid + '/course-packages', { headers: auth(f.users.orgAdmin.token) }));
  expect(renewed.filter(row => row.student_id === f.users.observer.user_id && row.template_id === f.template.course_package_id && row.remaining_lessons === 20)).toHaveLength(1);
  expect((await request.post(url, { headers: auth(f.users.teacher.token), data: input })).status()).toBe(403);
  expect((await request.post(url, { headers: auth(f.users.orgAdmin.token), data: { ...input, request_id: uniqueLoginId('invalid'), student_ids: [f.users.otherTeacher.user_id] } })).status()).toBe(422);
});

test('教学看板按所选日期统计履约、考勤、未结算和跟进，普通学员不能读取', async ({ request }) => {
  const url = '/api/v1/institution/organizations/' + f.oid + '/operations?from=' + day(-3) + '&to=' + day(2);
  const result = await data(await request.get(url, { headers: auth(f.users.orgAdmin.token) }));
  expect(result.summary.completed).toBe(1); expect(result.summary.overdue).toBe(1); expect(result.summary.attendance_rate).toBe(50); expect(result.summary.pending_leave).toBe(1);
  expect(result.followups.some(row => row.student.id === f.users.student.user_id)).toBe(true);
  expect((await request.get(url, { headers: auth(f.users.student.token) })).status()).toBe(403);
});

test('常用评语按机构和创建人隔离，修改删除受到保护', async ({ request }) => {
  const url = '/api/v1/institution/organizations/' + f.oid + '/review-comments';
  const comment = await post(request, url, { text: '个人评语验收，请复习错题' }, f.users.teacher.token);
  const own = await data(await request.get(url, { headers: auth(f.users.teacher.token) })); expect(own.items.some(row => row.comment_id === comment.comment_id)).toBe(true);
  const other = await data(await request.get(url, { headers: auth(f.users.assistant.token) })); expect(other.items.some(row => row.comment_id === comment.comment_id)).toBe(false);
  expect((await request.post(url, { headers: auth(f.users.assistant.token), data: { comment_id: comment.comment_id, remove: true } })).status()).toBe(403);
});

test('弱项选题生成定向作业，其他同班学员看不到也不能提交，提醒与人数只统计目标学员', async ({ request }) => {
  const result = await data(await request.get('/api/v1/institution/students/' + f.users.student.user_id + '/weakness-questions?org_id=' + f.oid + '&target=JLPT-N3', { headers: auth(f.users.teacher.token) }));
  expect(result.items.some(row => row.question_id === '0:3')).toBe(true);
  const assignment = await post(request, '/api/v1/organizations/' + f.oid + '/learning-groups/' + f.gid + '/assignments', { title: '定向错题 API 验收', exam_id: 'N3_2010_07', question_ids: ['0:3'], target_student_ids: [f.users.student.user_id] }, f.users.teacher.token);
  const mine = await data(await request.get('/api/v1/me/assignments', { headers: auth(f.users.student.token) })), other = await data(await request.get('/api/v1/me/assignments', { headers: auth(f.users.student2.token) }));
  expect(mine.items.some(row => row.assignment_id === assignment.assignment_id)).toBe(true); expect(other.items.some(row => row.assignment_id === assignment.assignment_id)).toBe(false);
  const byGroup = await data(await request.get('/api/v1/organizations/' + f.oid + '/learning-groups/' + f.gid + '/assignments', { headers: auth(f.users.student2.token) }));
  expect(byGroup.items.some(row => row.assignment_id === assignment.assignment_id)).toBe(false);
  expect(byGroup.items.every(row => !row.submissions)).toBe(true);
  expect((await request.get('/api/v1/assignments/' + assignment.assignment_id, { headers: auth(f.users.student2.token) })).status()).toBe(403);
  expect((await request.post('/api/v1/assignments/' + assignment.assignment_id + '/submit', { headers: auth(f.users.student2.token), data: { answers: { '0:3': '1' } } })).status()).toBe(403);
  const staff = await data(await request.get('/api/v1/assignments/' + assignment.assignment_id + '/submissions', { headers: auth(f.users.teacher.token) })); expect(staff.learning_group.enrollments.filter(row => row.role === 'student')).toHaveLength(1);
  const reminder = await post(request, '/api/v1/assignments/' + assignment.assignment_id + '/reminders', { message: '请完成本次错题复习', idempotency_key: uniqueLoginId('target-reminder') }, f.users.teacher.token);
  expect(reminder.target_student_ids).toEqual([f.users.student.user_id]);
});

test('反馈绑定服务端不可变版本，修改后保留原题快照和处理版本，学员无权读取内部上下文', async ({ request }) => {
  const feedback = await post(request, '/api/v1/feedback', { paper_id: 'N3_2010_07', question_id: '0:1', category: 'question', description: '版本与返回验收', submitted_version_id: 'fake-client-version' }, f.users.student.token);
  expect(feedback.submitted_version_id).toMatch(/^ver_/);
  const url = '/api/v1/feedback/' + feedback.feedback_id + '/context?paper_id=N3_2010_07';
  const before = await data(await request.get(url, { headers: auth(f.admin.token) })); expect(before.source_available).toBe(true); expect(before.source_questions).toHaveLength(1);
  expect((await request.get(url, { headers: auth(f.content.token) })).ok()).toBe(true);
  expect((await request.get(url, { headers: auth(f.users.student.token) })).status()).toBe(403);
  const exam = await data(await request.get('/api/v1/exams/N3_2010_07'));
  const modified = structuredClone(exam); modified.exam_info.sections[0].passages[0].questions[0].question += '（版本验收修改）';
  try {
    await data(await request.put('/api/v1/exams/N3_2010_07', { headers: auth(f.admin.token), data: modified }));
    await data(await request.patch('/api/v1/feedback/' + feedback.feedback_id + '?paper_id=N3_2010_07', { headers: auth(f.admin.token), data: { status: 'resolved', public_reply: '已修正并保留处理版本' } }));
    const after = await data(await request.get(url, { headers: auth(f.admin.token) }));
    expect(after.feedback.resolved_version_id).not.toBe(feedback.submitted_version_id); expect(after.source_questions[0].question.question).not.toContain('版本验收修改'); expect(after.feedback.processing_history).toHaveLength(1);
  } finally { await data(await request.put('/api/v1/exams/N3_2010_07', { headers: auth(f.admin.token), data: exam })); }
});

test('平台待办读取真实失败订单、本机检查与发布阻断，非平台管理员被拒绝', async ({ request }) => {
  const url = '/api/v1/admin/operations?date=' + day(0), result = await data(await request.get(url, { headers: auth(f.admin.token) }));
  expect(result.items.some(row => row.id === f.synthetic.id && row.type === 'failed_payment')).toBe(true); expect(result.items.some(row => row.id === f.syntheticRefund.id && row.destination === 'refund')).toBe(true); expect(result.checks.filter(row => row.name !== '数据备份校验').every(row => row.ready)).toBe(true);
  expect(result.checks.find(row => row.name === '数据备份校验')).toHaveProperty('state');
  expect((await request.get(url, { headers: auth(f.users.orgAdmin.token) })).status()).toBe(403); expect((await request.get(url.replace(day(0), '2026-02-30'), { headers: auth(f.admin.token) })).status()).toBe(422);
});

test('教师从学员档案查看进步并直接布置所选错题，手机深色布局可用', async ({ page }, info) => {
  const shell = await enter(page, 'teacher'); await navigateWorkspace(shell, 'openRoleContent:teacher-students');
  await shell.locator('[data-intent="openRoleContent:teacher-student:' + f.users.student.user_id + '"]').first().click();
  const progress = shell.locator('[data-product-panel=progress]'); await expect(progress).toContainText('前期'); await expect(progress).toContainText('样本');
  await shell.getByRole('tab', { name: '作业', exact: true }).click();
  const weakness = shell.locator('[data-product-panel=weakness]'); await expect(weakness.locator('input[name=question_ids]').first()).toBeVisible();
  await weakness.locator('[name=exam]').selectOption('N3_2010_07'); await weakness.locator('[name=title]').fill('页面错题定向作业');
  await weakness.getByRole('button', { name: '布置所选错题', exact: true }).click(); await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('页面错题定向作业');
  await expect(shell.locator('[data-assignment-student="' + f.users.student.user_id + '"]')).toContainText('尚未提交');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.body.classList.remove('light-theme'));
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); await page.screenshot({ path: info.outputPath('targeted-assignment-mobile-dark.png') });
});

test('管理员在向导连续完成成员确认、分班课时和首课，失败保留表单', async ({ page }, info) => {
  const shell = await enter(page, 'orgAdmin'); await shell.locator('[data-role-admin-intent="openRoleContent:org-setup"]').click();
  const panel = shell.locator('[data-product-panel=setup]'); await expect(panel).toContainText('当前机构'); await panel.getByRole('button', { name: '下一步：分班与课时' }).click();
  await panel.locator('[name=name]').fill('页面向导验收班'); await panel.locator('[name=subject]').fill('japanese');
  await panel.locator('[name=student_ids][value="' + f.users.observer.user_id + '"]').check(); await panel.locator('[name=teacher_ids][value="' + f.users.teacher.user_id + '"]').check();
  await panel.locator('[name=template_id]').selectOption(f.template.course_package_id);
  await page.route('**/api/v1/institution/organizations/' + f.oid + '/setup', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '模拟保存失败' } }) : route.fallback());
  await panel.getByRole('button', { name: '保存并安排首课' }).click(); await expect(panel.getByRole('alert')).toContainText('模拟保存失败'); await expect(panel.locator('[name=name]')).toHaveValue('页面向导验收班');
  await page.unroute('**/api/v1/institution/organizations/' + f.oid + '/setup'); await panel.getByRole('button', { name: '保存并安排首课' }).click();
  await expect(panel).toContainText('班级已保存'); const lessons = panel.locator('[data-institution-flow=lessons]'); await expect(lessons).toContainText('页面向导验收班');
  await lessons.locator('[data-flow-action=new-lesson]').click(); await lessons.locator('[name=title]').fill('向导首课'); await lessons.locator('[name=starts_at]').fill('2036-01-01T10:00'); await lessons.locator('[name=ends_at]').fill('2036-01-01T11:00'); await lessons.getByRole('button', { name: '保存课次', exact: true }).click();
  await expect(lessons).toContainText('向导首课'); await page.setViewportSize({ width: 390, height: 844 }); expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); await page.screenshot({ path: info.outputPath('setup-mobile.png') });
});

test('教师常用评语可追加，保存并下一份切到待批改学员，修改历史可见', async ({ page }) => {
  const shell = await enter(page, 'teacher'); await navigateWorkspace(shell, 'openRoleContent:teacher-review'); await shell.locator('[data-teacher-assignment-filter=all]').click();
  await shell.locator('[data-intent="openRoleContent:teacher-assignment:' + f.assignment.assignment_id + '"]').click();
  await shell.locator('[data-review-student]').selectOption(f.users.student.user_id);
  const first = shell.locator('[data-assignment-student="' + f.users.student.user_id + '"]'); await expect(first).toBeVisible(); await first.locator('[data-submission-comment]').focus();
  await shell.locator('.pc-product-comments > summary').click(); await shell.locator('[data-product-action=use-comment]').first().click(); await expect(first.locator('[data-submission-comment]')).not.toHaveValue('');
  await first.locator('[data-submission-score]').fill('82'); await first.getByRole('button', { name: '保存并下一份', exact: true }).click();
  const second = shell.locator('[data-assignment-student="' + f.users.student2.user_id + '"]'); await expect(second).toHaveClass(/pc-review-current/); await expect(first.locator('.pc-product-review-history')).toContainText('82%');
});

test('内容管理员打开原题后有固定返回入口，回到原反馈和筛选，版本快照按需读取', async ({ page }) => {
  await post(page.request, '/api/v1/feedback', { paper_id: 'N3_2010_07', question_id: '0:1', category: 'question', description: '版本与返回验收' }, f.users.student.token);
  const shell = await enter(page, 'contentAdmin'); await navigateWorkspace(shell, 'openRoleContent:content-feedback');
  const query = shell.locator('[data-platform-feedback-query]'); await query.fill('版本与返回验收'); await query.press('Enter');
  const row = shell.locator('[data-content-feedback-row]').first(); await expect(row).toContainText('版本与返回验收'); await row.locator('.pc-product-feedback-context > summary').click();
  await expect(row.locator('[data-product-panel=feedback]')).toContainText('反馈时版本'); await row.locator('[data-feedback-open-question]').click();
  const back = page.locator('#pc-feedback-return').getByRole('button', { name: '返回反馈处理', exact: true }); await expect(back).toBeVisible(); await back.click();
  await expect(shell).toBeVisible(); await expect(shell.locator('[data-platform-feedback-query]')).toHaveValue('版本与返回验收'); await expect(shell.locator('[data-content-feedback-row]').first()).toContainText('版本与返回验收');
});

test('平台首页待办可筛选并直达订单详情，机构看板手机布局不溢出', async ({ page }, info) => {
  const shell = await enter(page, 'superAdmin'), operations = shell.locator('[data-product-panel=platform-operations]');
  await expect(operations).toContainText('运行提醒'); await operations.locator('[data-platform-admin-page="reminders"]').click(); await operations.getByLabel('筛选运行提醒').selectOption('failed_payment');
  const row = operations.locator('[data-target="' + f.synthetic.id + '"]'); await expect(row).toBeVisible(); await row.click();
  await expect(shell.locator('.pc-info-row strong').filter({ hasText: new RegExp('^' + f.synthetic.id + '$') })).toBeVisible();
  await navigateWorkspace(shell, 'overview', true); const refreshed = shell.locator('[data-product-panel=platform-operations]'); await refreshed.locator('[data-platform-admin-page="reminders"]').click(); await refreshed.getByLabel('筛选运行提醒').selectOption('overdue_refund');
  await refreshed.locator('[data-target="' + f.syntheticRefund.id + '"]').click(); await expect(shell.locator('.pc-info-row strong').filter({ hasText: new RegExp('^' + f.syntheticRefund.id + '$') })).toBeVisible();
  await shell.getByRole('button', { name: '查看订单', exact: true }).click(); await expect(shell.locator('.pc-info-row strong').filter({ hasText: new RegExp('^' + f.synthetic.id + '$') })).toBeVisible();
  await enter(page, 'orgAdmin'); await navigateWorkspace(shell, 'openRoleContent:org-dashboard'); await expect(shell.locator('[data-product-panel=operations]')).toContainText('教学履约与跟进');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1); await page.screenshot({ path: info.outputPath('operations-mobile.png') });
});

test('学员从学习档案比较自己的同目标进步，窄屏可用且遵守报告开关', async ({ page }, info) => {
  const shell = await enter(page, 'student');
  await shell.locator('[data-archive-section=report]').click();
  await shell.getByRole('button', { name: /^按目标比较学习进步/ }).click();
  const panel = shell.locator('[data-product-panel=progress]'); await expect(panel.locator('[name=target]')).toBeVisible();
  await panel.locator('[name=from]').fill(day(-30)); await panel.locator('[name=to]').fill(day(-1)); await panel.locator('[name=target]').selectOption('JLPT-N3');
  await panel.getByRole('button', { name: '查看进步', exact: true }).click(); await expect(panel).toContainText('共 6 题'); await expect(panel).toContainText('样本较少');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('student-progress-mobile.png') });
  try {
    await data(await page.request.put('/api/v1/me/feature-flags', { data: { learning_report: { enabled: false } } }));
    expect((await page.request.get('/api/v1/me/learning-progress')).status()).toBe(403);
  } finally { await data(await page.request.put('/api/v1/me/feature-flags', { data: { learning_report: null } })); }
});

test('UI05 班级先显示课次，同页切换保留排课草稿，成绩入口保持上下文', async ({ page, request }, info) => {
  for (let i = 0; i < 4; i++) {
    const user = await loginApi(request, uniqueLoginId('student_ui2_extra'));
    await post(request, '/api/v1/organizations/' + f.oid + '/members', { user_id: user.user_id, roles: ['student'], confirmation: '确认修改机构成员', reauth_password: '' }, f.admin.token);
    await post(request, '/api/v1/organizations/' + f.oid + '/learning-groups/' + f.gid + '/enrollments', { user_id: user.user_id, role: 'student' }, f.admin.token);
  }
  const shell = await enter(page, 'teacher');
  await navigateWorkspace(shell, 'openRoleContent:teacher-groups');
  await shell.locator('[data-intent="openRoleContent:teacher-group:' + f.oid + ':' + f.gid + '"]').click();
  const lessons = shell.locator('[data-institution-flow=lessons]');
  await expect(lessons.locator('[data-next-lesson]')).toContainText('待确认请假验收');
  await expect(shell.locator('.pc-detail-context')).toContainText('按课次安排');
  await lessons.locator('[data-flow-action=new-lesson]').click();
  await lessons.locator('[name=title]').fill('尚未保存的课次');
  await shell.getByRole('tab', { name: '学员', exact: true }).click();
  await expect(lessons).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(shell.getByRole('tab', { name: '课程包', exact: true })).toHaveAttribute('aria-selected', 'true');
  await shell.getByRole('tab', { name: '课次', exact: true }).click();
  await expect(lessons.locator('[name=title]')).toHaveValue('尚未保存的课次');
  await lessons.locator('[data-flow-action=cancel-lesson]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await lessons.boundingBox()).y).toBeLessThan(350);
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('class-lessons-mobile.png') });
  await navigateWorkspace(shell, 'openRoleContent:teacher-gradebook');
  await shell.locator('[data-intent="openRoleContent:teacher-group:' + f.oid + ':' + f.gid + ':results"]').click();
  await expect(shell.getByRole('tab', { name: '作业与成绩', exact: true })).toHaveAttribute('aria-selected', 'true');
  await shell.locator('[data-intent="openRoleContent:teacher-assignment:' + f.assignment.assignment_id + '"]').click();
  await expect(shell.locator('[data-review-student]')).toBeVisible();
});

test('UI06 单人批改切换保留评语，失败可重试并保存到下一份', async ({ page, request }, info) => {
  const assignment = await post(request, '/api/v1/organizations/' + f.oid + '/learning-groups/' + f.gid + '/assignments', { title: '紧凑批改布局', exam_id: 'N3_2010_07', question_start: 1, question_end: 3 }, f.users.teacher.token);
  for (const role of ['student', 'student2']) await post(request, '/api/v1/assignments/' + assignment.assignment_id + '/submit', { answers: { '0:1': '1', '0:2': '2', '0:3': '3' }, submission_id: uniqueLoginId('compact_review') }, f.users[role].token);
  const shell = await enter(page, 'teacher');
  await navigateWorkspace(shell, 'openRoleContent:teacher-review'); await shell.locator('[data-teacher-assignment-filter=all]').click();
  await shell.locator('[data-intent="openRoleContent:teacher-assignment:' + assignment.assignment_id + '"]').click();
  await expect(shell.locator('.pc-review-heading')).toContainText('待批改 2 人');
  const first = shell.locator('[data-assignment-student="' + f.users.student.user_id + '"]');
  const second = shell.locator('[data-assignment-student="' + f.users.student2.user_id + '"]');
  await shell.locator('[data-review-student]').selectOption(f.users.student.user_id);
  await first.locator('[data-submission-comment]').fill('注意核对读音，已复核。');
  await first.locator('[data-submission-score]').fill('82');
  await second.locator('summary').first().click(); await expect(second).toHaveAttribute('open'); await expect(first).not.toHaveAttribute('open');
  await first.locator('summary').first().click(); await expect(first.locator('[data-submission-comment]')).toHaveValue('注意核对读音，已复核。');
  const route = '**/api/v1/assignments/' + assignment.assignment_id + '/submissions/**/review';
  await page.route(route, r => r.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '模拟批改保存失败' } }));
  await first.getByRole('button', { name: '保存批改', exact: true }).click(); await expect(page.getByText('模拟批改保存失败', { exact: true })).toBeVisible();
  await expect(first.locator('[data-submission-score]')).toHaveValue('82');
  await page.unroute(route);
  await first.getByRole('button', { name: '保存并下一份', exact: true }).click();
  await expect(second).toHaveAttribute('open'); await expect(second).toHaveClass(/pc-review-current/); await expect(first.locator('.pc-product-review-history')).toContainText('82%');
  await expect(shell.locator('.pc-review-reminders')).not.toHaveAttribute('open');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.body.classList.remove('light-theme'));
  await shell.locator('main').evaluate(el => el.scrollTop = 0);
  expect((await second.locator('[data-submission-comment]').boundingBox()).y).toBeLessThan(700);
  await page.screenshot({ path: info.outputPath('review-mobile-dark.png') });
});

test('UI07 学员档案只展示所选内容，薄弱项按需加载并保留选择', async ({ page }, info) => {
  let weaknessRequests = 0; page.on('request', request => { if (request.url().includes('/weakness-questions?')) weaknessRequests++; });
  const shell = await enter(page, 'teacher'); await navigateWorkspace(shell, 'openRoleContent:teacher-students');
  await shell.locator('[data-intent="openRoleContent:teacher-student:' + f.users.student.user_id + '"]').first().click();
  const progress = shell.locator('[data-product-panel=progress]'); await expect(progress).toContainText('前期'); await expect(progress).toContainText('独立作答');
  await expect(progress.locator('.pc-progress-comparison')).toContainText(/\d{4}-\d{2}-\d{2}/);
  expect(weaknessRequests).toBe(0);
  const headerTop = (await shell.locator('.pc-workspace-page-heading').boundingBox()).y;
  await shell.getByRole('tab', { name: '作业', exact: true }).click();
  const weakness = shell.locator('[data-product-panel=weakness]'); await expect(weakness.locator('[name=question_ids]').first()).toBeVisible();
  expect(weaknessRequests).toBeGreaterThan(0);
  await weakness.locator('[name=question_ids]').first().check();
  await shell.getByRole('tab', { name: '课时与班级', exact: true }).click(); await expect(progress).toBeHidden();
  await shell.getByRole('tab', { name: '作业', exact: true }).click(); await expect(weakness.locator('[name=question_ids]').first()).toBeChecked();
  expect((await shell.locator('.pc-workspace-page-heading').boundingBox()).y).toBe(headerTop);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('student-tasks-mobile.png') });
});

test('UI08 成员页先展示名单，权限页聚焦角色配置，邀请与个人授权可展开', async ({ page }, info) => {
  const shell = await enter(page, 'orgAdmin'); await navigateWorkspace(shell, 'openRoleContent:org-members');
  await expect(shell.locator('.pc-member-role-section')).toBeVisible();
  await expect(shell.locator('[data-member-invite]')).not.toHaveAttribute('open');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await shell.locator('.pc-org-unified-member-list').first().boundingBox()).y).toBeLessThan(800);
  await shell.locator('[data-member-invite] > summary').click(); await expect(shell.locator('[data-member-invite] form').first()).toBeVisible();
  await navigateWorkspace(shell, 'openRoleContent:org-permissions');
  await expect(shell.locator('.pc-role-default-section')).toBeVisible(); await expect(shell.locator('[data-member-invite]')).toHaveCount(0);
  const overrides = shell.locator('.pc-member-permission-overrides'); await expect(overrides).not.toHaveAttribute('open');
  await overrides.locator('summary').first().click(); await expect(overrides.locator('.pc-member-role-section')).toBeVisible();
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('permissions-mobile.png') });
});

test('UI13 跟进独立编辑，返回名单保留草稿，失败后可继续保存', async ({ page }, info) => {
  const shell = await enter(page, 'assistant'); await navigateWorkspace(shell, 'openRoleContent:assistant-followup');
  const host = shell.locator('[data-institution-flow=followups]');
  const select = id => host.locator('[data-flow-action=select-student][data-id="' + id + '"]').click();
  await select(f.users.student.user_id);
  const form = host.locator('[data-flow-form=followup]');
  await expect(form.locator('.pc-admin-note')).toContainText(f.names.student);
  await expect(host.locator('[data-followup-student]')).toHaveCount(0);
  await form.locator('[name=text]').fill('第二批布局跟进草稿'); await form.locator('[name=next_at]').fill('2036-01-02T10:00');
  await host.locator('[data-flow-action=back-followup]').click();
  await select(f.users.student2.user_id); await host.locator('[data-flow-action=back-followup]').click(); await select(f.users.student.user_id);
  await expect(form.locator('[name=text]')).toHaveValue('第二批布局跟进草稿'); await expect(form.locator('[name=next_at]')).toHaveValue('2036-01-02T10:00');
  await host.locator('[data-flow-action=back-followup]').click(); await host.locator('[data-flow-action=refresh]').click(); await select(f.users.student.user_id);
  await expect(form.locator('[name=text]')).toHaveValue('第二批布局跟进草稿');
  const route = '**/api/v1/institution/organizations/' + f.oid + '/followups';
  await page.route(route, r => r.request().method() === 'POST' ? r.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '跟进保存暂不可用' } }) : r.fallback());
  await form.getByRole('button', { name: '保存跟进', exact: true }).click(); await expect(form.getByRole('alert')).toContainText('跟进保存暂不可用');
  await expect(form.locator('[name=text]')).toHaveValue('第二批布局跟进草稿'); await page.unroute(route);
  await page.setViewportSize({ width: 390, height: 844 }); await shell.locator('main').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: info.outputPath('followup-inline-mobile.png') });
  await form.getByRole('button', { name: '保存跟进', exact: true }).click(); await expect(host.locator('.pc-flow-history')).toContainText('第二批布局跟进草稿');
});
