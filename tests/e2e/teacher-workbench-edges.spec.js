const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {loginWithPassword}=require('./helpers/session');
const fixturePath=process.env.TEACHER_EDGE_FIXTURE;
test.skip(!fixturePath,'需要隔离服务中的旧版数据夹具');
test.use({timezoneId:'Asia/Shanghai',actionTimeout:20000});
let f;
const auth=t=>({Authorization:`Bearer ${t}`});
async function data(r){const j=await r.json();expect(r.ok(),JSON.stringify(j)).toBe(true);return j.data;}
test.beforeAll(async({},info)=>{expect(new URL(info.project.use.baseURL).port).not.toBe('8080');f=JSON.parse(fs.readFileSync(fixturePath,'utf8'));});
async function submit(request,id,answers=f.answers,receipt){return request.post(`/api/v1/assignments/${id}/submit`,{headers:auth(f.student.token),data:{answers,...(receipt?{submission_id:receipt}:{})}});}
async function review(request,id,action){return data(await request.post(`/api/v1/assignments/${id}/submissions/${f.student.user_id}/review`,{headers:auth(f.teacher.token),data:{action,comment:'边界回归评语',manual_score:85}}));}
function historyCount(){const root=f.dataRoot||path.join(path.dirname(fixturePath),'../teacher-user-audit-20261020/data');const dir=path.join(root,'user/answers',f.student.user_id,'_history/N3_2010_07');return fs.existsSync(dir)?fs.readdirSync(dir).length:0;}

test('旧版无标识提交只能重试同一答案；已批改不可覆盖，退回后才能重提',async({request})=>{
  const id=f.assignments.legacy.assignment_id;
  const first=await data(await submit(request,id));expect(first.submission.attempt_no).toBe(1);expect(first.submission.submission_id).toBeTruthy();
  const count=historyCount();
  expect((await data(await submit(request,id))).submission.submission_id).toBe(first.submission.submission_id);expect(historyCount()).toBe(count);
  const changed={...f.answers,'0:1':2};
  expect((await submit(request,id,changed)).status()).toBe(409);expect((await submit(request,id,f.answers,'another-receipt')) .status()).toBe(409);
  await review(request,id,'reviewed');
  const replay=await data(await submit(request,id));expect(replay.submission.manual_score).toBe(85);expect(replay.submission.review_status).toBe('reviewed');expect(replay.submission.attempt_no).toBe(1);expect(historyCount()).toBe(count);
  expect((await submit(request,id,changed)).status()).toBe(409);
  await review(request,id,'returned');
  const redo=await data(await submit(request,id,changed));expect(redo.submission.attempt_no).toBe(2);expect(redo.submission.submission_id).not.toBe(first.submission.submission_id);
  expect((await data(await submit(request,id,changed))).submission.attempt_no).toBe(2);expect(historyCount()).toBe(count+1);
  const historical=f.assignments.historical.assignment_id;
  const migrated=await data(await submit(request,historical));expect(migrated.submission.manual_score).toBe(85);expect(migrated.submission.teacher_comment).toBe('历史评语保留');expect(migrated.submission.attempt_no).toBe(1);expect(migrated.submission.submission_id).toBeTruthy();
  const migratedCount=historyCount();expect((await data(await submit(request,historical))).submission.submission_id).toBe(migrated.submission.submission_id);expect(historyCount()).toBe(migratedCount);
  expect((await submit(request,historical,changed)).status()).toBe(409);
});

test('催交包括退回重做，排除已交待批及已批改；重提后停止催交',async({request})=>{
  const id=f.assignments.reminder.assignment_id,url=`/api/v1/assignments/${id}/reminders`;
  const remind=async(key,student_ids)=>data(await request.post(url,{headers:auth(f.teacher.token),data:{message:'隔离账号催交测试',idempotency_key:key,...(student_ids?{student_ids}:{})}}));
  const first=await remind('edge-returned-once');expect(first.target_student_ids.sort()).toEqual([f.student.user_id,f.missing.user_id].sort());
  const repeat=await remind('edge-returned-once');expect(repeat.reminder_id).toBe(first.reminder_id);
  const own=await data(await request.get(`/api/v1/assignments/${id}`,{headers:auth(f.student.token)}));expect(own.own_reminders.some(x=>x.reminder_id===first.reminder_id)).toBe(true);
  await data(await submit(request,id));
  const next=await remind('edge-after-resubmit',[f.student.user_id,f.reviewed.user_id,f.missing.user_id]);expect(next.target_student_ids).toEqual([f.missing.user_id]);
});

test('旧20题方案标题更新保留原集合；离散题目不扩大，明确改范围才重选',async({request})=>{
  const save=async(plan,body)=>data(await request.post('/api/v1/institution/lesson-prep/plans',{headers:auth(f.teacher.token),data:{org_id:f.oid,lesson_prep_id:plan.lesson_prep_id,...body}}));
  const original=f.plans.api;
  const renamed=await save(original,{title:'标题修改仍20题',limit:500});expect(renamed.question_ids).toEqual(original.question_ids);expect(renamed.question_set).toHaveLength(20);expect(renamed.created_at).toBe(original.created_at);expect(renamed.learning_group_id).toBe(f.gid);
  const precise=await save(f.plans.precise,{title:'离散范围保留',limit:500});expect(precise.question_ids).toEqual(['0:1','0:3']);
  const changed=await save(original,{title:'主动改成三题',question_start:1,question_end:3,preserve_question_scope:false,limit:500});expect(changed.question_ids).toEqual(['0:1','0:2','0:3']);
});

async function edit(page,plan){await loginWithPassword(page,f.teacher.name);await page.waitForLoadState('networkidle');await page.evaluate(()=>window.openPersonalCenter());const shell=page.locator('#platform-admin-shell');await shell.locator('.pc-platform-sidebar [data-role-admin-intent="openRoleContent:teacher-prep"]').evaluate(e=>e.click());await shell.locator(`[data-intent="openRoleContent:teacher-prep:${plan.lesson_prep_id}"]`).click();await shell.getByRole('button',{name:'编辑方案'}).click();return page.locator('[data-teaching-composer]');}
async function saveForm(page,form){const response=page.waitForResponse(r=>r.url().endsWith('/lesson-prep/plans')&&r.request().method()==='POST');await form.getByRole('button',{name:'保存备课方案'}).click();return data(await response);}

test('编辑旧备课默认保留20题；改标题不改变题目或讲义设置',async({page})=>{
  const form=await edit(page,f.plans.ui);await expect(form.locator('[data-teaching-summary]')).toContainText('保留原方案 20 题');await form.locator('[name=title]').fill('只改标题的旧方案');const saved=await saveForm(page,form);expect(saved.question_ids).toEqual(f.plans.ui.question_ids);expect(saved.hide_answers).toBe(false);expect(saved.created_at).toBe(f.plans.ui.created_at);
  await page.getByRole('button',{name:'编辑方案'}).click();await page.locator('[data-teaching-reset-scope]').click();await page.locator('[name=start]').fill('1');await page.locator('[name=end]').fill('3');await expect(page.locator('[data-teaching-summary]')).toContainText('本次 3 题');expect((await saveForm(page,page.locator('[data-teaching-composer]'))).question_set).toHaveLength(3);
});

test('无法匹配的旧方案明确提示，重新选择后可恢复保存',async({page,request})=>{
  const rejected=await request.post('/api/v1/institution/lesson-prep/plans',{headers:auth(f.teacher.token),data:{org_id:f.oid,lesson_prep_id:f.plans.broken.lesson_prep_id,title:'不能默默扩展'}});expect(rejected.status()).toBe(422);
  const form=await edit(page,f.plans.broken);await expect(form.locator('[data-teaching-error]')).toContainText('原备课题目无法完整匹配');await form.getByRole('button',{name:'保存备课方案'}).click();await expect(form.locator('[data-teaching-error]')).toContainText('重新选择');
  await form.locator('[data-teaching-reset-scope]').click();await form.locator('[name=start]').fill('1');await form.locator('[name=end]').fill('2');expect((await saveForm(page,form)).question_ids).toEqual(['0:1','0:2']);
});
