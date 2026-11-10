const { test, expect } = require('@playwright/test');
const { loginWithPassword } = require('./helpers/session');

test('已登录学员强制刷新先进入学习首页，仍可继续草稿', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  const draft = { exam_id: 'N2_2020_07', exam_mode: 'mock', answers: { '0:1': 2 }, answered_count: 1, total_questions: 2, last_section_index: 0, last_question_index: 1, revision: 1 };
  const reply = data => ({ contentType: 'application/json', body: JSON.stringify({ code: 'OK', data }) });
  let deletes = 0;
  await page.route(/\/api\/v1\/recent-learning\//, route => route.fulfill(reply({ items: [{ ...draft, status: 'draft', updated_at: '2026-10-15T00:00:00Z' }] })));
  await page.route(/\/api\/v1\/drafts\//, route => {
    if (route.request().method() === 'DELETE') deletes += 1;
    return route.fulfill(reply(draft));
  });
  await page.route('**/api/v1/exams/N2_2020_07*', route => route.fulfill(reply({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2].map(id => ({ id, question: `刷新续考测试${id}`, options: ['一', '二'], correct_answer: 1 })) }] } })));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload();
  const home = page.locator('#student-learning-home > header h1');
  await expect(home).toHaveText('学习首页');
  await expect(page.locator('#learning-topbar')).toBeHidden();
  await expect(page.locator('#guest-welcome')).toBeHidden();
  await expect(page.locator('.pc-recent-practice')).toContainText('JLPT N2 · 2020年7月真题');
  await page.locator('.pc-continue-dock [data-role-admin-intent^="openStudentRecent:"]').click();
  await expect(page.locator('#learning-topbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.examViewer.currentQuestionIndex)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.examViewer.userAnswers['0:1'])).toBe(2);
  await page.reload();
  await expect(home).toHaveText('学习首页');
  await expect(page.locator('.pc-recent-practice')).toContainText('未交卷 · 已答1/2题');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-learning-archive'));
  await page.reload();
  await expect(home).toHaveText('学习首页');
  await expect(page.locator('#platform-admin-shell .pc-topbar-home')).toHaveCount(0);
  expect(deletes).toBe(0);
});

test('未登录刷新仍进入游客首页', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#guest-welcome')).toBeVisible();
  await page.reload();
  await expect(page.locator('#guest-welcome')).toBeVisible();
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
});

test('非首页顶部显示主页图标，做题返回首页先展示已保存的结果', async ({ page }, testInfo) => {
  await loginWithPassword(page, 'student_demo');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.navigateLearningWorkspace('__overview__'));
  const homeTitle = page.locator('#student-learning-home > header h1');
  const workspaceHome = page.locator('#platform-admin-shell .pc-topbar-home');
  const paperHome = page.locator('#learning-topbar .ls-topbar-home');
  await expect(homeTitle).toHaveText('学习首页');
  await expect(workspaceHome).toHaveCount(0);
  await expect(paperHome).toBeHidden();
  for (const width of [1600, 1090, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-learning-archive'));
    await expect(workspaceHome).toBeVisible();
    await expect(workspaceHome).toHaveAttribute('aria-label', '返回学习首页');
    const layout = await workspaceHome.evaluate(el => ({ home: el.getBoundingClientRect().x, menuRight: el.parentElement.querySelector('[data-platform-admin-nav-trigger]').getBoundingClientRect().right }));
    expect(layout.home).toBeGreaterThanOrEqual(layout.menuRight);
    if (width === 390) {
      await page.locator('#platform-admin-shell [data-platform-admin-nav-trigger]').click();
      await expect(page.locator('body')).toHaveClass(/ls-drawer-open/);
    }
    await workspaceHome.click();
    await expect(homeTitle).toHaveText('学习首页');
    await expect(workspaceHome).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/ls-drawer-open/);
  }
  await page.evaluate(async () => {
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2].map(id => ({ id, question: `首页入口测试${id}`, options: ['一', '二'], correct_answer: 1 })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.__homeEntryRecord = null;
    window.APIClient.listRecentLearning = async () => ({ items: [] });
    window.APIClient.saveSpecialtySession = async payload => {
      window.__homeEntryRecord = { submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: payload.questions.length, correct_count: 1, wrong_count: 0 } };
      return window.__homeEntryRecord;
    };
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === '__specialty' && window.__homeEntryRecord ? [window.__homeEntryRecord] : [];
    await window.examViewer.startSpecialtyPractice('首页入口测试', [1, 2].map(id => ({ examId: 'N2_2020_07', questionId: String(id) })));
    window.closeLearningWorkspace();
    window.examViewer.answerManager.selectOption('1', 1);
    window.examViewer.navigateToNextQuestion();
  });
  await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(1);
  await expect(paperHome).toBeVisible();
  await expect(paperHome).toHaveAttribute('aria-label', '返回学习首页');
  await page.screenshot({ path: testInfo.outputPath('paper-home-mobile.png') });
  await paperHome.click();
  await expect(page.locator('#exam-result-modal')).toBeVisible();
  await expect(page.locator('#exam-result-panel')).toContainText('正确率100%');
  await page.locator('#exam-result-panel').getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(homeTitle).toHaveText('学习首页');
  await expect(workspaceHome).toHaveCount(0);
  await expect(page.locator('.pc-recent-practice')).toContainText('已结束 · 1题');
  await page.evaluate(() => window.closeLearningWorkspace());
  await expect(paperHome).toBeVisible();
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(1);
  expect(await page.evaluate(() => window.examViewer.userAnswers['0:1'])).toBe(1);
  await page.setViewportSize({ width: 1600, height: 900 });
  const paperLeft = (await page.locator('#exam-content').boundingBox()).x;
  expect((await paperHome.boundingBox()).x).toBeCloseTo(paperLeft + 8, 0);
  await page.screenshot({ path: testInfo.outputPath('paper-home-desktop.png') });
  await page.locator('#learning-topbar .ls-mobile-toggle').click();
  const collapsedHome = await paperHome.boundingBox();
  const collapsedMenu = await page.locator('#learning-topbar .ls-mobile-toggle').boundingBox();
  expect(collapsedHome.x).toBeGreaterThanOrEqual(collapsedMenu.x + collapsedMenu.width);
  await paperHome.click();
  await expect(homeTitle).toHaveText('学习首页');
});

async function enterPaper(page) {
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-target="JLPT N3"]').click();
  await home.locator('[data-gw="browse"]:visible').last().click();
  await home.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(home).toBeHidden();
}

async function loginStudentFromPaper(page) {
  await page.locator('#learning-account #user-menu-trigger').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('[data-dev-login="student_demo"]').click();
  await expect(page.locator('#login-modal')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/ls-student-navigation/);
  await expect(page.locator('body')).toHaveClass(/ls-focused-practice/);
  await expect(page.locator('[data-ls-group="study"]')).toBeHidden();
  await expect(page.locator('#ls-current-paper')).toBeVisible();
  await page.locator('[data-ls-return-navigation]').click();
  await expect(page.locator('body')).not.toHaveClass(/ls-focused-practice/);
  const groupsAndPanels = await page.locator('.ls-menu').evaluate(menu =>
    [...menu.children]
      .filter(element => element.hasAttribute('data-ls-group') || ['study', 'practice', 'review'].includes(element.getAttribute('data-ls-panel')))
      .map(element => element.getAttribute('data-ls-group') || element.getAttribute('data-ls-panel'))
  );
  expect(groupsAndPanels).toEqual(['study', 'study', 'practice', 'practice', 'review', 'review']);
}

test('选定题型后显示简洁练习栏，可返回菜单并继续练习', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  await loginStudentFromPaper(page);
  await expect(page.locator('[data-ls-group="practice"]')).toBeVisible();
  await page.locator('[data-ls-continue]').click();
  await expect(page.locator('body')).toHaveClass(/ls-focused-practice/);
  await expect(page.locator('.ls-menu > [data-ls-group]').first()).toBeHidden();
  await expect(page.locator('#ls-current-paper')).toBeVisible();
  await expect(page.locator('.ls-range-summary')).toBeVisible();
  await expect(page.locator('.ls-settings')).toBeHidden();
  await expect(page.locator('#ls-page-tools #exam-settings-toggle')).toBeVisible();
  await expect(page.locator('#learning-topbar #ls-page-tools')).toBeVisible();
  await expect(page.locator('#exam-workarea #ls-page-tools')).toHaveCount(0);
  await page.locator('#ls-page-tools #exam-settings-toggle').click();
  await expect(page.locator('#ls-page-tools #exam-settings-menu')).toBeVisible();
  await page.locator('#ls-page-tools #exam-settings-toggle').click();
  await expect(page.locator('#ls-page-tools #exam-settings-menu')).toBeHidden();
  await page.locator('[data-ls-return-navigation]').click();
  await expect(page.locator('[data-ls-group="practice"]')).toBeVisible();
});

test('主题入口位于游客菜单底部，选择后保存且不占用练习设置', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const trigger = page.locator('.ls-theme-trigger');
  const themeMenu = page.locator('#ls-theme-menu');
  await expect(page.locator('.ls-rail')).toBeHidden();
  await expect(trigger).toBeVisible();
  await expect(page.locator('.ls-menu footer .ls-theme-trigger')).toBeVisible();
  await expect(page.locator('.ls-settings #theme-mode-select')).toHaveCount(0);
  await trigger.click();
  await themeMenu.locator('[data-theme-mode="dark"]').click();
  await expect(page.locator('body')).not.toHaveClass(/light-theme/);
  await page.reload();
  await trigger.click();
  await expect(themeMenu.locator('[data-theme-mode="dark"]')).toHaveAttribute('aria-checked', 'true');
  await themeMenu.locator('[data-theme-mode="light"]').click();
  await expect(page.locator('body')).toHaveClass(/light-theme/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.ls-mobile-toggle').click();
  await trigger.click();
  await expect(themeMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(themeMenu).toBeHidden();
  await expect(page.locator('.ls-menu')).toBeVisible();
});

test('左侧试卷导航复用题型与学习辅助，窄屏可打开菜单', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  await expect(page.locator('.ls-menu [data-ls-guest-action="jlpt"]')).toBeHidden();
  await expect(page.locator('.ls-selected-summary[data-family="jlpt"]')).toContainText('JLPT N3');
  await expect(page.locator('.ls-guest-paper-tools > summary')).toHaveCount(0);
  await expect(page.locator('#ls-current-paper')).toBeVisible();
  await expect(page.locator('#ls-current-paper')).toContainText('JLPT N3');
  await expect(page.locator('.ls-paper-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#ls-paper-fields select').first()).toBeHidden();
  await expect(page.locator('.ls-paper-picker')).toBeHidden();
  await expect(page.locator('#exam-command-bar')).toBeHidden();
  await expect(page.locator('#exam-settings-toggle')).toBeHidden();
  await expect(page.locator('#learning-account #user-menu-trigger')).toBeVisible();
  const desktopAccount = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(desktopAccount.width).toBe(28);
  expect(desktopAccount.y).toBe(10);
  expect(1600 - desktopAccount.x - desktopAccount.width).toBe(10);
  await expect(page.locator('.ls-rail')).toBeHidden();
  const menu = await page.locator('.ls-menu').boundingBox();
  const paper = await page.locator('#exam-content').boundingBox();
  expect(menu.x).toBe(0);
  expect(Math.round(menu.width)).toBe(240);
  expect(paper.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  expect(paper.y).toBe(0);
  expect(paper.x + paper.width).toBe(1600);
  const desktopSurround = await page.locator('#exam-content').evaluate(element => ({
    surround: getComputedStyle(element).backgroundColor,
    sheet: getComputedStyle(element.querySelector('.current-question')).backgroundColor,
    sheetWidth: element.querySelector('#current-question-container').getBoundingClientRect().width,
  }));
  expect(desktopSurround.surround).toBe('rgb(241, 242, 244)');
  expect(desktopSurround.sheet).toBe('rgb(255, 255, 255)');
  expect(desktopSurround.sheetWidth).toBeLessThan(paper.width);
  await page.setViewportSize({ width: 1180, height: 820 });
  const tabletPaper = await page.locator('#exam-content').boundingBox();
  expect(tabletPaper.y).toBe(0);
  expect(tabletPaper.x + tabletPaper.width).toBe(1180);
  const tabletEdges = await page.evaluate(() => {
    const menu = document.querySelector('.ls-menu');
    const question = document.querySelector('#current-question-container');
    return { menuBottomBorder: getComputedStyle(menu).borderBottomWidth,
      paperBottomBorder: getComputedStyle(document.querySelector('#exam-content')).borderBottomWidth,
      questionRight: question.getBoundingClientRect().right,
      questionBottom: question.getBoundingClientRect().bottom,
      bodyBottomPadding: getComputedStyle(document.body).paddingBottom };
  });
  expect(tabletEdges.menuBottomBorder).toBe('0px');
  expect(tabletEdges.paperBottomBorder).toBe('0px');
  expect(tabletEdges.questionRight).toBe(1180);
  expect(tabletEdges.questionBottom).toBeGreaterThanOrEqual(820);
  expect(tabletEdges.bodyBottomPadding).toBe('0px');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator('.ls-category-heading')).toBeHidden();
  await expect(page.locator('#ls-exam-controls')).toBeHidden();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await page.locator('.ls-settings summary').click();
  await expect(page.locator('.ls-paper-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#learning-menu-zh')).toBeVisible();
  const checked = await page.locator('#learning-menu-zh').getAttribute('aria-checked');
  await page.locator('#learning-menu-zh').click();
  await expect(page.locator('#learning-menu-zh')).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAccount = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(mobileAccount.width).toBe(24);
  expect(mobileAccount.y).toBe(6);
  expect(390 - mobileAccount.x - mobileAccount.width).toBe(6);
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('学员工作台在同一框架中切换，返回练习保留试卷', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  const question = await page.locator('.question-text').innerText();
  await loginStudentFromPaper(page);
  await page.locator('[data-ls-group="study"]').click();
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('[data-ls-group="study"]').evaluate(element =>
    Number(getComputedStyle(element, '::after').transform.match(/matrix\(([^,]+)/)?.[1])
  )).toBeLessThan(0);
  await expect(page.locator('.ls-rail')).toBeHidden();
  await expect(page.locator('.ls-menu > [data-ls-group]')).toHaveCount(3);
  await page.locator('[data-ls-intent="__overview__"]').click();
  await expect(page.locator('#platform-admin-shell .pc-learning-overview-intro h1')).toHaveText('学习总览');
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#platform-admin-shell')).toHaveAttribute('data-learning-role', 'student');
  await expect(page.locator('#platform-admin-shell .pc-platform-sidebar')).toBeHidden();
  await expect(page.locator('#platform-admin-shell .pc-workbench-step').first()).toBeVisible();
  await expect(page.locator('#exam-content')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('[data-ls-group="study"] > span')).toHaveText('学习安排');
  await expect(page.locator('[data-ls-group="study"] > span')).toBeVisible();
  await page.locator('[data-ls-intent="openRoleContent:student-today"]').click();
  await expect(page.locator('#platform-admin-shell .pc-learning-today-intro')).toContainText('今日计划');
  await expect(page.locator('#platform-admin-shell section[aria-label="今日计划"]')).toBeVisible();
  await expect(page.locator('#platform-admin-shell .pc-goal-summary')).toHaveCount(0);
  await expect(page.locator('[data-ls-intent="openRoleContent:student-today"]')).toHaveClass(/is-active/);
  await page.locator('[data-ls-intent="openAssignments"]').click();
  await expect(page.locator('[data-ls-intent="openAssignments"]')).toHaveClass(/is-active/);
  await page.locator('[data-ls-group="review"]').click();
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-ls-panel="review"]')).toContainText('错题与收藏');
  await expect(page.locator('[data-ls-panel="review"]')).toContainText('最近学习');
  await expect(page.locator('[data-ls-panel="review"]')).toContainText('学习报告');
  await page.locator('[data-ls-intent="openRoleContent:student-review-library"]').click();
  await expect(page.locator('#platform-admin-shell')).toContainText('错题本');
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('[data-ls-group="practice"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ls-group="practice"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-ls-group="study"]')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await expect(page.locator('#exam-content')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.question-text')).toHaveText(question);
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('[data-ls-group="practice"]')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('[data-ls-group="practice"]').evaluate(element =>
    Number(getComputedStyle(element, '::after').transform.match(/matrix\(([^,]+)/)?.[1])
  )).toBeGreaterThan(0);
  await expect(page.locator('[data-ls-panel="practice"]')).toBeHidden();
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('[data-ls-panel="practice"]')).toBeVisible();
  await page.locator('.ls-collapse').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(page.locator('.ls-mobile-toggle')).toBeVisible();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('.ls-backdrop')).toBeHidden();
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('[data-ls-panel="practice"]')).toBeHidden();
  await page.locator('[data-ls-group="practice"]').click();
  await expect(page.locator('[data-ls-panel="practice"]')).toBeVisible();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(page.locator('.question-text')).toHaveText(question);
});

test.describe('学员侧栏触屏操作', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('展开项留在标题下方，连点同一位置立即展开并折叠', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await enterPaper(page);
    await loginStudentFromPaper(page);
    const study = page.locator('[data-ls-group="study"]');
    const practice = page.locator('[data-ls-group="practice"]');
    await practice.click();
    await study.click();
    await expect(study).toHaveAttribute('aria-expanded', 'true');
    const studyBox = await study.boundingBox();
    const studyPanelBox = await page.locator('[data-ls-panel="study"]').boundingBox();
    const initial = await practice.boundingBox();
    expect(studyPanelBox.y).toBeGreaterThanOrEqual(studyBox.y + studyBox.height);
    expect(studyPanelBox.y + studyPanelBox.height).toBeLessThanOrEqual(initial.y);
    const x = initial.x + initial.width / 2;
    const y = initial.y + initial.height / 2;
    await page.touchscreen.tap(x, y);
    await expect(practice).toHaveAttribute('aria-expanded', 'true');
    await expect(study).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-ls-panel="study"]')).toBeVisible();
    const opened = await practice.boundingBox();
    expect(opened.y).toBe(initial.y);
    const practicePanelBox = await page.locator('[data-ls-panel="practice"]').boundingBox();
    expect(practicePanelBox.y).toBeGreaterThanOrEqual(opened.y + opened.height);
    await page.touchscreen.tap(opened.x + opened.width / 2, opened.y + opened.height / 2);
    await expect(practice).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-ls-panel="practice"]')).toBeHidden();
  });
});

test('学习工作台在桌面、平板和手机上盖住原试卷，精简顶栏不重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await enterPaper(page);
  const question = await page.locator('.question-text').innerText();
  await loginStudentFromPaper(page);
  await page.locator('[data-ls-group="study"]').click();
  await page.locator('[data-ls-intent="__overview__"]').click();
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-learning-archive'));
  for (const width of [1600, 1180, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#platform-admin-shell').getBoundingClientRect();
      const header = document.querySelector('#platform-admin-shell .pc-platform-topbar').getBoundingClientRect();
      const back = document.querySelector('#platform-admin-shell .pc-topbar-back').getBoundingClientRect();
      const account = document.querySelector('#platform-admin-shell .pc-platform-account').getBoundingClientRect();
      const workspace = document.querySelector('#platform-admin-shell .pc-platform-workspace').getBoundingClientRect();
      const paperLeft = workspace.left + (workspace.width - Math.min(workspace.width, 994)) / 2;
      const paperRight = workspace.left + (workspace.width + Math.min(workspace.width, 994)) / 2;
      return { panelTop: panel.top, headerTop: header.top, headerBottom: header.bottom,
        backTop: back.top, backBottom: back.bottom, backLeft: back.left, backRight: back.right, accountLeft: account.left,
        accountRight: account.right, paperLeft, paperRight,
        examVisibility: getComputedStyle(document.querySelector('#exam-content')).visibility };
    });
    expect(layout.panelTop).toBe(0);
    expect(layout.headerTop).toBe(0);
    expect(layout.headerBottom).toBe(44);
    expect(layout.examVisibility).toBe('hidden');
    await expect(page.locator('#learning-topbar .ls-brand')).toHaveCount(0);
    await expect(page.locator('#platform-admin-shell .pc-topbar-home')).toBeVisible();
    expect(layout.backTop).toBeGreaterThanOrEqual(layout.headerTop - 1);
    expect(layout.backBottom).toBeLessThanOrEqual(layout.headerBottom + 1);
    expect(layout.backRight).toBeLessThanOrEqual(layout.accountLeft);
    if (width >= 1024) expect(Math.abs(layout.backLeft - layout.paperLeft - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.accountRight - layout.paperRight)).toBeLessThanOrEqual(16);
    await expect(page.locator('#learning-topbar')).toBeHidden();
    await expect(page.locator('#platform-admin-shell [data-platform-admin-nav-trigger]')).toBeVisible();
    if (width === 390) {
      await page.locator('#platform-admin-shell [data-platform-admin-nav-trigger]').click();
      await expect(page.locator('.ls-menu')).toBeVisible();
      expect((await page.locator('.ls-menu').boundingBox()).y).toBe(44);
      await page.locator('#platform-admin-shell [data-platform-admin-nav-trigger]').click();
      await expect(page.locator('.ls-menu')).toBeHidden();
    }
  }
  await expect(page.locator('#platform-admin-shell .pc-topbar-home')).toHaveAttribute('aria-label', '返回学习首页');
  await expect(page.locator('#platform-admin-shell .pc-topbar-home svg')).toBeVisible();
  await expect(page.locator('#platform-admin-shell .pc-platform-admin-user div')).toBeHidden();
  await page.locator('#platform-admin-shell [data-platform-admin-account-menu]').click();
  await expect(page.locator('#platform-admin-shell .pc-platform-account-menu')).toContainText('学员');
  await page.locator('#platform-admin-shell .pc-topbar-home').click();
  await expect(page.locator('#student-learning-home > header h1')).toHaveText('学习首页');
  await expect(page.locator('#platform-admin-shell .pc-topbar-home')).toHaveCount(0);
  await page.evaluate(() => window.closeLearningWorkspace());
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await expect(page.locator('#exam-content')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.question-text')).toHaveText(question);
});

test('学员侧栏在平板保持展开，手机使用抽屉', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginWithPassword(page, 'student_demo');
  await expect(page.locator('body')).toHaveClass(/ls-student-navigation/);
  await expect(page.locator('.ls-rail')).toBeHidden();
  await expect(page.locator('.ls-menu > [data-ls-group]')).toHaveCount(3);
  await expect(page.locator('#ls-page-tools #open-question-map')).toHaveCount(1);
  await expect(page.locator('#ls-page-tools #submit-exam')).toHaveCount(1);
  await expect(page.locator('#ls-page-tools #exam-settings-control')).toHaveCount(1);
  await expect(page.locator('#learning-topbar #ls-page-tools')).toBeVisible();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('#learning-topbar .ls-brand')).toHaveCount(0);
  await expect(page.locator('.ls-menu header')).toBeHidden();
  expect(Math.round((await page.locator('.ls-menu').boundingBox()).width)).toBe(240);
  const paper = await page.locator('#exam-content').boundingBox();
  const toolbar = await page.locator('#learning-topbar').boundingBox();
  const tools = await page.locator('#ls-page-tools').boundingBox();
  const account = await page.locator('#learning-account').boundingBox();
  expect(paper.x).toBeGreaterThanOrEqual(240);
  expect(paper.y).toBe(44);
  expect(toolbar.x).toBe(0);
  expect(toolbar.width).toBe(1600);
  expect(toolbar.height).toBe(44);
  expect((await page.locator('.ls-menu').boundingBox()).y).toBe(44);
  expect(tools.x + tools.width).toBeLessThanOrEqual(account.x);
  const desktopPaper = await page.locator('#current-question-container').boundingBox();
  expect(Math.abs(desktopPaper.x + desktopPaper.width - account.x - account.width - 8)).toBeLessThanOrEqual(2);
  await expect(page.locator('#question-navigation .question-counter')).toHaveText(/^\d+ \/ \d+$/);
  const navigationWidth = await page.locator('#question-navigation .question-nav').evaluate(element => element.getBoundingClientRect().width);
  expect(navigationWidth).toBeLessThan(340);
  const navigationColors = await page.locator('#question-navigation').evaluate(element => ({
    option: getComputedStyle(document.querySelector('.option')).backgroundColor,
    previous: getComputedStyle(element.querySelector('.prev-btn')).backgroundColor,
    next: getComputedStyle(element.querySelector('.next-btn')).backgroundColor,
  }));
  expect(navigationColors.previous).toBe(navigationColors.option);
  expect(navigationColors.next).toBe(navigationColors.option);
  const counterBefore = await page.locator('#question-navigation .question-counter').innerText();
  await page.locator('#question-navigation .next-btn').click();
  await expect(page.locator('#question-navigation .question-counter')).not.toHaveText(counterBefore);
  await page.locator('#question-navigation .prev-btn').click();
  await expect(page.locator('#question-navigation .question-counter')).toHaveText(counterBefore);
  await expect(page.locator('#ls-page-tools .answer-card-icon svg')).toHaveCSS('width', '22px');
  await expect(page.locator('#ls-page-tools #exam-settings-toggle svg')).toHaveCSS('width', '22px');
  await expect(page.locator('#learning-account #user-menu-trigger')).toHaveCSS('width', '28px');
  const desktopAvatar = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(Math.abs(desktopAvatar.y - 7.5)).toBeLessThanOrEqual(.5);
  expect(Math.abs(toolbar.y + toolbar.height - desktopAvatar.y - desktopAvatar.height - 8.5)).toBeLessThanOrEqual(.5);

  await page.locator('#learning-topbar .ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('#learning-topbar .ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('.ls-backdrop')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/ls-menu-collapsed/);

  await page.setViewportSize({ width: 820, height: 900 });
  const tabletAccount = await page.locator('#learning-account').boundingBox();
  const tabletPaper = await page.locator('#current-question-container').boundingBox();
  expect(Math.abs(tabletPaper.x + tabletPaper.width - tabletAccount.x - tabletAccount.width - 8)).toBeLessThanOrEqual(2);
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('.ls-mobile-toggle')).toBeVisible();
  expect(Math.round((await page.locator('.ls-menu').boundingBox()).width)).toBe(240);
  await expect(page.locator('.ls-backdrop')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  expect(Math.round((await page.locator('.ls-menu').boundingBox()).width)).toBe(240);
  await page.locator('[data-ls-group="study"]').click();
  await expect(page.locator('[data-ls-panel="study"]')).toBeVisible();
  await page.locator('[data-ls-intent="__overview__"]').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('#platform-admin-shell')).toBeVisible();
  expect(Math.round((await page.locator('#platform-admin-shell').boundingBox()).y)).toBe(44);
  await page.evaluate(() => window.closeLearningWorkspace());
  await expect(page.locator('#platform-admin-shell')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(page.locator('#learning-topbar')).toHaveCSS('height', '44px');
  await expect(page.locator('#ls-page-tools #exam-settings-toggle')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('#ls-page-tools .answer-card-icon svg')).toHaveCSS('width', '22px');
  await expect(page.locator('#ls-page-tools #exam-settings-toggle svg')).toHaveCSS('width', '22px');
  await expect(page.locator('#learning-account #user-menu-trigger')).toHaveCSS('width', '28px');
  const mobileAvatar = await page.locator('#learning-account #user-menu-trigger').boundingBox();
  expect(Math.abs(mobileAvatar.y - 7.5)).toBeLessThanOrEqual(.5);
  expect(mobileAvatar.height).toBe(28);
  const compactTools = await page.locator('#ls-page-tools').boundingBox();
  const compactAccount = await page.locator('#learning-account').boundingBox();
  expect(compactTools.x + compactTools.width).toBeLessThanOrEqual(compactAccount.x);
  expect(compactAccount.x + compactAccount.width).toBeLessThanOrEqual(390);
  const mobilePaper = await page.locator('#current-question-container').boundingBox();
  expect(Math.abs(mobilePaper.x + mobilePaper.width - compactAccount.x - compactAccount.width - 8)).toBeLessThanOrEqual(2);
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-menu')).toBeHidden();

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator('.ls-menu')).toBeVisible();
  await page.locator('.ls-collapse').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  const collapsedAccount = await page.locator('#learning-account').boundingBox();
  const collapsedPaper = await page.locator('#current-question-container').boundingBox();
  expect(Math.abs(collapsedPaper.x + collapsedPaper.width - collapsedAccount.x - collapsedAccount.width - 8)).toBeLessThanOrEqual(2);
  await expect(page.locator('.ls-mobile-toggle')).toBeVisible();
  await expect(page.locator('#learning-topbar')).toHaveCSS('height', '44px');
  expect(Math.round((await page.locator('#exam-content').boundingBox()).y)).toBe(44);
  const collapsedToggleIcon = await page.locator('.ls-mobile-toggle-mark').evaluate(element => ({
    width: element.getBoundingClientRect().width,
    before: getComputedStyle(element, '::before').content,
    after: getComputedStyle(element, '::after').content,
  }));
  expect(collapsedToggleIcon).toEqual({ width: 20, before: '""', after: '""' });
  await page.reload();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('learningStudentNavCollapsed'))).toBe('false');
});
