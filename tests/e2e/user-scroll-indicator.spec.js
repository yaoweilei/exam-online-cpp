const {test,expect}=require('@playwright/test');
test('内容放下时隐藏，溢出时3px指示并自动淡出，缩回后移除',async({page})=>{
 await page.route('**/__user_scroll_probe__',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" data-learning-role="superAdmin"><div class="pc-platform-workspace" style="position:relative;height:400px"><main class="pc-platform-admin-content" style="height:400px;box-sizing:border-box;padding:0;overflow:auto"><div id="items" style="height:300px"></div></main></div></div>'}));
 await page.goto('/__user_scroll_probe__');
 await page.evaluate(async()=>{const m=await import('/static/app/viewer/personalCenter/scrollIndicator.js');window.disposeIndicator=m.bindScrollIndicator(document.querySelector('main'),true)});
 const bar=page.locator('.pc-platform-overlay-scrollbar'),thumb=bar.locator('.pc-platform-overlay-scrollbar-thumb');
 await expect(bar).toBeHidden();
 await page.locator('#items').evaluate(e=>e.style.height='1200px');await expect(bar).not.toHaveAttribute('hidden','');
 await page.locator('main').evaluate(e=>e.scrollTop=200);await expect(bar).toHaveClass(/is-active/);
 expect(await thumb.evaluate(e=>getComputedStyle(e).width)).toBe('3px');expect(await bar.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await expect.poll(()=>bar.evaluate(e=>getComputedStyle(e).opacity)).toBe('0');
 await page.evaluate(()=>document.body.classList.remove('light-theme'));await page.locator('main').evaluate(e=>e.scrollTop=400);await expect(bar).toHaveClass(/is-active/);
 await page.locator('#items').evaluate(e=>e.style.height='200px');await expect(bar).toBeHidden();
 await page.evaluate(()=>window.disposeIndicator());await expect(bar).toHaveCount(0);
});
