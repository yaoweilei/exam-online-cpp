const {test,expect}=require('@playwright/test');
test('运行提醒分页、筛选及手机深色不溢出',async({page},info)=>{
 await page.route('**/__reminder_layout_probe__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/institution-workflow.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><link rel="stylesheet" href="/static/styles/ios-grouped-workspace.css"><body class="light-theme"><div id="platform-admin-shell" class="pc-platform-admin-open" data-learning-role="superAdmin"><main style="max-width:1130px;margin:24px auto;padding:16px"><div class="pc-role-home"><section class="pc-platform-overview-panel pc-platform-tasks"><h2>待处理</h2><button class="pc-platform-task">待处理反馈 <b>83</b></button><div id="probe"></div></section></div></main></div></body>`}));
 await page.goto('/__reminder_layout_probe__');
 await page.evaluate(async()=>{
  const m=await import('/static/app/viewer/personalCenter/productImprovements.js');
  window.APIClient={request:async()=>({counts:{overdue_order:36,blocked_content:5,overdue_content:1},checks:[],items:Array.from({length:42},(_,i)=>({id:'long_order_identifier_'+i,title:i<36?'跨日未完成的支付订单，请核查是否仍需处理':'试卷发布流程待处理',type:i<36?'overdue_order':i<41?'blocked_content':'overdue_content',destination:'order',created_at:'2026-10-27T10:30:00Z'}))})};
  const root=document.querySelector('#probe');root.innerHTML=m.renderProductPanel('platform-operations');m.bindProductPanels(root,{owner:'layout-probe',token:'',orgId:'',current:()=>true,changed:()=>{},navigate:()=>{},password:async()=>null,confirm:async()=>false});
 });
 const panel=page.locator('[data-product-panel]'),filter=panel.getByLabel('筛选运行提醒');
 const rows=panel.locator('.pc-grouped-entry');
 await expect(filter).toBeVisible();
 await expect(rows).toHaveCount(20);
 await panel.getByRole('button',{name:'下一页'}).click();
 await expect(panel).toContainText('第 2/3 页');
 await filter.selectOption('blocked_content');
 await expect(rows).toHaveCount(5);
 await filter.selectOption('service_issue');
 await expect(rows).toHaveCount(0);
 await expect(panel).toContainText('当前条件下没有运行提醒');
 await filter.selectOption('all');
 await expect(rows).toHaveCount(20);
 const settings=panel.locator('.pc-platform-reminder-settings'),last=rows.last();expect((await settings.boundingBox()).y).toBeGreaterThan((await last.boundingBox()).y);
 await page.screenshot({path:info.outputPath('reminders-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.body.classList.remove('light-theme'));
 expect(await panel.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await expect(filter).toBeVisible();
 await settings.locator('summary').click();await expect(panel.locator('input[type=date]')).toBeVisible();
 await page.screenshot({path:info.outputPath('reminders-mobile-dark.png')});
});
