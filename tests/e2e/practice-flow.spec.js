const { test, expect } = require('@playwright/test');
const { openTaskDetails } = require('./helpers/task-navigation');

async function enterPractice(page, family, domain, paperId) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator(`[data-gw="${family}"]`).click();
  if (family === 'jlpt') await home.locator('[data-target="JLPT N3"]').click();
  await (domain ? home.locator(`[data-gw="browse"][data-domain="${domain}"]`) : home.locator('[data-gw="browse"]:visible').last()).click();
  if (paperId) {
    const paper = home.locator(`[data-gw="paper"][data-exam="${paperId}"]`);
    if (!(await paper.isVisible())) await home.locator('.gw-earlier-years summary').click();
    await paper.click();
  } else {
    await home.locator('[data-gw="paper"]').first().click();
  }
  await expect(home.locator('[data-practice-section]').first()).toBeVisible();
  if (!domain) for (const checkbox of await home.locator("[data-practice-section]").all()) await checkbox.check();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(home).toBeHidden();
}

test('游客练习移除刻度与占位，各宽度保留底栏翻题和题目列表', async ({ page }, testInfo) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await expect(page.locator('.ls-rail')).toBeHidden();
  for (const width of [1600, 1201, 1200, 1000, 820, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const menu = await page.locator('.ls-menu').boundingBox();
    const paper = await page.locator('#exam-content').boundingBox();
    expect(menu.x).toBe(Math.max(0, (width - 240 - 994) / 2));
    expect(menu.width).toBe(240);
    expect(paper.x).toBe(menu.x + menu.width);
    expect(paper.width).toBeLessThanOrEqual(994);
    await expect.poll(() => page.evaluate(() => {
      const content = document.querySelector('#current-question-container .question-content').getBoundingClientRect();
      const bar = document.querySelector('.task-nav').getBoundingClientRect();
      return Math.max(Math.abs(content.left - bar.left), Math.abs(content.right - bar.right));
    })).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  }
  for (const width of [767, 701]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.ls-menu')).toBeHidden();
    await expect(page.locator('.ls-mobile-toggle')).toBeVisible();
    await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  }
  for (const width of [768, 701, 700, 600, 520, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.task-nav')).toBeVisible();
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).not.toHaveClass(/practice-scrubber-active/);
  expect((await page.locator('#exam-content').boundingBox()).x).toBe(0);
  const nav = page.locator('.task-nav');
  await nav.locator('.next-btn').click();
  await expect(nav.locator('.question-counter')).toHaveText(/^2 \/ /);
  await nav.locator('.prev-btn').click();
  await expect(nav.locator('.question-counter')).toHaveText(/^1 \/ /);
  await nav.locator('.question-counter').click();
  await expect(page.locator('#question-map-overlay')).toBeVisible();
  await page.locator('#question-map-content .question-map-item').nth(1).click();
  await expect(page.locator('#question-map-overlay')).toBeHidden();
  await expect(nav.locator('.question-counter')).toHaveText(/^2 \/ /);
  await page.screenshot({ path: testInfo.outputPath('guest-practice-without-left-ticks.png') });
});

test('iPad 竖屏默认显示两栏，窄屏改用抽屉', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  for (const width of [768, 820, 1024, 1180]) {
    await page.setViewportSize({ width, height: 1180 });
    const layout = await page.evaluate(() => {
      const rail = document.querySelector('.ls-rail').getBoundingClientRect();
      const menu = document.querySelector('.ls-menu').getBoundingClientRect();
      const paper = document.querySelector('#current-question-container').getBoundingClientRect();
      const options = [...document.querySelectorAll('#current-question-container .option')].map(option => option.getBoundingClientRect());
      return { railWidth: rail.width, menuLeft: menu.left, menuRight: menu.right, menuWidth: menu.width, paperLeft: paper.left,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        optionsFit: options.every(option => option.right <= innerWidth + 1) };
    });
    expect(layout.railWidth).toBe(0);
    expect(layout.menuLeft).toBe(0);
    expect(layout.menuWidth).toBe(240);
    expect(layout.paperLeft).toBeGreaterThanOrEqual(layout.menuRight);
    expect(layout.overflow).toBeFalsy();
    expect(layout.optionsFit).toBeTruthy();
  }
  await page.setViewportSize({ width: 767, height: 1180 });
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
});

test('访客答题后登录会把当前答案写入账号草稿', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await page.locator('#current-question-container .option').first().click();
  await page.evaluate(() => {
    window.__practiceDraftSaves = [];
    window.APIClient.saveDraft = async (_userId, payload) => {
      window.__practiceDraftSaves.push(payload);
      return { revision: 1 };
    };
    window.UserContextManager.getInstance().setUserContext({ id: 'student_guest_transfer', guest: false });
  });
  await expect.poll(() => page.evaluate(() => window.__practiceDraftSaves.length)).toBe(1);
  const saved = await page.evaluate(() => window.__practiceDraftSaves[0]);
  expect(saved.answered_count).toBe(1);
  expect(saved.exam_id).toBeTruthy();
});

test('JLPT 长句选项逐行显示，短词仍横排且复盘标记不压住文字', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  const setOptions = (options) => page.evaluate((nextOptions) => {
    const viewer = window.examViewer;
    const question = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex].questions[viewer.currentQuestionIndex];
    question.options = nextOptions;
    question.correct_answer = 3;
    viewer.answerManager.setAnswerComposite(viewer.currentSectionIndex, String(question.id), 1);
    viewer.showAnswers = true;
    viewer.renderExam();
  }, options);

  await setOptions(['1.話しかけていました', '2.話しかけてあげました', '3.話しかけてくれました', '4.話しかけてもらいました']);
  const longOptions = page.locator('#current-question-container .jlpt-long-options .option');
  await expect(longOptions).toHaveCount(4);
  await expect(longOptions.first().locator('.option-number')).toHaveText('1.');
  await expect(longOptions.first().locator('.option-text')).toHaveText('話しかけていました');
  const positions = await longOptions.evaluateAll(options => options.map(option => {
    const text = option.querySelector('.option-text').getBoundingClientRect();
    const style = getComputedStyle(option, '::before');
    const box = option.getBoundingClientRect();
    return { x: box.x, y: box.y, textRight: text.right, boxRight: box.right, markerPosition: style.position };
  }));
  expect(new Set(positions.map(position => position.x)).size).toBe(1);
  expect(new Set(positions.map(position => position.y)).size).toBe(4);
  expect(positions.map(position => position.y)).toEqual([...positions.map(position => position.y)].sort((a, b) => a - b));
  expect(positions[0].markerPosition).toBe('static');
  expect(positions[0].textRight).toBeLessThan(positions[0].boxRight);

  await setOptions(['1.けって', '2.おって', '3.わって', '4.さわって']);
  const shortOptions = page.locator('#current-question-container .jlpt-short-options .option');
  await expect(shortOptions).toHaveCount(4);
  expect(new Set((await shortOptions.evaluateAll(options => options.map(option => option.getBoundingClientRect().x)))).size).toBe(4);

  await page.setViewportSize({ width: 390, height: 844 });
  await setOptions(['1.話しかけていました', '2.話しかけてあげました', '3.話しかけてくれました', '4.話しかけてもらいました']);
  await expect(longOptions).toHaveCount(4);
  expect(await page.locator('#current-question-container').evaluate(container => container.scrollWidth <= container.clientWidth)).toBeTruthy();
});

test('题组结果先暂存，登录后转存到账号并可重试失败的保存', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await page.locator('#current-question-container .option').first().click();
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  await expect(page.locator('#exam-result-modal')).toBeVisible();
  await expect(page.locator('.practice-result-rate strong')).toBeVisible();
  await expect(page.locator('[data-practice-save-status]')).toContainText('暂存在此浏览器');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1') || '[]').length)).toBe(1);
  await page.locator('[data-practice-save-login]').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('#login-modal .login-close-x').click();
  await page.evaluate(() => {
    window.__practiceRecordCalls = [];
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.APIClient.savePracticeGroup = async (payload) => {
      window.__practiceRecordCalls.push(payload);
      if (window.__practiceRecordCalls.length === 1) throw new Error('temporary failure');
      return { submission_id: payload.submission_id };
    };
    window.UserContextManager.getInstance().setUserContext({ id: 'student_practice_transfer', guest: false });
  });
  await expect(page.locator('[data-practice-save-status]')).toContainText('保存失败');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1') || '[]').length)).toBe(1);
  await page.locator('[data-practice-save-retry]').click();
  await expect(page.locator('[data-practice-save-status]')).toContainText('已保存到账号');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1') || '[]').length)).toBe(0);
  const calls = await page.evaluate(() => window.__practiceRecordCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0].submission_id).toBe(calls[1].submission_id);
  expect(calls[0].exam_id).toBeTruthy();
  expect(calls[0].section_indexes.length).toBeGreaterThan(0);
  expect(Object.keys(calls[0].answers)).toHaveLength(1);
  await page.locator('[data-practice-action="retry"]').click();
  await page.locator('#current-question-container .option').nth(1).click();
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  await expect(page.locator('[data-practice-save-status]')).toContainText('已保存到账号');
  expect(await page.evaluate(() => window.__practiceRecordCalls.length)).toBe(3);
  expect((await page.evaluate(() => window.__practiceRecordCalls[2].submission_id))).not.toBe(calls[0].submission_id);
});

test('练习结果可从右上角关闭且保留临时记录', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await page.locator('#current-question-container .option').first().click();
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  const modal = page.locator('#exam-result-modal');
  const close = modal.getByRole('button', { name: '关闭练习结果' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#current-question-container')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1') || '[]').length)).toBe(1);
});

test('访客 JLPT 和 EJU 各可完成一次，临时记录位于考试选择之后', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('jlpt').remaining)).toBe(1);
  await page.locator('#current-question-container .option').first().click();
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  await expect(page.locator('[data-practice-save-status]')).toContainText('暂存在此浏览器');
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('jlpt').remaining)).toBe(0);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(1);
  await expect(page.locator('[data-practice-action="retry"]')).toHaveText('登录后再练');
  await page.locator('[data-practice-action="retry"]').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('#login-modal .login-close-x').click();

  await page.locator('[data-practice-action="choose"]').click();
  const home = page.locator('#guest-welcome');
  await expect(home).toBeVisible();
  await expect(home.locator('.gw-history-row')).toHaveCount(1);
  expect(await home.evaluate(root => Boolean(root.querySelector('.gw-goals').compareDocumentPosition(root.querySelector('.gw-history')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-gw="target"][data-target="JLPT N3"]').click();
  await home.locator('[data-gw="browse"][data-domain="词汇 / 语法"]').click();
  await expect(home.locator('h1')).toHaveText('JLPT体验已用完');

  await enterPractice(page, 'eju', '听读解');
  await page.locator('#current-question-container .option').first().click();
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1') || '[]').length)).toBe(2);

  await page.locator('[data-practice-action="choose"]').click();
  await home.locator('[data-gw="experience"]').click();
  await home.locator('[data-gw="answer"]').first().click();
  await home.locator('[data-gw="check"]').click();
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus().remaining)).toBe(0);
  await home.locator('[data-gw="home"]:visible').first().click();
  await expect(home.locator('.gw-history-row')).toHaveCount(3);

  await page.reload();
  await expect(home.locator('.gw-history-row')).toHaveCount(3);
  await home.locator('[data-gw="review-practice"]').first().click();
  await expect(home).toBeHidden();
  await expect(page.locator('#current-question-container')).toBeVisible();
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(0);
});

test('2024 EJU 读解 1 按正文段落显示而非扫描行距', async ({ page }) => {
  await enterPractice(page, 'eju', '读解', '2024_01');
  const passage = page.locator('#current-question-container .passage-content').first();
  const firstParagraph = passage.locator('.passage-paragraph:not(.passage-paragraph-blank)').first();
  await expect(firstParagraph).toContainText('バランスよく含んでいます。ところが大きなパラドックスがあります。');
  await expect(firstParagraph).toContainText('ミルクオリゴ糖とよばれるものがかなり含まれています');
  await expect(passage).not.toContainText('日本語一7');
  await expect(passage).not.toContainText('1. ミルクオリゴ糖を餌にできるのは');
  await expect(page.locator('#current-question-container')).toContainText('筆者は、ミルクオリゴ糖と細菌の関係について、どのように述べていますか。');
});

test('2024 EJU 记述题显示两个完整主题且不混入 OCR 页眉和注音', async ({ page }) => {
  await enterPractice(page, 'eju', '记述', '2024_01');
  const passage = page.locator('#current-question-container .passage-content');
  await expect(passage).toHaveCount(1);
  await expect(passage).toContainText('以下の二つのテーマのうち、どちらか一つを選んで400～500字程度で書いてください');
  await expect(passage.locator('.passage-paragraph:not(.passage-paragraph-blank)')).toHaveCount(8);
  await expect(passage).toContainText('1.');
  await expect(passage).toContainText('2.');
  await expect(passage).toContainText('時刻に関係なく活動ができることには、どのようなよい点と問題点がありますか。');
  await expect(passage).toContainText('商品の評価や感想を読んだり書いたりすることには、どのようなよい点と問題点がありますか。');
  await expect(passage).not.toContainText('日本語一3');
  await expect(passage).not.toContainText('かのう');
  await expect(passage).not.toContainText('しょうひんひょうか');
});

test('2024 EJU 读解公告、多问题及图文题没有重复 OCR 题干', async ({ page }) => {
  await enterPractice(page, 'eju', '读解', '2024_01');
  const navigateTo = id => page.evaluate(questionId => {
    const viewer = window.examViewer;
    const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === 'reading');
    const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => Number(question.id) === questionId);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
  }, id);

  await navigateTo(2);
  const container = page.locator('#current-question-container');
  await expect(container.locator('.passage-content')).toContainText('通学についての注意');
  await expect(container.locator('.passage-content')).not.toContainText('日本語一8');
  await expect(container.locator('.passage-content')).not.toContainText('4. 自転車・小型バイクのどちらも');
  await expect(container).toContainText('次のお知らせの内容と合っているものはどれですか。');

  await navigateTo(11);
  await expect(container.locator('.option').last()).toContainText('ところで');
  await expect(container.locator('.option').last()).not.toContainText('間 2');

  await navigateTo(19);
  await expect(container.locator('.option').last()).toContainText('それを他者に伝えることができる');
  await expect(container.locator('.option').last()).not.toContainText('図 1一図 3');

  await navigateTo(24);
  await expect(container.locator('.option').nth(1)).toContainText('交尾前：オス　交尾後：オスとメス');
});

test('2024 EJU 听读解显示原图、简洁题干和可核对的选项', async ({ page }) => {
  await enterPractice(page, 'eju', '听读解', '2024_01');
  const container = page.locator('#current-question-container');
  const navigateTo = id => page.evaluate(questionId => {
    const viewer = window.examViewer;
    const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === 'listening_reading');
    const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => Number(question.id) === questionId);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
  }, id);

  await expect(container.locator('.question-text')).toContainText('野生動物の餌付け');
  await expect(container.locator('.question-text')).not.toContainText('日本語一36');
  await expect(container.locator('.question-text')).not.toContainText('人秋付け');
  await expect(container.locator('.exam-image')).toHaveAttribute('src', /listening_reading_q01_p36\.jpg$/);
  await expect.poll(() => container.locator('.exam-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBeTruthy();
  await expect(container.locator('.option')).toHaveCount(4);
  const audioResponse = await page.request.get('/data/audio/eju/2024_01/track_06.mp3', {
    headers: { Range: 'bytes=0-31' }
  });
  expect([200, 206]).toContain(audioResponse.status());
  expect(audioResponse.headers()['content-type']).toContain('audio/mpeg');

  for (let questionId = 27; questionId <= 37; questionId += 1) {
    await navigateTo(questionId);
    await expect(container.locator('.exam-image')).toHaveAttribute('src', new RegExp(`listening_reading_q${String(questionId - 25).padStart(2, '0')}_p${questionId + 10}\\.jpg$`));
    await expect.poll(() => container.locator('.exam-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBeTruthy();
  }

  for (const [id, expected] of [[28, '4. d'], [30, '4. D'], [34, '4. EとF'], [37, '4. aとd']]) {
    await navigateTo(id);
    await expect(container.locator('.option')).toHaveCount(4);
    await expect(container.locator('.option').last()).toContainText(expected);
  }
  await navigateTo(35);
  await expect(container.locator('.question-text')).toContainText('掲載されていません');
  await expect(container.locator('.option')).toHaveCount(0);
});

test('2024 EJU 听解只把正解表信息标为答案核对', async ({ page }) => {
  await enterPractice(page, 'eju', '听解', '2024_01');
  await page.evaluate(() => {
    const viewer = window.examViewer;
    const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === 'listening');
    const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => question.eju_answer_no === 17);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
    viewer.showAnswers = true;
    viewer.showExplanations = true;
    viewer.renderExam();
  });
  const container = page.locator('#current-question-container');
  await expect(container.locator('.explanation')).toHaveCount(1);
  await expect(container.locator('.explanation')).toContainText('【答案核对】');
  await expect(container.locator('.explanation')).toContainText('听解17番的正确选项是第1项');
  await expect(container.locator('.explanation')).toContainText('尚无这道题的听力原文和逐题解析');
  await expect(container.locator('.explanation.answer-extras')).toHaveCount(0);
});

test('2024 EJU 读解与听读解不把正解表和通用技巧冒充逐题解析', async ({ page }) => {
  const showNote = async (domain, questionId) => {
    await enterPractice(page, 'eju', domain, '2024_01');
    await page.evaluate(id => {
      const viewer = window.examViewer;
      const sectionType = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex].section_type;
      const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === sectionType);
      const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => Number(question.id) === id);
      viewer.jumpToQuestion(sectionIndex, questionIndex, false);
      viewer.showAnswers = true;
      viewer.showExplanations = true;
      viewer.renderExam();
    }, questionId);
    return page.locator('#current-question-container');
  };

  const reading = await showNote('读解', 2);
  await expect(reading.locator('.explanation')).toContainText('【答案核对】');
  await expect(reading.locator('.explanation')).toContainText('尚无按原文逐项核对的解析');
  await expect(reading.locator('.explanation.answer-extras')).toHaveCount(0);

  const listeningReading = await showNote('听读解', 26);
  await expect(listeningReading.locator('.explanation')).toContainText('【答案核对】');
  await expect(listeningReading.locator('.explanation')).toContainText('尚无完整听力原文和逐题解析');
  await expect(listeningReading.locator('.explanation.answer-extras')).toHaveCount(0);

  await page.evaluate(() => {
    const viewer = window.examViewer;
    const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === 'listening_reading');
    const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => question.eju_answer_no === 10);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
    viewer.renderExam();
  });
  await expect(listeningReading.locator('.explanation')).toContainText('【资料说明】');
});

test('其他年份 EJU 听读解使用对应图片与分题音频', async ({ page }) => {
  for (const sample of [
    { paper: '2018_01', question: 26, image: 'listening_reading_q01_material.jpg', audio: 'track_06.mp3', options: 4 },
    { paper: '2021_01', question: 29, image: 'listening_reading_q04_material.jpg', audio: 'track_09.mp3', options: 4 },
    { paper: '2023_02', question: 26, image: 'listening_reading_q01.jpg', audio: 'track_06.mp3', options: 0 }
  ]) {
    await enterPractice(page, 'eju', '听读解', sample.paper);
    const audioUrl = await page.evaluate(questionId => {
      const viewer = window.examViewer;
      const sectionIndex = viewer.currentExam.exam_info.sections.findIndex(section => section.section_type === 'listening_reading');
      const questionIndex = viewer.currentExam.exam_info.sections[sectionIndex].questions.findIndex(question => Number(question.id) === questionId);
      viewer.jumpToQuestion(sectionIndex, questionIndex, false);
      return viewer.currentExam.exam_info.sections[sectionIndex].questions[questionIndex].audio;
    }, sample.question);
    const container = page.locator('#current-question-container');
    await expect(container.locator('.exam-image')).toHaveAttribute('src', new RegExp(sample.image.replace('.', '\\.') + '$'));
    await expect.poll(() => container.locator('.exam-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBeTruthy();
    await expect(container.locator('.option')).toHaveCount(sample.options);
    expect(audioUrl).toContain(`/data/audio/eju/${sample.paper}/${sample.audio}`);
    const audioResponse = await page.request.get(audioUrl, { headers: { Range: 'bytes=0-31' } });
    expect([200, 206]).toContain(audioResponse.status());
  }
});

test('听读解在本题型结束，检查、结果、复盘及重练形成闭环', async ({ page }) => {
  await enterPractice(page, 'eju', '听读解');
  await page.evaluate(() => {
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.APIClient.savePracticeGroup = async payload => ({ submission_id: payload.submission_id });
    window.UserContextManager.getInstance().setUserContext({ id: 'student_eju_practice', guest: false });
  });
  await expect(page.locator('.check-btn')).toBeEnabled();
  await page.locator('.check-btn').click();
  await expect(page.locator('#app-toast')).toContainText('请先选择答案');
  const info = await page.evaluate(() => {
    const v = window.examViewer;
    const questions = v.getPracticeQuestions();
    const outside = v.currentExam.exam_info.sections.findIndex((_, i) => !v.practiceScope.sectionIndexes.includes(i));
    const outsideQuestion = v.currentExam.exam_info.sections[outside].questions[0];
    v.answerManager.setAnswerComposite(outside, String(outsideQuestion.id), 1);
    return { total: questions.length, firstAnswer: questions[0].question.correct_answer, second: questions[1], last: questions.at(-1), outside, outsideId: String(outsideQuestion.id) };
  });
  await page.locator(`.option[data-option-index="${info.firstAnswer}"]`).first().click();
  await expect(page.locator('.task-progress')).toHaveText(`已答 1/${info.total} 题`);
  await page.locator('.check-btn').click();
  await expect(page.locator('.option.correct-option')).toBeVisible();
  await page.locator('.next-btn').click();
  await expect(page.locator('.option.correct-option')).toHaveCount(0);
  const wrong = Number(info.second.question.correct_answer) === 1 ? 2 : 1;
  await page.locator(`.option[data-option-index="${wrong}"]`).first().click();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await expect(page.locator('#open-question-map')).toBeHidden();
  await expect(page.locator('.ls-menu .exam-mode-field')).toBeHidden();
  await openTaskDetails(page);
  await page.locator('#question-navigation .question-counter').click();
  await expect(page.locator('#question-map-content .question-map-item')).toHaveCount(info.total);
  await page.locator(`#question-map-content .question-map-item[data-section="${info.last.sectionIndex}"][data-question="${info.last.questionIndex}"]`).click();
  await expect(page.locator('#question-map-overlay')).toBeHidden();
  await expect(page.locator('.next-btn')).toHaveText('完成练习');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#exam-result-modal')).toBeVisible();
  await expect(page.locator('#exam-result-title')).toHaveText('听读解练习结果');
  const stats = page.locator('.practice-result-stats > div');
  await expect(stats.filter({ hasText: /^已答/ }).locator('strong')).toHaveText(`2 / ${info.total}`);
  await expect(stats.filter({ hasText: /^错误/ }).locator('strong')).toHaveText('1');
  await expect(page.locator('.practice-result-rate strong')).toHaveText('50%');
  const assistsBeforeReview = await page.evaluate(() => {
    const { showAnswers, showExplanations, showReadingKana, showReadingZh } = window.examViewer;
    return [showAnswers, showExplanations, showReadingKana, showReadingZh];
  });
  await page.locator('[data-practice-action="review"]').click();
  await expect(page.locator('#exam-review-bar')).toContainText('回答错误');
  expect(await page.evaluate(() => {
    const { showAnswers, showExplanations, showReadingKana, showReadingZh } = window.examViewer;
    return [showAnswers, showExplanations, showReadingKana, showReadingZh];
  })).toEqual([true, true, true, true]);
  await expect(page.locator('#learning-tools-menu button[aria-checked="true"]')).toHaveCount(4);
  await expect(page.locator('#question-navigation')).toBeHidden();
  await page.locator('[data-review-action="close"]').click();
  await expect(page.locator('#exam-result-modal')).toBeVisible();
  expect(await page.evaluate(() => {
    const { showAnswers, showExplanations, showReadingKana, showReadingZh } = window.examViewer;
    return [showAnswers, showExplanations, showReadingKana, showReadingZh];
  })).toEqual(assistsBeforeReview);
  await page.locator('[data-practice-action="retry"]').click();
  await expect(page.locator('.question-counter')).toContainText(`已答0/${info.total}`);
  expect(await page.evaluate(data => window.examViewer.answerManager.getAnswerComposite(data.outside, data.outsideId), info)).toBe(1);
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  await page.locator('[data-practice-action="choose"]').click();
  await page.locator('.practice-category-choices button').filter({ hasText: /^读解$/ }).click();
  await page.locator('#exam-result-panel .practice-start-btn').click();
  expect(await page.evaluate(() => window.examViewer.practiceScope.sectionIndexes.every(i => window.examViewer.currentExam.exam_info.sections[i].section_type === 'reading'))).toBeTruthy();
});

test('游客长选项题号不重叠，检查答案和长解析可完整滚动到底栏上方', async ({ page }, testInfo) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await page.evaluate(() => {
    const viewer = window.examViewer;
    viewer.loadExamData({ family: 'jlpt', exam_info: { exam_level: 'N3', sections: [{
      section_type: 'vocabulary', section_name: '問題5 - 言葉の使い方', section_title: '問題5 次の言葉の使い方として最もよいものを選びなさい。',
      questions: [31, 32, 33, 34, 35].map(id => ({ id, question: '<u>知識</u>（ちしき）', correct_answer: 3,
        options: ['いつ財布を落としたか知識がありません', 'はさみがどこにあるか知識があります', 'パーティーには私の知識のある人も多数来ている', 'その仕事は医学の知識がないとできない'],
        explanation: '正しい使い方を確認しましょう。知識は学習や経験によって得られた内容を表します。'.repeat(40)
      }))
    }] } });
    viewer.setPracticeScope('词汇 / 语法', [0], true);
    viewer.jumpToQuestion(0, 0);
  });
  const check = page.locator('#task-check-answer .check-btn');
  for (const width of [390, 360, 320, 820]) {
    await page.setViewportSize({ width, height: 780 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => {
      const check = document.querySelector('#task-check-answer .check-btn').getBoundingClientRect();
      const bar = document.querySelector('.task-nav').getBoundingClientRect();
      const options = [...document.querySelectorAll('.option')].at(-1).getBoundingClientRect();
      return check.bottom <= bar.top - 12 && options.bottom < check.top;
    })).toBe(true);
    expect(await page.evaluate(() => {
      const text = document.querySelector('.question-text');
      const number = text.querySelector('.question-number-inline').getBoundingClientRect();
      return text.getBoundingClientRect().left + parseFloat(getComputedStyle(text).paddingLeft) >= number.right + 4;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.screenshot({ path: testInfo.outputPath('guest-check-above-task-bar.png') });
  await page.locator('.option[data-option-index="3"]').click();
  await check.click();
  await expect(check).toHaveText('回答正确');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => {
    const explanation = document.querySelector('.explanation').getBoundingClientRect();
    const bar = document.querySelector('.task-nav').getBoundingClientRect();
    return explanation.bottom <= bar.top - 12;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('guest-explanation-above-task-bar.png') });
});

test('缺少标准答案时检查按钮说明原因而不误判', async ({ page }) => {
  await enterPractice(page, 'eju', '听读解');
  await page.evaluate(() => {
    const viewer = window.examViewer;
    viewer.currentExam.exam_info.sections[viewer.currentSectionIndex].questions[viewer.currentQuestionIndex].correct_answer = null;
    viewer.renderExam();
  });
  await page.locator('.option[data-option-index]').first().click();
  await page.locator('.check-btn').click();
  await expect(page.locator('#app-toast')).toContainText('本题暂无可核对的标准答案');
  await expect(page.locator('.check-btn')).toHaveText('检查答案');
});

test('JLPT阅读可提前结束，手机结果不溢出', async ({ page }) => {
  await enterPractice(page, 'jlpt', '阅读');
  await expect(page.locator('.ls-menu .end-practice-btn')).toHaveCount(0);
  await expect(page.locator('.question-nav .end-practice-btn')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const contentBox = await page.locator('#exam-content').boundingBox();
  expect(contentBox.x).toBe(0);
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  const nextBox = await page.locator('.next-btn').boundingBox();
  const endBox = await page.locator('.end-practice-btn').boundingBox();
  expect(Math.abs(endBox.y - nextBox.y)).toBeLessThan(2);
  await expect(page.locator('#task-session-panel')).toBeHidden();
  await page.locator('.end-practice-btn').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#exam-result-title')).toHaveText('阅读练习结果');
  await expect(page.locator('.practice-result-stats > div').filter({ hasText: /^已答/ }).locator('strong')).toHaveText(/^0 \/ \d+$/);
  expect(await page.locator('#exam-result-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBeTruthy();
  await page.locator('.practice-result-more summary').click();
  await page.locator('[data-practice-action="continue"]').click();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
});

test('完整试卷保留跨题型与最后检查交卷流程', async ({ page }) => {
  await enterPractice(page, 'eju', '');
  expect(await page.evaluate(() => window.examViewer.practiceScope)).toBeNull();
  await expect(page.locator('.ls-category-heading')).toBeVisible();
  await expect(page.locator('#ls-exam-controls')).toBeVisible();
  await expect(page.locator('.end-practice-btn')).toBeHidden();
  const category = await page.evaluate(() => {
    const v = window.examViewer;
    const first = v.getCategories()[0];
    const lastSection = first.sectionIndexes.at(-1);
    v.jumpToQuestion(lastSection, v.currentExam.exam_info.sections[lastSection].questions.length - 1);
    return first.id;
  });
  await page.locator('.next-btn').click();
  expect(await page.evaluate(() => window.examViewer.currentCategory)).not.toBe(category);
  await page.evaluate(() => {
    const v = window.examViewer;
    const section = v.getCategories().at(-1).sectionIndexes.at(-1);
    v.jumpToQuestion(section, v.currentExam.exam_info.sections[section].questions.length - 1);
  });
  await page.locator('.next-btn').click();
  await expect(page.locator('#question-map-overlay')).toBeVisible();
  await expect(page.locator('[data-question-map-submit]')).toHaveText('提交试卷');
});

test('默认只选問題1，勾选题组后开始且不能跳到未选范围', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-target="JLPT N3"]').click();
  await home.locator('[data-gw="browse"][data-domain="词汇 / 语法"]').click();
  await home.locator('[data-gw="paper"][data-exam$="2024_07"]').click();
  await expect(home.locator('[data-practice-section]:checked')).toHaveCount(1);
  await expect(home.locator('.practice-section-choices label').first()).toContainText('問題1');
  const checkboxes = home.locator('[data-practice-section]');
  await checkboxes.first().uncheck();
  await expect(home.locator('.practice-start-btn')).toBeDisabled();
  await checkboxes.first().check();
  await checkboxes.nth(2).check();
  await expect(home.locator('.practice-selection-summary')).toContainText('已选 2 个题组');
  await home.locator('.practice-start-btn').click();
  await expect(home).toBeHidden();
  await expect(page.locator('.ls-paper-picker')).toBeHidden();
  await expect(page.locator('.ls-paper-picker summary')).toBeHidden();
  await expect(page.locator('.ls-category-heading')).toBeHidden();
  await expect(page.locator('#ls-exam-controls')).toBeHidden();
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const v = window.examViewer;
    const before = v.currentSectionIndex;
    v.selectCategory('reading');
    v.jumpToQuestion(1, 0);
    return v.currentSectionIndex === before && v.practiceScope.sectionIndexes.join(',') === '0,2';
  })).toBeTruthy();
  await page.evaluate(() => {
    const v = window.examViewer;
    v.jumpToQuestion(0, v.currentExam.exam_info.sections[0].questions.length - 1);
  });
  await page.locator('.next-btn').click();
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(2);
  await openTaskDetails(page);
  await page.locator('.end-practice-btn').click();
  await page.locator('.practice-result-more summary').click();
  await page.locator('[data-practice-action="reselect"]').click();
  const panel = page.locator('#exam-result-panel');
  await expect(panel.locator('[data-practice-section]:checked')).toHaveCount(1);
  await panel.locator('[data-practice-section]').first().uncheck();
  await panel.locator('[data-practice-section]').nth(1).check();
  await panel.locator('.practice-start-btn').click();
  expect(await page.evaluate(() => window.examViewer.practiceScope.sectionIndexes)).toEqual([1]);
});
