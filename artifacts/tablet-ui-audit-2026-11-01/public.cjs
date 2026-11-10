process.env.TABLET_AUDIT_FILE='public.json';
const {chromium}=require('@playwright/test');const c=require('./capture.cjs');const {audit}=c;let browser;
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true});c.setBrowser(browser);
 const s=await c.enter('student','student_demo');s.role='exam';
 const paper=require('../../data/paper/jlpt/n3/N3_2010_07.json');
 for(const [id,pattern,label]of[['exam-text',/vocab|文字|語彙/,'文本题'],['exam-reading',/read|读|読/,'阅读题'],['exam-listening',/listen|听|聴/,'听力题']]){
  let si=paper.exam_info.sections.findIndex(x=>pattern.test(String(x.section_type||'')));if(si<0)si=0;
  const section=paper.exam_info.sections[si],qi=String((section.questions||section.passages.flatMap(p=>p.questions))[0].id);
  await s.page.evaluate(async({si,qi})=>{await window.examViewer.startSpecialtyPractice('平板布局检查',[{examId:'N3_2010_07',questionId:qi,sectionIndex:si}],false);window.closeLearningWorkspace();window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));},{si,qi});
  await c.shot(s,id,label);
 }
 await s.context.close();
 const context=await browser.newContext({baseURL:'http://127.0.0.1:8124',viewport:{width:768,height:1024}}),page=await context.newPage();await page.goto('/');await page.waitForFunction(()=>typeof window.__openLoginModal==='function');const guest={page,context,role:'public',account:'游客',errors:[]};
 await c.shot(guest,'welcome','游客首页');await page.evaluate(()=>window.__openLoginModal());await c.shot(guest,'login-phone','验证码登录');await page.locator('#login-modal [data-mode=password]:visible').click();await c.shot(guest,'login-password','密码登录');await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
