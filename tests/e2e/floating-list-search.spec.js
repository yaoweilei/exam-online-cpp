const { test, expect } = require('@playwright/test');

async function probe(page, body) {
  await page.route('**/__floating_list_probe__', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><div id="platform-admin-shell" data-learning-role="superAdmin"><main style="height:720px;overflow:auto;padding:16px;box-sizing:border-box">' + body + '</main></div>' }));
  await page.goto('/__floating_list_probe__');
}

test('浮动搜索移动原表单，保留草稿、原生提交、筛选归属和分页上下文', async ({ page }, info) => {
  await probe(page, '<section class="pc-org-subsection"><form class="pc-member-list-toolbar" data-org-member-list-form data-org-id="org-1" data-role-id="teacher"><label>搜索姓名<input class="pc-profile-input" data-org-member-list-query placeholder="姓名 / 账号 / 成员编号" value="陈老师"></label><label>排序<select data-org-member-list-sort><option value="name">姓名</option><option value="status" selected>状态</option></select></label><button type="submit">查询</button><div class="pc-member-list-pagination"><button type="button" data-org-member-list-page="next">下一页</button></div></form><div class="records">' + Array.from({length:20}, (_,i) => '<p style="height:44px">列表记录 ' + i + '</p>').join('') + '</div></section>');
  await page.evaluate(async () => {
    window.submissions = [];
    const form = document.querySelector('form');
    form.addEventListener('submit', e => { e.preventDefault(); window.submissions.push({ query: form.querySelector('[data-org-member-list-query]').value, sort: form.querySelector('select').value }); });
    window.pagerOwner = '';
    document.addEventListener('click', e => { const button=e.target.closest('[data-org-member-list-page]'); if (button) window.pagerOwner = button.closest('form').dataset.orgId; });
    const m = await import('/static/app/viewer/personalCenter/floatingSearch.js');
    m.bindFloatingSearch(document.querySelector('main')); m.bindFloatingSearch(document.querySelector('main'));
  });
  const form = page.locator('form'), input = form.locator('input');
  await expect(page.locator('.pc-floating-search-row')).toHaveCount(1);
  await expect(input).toHaveValue('陈老师');
  await expect(form.locator('select')).toHaveValue('status');
  expect(await form.evaluate(el => el.parentElement.lastElementChild === el)).toBe(true);
  await expect(page.locator('.pc-floating-search-options')).not.toBeVisible();
  await input.fill('王老师'); await input.press('Enter');
  expect(await page.evaluate(() => window.submissions)).toEqual([{query:'王老师',sort:'status'}]);
  await page.getByLabel('搜索筛选', {exact:true}).click();
  await expect(form.locator('select')).toBeVisible(); await form.locator('select').selectOption('name');
  await form.locator('select').press('Escape');
  await expect(form.locator('select')).not.toBeVisible();
  await page.getByRole('button', {name:'清除搜索',exact:true}).click();
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => window.submissions.at(-1))).toEqual({query:'',sort:'name'});
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  expect(await page.evaluate(() => window.pagerOwner)).toBe('org-1');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    await page.locator('main').evaluate(el => el.scrollTop = el.scrollHeight);
    const last = await page.locator('.records p').last().boundingBox(), dock = await page.locator('.pc-floating-search-row').boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y);
    expect(await page.locator('main').evaluate(el => el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await input.focus(); expect(await input.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  }
  await input.blur(); await page.screenshot({path:info.outputPath('floating-list-search-mobile.png')});
});

test('各列表搜索统一放在记录后，审核编辑表单不受影响', async ({page}) => {
  const attrs = ['data-role-home-package-query','data-org-campus-list-query','data-org-package-list-query','data-org-learning-list-query','data-platform-feedback-query','data-platform-payment-query','data-content-workflow-query'];
  await probe(page, attrs.map((attr,i) => '<section class="pc-subpage"><form data-probe="'+i+'"><input class="pc-profile-input" '+attr+' placeholder="搜索列表 '+i+'"><button type="submit">搜索</button></form><div>记录 '+i+'</div></section>').join('') + '<section class="pc-platform-org-directory"><form data-managed-org-list-form><input data-managed-org-query placeholder="搜索机构"><button type="submit">搜索</button></form><div>机构列表</div></section><form class="editor"><input placeholder="请输入课程名称" required><button type="submit">保存</button></form>');
  await page.evaluate(async()=>{ const m=await import('/static/app/viewer/personalCenter/floatingSearch.js');m.bindFloatingSearch(document.querySelector('main')); });
  await expect(page.locator('.pc-floating-search-row')).toHaveCount(8);
  await expect(page.locator('.editor.pc-floating-search')).toHaveCount(0);
  for (const form of await page.locator('form.pc-floating-search').all()) {
    expect(await form.evaluate(el => el.parentElement.lastElementChild === el)).toBe(true);
    await expect(form.locator('.pc-floating-search-row input')).toHaveCount(1);
    await expect(form.locator('button[type=submit]')).toHaveCount(1);
  }
});

test('无表单的功能、跟进和审计搜索仍触发原有处理器', async({page})=>{
  await probe(page, '<section class="pc-subpage"><div class="pc-platform-flag-toolbar"><input type="search" data-platform-flag-query placeholder="搜索功能"><select><option>全部状态</option></select></div><div>功能列表</div></section><section data-institution-flow="followups"><div class="pc-flow-toolbar"><input data-flow-query placeholder="搜索学员"><select data-flow-filter><option>全部学员</option></select><button type="button">刷新</button></div><div>学员列表</div></section><section data-audit-log-surface="embedded"><div class="pc-audit-filters"><input id="al-actor" placeholder="操作者 ID"><button id="al-search" type="button">查询</button></div><div>审计记录</div></section>');
  await page.evaluate(async()=>{
    window.flags=0;window.flows=0;window.audits=0;
    document.querySelector('[data-platform-flag-query]').addEventListener('input',()=>window.flags++);
    document.querySelector('[data-flow-query]').addEventListener('keydown',e=>{if(e.key==='Enter')window.flows++});
    document.querySelector('#al-search').addEventListener('click',()=>window.audits++);
    const m=await import('/static/app/viewer/personalCenter/floatingSearch.js');m.bindFloatingSearch(document.querySelector('main'));
  });
  for(const root of ['.pc-platform-flag-toolbar','.pc-flow-toolbar','.pc-audit-filters']) await page.locator(root+' .pc-floating-search-submit').click();
  expect(await page.evaluate(()=>[window.flags,window.flows,window.audits])).toEqual([1,1,1]);
});

test('校区分页保持可见，交易筛选在浮动入口直接展开', async({page})=>{
  await probe(page, '<section class="pc-org-subsection"><form data-org-campus-list-form data-org-id="campus-org"><label><input data-org-campus-list-query placeholder="搜索校区"></label><select data-org-campus-list-sort><option>名称</option></select><div class="pc-org-form-actions"><button type="submit">查询</button><button type="button" data-org-campus-list-page="next">下一页</button></div></form><div>校区记录</div></section><section class="pc-subpage"><div class="pc-card"><form data-platform-payment-search-form><input data-platform-payment-query placeholder="搜索交易"><button type="submit">查询</button></form><details data-platform-payment-advanced><summary>更多筛选</summary><select data-platform-payment-sort><option>金额</option></select></details></div><div>交易列表</div></section>');
  await page.evaluate(async()=>{const m=await import('/static/app/viewer/personalCenter/floatingSearch.js');m.bindFloatingSearch(document.querySelector('main'));});
  const pager=page.locator('[data-org-campus-list-page]');
  await expect(pager).toBeVisible(); expect(await pager.evaluate(el=>el.closest('form').dataset.orgId)).toBe('campus-org');
  const paymentForm = page.locator('form[data-platform-payment-search-form]');
  await expect(paymentForm.locator('[data-platform-payment-sort]')).not.toBeVisible();
  await paymentForm.getByLabel('搜索筛选', {exact:true}).click();
  await expect(paymentForm.locator('[data-platform-payment-sort]')).toBeVisible();
  await expect(paymentForm.getByText('更多筛选', {exact:true})).toHaveCount(0);
});
