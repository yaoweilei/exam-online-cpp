const {test,expect}=require('@playwright/test');
const {loginApi,loginWithPassword,uniqueLoginId}=require('./helpers/session');
const {navigateWorkspace}=require('./helpers/workspace-navigation');
test.use({timezoneId:'Asia/Shanghai',actionTimeout:20000});
let f;
const auth=token=>({Authorization:`Bearer ${token}`});
async function data(r){const j=await r.json();expect(r.ok(),JSON.stringify(j)).toBe(true);return j.data;}
test.beforeAll(async({request})=>{
  const admin=await loginApi(request,'superadmin_demo');
  const tName=uniqueLoginId('teacher_complete'),sName=uniqueLoginId('student_complete'),otherName=uniqueLoginId('teacher_other');
  const t=await loginApi(request,tName),s=await loginApi(request,sName),other=await loginApi(request,otherName);
  const post=(url,body,token=admin.token)=>request.post(url,{headers:auth(token),data:body}).then(data);
  const org=await post('/api/v1/organizations',{name:'教学回归机构 A '+Date.now(),organization_type:'school',plan:'pro',seats:10});
  const orgB=await post('/api/v1/organizations',{name:'教学回归机构 B '+Date.now(),organization_type:'school',plan:'pro',seats:10});
  const oid=org.organization_id,bid=orgB.organization_id;
  for(const [orgId,user,role] of [[oid,t,'teacher'],[oid,s,'student'],[oid,other,'teacher'],[bid,t,'teacher']])
    await post(`/api/v1/organizations/${orgId}/members`,{user_id:user.user_id,roles:[role],confirmation:'确认修改机构成员',reauth_password:''});
  const group=await post(`/api/v1/organizations/${oid}/learning-groups`,{name:'我的授课组 A',subject:'japanese',type:'class',status:'active'});
  const groupB=await post(`/api/v1/organizations/${bid}/learning-groups`,{name:'我的授课组 B',subject:'japanese',type:'class',status:'active'});
  const gid=group.learning_group_id,bgid=groupB.learning_group_id;
  for(const [orgId,groupId,user,role] of [[oid,gid,t,'teacher'],[oid,gid,s,'student'],[bid,bgid,t,'teacher']])
    await post(`/api/v1/organizations/${orgId}/learning-groups/${groupId}/enrollments`,{user_id:user.user_id,role,status:'active'});
  f={tName,sName,t,s,other,oid,bid,gid,bgid};
});
async function nav(page,key){await navigateWorkspace(page.locator('#platform-admin-shell'),key);await page.waitForLoadState('networkidle');}
async function enter(page){await loginWithPassword(page,f.tName);await page.waitForLoadState('networkidle');await page.evaluate(()=>window.openPersonalCenter());const shell=page.locator('#platform-admin-shell');if(await shell.getAttribute('data-learning-role')!=='teacher'){await shell.locator('[data-platform-admin-account-menu]').click();await shell.locator('[data-role-workbench="teacher"]').click();}await nav(page,'openRoleContent:teacher-students');await nav(page,'__overview__');return shell;}
async function choosePaper(page,title){const form=page.locator('[data-teaching-composer]');await expect(form.locator('[name=exam] option[value="N3_2010_07"]')).toBeAttached();await form.locator('[name=exam]').selectOption('N3_2010_07');await expect(form.locator('[data-teaching-summary]')).toContainText('试卷共');await form.locator('[name=title]').fill(title);await form.locator('[name=start]').fill('1');await form.locator('[name=end]').fill('3');await expect(form.locator('[data-teaching-summary]')).toContainText('本次 3 题');return form;}
async function studentOpen(page,id){await page.evaluate(()=>window.navigateLearningWorkspace('openAssignments'));await expect(page.locator(`[data-intent="openAssignmentExam:${id}:N3_2010_07"]`)).toBeVisible();await page.locator(`[data-intent="openAssignmentExam:${id}:N3_2010_07"]`).click();await expect(page.locator('.task-nav .question-counter')).toContainText('/ 3');}
test('教师布置、学员暂存提交、教师退回、学员重提和批改闭环',async({page,browser,request},info)=>{
  test.setTimeout(240000);
  const shell=await enter(page);await nav(page,'openRoleContent:teacher-assign');
  const form=await choosePaper(page,'三题作业完整流程');
  await form.locator('[name=group]').selectOption(`${f.oid}:${f.gid}`);
  const createdResponse=page.waitForResponse(r=>r.url().endsWith(`/learning-groups/${f.gid}/assignments`)&&r.request().method()==='POST');
  await form.getByRole('button',{name:'布置作业',exact:true}).click();
  const assignment=await data(await createdResponse),id=assignment.assignment_id;
  expect(assignment.question_ids).toEqual(['0:1','0:2','0:3']);
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('三题作业完整流程');
  const context=await browser.newContext({baseURL:info.project.use.baseURL,timezoneId:'Asia/Shanghai',viewport:{width:1440,height:1000}});
  const student=await context.newPage();
  try{
    await loginWithPassword(student,f.sName);await student.waitForLoadState('networkidle');
    await studentOpen(student,id);
    await expect(student.locator('.specialty-confirm-answer')).toHaveCount(0);
    await student.locator('#current-question-container .option').nth(0).click();
    await student.locator('.task-nav .next-btn').click();
    await expect(student.locator('.task-nav .question-counter')).toContainText('2 / 3');
    await student.getByRole('button',{name:'学习首页',exact:true}).first().click();
    await student.reload({waitUntil:'networkidle'});
    await studentOpen(student,id);
    await expect(student.locator('.task-nav .question-counter')).toContainText('2 / 3');
    await student.locator('#current-question-container .option').nth(3).click();
    await student.locator('.task-nav .next-btn').click();
    await student.locator('#current-question-container .option').nth(0).click();
    await student.locator('.task-nav .next-btn').click();
    const confirm=student.getByRole('dialog').getByRole('button',{name:'提交作业',exact:true});await expect(confirm).toBeVisible();
    const submissionResponse=student.waitForResponse(r=>r.url().endsWith(`/assignments/${id}/submit`)&&r.request().method()==='POST');
    await confirm.click();const submitted=await data(await submissionResponse);
    expect(submitted.score.total_questions).toBe(3);expect(submitted.submission.attempt_no).toBe(1);
    await expect(student.locator('#exam-result-title')).toHaveText('作业已提交');
    const receipt=submitted.submission.submission_id;
    const replay=await data(await request.post(`/api/v1/assignments/${id}/submit`,{headers:auth(f.s.token),data:{answers:submitted.submission.answers,submission_id:receipt}}));
    expect(replay.submission.attempt_no).toBe(1);
    await student.locator('[data-specialty-home]').click();
    await studentOpen(student,id);await expect(student.locator('#specialty-question-feedback')).toContainText('作业已提交');
    await expect(student.locator('.task-nav .next-btn')).not.toHaveText('提交作业');
    await nav(page,'openRoleContent:teacher-review');
    await shell.locator(`[data-intent="openRoleContent:teacher-assignment:${id}"]`).click();
    let card=shell.locator(`[data-assignment-student="${f.s.user_id}"]`);await expect(card).toBeVisible();
    await card.locator('[data-submission-comment]').fill('请重新核对第 2 题');await card.locator('[data-review-action=returned]').click();
    await expect(card).toContainText('已退回重做');
    await nav(page,'openRoleContent:teacher-unsubmitted');
    await expect(shell.locator('.pc-platform-admin-content')).toContainText('三题作业完整流程');
    await expect(shell.locator('.pc-platform-admin-content')).toContainText('1 待重做');
    await student.evaluate(()=>window.navigateLearningWorkspace('openAssignments'));
    await expect(student.locator(`[data-intent="openAssignmentExam:${id}:N3_2010_07"]`)).toContainText('待重做');
    await studentOpen(student,id);await expect(student.locator('#specialty-question-feedback')).not.toContainText('作业已提交');
    for(let i=0;i<3;i++){await student.locator('#current-question-container .option').nth([0,3,0][i]).click();await student.locator('.task-nav .next-btn').click();}
    const response2=student.waitForResponse(r=>r.url().endsWith(`/assignments/${id}/submit`)&&r.request().method()==='POST');
    await student.getByRole('dialog').getByRole('button',{name:'提交作业',exact:true}).click();
    expect((await data(await response2)).submission.attempt_no).toBe(2);
    await expect(student.locator('#exam-result-title')).toHaveText('作业已提交');await student.locator('[data-specialty-home]').click();
    await nav(page,'openRoleContent:teacher-review');
    await shell.locator(`[data-intent="openRoleContent:teacher-assignment:${id}"]`).click();
    card=shell.locator(`[data-assignment-student="${f.s.user_id}"]`);await expect(card).toContainText('第 2 次');
    await card.locator('[data-submission-score]').fill('90');await card.getByRole('button',{name:'保存批改',exact:true}).click();await expect(card).toContainText('已批改');
    await shell.getByRole('button',{name:'刷新教学数据'}).click();await expect(shell.locator(`[data-assignment-student="${f.s.user_id}"]`)).toContainText('人工 90.0%');
    await student.evaluate(()=>window.navigateLearningWorkspace('openAssignments'));
    await expect(student.locator(`[data-intent="openAssignmentExam:${id}:N3_2010_07"]`)).toContainText('成绩：90%');
    await studentOpen(student,id);await expect(student.locator('#specialty-question-feedback')).toContainText('老师评分：90%');
    await nav(page,'openRoleContent:teacher-review');await expect(shell.locator('.pc-platform-admin-content')).toContainText('暂无需要处理的作业');await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('三题作业完整流程');
    await page.screenshot({path:info.outputPath('review-complete.png')});
  }finally{await context.close();}
});
test('新建、编辑备课、生成精确范围作业及越权编辑保护',async({page,request},info)=>{
  const shell=await enter(page);await nav(page,'openRoleContent:teacher-prep');
  await shell.getByRole('button',{name:'新建备课',exact:true}).click();
  const form=await choosePaper(page,'读音三题备课');await form.locator('[name=group]').selectOption(`${f.oid}:${f.gid}`);await form.locator('[name=focus]').fill('漢字読み');
  await expect(form.locator('[data-teaching-summary]')).toContainText('本次 3 题');
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/lesson-prep/plans')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'保存备课方案'}).click();const plan=await data(await savedResponse);
  expect(plan.question_set.map(q=>q.question_id)).toEqual(['0:1','0:2','0:3']);
  await expect(shell.locator('.pc-teaching-preview')).toContainText('包んで');
  await shell.getByRole('button',{name:'编辑方案'}).click();
  await expect(page.locator('[data-teaching-composer] [name=title]')).toHaveValue('读音三题备课');
  await expect(page.locator('[data-teaching-summary]')).toContainText('试卷共');
  await page.locator('[data-teaching-composer] [name=end]').fill('2');
  const editedResponse=page.waitForResponse(r=>r.url().endsWith('/lesson-prep/plans')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'保存备课方案'}).click();const edited=await data(await editedResponse);
  expect(edited.lesson_prep_id).toBe(plan.lesson_prep_id);expect(edited.created_at).toBe(plan.created_at);expect(edited.question_set).toHaveLength(2);
  const assignmentResponse=page.waitForResponse(r=>r.url().endsWith(`/learning-groups/${f.gid}/assignments`)&&r.request().method()==='POST');
  await shell.locator('[data-role-prep-create-assignment]').click();const created=await data(await assignmentResponse);expect(created.question_ids).toEqual(['0:1','0:2']);
  const foreign=await request.post('/api/v1/institution/lesson-prep/plans',{headers:auth(f.other.token),data:{org_id:f.oid,lesson_prep_id:plan.lesson_prep_id,exam_id:'N3_2010_07',title:'不允许覆盖',question_start:1,question_end:2}});
  expect(foreign.status()).toBe(403);
  await page.screenshot({path:info.outputPath('prep-assignment.png')});
});
test('教师风格、双主题、机构筛选、空状态和手机导航',async({page},info)=>{
  const shell=await enter(page);
  await expect(shell.locator('[data-platform-admin-display-toggle]')).toHaveCount(0);
  await expect(shell.locator('[aria-label="切换当前身份"]')).toHaveCount(0);
  const switchOrg=async(id)=>{
    await shell.locator('[data-platform-admin-account-menu]').click();
    const changed=page.waitForResponse(r=>r.url().endsWith('/api/v1/me/organization')&&r.request().method()==='PUT');
    await shell.getByLabel('切换所属机构').selectOption(id);await changed;
    await nav(page,'openRoleContent:teacher-groups');
  };
  await switchOrg(f.bid);
  await expect(shell.locator('.pc-platform-admin-content')).toContainText('我的授课组 B');await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('我的授课组 A');
  await switchOrg(f.oid);await expect(shell.locator('.pc-platform-admin-content')).toContainText('我的授课组 A');
  await expect(shell.locator('.pc-platform-admin-content')).not.toContainText('japanese');
  for(const mode of ['dark','light']){
    await shell.getByRole('button',{name:'显示主题',exact:true}).click();await shell.locator(`[data-theme-mode="${mode}"]`).click();
    await nav(page,'__overview__');
    await expect(shell.locator('.pc-platform-stat').first().locator('strong')).toHaveText('1');
    const colors=await shell.evaluate(e=>({bodyLight:document.body.classList.contains('light-theme'),text:getComputedStyle(e).color,card:getComputedStyle(e.querySelector('.pc-platform-stat')).backgroundColor}));
    expect(colors.bodyLight).toBe(mode==='light');if(mode==='dark'){expect(colors.card).not.toBe('rgb(255, 255, 255)');expect(colors.text).toBe('rgb(232, 230, 227)');}
    await expect(shell.getByRole('button',{name:'显示主题',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(`teacher-${mode}.png`)});
  }
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    const overflow=await shell.locator('.pc-platform-admin-content').evaluate(e=>e.scrollWidth-e.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  }
  await shell.locator('[data-platform-admin-nav-trigger]').click();await expect(shell.locator('.pc-platform-sidebar')).toBeVisible();
  await shell.locator('.pc-platform-sidebar').getByRole('button',{name:'学员管理',exact:true}).click();
  await nav(page,'openRoleContent:teacher-groups');await expect(shell.locator('.pc-platform-admin-content')).toContainText('我的授课组 A');
  await page.screenshot({path:info.outputPath('teacher-mobile.png')});
});

test('多身份账号通过头像切换教师与学员，主题入口恢复',async({page})=>{
  test.setTimeout(240000);
  await loginWithPassword(page,'superadmin_demo');await page.waitForLoadState('networkidle');await page.evaluate(()=>window.openPersonalCenter());
  const shell=page.locator('#platform-admin-shell');
  if(await shell.getAttribute('data-learning-role')!=='teacher'){
    await shell.locator('[data-platform-admin-account-menu]').click();await shell.locator('[data-role-workbench="teacher"]').click();
  }
  await expect(shell).toHaveAttribute('data-learning-role','teacher');await expect(shell.getByRole('button',{name:'显示主题',exact:true})).toBeVisible();
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.locator('[data-role-workbench="student"]').click();
  await expect(page.locator('#student-learning-home > header h1')).toHaveText('学习首页');
  await expect(page.locator('.ls-theme-control')).toHaveCount(1);
  await page.locator('.ls-theme-control').getByRole('button',{name:'显示主题',exact:true}).click();
  await page.locator('.ls-theme-control [data-theme-mode="dark"]').click();
  await expect(page.locator('body')).not.toHaveClass(/light-theme/);
});

test('创建失败保留输入，可重试；无匹配题目不保存',async({page,request})=>{
  await enter(page);await nav(page,'openRoleContent:teacher-assign');
  const form=await choosePaper(page,'失败后保留的作业');
  const assignmentUrl=`**/learning-groups/${f.gid}/assignments`;
  await form.locator('[name=group]').selectOption(`${f.oid}:${f.gid}`);
  await page.route(assignmentUrl,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE',message:'测试保存失败，请重试'})}));
  await form.getByRole('button',{name:'布置作业',exact:true}).click();
  await expect(form.locator('[data-teaching-error]')).toContainText('失败');
  await expect(form.locator('[name=title]')).toHaveValue('失败后保留的作业');
  await expect(form.locator('[name=end]')).toHaveValue('3');
  await page.unroute(assignmentUrl);
  const created=page.waitForResponse(r=>r.url().endsWith(`/learning-groups/${f.gid}/assignments`)&&r.request().method()==='POST');
  await form.getByRole('button',{name:'布置作业',exact:true}).click();expect((await data(await created)).title).toBe('失败后保留的作业');
  await nav(page,'openRoleContent:teacher-prep');await page.getByRole('button',{name:'新建备课',exact:true}).click();
  const prep=await choosePaper(page,'没有匹配的备课');await prep.locator('[name=focus]').fill('不存在的考点关键词');
  await expect(prep.locator('[data-teaching-summary]')).toContainText('本次 0 题');
  let saves=0;page.on('request',r=>{if(r.url().endsWith('/lesson-prep/plans')&&r.method()==='POST')saves++;});
  await prep.getByRole('button',{name:'保存备课方案'}).click();await expect(prep.locator('[data-teaching-error]')).toContainText('题目范围');expect(saves).toBe(0);
  const rejected=await request.post('/api/v1/institution/lesson-prep/plans',{headers:auth(f.t.token),data:{org_id:f.oid,learning_group_id:f.gid,exam_id:'N3_2010_07',title:'空范围',focus_keyword:'不存在的考点关键词'}});
  expect(rejected.status()).toBe(422);
});

test('作业提交失败保留答案，重试复用提交标识，部分作答如实显示未答数',async({page,request})=>{
  const assignment=await data(await request.post(`/api/v1/organizations/${f.oid}/learning-groups/${f.gid}/assignments`,{headers:auth(f.t.token),data:{title:'部分作答与重试',exam_id:'N3_2010_07',question_start:1,question_end:3,auto_reminder_enabled:false}}));
  const id=assignment.assignment_id;await loginWithPassword(page,f.sName);await page.waitForLoadState('networkidle');await studentOpen(page,id);
  await page.locator('#current-question-container .option').nth(0).click();
  let receipt;const url=`**/assignments/${id}/submit`;
  await page.route(url,route=>{receipt=route.request().postDataJSON().submission_id;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE',message:'测试提交失败，请重试'})});});
  await page.locator('.task-nav .exit-specialty-btn').click();await expect(page.getByRole('dialog')).toContainText('还有 2 题未作答');await page.getByRole('dialog').getByRole('button',{name:'提交作业',exact:true}).click();
  await expect(page.locator('.task-nav .exit-specialty-btn')).toBeEnabled();await expect(page.locator('#specialty-question-feedback')).toContainText('提交作业后可查看');
  await page.unroute(url);
  await page.locator('.task-nav .exit-specialty-btn').click();const submitted=page.waitForResponse(r=>r.url().endsWith(`/assignments/${id}/submit`)&&r.request().method()==='POST');
  await page.getByRole('dialog').getByRole('button',{name:'提交作业',exact:true}).click();const result=await data(await submitted);
  expect(result.submission.submission_id).toBe(receipt);expect(Object.keys(result.submission.answers)).toEqual(['0:1']);expect(result.score.unanswered_count).toBe(2);
  await expect(page.locator('#exam-result-panel')).toContainText('还有 2 题未独立作答');
});
