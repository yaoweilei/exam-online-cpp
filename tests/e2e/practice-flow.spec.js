const { test, expect } = require('@playwright/test');

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

test('中间栏隐藏时刻度进入最左侧图标栏', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  const measure = () => page.evaluate(() => {
    const paper = document.querySelector('#current-question-container').getBoundingClientRect();
    const scrubber = document.querySelector('#practice-scrubber').getBoundingClientRect();
    const rail = document.querySelector('.ls-rail').getBoundingClientRect();
    const tick = document.querySelector('.practice-scrubber-tick').getBoundingClientRect();
    const icon = [...document.querySelectorAll('.ls-rail button svg')].find(svg => svg.getBoundingClientRect().width > 0).getBoundingClientRect();
    return { gap: paper.left - scrubber.right, paperLeft: paper.left, scrubberLeft: scrubber.left, railRight: rail.right, tickLeft: tick.left, iconLeft: icon.left };
  });
  for (const width of [1600, 1201, 1200, 1000, 820, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const position = await measure();
    expect(position.gap).toBeGreaterThanOrEqual(1);
    expect(position.gap).toBeLessThanOrEqual(3);
    expect(position.scrubberLeft).toBeGreaterThanOrEqual(position.railRight);
  }
  for (const width of [767, 701]) {
    await page.setViewportSize({ width, height: 900 });
    const position = await measure();
    expect(position.railRight).toBe(36);
    expect(position.scrubberLeft).toBe(0);
    expect(Math.abs(position.tickLeft - position.iconLeft)).toBeLessThanOrEqual(1);
    expect(position.paperLeft).toBeGreaterThanOrEqual(position.railRight + 8);
  }
  for (const width of [768, 701, 700, 600, 520, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('#current-question-container').evaluate(paper => paper.getBoundingClientRect().top)).toBe(4);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('.ls-collapse').click();
  const collapsed = await measure();
  expect(collapsed.railRight).toBe(36);
  expect(collapsed.scrubberLeft).toBe(0);
  expect(Math.abs(collapsed.tickLeft - collapsed.iconLeft)).toBeLessThanOrEqual(1);
  const track = await page.locator('.practice-scrubber-track').boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
  await expect(page.locator('.practice-scrubber-preview')).toBeVisible();
});

test('iPad 竖屏默认显示三栏，仍可手动收起中间栏', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  for (const width of [768, 820, 1024, 1180]) {
    await page.setViewportSize({ width, height: 1180 });
    const layout = await page.evaluate(() => {
      const rail = document.querySelector('.ls-rail').getBoundingClientRect();
      const menu = document.querySelector('.ls-menu').getBoundingClientRect();
      const paper = document.querySelector('#current-question-container').getBoundingClientRect();
      const options = [...document.querySelectorAll('#current-question-container .option')].map(option => option.getBoundingClientRect());
      return { railRight: rail.right, menuLeft: menu.left, menuRight: menu.right, menuWidth: menu.width, paperLeft: paper.left,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        optionsFit: options.every(option => option.right <= innerWidth + 1) };
    });
    expect(layout.railRight).toBe(36);
    expect(layout.menuLeft).toBe(36);
    expect(layout.menuWidth).toBeGreaterThanOrEqual(176);
    expect(layout.menuWidth).toBeLessThanOrEqual(216);
    expect(layout.paperLeft).toBeGreaterThan(layout.menuRight);
    expect(layout.overflow).toBeFalsy();
    expect(layout.optionsFit).toBeTruthy();
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.locator('.ls-collapse').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-collapse').click();
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
  await page.locator('.end-practice-btn').click();
  await expect(page.locator('[data-practice-save-status]')).toContainText('已保存到账号');
  expect(await page.evaluate(() => window.__practiceRecordCalls.length)).toBe(3);
  expect((await page.evaluate(() => window.__practiceRecordCalls[2].submission_id))).not.toBe(calls[0].submission_id);
});

test('练习结果可从右上角关闭且保留临时记录', async ({ page }) => {
  await enterPractice(page, 'jlpt', '词汇 / 语法');
  await page.locator('#current-question-container .option').first().click();
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
  await expect(page.locator('.check-btn')).toBeDisabled();
  const info = await page.evaluate(() => {
    const v = window.examViewer;
    const questions = v.getPracticeQuestions();
    const outside = v.currentExam.exam_info.sections.findIndex((_, i) => !v.practiceScope.sectionIndexes.includes(i));
    const outsideQuestion = v.currentExam.exam_info.sections[outside].questions[0];
    v.answerManager.setAnswerComposite(outside, String(outsideQuestion.id), 1);
    return { total: questions.length, firstAnswer: questions[0].question.correct_answer, second: questions[1], outside, outsideId: String(outsideQuestion.id) };
  });
  await page.locator(`.option[data-option-index="${info.firstAnswer}"]`).first().click();
  await expect(page.locator('.question-counter')).toContainText(`已答1/${info.total}`);
  await page.locator('.check-btn').click();
  await expect(page.locator('.option.correct-option')).toBeVisible();
  await page.locator('.next-btn').click();
  await expect(page.locator('.option.correct-option')).toHaveCount(0);
  const wrong = Number(info.second.question.correct_answer) === 1 ? 2 : 1;
  await page.locator(`.option[data-option-index="${wrong}"]`).first().click();
  const scrubber = page.locator('#practice-scrubber');
  await expect(scrubber.locator('.practice-scrubber-tick')).toHaveCount(info.total);
  await expect.poll(async () => scrubber.locator('.practice-scrubber-tick').evaluateAll(ticks =>
    ticks.slice(0, 3).map(tick => Number(getComputedStyle(tick).opacity))
  )).toEqual([0.95, 1, 0.42]);
  await expect.poll(async () => scrubber.locator('.practice-scrubber-tick').evaluateAll(ticks =>
    ticks.slice(0, 5).map(tick => Math.round(parseFloat(getComputedStyle(tick).width)))
  )).toEqual([6, 6, 6, 6, 6]);
  await expect(page.locator('#open-question-map')).toBeHidden();
  await expect(page.locator('.ls-menu .exam-mode-field')).toBeHidden();
  const track = await scrubber.locator('.practice-scrubber-track').boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height - 3);
  await expect(scrubber.locator('.practice-scrubber-preview')).toBeVisible();
  await expect(scrubber.locator('.practice-scrubber-preview')).toContainText(`第 ${info.total} 题`);
  await expect.poll(async () => scrubber.locator('.practice-scrubber-tick').evaluateAll(ticks =>
    ticks.slice(-4).map(tick => Math.round(parseFloat(getComputedStyle(tick).width)))
  )).toEqual([10, 14, 20, 26]);
  const tickLefts = await scrubber.locator('.practice-scrubber-tick').evaluateAll(ticks =>
    ticks.slice(-4).map(tick => tick.getBoundingClientRect().left)
  );
  expect(new Set(tickLefts).size).toBe(1);
  await expect(scrubber).toHaveAttribute('aria-valuenow', '2');
  await page.mouse.move(track.x + track.width + 70, track.y + track.height - 3);
  await expect.poll(async () => scrubber.locator('.practice-scrubber-tick').evaluateAll(ticks =>
    ticks.map(tick => Math.round(parseFloat(getComputedStyle(tick).width)))
  )).toEqual(Array(info.total).fill(6));
  await page.mouse.click(track.x + track.width / 2, track.y + track.height - 3);
  await expect(scrubber).toHaveAttribute('aria-valuenow', String(info.total));
  await expect(page.locator('.next-btn')).toHaveText('完成听读解');
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
  await page.locator('.end-practice-btn').click();
  await page.locator('[data-practice-action="choose"]').click();
  await page.locator('.practice-category-choices button').filter({ hasText: /^读解$/ }).click();
  await page.locator('#exam-result-panel .practice-start-btn').click();
  expect(await page.evaluate(() => window.examViewer.practiceScope.sectionIndexes.every(i => window.examViewer.currentExam.exam_info.sections[i].section_type === 'reading'))).toBeTruthy();
});

test('JLPT阅读可提前结束，手机结果不溢出', async ({ page }) => {
  await enterPractice(page, 'jlpt', '阅读');
  await expect(page.locator('.ls-menu .end-practice-btn')).toHaveCount(0);
  await expect(page.locator('.question-nav .end-practice-btn')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const contentBox = await page.locator('#exam-content').boundingBox();
  const scrubberBox = await page.locator('#practice-scrubber').boundingBox();
  expect(contentBox.x).toBe(24);
  expect(scrubberBox.width).toBe(24);
  expect(scrubberBox.x + scrubberBox.width).toBeLessThanOrEqual(contentBox.x);
  const nextBox = await page.locator('.next-btn').boundingBox();
  const endBox = await page.locator('.end-practice-btn').boundingBox();
  expect(endBox.y).toBe(nextBox.y);
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
  await expect(page.locator('#practice-scrubber')).toBeVisible();
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
