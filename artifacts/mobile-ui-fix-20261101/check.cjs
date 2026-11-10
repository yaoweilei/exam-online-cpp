process.env.MOBILE_AUDIT_OUTPUT=__dirname;
const {chromium}=require('@playwright/test');const audit=require('../mobile-ui-audit-2026-11-01/capture.cjs');
const fixture=require('../mobile-ui-audit-2026-11-01/fixture.json');const fs=require('node:fs');const path=require('node:path');
const {navigateWorkspace}=require('../../tests/e2e/helpers/workspace-navigation');
let browser;const checks=[];
async function state(role,account){const s=await audit.enter(role,account);s.role=role;return s;}
async function shot(s,key,label,action){if(action)await action();await audit.settle(s.page);const r=await audit.capture(s,key,label,{widths:[390,360,540]});checks.push({id:key,overflow:r.captures.map(c=>[c.width,c.metrics.mainOverflow])});}
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
const o=await state('orgAdmin',fixture.accounts.orgAdmin);
for(const key of ['org-course-packages','org-course-accounts','org-members','org-permissions','org-plan','org-settings','org-groups']){
await audit.intent(o,'openRoleContent:'+key);await shot(o,key,key);
if(key==='org-course-accounts'){await shot(o,'allocation','分配课时',()=>o.page.locator('[data-org-package-allocator]>summary').click());await o.page.locator('[data-org-package-allocator]>summary').click();}
}
await audit.intent(o,'openRoleContent:org-dashboard');await shot(o,'org-dashboard','看板展开',async()=>{for(const el of await o.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters)').all())await el.evaluate(e=>e.open=true);});await o.context.close();
const p=await state('superAdmin','superadmin_demo');
await navigateWorkspace(p.shell,'content',true);await audit.settle(p.page);await shot(p,'quality','质检详情',async()=>{await p.page.locator('.pc-content-workflow-inspection').first().evaluate(e=>e.open=true);});
await navigateWorkspace(p.shell,'payments',true);await audit.settle(p.page);await shot(p,'payment-detail','订单详情',()=>p.page.locator('[data-intent^="openRoleContent:platform-payment-order:"]').first().click());await p.context.close();
const s=await state('student','student_demo');for(const key of ['openReviewWorkbench','openChapterPath','openLearningReport','openRoleContent:student-account-plan']){await audit.intent(s,key);await shot(s,key,key);}
await s.shell.locator('[data-platform-admin-account-menu]').click();await s.shell.locator('[data-platform-admin-account]').click();await shot(s,'profile','个人资料');await s.context.close();
fs.writeFileSync(path.join(__dirname,'checks.json'),JSON.stringify(checks,null,2));await browser.close();})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
