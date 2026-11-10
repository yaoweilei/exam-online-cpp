const {test,expect}=require('@playwright/test');
test('学习记录十条两行适应一屏，分页保留全部记录和原详情入口',async({page},info)=>{
 await page.route('**/__recent_learning_fit__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/learning-shell.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme learning-shell-active ls-student-navigation"><div id="platform-admin-shell" class="pc-platform-admin-open" data-learning-role="student"><header class="pc-platform-topbar"></header><aside class="pc-platform-sidebar"></aside><div class="pc-platform-workspace"><main class="pc-platform-admin-content"><div class="pc-workspace-page-heading"><h1>学习记录</h1><p>查看进度，继续练习或复盘结果。</p></div><div class="pc-dashboard pc-dashboard-simple pc-subpage"><div class="pc-subpage-head">重复标题</div><div id="fixture-list"></div></div></main></div></div></body>'}));
 await page.setViewportSize({width:414,height:848});await page.goto('/__recent_learning_fit__');
 await page.evaluate(async()=>{
  const m=await import('/static/app/viewer/personalCenter/recentLearningList.js');
  window.records=Array.from({length:22},(_,i)=>({title:'JLPT N3 · 2024年12月真题 · 记录 '+i,desc:'进行中 · 已答5/102题 · 10/18 19:28',meta:i%2?'查看结果':'继续练习',intent:i%2?'openStudentResult:paper-'+i:'openStudentRecent:paper-'+i}));
  const root=document.querySelector('#fixture-list');root.style.display='contents';
  window.renderRecent=p=>root.innerHTML=m.renderRecentLearningList(window.records,p);window.renderRecent(1);
  document.addEventListener('click',e=>{const pager=e.target.closest('[data-recent-learning-page]');if(pager&&!pager.disabled)window.renderRecent(Number(pager.dataset.recentLearningPage));const row=e.target.closest('[data-intent]');if(row)window.lastIntent=row.dataset.intent;});
 });
 const main=page.locator('main');
 for(const [width,height] of [[414,848],[390,844],[390,740],[768,900]]){
  await page.setViewportSize({width,height});
  await expect(page.locator('[role=listitem]')).toHaveCount(10);
  await expect.poll(()=>main.evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);
  expect(await main.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  const first=await page.locator('.pc-grouped-entry').first().boundingBox(),last=await page.locator('.pc-grouped-entry').last().boundingBox(),pager=await page.locator('nav').boundingBox();
  expect(first.height).toBeGreaterThanOrEqual(44);expect(last.y+last.height).toBeLessThanOrEqual(pager.y+1);
  await expect(page.locator('.pc-grouped-meta')).toHaveCount(0);
 }
 await page.setViewportSize({width:414,height:848});
 const row=page.getByRole('button',{name:/继续练习：.*记录 0，/});await row.focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.lastIntent)).toBe('openStudentRecent:paper-0');
 await page.getByLabel('下一页学习记录').click();await expect(page.locator('.pc-grouped-title').first()).toContainText('记录 10');
 await page.getByLabel('下一页学习记录').click();await expect(page.locator('[role=listitem]')).toHaveCount(2);await expect(page.locator('.pc-grouped-title').last()).toContainText('记录 21');await expect(page.getByLabel('下一页学习记录')).toBeDisabled();
 await page.getByLabel('上一页学习记录').click();await expect(page.locator('[role=listitem]')).toHaveCount(10);
 await page.locator('h1').click();await page.screenshot({path:info.outputPath('recent-learning-one-screen.png')});
 await page.setViewportSize({width:390,height:600});await main.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.getByLabel('下一页学习记录')).toBeVisible();
});
