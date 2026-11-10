const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const { navigateWorkspace } = require('./helpers/workspace-navigation');
test.use({ timezoneId: 'Asia/Shanghai' });
let f;
const auth = token => ({ Authorization: 'Bearer ' + token });
async function data(response) { const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body.data; }
const post = (request, path, body, token) => request.post(path, { headers: auth(token), data: body }).then(data);
const groupPath = (org, group) => '/api/v1/institution/organizations/' + org + '/learning-groups/' + group + '/lessons';
test.beforeAll(async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).not.toBe('8080');
  const admin = await loginApi(request, 'superadmin_product_review');
  const users = {}, names = {};
  for (const role of ['teacher', 'assistant', 'orgAdmin', 'student', 'student2', 'otherTeacher', 'outsider']) {
    names[role] = uniqueLoginId('student_product_' + role);
    users[role] = await loginApi(request, names[role]);
  }
  const org = await post(request, '/api/v1/organizations', { name: uniqueLoginId('产品验收机构'), organization_type: 'school', plan: 'ultra', seats: 50 }, admin.token);
  const other = await post(request, '/api/v1/organizations', { name: uniqueLoginId('另一机构'), organization_type: 'school', plan: 'ultra', seats: 50 }, admin.token);
  const oid = org.organization_id, bid = other.organization_id;
  for (const role of ['teacher', 'assistant', 'orgAdmin', 'student', 'student2'])
    await post(request, '/api/v1/organizations/' + oid + '/members', { user_id: users[role].user_id, roles: [role === 'student2' ? 'student' : role], confirmation: '确认修改机构成员', reauth_password: '' }, admin.token);
  for (const [role, assigned] of [['otherTeacher', 'teacher'], ['student', 'student']])
    await post(request, '/api/v1/organizations/' + bid + '/members', { user_id: users[role].user_id, roles: [assigned], confirmation: '确认修改机构成员', reauth_password: '' }, admin.token);
  const group = await post(request, '/api/v1/organizations/' + oid + '/learning-groups', { name: '日语教学班', type: 'class', subject: 'japanese' }, admin.token);
  const otherGroup = await post(request, '/api/v1/organizations/' + bid + '/learning-groups', { name: '另一机构班级', type: 'class' }, admin.token);
  const overlap = await post(request, '/api/v1/organizations/' + oid + '/learning-groups', { name: '同老师的另一班', type: 'class' }, admin.token);
  for (const [orgId, groupId, roles] of [[oid, group.learning_group_id, ['teacher', 'assistant', 'student', 'student2']], [bid, otherGroup.learning_group_id, ['otherTeacher', 'student']], [oid, overlap.learning_group_id, ['teacher', 'student2']]])
    for (const role of roles) await post(request, '/api/v1/organizations/' + orgId + '/learning-groups/' + groupId + '/enrollments', { user_id: users[role].user_id, role: role === 'student2' ? 'student' : role === 'otherTeacher' ? 'teacher' : role }, admin.token);
  for (const role of Object.keys(users)) users[role] = await loginApi(request, names[role]);
  const accounts = {};
  for (const role of ['student', 'student2'])
    accounts[role] = await post(request, '/api/v1/organizations/' + oid + '/course-packages', { title: role === 'student' ? '日语课时账户' : '同班课时账户', record_type: 'assignment', student_id: users[role].user_id, total_lessons: role === 'student' ? 2 : 10, status: 'active', expires_at: '2099-12-31T00:00:00Z' }, admin.token);
  const assignments = [];
  for (const [title, due] of [['远期老师作业', '2099-12-31T00:00:00Z'], ['不限期老师作业', '']])
    assignments.push(await post(request, '/api/v1/organizations/' + oid + '/learning-groups/' + group.learning_group_id + '/assignments', { title, exam_id: 'N3_2010_07', due_at: due, question_start: 1, question_end: 1 }, users.teacher.token));
  f = { admin, users, names, oid, bid, gid: group.learning_group_id, bgid: otherGroup.learning_group_id, overlap: overlap.learning_group_id, accounts, assignments };
  const seed = await post(request, groupPath(oid, f.gid), { title: '逐课次验收（初始记录）', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T11:00:00Z' }, users.teacher.token);
  await post(request, groupPath(oid, f.gid), { ...seed, status: 'completed', assignment_id: assignments[0].assignment_id, feedback: '本节听力表现进步，课后复习第二题。', attendance: ['student', 'student2'].map(role => ({student_id: users[role].user_id, status: 'present', charge: 0, course_package_id: ''})) }, users.teacher.token);
});
async function enter(page, role) {
  await loginApi(page.request, f.names[role]);
  const ctx = await data(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(ctx => localStorage.setItem('exam_v2_user', JSON.stringify({ ...ctx.user, guest: false, token: '', profile: ctx.profile, membership: ctx.membership, memberships: ctx.memberships, organizations: ctx.organizations, subscription: ctx.subscription, permissions: ctx.permissions })), ctx);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('[data-role-workbench="' + role + '"]').click();
  }
  await expect(shell).toHaveAttribute('data-learning-role', role);
  await page.waitForLoadState('networkidle');
  return shell;
}

test('新学员观察期与课程余额提醒分别计算，零作答不直接判流失', async ({ request }) => {
  const dashboard = await data(await request.get('/api/v1/institution/dashboard?org_id=' + f.oid, { headers: auth(f.users.assistant.token) }));
  const risk = dashboard.renewal_risks.find(row => row.student.id === f.users.student.user_id);
  expect(risk.observing).toBe(true); expect(risk.level).toBe('low'); expect(risk.inactive_days).toBeLessThan(14);
  expect(typeof risk.membership_expiring).toBe('boolean');
  const tracking = await data(await request.get('/api/v1/institution/organizations/' + f.oid + '/followups', { headers: auth(f.users.assistant.token) }));
  expect(tracking.course_packages.find(row => row.student_id === f.users.student.user_id).attention_reason).toContain('不足');
});

test('跟进支持负责人、期限、结果和历史，普通机构账号不能读取另一个机构备注', async ({ request }) => {
  const path = '/api/v1/institution/organizations/' + f.oid + '/followups';
  const record = await post(request, path, { student_id: f.users.student.user_id, text: '本机构内部续课沟通', owner_id: f.users.assistant.user_id, next_at: '2030-01-01T00:00:00Z' }, f.users.teacher.token);
  const bad = await request.post(path, { headers: auth(f.users.teacher.token), data: { ...record, status: 'completed', result: '' } });
  expect(bad.status()).toBe(422);
  const complete = await post(request, path, { ...record, status: 'completed', result: '已联系，约定下周确认' }, f.users.assistant.token);
  expect(complete.history).toHaveLength(1);
  const visible = await data(await request.get('/api/v1/institution/students/' + f.users.student.user_id + '?org_id=' + f.bid, { headers: auth(f.users.otherTeacher.token) }));
  expect(JSON.stringify(visible.teacher_notes)).not.toContain('本机构内部续课沟通');
  expect((await request.get(path, { headers: auth(f.users.otherTeacher.token) })).status()).toBe(403);
  expect((await request.post(path, { headers: auth(f.users.student.token), data: record })).status()).toBe(403);
});

test('反馈处理结果只回到提交者，公开回复与内部备注分开', async ({ request }) => {
  const feedback = await post(request, '/api/v1/feedback', { paper_id: 'N3_2010_07', question_id: '1', category: 'analysis', description: '请核查这一题解析' }, f.users.student.token);
  await data(await request.patch('/api/v1/feedback/' + feedback.feedback_id + '?paper_id=N3_2010_07', { headers: auth(f.admin.token), data: { status: 'resolved', public_reply: '已核对并修正题目说明', admin_note: '仅限内部的处理备注' } }));
  const own = await data(await request.get('/api/v1/me/feedback-results', { headers: auth(f.users.student.token) }));
  expect(JSON.stringify(own)).toContain('已核对并修正题目说明');
  expect(JSON.stringify(own)).not.toContain('仅限内部的处理备注');
  const other = await data(await request.get('/api/v1/me/feedback-results', { headers: auth(f.users.student2.token) }));
  expect(JSON.stringify(other)).not.toContain(feedback.feedback_id);
});

test('批量导入先预览再提交，已有账号实际加入，新账号创建邀请，重试不重复', async ({ request }) => {
  const name = uniqueLoginId('registered_import'), email = name + '@example.com';
  const registered = await data(await request.post('/api/v1/auth/register', { data: { username: name, email, password: 'Review_12345!' } }));
  const text = ['已有账号,' + email + ',,student', '新学员,' + name + '_new@example.com,,student', '重复行,' + email + ',,student', '不完整,,,student', '不允许的授权,staff@example.com,,orgAdmin'].join('\n');
  const url = '/api/v1/organizations/' + f.oid + '/student-import';
  const preview = await post(request, url, { text, commit: false }, f.users.orgAdmin.token);
  expect(preview.rows.map(row => row.action)).toEqual(['add', 'invite', 'skip', 'error', 'error']);
  const oversized = await request.post(url, { headers: auth(f.users.orgAdmin.token), data: { text: [text.split('\n')[0], ...Array(100).fill('不完整,,,student')].join('\n'), commit: true, confirmation: '确认导入学员', reauth_password: '' } });
  expect(oversized.status()).toBe(422);
  const untouched = await data(await request.get('/api/v1/organizations/' + f.oid + '/members', { headers: auth(f.users.orgAdmin.token) }));
  expect(JSON.stringify(untouched)).not.toContain(name);
  const result = await post(request, url, { text, commit: true, confirmation: '确认导入学员', reauth_password: '' }, f.users.orgAdmin.token);
  expect(result.summary.added).toBe(1); expect(result.summary.invited).toBe(1); expect(result.summary.failed).toBe(2);
  const again = await post(request, url, { text, commit: true, confirmation: '确认导入学员', reauth_password: '' }, f.users.orgAdmin.token);
  expect(again.summary.added).toBe(0); expect(again.summary.invited).toBe(0);
  const members = await data(await request.get('/api/v1/organizations/' + f.oid + '/members', { headers: auth(f.users.orgAdmin.token) }));
  expect(JSON.stringify(members)).toContain(name);
  expect((await request.post(url, { headers: auth(f.users.teacher.token), data: { text, commit: true } })).status()).toBe(403);
  expect(registered.user_id || registered.id).toBeTruthy();
});

test('逐课次排课检查冲突，出勤结算原子扣课且重复完成不重复扣减，学员只看到自己的记录', async ({ request }) => {
  const path = groupPath(f.oid, f.gid);
  const lesson = await post(request, path, { title: '逐课次验收', starts_at: '2031-01-01T10:00:00Z', ends_at: '2031-01-01T11:00:00Z' }, f.users.teacher.token);
  expect((await request.post(groupPath(f.oid, f.overlap), { headers: auth(f.users.teacher.token), data: { title: '冲突课程', starts_at: '2031-01-01T10:30:00Z', ends_at: '2031-01-01T11:30:00Z' } })).status()).toBe(409);
  const adjacent = await post(request, groupPath(f.oid, f.overlap), { title: '衔接课程', starts_at: '2031-01-01T11:00:00Z', ends_at: '2031-01-01T12:00:00Z' }, f.users.teacher.token);
  expect(adjacent.lesson_id).toBeTruthy();
  const attendance = [
    { student_id: f.users.student.user_id, status: 'present', charge: 1, course_package_id: f.accounts.student.course_package_id },
    { student_id: f.users.student2.user_id, status: 'leave', charge: 0, course_package_id: '' }
  ];
  const invalid = await request.post(path, { headers: auth(f.users.teacher.token), data: { ...lesson, status: 'completed', attendance: [attendance[0], { ...attendance[1], charge: 5, course_package_id: f.accounts.student.course_package_id }] } });
  expect(invalid.status()).toBe(422);
  const before = await data(await request.get('/api/v1/me/courses', { headers: auth(f.users.student.token) }));
  expect(before.course_packages[0].remaining_lessons).toBe(2); expect(before.ledger).toHaveLength(0);
  const wrongAssignment = await post(request, '/api/v1/organizations/' + f.bid + '/learning-groups/' + f.bgid + '/assignments', { title: '其他机构的课后作业', exam_id: 'N3_2010_07', question_start: 1, question_end: 1 }, f.users.otherTeacher.token);
  expect((await request.post(path, { headers: auth(f.users.teacher.token), data: { ...lesson, assignment_id: wrongAssignment.assignment_id } })).status()).toBe(422);
  const completion = { ...lesson, status: 'completed', attendance, assignment_id: f.assignments[0].assignment_id, feedback: '本节听力表现进步，课后复习第二题。' };
  await Promise.all([post(request, path, completion, f.users.teacher.token), post(request, path, completion, f.users.teacher.token)]);
  const own = await data(await request.get('/api/v1/me/courses', { headers: auth(f.users.student.token) }));
  expect(own.course_packages[0].remaining_lessons).toBe(1); expect(own.ledger).toHaveLength(1);
  expect(own.lessons.find(row => row.lesson_id === lesson.lesson_id).own_attendance.charge).toBe(1);
  expect(own.lessons.find(row => row.lesson_id === lesson.lesson_id)).not.toHaveProperty('attendance');
  expect(own.lessons.find(row => row.lesson_id === lesson.lesson_id).homework.title).toBe('远期老师作业');
  expect(own.lessons.find(row => row.lesson_id === lesson.lesson_id).homework).not.toHaveProperty('submissions');
  expect(JSON.stringify(own)).not.toContain(f.accounts.student2.course_package_id);
  const other = await data(await request.get('/api/v1/me/courses', { headers: auth(f.users.student2.token) }));
  expect(other.ledger).toHaveLength(0);
  expect((await request.post(path, { headers: auth(f.users.student.token), data: completion })).status()).toBe(403);
  expect((await request.post(groupPath(f.bid, f.bgid), { headers: auth(f.users.teacher.token), data: completion })).status()).toBe(403);
  expect((await request.post('/api/v1/organizations/' + f.oid + '/learning-groups/' + f.gid + '/complete', { headers: auth(f.admin.token), data: {} })).status()).toBe(409);
  const next = await post(request, path, { title: '请假与补课验收', starts_at: '2031-01-02T10:00:00Z', ends_at: '2031-01-02T11:00:00Z', student_ids: [f.users.student.user_id] }, f.users.teacher.token);
  const leavePath = '/api/v1/me/lessons/' + next.lesson_id + '/leave';
  await post(request, leavePath, { org_id: f.oid, reason: '本次需要请假' }, f.users.student.token);
  expect((await request.post(leavePath, { headers: auth(f.users.student2.token), data: { org_id: f.oid, reason: '不能修改他人课次' } })).status()).toBe(403);
  const staff = await data(await request.get(path, { headers: auth(f.users.teacher.token) }));
  expect(staff.items.find(row => row.lesson_id === next.lesson_id).leave_requests[0].reason).toBe('本次需要请假');
  await post(request, path, { ...next, status: 'completed', attendance: [{ student_id: f.users.student.user_id, status: 'makeup', charge: 0, course_package_id: '' }] }, f.users.teacher.token);
  const makeup = await post(request, path, { title: '单独补课安排', starts_at: '2031-01-03T10:00:00Z', ends_at: '2031-01-03T11:00:00Z', student_ids: [f.users.student.user_id], makeup_for: next.lesson_id }, f.users.teacher.token);
  expect(makeup.makeup_for).toBe(next.lesson_id);
  const student2Courses = await data(await request.get('/api/v1/me/courses', { headers: auth(f.users.student2.token) }));
  expect(student2Courses.lessons.some(row => row.lesson_id === makeup.lesson_id)).toBe(false);
});

test('学员首页可见远期和不限期作业，课程、个人课时和通知在窄屏也能进入', async ({ page }, info) => {
  const shell = await enter(page, 'student');
  await expect(shell.locator('.pc-selfstudy-assignments')).toContainText('远期老师作业');
  await expect(shell.locator('.pc-selfstudy-assignments')).toContainText('不限期老师作业');
  await expect(shell.locator('[data-institution-flow=course-summary]')).toContainText('我的课程');
  await shell.locator('main').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('student-home-desktop.png') });
  await shell.locator('[data-role-admin-intent="openRoleContent:student-courses"]').click();
  const courses = shell.locator('[data-institution-flow=courses]');
  await expect(courses).toContainText('日语教学班');
  await expect(courses).toContainText('日语课时账户');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await courses.locator('[data-flow-filter]').selectOption('history');
  await expect(courses).toContainText('本节听力表现进步');
  await expect(courses.getByRole('button', { name: '课后作业：远期老师作业', exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('student-courses-mobile.png') });
  await shell.locator('[data-global-messages]').click();
  await expect(shell.locator('.pc-message-center-list')).toContainText('课程已完成');
  await expect(shell.getByRole('button', { name: '查看课程', exact: true }).first()).toBeVisible();
});

test('教师在班级管理课次，教务集中处理跟进，保存失败保留输入，页面支持深色与手机', async ({ page }, info) => {
  const shell = await enter(page, 'teacher');
  await navigateWorkspace(shell, 'openRoleContent:teacher-groups');
  await shell.locator('[data-intent="openRoleContent:teacher-group:' + f.oid + ':' + f.gid + '"]').first().click();
  const lessons = shell.locator('[data-institution-flow=lessons]');
  await expect(lessons).toContainText('逐课次验收');
  await lessons.locator('[data-flow-action=new-lesson]').click();
  await lessons.locator('[name=title]').fill('页面新增课次');
  await lessons.locator('[name=starts_at]').fill('2032-01-01T10:00');
  await lessons.locator('[name=ends_at]').fill('2032-01-01T11:00');
  await lessons.getByRole('button', { name: '保存课次', exact: true }).click();
  await expect(lessons).toContainText('页面新增课次');
  await expect(lessons.locator('[data-flow-form]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  expect(await shell.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('teacher-lessons-mobile-dark.png') });
  await shell.locator('[data-global-messages]').click();
  await shell.locator('[data-message-center-refresh]').click();
  const notice = shell.locator('[data-intent^="openRoleContent:course-notice:"]').first();
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(shell).toHaveAttribute('data-learning-role', 'teacher');
  await expect(shell.locator('[data-institution-flow=lessons]')).toContainText('日语教学班');
  await expect(shell.locator('[data-institution-flow=lessons]')).toContainText('页面新增课次');
  await shell.locator('[data-platform-admin-detail-back]').click();
  await expect(shell.locator('.pc-message-center-list')).toBeVisible();
  await enter(page, 'assistant');
  await navigateWorkspace(shell, 'openRoleContent:assistant-followup');
  const tracking = shell.locator('[data-institution-flow=followups]');
  await expect(tracking).toContainText(f.names.student);
  await tracking.locator('[data-flow-action=select-student][data-id="' + f.users.student.user_id + '"]').click();
  await tracking.locator('[name=text]').fill('需要保留的跟进内容');
  await tracking.locator('[name=status]').selectOption('completed');
  await tracking.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(tracking.getByRole('alert')).toContainText('处理结果');
  await expect(tracking.locator('[name=text]')).toHaveValue('需要保留的跟进内容');
  await tracking.locator('[name=result]').fill('已完成沟通');
  await tracking.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(tracking).toContainText('已完成沟通');
  await page.screenshot({ path: info.outputPath('assistant-followup-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await shell.locator('main').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('assistant-followup-desktop.png') });
});
