process.env.MOBILE_AUDIT_FILE = 'rechecks.json';
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('./capture.cjs');
const { navigateWorkspace } = require('../../tests/e2e/helpers/workspace-navigation');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json')));
const failures = [];
let browser;
async function enter(role, account) { const s = await audit.enter(role, account); s.role = role; return s; }
async function nav(s, key) { await navigateWorkspace(s.shell, key, s.role === 'superAdmin'); await audit.settle(s.page); }
async function click(s, selector) { await s.page.locator(selector).first().click(); await audit.settle(s.page); }
async function stage(s, id, label, action) {
  try { if (action) await action(); await audit.settle(s.page); return await audit.capture(s, id, label); }
  catch (e) { failures.push({ id, reason: e.message.split('\n').slice(0, 2).join(' ') }); console.log('SKIP', id, failures.at(-1).reason); }
}
async function diagnose(s, name) {
  const data = await s.page.evaluate(() => {
    const main = document.querySelector('#platform-admin-shell.pc-platform-admin-open .pc-platform-admin-content') || document.body;
    const r = main.getBoundingClientRect();
    return [...main.querySelectorAll('*')].filter(e => {
      for (let p=e; p && p!==main; p=p.parentElement) if (p.tagName==='DETAILS' && !p.open && !p.querySelector(':scope>summary')?.contains(e)) return false;
      const b=e.getBoundingClientRect(), c=getComputedStyle(e);
      return b.width>0 && b.height>0 && c.visibility!=='hidden' && (b.right>r.right+2 || e.scrollWidth>e.clientWidth+4);
    }).map(e=>{const b=e.getBoundingClientRect(),c=getComputedStyle(e);return {tag:e.tagName,cls:e.className,x:Math.round(b.x),right:Math.round(b.right),width:Math.round(b.width),y:Math.round(b.y),height:Math.round(b.height),scroll:e.scrollWidth,client:e.clientWidth,overflow:c.overflowX,text:(e.textContent||'').replace(/\s+/g,' ').slice(0,100)};}).slice(0,90);
  });
  fs.writeFileSync(path.join(__dirname, name+'-diagnosis.json'), JSON.stringify(data,null,2));
  await s.page.setViewportSize({width:390,height:844});
  const main=s.page.locator('.pc-platform-admin-content');
  const h=await main.evaluate(e=>e.scrollHeight);
  for(let i=1;i<Math.ceil(h/650);i++) {
    await main.evaluate((e,y)=>e.scrollTop=y,i*650);
    await s.page.screenshot({path:path.join(audit.screenshots,name+'-390-middle-'+i+'.png')});
  }
}
(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
  if(!process.argv.includes('--exam')) {
    const p=await enter('superAdmin','superadmin_demo');
    await nav(p,'access');
    await p.shell.locator('[data-temp-search-form] input').fill('student_demo');
    await p.shell.locator('[data-temp-search-form] input').press('Enter');await audit.settle(p.page);
    await stage(p,'platform-access-grant','临时授权 · 新增表单',async()=>{await click(p,'[data-temp-user]');await click(p,'[data-temp-new]');});
    await nav(p,'flags');
    await stage(p,'platform-flag-editor','功能开关 · 修改弹窗',async()=>{
      const details=p.shell.locator('main details').first();if(await details.count())await details.evaluate(e=>e.open=true);
      await p.page.getByRole('button',{name:'修改',exact:true}).first().click();
    });
    await p.context.close();
    const t=await enter('teacher',fixture.accounts.teacher);
    await stage(t,'teacher-prep-new','老师 · 新建备课表单',()=>audit.intent(t,'openRoleContent:teacher-prep-new'));
    await audit.intent(t,'openRoleContent:teacher-arrange');
    const group=t.shell.locator('[data-intent*="teacher-group:"]').first();
    if(await group.count())await group.click();
    await audit.settle(t.page);
    await stage(t,'teacher-lesson-create','老师 · 新增课次',()=>click(t,'[data-flow-action="new-lesson"]'));
    const cancel=t.page.locator('[data-flow-action="cancel-lesson"]');if(await cancel.count())await cancel.first().click();
    await stage(t,'teacher-lesson-attendance','老师 · 出勤与扣课结算',()=>click(t,'[data-flow-action="complete-lesson"]'));
    await t.context.close();
    const o=await enter('orgAdmin',fixture.accounts.orgAdmin);
    await nav(o,'openRoleContent:org-dashboard');
    await stage(o,'org-dashboard-open','机构看板 · 展开复核',async()=>{
      for(const d of await o.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters)').all())await d.evaluate(e=>e.open=true);
    });
    await diagnose(o,'org-dashboard');
    await nav(o,'openRoleContent:org-groups');
    await stage(o,'org-groups-filter-visible','机构学习组 · 筛选复核',()=>click(o,'.pc-floating-search-filters > summary'));
    await o.context.close();
    const s=await enter('student',fixture.studentAccount);
    await nav(s,'openAssignments');await stage(s,'student-assignments-populated','学员 · 我的作业（有数据）');
    await stage(s,'student-assignment-detail-populated','学员 · 作业详情（有数据）',()=>click(s,'[data-student-assignment-toggle]'));
    await audit.intent(s,'openRoleContent:student-courses');await stage(s,'student-courses-populated','学员 · 课程与课时（有数据）');
    await s.context.close();
  } else {
    const s=await enter('student','student_demo');s.role='exam';
    await s.page.evaluate(async()=>{await window.examViewer.startSpecialtyPractice('手机布局检查',[{examId:'N3_2010_07',questionId:'1',sectionIndex:0}],false);window.closeLearningWorkspace();window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));});
    await audit.settle(s.page);
    await stage(s,'exam-settings','专项练习 · 考试设置',()=>click(s,'.exam-settings-toggle'));
    await s.page.keyboard.press('Escape');
    await stage(s,'exam-jump','专项练习 · 题目跳转',()=>click(s,'.question-counter'));
    await s.page.keyboard.press('Escape');
    await stage(s,'exam-feedback','专项练习 · 题目报错',()=>click(s,'.feedback-btn'));
    await s.context.close();
  }
  fs.writeFileSync(path.join(__dirname,process.argv.includes('--exam')?'exam-recheck-blockers.json':'recheck-blockers.json'),JSON.stringify(failures,null,2));
  await browser.close();
})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
