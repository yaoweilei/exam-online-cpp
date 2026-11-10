const {test,expect}=require('@playwright/test');
async function setup(page,owner='admin-access-test'){
 await page.route('**/__temporary_access__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" class="pc-platform-roles-active" data-learning-role="superAdmin"><main style="padding:16px"><div class="pc-workspace-page-heading"><h1>用户与权限</h1><p>按用户管理临时角色与有效期</p></div><nav class="pc-workspace-section-tabs"><button class="pc-workspace-section-tab">用户管理</button><button class="pc-workspace-section-tab">角色权限</button><button class="pc-workspace-section-tab active">临时授权</button></nav><section id="access-host"></section></main></div>'}));
 await page.goto('/__temporary_access__');
 await page.evaluate(async owner=>{
  window.store=[{role_id:'teacher',effect:'allow',permissions:['extra.permission'],expires_at:'2099-01-01T00:00:00Z'},{role_id:'contentAdmin',effect:'allow',permissions:[],expires_at:'2001-01-01T00:00:00Z'}];
  window.saved=[];window.confirmations=[];window.conflict=false;window.failSave=false;
  window.accessHooks={owner,current:()=>true,search:async query=>query==='missing'?[]:[{id:'member-1',username:'chen',display_name:'陈同学'}],load:async()=>({before:{active_temporary_grants:window.store.filter(g=>Date.parse(g.expires_at)>Date.now()),expired_temporary_grants:window.store.filter(g=>Date.parse(g.expires_at)<=Date.now())}}),preview:async(id,payload)=>({after:{conflicts:window.conflict?['不能重复授权']:[]},added_permissions:['assignment.review'],removed_permissions:[]}),save:async(id,payload)=>{if(window.failSave)throw Error('模拟保存失败');await new Promise(r=>setTimeout(r,30));window.saved.push({id,payload});window.store=payload.temporary_grants;},confirm:async message=>{window.confirmations.push(message);return true;},notice:()=>{}};
  const m=await import('/static/app/viewer/personalCenter/temporaryAccess.js');window.mountAccess=(host,hooks)=>m.bindTemporaryAccess(host,hooks);window.mountAccess(document.querySelector('#access-host'),window.accessHooks);
 },owner);
}
async function choose(page){await page.getByRole('textbox',{name:'搜索授权用户',exact:true}).fill('陈');await page.getByRole('button',{name:'搜索授权用户',exact:true}).click();await page.locator('[data-temp-user]').click();await expect(page.locator('.pc-access-records article')).toHaveCount(2);}
async function draft(page){await page.getByRole('button',{name:'新增授权',exact:true}).click();await page.locator('[name=expiry]').fill('2099-12-31T12:00');await page.getByRole('button',{name:'预览授权',exact:true}).click();}
test('第三页签搜索选人，读取有效及到期记录，新增和撤销保留其他授权',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await choose(page);
 await expect(page.locator('[data-platform-role-template-form]')).toHaveCount(0);await expect(page.locator('[data-platform-access-user-id]')).toHaveCount(0);
 await expect(page.locator('.pc-access-records')).toContainText('已到期');await expect(page.locator('[data-temp-revoke]')).toHaveCount(1);
 await draft(page);expect(await page.evaluate(()=>window.saved.length)).toBe(0);
 await expect(page.getByLabel('授权变更预览')).toContainText('变更前 2 条，变更后 3 条');
 await page.getByRole('button',{name:'确认授权',exact:true}).evaluate(b=>{b.click();b.click();});
 await expect.poll(()=>page.evaluate(()=>window.saved.length)).toBe(1);await expect(page.locator('.pc-access-records article')).toHaveCount(3);
 const payload=await page.evaluate(()=>window.saved[0].payload);expect(payload.temporary_grants[0].permissions).toEqual(['extra.permission']);expect(payload.temporary_grants[1].expires_at).toBe('2001-01-01T00:00:00Z');expect(payload.temporary_grants[2].expires_at).toMatch(/Z$/);
 await page.locator('.pc-access-records article').filter({hasText:'教务管理员'}).getByRole('button',{name:'撤销',exact:true}).click();
 expect(await page.evaluate(()=>window.saved.length)).toBe(1);await page.getByRole('button',{name:'确认撤销',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.saved.length)).toBe(2);await expect(page.locator('.pc-access-records article')).toHaveCount(2);
 expect(await page.evaluate(()=>window.saved[1].payload.temporary_grants.map(g=>g.role_id))).toEqual(['teacher','contentAdmin']);
 for(const width of [390,1440]){await page.setViewportSize({width,height:844});expect(await page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('temporary-access-mobile.png')});
});
test('冲突、失效日期、并发修改及失败不会覆盖权限，保留草稿',async({page})=>{
 await setup(page,'admin-errors');await choose(page);await page.getByRole('button',{name:'新增授权',exact:true}).click();await page.locator('[name=expiry]').fill('2001-01-01T12:00');await page.getByRole('button',{name:'预览授权',exact:true}).click();await expect(page.getByRole('alert')).toContainText('晚于当前时间');
 await page.locator('[name=expiry]').fill('2099-12-31T12:00');await page.evaluate(()=>window.conflict=true);await page.getByRole('button',{name:'预览授权',exact:true}).click();await expect(page.getByRole('alert')).toContainText('权限冲突');await expect(page.locator('[data-temp-commit]')).toHaveCount(0);
 await page.evaluate(()=>window.conflict=false);await page.getByRole('button',{name:'预览授权',exact:true}).click();await page.evaluate(()=>window.store.push({role_id:'orgAdmin',effect:'allow',expires_at:'2099-01-01T00:00:00Z'}));await page.locator('[data-temp-commit]').click();await expect(page.getByRole('alert')).toContainText('重新预览');expect(await page.evaluate(()=>window.saved.length)).toBe(0);
 await page.getByRole('button',{name:'预览授权',exact:true}).click();await page.evaluate(()=>window.failSave=true);await page.locator('[data-temp-commit]').click();await expect(page.getByRole('alert')).toContainText('模拟保存失败');await expect(page.locator('[name=expiry]')).toHaveValue('2099-12-31T12:00');expect(await page.evaluate(()=>window.saved.length)).toBe(0);
});
test('离开页面后迟到请求不会覆盖其他管理员的页面',async({page})=>{
 await setup(page,'admin-old');
 await page.evaluate(()=>{const old=document.querySelector('#access-host');old.remove();const host=document.createElement('section');host.id='pending-host';document.querySelector('main').append(host);window.mountAccess(host,{...window.accessHooks,owner:'admin-old-pending',initial:{id:'old-secret',display_name:'旧账号资料'},load:()=>new Promise(resolve=>window.releaseOld=()=>resolve({temporary_grants:[]}))});});
 await page.evaluate(()=>{document.querySelector('#pending-host').remove();const host=document.createElement('section');host.id='new-host';document.querySelector('main').append(host);window.mountAccess(host,{...window.accessHooks,owner:'admin-new',initial:{id:'other',display_name:'另一用户'}});});
 await expect(page.locator('.pc-access-user')).toContainText('另一用户');await page.evaluate(()=>window.releaseOld());await expect(page.locator('.pc-access-user')).toContainText('另一用户');await expect(page.locator('main')).not.toContainText('旧账号资料');expect(await page.evaluate(()=>window.saved.length)).toBe(0);
});

test('点击有效期整框和日历按钮都会请求日期选择器，操作按钮成组对齐',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await setup(page,'picker-test');await choose(page);
 const change=page.getByRole('button',{name:'更换用户',exact:true}),refresh=page.getByRole('button',{name:'刷新',exact:true});
 let a=await change.boundingBox(),b=await refresh.boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(1);expect(b.x-a.x-a.width).toBeGreaterThanOrEqual(7);
 await page.getByRole('button',{name:'新增授权',exact:true}).click();await expect(page.getByRole('button',{name:'新增授权',exact:true})).toBeDisabled();
 await page.locator('[name=expiry]').evaluate(el=>{window.pickerCalls=0;const native=el.showPicker;el.showPicker=function(){window.pickerCalls++;try{native.call(this)}catch(e){window.pickerError=e.name;throw e;}};});
 await page.getByRole('button',{name:'选择到期日期和时间',exact:true}).click();expect(await page.evaluate(()=>window.pickerCalls)).toBe(1);expect(await page.evaluate(()=>window.pickerError)).toBeUndefined();
 await page.keyboard.press('Escape');
 // Keep the second interaction observable without a native popup obscuring subsequent geometry checks.
 await page.locator('[name=expiry]').evaluate(el=>el.showPicker=()=>window.pickerCalls++);
 await page.locator('[name=expiry]').click();expect(await page.evaluate(()=>window.pickerCalls)).toBe(2);
 const style=await page.locator('[name=expiry]').evaluate(el=>{const s=getComputedStyle(el);return [s.outlineStyle,s.borderTopWidth,s.boxShadow];});expect(style).toEqual(['none','0px','none']);
 const cancel=await page.getByRole('button',{name:'取消',exact:true}).boundingBox(),preview=await page.getByRole('button',{name:'预览授权',exact:true}).boundingBox();expect(Math.abs(cancel.y-preview.y)).toBeLessThanOrEqual(1);expect(preview.x-cancel.x-cancel.width).toBeGreaterThanOrEqual(7);
 expect(await page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.locator('[name=expiry]').fill('2099-12-31T12:00');await page.screenshot({path:info.outputPath('expiry-actions-mobile.png')});
});

test('浏览器不允许打开选择器时提供日期和时间输入，预览仍可用',async({page})=>{
 await setup(page,'picker-fallback');await choose(page);await page.getByRole('button',{name:'新增授权',exact:true}).click();
 await page.locator('[name=expiry]').evaluate(el=>el.showPicker=()=>{throw new DOMException('not supported','NotSupportedError')});
 await page.getByRole('button',{name:'选择到期日期和时间',exact:true}).click();
 await expect(page.getByLabel('到期日期',{exact:true})).toBeVisible();await expect(page.getByLabel('到期时间',{exact:true})).toBeVisible();
 await page.getByLabel('到期日期',{exact:true}).fill('2099-12-31');await page.getByLabel('到期时间',{exact:true}).fill('12:30');
 await page.getByRole('button',{name:'预览授权',exact:true}).click();await expect(page.getByLabel('授权变更预览')).toContainText('变更后 3 条');expect(await page.evaluate(()=>window.saved.length)).toBe(0);
});
