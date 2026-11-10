process.env.TABLET_AUDIT_FILE='additional.json';
const {chromium}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const c=require('./capture.cjs');const {audit,fixture}=c;
const {navigateWorkspace}=require('../../tests/e2e/helpers/workspace-navigation');let browser;const diagnostics=[];
async function detail(s,id){diagnostics.push({id,width:s.page.viewportSize().width,data:await s.page.evaluate(()=>({
 inputs:[...document.querySelectorAll('#platform-admin-shell input:not([type=hidden])')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const st=getComputedStyle(e);return {name:e.name,value:e.value,width:e.clientWidth,innerWidth:e.clientWidth-parseFloat(st.paddingLeft)-parseFloat(st.paddingRight),font:st.fontSize};}),
 tables:[...document.querySelectorAll('#platform-admin-shell table')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({class:e.className,width:e.getBoundingClientRect().width,rows:[...e.querySelectorAll('tbody tr')].slice(0,3).map(e=>e.getBoundingClientRect().height)})),
 surfaces:[...document.querySelectorAll('#platform-admin-shell .pc-card')].slice(0,3).map(e=>({padding:getComputedStyle(e).padding,radius:getComputedStyle(e).borderRadius})),
 shell:document.querySelector('#platform-admin-shell')?.getBoundingClientRect().toJSON(),heading:document.querySelector('.pc-workspace-page-heading h1')?.getBoundingClientRect().toJSON()
}))});fs.writeFileSync(path.join(__dirname,'diagnostics.json'),JSON.stringify(diagnostics,null,2));}
(async()=>{
 browser=await chromium.launch({channel:'msedge',headless:true});c.setBrowser(browser);
 const p=await c.enter('superAdmin','superadmin_demo');await navigateWorkspace(p.shell,'pricing',true);await audit.settle(p.page);await p.page.setViewportSize({width:768,height:1024});await detail(p,'pricing-768');await p.page.setViewportSize({width:1024,height:768});await detail(p,'pricing-1024');
 await navigateWorkspace(p.shell,'audit',true);await audit.settle(p.page);await p.page.setViewportSize({width:768,height:1024});await detail(p,'audit-768');
 await navigateWorkspace(p.shell,'organizations',true);await audit.settle(p.page);await p.page.setViewportSize({width:1440,height:1000});await p.shell.evaluate(e=>{e.classList.add('pc-platform-admin-mobile-preview');e.style.width='820px';e.style.maxWidth='820px';});await c.shot(p,'preview-820','桌面内820px平板预览',{modes:[{width:1440,height:1000}]});await p.context.close();
 const o=await c.enter('orgAdmin',fixture.accounts.orgAdmin);await audit.intent(o,'openRoleContent:org-course-packages');await c.shot(o,'course-boundaries','课程包断点补查',{modes:[{width:820,height:1180},{width:1180,height:820}]});await o.context.close();
 const s=await c.enter('student','student_demo');await audit.intent(s,'openChapterPath');await c.shot(s,'chapters-boundaries','专项练习断点补查',{modes:[{width:820,height:1180},{width:1180,height:820}]});
 const paper=require('../../data/paper/jlpt/n3/N3_2010_07.json');s.role='exam';
 await s.page.evaluate(data=>{const v=window.examViewer;v.practiceScope=null;v.examMode='mock';v.examId='N3_2010_07';v.loadExamData(data);window.closeLearningWorkspace();window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));},paper);
 await c.shot(s,'exam-text','整卷文本题');await s.page.locator('#open-question-map').click();await c.shot(s,'exam-map','答题卡展开');
 const close=s.page.locator('#question-map-close');if(await close.isVisible())await close.click();
 for(const [id,pattern,label]of[['exam-reading',/read|读|読/,'阅读题'],['exam-listening',/listen|听|聴/,'听力题']]){const idx=paper.exam_info.sections.findIndex(x=>pattern.test(String(x.section_type||'')+' '+String(x.section_title||'')));if(idx>=0){await s.page.evaluate(i=>window.examViewer.jumpToQuestion(i,0),idx);await c.shot(s,id,label);}}
 await s.context.close();
 const context=await browser.newContext({baseURL:'http://127.0.0.1:8124',viewport:{width:768,height:1024}}),page=await context.newPage();await page.goto('/');await page.waitForFunction(()=>typeof window.__openLoginModal==='function');const guest={page,context,role:'public',account:'游客',errors:[]};
 await c.shot(guest,'welcome','游客首页');await page.evaluate(()=>window.__openLoginModal());await c.shot(guest,'login-phone','验证码登录');await page.locator('#login-modal [data-mode=password]:visible').click();await c.shot(guest,'login-password','密码登录');await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
