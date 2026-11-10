const { test, expect } = require('@playwright/test');
const { loginWithPassword, stubPracticeDraftSync } = require('./helpers/session');
const { openTaskDetails } = require('./helpers/task-navigation');

async function startSession(page, review = false) {
  await stubPracticeDraftSync(page);
  await loginWithPassword(page, 'student_demo');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async review => {
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N3', sections: [{ section_type: 'vocabulary', section_name: '問題2 - 表記', questions: [1, 2, 3].map(id => ({ id, question: `底栏测试题${id}`, options: ['正确选项', '错误选项'], correct_answer: 1, explanation: '这里是题目解析。'.repeat(100) })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    const refs = [{ examId: 'N3_2010_07', questionId: '2' }, { examId: 'N3_2011_07', questionId: '1' }, { examId: 'N3_2010_07', questionId: '3' }];
    await window.examViewer.startSpecialtyPractice('問題2 - 表記', refs, review, { mode: review ? 'correct' : 'unanswered' });
    window.dispatchEvent(new Event('specialtyPracticeOpened'));
  }, review);
  await expect(page.locator('.task-nav')).toBeVisible();
}

test('统一底栏显示本次进度，题卡跨试卷跳转且不提前透露答案', async ({ page }, testInfo) => {
  await startSession(page);
  const nav = page.locator('.task-nav');
  await expect(nav.locator('#task-session-panel')).toBeHidden();
  await expect(nav.locator('.task-details-toggle')).toHaveText('');
  await expect(nav.getByRole('button', { name: '结束练习', exact: true })).toBeVisible();
  await expect(nav.locator('#task-session-panel .exit-specialty-btn')).toHaveCount(0);
  await openTaskDetails(page);
  await expect(nav.locator('#task-session-panel').getByRole('button', { name: '答题卡', exact: true })).toHaveCount(0);
  await expect(nav.locator('.task-panel-actions')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(nav.locator('#task-session-panel')).toBeHidden();
  await expect(nav.locator('.task-details-toggle')).toBeFocused();
  await openTaskDetails(page);
  await page.locator('.question-text').click({ position: { x: 1, y: 1 } });
  await expect(nav.locator('#task-session-panel')).toBeHidden();
  await expect(nav.locator('.task-title')).toHaveText('JLPT N3 · 問題2 - 表記');
  await expect(nav.locator('.task-progress')).toHaveText('已答 0/3 题');
  await expect(page.locator('.specialty-question-number')).toHaveText('1.');
  await expect(nav.locator('#specialty-question-source')).toContainText('第2题');
  await expect(page.locator('#open-question-map')).toBeHidden();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await expect(nav.locator('.task-progress')).toHaveText('已答 1/3 题');
  await nav.locator('.question-counter').click();
  const sheet = page.locator('#question-map-overlay');
  await expect(sheet.locator('.question-map-item')).toHaveCount(3);
  await expect(sheet.locator('.question-map-item.correct, .question-map-item.incorrect')).toHaveCount(0);
  await expect(sheet.locator('[data-specialty-index="0"]')).toHaveClass(/answered/);
  await page.screenshot({ path: testInfo.outputPath('task-sheet-desktop.png') });
  await sheet.locator('[data-specialty-index="1"]').click();
  await expect(sheet).toBeHidden();
  await expect(nav.locator('.question-counter')).toHaveText('2 / 3');
  await expect(page.locator('.specialty-question-number')).toHaveText('2.');
  await expect(nav.locator('#specialty-question-source')).toContainText('第1题');
  await expect(nav.locator('.question-counter')).toBeFocused();
  expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe('N3_2011_07');
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await page.mouse.move(0, 0);
  const colors = await nav.locator('.prev-btn, .next-btn').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return [style.color, style.backgroundColor, style.borderColor];
  }));
  expect(colors[0]).toEqual(colors[1]);
  await nav.locator('.question-counter').press('Enter');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav.locator('.question-counter')).toBeFocused();
  await nav.locator('.question-counter').press('Space');
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-specialty-index="0"]').click();
  await expect(page.locator('.specialty-question-number')).toHaveText('1.');
  await expect(nav.locator('.question-counter')).toBeFocused();
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '2'))).toBe(2);
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('task-bar-desktop.png') });
  for (const width of [1180, 820, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(nav).toBeVisible();
    await expect.poll(async () => nav.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; })).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const content = document.querySelector('#current-question-container .question-content').getBoundingClientRect();
      const bar = document.querySelector('.task-nav').getBoundingClientRect();
      return Math.max(Math.abs(content.left - bar.left), Math.abs(content.right - bar.right));
    })).toBeLessThanOrEqual(1);
    await expect(nav.locator('#task-session-panel')).toBeHidden();
    expect((await nav.boundingBox()).height).toBeLessThanOrEqual(64);
    for (const button of await nav.getByRole('button').all()) if (await button.isVisible()) await expect(button).toBeInViewport();
    const prev = await nav.locator('.prev-btn').boundingBox();
    const next = await nav.locator('.next-btn').boundingBox();
    const toggle = await nav.locator('.task-details-toggle').boundingBox();
    const exit = await nav.locator('.exit-specialty-btn').boundingBox();
    const counter = await nav.locator('.question-counter').boundingBox();
    expect(Math.abs(prev.y - next.y)).toBeLessThan(2);
    expect(Math.abs(toggle.y - next.y)).toBeLessThan(2);
    expect(Math.abs(exit.y - next.y)).toBeLessThan(2);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(exit.x);
    expect(exit.x + exit.width).toBeLessThan(counter.x);
    expect(counter.x + counter.width).toBeLessThanOrEqual(prev.x);
    expect(prev.x + prev.width).toBeLessThanOrEqual(next.x);
    await expect(nav.locator('.exit-specialty-btn')).toHaveText('');
    await expect(nav.locator('.exit-specialty-btn')).toHaveAttribute('title', '结束练习');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('task-bar-mobile.png') });
  await openTaskDetails(page);
  await page.screenshot({ path: testInfo.outputPath('task-details-mobile.png') });
  await nav.locator('.question-counter').click();
  await page.screenshot({ path: testInfo.outputPath('task-sheet-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(nav.locator('.question-counter')).toBeFocused();
});

test('已提交整卷回顾保留原解析分段，题目解析与补充解析分别显示', async ({ page }, testInfo) => {
  await startSession(page);
  await page.evaluate(() => {
    const core = '【题目解析】\n「石油」是固定词汇。\n\n【为什么选3】\n读作「せきゆ」。\n\n【误选项为什么不对】\n其他选项读音不正确。\n\n【拿分提醒】\n按整词记忆。';
    const extra = '【补充解析】\n不要拆字猜读音。\n\n【实战方法】\n直接按整词判断。\n\n【常见搭配】\n石油を輸入する。';
    const apply = data => {
      for (const section of data.exam_info.sections) for (const question of section.questions) {
        question.explanation = core;
        question.explanation_expand = extra;
      }
      return data;
    };
    const getExam = window.APIClient.getExam;
    window.APIClient.getExam = async id => apply(await getExam(id));
    apply(window.examViewer.currentExam);
    window.examViewer.renderExam();
    window.examViewer.answerManager.selectOption('2', 1);
  });
  await page.locator('.specialty-confirm-answer').click();
  const blocks = page.locator('#current-question-container .explanation');
  await expect(blocks).toHaveCount(2);
  const practiceHtml = await blocks.evaluateAll(elements => elements.map(el => el.innerHTML));
  await page.evaluate(async () => {
    await window.examViewer.startWholePaperPractice('N3_2010_07', 'JLPT N3 · 2010年7月真题', {
      returnContext: { surface: 'paper', wholePaper: true },
      record: { answers: { '0:1': 1 }, statistics: { results: { '0:1': { status: 'correct' } } } }
    });
  });
  await expect(page.locator('#specialty-practice-mode')).toHaveText('整套回顾');
  await expect(page.locator('.specialty-explanation-details')).toHaveCount(0);
  await expect(blocks).toHaveCount(2);
  expect(await blocks.evaluateAll(elements => elements.map(el => el.innerHTML))).toEqual(practiceHtml);
  await expect(blocks.first().locator('.explain-label')).toHaveText(['【题目解析】', '【为什么选3】', '【误选项为什么不对】', '【拿分提醒】']);
  await expect(blocks.last().locator('.explain-label')).toHaveText(['【补充解析】', '【实战方法】', '【常见搭配】']);
  await expect(blocks.last()).not.toContainText('拿分提醒');
  await expect(blocks.last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('submitted-explanation-blocks-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(blocks.first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('submitted-explanation-blocks-mobile.png'), fullPage: true });
});

test('回顾底栏固定返回入口，最后一题不改变翻题动作', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession(page, true);
  const nav = page.locator('.task-nav');
  await expect(nav.locator('.task-progress')).toHaveText('共 3 题 · 回顾不计入练习统计');
  await openTaskDetails(page);
  await nav.locator('.question-counter').click();
  const sheet = page.locator('#question-map-overlay');
  await expect(sheet.locator('.question-map-item.correct')).toHaveCount(3);
  await expect(sheet.locator('[data-question-map-submit]')).toBeHidden();
  await sheet.locator('[data-specialty-index="2"]').click();
  await expect(nav.locator('.next-btn')).toHaveText('最后一题');
  await expect(nav.locator('.next-btn')).toBeDisabled();
  await expect(nav.getByRole('button', { name: '返回专项', exact: true })).toBeVisible();
  await expect(nav.locator('#task-session-panel')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => {
    const explanation = document.querySelector('.explanation').getBoundingClientRect();
    const bar = document.querySelector('.task-nav').getBoundingClientRect();
    return explanation.bottom <= bar.top - 8;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('task-review-mobile.png') });
  await nav.getByRole('button', { name: '返回专项', exact: true }).click();
  await expect(page.locator('#student-learning-home')).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
});

test('专项查看答案前全部辅助置灰，查看后默认全开且跨题不泄露', async ({ page }, testInfo) => {
  await startSession(page);
  await page.evaluate(() => {
    window.TranslationManager = { loadForExam: async () => {}, getRuby: () => '<ruby>漢字<rt>かんじ</rt></ruby>', getSentence: () => '测试中文译文' };
    const viewer = window.examViewer;
    viewer.showReadingKana = false;
    viewer.showReadingZh = false;
    viewer.renderExam();
  });
  const kana = page.locator('#learning-menu-kana');
  const zh = page.locator('#learning-menu-zh');
  const assists = page.locator('#learning-tools-menu button');
  const expectAssists = async unlocked => {
    await expect(assists).toHaveCount(4);
    for (const button of await assists.all()) {
      if (unlocked) await expect(button).toBeEnabled(); else await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-checked', String(unlocked));
    }
  };
  await page.locator('#exam-settings-toggle').click();
  await expect(page.locator('#exam-settings-menu .exam-mode-field')).toBeHidden();
  await expect(page.locator('#exam-settings-menu .exam-settings-heading span')).toBeHidden();
  await expect(kana).toBeDisabled();
  await expect(zh).toBeDisabled();
  await expectAssists(false);
  await expect(kana).toHaveAttribute('aria-checked', 'false');
  await expect(kana).toHaveAttribute('title', '查看本题答案后可使用');
  await expect(page.locator('#current-question-container ruby, #current-question-container .sentence-zh')).toHaveCount(0);
  await page.evaluate(() => { window.examViewer.toggleReadingKana(true); window.examViewer.toggleReadingZh(true); });
  expect(await page.evaluate(() => window.examViewer.canUseReadingAssists())).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('unanswered-assists-desktop.png') });
  await page.locator('#exam-settings-toggle').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 1));
  await expectAssists(false);
  await page.locator('.specialty-confirm-answer').click();
  await expect(kana).toBeEnabled();
  await expect(zh).toBeEnabled();
  await expectAssists(true);
  await page.locator('#exam-settings-toggle').click();
  await page.screenshot({ path: testInfo.outputPath('review-all-assists-enabled.png') });
  await kana.click();
  await expect(kana).toHaveAttribute('aria-checked', 'false');
  await kana.click();
  await page.locator('#exam-settings-toggle').click();
  await expect(page.locator('#current-question-container ruby').first()).toBeVisible();
  await expect(page.locator('#current-question-container .sentence-zh').first()).toContainText('测试中文译文');
  await page.locator('.task-nav .next-btn').click();
  await expect(page.locator('.question-counter')).toHaveText('2 / 3');
  await expect(kana).toBeDisabled();
  await expect(zh).toBeDisabled();
  await expectAssists(false);
  await page.evaluate(() => window.examViewer.questionRenderer.renderCurrentQuestion());
  await expect(page.locator('#current-question-container ruby, #current-question-container .sentence-zh')).toHaveCount(0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#exam-settings-toggle').click();
    await expect(page.locator('#exam-settings-menu .exam-mode-field')).toBeHidden();
    expect(await page.locator('#exam-settings-menu').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`unanswered-assists-${width}.png`) });
    await page.locator('#exam-settings-toggle').click();
  }
  await page.locator('.task-nav .prev-btn').click();
  await expectAssists(true);
  await expect(kana).toBeEnabled();
  await expect(page.locator('#current-question-container ruby').first()).toBeVisible();
  await page.locator('.task-nav .next-btn').click();
  await expect(page.locator('.question-counter')).toHaveText('2 / 3');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  await page.locator('.task-nav .next-btn').click();
  await expect(page.locator('.question-counter')).toHaveText('3 / 3');
  await page.locator('.task-nav .prev-btn').click();
  await expect(page.locator('.question-counter')).toHaveText('2 / 3');
  // A recorded answer still needs the explicit review action before assists unlock.
  await expectAssists(false);
  await page.getByRole('button', { name: '查看解析', exact: true }).click();
  await expectAssists(true);
  await page.evaluate(async () => {
    const viewer = window.examViewer;
    const refs = viewer.specialtyPractice.questions;
    await viewer.startSpecialtyPractice('漢字読み', refs, false, { mode: 'wrong' });
  });
  await expect(kana).toBeDisabled();
  await expectAssists(false);
  await expect(page.locator('#current-question-container ruby')).toHaveCount(0);
  await page.evaluate(async () => {
    const viewer = window.examViewer;
    await viewer.startSpecialtyPractice('漢字読み', viewer.specialtyPractice.questions, true, { mode: 'correct' });
  });
  await expect(kana).toBeEnabled();
  await expect(zh).toBeEnabled();
  await expectAssists(true);
  await expect(page.locator('#current-question-container ruby').first()).toBeVisible();
  await expect(page.locator('#exam-settings-menu .exam-mode-field')).toBeHidden();
});

test('题干右侧星标收藏与更多菜单保留原操作，手机不溢出', async ({ page }, testInfo) => {
  await startSession(page);
  await page.evaluate(() => {
    window.__toolBookmarks = [];
    window.APIClient.getBookmarks = async () => ({ questions: window.__toolBookmarks });
    window.APIClient.listBookmarkFolders = async () => ({ items: [] });
    window.APIClient.addQuestionBookmark = async (_user, payload) => { window.__toolBookmarks.push(payload); return { questions: window.__toolBookmarks }; };
    const renderer = window.examViewer.questionRenderer;
    renderer.bookmarkReads.clear();
    renderer.bookmarkedQuestions.clear();
    renderer.isAdmin = () => false;
    window.examViewer.renderExam();
  });
  const star = page.locator('.specialty-bookmark-star');
  const more = page.getByRole('button', { name: '更多题目操作', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await more.click();
  await expect(page.getByRole('menuitem', { name: '报错', exact: true })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: '编辑', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.press('ArrowDown');
  await page.getByRole('menuitem', { name: '报错', exact: true }).click();
  await expect(page.locator('.fb-category')).toBeFocused();
  await expect(page.locator('.specialty-more-menu')).toBeHidden();
  await page.locator('.fb-cancel').click();
  await expect(more).toBeFocused();
  await star.click();
  await expect(page.locator('.qb-folder')).toBeFocused();
  await page.locator('.qb-submit').click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(star).toHaveClass(/is-bookmarked/);
  await page.evaluate(() => { window.examViewer.questionRenderer.isAdmin = () => true; window.examViewer.renderExam(); });
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await more.click();
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await expect(page.locator('.edit-dialog-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await page.locator('.specialty-question-body').click();
  await expect(page.locator('.specialty-more-menu')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('inline-tools-desktop.png') });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(star).toBeInViewport();
    await expect(more).toBeInViewport();
    const tools = await page.locator('.specialty-question-tools').boundingBox();
    const stem = await page.locator('.specialty-question-text').boundingBox();
    expect(Math.abs(tools.y - stem.y)).toBeLessThan(8);
    expect(await page.locator('#current-question-container').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await more.click();
    await expect(page.locator('.specialty-more-menu')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`inline-tools-${width}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('普通练习与考试共用底栏，手机翻题同排且检查答案留在题目附近', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession(page);
  await page.evaluate(() => {
    const viewer = window.examViewer;
    viewer.specialtyPractice = null;
    viewer.userAnswers = {};
    viewer.setPracticeScope('词汇 / 语法', [0], true);
    viewer.renderExam();
  });
  const nav = page.locator('.task-nav');
  await expect(page.locator('#task-check-answer')).toBeVisible();
  await expect(nav.locator('.check-btn')).toHaveCount(0);
  await expect(nav.locator('.task-progress')).toHaveText('已答 0/3 题');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 1));
  await expect(nav.locator('.task-progress')).toHaveText('已答 1/3 题');
  await page.locator('#task-check-answer .check-btn').click();
  await expect(page.locator('#task-check-answer .check-btn')).toHaveText('回答正确');
  await expect(nav.locator('#task-session-panel')).toBeHidden();
  await expect(nav.getByRole('button', { name: '结束练习', exact: true })).toBeVisible();
  expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('task-standard-practice-mobile.png') });
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await page.locator('#learning-topbar .ls-topbar-home').click();
  await expect(page.locator('#student-learning-home')).toBeVisible();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('home-without-background-scrubber.png') });
  await page.evaluate(() => window.closeLearningWorkspace());
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '2'))).toBe(1);
  await page.evaluate(() => {
    const viewer = window.examViewer;
    viewer.practiceScope = null;
    viewer.examMode = 'mock';
    viewer.checkedPracticeQuestions.clear();
    viewer.renderExam();
  });
  await expect(page.locator('#task-check-answer')).toHaveCount(0);
  await expect(nav.locator('.task-mode')).toHaveText('考试');
  await openTaskDetails(page);
  await nav.locator('.question-counter').click();
  const sheet = page.locator('#question-map-overlay');
  await expect(sheet.locator('.question-map-item')).toHaveCount(3);
  await expect(sheet.locator('[data-question-map-submit]')).toBeVisible();
  await sheet.locator('[data-question="0"]').click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.examViewer.currentQuestionIndex)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('task-standard-exam-mobile.png') });
});
