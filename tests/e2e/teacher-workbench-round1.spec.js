const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, uniqueLoginId } = require('./helpers/session');
test.use({ timezoneId: 'Asia/Shanghai' });

let f;
async function data(response) {
  const json = await response.json();
  expect(response.ok(), JSON.stringify(json)).toBe(true);
  return json.data;
}
test.beforeAll(async ({ request }) => {
  const admin = await loginApi(request, 'superadmin_demo');
  const teacherName = uniqueLoginId('teacher_round1'), studentName = uniqueLoginId('student_round1');
  const teacher = await loginApi(request, teacherName), student = await loginApi(request, studentName);
  const auth = token => ({ Authorization: `Bearer ${token}` });
  const post = (url, body, token = admin.token) => request.post(url, { headers: auth(token), data: body }).then(data);
  const org = await post('/api/v1/organizations', { name: '教师首批回归 ' + Date.now(), organization_type: 'school', seats: 5 });
  const oid = org.organization_id;
  for (const [user, role] of [[teacher, 'teacher'], [student, 'student']])
    await post(`/api/v1/organizations/${oid}/members`, { user_id: user.user_id, roles: [role], confirmation: '确认修改机构成员', reauth_password: '' });
  const group = await post(`/api/v1/organizations/${oid}/learning-groups`, { name: '回归学习组', type: 'class', status: 'active', subject: 'japanese' });
  const gid = group.learning_group_id;
  for (const [user, role] of [[teacher, 'teacher'], [student, 'student']])
    await post(`/api/v1/organizations/${oid}/learning-groups/${gid}/enrollments`, { user_id: user.user_id, role, status: 'active' });
  const createUrl = `/api/v1/organizations/${oid}/learning-groups/${gid}/assignments`;
  const payload = { exam_id: 'N3_2010_07', question_start: 1, question_end: 3, auto_reminder_enabled: false };
  const assignment = await post(createUrl, { ...payload, title: '范围三题待批改' }, teacher.token);
  const empty = await post(createUrl, { ...payload, title: '独立未提交作业' }, teacher.token);
  f = { teacherName, studentName, teacher, student, oid, gid, assignment, empty, createUrl, payload, auth };
});
async function nav(page, key) {
  const button = page.locator(`#platform-admin-shell .pc-platform-sidebar [data-role-admin-intent="${key}"]`).first();
  await expect(button).toBeAttached(); await button.evaluate(e => e.click());
  await page.waitForLoadState('networkidle');
}
async function enter(page) {
  await loginWithPassword(page, f.teacherName);
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell'); await expect(shell).toBeVisible();
  if (await shell.getByLabel('切换当前身份').count()) await shell.getByLabel('切换当前身份').selectOption('teacher');
  await page.waitForLoadState('networkidle');
  await nav(page, 'openRoleContent:teacher-students'); await nav(page, '__overview__');
  return shell;
}
async function submit(request) {
  return data(await request.post(`/api/v1/assignments/${f.assignment.assignment_id}/submit`, {
    headers: f.auth(f.student.token), data: { answers: { '0:1': 1, '0:2': 2, '0:3': 1 } }
  }));
}
test('作业范围按整卷顺序解析，拒绝歧义和越界；未交作业不借用历史分数', async ({request}) => {
  expect(f.assignment.question_ids).toEqual(['0:1', '0:2', '0:3']);
  const result = await submit(request);
  expect(result.score.total_questions).toBe(3);
  expect(result.score.correct_count).toBe(2);
  expect(result.score.wrong_count).toBe(1);
  expect(result.score.unanswered_count).toBe(0);
  expect(result.score.score).toBeCloseTo(66.67, 2);
  for (const scope of [{ question_start: 999, question_end: 1000 }, { question_ids: ['1'] }, { question_ids: ['99:999'] }]) {
    const response = await request.post(f.createUrl, { headers: f.auth(f.teacher.token), data: { ...f.payload, title: '应拒绝范围', ...scope } });
    expect(response.status()).toBe(422);
  }
  const exam = await data(await request.get('/api/v1/exams/N3_2010_07', {headers:f.auth(f.teacher.token)}));
  const repeatedSection = exam.exam_info.sections.findIndex((s,i)=>i>0 && (s.questions?.length ? s.questions : (s.passages || []).flatMap(p=>p.questions || [])).some(q=>String(q.id)==='1'));
  expect(repeatedSection).toBeGreaterThan(0);
  const exactId = `${repeatedSection}:1`;
  const exact = await data(await request.post(f.createUrl, { headers: f.auth(f.teacher.token), data: { ...f.payload, title: '同号题精确范围', question_ids: [exactId] } }));
  expect(exact.question_ids).toEqual([exactId]);
  const changed = await data(await request.patch(`/api/v1/assignments/${exact.assignment_id}`, {
    headers:f.auth(f.teacher.token), data:{question_start:2,question_end:3}
  }));
  expect(changed.question_ids).toEqual(['0:2','0:3']);
  expect((await request.patch(`/api/v1/assignments/${exact.assignment_id}`, {
    headers:f.auth(f.teacher.token), data:{question_start:999,question_end:1000}
  })).status()).toBe(422);
  const book = await data(await request.get(`/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/gradebook`, {headers:f.auth(f.teacher.token)}));
  expect(book.assignments.find(a=>a.assignment_id===f.empty.assignment_id).average_score).toBe(-1);
  expect(book.assignments.find(a=>a.assignment_id===f.assignment.assignment_id).average_score).toBeCloseTo(66.67,2);
  const profile = await data(await request.get(`/api/v1/institution/students/${f.student.user_id}`,{headers:f.auth(f.teacher.token)}));
  expect(profile.wrong_trend[0].total_questions).toBe(3);
  expect(profile.listening_weaknesses.total_questions).toBe(0);
});
test('只含写作的有效作业保留待人工评分，不借用整卷成绩',async({request})=>{
  const exam=await data(await request.get('/api/v1/exams/2024_01',{headers:f.auth(f.teacher.token)}));
  const section=exam.exam_info.sections.findIndex(s=>s.section_type==='writing');
  expect(section).toBeGreaterThanOrEqual(0);
  const item=exam.exam_info.sections[section];
  const question=(item.questions?.length?item.questions:(item.passages||[]).flatMap(p=>p.questions||[]))[0];
  expect(question).toBeTruthy();
  const created=await data(await request.post(f.createUrl,{
    headers:f.auth(f.teacher.token),data:{exam_id:'2024_01',title:'写作人工批改回归',question_ids:[`${section}:${question.id}`],auto_reminder_enabled:false}
  }));
  const submitted=await data(await request.post(`/api/v1/assignments/${created.assignment_id}/submit`,{
    headers:f.auth(f.student.token),data:{answers:{[`${section}:${question.id}`]:'学習について。'}}
  }));
  expect(submitted.score.requires_manual_review).toBe(true);
  expect(submitted.score.total_questions).toBe(0);
  expect(submitted.score.score).toBe(-1);
});
test('排课本地时间正确；直接保存保留秒数；修改转换为 UTC', async({page,request},info)=>{
  const url = `/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/schedule`;
  const start='2026-11-01T02:00:45.123Z', end='2026-11-01T03:00:45.123Z';
  await data(await request.patch(url,{headers:f.auth(f.teacher.token),data:{starts_at:start,ends_at:end,status:'scheduled'}}));
  const s=await enter(page), c=s.locator('.pc-platform-admin-content');
  await nav(page,'openRoleContent:teacher-groups');
  await c.locator(`[data-intent="openRoleContent:teacher-group:${f.oid}:${f.gid}"]`).click();
  await expect(s.locator('[data-role-schedule-start]')).toHaveValue('2026-11-01T10:00');
  const save=async()=>{
    const response=page.waitForResponse(r=>r.url().endsWith(`/learning-groups/${f.gid}/schedule`)&&r.request().method()==='PATCH');
    await s.locator('[data-role-schedule-save]').click();
    const saved=await data(await response);
    await expect(s.locator('[data-role-schedule-save]')).toBeEnabled();
    return saved;
  };
  const unchanged=await save(); expect(unchanged.starts_at).toBe(start); expect(unchanged.ends_at).toBe(end);
  await s.locator('[data-role-schedule-start]').fill('2026-11-01T11:30');
  await s.locator('[data-role-schedule-end]').fill('2026-11-01T12:30');
  expect((await save()).starts_at).toBe('2026-11-01T03:30:00.000Z');
  await s.locator('[data-role-schedule-end]').fill('2026-11-01T10:30');
  await s.locator('[data-role-schedule-save]').click();
  await expect(page.getByText('结束时间必须晚于开始时间',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('schedule.png')});
});
test('未排课不计近期；未提交入口、批改待办和档案统计同步', async({page,request},info)=>{
  await submit(request);
  const url=`/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/schedule`;
  await data(await request.patch(url,{headers:f.auth(f.teacher.token),data:{starts_at:'',ends_at:'',status:'active'}}));
  const s=await enter(page), c=s.locator('.pc-platform-admin-content');
  await expect(c.locator('.pc-platform-task').filter({hasText:'近期课程'}).locator('b')).toHaveText('0');
  await c.locator('button').filter({hasText:'学员未提交'}).first().click();
  await expect(c).toContainText('独立未提交作业');
  await expect(c).not.toContainText('范围三题待批改');
  await nav(page,'openRoleContent:teacher-review');
  await c.locator(`[data-intent="openRoleContent:teacher-assignment:${f.assignment.assignment_id}"]`).click();
  let card=s.locator(`[data-assignment-student="${f.student.user_id}"]`);
  await expect(card).toBeVisible();
  await card.locator('[data-submission-score]').fill('85');
  await card.locator('[data-submission-comment]').fill('首批回归已批改');
  await card.locator('[data-review-action="reviewed"]').click();
  await expect(card).toContainText('已批改');
  await nav(page,'openRoleContent:teacher-review');
  await expect(c).not.toContainText('范围三题待批改');
  const book=await data(await request.get(`/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/gradebook`,{headers:f.auth(f.teacher.token)}));
  expect(book.assignments.find(a=>a.assignment_id===f.assignment.assignment_id).average_score).toBe(85);
  expect(book.assignments.find(a=>a.assignment_id===f.empty.assignment_id).average_score).toBe(-1);
  await nav(page,'openRoleContent:teacher-students');
  await c.locator(`[data-intent="openRoleContent:teacher-student:${f.student.user_id}"]`).click();
  await expect(c.locator('#pc-institution-detail')).toContainText('暂无独立作答数据');
  await expect(c).not.toContainText('/-1');
  await page.screenshot({path:info.outputPath('profile.png')});
});
test('近期课程只统计七天内未结束的有效课程', async({page,request})=>{
  const url=`/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/schedule`;
  const now=Date.now(), iso=offset=>new Date(now+offset*86400000).toISOString();
  const cases=[
    {starts_at:iso(1),ends_at:iso(1.05),status:'scheduled',count:'1'},
    {starts_at:iso(-.05),ends_at:iso(.05),status:'active',count:'1'},
    {starts_at:iso(-2),ends_at:iso(-1.95),status:'scheduled',count:'0'},
    {starts_at:iso(1),ends_at:iso(1.05),status:'cancelled',count:'0'},
    {starts_at:iso(1),ends_at:iso(1.05),status:'completed',count:'0'},
    {starts_at:iso(9),ends_at:iso(9.05),status:'scheduled',count:'0'}
  ];
  for(const {count,...body} of cases){
    await data(await request.patch(url,{headers:f.auth(f.teacher.token),data:body}));
    const s=await enter(page);
    await expect(s.locator('.pc-platform-admin-content .pc-platform-task').filter({hasText:'近期课程'}).locator('b')).toHaveText(count);
  }
});
