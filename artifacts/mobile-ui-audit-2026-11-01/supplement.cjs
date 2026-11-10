process.env.MOBILE_AUDIT_FILE='supplement.json';
const {chromium}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');const audit=require('./capture.cjs');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json')));
let browser;const failures=[];
async function stage(s,id,label,action){try{if(action)await action();await audit.settle(s.page);await audit.capture(s,id,label);}catch(e){failures.push({id,reason:e.message.split('\n').slice(0,2).join(' ')});console.log('SKIP',id,failures.at(-1).reason);}}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
 const s=await audit.enter('student',fixture.studentAccount);s.role='student';
 await audit.intent(s,'openAssignments');
 await stage(s,'student-assignment-answer','学员 · 打开作业答题',()=>s.page.locator('[data-intent^="openAssignmentExam:"]').first().click());
 await s.context.close();
 const o=await audit.enter('orgAdmin',fixture.accounts.orgAdmin);o.role='orgAdmin';
 await audit.intent(o,'openRoleContent:org-groups');
 await stage(o,'orgAdmin-org-groups-expanded','机构 · 新建学习组表单',()=>o.page.locator('.pc-package-action > summary').first().click());
 await o.context.close();
 const p=await audit.enter('student','superadmin_demo');p.role='student';
 await audit.intent(p,'openRoleContent:student-account-plan');
 await stage(p,'student-paid-orders','学员 · 订单列表与详情（有数据）',async()=>{
  await p.page.locator('[data-account-order-history-summary]').click();
  const row=p.page.locator('.pc-account-order-record > summary, .pc-order-record > summary').first();
  if(await row.count())await row.click();
 });
 await p.context.close();
 const e=await audit.enter('student','student_demo');e.role='exam';
 const paper=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/paper/jlpt/n3/N3_2010_07.json')));
 await e.page.evaluate(data=>{
  const v=window.examViewer;v.practiceScope=null;v.examMode='mock';v.examId='N3_2010_07';v.loadExamData(data);window.closeLearningWorkspace();window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));
 },paper);
 await stage(e,'exam-full-paper','整卷考试 · 文本题');
 await stage(e,'exam-full-map','整卷考试 · 答题卡',()=>e.page.locator('#open-question-map').click());
 await e.page.keyboard.press('Escape');
 const closer=e.page.locator('#question-map-close');if(await closer.count()&&await closer.isVisible())await closer.click();
 const listening=paper.exam_info.sections.findIndex(section=>/listen|听|聴/.test(String(section.section_type||'')+' '+String(section.section_title||'')));
 const reading=paper.exam_info.sections.findIndex(section=>/read|读|読/.test(String(section.section_type||'')+' '+String(section.section_title||'')));
 for(const [key,idx,label]of[['reading',reading,'阅读题'],['listening',listening,'听力题']])if(idx>=0)await stage(e,'exam-'+key,'整卷考试 · '+label,()=>e.page.evaluate(i=>window.examViewer.jumpToQuestion(i,0),idx));
 await e.context.close();
 fs.writeFileSync(path.join(__dirname,'supplement-blockers.json'),JSON.stringify(failures,null,2));await browser.close();
})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
