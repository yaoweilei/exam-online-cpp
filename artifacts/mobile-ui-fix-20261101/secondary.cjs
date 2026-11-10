process.env.MOBILE_AUDIT_OUTPUT=__dirname;process.env.MOBILE_AUDIT_FILE='secondary.json';
const {chromium}=require('@playwright/test');const audit=require('../mobile-ui-audit-2026-11-01/capture.cjs');const fixture=require('./fixture.json');
const fs=require('node:fs');const path=require('node:path');let browser;const failures=[];
async function enter(role,account){const s=await audit.enter(role,account);s.role=role;return s;}
async function shot(s,id,label,action){try{if(action)await action();await audit.settle(s.page);await audit.capture(s,id,label,{widths:[390,360,540]});}catch(e){failures.push({id,error:e.message.split('\n').slice(0,2).join(' ')});console.log('FAILED',id,failures.at(-1).error);}}
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
const o=await enter('orgAdmin',fixture.accounts.orgAdmin);
await audit.intent(o,'openRoleContent:org-members');await shot(o,'members-filter','机构成员筛选',()=>o.page.locator('.pc-floating-search-filters>summary').click());await o.page.keyboard.press('Escape');
await o.page.locator('[data-org-member-role][data-role-id=teacher]').click();await audit.settle(o.page);await shot(o,'member-editor','机构成员编辑',()=>o.page.locator('.pc-org-member-summary').first().click());
await audit.intent(o,'openRoleContent:org-plan');await shot(o,'billing-purchase','机构报价表单',()=>o.page.locator('[data-org-billing-purchase]>summary').click());
await audit.intent(o,'openRoleContent:org-settings');await shot(o,'campus-edit','校区编辑',()=>o.page.locator('[data-org-campus-edit]').first().click());
await audit.intent(o,'openRoleContent:org-course-accounts');await shot(o,'allocation-final','分配课时',()=>o.page.locator('[data-org-package-allocator]>summary').click());await o.context.close();
const t=await enter('teacher',fixture.accounts.teacher);
await audit.intent(t,'openRoleContent:teacher-prep-new');await shot(t,'prep-form','备课表单');
await audit.intent(t,'openRoleContent:teacher-review');await shot(t,'grading','作业批改',()=>t.page.locator('[data-intent^="openRoleContent:teacher-assignment:"]').first().click());
await audit.intent(t,`openRoleContent:teacher-group:${fixture.organizationId}:${fixture.groupId}`);await shot(t,'attendance','出勤结算',()=>t.page.locator('[data-flow-action=complete-lesson]').first().click());await t.context.close();
const a=await enter('assistant',fixture.accounts.assistant);await audit.intent(a,'openRoleContent:assistant-followup');await shot(a,'followup','学员跟进编辑',()=>a.page.locator('[data-flow-action=select-student]').first().click());await a.context.close();
const s=await enter('student','superadmin_demo');await audit.intent(s,'openRoleContent:student-account-plan');await shot(s,'paid-order','个人订单展开',async()=>{await s.page.locator('[data-account-order-history-summary]').click();await s.page.locator('.pc-order-record>summary').first().click();});await s.context.close();
const u=await enter('student','student_demo');await audit.intent(u,'openStudyGoal');await shot(u,'goal-editor','学习目标编辑');
await u.shell.locator('[data-platform-admin-account-menu]').click();await u.shell.locator('[data-platform-admin-account]').click();await shot(u,'profile-final','个人资料');
await u.shell.locator('[data-platform-admin-account-menu]').click();await u.shell.locator('[data-platform-admin-security]').click();await shot(u,'security-final','账号安全');await u.context.close();
const e=await enter('student','student_demo');e.role='exam';
const paper=require('../../data/paper/jlpt/n3/N3_2010_07.json');const si=paper.exam_info.sections.findIndex(s=>/listening|聴解|听力/.test(String(s.section_type||'')+' '+String(s.section_title||'')));const section=paper.exam_info.sections[si];const qi=String((section.questions||section.passages.flatMap(p=>p.questions))[0].id);
await shot(e,'listening-final','听力图片与音频工具',()=>e.page.evaluate(async({si,qi})=>{await window.examViewer.startSpecialtyPractice('听力布局检查',[{examId:'N3_2010_07',questionId:qi,sectionIndex:si}],false);window.closeLearningWorkspace();window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));},{si,qi}));await e.context.close();
const c=await browser.newContext({baseURL:'http://127.0.0.1:8124',viewport:{width:390,height:844}});const page=await c.newPage();await page.goto('/');await page.waitForFunction(()=>typeof window.__openLoginModal==='function');const guest={page,context:c,role:'public',account:'游客',errors:[]};
await shot(guest,'login-phone','手机验证码登录',()=>page.evaluate(()=>window.__openLoginModal()));await shot(guest,'login-password','手机密码登录',()=>page.locator('#login-modal [data-mode=password]:visible').click());await c.close();
fs.writeFileSync(path.join(__dirname,'secondary-errors.json'),JSON.stringify(failures,null,2));await browser.close();if(failures.length)process.exitCode=1;})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
