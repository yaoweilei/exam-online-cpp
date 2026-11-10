const {test,expect}=require('@playwright/test');
test('用户与权限切换真实不同内容时，标题、页签大小和内容起点保持一致',async({page})=>{
 await page.route('**/__user_role_tab_alignment__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" class="pc-platform-admin-open" data-learning-role="superAdmin"><header class="pc-platform-topbar"></header><aside class="pc-platform-sidebar"></aside><div class="pc-platform-workspace"><main class="pc-platform-admin-content"></main></div></div></body>'}));
 await page.goto('/__user_role_tab_alignment__');
 await page.evaluate(async()=>{
  const users=await import('/static/app/viewer/personalCenter/userListPresentation.js'),search=await import('/static/app/viewer/personalCenter/userSearch.js');
  window.switchTab=role=>{
   const shell=document.querySelector('#platform-admin-shell');shell.classList.toggle('pc-platform-users-active',!role);shell.classList.toggle('pc-platform-roles-active',role);
   const userBody='<section class="pc-user-directory" data-user-fit-page="true"><div class="pc-user-results"><ul class="pc-user-list">'+Array.from({length:10},(_,i)=>users.renderUserListItem('user_'+i,'user_'+i,['学员'],'active','user:'+i)).join('')+'</ul><div class="pc-admin-list-pagination">共10人</div></div>'+search.renderUserSearchForm('',false)+'</section>';
   const roleBody='<div class="pc-platform-role-layout"><label class="pc-platform-role-picker"><span>当前角色</span><select class="pc-profile-input"><option>教学管理员 · 6项</option></select></label><form class="pc-platform-role-editor pc-role-editor-compact">'+Array.from({length:6},(_,i)=>'<p>权限 '+i+'</p>').join('')+'</form></div>';
   document.querySelector('main').innerHTML='<div class="pc-workspace-page-heading"><h1>用户与权限</h1><p>'+(role?'全局角色模板与临时授权':'搜索账号并查看用户状态')+'</p></div><nav class="pc-workspace-section-tabs"><button class="pc-workspace-section-tab '+(!role?'active':'')+'">用户管理</button><button class="pc-workspace-section-tab '+(role?'active':'')+'">角色权限</button><button class="pc-workspace-section-tab">临时授权</button></nav><div class="pc-dashboard pc-dashboard-simple pc-subpage">'+(role?roleBody:userBody)+'</div>';
  };
 });
 await page.evaluate(()=>window.switchTab(false));
 await expect(page.locator('nav button')).toHaveCount(3);
 const geometry=()=>page.evaluate(()=>{
  const bounds=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight};};
  return {heading:bounds('.pc-workspace-page-heading'),title:bounds('h1'),tabs:bounds('nav'),first:bounds('nav button:first-child'),last:bounds('nav button:last-child'),content:bounds('.pc-user-results,.pc-platform-role-picker')};
 });
 for(const [width,height] of [[390,844],[650,850],[1440,1000],[390,667]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>window.switchTab(false));const users=await geometry();
  await page.evaluate(()=>window.switchTab(true));const roles=await geometry();
  for(const key of ['heading','title','tabs','first','last'])expect(roles[key],key).toEqual(users[key]);
  expect(Math.abs(roles.content.y-users.content.y)).toBeLessThanOrEqual(1);expect(Math.abs(roles.content.x-users.content.x)).toBeLessThanOrEqual(1);expect(Math.abs(roles.content.width-users.content.width)).toBeLessThanOrEqual(1);
 }
});
