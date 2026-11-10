const {test,expect}=require('@playwright/test');
test('七种身份都有当前角色首页入口，折叠菜单与返回按钮不重叠',async({page},info)=>{
 await page.route('**/__role_home_probe__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell"><header class="pc-platform-topbar"></header></div>'}));
 await page.goto('/__role_home_probe__');
 for(const [role,label] of [['student','学员'],['teacher','老师'],['assistant','教学管理员'],['orgAdmin','机构管理员'],['orgContentAdmin','机构内容管理员'],['contentAdmin','内容管理员'],['superAdmin','超级管理员']]) {
  await page.evaluate(async({role,label})=>{const m=await import('/static/app/viewer/personalCenter/roleHome.js');const s=document.querySelector('#platform-admin-shell');s.dataset.learningRole=role;s.className='';s.querySelector('header').innerHTML='<button class="pc-platform-nav-trigger">☰</button><div class="pc-workspace-navigation">'+m.renderRoleHomeButton(role,label)+'<button class="pc-topbar-back" data-workspace-back>←</button></div>';},{role,label});
  const home=page.locator('[data-workspace-home]'),back=page.locator('[data-workspace-back]');
  await expect(home).toHaveCount(1);await expect(home).toBeVisible();await expect(home).toHaveAttribute('data-workspace-home',role);
  await expect(home).toHaveAttribute(role==='superAdmin'?'data-platform-admin-page':'data-role-admin-intent',role==='superAdmin'?'overview':'__overview__');
  const target=role==='student'?'学习首页':role==='superAdmin'?'平台总览':label+'主页';await expect(home).toHaveAttribute('aria-label','返回'+target);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:844});
   const a=await home.boundingBox(),b=await back.boundingBox();expect(a.x+a.width).toBeLessThanOrEqual(b.x);expect(a.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);
   if(width===1440&&role!=='student') expect(a.x).toBeGreaterThanOrEqual(248);
   await home.focus();await expect(home).toBeFocused();
  }
  await page.setViewportSize({width:1440,height:844});await page.locator('#platform-admin-shell').evaluate(e=>e.classList.add('pc-platform-sidebar-collapsed'));
  const menu=await page.locator('.pc-platform-nav-trigger').boundingBox(),h=await home.boundingBox();expect(h.x).toBeGreaterThanOrEqual(menu.x+menu.width);
 }
 await page.evaluate(()=>document.body.classList.remove('light-theme'));await expect(page.locator('[data-workspace-home]')).toBeVisible();
 await page.screenshot({path:info.outputPath('home-mobile-dark.png')});
});
