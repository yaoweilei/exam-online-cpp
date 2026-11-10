process.env.TABLET_AUDIT_FILE='expanded.json';
const {chromium}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const c=require('./capture.cjs');const {audit,fixture}=c;
const {navigateWorkspace}=require('../../tests/e2e/helpers/workspace-navigation');
let browser;const failures=[];
async function stage(s,id,label,action,options){try{if(action)await action();await audit.settle(s.page);await c.shot(s,id,label,options);}catch(e){failures.push({id,error:e.message.split('\n').slice(0,2).join(' ')});console.log('FAILED',id,failures.at(-1).error);}fs.writeFileSync(path.join(__dirname,'expanded-errors.json'),JSON.stringify(failures,null,2));}
async function nav(s,key){await s.page.keyboard.press('Escape');await navigateWorkspace(s.shell,key,s.role==='superAdmin');await audit.settle(s.page);}
async function click(s,selector){await s.page.locator(selector).first().click();await audit.settle(s.page);}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true});c.setBrowser(browser);
 const p=await c.enter('superAdmin','superadmin_demo');
 await nav(p,'users');await stage(p,'users-filter','用户筛选',()=>click(p,'.pc-floating-search-filters>summary'));
 await p.page.keyboard.press('Escape');await stage(p,'user-detail','用户详情',()=>click(p,'.pc-user-list>li button'));
 await nav(p,'organizations');await p.page.locator('[data-managed-org-query]').fill('手机布局审查学校');await p.page.locator('[data-managed-org-query]').press('Enter');await audit.settle(p.page);
 await stage(p,'organization-detail','机构详情',()=>click(p,'.pc-org-directory-list [role=listitem] button'));
 await stage(p,'organization-settings','机构详情设置',async()=>{await click(p,'.pc-org-detail-settings>summary');for(const el of await p.page.locator('.pc-org-detail-settings details').all())await el.evaluate(e=>e.open=true);});
 await nav(p,'pricing');await stage(p,'pricing-boundaries','个人定价断点补查',null,{modes:[{width:820,height:1180},{width:1180,height:820}]});
 await stage(p,'pricing-organization','机构定价',()=>p.shell.getByRole('tab',{name:'学校 / 教育机构',exact:true}).first().click());
 await nav(p,'payments');await stage(p,'payment-detail','平台订单详情',()=>click(p,'[data-intent^="openRoleContent:platform-payment-order:"]'));
 await nav(p,'content');await stage(p,'quality-detail','质检详情',()=>p.page.locator('.pc-content-workflow-inspection').first().evaluate(e=>e.open=true));
 await nav(p,'audit');await stage(p,'audit-detail','审计弹窗',()=>click(p,'[data-audit-detail]'));await p.context.close();
 const o=await c.enter('orgAdmin',fixture.accounts.orgAdmin);
 await audit.intent(o,'openRoleContent:org-members');await stage(o,'member-editor','机构成员展开',()=>click(o,'.pc-org-member-summary'));
 await audit.intent(o,'openRoleContent:org-course-accounts');await stage(o,'allocation','课时分配展开',()=>click(o,'[data-org-package-allocator]>summary'));
 await audit.intent(o,'openRoleContent:org-plan');await stage(o,'billing-purchase','机构购买报价',()=>click(o,'[data-org-billing-purchase]>summary'));
 await audit.intent(o,'openRoleContent:org-settings');await stage(o,'campus-edit','校区编辑',()=>click(o,'[data-org-campus-edit]'));
 await audit.intent(o,'openRoleContent:org-dashboard');await stage(o,'dashboard-open','机构看板全部展开',async()=>{for(const el of await o.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters)').all())await el.evaluate(e=>e.open=true);});await o.context.close();
 const t=await c.enter('teacher',fixture.accounts.teacher);
 await audit.intent(t,'openRoleContent:teacher-assign');await stage(t,'assignment-create','布置作业');
 await audit.intent(t,'openRoleContent:teacher-prep-new');await stage(t,'prep-form','备课表单');
 await audit.intent(t,'openRoleContent:teacher-review');await stage(t,'grading','作业批改',()=>click(t,'[data-intent^="openRoleContent:teacher-assignment:"]'));
 await audit.intent(t,`openRoleContent:teacher-group:${fixture.organizationId}:${fixture.groupId}`);await stage(t,'attendance','出勤结算',()=>click(t,'[data-flow-action=complete-lesson]'));
 await audit.intent(t,'openRoleContent:teacher-students');await stage(t,'student-profile','学生档案',()=>click(t,'[data-intent^="openRoleContent:teacher-student:"]'));await t.context.close();
 const a=await c.enter('assistant',fixture.accounts.assistant);await audit.intent(a,'openRoleContent:assistant-followup');await stage(a,'followup','学员跟进',()=>click(a,'[data-flow-action=select-student]'));await a.context.close();
 const s=await c.enter('student','superadmin_demo');await audit.intent(s,'openRoleContent:student-account-plan');await stage(s,'paid-order','个人订单展开',async()=>{await click(s,'[data-account-order-history-summary]');await click(s,'.pc-order-record>summary');});await s.context.close();
 const u=await c.enter('student','student_demo');await audit.intent(u,'openStudyGoal');await stage(u,'goal-editor','学习目标');
 await u.shell.locator('[data-platform-admin-account-menu]').click();await u.shell.locator('[data-platform-admin-account]').click();await stage(u,'profile','账号资料');
 await u.shell.locator('[data-platform-admin-account-menu]').click();await u.shell.locator('[data-platform-admin-security]').click();await stage(u,'security','账号安全');
 await audit.intent(u,'openRoleContent:student-account-coupons');await stage(u,'coupons-open','兑换和记录展开',async()=>{for(const el of await u.shell.locator('main details:not(.pc-admin-select)').all())await el.evaluate(e=>e.open=true);});
 await u.shell.locator('[data-global-messages]').click();await stage(u,'messages','消息中心');await u.context.close();
 await browser.close();
})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
