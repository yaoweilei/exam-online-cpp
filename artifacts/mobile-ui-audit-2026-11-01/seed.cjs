const { request } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const baseURL = 'http://127.0.0.1:8124';
const destination = path.join(__dirname, 'fixture.json');
(async () => {
  if (fs.existsSync(destination)) { console.log('Existing isolated fixture retained'); return; }
  const api = await request.newContext({ baseURL });
  const parse = async response => { const body = await response.json(); if (!response.ok()) throw Error(JSON.stringify(body)); return body.data; };
  const login = name => api.post('/api/v1/auth/login', { data: { username: name, password: '' } }).then(parse);
  const admin = await login('superadmin_demo');
  const post = (url, data, token = admin.token) => api.post(url, { data, headers: { Authorization: `Bearer ${token}` } }).then(parse);
  const names = { teacher: 'teacher_mobile_ui_20261101', assistant: 'assistant_mobile_ui_20261101', orgAdmin: 'student_mobile_ui_manager_20261101', orgContentAdmin: 'student_mobile_ui_content_20261101' };
  const users = {};
  for (const [role, name] of Object.entries(names)) users[role] = await login(name);
  const students = [];
  for (let i = 1; i <= 12; i++) students.push({ name: `student_mobile_ui_${String(i).padStart(2, '0')}_20261101`, ...await login(`student_mobile_ui_${String(i).padStart(2, '0')}_20261101`) });
  const organization = await post('/api/v1/organizations', { name: '手机布局审查学校 · 日语能力考试与留学课程中心', organization_type: 'school', plan: 'pro', seats: 30 });
  const oid = organization.organization_id;
  for (const [role, user] of Object.entries(users)) await post(`/api/v1/organizations/${oid}/members`, { user_id: user.user_id, roles: [role], confirmation: '确认修改机构成员', reauth_password: '' });
  for (const student of students) await post(`/api/v1/organizations/${oid}/members`, { user_id: student.user_id, roles: ['student'], confirmation: '确认修改机构成员', reauth_password: '' });
  const group = await post(`/api/v1/organizations/${oid}/learning-groups`, { name: 'JLPT N3 阅读与听力提高班 · 周末学习组', type: 'class', subject: 'japanese', status: 'active' });
  const gid = group.learning_group_id;
  for (const [role, user] of Object.entries(users).filter(([role]) => ['teacher', 'assistant'].includes(role))) await post(`/api/v1/organizations/${oid}/learning-groups/${gid}/enrollments`, { user_id: user.user_id, role, status: 'active' });
  for (const student of students) await post(`/api/v1/organizations/${oid}/learning-groups/${gid}/enrollments`, { user_id: student.user_id, role: 'student', status: 'active' });
  await post(`/api/v1/organizations/${oid}/campuses`, { name: '手机审查校区 · 日本语教学楼', address: '长地址与长文本布局检查，不是真实联系地址', status: 'active' });
  await post(`/api/v1/organizations/${oid}/course-packages`, { title: 'JLPT 阅读与听力完整课程 · 30 课时', record_type: 'template', subject: 'japanese', total_lessons: 30, status: 'active' });
  for (let index = 0; index < 4; index++) await post(`/api/v1/organizations/${oid}/course-packages`, { title: `手机审查课时账户 ${index + 1}`, record_type: 'assignment', student_id: students[index].user_id, total_lessons: 20, used_lessons: index * 5, status: 'active', expires_at: '2027-01-31T00:00:00Z' });
  // Re-login after membership changes so the server session contains the effective institution role.
  for (const role of Object.keys(users)) users[role] = await login(names[role]);
  const assignments = [];
  for (let index = 0; index < 3; index++) assignments.push(await post(`/api/v1/organizations/${oid}/learning-groups/${gid}/assignments`, { title: ['手机布局检查 · 待批改阅读作业', '手机布局检查 · 未提交听力作业', '手机布局检查 · 已批改专项练习'][index], exam_id: 'N3_2010_07', question_start: 1, question_end: 3, due_at: '2026-12-01T10:00:00Z', auto_reminder_enabled: false }, users.teacher.token));
  for (let index = 0; index < 2; index++) await post(`/api/v1/assignments/${assignments[index === 0 ? 0 : 2].assignment_id}/submit`, { answers: { '0:1': '1', '0:2': '2', '0:3': '1' } }, students[index].token);
  await post(`/api/v1/assignments/${assignments[2].assignment_id}/submissions/${students[1].user_id}/review`, { action: 'reviewed', manual_score: 85, comment: '布局检查评语：请注意长评语在手机端的换行和操作排列。' }, users.teacher.token);
  const lessons = [];
  for (const days of [-2, 1, 3]) {
    const start = new Date(Date.now() + days * 86400000); start.setUTCHours(7, 0, 0, 0);
    lessons.push(await post(`/api/v1/institution/organizations/${oid}/learning-groups/${gid}/lessons`, { title: `手机布局检查 · ${days < 0 ? '待结算课程' : '阅读与听力课程'}`, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600000).toISOString() }, users.teacher.token));
  }
  await post(`/api/v1/institution/organizations/${oid}/followups`, { student_id: students[0].user_id, owner_id: users.assistant.user_id, text: '手机布局检查：学习计划与课程安排沟通记录，检查较长内容的排版。', next_at: new Date(Date.now() + 86400000).toISOString() }, users.assistant.token);
  await post('/api/v1/institution/lesson-prep/plans', { org_id: oid, learning_group_id: gid, exam_id: 'N3_2010_07', title: '手机布局检查 · 阅读备课方案', limit: 3, question_ids: ['0:1', '0:2', '0:3'] }, users.teacher.token);
  const publicFixture = { organizationId: oid, groupId: gid, accounts: names, studentAccount: students[0].name, assignmentIds: assignments.map(a => a.assignment_id), lessonIds: lessons.map(l => l.lesson_id) };
  fs.writeFileSync(destination, JSON.stringify(publicFixture, null, 2));
  console.log('Isolated fixture: 17 members, 12 learners, 3 assignments, 3 lessons, 5 packages');
  await api.dispose();
})().catch(error => { console.error(error.stack); process.exit(1); });
