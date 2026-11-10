const {test,expect}=require('@playwright/test');
test('手机用户列表保持舒适行高，分页与搜索可滚动访问',async({page},info)=>{
 await page.route('**/__user_ten_fit__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" class="pc-platform-admin-open" data-learning-role="superAdmin"><header class="pc-platform-topbar"></header><aside class="pc-platform-sidebar"></aside><div class="pc-platform-workspace"><main class="pc-platform-admin-content"><div class="pc-workspace-page-heading"><h1>用户与权限</h1><p>搜索账号并查看用户状态</p></div><nav class="pc-workspace-section-tabs"><button class="pc-workspace-section-tab active">用户管理</button><button class="pc-workspace-section-tab">角色权限</button></nav><div class="pc-dashboard pc-subpage"><div class="pc-subpage-head">隐藏的重复标题</div><section class="pc-user-directory" data-user-fit-page="true"><div class="pc-user-results"><ul class="pc-user-list"></ul><div class="pc-admin-list-pagination"><span>共2389人</span><form class="pc-admin-list-page-nav"><span class="pc-admin-list-page-stepper"><button class="pc-admin-list-page-arrow">‹</button><span>2 /239页</span><button class="pc-admin-list-page-arrow">›</button></span></form></div></div></section></div></main></div></div></body>`}));
 await page.setViewportSize({width:390,height:844});await page.goto('/__user_ten_fit__');
 await page.evaluate(async()=>{const m=await import('/static/app/viewer/personalCenter/userListPresentation.js'),s=await import('/static/app/viewer/personalCenter/userSearch.js');document.querySelector('.pc-user-list').innerHTML=Array.from({length:10},(_,i)=>m.renderUserListItem('student_resume_draft_long_username_'+i,'student_resume_draft_long_username_'+i,['学员'],'active','user:'+i)).join('');document.querySelector('.pc-user-directory').insertAdjacentHTML('beforeend',s.renderUserSearchForm('',false));});
 const main=page.locator('main'),search=page.locator('[data-platform-user-search-form]'),pager=page.locator('.pc-admin-list-pagination');
 for(const [width,height] of [[390,844],[414,896],[650,850],[390,760]]){
  await page.setViewportSize({width,height});
  await main.evaluate(e=>e.scrollTop=0);
  const title=await page.locator('h1').boundingBox(),first=await page.locator('.pc-user-entry').first().boundingBox(),last=await page.locator('.pc-user-entry').last().boundingBox(),p=await pager.boundingBox(),nav=await page.locator('.pc-admin-list-page-nav').boundingBox(),s=await search.boundingBox(),viewport=await main.boundingBox();
  expect(title.y).toBeGreaterThanOrEqual(0);expect(first.height).toBeGreaterThanOrEqual(44);expect(last.y+last.height).toBeLessThanOrEqual(p.y+1);expect(nav.x+nav.width).toBeLessThanOrEqual(p.x+p.width+1);expect(await pager.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await main.evaluate(e=>e.scrollTop=e.scrollHeight);
  await expect(pager).toBeInViewport();await expect(search).toBeInViewport();
 }
 await page.screenshot({path:info.outputPath('ten-rows-760px.png')});
 await page.setViewportSize({width:390,height:667});await expect(main).toBeVisible();await main.evaluate(e=>e.scrollTop=e.scrollHeight);await expect(search).toBeVisible();
});
