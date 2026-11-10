const {test,expect}=require('@playwright/test');
const {loginApi,uniqueLoginId}=require('./helpers/session');
const {navigateWorkspace}=require('./helpers/workspace-navigation');

test.use({timezoneId:'Asia/Shanghai',actionTimeout:15000});
const auth=token=>({Authorization:`Bearer ${token}`});
async function data(response){const body=await response.json();expect(response.ok(),JSON.stringify(body)).toBe(true);return body.data;}
let f;

// These staff accounts deliberately have only the student PLATFORM role.
// Their teaching/administration capabilities must come from verified memberships.
test.beforeAll(async({request},info)=>{
  expect(new URL(info.project.use.baseURL).port).not.toBe('8080');
  const admin=await loginApi(request,'superadmin_flow_fixes');
  const users={},names={};
  for(const role of ['teacher','assistant','orgAdmin','student','outsider']){
    names[role]=uniqueLoginId('student_membership_'+role);
    users[role]=await loginApi(request,names[role]);
    expect(users[role].roles).toEqual(['student']);
  }
  names.contentAdmin=uniqueLoginId('contentadmin_flow');users.contentAdmin=await loginApi(request,names.contentAdmin);
  const post=(url,body,token=admin.token)=>request.post(url,{headers:auth(token),data:body}).then(data);
  const createOrg=name=>post('/api/v1/organizations',{name,organization_type:'school',plan:'pro',seats:50});
  const a=await createOrg('流程验收机构 A '+Date.now()),b=await createOrg('流程验收机构 B '+Date.now()),c=await createOrg('不可访问机构 C '+Date.now());
  const oid=a.organization_id,bid=b.organization_id,cid=c.organization_id;
  for(const role of ['teacher','assistant','orgAdmin','student'])
    await post(`/api/v1/organizations/${oid}/members`,{user_id:users[role].user_id,roles:[role],confirmation:'确认修改机构成员',reauth_password:''});
  for(const [user,role] of [[users.teacher,'assistant'],[users.orgAdmin,'student']])
    await post(`/api/v1/organizations/${bid}/members`,{user_id:user.user_id,roles:[role],confirmation:'确认修改机构成员',reauth_password:''});
  await post(`/api/v1/organizations/${cid}/members`,{user_id:users.outsider.user_id,roles:['student'],confirmation:'确认修改机构成员',reauth_password:''});
  for(const role of Object.keys(users))users[role]=await loginApi(request,names[role]);
  const createGroup=(id,name,status='active')=>post(`/api/v1/organizations/${id}/learning-groups`,{name,subject:'japanese',type:'class',status});
  const group=await createGroup(oid,'授课组 A'),history=await createGroup(oid,'历史课程','completed'),noTime=await createGroup(oid,'尚未排时间'),hidden=await createGroup(oid,'未授课的班级'),groupB=await createGroup(bid,'授课组 B');
  const gid=group.learning_group_id;
  for(const g of [group,history,noTime])for(const role of ['teacher','assistant','student'])
    await post(`/api/v1/organizations/${oid}/learning-groups/${g.learning_group_id}/enrollments`,{user_id:users[role].user_id,role,status:'active'});
  await post(`/api/v1/organizations/${bid}/learning-groups/${groupB.learning_group_id}/enrollments`,{user_id:users.teacher.user_id,role:'assistant',status:'active'});
  const start=new Date(Date.now()+2*3600000).toISOString(),end=new Date(Date.now()+3*3600000).toISOString();
  for(const [g,starts_at,ends_at] of [[group,start,end],[history,'2020-01-01T00:00:00Z','2020-01-01T01:00:00Z']])
    await data(await request.patch(`/api/v1/institution/organizations/${oid}/learning-groups/${g.learning_group_id}/schedule`,{headers:auth(admin.token),data:{starts_at,ends_at,status:g===history?'completed':'scheduled'}}));
  const makeAssignment=(title,due_at)=>post(`/api/v1/organizations/${oid}/learning-groups/${gid}/assignments`,{exam_id:'N3_2010_07',title,due_at,question_start:1,question_end:1},users.teacher.token);
  const returned=await makeAssignment('需要退回重做','2099-12-31T00:00:00Z');
  await post(`/api/v1/assignments/${returned.assignment_id}/submit`,{answers:{'0:1':1}},users.student.token);
  await post(`/api/v1/assignments/${returned.assignment_id}/submissions/${users.student.user_id}/review`,{action:'returned',comment:'请重新核对'},users.teacher.token);
  const future=await makeAssignment('未到期的正常作业','2099-12-31T00:00:00Z'),overdue=await makeAssignment('已经逾期的作业','2020-01-01T00:00:00Z');
  const expired=await post(`/api/v1/organizations/${oid}/course-packages`,{record_type:'template',title:'过期模板',subject:'japanese',total_lessons:10,status:'active',expires_at:'2020-01-01T00:00:00Z'},users.orgAdmin.token);
  const active=await post(`/api/v1/organizations/${oid}/course-packages`,{record_type:'template',title:'有效模板',subject:'japanese',total_lessons:10,status:'active',expires_at:'2099-12-31T00:00:00Z'},users.orgAdmin.token);
  for(let i=0;i<23;i++)await post('/api/v1/feedback',{paper_id:'N3_2010_07',question_id:'1',category:'analysis',description:'流程验收反馈 '+i},users.student.token);
  await post('/api/v1/admin/content/workflow/N2_2025_07/inspect',{},users.contentAdmin.token);
  for(const stage of ['analysis','secondary'])await data(await request.put(`/api/v1/admin/content/workflow/N2_2025_07/reviews/${stage}`,{headers:auth(users.contentAdmin.token),data:{status:'approved',note:'通过'}}));
  f={admin,users,names,oid,bid,cid,gid,groupB,hidden,returned,future,overdue,expired,active};
});

async function login(page,name){
  await loginApi(page.request,name);
  const ctx=await data(await page.request.get('/api/v1/me/context'));
  await page.addInitScript(user=>localStorage.setItem('exam_v2_user',JSON.stringify(user)),{...ctx.user,guest:false,token:'',profile:ctx.profile,membership:ctx.membership,memberships:ctx.memberships,organizations:ctx.organizations,permissions:ctx.permissions,subscription:ctx.subscription});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.getUserContext?.().username)).toBe(name);
  await page.waitForLoadState('networkidle');
}
async function enter(page,role){
  await login(page,role==='superAdmin'?'superadmin_flow_fixes':f.names[role]);
  await page.evaluate(()=>window.openPersonalCenter());
  const shell=page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    await shell.locator('.pc-role-identity-menu > summary').click();
    await shell.locator(`[data-role-workbench="${role}"]`).click();
  }
  await expect(shell).toHaveAttribute('data-learning-role',role);
  await page.waitForLoadState('networkidle');return shell;
}
async function nav(shell,key,platform=false){
  await navigateWorkspace(shell,key,platform);
}
const homeEntry = (shell, key) => shell.locator(`[data-role-overview] [data-role-admin-intent="openRoleContent:${key}"]`);

test('F01/F02 普通账号的机构身份无需资料 API 激活，且不放大到其他机构或平台权限',async({request})=>{
  for(const role of ['teacher','assistant','orgAdmin']){
    const headers=auth(f.users[role].token);
    const ctx=await data(await request.get('/api/v1/me/context',{headers}));
    expect(ctx.user.roles).toContain(role);expect(ctx.membership.scope_id).toBe(f.oid);
    const wb=await data(await request.get(`/api/v1/institution/workbench?org_id=${f.oid}`,{headers}));
    expect(wb.learning_groups.some(g=>g.learning_group_id===f.gid)).toBe(true);
    expect(wb.learning_groups.some(g=>g.learning_group_id===f.hidden.learning_group_id)).toBe(role==='orgAdmin');
    await data(await request.get(`/api/v1/institution/organizations/${f.oid}/learning-groups/${f.gid}/gradebook`,{headers}));
    expect((await request.get(`/api/v1/institution/workbench?org_id=${f.cid}`,{headers})).status()).toBe(403);
    expect((await request.get(`/api/v1/institution/students/${f.users.outsider.user_id}`,{headers})).status()).toBe(403);
    expect((await request.get('/api/v1/admin/statistics/overview',{headers})).status()).toBe(403);
  }
  const h=auth(f.users.orgAdmin.token);
  const users=await data(await request.get(`/api/v1/users/search?q=${f.names.student}&limit=5`,{headers:h}));
  expect(users.length).toBeGreaterThan(0);expect(users[0]).not.toHaveProperty('phone');expect(users[0]).not.toHaveProperty('email');
  expect((await request.get(`/api/v1/institution/workbench?org_id=${f.bid}`,{headers:h})).status()).toBe(403);
  expect((await request.get(`/api/v1/users/search?q=${f.names.student}`,{headers:auth(f.users.teacher.token)})).status()).toBe(403);
  expect((await request.put('/api/v1/me/organization',{headers:h,data:{organization_id:f.cid}})).status()).toBe(403);
  const logs=await data(await request.get(`/api/v1/admin/audit-logs?org_id=${f.cid}`,{headers:h}));
  expect(logs.total).toBeGreaterThan(0);expect(logs.items.every(item=>item.org_id===f.oid)).toBe(true);
  await data(await request.get(`/api/v1/admin/audit-logs/actions?org_id=${f.oid}`,{headers:h}));
  expect((await request.get('/api/v1/admin/audit-logs',{headers:auth(f.users.teacher.token)})).status()).toBe(403);
  const flagBody={confirmation:'确认修改机构开关',reauth_password:'',related_questions:{enabled:true}};
  await data(await request.put(`/api/v1/admin/feature-flags/orgs/${f.oid}`,{headers:h,data:flagBody}));
  expect((await request.put(`/api/v1/admin/feature-flags/orgs/${f.cid}`,{headers:h,data:flagBody})).status()).toBe(403);

});

test('F01 头像切换所属机构改变有效身份，刷新后仍是所选机构',async({page})=>{
  const shell=await enter(page,'teacher');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('exam_v2_user')));
  expect(stored.organizations.every(org=>!('audit_logs' in org)&&!('course_packages' in org))).toBe(true);
  await shell.locator('[data-platform-admin-account-menu]').click();
  await shell.getByLabel('切换所属机构').selectOption(f.bid);
  await expect.poll(async()=> (await data(await page.request.get('/api/v1/me/context'))).membership.scope_id).toBe(f.bid);
  await shell.locator('[data-platform-admin-account-menu]').click();
  await expect(shell.locator('[data-role-workbench="assistant"]')).toBeVisible();
  await expect(shell.locator('[data-role-workbench="teacher"]')).toHaveCount(0);
  await shell.locator('[data-role-workbench="assistant"]').click();
  await expect(shell.locator('main')).not.toContainText('需要教师');
  await page.reload({waitUntil:'networkidle'});
  expect((await data(await page.request.get('/api/v1/me/context'))).membership.scope_id).toBe(f.bid);
  // Leave the shared actor in A for later tests.
  await data(await page.request.put('/api/v1/me/organization',{data:{organization_id:f.oid}}));
});

test('F04/F05/F06/F07 教学管理员待办、日期过滤、详情标题与返回',async({page},info)=>{
  const shell=await enter(page,'assistant');
  await expect(homeEntry(shell, 'assistant-followup')).toContainText('3 人次待催交');
  await expect(homeEntry(shell, 'teacher-schedule')).toContainText('1 节近期课程');
  await expect(homeEntry(shell, 'assistant-alerts')).toHaveCount(0);
  await nav(shell,'openRoleContent:assistant-remind');
  await expect(shell.locator('main')).toContainText('需要退回重做');await expect(shell.locator('main')).toContainText('1 待重做');
  await nav(shell,'openRoleContent:assistant-alerts');
  await expect(shell.locator('main')).toContainText('已经逾期的作业');
  await expect(shell.locator('main')).not.toContainText('未到期的正常作业');await expect(shell.locator('main')).not.toContainText('需要退回重做');
  await shell.locator('[data-intent^="openRoleContent:teacher-assignment:"]').first().click();
  await expect(shell.locator('.pc-platform-sidebar [data-role-admin-intent="openRoleContent:assistant-followup"]')).toHaveClass(/active/);
  await shell.locator('[data-platform-admin-detail-back]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('学员跟进');
  await nav(shell,'openRoleContent:assistant-followup');
  await shell.locator('[data-institution-flow=followups] [data-flow-filter]').selectOption('all');
  await shell.locator('[data-intent^="openRoleContent:teacher-student:"]').first().click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toContainText('学员档案');
  await expect(shell.locator('.pc-platform-sidebar [data-role-admin-intent="openRoleContent:assistant-followup"]')).toHaveClass(/active/);
  await shell.locator('[data-platform-admin-detail-back]').click();
  await expect(shell.locator('.pc-workspace-page-heading h1')).toHaveText('学员跟进');
  await page.screenshot({path:info.outputPath('assistant-followup-return.png')});
});

test('F08 过期模板不算有效，列表标记一致并拒绝新分配',async({page,request})=>{
  const shell=await enter(page,'orgAdmin');
  await nav(shell,'openRoleContent:org-course-packages');
  const row=shell.locator('.pc-package-row').filter({hasText:'过期模板'});
  await expect(row).toContainText('已过期');await expect(row.getByRole('button',{name:'分配',exact:true})).toBeDisabled();
  const response=await request.post(`/api/v1/organizations/${f.oid}/course-packages`,{headers:auth(f.users.orgAdmin.token),data:{record_type:'assignment',student_id:f.users.student.user_id,template_id:f.expired.course_package_id,title:'不应分配',total_lessons:10}});
  expect(response.status()).toBe(409);
});

test('F03/F09 内容发布待办用真实审核字段，反馈汇总不受列表搜索和分页影响',async({page,request},info)=>{
  const shell=await enter(page,'contentAdmin');
  const h=auth(f.users.contentAdmin.token);
  const workflow=await data(await request.get('/api/v1/admin/content/workflow',{headers:h}));
  const expected=workflow.filter(x=>x.status!=='published'&&x.inspection?.passed===true&&x.reviews?.analysis?.status==='approved'&&x.reviews?.secondary?.status==='approved').length;
  expect(expected).toBeGreaterThan(0);await expect(homeEntry(shell, 'content-publish')).toContainText(`${expected} 项待发布`);
  const feedback=await data(await request.get('/api/v1/feedback?page=1&page_size=1',{headers:h}));
  const pending=feedback.summary.pending_total;expect(pending).toBeGreaterThan(20);
  await expect(homeEntry(shell, 'content-feedback')).toContainText(`${pending} 条待处理`);
  await nav(shell,'openRoleContent:content-publish');
  await expect(shell.locator('[data-content-workflow-action="publish"][data-exam-id="N2_2025_07"]')).toBeVisible();
  await nav(shell,'openRoleContent:content-feedback');
  await shell.locator('.pc-content-extra-filters > summary').click();
  const resized=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/feedback'&&new URL(r.url()).searchParams.get('page_size')==='10');
  await shell.locator('[data-platform-feedback-page-size]').selectOption('10');await resized;
  await shell.locator('[data-platform-feedback-query]').fill('不会匹配任何反馈的关键词');
  const filtered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/feedback'&&new URL(r.url()).searchParams.get('q')==='不会匹配任何反馈的关键词');
  await shell.locator('[data-platform-feedback-search-form]').getByRole('button',{name:'搜索',exact:true}).click();
  expect((await data(await filtered)).total).toBe(0);
  await nav(shell,'__overview__');await expect(homeEntry(shell, 'content-feedback')).toContainText(`${pending} 条待处理`);
  await page.screenshot({path:info.outputPath('content-summary-after-search.png')});
});

test('F09/F10 平台汇总读取当前仓库，新增账号机构即时计入，搜索不清空反馈待办',async({page,request})=>{
  const headers=auth(f.admin.token);
  const before=await data(await request.get('/api/v1/admin/statistics/overview',{headers}));
  await loginApi(request,uniqueLoginId('student_statistics'));
  const org=await data(await request.post('/api/v1/organizations',{headers,data:{name:'统计增量验收',organization_type:'school',plan:'pro',seats:10}}));
  const after=await data(await request.get('/api/v1/admin/statistics/overview',{headers}));
  expect(after.users.total).toBe(before.users.total+1);expect(after.organizations.total).toBe(before.organizations.total+1);
  const list=await data(await request.get('/api/v1/organizations?page=1&page_size=1',{headers}));expect(after.organizations.total).toBe(list.total);
  const shell=await enter(page,'superAdmin');
  const overviewValue = name => shell.locator(`[data-role-overview="superAdmin"] [data-platform-admin-page="${name}"] .pc-home-settings-value`);
  await expect(overviewValue('users')).toHaveText(`${after.users.total} 人`);
  await expect(overviewValue('organizations')).toHaveText(`${after.organizations.total} 家`);
  const summary=await data(await page.request.get('/api/v1/feedback?page_size=1'));
  await nav(shell,'feedback',true);await shell.locator('[data-platform-feedback-query]').fill('不会匹配任何反馈的关键词');
  const filtered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/feedback'&&new URL(r.url()).searchParams.get('q')==='不会匹配任何反馈的关键词');
  await shell.locator('[data-platform-feedback-search-form]').getByRole('button',{name:'搜索',exact:true}).click();await filtered;
  await nav(shell,'overview',true);
  await expect(overviewValue('feedback')).toHaveText(`${summary.summary.pending_total} 条待处理`);
});


test('F01/F02 移除机构身份后，旧会话及新登录都不能继续使用原机构权限',async({request})=>{
  const name=uniqueLoginId('student_revoked_membership'),actor=await loginApi(request,name),headers=auth(f.admin.token);
  await data(await request.post(`/api/v1/organizations/${f.oid}/members`,{headers,data:{user_id:actor.user_id,roles:['teacher'],confirmation:'确认修改机构成员',reauth_password:''}}));
  const current=await loginApi(request,name),h=auth(current.token);
  expect((await data(await request.get('/api/v1/me/context',{headers:h}))).permissions.roles).toContain('teacher');
  await data(await request.delete(`/api/v1/organizations/${f.oid}/members/${actor.user_id}`,{headers,data:{confirmation:'确认移除机构成员',reauth_password:''}}));
  expect((await request.get('/api/v1/me/context',{headers:h})).status()).toBe(401);
  const fresh=await loginApi(request,name),freshHeaders=auth(fresh.token);
  expect((await data(await request.get('/api/v1/me/context',{headers:freshHeaders}))).permissions.roles).not.toContain('teacher');
  expect((await request.get(`/api/v1/institution/workbench?org_id=${f.oid}`,{headers:freshHeaders})).status()).toBe(403);
  expect((await request.put('/api/v1/me/organization',{headers:freshHeaders,data:{organization_id:f.oid}})).status()).toBe(403);
});
