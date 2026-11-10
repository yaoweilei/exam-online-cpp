process.env.MOBILE_AUDIT_FILE = process.argv.includes('--section=student') ? 'student-expanded.json' : 'expanded.json';
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('./capture.cjs');
const { navigateWorkspace } = require('../../tests/e2e/helpers/workspace-navigation');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json')));
const failures = [];
const manifests = [];
let browser;
async function enter(role, account) { const state = await audit.enter(role, account); state.role = role; return state; }
async function nav(state, key, platform = state.role === 'superAdmin') {
  // A creation dialog deliberately blocks background navigation; close it before moving on.
  const close = state.page.getByRole('button', { name: '关闭', exact: true }).last();
  if (await close.count() && await close.isVisible()) await close.click();
  for (let i = 0; i < 3; i++) {
    const summary = state.page.locator('.pc-package-action[open] > summary').last();
    if (!await summary.count()) break;
    await summary.click();
  }
  await closeTool(state);
  await navigateWorkspace(state.shell, key, platform); await audit.settle(state.page);
}
async function click(state, selector) { const target = state.page.locator(selector).first(); if (!await target.count()) throw Error('当前状态没有入口：' + selector); await target.click(); await audit.settle(state.page); }
async function stage(state, id, label, action, options) {
  try { if (action) await action(); await audit.settle(state.page); await audit.capture(state, id, label, options); }
  catch (error) { failures.push({ role: state.role, id, label, reason: error.message.split('\n').slice(0,3).join(' ') }); console.log('SKIP', id, failures.at(-1).reason); }
  fs.writeFileSync(path.join(__dirname, 'expanded-blockers.json'), JSON.stringify(failures, null, 2));
}
async function describe(state, id) {
  manifests.push({ id, role: state.role, controls: await state.shell.locator('main').evaluate(root => [...root.querySelectorAll('button,summary,input,select')].filter(e => e.getBoundingClientRect().height > 0).map(e => ({ tag: e.tagName, text: (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().slice(0,80), attrs: [...e.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name,a.value]) })).slice(0,150)) });
  fs.writeFileSync(path.join(__dirname, 'controls.json'), JSON.stringify(manifests, null, 2));
}
async function openNative(state, limit = 3) {
  const candidates = state.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters):not([open])');
  const count = Math.min(limit, await candidates.count());
  for (let i = 0; i < count; i++) {
    const next = state.shell.locator('main details:not(.pc-admin-select):not(.pc-floating-search-filters):not([open])').first();
    if (await next.count()) await next.evaluate(el => { el.open = true; });
  }
  await audit.settle(state.page);
}
async function closeTool(state) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const button = state.page.locator('#wq-close:visible,#vocab-close:visible,#cp-close:visible,#ald-close:visible,.risk-close:visible,[data-platform-flag-editor-close]:visible').last();
    if (await button.count()) await button.click(); else break;
  }
  await state.page.keyboard.press('Escape');
}

async function platform() {
  const s = await enter('superAdmin', 'superadmin_demo');
  await nav(s, 'users');
  await stage(s, 'platform-users-filter', '用户管理 · 筛选', () => click(s, '.pc-user-search-filters > summary'));
  await s.page.keyboard.press('Escape');
  await stage(s, 'platform-user-detail', '用户详情', () => click(s, '.pc-user-list > li button'));
  await describe(s, 'user-detail');
  await nav(s, 'roles');
  await stage(s, 'platform-role-edit', '角色权限 · 调整权限展开', async () => {
    await s.shell.locator('[data-platform-role-picker]').selectOption('assistant'); await audit.settle(s.page); await openNative(s, 2);
  });
  await nav(s, 'access');
  await stage(s, 'platform-access-form', '临时授权 · 搜索与授权表单', async () => {
    const input = s.shell.locator('main input[type=search],main input[placeholder]').first();
    await input.fill('student_demo'); await input.press('Enter'); await audit.settle(s.page); await describe(s, 'access-search');
    const result = s.shell.locator('[data-access-user], [data-access-select-user], [data-temporary-user]').first(); if (await result.count()) await result.click();
  });
  await nav(s, 'organizations');
  await stage(s, 'platform-organization-filter', '机构管理 · 筛选', () => click(s, '.pc-floating-search-filters > summary'));
  await s.page.keyboard.press('Escape');
  await stage(s, 'platform-organization-create', '机构管理 · 新建表单', () => click(s, '[data-platform-org-create-toggle]'));
  await click(s, '[data-platform-org-create-toggle]');
  await s.shell.locator('[data-managed-org-query]').fill('手机布局审查学校'); await s.shell.locator('[data-managed-org-query]').press('Enter'); await audit.settle(s.page);
  await stage(s, 'platform-organization-detail', '机构详情 · 有数据', () => click(s, '.pc-org-directory-list [role=listitem] button'));
  await stage(s, 'platform-organization-settings', '机构详情 · 设置展开', async () => { await click(s, '.pc-org-detail-settings > summary'); await openNative(s, 3); });
  await click(s, '.pc-org-detail-settings > summary');
  await stage(s, 'platform-organization-staff', '机构详情 · 人员编辑展开', () => click(s, '.pc-org-member-summary'));
  await click(s, '.pc-org-member-summary');
  await stage(s, 'platform-organization-add-staff', '机构详情 · 添加教职人员', () => click(s, '.pc-org-detail-add-manager > summary'));
  await nav(s, 'payments');
  for (const kind of ['orders','refunds','ledger','anomalies']) {
    await click(s, `[data-platform-payment-tab="${kind}"]`);
    await stage(s, `platform-payments-${kind}`, `交易管理 · ${kind}`);
    if (['orders','refunds'].includes(kind)) {
      await stage(s, `platform-payment-${kind}-detail`, `交易管理 · ${kind}详情`, () => click(s, `[data-intent^="openRoleContent:platform-payment-${kind === 'orders' ? 'order' : 'refund'}:"]`));
      await describe(s, `payment-${kind}-detail`);
      await nav(s, 'payments');
    }
  }
  await stage(s, 'platform-payment-filter', '交易管理 · 筛选', () => click(s, '.pc-floating-search-filters > summary'));
  await nav(s, 'pricing');
  for (const tab of ['personal','organization']) await stage(s, `platform-pricing-${tab}`, `价格与套餐 · ${tab}`, async () => {
    const button = s.shell.locator(`[data-pricing-tab="${tab}"], [data-pricing-scope="${tab}"], [data-pricing-plan-tab="${tab}"]`).first();
    if (await button.count()) await button.click(); else if (tab === 'organization') await s.shell.getByRole('tab', { name: '学校 / 教育机构', exact: true }).first().click();
    await openNative(s, 2);
  });
  await describe(s, 'pricing');
  await nav(s, 'feedback'); await stage(s, 'platform-feedback-filter', '内容反馈 · 筛选展开', () => click(s, '.pc-floating-search-filters > summary'));
  await nav(s, 'content'); await stage(s, 'platform-content-record', '内容工作流 · 记录展开', () => openNative(s, 2));
  await nav(s, 'flags'); await stage(s, 'platform-flags-expanded', '功能开关 · 分组展开', () => openNative(s, 2)); await describe(s, 'flags');
  await nav(s, 'audit'); await stage(s, 'platform-audit-filter', '审计日志 · 筛选展开', () => click(s, '.pc-floating-search-filters > summary'));
  await s.page.keyboard.press('Escape');
  await stage(s, 'platform-audit-detail', '审计日志 · 详情弹窗', () => click(s, '[data-audit-detail]'));
  await s.context.close();
}

async function institutions() {
  for (const role of ['teacher','assistant','orgAdmin','orgContentAdmin']) {
    const roleArgument = process.argv.find(value => value.startsWith('--roles='));
    if (roleArgument && !roleArgument.slice(8).split(',').includes(role)) continue;
    const s = await enter(role, fixture.accounts[role]);
    if (role === 'teacher') {
      for (const [key,label] of [['teacher-students','学员名单'],['teacher-groups','学习组'],['teacher-gradebook','成绩册'],['teacher-schedule','课程'],['teacher-review','作业'],['teacher-prep','备课']]) {
        await nav(s, 'openRoleContent:' + key); await describe(s, key);
        if (key === 'teacher-students') await stage(s, 'teacher-student-profile', '老师 · 学生档案', () => click(s, '[data-intent^="openRoleContent:teacher-student:"]'));
        if (key === 'teacher-groups') await stage(s, 'teacher-group-detail', '老师 · 学习组详情', () => click(s, '[data-intent^="openRoleContent:teacher-group:"]'));
      }
      await stage(s, 'teacher-assignment-create', '老师 · 布置作业表单', () => audit.intent(s, 'openRoleContent:teacher-assign'));
      await nav(s, 'openRoleContent:teacher-review');
      await stage(s, 'teacher-assignment-detail', '老师 · 作业详情与批改', () => click(s, '[data-intent^="openRoleContent:teacher-assignment:"]'));
      await stage(s, 'teacher-prep-create', '老师 · 新建备课', () => audit.intent(s, 'openRoleContent:teacher-prep-create'));
      await stage(s, 'teacher-arrange', '老师 · 安排课程', () => audit.intent(s, 'openRoleContent:teacher-arrange'));
      await describe(s, 'teacher-arrange');
    } else if (role === 'assistant') {
      await nav(s, 'openRoleContent:assistant-followup');
      await stage(s, 'assistant-followup-edit', '教学管理员 · 安排跟进', () => click(s, '[data-flow-action="select-student"]'));
      await nav(s, 'openRoleContent:assistant-followup'); await stage(s, 'assistant-followup-filter', '教学管理员 · 跟进筛选', () => click(s, '.pc-floating-search-filters > summary'));
      await stage(s, 'assistant-arrange', '教学管理员 · 安排课程', () => audit.intent(s, 'openRoleContent:assistant-arrange'));
    } else {
      const keys = role === 'orgAdmin' ? ['org-members','org-permissions','org-course-packages','org-course-accounts','org-groups','org-dashboard','org-plan','org-settings'] : ['org-course-packages'];
      for (const key of keys) {
        await nav(s, 'openRoleContent:' + key);
        await stage(s, `${role}-${key}-expanded`, `${role} · ${key} 展开态`, async () => {
          if (['org-course-packages','org-course-accounts'].includes(key) && await s.shell.locator('.pc-package-action > summary').count()) await click(s, '.pc-package-action > summary');
          else await openNative(s, key === 'org-members' ? 2 : 3);
        });
        await describe(s, `${role}-${key}`);
        const filters = s.shell.locator('.pc-floating-search-filters > summary').first();
        if (await filters.count()) await stage(s, `${role}-${key}-filter`, `${role} · ${key} 筛选`, async () => { await filters.click(); });
      }
    }
    await s.context.close();
  }
}

async function student() {
  const s = await enter('student', 'student_demo');
  const pages = [
    ['student-goal', '学习目标 · 编辑', 'openStudyGoal'],
    ['student-free', '自由练习', 'openRoleContent:student-free-practice'],
    ['student-archive', '学习档案', 'openRoleContent:student-learning-archive'],
    ['student-recent', '学习记录', 'openRecentLearningPage'],
    ['student-wrong', '错题本', 'openWrongQuestions'],
    ['student-favorites', '收藏资料', 'openBookmarkFolders'],
    ['student-vocabulary', '生词本', 'openVocabNotebook'],
    ['student-courses', '我的课程', 'openRoleContent:student-courses'],
    ['student-progress', '学习进步', 'openRoleContent:student-progress'],
    ['student-messages', '消息中心', 'openRoleContent:account-messages'],
    ['student-feedback-form', '问题反馈表单', 'openRoleContent:support-feedback'],
    ['student-customer-service', '客服', 'openRoleContent:support-customer-service'],
    ['student-agreement', '用户协议', 'openRoleContent:support-user-agreement'],
    ['student-privacy', '隐私政策', 'openRoleContent:support-privacy-policy']
  ];
  for (const [id,label,value] of pages) {
    await closeTool(s);
    await stage(s, id, label, () => audit.intent(s, value));
    await describe(s, id);
  }
  await closeTool(s);
  await stage(s, 'student-coupons-expanded', '优惠与邀请 · 兑换与记录展开', async () => { await audit.intent(s, 'openRoleContent:student-account-coupons'); await openNative(s, 3); });
  await stage(s, 'student-orders-expanded', '套餐与订单 · 订单展开', async () => { await audit.intent(s, 'openRoleContent:student-account-plan'); await openNative(s, 3); });
  await s.context.close();
  for (const kind of ['profile','security']) {
    const state = await enter('student', 'student_demo');
    await state.shell.locator('[data-platform-admin-account-menu]').click();
    await stage(state, `account-${kind}`, kind === 'profile' ? '个人资料' : '账号安全', () => click(state, kind === 'profile' ? '[data-platform-admin-account]' : '[data-platform-admin-security]'));
    await describe(state, `account-${kind}`);
    await state.context.close();
  }
}

(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true }); audit.setBrowser(browser);
  const section = process.argv.find(value => value.startsWith('--section='))?.slice(10);
  if (!section || section === 'platform') await platform();
  if (!section || section === 'institutions') await institutions();
  if (!section || section === 'student') await student();
  await browser.close();
})().catch(error => { console.error(error.stack); browser?.close(); process.exitCode = 1; });
