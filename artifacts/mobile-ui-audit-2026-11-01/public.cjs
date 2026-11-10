process.env.MOBILE_AUDIT_FILE = 'public.json';
const { chromium } = require('@playwright/test');
const audit = require('./capture.cjs');
const fs = require('node:fs');
const path = require('node:path');
let browser;
const failed = [];
async function stage(state, id, label, action) {
  try { if (action) await action(); await audit.settle(state.page); await audit.capture(state, id, label); }
  catch (error) { failed.push({ id, label, reason: error.message.split('\n')[0] }); console.log('SKIP', id, failed.at(-1).reason); }
}
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true }); audit.setBrowser(browser);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8124', viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const guest = { page, context, role: 'public', account: '未登录', errors: [] };
  await stage(guest, 'public-welcome', '游客首页');
  await stage(guest, 'public-login', '登录 · 默认方式', () => page.evaluate(() => window.__openLoginModal()));
  fs.writeFileSync(path.join(__dirname, 'login-controls.json'), JSON.stringify(await page.locator('#login-modal').evaluate(root => [...root.querySelectorAll('button,input')].map(e => ({ tag:e.tagName, text: e.textContent.trim(), id: e.id, attrs:[...e.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]) }))), null, 2));
  for (const [id,label] of [['password','密码登录'],['code','验证码登录']]) {
    await stage(guest, 'public-login-' + id, '登录 · ' + label, async () => {
      if (id === 'code') await page.locator('#login-modal [data-login-phone-back]:visible').first().click();
      else await page.locator('#login-modal [data-mode="password"]:visible').click();
    });
  }
  await context.close();
  const student = await audit.enter('student', 'student_demo'); student.role = 'exam';
  await stage(student, 'exam-practice-text', '专项练习 · 文本题', async () => {
    await student.page.evaluate(async () => {
      await window.examViewer.startSpecialtyPractice('手机布局检查', [{ examId: 'N3_2010_07', questionId: '1', sectionIndex: 0 }, { examId: 'N3_2010_07', questionId: '2', sectionIndex: 0 }], false);
      window.closeLearningWorkspace();
      window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));
    });
  });
  await stage(student, 'exam-question-map', '答题卡 · 展开', async () => { const button = student.page.locator('#open-question-map'); if (await button.isVisible()) await button.click(); else throw Error('专项模式不显示整卷答题卡，另查整卷模式'); });
  await student.page.keyboard.press('Escape');
  await stage(student, 'exam-task-details', '任务详情 · 展开', async () => { const button = student.page.locator('.task-details-toggle'); if (await button.count() && await button.isVisible()) await button.click(); else throw Error('没有可见任务详情入口'); });
  await stage(student, 'exam-assist', '练习 · 辅助工具与解析', async () => {
    const button = student.page.locator('.ls-assist-toggle, [data-ls-assist-toggle], #learning-assist-toggle').first(); if (await button.count() && await button.isVisible()) await button.click(); else throw Error('当前专项模式没有辅助工具入口');
  });
  fs.writeFileSync(path.join(__dirname, 'exam-controls.json'), JSON.stringify(await student.page.locator('body').evaluate(root => [...root.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({ text: (e.getAttribute('aria-label') || e.textContent).trim(), id:e.id, classes:e.className }))), null, 2));
  await student.context.close();
  fs.writeFileSync(path.join(__dirname, 'public-blockers.json'), JSON.stringify(failed, null, 2));
  await browser.close();
})().catch(error => { console.error(error.stack); browser?.close(); process.exitCode = 1; });
