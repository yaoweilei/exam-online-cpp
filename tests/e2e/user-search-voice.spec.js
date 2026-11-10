const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{
 await page.route('**/__user_voice_probe__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" data-learning-role="superAdmin"><section class="pc-user-directory" style="margin:16px"></section></div>'}));
 await page.goto('/__user_voice_probe__');
 await page.evaluate(async()=>{
  window.m=await import('/static/app/viewer/personalCenter/userSearch.js');
  window.sessions=[];window.starts=0;window.submits=0;
  class Recognition {start(){window.starts++} stop(){} abort(){this.aborted=true} constructor(){window.sessions.push(this)}}
  Object.defineProperty(window,'SpeechRecognition',{value:Recognition,writable:true,configurable:true});
  window.mount=()=>{const root=document.querySelector('.pc-user-directory');root.innerHTML=window.m.renderUserSearchForm('',false);window.m.bindUserSearchVoice(root);root.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++})};window.mount();
 });
});
test('麦克风按需启动，文字填入但不自动搜索，图标提交和清除入口保留',async({page},info)=>{
 expect(await page.evaluate(()=>window.starts)).toBe(0);
 await page.getByRole('button',{name:'语音输入',exact:true}).click();
 expect(await page.evaluate(()=>window.starts)).toBe(1);
 await page.evaluate(()=>window.sessions[0].onresult({results:[{isFinal:true,0:{transcript:'张同学'}}]}));
 await expect(page.getByLabel('搜索用户',{exact:true})).toHaveValue('张同学');expect(await page.evaluate(()=>window.submits)).toBe(0);
 await page.evaluate(()=>window.sessions[0].onend());
 await page.getByRole('button',{name:'执行用户搜索'}).click();expect(await page.evaluate(()=>window.submits)).toBe(1);
 await expect(page.getByRole('button',{name:'清除用户搜索'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.body.classList.remove('light-theme'));
 expect(await page.locator('form').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('voice-search-mobile-dark.png')});
});
test('停止、重新渲染和用户改字不会收到旧识别结果',async({page})=>{
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByRole('button',{name:'停止语音输入'}).click();
 await page.evaluate(()=>window.sessions[0].onresult({results:[{isFinal:true,0:{transcript:'旧文字'}}]}));await expect(page.getByLabel('搜索用户',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.getByLabel('搜索用户',{exact:true}).fill('手动输入');
 await page.evaluate(()=>window.sessions[1].onresult({results:[{isFinal:true,0:{transcript:'不可覆盖'}}]}));await expect(page.getByLabel('搜索用户',{exact:true})).toHaveValue('手动输入');
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.evaluate(()=>window.mount());
 await expect.poll(()=>page.evaluate(()=>window.sessions[2].aborted)).toBe(true);
});
test('不支持、拒绝权限、未听清及启动失败均保留手动搜索',async({page})=>{
 for(const error of ['not-allowed','no-speech','network']) {
  await page.getByRole('button',{name:'语音输入',exact:true}).click();await page.evaluate(error=>window.sessions.at(-1).onerror({error}),error);
  await expect(page.getByRole('status')).toContainText(error==='not-allowed'?'权限':error==='no-speech'?'没有听清':'暂不可用');
  await expect(page.getByRole('button',{name:'语音输入',exact:true})).toHaveAttribute('aria-pressed','false');
 }
 await page.evaluate(()=>{window.SpeechRecognition.prototype.start=function(){throw new Error('startup failed')}});
 await page.getByRole('button',{name:'语音输入',exact:true}).click();await expect(page.getByRole('status')).toContainText('无法启动');
 await page.evaluate(()=>{window.SpeechRecognition=undefined;Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true})});
 await page.evaluate(()=>window.mount());
 await expect(page.locator('[data-user-search-voice]')).toBeHidden();await expect(page.getByRole('status')).toHaveCount(0);
 await page.getByLabel('搜索用户',{exact:true}).fill('正常输入');await page.getByRole('button',{name:'执行用户搜索'}).click();expect(await page.evaluate(()=>window.submits)).toBe(1);
});

test('浏览器报告识别服务不可用时隐藏麦克风并清空提示',async({page})=>{
 await page.getByRole('button',{name:'语音输入',exact:true}).click();
 await page.evaluate(()=>window.sessions.at(-1).onerror({error:'service-not-allowed'}));
 await expect(page.locator('[data-user-search-voice]')).toBeHidden();
 await expect(page.locator('[data-user-voice-status]')).toBeHidden();
 await expect(page.locator('[data-user-voice-status]')).toHaveText('');
});

test('搜索输入聚焦只保留光标，不显示边框或光晕',async({page})=>{
 const input=page.getByLabel('搜索用户',{exact:true});await input.focus();await input.fill('张同学');await expect(input).toBeFocused();
 expect(await input.evaluate(e=>{const s=getComputedStyle(e);return {outline:s.outlineStyle,border:s.borderTopWidth,shadow:s.boxShadow}})).toEqual({outline:'none',border:'0px',shadow:'none'});
});
