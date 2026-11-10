const {test,expect}=require('@playwright/test');
test('用户列表角色和状态层级，详情箭头保留44px点击范围',async({page},info)=>{
 await page.route('**/__user_accessory_probe__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" data-learning-role="superAdmin"><section class="pc-user-directory" style="margin:16px"><ul class="pc-user-list" aria-label="用户列表"></ul></section></div>'}));
 await page.goto('/__user_accessory_probe__');
 await page.evaluate(async()=>{
  const m=await import('/static/app/viewer/personalCenter/userListPresentation.js');
  document.querySelector('.pc-user-list').innerHTML=['active','pending','disabled'].map((status,i)=>m.renderUserListItem('用户'+i,'用户'+i,i===1?['教师','学员','教师','机构管理员']:['学员'],status,'openRoleContent:user:user-'+i)).join('');
  window.selected='';document.addEventListener('click',e=>{const button=e.target.closest('[data-intent]');if(button)window.selected=button.dataset.intent});
 });
 await expect(page.locator('.pc-user-role').nth(1)).toHaveText('教师+2');await expect(page.locator('.pc-user-role').nth(1)).toHaveAttribute('aria-label','教师 / 学员 / 机构管理员');
 await expect(page.locator('.pc-user-status')).toHaveText(['待激活','已停用']);await expect(page.locator('.is-disabled svg')).toHaveCount(1);
 await expect(page.locator('.is-active')).toHaveCount(0);
 const separator=await page.locator('.pc-user-list > li').first().evaluate(row=>{const style=getComputedStyle(row,'::after');return{left:style.left,right:style.right,height:style.height,content:style.content}});
 expect(separator).toEqual({left:'14px',right:'14px',height:'1px',content:'""'});
 expect(await page.locator('.pc-user-list > li').last().evaluate(row=>getComputedStyle(row,'::after').content)).toBe('none');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:844});
  const button=page.getByRole('button',{name:'查看用户0详情'});const size=await button.boundingBox();expect(size.width).toBeGreaterThanOrEqual(44);expect(size.height).toBeGreaterThanOrEqual(44);
  await button.focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.selected)).toBe('openRoleContent:user:user-0');
  await expect(button.locator('.pc-user-entry-arrow')).toBeVisible();expect(await page.locator('.pc-user-directory').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 }
 await page.screenshot({path:info.outputPath('user-accessory-mobile-light.png')});
 await page.evaluate(()=>document.body.classList.remove('light-theme'));
 await expect(page.locator('.pc-user-status')).toHaveText(['待激活','已停用']);
 await page.screenshot({path:info.outputPath('user-accessory-mobile-dark.png')});
});
