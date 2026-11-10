const {chromium,expect}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');
const audit=require('../mobile-ui-audit-2026-11-01/capture.cjs');const fixture=require('./fixture.json');
const {navigateWorkspace}=require('../../tests/e2e/helpers/workspace-navigation');
const results=[];let browser;
async function enter(role,account){const s=await audit.enter(role,account);s.role=role;return s;}
async function check(name,role,account,run){let s;try{s=await enter(role,account);await run(s);results.push({name,status:'passed'});console.log('PASS',name);}catch(e){results.push({name,status:'failed',error:e.message});console.log('FAIL',name,e.message.split('\n').slice(0,3).join(' '));if(s)await s.page.screenshot({path:path.join(__dirname,'failure-'+results.length+'.png')});}finally{await s?.context.close();fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(results,null,2));}}
async function bounded(s,selector){for(const width of[360,390,540]){await s.page.setViewportSize({width,height:844});await audit.settle(s.page);const values=await s.page.locator(selector).evaluateAll(es=>{const main=document.querySelector('.pc-platform-admin-content').getBoundingClientRect();return es.filter(e=>e.getBoundingClientRect().height>0).map(e=>{const r=e.getBoundingClientRect();return{left:r.left>=main.left-1,right:r.right<=main.right+1};});});expect(values.length).toBeGreaterThan(0);expect(values.every(x=>x.left&&x.right)).toBe(true);expect(await s.page.locator('.pc-platform-admin-content').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);}}
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
await check('课程记录操作无需横向滑动，分配弹窗单表面','orgAdmin',fixture.accounts.orgAdmin,async s=>{
 await audit.intent(s,'openRoleContent:org-course-packages');await bounded(s,'[data-org-package-view-template],[data-org-package-assign-template]');
 await s.page.locator('[data-org-package-assign-template]').first().click();await expect(s.page.locator('[data-org-package-allocator][open]')).toBeVisible();
 const title=s.page.locator('.pc-org-choice-head strong');expect(await title.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(30);
 await s.page.locator('[data-org-package-students=all]').click();await expect(s.page.locator('[data-org-package-selected-count]')).toContainText('12');
 await s.page.locator('[data-org-package-students=none]').click();await expect(s.page.locator('[data-org-package-selected-count]')).toContainText('0');
});
await check('机构成员默认10条、分页和筛选保持原表单归属','orgAdmin',fixture.accounts.orgAdmin,async s=>{
 await audit.intent(s,'openRoleContent:org-members');await expect(s.page.locator('.pc-org-member-editor')).toHaveCount(10);
 await s.page.locator('[data-org-member-list-page=next]').click();await audit.settle(s.page);await expect(s.page.locator('.pc-org-member-editor')).toHaveCount(2);
 await s.page.locator('.pc-floating-search-filters>summary').click();await s.page.locator('[data-org-member-list-page-size]').selectOption('20');await audit.settle(s.page);await expect(s.page.locator('.pc-org-member-editor')).toHaveCount(12);
 expect(await s.page.locator('[data-org-member-list-page-size]').evaluate(e=>e.closest('form').hasAttribute('data-org-member-list-form'))).toBe(true);
 await s.page.locator('.pc-org-member-summary').first().click();await expect(s.page.locator('.pc-org-member-editor[open] [data-org-member-remove]')).toHaveCount(1);await expect(s.page.locator('.pc-org-member-editor[open] [data-org-role][value=student]')).toBeChecked();
});
await check('机构看板长标题无内容区溢出','orgAdmin',fixture.accounts.orgAdmin,async s=>{
 await audit.intent(s,'openRoleContent:org-dashboard');for(const d of await s.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters)').all())await d.evaluate(e=>e.open=true);
 await bounded(s,'.pc-dashboard .pc-info-row');
});
await check('校区编辑默认折叠，新建与编辑正确带入字段','orgAdmin',fixture.accounts.orgAdmin,async s=>{
 await audit.intent(s,'openRoleContent:org-settings');expect(await s.page.locator('[data-org-campus-editor]').evaluate(e=>e.open)).toBe(false);
 await s.page.locator('[data-org-campus-edit]').first().click();await expect(s.page.locator('[data-org-campus-name]')).not.toHaveValue('');expect(await s.page.locator('[data-org-campus-id]').inputValue()).not.toBe('');
 await s.page.locator('[data-org-campus-new]').click();await expect(s.page.locator('[data-org-campus-name]')).toHaveValue('');await expect(s.page.locator('[data-org-campus-id]')).toHaveValue('');
});
await check('机构学习组进入独立详情并可以返回','orgAdmin',fixture.accounts.orgAdmin,async s=>{
 await audit.intent(s,'openRoleContent:org-groups');await s.page.locator('[data-org-learning-group-manage]').first().click();await audit.settle(s.page);await expect(s.page.locator('[data-flow-action=new-lesson]')).toBeVisible();
 const back=s.page.locator('[data-platform-admin-detail-back]:visible,[data-workspace-back]:visible').first();await back.click();await audit.settle(s.page);await expect(s.page.locator('[data-org-learning-group-manage]')).toBeVisible();
});
await check('订单详情业务字段、技术折叠与复制','superAdmin','superadmin_demo',async s=>{
 await s.context.grantPermissions(['clipboard-read','clipboard-write']);await navigateWorkspace(s.shell,'payments',true);await audit.settle(s.page);await s.page.locator('[data-intent^="openRoleContent:platform-payment-order:"]').first().click();await audit.settle(s.page);
 await expect(s.page.locator('.pc-payment-facts')).toContainText('支付方式');expect(await s.page.locator('.pc-payment-technical').evaluate(e=>e.open)).toBe(false);
 const button=s.page.locator('.pc-payment-reference [data-copy-text]');const value=await button.getAttribute('data-copy-text');await button.click();await expect(button).toHaveText('已复制');expect(await s.page.evaluate(()=>navigator.clipboard.readText())).toBe(value);
 await bounded(s,'.pc-payment-facts');
});
await check('质检路径完整可读且可复制','superAdmin','superadmin_demo',async s=>{
 await s.context.grantPermissions(['clipboard-read','clipboard-write']);await navigateWorkspace(s.shell,'content',true);await audit.settle(s.page);await s.page.locator('.pc-content-workflow-inspection').first().evaluate(e=>e.open=true);await bounded(s,'.pc-quality-path');
 const button=s.page.locator('.pc-content-workflow-inspection [data-copy-text]').first();const value=await button.getAttribute('data-copy-text');await button.click();await expect(button).toHaveText('已复制');expect(await s.page.evaluate(()=>navigator.clipboard.readText())).toBe(value);
});
await check('桌面手机预览使用容器宽度的窄屏布局','superAdmin','superadmin_demo',async s=>{
 await s.page.setViewportSize({width:1440,height:1000});await navigateWorkspace(s.shell,'payments',true);await audit.settle(s.page);await s.shell.evaluate(el=>{el.style.width='540px';el.style.maxWidth='540px';el.classList.add('pc-platform-admin-mobile-preview');});
 expect(await s.shell.locator('.pc-workspace-page-heading h1').evaluate(e=>getComputedStyle(e).fontSize)).toBe('18px');expect(await s.page.locator('.pc-platform-admin-content').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
});
await check('出勤结算独立编辑、逐人展开，取消返回课次','teacher',fixture.accounts.teacher,async s=>{
 await audit.intent(s,`openRoleContent:teacher-group:${fixture.organizationId}:${fixture.groupId}`);await s.page.locator('[data-flow-action=complete-lesson]').first().click();await expect(s.page.locator('.pc-attendance-person')).toHaveCount(12);await expect(s.page.locator('[data-flow-action=complete-lesson]')).toHaveCount(0);
 const person=s.page.locator('.pc-attendance-person').first();await person.locator('summary').click();await person.locator('[data-attendance-status]').selectOption('absent');await expect(person.locator('[data-attendance-charge]')).toHaveValue('0');await expect(person.locator('[data-attendance-summary]')).toContainText('缺席');
 await s.page.locator('[data-flow-action=cancel-lesson]').click();await expect(s.page.locator('.pc-attendance-person')).toHaveCount(0);await expect(s.page.locator('[data-flow-action=complete-lesson]').first()).toBeVisible();
});
await check('作业/备课高级题序默认收拢且参与表单数据','teacher',fixture.accounts.teacher,async s=>{
 await audit.intent(s,'openRoleContent:teacher-prep-new');await expect(s.page.locator('[name=start]')).not.toBeVisible();await s.page.locator('.pc-teaching-scope>summary').click();await s.page.locator('[name=start]').fill('1');await s.page.locator('[name=end]').fill('2');expect(await s.page.locator('[data-teaching-composer]').evaluate(e=>Object.fromEntries(new FormData(e)))).toMatchObject({start:'1',end:'2'});
});
await check('账号资料/安全留在工作台，头像按需展开','student','student_demo',async s=>{
 await s.shell.locator('[data-platform-admin-account-menu]').click();await s.shell.locator('[data-platform-admin-account]').click();await expect(s.page.locator('#pc-display-name-input')).toBeVisible();await expect(s.page.locator('.pc-avatar-style-grid')).not.toBeVisible();
 await s.shell.locator('[data-platform-admin-account-menu]').click();await s.shell.locator('[data-platform-admin-security]').click();await expect(s.shell).toHaveClass(/pc-platform-admin-open/);await expect(s.page.locator('#personal-center.pc-open')).toHaveCount(0);await bounded(s,'.pc-account-security-card,.pc-account-management-card,.pc-account-list');
});
await check('内容管理员业务页不重复首页指标','contentAdmin','contentadmin_demo',async s=>{
 await audit.intent(s,'openRoleContent:content-feedback');await expect(s.page.locator('.pc-content-overview-strip')).toHaveCount(0);await expect(s.page.locator('[data-platform-feedback-query]')).toBeVisible();
});
await browser.close();if(results.some(r=>r.status!=='passed'))process.exitCode=1;})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
