const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const fs = require('fs');
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 15000 });
const headers = actor => ({ Authorization: 'Bearer ' + actor.token });
async function data(response) { const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body.data; }
const post = (r, url, body, actor) => r.post(url, { headers: headers(actor), data: body }).then(data);
const day = (n, hour = 10) => `2037-11-${String(n).padStart(2,'0')}T${hour}:00:00Z`;
let f;
test.beforeAll(async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).toBe('8083');
  const admin = await loginApi(request, uniqueLoginId('superadmin_lifecycle'));
  const u = {};
  for (const role of ['manager','a','b','c','student','second','pending','outsider']) u[role] = await loginApi(request, uniqueLoginId('student_lifecycle_' + role));
  const org = await post(request,'/api/v1/organizations',{ name: uniqueLoginId('教学交接验收'), organization_type: 'school', plan: 'ultra', seats: 40 },admin), oid = org.organization_id;
  for (const role of ['manager','a','b','c','student','second','pending']) await post(request,`/api/v1/organizations/${oid}/members`,{ user_id: u[role].user_id, roles: [role === 'manager' ? 'orgAdmin' : ['a','b','c'].includes(role) ? 'teacher' : 'student'], confirmation: '确认修改机构成员', reauth_password: '' },admin);
  const groups = {};
  for (const [key, actors] of [['source',['a','student','second']],['target',['b','second']],['pending',['a','pending']],['conflict',['c','pending']]]) {
    groups[key] = await post(request,`/api/v1/organizations/${oid}/learning-groups`,{ name: '验收班 ' + key, type: 'class', subject: 'japanese' },admin);
    for (const role of actors) await post(request,`/api/v1/organizations/${oid}/learning-groups/${groups[key].learning_group_id}/enrollments`,{ user_id: u[role].user_id, role: ['a','b','c'].includes(role) ? 'teacher' : 'student' },admin);
  }
  const lp = group => `/api/v1/institution/organizations/${oid}/learning-groups/${groups[group].learning_group_id}/lessons`;
  const original = await post(request,lp('source'),{ title: '原班历史课次', starts_at: '2026-10-01T08:00:00Z', ends_at: '2026-10-01T09:00:00Z' },admin);
  await post(request,lp('source'),{ ...original, status: 'completed', attendance: ['student','second'].map(key => ({ student_id: u[key].user_id, status: 'present', charge: 0, course_package_id: '' })) },admin);
  const account = await post(request,`/api/v1/organizations/${oid}/course-packages`,{ title: '转班保留账户', record_type: 'assignment', student_id: u.student.user_id, total_lessons: 20, status: 'active' },admin);
  const assignment = await post(request,`/api/v1/organizations/${oid}/learning-groups/${groups.pending.learning_group_id}/assignments`,{ title: '必须先完成的原班作业', exam_id: 'N3_2010_07', question_start: 1, question_end: 1 },admin);
  f = { admin, u, oid, groups, original, account, assignment, lp: Object.fromEntries(Object.keys(groups).map(key => [key,lp(key)])) };
  fs.writeFileSync('tmp/teaching-lifecycle-20261028/fixture.json',JSON.stringify(f,null,2));
});
const endpoint = (group, kind) => f.lp[group].replace(/lessons$/,kind);
const lessonContext = (r, group) => r.get(f.lp[group],{ headers: headers(f.admin) }).then(data);
const relation = (kind, actor, extra = {}) => ({ request_id: uniqueLoginId('handoff'), kind, member_id: f.u[actor].user_id, reason: '核对后办理教学交接', ...extra });
async function planCommit(r, group, kind, input, actor = f.u.manager) {
  const url = endpoint(group,kind), preview = await post(r,url + '/preview',input,actor);
  expect(preview.can_commit, JSON.stringify(preview)).toBe(true);
  return post(r,url,{ ...input, expected_revision: preview.revision, confirmation: kind === 'lesson-batch' ? '确认批量排课' : '确认变更授课关系', reauth_password: '' },actor);
}

test('重复排课先预览，整批保存且重复、并发请求不多建课次，不扣课', async ({ request }) => {
  const url = endpoint('source','lesson-batch');
  const items = [1,8,15].map(n => ({ title: '周课 ' + n, starts_at: day(n), ends_at: day(n,11), student_ids: [f.u.student.user_id] }));
  const input = { request_id: uniqueLoginId('weekly'), items }, before = await lessonContext(request,'source');
  const preview = await post(request,url + '/preview',input,f.u.a);
  expect(preview.can_commit).toBe(true); expect(preview.items).toHaveLength(3);
  expect((await lessonContext(request,'source')).items).toEqual(before.items);
  const body = { ...input, expected_revision: preview.revision, confirmation: '确认批量排课' };
  const saved = await Promise.all([post(request,url,body,f.u.a),post(request,url,body,f.u.a)]);
  expect(saved[0].items.map(row => row.lesson_id)).toEqual(saved[1].items.map(row => row.lesson_id));
  const after = await lessonContext(request,'source'); expect(after.items).toHaveLength(before.items.length + 3);
  const mine = await data(await request.get('/api/v1/me/courses',{ headers: headers(f.u.student) })); expect(mine.ledger).toHaveLength(0); expect(mine.course_packages.find(row => row.course_package_id === f.account.course_package_id).remaining_lessons).toBe(20);
  expect((await request.post(url,{ headers: headers(f.u.a), data: { ...body, items: [{ ...items[0], title: '篡改请求' }] } })).status()).toBe(409);
});

test('批量排课逐节报告冲突，任何一节无效都不部分保存，旧预览拒绝', async ({ request }) => {
  const url = endpoint('source','lesson-batch'), before = await lessonContext(request,'source');
  const input = { request_id: uniqueLoginId('conflicts'), items: [{ title: '正常', starts_at: day(2), ends_at: day(2,11) },{ title: '批内冲突', starts_at: day(2), ends_at: day(2,11) },{ title: '已有课冲突', starts_at: day(1), ends_at: day(1,11) },{ title: '非法日期', starts_at: day(3,12), ends_at: day(3,11) }] };
  const preview = await post(request,url + '/preview',input,f.u.a); expect(preview.can_commit).toBe(false); expect(preview.conflicts.map(row => row.index)).toEqual([1,2,3]);
  expect((await request.post(url,{ headers: headers(f.u.a), data: { ...input, expected_revision: preview.revision, confirmation: '确认批量排课' } })).status()).toBe(409);
  expect((await lessonContext(request,'source')).items).toEqual(before.items);
  const good = { request_id: uniqueLoginId('stale'), items: [input.items[0]] }, ready = await post(request,url + '/preview',good,f.u.a);
  await post(request,f.lp.source,{ title: '改变预览版本', starts_at: day(4), ends_at: day(4,11) },f.admin);
  expect((await request.post(url,{ headers: headers(f.u.a), data: { ...good, expected_revision: ready.revision, confirmation: '确认批量排课' } })).status()).toBe(409);
  for (const actor of [f.u.student,f.u.outsider]) expect((await request.post(url + '/preview',{ headers: headers(actor), data: good })).status()).toBe(403);
});

test('转班保留历史和账户，显式加入目标未来课，原班空课取消，重复提交不重复变更', async ({ request }) => {
  // Target has a different teacher and learner; the source's moved learner is its only attendee.
  const target = await post(request,f.lp.target,{ title: '目标已排课程', starts_at: day(1), ends_at: day(1,11), student_ids: [f.u.second.user_id] },f.admin);
  await post(request,`/api/v1/institution/organizations/${f.oid}/followups`,{ student_id: f.u.student.user_id, owner_id: f.u.a.user_id, text: '转班需交接的跟进', status: 'pending' },f.admin);
  const input = relation('transfer','student',{ target_group_id: f.groups.target.learning_group_id, include_target_lessons: true, followup_owner_id: f.u.b.user_id });
  const noOwner = await post(request,endpoint('source','relationship-change') + '/preview',{ ...input, followup_owner_id: '' },f.u.manager);
  expect(noOwner.can_commit).toBe(false); expect(noOwner.blockers.join('')).toContain('接任负责人');
  const before = await lessonContext(request,'source'), url = endpoint('source','relationship-change'), preview = await post(request,url + '/preview',input,f.u.manager);
  expect(preview.can_commit, JSON.stringify(preview)).toBe(true); expect(preview.affected_lessons.length).toBeGreaterThanOrEqual(4); expect(preview.account_balances[0].remaining_lessons).toBe(20);
  expect((await lessonContext(request,'source')).items).toEqual(before.items);
  const body = { ...input, expected_revision: preview.revision, confirmation: '确认变更授课关系', reauth_password: '' };
  await post(request,url,body,f.u.manager); expect((await post(request,url,body,f.u.manager)).replayed).toBe(true);
  const followups = await data(await request.get(`/api/v1/institution/organizations/${f.oid}/followups`,{ headers: headers(f.admin) }));
  expect(followups.items.find(row => row.text === '转班需交接的跟进').owner_id).toBe(f.u.b.user_id);
  const source = await lessonContext(request,'source'); expect(source.items.find(row => row.lesson_id === f.original.lesson_id).attendance).toEqual(before.items.find(row => row.lesson_id === f.original.lesson_id).attendance);
  expect(source.items.filter(row => row.title.startsWith('周课')).every(row => row.status === 'cancelled')).toBe(true);
  const next = await lessonContext(request,'target'); expect(next.items.find(row => row.lesson_id === target.lesson_id).student_ids).toContain(f.u.student.user_id);
  const mine = await data(await request.get('/api/v1/me/courses',{ headers: headers(f.u.student) }));
  expect(mine.lessons.some(row => row.lesson_id === f.original.lesson_id)).toBe(true); expect(mine.groups.some(row => row.group_id === f.groups.source.learning_group_id)).toBe(false);
  expect(mine.course_packages.find(row => row.course_package_id === f.account.course_package_id).remaining_lessons).toBe(20);
});

test('换教师检查新教师冲突，转交班级跟进，历史任课人不被改写', async ({ request }) => {
  const next = await post(request,f.lp.source,{ title: '更换教师的未来课', starts_at: day(20), ends_at: day(20,11), student_ids: [f.u.second.user_id] },f.admin);
  const conflict = await post(request,f.lp.conflict,{ title: '接任教师冲突课', starts_at: day(20), ends_at: day(20,11), student_ids: [f.u.pending.user_id] },f.admin);
  await post(request,`/api/v1/institution/organizations/${f.oid}/followups`,{ student_id: f.u.second.user_id, owner_id: f.u.a.user_id, text: '需要移交的班级跟进', status: 'pending' },f.admin);
  const input = relation('replace_teacher','a',{ replacement_id: f.u.c.user_id });
  const blocked = await post(request,endpoint('source','relationship-change') + '/preview',input,f.u.manager);
  expect(blocked.can_commit).toBe(false); expect(blocked.blockers.join('')).toContain('已有课程');
  await post(request,f.lp.conflict,{ ...conflict, status: 'cancelled' },f.admin);
  const result = await planCommit(request,'source','relationship-change',input); expect(result.followups_transferred).toBe(1);
  const source = await lessonContext(request,'source'); expect(source.group.enrollments.find(row => row.user_id === f.u.a.user_id).status).toBe('inactive');
  expect(source.items.find(row => row.lesson_id === f.original.lesson_id).teacher_ids).toContain(f.u.a.user_id);
  expect(source.items.find(row => row.lesson_id === next.lesson_id).teacher_ids).toContain(f.u.c.user_id);
  expect((await request.get(f.lp.source,{ headers: headers(f.u.a) })).status()).toBe(403);
  expect((await request.get(f.lp.source,{ headers: headers(f.u.c) })).ok()).toBe(true);
});

test('未完作业和未交接职员明确阻断，旧停用接口不能绕过，越权不得变更', async ({ request }) => {
  const url = endpoint('pending','relationship-change'), input = relation('leave','pending');
  const before = await lessonContext(request,'pending'), preview = await post(request,url + '/preview',input,f.u.manager);
  expect(preview.can_commit).toBe(false); expect(preview.pending_assignments).toHaveLength(1);
  expect((await request.post(url,{ headers: headers(f.u.manager), data: { ...input, expected_revision: preview.revision, confirmation: '确认变更授课关系', reauth_password: '' } })).status()).toBe(409);
  expect((await lessonContext(request,'pending')).group).toEqual(before.group);
  const base = `/api/v1/organizations/${f.oid}/learning-groups/${f.groups.pending.learning_group_id}/enrollments`;
  expect((await request.post(base,{ headers: headers(f.admin), data: { user_id: f.u.pending.user_id, role: 'student', status: 'inactive' } })).status()).toBe(409);
  expect((await request.delete(`/api/v1/organizations/${f.oid}/members/${f.u.a.user_id}`,{ headers: headers(f.admin), data: { confirmation: '确认移除机构成员', reauth_password: '' } })).status()).toBe(409);
  for (const actor of [f.u.a,f.u.student,f.u.outsider]) expect((await request.post(url + '/preview',{ headers: headers(actor), data: input })).status()).toBe(403);
});

test('人员变更和周课在原页面预览，修改条件使旧预览失效，失败保留表单，窄屏可用', async ({ page }) => {
  await page.route('**/__planning_ui__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><link rel="stylesheet" href="/static/styles/institution-workflow.css"><style>body{margin:0;padding:12px;font-family:Arial}main{max-width:1000px;margin:auto}*{box-sizing:border-box}</style><div id="platform-admin-shell" data-learning-role="orgAdmin"><main></main></div>' }));
  await page.goto('/__planning_ui__');
  await page.evaluate(async f => {
    window.APIClient = { request: async (url, options={}) => { const response = await fetch('/api/v1' + url,{ ...options, headers: { Authorization: 'Bearer ' + f.u.manager.token, 'Content-Type': 'application/json' } }); const body = await response.json(); if (!response.ok) throw new Error(body.message); return body.data; } };
    const mod = await import('/static/app/viewer/personalCenter/institutionWorkflow.js'); const root = document.querySelector('main'); root.innerHTML = mod.renderInstitutionFlow('lessons',f.oid,f.groups.target.learning_group_id);
    mod.bindInstitutionFlows(root,{ owner: f.u.manager.user_id, token: f.u.manager.token, orgId: f.oid, changed: () => {}, confirm: async () => true, password: async () => '' });
  },f);
  await page.getByRole('button',{ name: '按周重复排课' }).click();
  const form = page.locator('[data-planning-form]');
  await form.locator('[name=title]').fill('周课页面验收'); await form.locator('[name=starts_at]').fill('2038-12-01T10:00'); await form.locator('[name=ends_at]').fill('2038-12-01T11:00'); await form.locator('[name=count]').fill('2');
  await form.getByRole('button',{ name: '预览排课' }).click(); await expect(form.locator('[data-planning-commit]')).toBeVisible();
  await form.locator('[name=count]').fill('3'); await expect(form.locator('[data-planning-commit]')).toHaveCount(0);
  await form.getByRole('button',{ name: '预览排课' }).click();
  let fail = true; await page.route('**/lesson-batch',async route => { if (fail) { fail=false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '临时失败，请重试' }) }); } else await route.continue(); });
  await form.locator('[data-planning-commit]').click(); await expect(form.getByRole('alert')).toContainText('临时失败'); await expect(form.locator('[name=title]')).toHaveValue('周课页面验收'); await expect(form.locator('[data-planning-commit]')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 950 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'tmp/teaching-lifecycle-20261028/planning-mobile-dark.png', fullPage: true });
  await form.locator('[data-planning-commit]').click(); await expect(page.locator('[data-planning-form]')).toHaveCount(0);
  await page.getByRole('button',{ name: '人员变更' }).click(); await page.locator('[name=reason]').fill('页面变更预览'); await page.getByRole('button',{ name: '预览变更影响' }).click(); await expect(page.locator('[data-planning-preview]')).toContainText('影响预览');
});

test('离班后可查自己的原班作业与新评语，不能被退回到已失去入口的作业', async ({ request }) => {
  await post(request,`/api/v1/assignments/${f.assignment.assignment_id}/submit`,{ answers: { '0:1': '1' }, submission_id: uniqueLoginId('oldclass') },f.u.pending);
  await planCommit(request,'pending','relationship-change',relation('leave','pending'));
  const review = `/api/v1/assignments/${f.assignment.assignment_id}/submissions/${f.u.pending.user_id}/review`;
  expect((await request.post(review,{ headers: headers(f.admin), data: { action: 'returned', comment: '离班后不应退回' } })).status()).toBe(409);
  await post(request,review,{ action: 'reviewed', comment: '保留在原班的老师评语', manual_score: 80 },f.admin);
  const mine = await data(await request.get('/api/v1/me/courses',{ headers: headers(f.u.pending) }));
  expect(mine.past_assignments).toHaveLength(1); expect(mine.past_assignments[0].teacher_comment).toBe('保留在原班的老师评语');
  const other = await data(await request.get('/api/v1/me/courses',{ headers: headers(f.u.student) })); expect(JSON.stringify(other)).not.toContain('保留在原班的老师评语');
});

test('复制作业只沿用标题与精确题目，清除旧截止时间和定向名单', async ({ page, request }) => {
  const source = await post(request,`/api/v1/organizations/${f.oid}/learning-groups/${f.groups.target.learning_group_id}/assignments`,{ title: '定向旧作业', exam_id: 'N3_2010_07', question_ids: ['0:1','0:3'], target_student_ids: [f.u.second.user_id], due_at: '2039-01-01T00:00:00Z' },f.admin);
  await page.route('**/__copy_ui__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main></main>' })); await page.goto('/__copy_ui__');
  await page.evaluate(async f => {
    const call = async (url,body) => { const response = await fetch('/api/v1' + url,{ method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + f.u.manager.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const result = await response.json(); if (!response.ok) throw new Error(result.message); return result.data; };
    window.APIClient = { request: url => call(url), getExams: async () => [{ id: 'N3_2010_07', title: 'N3 测试卷' }], getExam: id => call('/exams/' + id), createLearningGroupAssignment: (org,group,body) => call('/organizations/' + org + '/learning-groups/' + group + '/assignments',body) };
    const mod = await import('/static/app/viewer/personalCenter/teaching.js'); const root = document.querySelector('main');
    const input = { owner: f.u.manager.user_id, kind: 'assignment', organizations: [{ organization_id: f.oid, name: '验收机构' }], groups: [{ ...f.groups.target, organization_id: f.oid }] };
    const render = () => { root.innerHTML = mod.renderTeachingComposer(input); mod.bindTeachingComposer(root,{ token: f.u.manager.token, render, isCurrent: () => true, saved: async (_,id) => { window.savedAssignment = id; } }); }; render();
  },f);
  await expect(page.getByRole('button',{ name: '复制本班上次作业' })).toBeEnabled(); await page.getByRole('button',{ name: '复制本班上次作业' }).click();
  await expect(page.locator('[name=title]')).toHaveValue('定向旧作业（副本）'); await expect(page.locator('[name=due]')).toHaveValue('');
  await expect(page.locator('[data-teaching-summary]')).toContainText('沿用上次作业 2 题');
  await page.getByRole('button',{ name: '布置作业', exact: true }).click(); await page.waitForFunction(() => window.savedAssignment);
  const saved = await data(await request.get('/api/v1/assignments/' + await page.evaluate(() => window.savedAssignment),{ headers: headers(f.admin) }));
  expect(saved.question_ids).toEqual(source.question_ids); expect(saved.target_student_ids).toBeUndefined(); expect(saved.due_at || '').toBe(''); expect(saved.submissions).toEqual({});
});
