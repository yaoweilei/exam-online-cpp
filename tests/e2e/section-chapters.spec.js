const { test, expect } = require('@playwright/test');
const { openTaskDetails } = require('./helpers/task-navigation');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');

for (const level of ['N1', 'N2', 'N3']) {
  test(`${level}专项按section_name聚合，题目不因能力标签重复`, async ({ request }) => {
    const response = await request.get(`/api/v1/chapters?family=jlpt&level=${level}`);
    expect(response.ok()).toBeTruthy();
    const { data } = await response.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(new Set(data.items.map(item => item.id)).size).toBe(data.items.length);
    for (const item of data.items) {
      expect(item.level).toBe(level);
      expect(item.skill_key).toBe('');
      expect(item.section_name).not.toMatch(/^(vocab|reading|grammar|listening)\./);
    }
    const chapter = data.items.find(item => item.section_name.includes('漢字読み'));
    expect(chapter).toBeTruthy();
    const detailResponse = await request.get(`/api/v1/chapters/${encodeURIComponent(chapter.id)}`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = (await detailResponse.json()).data;
    expect(detail.chapter.section_name).toBe(chapter.section_name);
    expect(detail.questions.length).toBe(chapter.question_count);
    expect(new Set(detail.questions.map(q => `${q.exam_id}:${q.question_id}`)).size).toBe(detail.questions.length);
  });
}

test('专项领域按section_type和题型名筛选，汉字读音不混入阅读', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [
      { id: 'vocab', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み', skill_key: 'vocab.kanji.reading', question_count: 10, answered: 0, correct: 0 },
      { id: 'grammar', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題7 - 文の文法1（文法形式の判断）', question_count: 5, answered: 0, correct: 0 },
      { id: 'reading', family: 'jlpt', level: 'N2', section_type: 'reading', section_name: '問題10 - 内容理解（短文）', question_count: 8, answered: 0, correct: 0 }
    ] });
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  const rows = page.locator('#chapter-modal .cp-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#cp-domain')).toBeVisible();
  await expect(page.locator('#cp-domain')).toHaveValue('');
  await page.locator('#cp-domain').selectOption('reading');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.cp-topic-name').first()).toContainText('問題10 - 内容理解（短文）');
  await page.locator('#cp-domain').selectOption('vocabulary');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.cp-topic-name').first()).toContainText('問題1 - 漢字読み');
  await page.locator('#cp-domain').selectOption('grammar');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.cp-topic-name').first()).toContainText('問題7 - 文の文法1（文法形式の判断）');
});


test('考试下拉直接选择N1N2N3EJU，只显示选中的题型', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: ['N1', 'N2', 'N3', 'EJU'].map((level, i) => ({
      id: level, family: level === 'EJU' ? 'eju' : 'jlpt', level: level === 'EJU' ? '' : level,
      section_type: 'reading', section_name: '問題10 - 内容理解（短文）', question_count: 10, answered: i, correct: i
    })) });
    window.APIClient.getChapterDetail = async id => ({ questions: [{ exam_id: id + '_test', question_id: '1', stem: '测试题干', status: 'correct' }] });
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  const modal = page.locator('#chapter-modal');
  await expect(modal.locator('#cp-exam option')).toHaveText(['JLPT-N1', 'JLPT-N2', 'JLPT-N3', 'EJU']);
  await expect(modal.locator('#cp-family, #cp-level')).toHaveCount(0);
  await expect(modal.locator('details.cp-category')).toHaveCount(1);
  await expect(modal.locator('details.cp-category > summary')).toHaveText('阅读');
  for (const [i, exam] of ['JLPT-N1', 'JLPT-N2', 'JLPT-N3', 'EJU'].entries()) {
    await modal.locator('#cp-exam').selectOption(exam);
    const group = modal.locator('.cp-exam-group');
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute('aria-label', `${exam.replace('JLPT-', '')}专项练习`);
    await expect(group.locator('.cp-topic-name')).toBeVisible();
    await expect(group.locator('.cp-stat-number, .cp-stat-zero')).toHaveText([String(10 - i), String(i), '0']);
  }
  await modal.locator('#cp-exam').selectOption('JLPT-N2');
  await expect(modal.locator('.cp-exam-group')).toHaveAttribute('aria-label', 'N2专项练习');
  await expect(modal.getByRole('button', { name: '查看题目' })).toHaveCount(0);
  await expect(modal.locator('button.cp-topic-name, .cp-detail')).toHaveCount(0);
  await expect(modal.locator('strong.cp-topic-name')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('specialty-levels-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('specialty-levels-mobile.png') });
});


test('专项三列直接进入对应题目，答对只读复盘且不重复统计', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [
      { id: 'chapter_test', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み', question_count: 5, answered: 2, correct: 1 },
      { id: 'done', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題2 - 表記', question_count: 2, answered: 2, correct: 2 }
    ] });
    window.APIClient.getChapterDetail = async () => ({ questions: ['correct', 'wrong', 'viewed', 'ungraded', ''].map((status, i) => ({ exam_id: 'N2_2025_07', question_id: String(i + 1), stem: '测试题目' + i, status })) });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '問題1 - 漢字読み', section_title: '問題1 の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。', questions: [1, 2, 3, 4, 5].map(id => ({ id, question: `状況を<u>詳細</u>に書いてください。`, options: ['しょうさい', 'そうさい', 'しょうざい', 'しょさい'], correct_answer: 1, explanation: '【题目解析】\n「詳細」读作「しょうさい」，意思是详细。\n【误选项为什么不对】\n其他选项辨析', explanation_expand: '拓展记忆提示' })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.__reviewSaves = 0;
    window.APIClient.saveSpecialtySession = async () => { window.__reviewSaves++; return {}; };
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  const modal = page.locator('#chapter-modal');
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await expect(modal.locator('.cp-stat-header')).toHaveText('专项题型未做答对答错');
  await expect(modal.locator('.cp-row').first().locator('.cp-stat-number')).toHaveText(['3', '1', '1']);
  await expect(modal.locator('.cp-row').nth(1).locator('.cp-stat-number, .cp-stat-zero')).toHaveText(['0', '2', '0']);
  await expect(modal.locator('.cp-row').nth(1).locator('[data-cp-stat="unanswered"], [data-cp-stat="wrong"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('clickable-stats-desktop.png') });
  await modal.locator('[data-cp-stat="correct"]').first().click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#specialty-practice-mode')).toContainText('答对题回顾');
  await expect(page.locator('.cp-question-view')).toHaveCount(0);
  await expect(page.locator('#specialty-session-header')).toHaveCount(0);
  await expect(page.locator('#current-question-container #specialty-question-source')).toHaveCount(0);
  await expect(page.locator('#task-session-panel')).toBeHidden();
  await expect(page.locator('.section-info')).toBeVisible();
  const instruction = page.locator('.section-info .section-instruction-toggle');
  await expect(instruction).toContainText('問題1 の言葉の読み方');
  await instruction.click();
  await expect(instruction).toHaveAttribute('aria-expanded', 'true');
  await instruction.click();
  await expect(instruction).toHaveAttribute('aria-expanded', 'false');
  await openTaskDetails(page);
  await expect(page.locator('#task-session-panel .task-title')).toHaveText('JLPT N2 · 問題1 - 漢字読み');
  await expect(page.locator('#task-session-panel .task-progress')).toContainText('共 1 题');
  await expect(page.locator('#specialty-question-source')).toContainText('本题来源：JLPT N2 · 2025年7月真题');
  await expect(page.locator('#task-session-panel .task-instructions')).toHaveCount(0);
  await expect(page.locator('#task-session-panel')).not.toContainText('問題1 の言葉の読み方');
  await page.screenshot({ path: testInfo.outputPath('specialty-details-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#task-session-panel')).toBeHidden();
  await expect(page.locator('#specialty-question-feedback')).toHaveText('此前答对 · 正确答案已标绿');
  await expect(page.locator('.specialty-original-number')).toHaveCount(0);
  await expect(page.locator('.specialty-question-number')).toHaveText('1.');
  await expect(page.locator('.question-text .question-number-inline')).toHaveCount(0);
  await expect(page.locator('.specialty-explanation-details')).toHaveCount(0);
  await expect(page.locator('.explanation').first()).toContainText('其他选项辨析');
  await expect(page.locator('.answer-extras')).toBeVisible();
  await expect(page.locator('.answer-extras')).not.toContainText('其他选项辨析');
  await expect(page.locator('.answer-extras')).toContainText('拓展记忆提示');
  await expect(page.locator('#ls-current-paper')).toHaveText('JLPT N2 · 問題1 - 漢字読み');
  await expect(page.locator('.ls-paper-header')).toBeHidden();
  await expect(page.locator('.ls-range-summary')).not.toContainText('个题组');
  await expect(page.locator('#ls-menu > .ls-continue')).toBeHidden();
  await expect(page.locator('.specialty-question-tools .feedback-btn')).toBeHidden();
  await expect(page.locator('.specialty-bookmark-star')).toBeVisible();
  await page.getByRole('button', { name: '更多题目操作', exact: true }).click();
  await expect(page.locator('.specialty-question-tools .feedback-btn')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '更多题目操作', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('specialty-correct-desktop.png') });
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.questions.map(q => q.questionId))).toEqual(['1']);
  expect(await page.evaluate(() => [window.examViewer.canAnswerSpecialtyQuestion(), window.examViewer.showAnswers, window.examViewer.showExplanations])).toEqual([false, true, true]);
  const answers = await page.evaluate(() => window.examViewer.userAnswers);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  expect(await page.evaluate(() => window.examViewer.userAnswers)).toEqual(answers);
  await page.locator('[data-ls-return-navigation]').click();
  await expect(page.locator('#student-learning-home')).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  expect(await page.evaluate(() => [window.__reviewSaves, window.examViewer.getSpecialtyProgress()])).toEqual([0, null]);
  await expect(modal).toBeVisible();
  await modal.locator('[data-cp-stat="wrong"]').click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.questions.map(q => q.questionId))).toEqual(['2']);
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(true);
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await expect(page.locator('#specialty-practice-mode')).toContainText('错题重练');
  await expect(page.locator('#specialty-session-header')).toHaveCount(0);
  await expect(page.locator('.section-info')).toBeVisible();
  await expect(page.locator('.specialty-question-number')).toHaveText('1.');
  await expect(page.locator('#specialty-question-source')).toContainText('第2题');
  await expect(page.locator('.correct-option')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('specialty-wrong-desktop.png') });
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await page.locator('#specialty-question-feedback').getByRole('button', { name: '确认并查看解析', exact: true }).click();
  await expect(page.locator('#specialty-question-feedback')).toContainText('仍需巩固');
  await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  await modal.locator('#cp-order').selectOption('asc');
  await modal.locator('[data-cp-stat="unanswered"]').click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.questions.map(q => q.questionId))).toEqual(['3', '4', '5']);
  await expect(page.locator('#specialty-practice-mode')).toContainText('未做题练习');
  await expect(page.locator('.section-info')).toBeVisible();
  await expect(page.locator('#task-session-panel .task-progress')).toHaveText('已答 0/3 题');
  await expect(page.locator('.specialty-question-number')).toHaveText('1.');
  await expect(page.locator('#specialty-question-source')).toContainText('第3题');
  await expect(page.locator('.question-counter')).toHaveText('1 / 3');
  await expect(page.locator('#specialty-question-feedback')).toContainText('选择答案后，点下一题保存');
  await expect(page.locator('#specialty-question-feedback .specialty-confirm-answer')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#specialty-session-header')).toHaveCount(0);
  await expect(page.locator('#task-session-panel')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('specialty-unanswered-mobile.png') });
  await openTaskDetails(page);
  await expect(page.locator('#specialty-question-source')).toBeVisible();
  await expect(page.locator('#specialty-practice-mode')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('specialty-details-mobile.png') });
  expect(await page.locator('#task-session-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.locator('#current-question-container').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('clickable-stats-mobile.png') });
});

test('未做数字直接开始专项，升降序和随机在跨试卷下一题中保持顺序', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [{ id: 'direct', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み', question_count: 3, answered: 0, correct: 0 }] });
    window.APIClient.getChapterDetail = async () => ({ questions: [
      { exam_id: 'N2_2025_07', question_id: '1' },
      { exam_id: 'N2_2020_07', question_id: '10' },
      { exam_id: 'N2_2020_07', question_id: '2' }
    ] });
    window.APIClient.getExam = async id => ({ family: 'jlpt', exam_info: { level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '問題1 - 漢字読み', questions: ['1', '2', '10'].map(q => ({ id: q, question: `${id} 第${q}题`, options: ['一', '二'], correct_answer: 1 })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  const modal = page.locator('#chapter-modal');
  const current = () => page.evaluate(() => {
    const v = window.examViewer;
    return { exam: v._currentExamId, question: String(v.currentExam.exam_info.sections[v.currentSectionIndex].questions[v.currentQuestionIndex].id), index: v.specialtyPractice?.index };
  });
  for (const order of ['asc', 'desc', 'random']) {
    await expect(modal.locator('#cp-order')).toBeVisible();
    await modal.locator('#cp-order').selectOption(order);
    await modal.locator('[data-cp-stat="unanswered"]').click();
    await expect(modal).toBeHidden();
    const refs = await page.evaluate(() => window.examViewer.specialtyPractice.questions);
    expect(refs).toHaveLength(3);
    expect(new Set(refs.map(q => `${q.examId}:${q.questionId}`)).size).toBe(3);
    if (order === 'asc') expect(refs.map(q => q.questionId)).toEqual(['2', '10', '1']);
    if (order === 'desc') expect(refs.map(q => q.questionId)).toEqual(['1', '10', '2']);
    for (let i = 0; i < 3; i++) {
      await expect.poll(current).toEqual({ exam: refs[i].examId, question: refs[i].questionId, index: i });
      await expect(page.locator('.specialty-question-number')).toHaveText(`${i + 1}.`);
      await expect(page.locator('.question-counter')).toHaveText(`${i + 1} / 3`);
      await expect(page.locator('#specialty-question-source')).toContainText(`第${refs[i].questionId}题`);
      await expect(page.locator('#task-session-panel .task-progress')).toContainText('/3 题');
      await expect(page.locator('#ls-current-paper')).toHaveText('JLPT N2 · 問題1 - 漢字読み');
      await expect(page.locator('#specialty-question-source')).toContainText(refs[i].examId.includes('2025') ? '2025年7月' : '2020年7月');
      if (i < 2) await page.evaluate(() => window.examViewer.navigateToNextQuestion());
    }
    await page.evaluate(() => window.examViewer.navigateToPreviousQuestion());
    await expect.poll(current).toEqual({ exam: refs[1].examId, question: refs[1].questionId, index: 1 });
    await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  }
});

test('真实N2题量点击打开题组内的词汇阅读听力题目', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  const modal = page.locator('#chapter-modal');
  for (const domain of ['vocabulary', 'reading', 'listening']) {
    await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
    await page.locator('#cp-exam').selectOption('JLPT-N2');
    await page.locator('#cp-domain').selectOption(domain);
    await expect(modal.locator('[data-cp-stat="unanswered"]').first()).toBeVisible();
    await modal.locator('[data-cp-stat="unanswered"]').first().click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#current-question-container')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const v = window.examViewer;
      const ref = v.specialtyPractice?.questions[v.specialtyPractice.index];
      const section = v.currentExam?.exam_info.sections[v.currentSectionIndex];
      return !!ref && v._currentExamId === ref.examId && String(section?.questions?.[v.currentQuestionIndex]?.id) === ref.questionId;
    })).toBeTruthy();
    await page.evaluate(() => window.examViewer.navigateToNextQuestion());
    await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice?.index)).toBe(1);
  }
});

test('专项翻页轻提示对错，结束展示结果，保存失败可重试后返回专项', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__exitSaved = null;
    window.__exitSaves = 0;
    window.APIClient.listRecentLearning = async () => ({ items: [] });
    window.APIClient.listChapters = async () => ({ items: [{ id: 'exit', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '漢字読み', question_count: 3, answered: 0, correct: 0 }] });
    window.APIClient.getChapterDetail = async () => ({ questions: [1, 2, 3].map(id => ({ exam_id: 'N2_2010_07', question_id: String(id) })) });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2, 3].map(id => ({ id, question: `退出测试${id}`, options: ['正确', '错误'], correct_answer: 1, explanation: '只在主动查看时显示的解析' })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveSpecialtySession = async payload => {
      window.__exitSaves++;
      if (window.__exitSaves === 1) throw new Error('test offline');
      return new Promise(resolve => {
        window.__resolveExitSave = () => {
          window.__exitSaved = { submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: payload.questions.length, correct_count: payload.questions.filter(q => q.status === 'correct').length, wrong_count: payload.questions.filter(q => q.status === 'wrong').length, viewed_count: payload.questions.filter(q => q.viewed).length } };
          resolve(window.__exitSaved);
        };
      });
    };
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === '__specialty' && window.__exitSaved ? [window.__exitSaved] : [];
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await page.locator('[data-cp-stat="unanswered"]').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.showExplanations, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([false, false, true]);
  await expect(page.locator('.explanation:visible')).toHaveCount(0);
  await page.locator('.specialty-nav .next-btn').click();
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('2 / 3');
  await expect(page.locator('#specialty-last-feedback')).toHaveText('上一题答对了');
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await page.locator('.specialty-nav .prev-btn').click();
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('1 / 3');
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.isCurrentPracticeQuestionChecked()])).toEqual([false, false]);
  await expect(page.locator('#specialty-question-feedback')).not.toContainText('答对');
  await page.locator('.specialty-nav .next-btn').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await page.locator('.specialty-nav .next-btn').click();
  await expect(page.locator('#specialty-last-feedback')).toContainText('上一题答错了');
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await page.locator('#specialty-last-feedback').getByRole('button', { name: '查看解析' }).click();
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('2 / 3');
  await expect(page.locator('.explanation').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.locator('.specialty-nav');
  for (const button of await nav.locator('button:visible').all()) {
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: testInfo.outputPath('specialty-save-exit-mobile.png') });
  await openTaskDetails(page);
  await nav.getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(page.locator('#exam-result-panel')).toContainText('保存失败');
  await expect(page.locator('#student-learning-home')).toBeHidden();
  await page.locator('[data-specialty-save]').getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(nav.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__resolveExitSave());
  await expect(page.locator('#exam-result-panel')).toContainText('正确率50%');
  await expect(page.locator('#exam-result-panel')).toContainText('已保存本次结果');
  await expect(page.locator('#exam-result-panel')).toContainText('还有 1 题未独立作答');
  await expect(page.locator('#student-learning-home')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('specialty-end-result-mobile.png') });
  await page.locator('[data-specialty-home]').click();
  await expect(page.locator('#student-learning-home h1')).toHaveText('学习首页');
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  await expect(page.locator('.pc-recent-practice')).toContainText('已结束 · 2题 · 正确率50%');
  expect(await page.evaluate(() => window.__exitSaved.statistics.session_questions.map(row => [row.answer, row.status]))).toEqual([[1, 'correct'], [2, 'wrong']]);
  expect(await page.evaluate(() => window.examViewer.getSpecialtyProgress())).toBeNull();
  await page.locator('.pc-recent-practice [data-role-admin-intent="openSpecialtyResult:0"]').click();
  await expect(page.locator('#exam-result-panel')).toContainText('正确率50%');
});

test('专项刷新后恢复暂存，退出返回原筛选和位置，保存后更新三列', async ({ page }, testInfo) => {
  let saved = null;
  const chapter = () => ({ id: 'resume', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み（恢复目标）', question_count: 4, answered: saved ? 1 : 0, correct: 0 });
  await page.route('**/api/v1/me/study-goals', route => route.fulfill({ json: { code: 'OK', data: { items: [{ goal_id: 'resume_goal', exam_target: 'JLPT N3', target_date: '2099-12-01' }] } } }));
  await page.route('**/api/v1/chapters**', route => {
    const detail = new URL(route.request().url()).pathname.endsWith('/resume');
    return route.fulfill({ json: { code: 'OK', data: detail ? { questions: [1, 2, 3, 4].map(id => ({ exam_id: 'N2_2010_07', question_id: String(id), status: saved && id === 3 ? 'wrong' : '' })) } : { items: [...Array.from({ length: 40 }, (_, i) => ({ ...chapter(), id: `empty_${i}`, section_name: `其他词汇题型${i}`, question_count: 0, answered: 0 })), chapter()] } } });
  });
  await page.route('**/api/v1/exams/N2_2010_07*', route => route.fulfill({ json: { code: 'OK', data: { family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2, 3, 4].map(id => ({ id, question: `恢复测试${id}`, options: ['正确', '错误'], correct_answer: 1, explanation: '恢复后的解析' })) }] } } } }));
  await page.route('**/api/v1/recent-learning/**', route => route.fulfill({ json: { code: 'OK', data: { items: [] } } }));
  await page.route('**/api/v1/answers/*/__specialty/attempts*', route => route.fulfill({ json: { code: 'OK', data: saved ? [saved] : [] } }));
  await page.route('**/api/v1/answers/specialty-session', route => {
    const body = route.request().postDataJSON();
    saved = { submission_id: body.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: body.label, session_questions: body.questions, total_questions: body.questions.length, correct_count: 0, wrong_count: 1, viewed_count: 1 } };
    return route.fulfill({ json: { code: 'OK', data: saved } });
  });
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await page.locator('#cp-domain').selectOption('vocabulary');
  await page.locator('#cp-order').selectOption('desc');
  const row = page.locator('.cp-row').filter({ hasText: '恢复目标' });
  await row.scrollIntoViewIfNeeded();
  await row.locator('[data-cp-stat="unanswered"]').click();
  await expect(page.locator('#specialty-practice-mode')).toContainText('未做题练习');
  await expect(page.locator('.specialty-nav .end-practice-btn')).toHaveCount(0);
  // Keep a legacy viewed-only draft to verify compatibility with earlier sessions.
  await page.evaluate(() => {
    const viewer = window.examViewer;
    const ref = viewer.specialtyPractice.questions[viewer.specialtyPractice.index];
    const key = `${ref.examId}:${ref.questionId}`;
    viewer.specialtyOutcomes.set(key, { exam_id: ref.examId, question_id: ref.questionId, answer: null, viewed: true, status: 'viewed' });
    viewer.specialtyRevealed.add(key);
    viewer.persistSpecialtyDraft();
  });
  await page.locator('.specialty-nav .next-btn').click();
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('2 / 4');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('3', 2));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(`examViewer.specialtyDraft.v1:${window.examViewer.userId}`)));
  expect(stored.session.index).toBe(1);
  expect(stored.returnContext.scrollTop).toBeGreaterThan(0);
  expect(stored.returnContext).toMatchObject({ level: 'N2', domain: 'vocabulary', order: 'desc' });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#student-learning-home')).toBeVisible();
  await expect(page.locator('.pc-recent-practice')).toContainText('已做2/4题');
  expect(await page.evaluate(() => {
    const viewer = window.examViewer;
    const owner = viewer.userId;
    viewer.userId = 'different_account';
    const other = viewer.getSpecialtyProgress();
    viewer.userId = owner;
    return other;
  })).toBeNull();
  await page.locator('.pc-recent-practice [data-role-admin-intent^="resumeSpecialtyPractice:"]').click();
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('2 / 4');
  expect(await page.evaluate(() => [window.examViewer.userAnswers['0:3'], window.examViewer.showAnswers, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([2, false, true]);
  await page.locator('.specialty-nav .prev-btn').click();
  await expect(page.locator('#specialty-question-feedback')).toContainText('仅查看答案 · 不计作答，不计入正确率');
  await page.locator('.specialty-nav .next-btn').click();
  await openTaskDetails(page);
  await page.locator('.specialty-nav').getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(page.locator('#exam-result-panel')).toContainText('已保存本次结果');
  await page.locator('[data-specialty-home]').click();
  await expect(page.locator('#chapter-modal')).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  await expect(page.locator('#cp-exam')).toHaveValue('JLPT-N2');
  await expect(page.locator('#cp-domain')).toHaveValue('vocabulary');
  await expect(page.locator('#cp-order')).toHaveValue('desc');
  await expect(row.locator('.cp-stat-number, .cp-stat-zero')).toHaveText(['3', '0', '1']);
  await expect(page.locator('.cp-catalog-update')).toContainText('本次答对 0 题、答错 1 题，已更新');
  await expect(row).toHaveClass(/is-updated/);
  await expect.poll(() => row.evaluate(el => el.getBoundingClientRect().top - el.closest('.pc-platform-admin-content').getBoundingClientRect().top)).toBeCloseTo(stored.returnContext.rowOffset, 0);
  expect(saved.statistics.session_questions.map(q => q.status)).toEqual(['viewed', 'wrong']);
  expect(await page.evaluate(() => localStorage.getItem(`examViewer.specialtyDraft.v1:${window.examViewer.userId}`))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath('specialty-return-restored.png') });
  await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => window.examViewer.getSpecialtyProgress())).toBeNull();
});

test('专项顶部主页先保存并展示结果，确认后返回首页', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__homeSaveCount = 0;
    window.APIClient.listRecentLearning = async () => ({ items: [] });
    window.APIClient.listChapters = async () => ({ items: [{ id: 'home_exit', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '漢字読み', question_count: 2, answered: 0, correct: 0 }] });
    window.APIClient.getChapterDetail = async () => ({ questions: [1, 2].map(id => ({ exam_id: 'N2_2010_07', question_id: String(id) })) });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2].map(id => ({ id, question: `主页退出${id}`, options: ['正确', '错误'], correct_answer: 1 })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveSpecialtySession = payload => new Promise(resolve => {
      window.__homeSaveCount++;
      window.__resolveHomeExit = () => resolve({ submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, correct_count: 1, wrong_count: 0, total_questions: 1 } });
    });
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await page.locator('[data-cp-stat="unanswered"]').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  await page.locator('#learning-topbar .ls-topbar-home').click();
  const modal = page.locator('#exam-result-modal');
  const home = modal.getByRole('button', { name: '返回首页', exact: true });
  await expect(modal).toBeVisible();
  await expect(home).toBeDisabled();
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await page.evaluate(() => window.__resolveHomeExit());
  await expect(home).toBeEnabled();
  await expect(modal).toContainText('正确率100%');
  await expect(page.locator('#platform-admin-shell')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('specialty-home-before-return.png') });
  await home.click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#student-learning-home h1')).toHaveText('学习首页');
  await expect(page.locator('#cp-inline-host')).toBeHidden();
  expect(await page.evaluate(() => window.__homeSaveCount)).toBe(1);
});

test('专项只做两题即可结束并返回首页，已保存结果可重新查看', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__partialSpecialtySaved = null;
    window.__partialSpecialtySaves = 0;
    window.APIClient.listRecentLearning = async () => ({ items: [] });
    window.APIClient.listChapters = async () => ({ items: [{ id: 'partial', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '漢字読み', question_count: 4, answered: 0, correct: 0 }] });
    window.APIClient.getChapterDetail = async () => ({ questions: [1, 2, 3, 4].map(id => ({ exam_id: 'N2_2010_07', question_id: String(id) })) });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2, 3, 4].map(id => ({ id, question: `部分练习${id}`, options: ['正确', '错误'], correct_answer: 1 })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveSpecialtySession = payload => new Promise(resolve => {
      window.__partialSpecialtySaves++;
      window.__resolvePartialSpecialty = () => {
        window.__partialSpecialtySaved = { submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: payload.questions.length } };
        resolve(window.__partialSpecialtySaved);
      };
    });
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === '__specialty' && window.__partialSpecialtySaved ? [window.__partialSpecialtySaved] : [];
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await page.locator('[data-cp-stat="unanswered"]').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  await page.evaluate(() => window.examViewer.navigateToNextQuestion());
  await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(1);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await page.evaluate(() => window.examViewer.navigateToNextQuestion());
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('3 / 4');
  await page.locator('.specialty-nav .next-btn').click();
  await page.locator('.specialty-nav').getByRole('button', { name: '完成练习', exact: true }).click();
  const modal = page.locator('#exam-result-modal');
  const home = modal.getByRole('button', { name: '返回专项', exact: true });
  await expect(modal).toContainText('本次练习 2 题 · 独立作答 2 题');
  await expect(home).toBeDisabled();
  await page.waitForFunction(() => typeof window.__resolvePartialSpecialty === 'function');
  await page.evaluate(() => window.__resolvePartialSpecialty());
  await expect(home).toBeEnabled();
  await expect(modal).toContainText('已保存本次结果');
  await page.screenshot({ path: testInfo.outputPath('specialty-finish-home-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#exam-result-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await home.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('specialty-finish-home-mobile.png') });
  await home.click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#student-learning-home h1')).toHaveText('学习首页');
  await expect(page.locator('.pc-recent-practice')).toContainText('已结束 · 2题');
  await expect(page.locator('[data-role-admin-intent^="resumeSpecialtyPractice:"]')).toHaveCount(0);
  await page.locator('.pc-recent-practice [data-role-admin-intent="openSpecialtyResult:0"]').click();
  await expect(modal).toContainText('本次练习 2 题 · 独立作答 2 题');
  await expect(home).toBeEnabled();
  await home.click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => window.__partialSpecialtySaves)).toBe(1);
});

test('专项先确认作答再查看解析，未答不能提前看答案且结果可重新打开', async ({ page }, testInfo) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.__specialtySaved = null;
    window.__paperDraftSaves = 0;
    window.APIClient.listRecentLearning = async () => ({ items: Array.from({ length: 6 }, (_, i) => ({ exam_id: `N2_201${i}_07`, status: 'draft', total_questions: 100, answered_count: i + 1, updated_at: `2020-01-0${i + 1}T00:00:00Z` })) });
    window.APIClient.listChapters = async () => ({ items: [{ id: 'flow', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '漢字読み', question_count: 3, answered: 0, correct: 0 }] });
    window.APIClient.getChapterDetail = async () => ({ questions: [1, 2, 3].map(id => ({ exam_id: 'N2_2020_07', question_id: String(id) })) });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [1, 2, 3].map(id => ({ id, question: `流程测试${id}`, options: ['正确选项', '错误选项'], correct_answer: 1, explanation: '解析内容' })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => { window.__paperDraftSaves += 1; return { revision: 1 }; };
    window.APIClient.saveSpecialtySession = async payload => {
      window.__specialtySaved = { submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: 3, correct_count: 2, wrong_count: 1, viewed_count: 0 } };
      return window.__specialtySaved;
    };
    window.APIClient.getAnswerAttempts = async () => window.__specialtySaved ? [window.__specialtySaved] : [];
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  await page.locator('[data-cp-stat="unanswered"]').click();
  await expect(page.locator('#chapter-modal')).toBeHidden();
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-free-practice'));
  // The free-practice page already has the recent-practice entry; avoid a
  // second floating entry for the same session and resume from that row.
  await expect(page.locator('.pc-continue-dock')).toHaveCount(0);
  await expect(page.locator('.pc-recent-practice')).toContainText('已做0/3题');
  await page.locator('.pc-recent-practice [data-role-admin-intent^="resumeSpecialtyPractice:"]').click();
  await expect(page.locator('#specialty-question-feedback button')).toHaveText('确认并查看解析');
  await expect(page.locator('#specialty-question-feedback button')).toBeDisabled();
  await page.evaluate(() => {
    window.examViewer.toggleAnswers(true);
    window.examViewer.toggleExplanations();
    window.examViewer.beginPracticeReview();
  });
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.showExplanations, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([false, false, true]);
  await expect(page.locator('.correct-option, .explanation')).toHaveCount(0);
  await expect(page.locator('.specialty-nav .question-counter')).toHaveText('1 / 3');
  await expect(page.locator('.specialty-nav')).not.toContainText('看答案');
  await page.screenshot({ path: testInfo.outputPath('specialty-navigation-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('specialty-navigation-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  await expect(page.locator('#specialty-question-feedback button')).toBeEnabled();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await expect(page.locator('#specialty-question-feedback')).not.toContainText('答对了');
  await page.locator('#specialty-question-feedback button').click();
  await expect(page.locator('#specialty-question-feedback')).toContainText('答对了');
  await expect(page.locator('.explanation').first()).toBeVisible();
  expect(await page.evaluate(() => [window.examViewer.specialtyPractice.index, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([0, false]);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '1'))).toBe(1);
  await page.evaluate(() => window.examViewer.navigateToNextQuestion());
  await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(1);
  await page.evaluate(() => window.examViewer.toggleAnswers(true));
  expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 1));
  await page.evaluate(() => window.examViewer.toggleExplanations());
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([false, true]);
  await page.locator('.specialty-confirm-answer').click();
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([true, false]);
  await page.evaluate(() => window.examViewer.navigateToNextQuestion());
  await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(2);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('3', 2));
  await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  await expect(page.locator('.pc-recent-practice')).toContainText('进行中 · 已做3/3题');
  await page.locator('.pc-recent-practice [data-role-admin-intent^="resumeSpecialtyPractice:"]').click();
  await page.evaluate(() => window.examViewer.finishPractice());
  await expect(page.locator('#exam-result-panel')).toContainText('正确率67%');
  await expect(page.locator('#exam-result-panel')).toContainText('看答案学习0题');
  await page.screenshot({ path: testInfo.outputPath('specialty-result-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#exam-result-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('specialty-result-mobile.png') });
  const rows = await page.evaluate(() => window.__specialtySaved.statistics.session_questions);
  expect(rows.map(row => row.status)).toEqual(['correct', 'correct', 'wrong']);
  expect(rows.every(row => row.viewed === false)).toBe(true);
  expect(rows[0].answer).toBe(1);
  expect(await page.evaluate(() => window.__paperDraftSaves)).toBe(0);
  await page.locator('#exam-result-panel [aria-label="关闭练习结果"]').click();
  await page.evaluate(() => window.navigateLearningWorkspace('openStudentFreePractice:'));
  await expect(page.locator('.pc-recent-practice')).toBeVisible();
  await expect(page.locator('.pc-selfstudy-choose .pc-recent-practice')).toHaveCount(1);
  await expect(page.locator('.pc-recent-practice')).not.toContainText('进行中');
  await expect(page.locator('.pc-recent-practice .pc-selfstudy-draft-row')).toHaveCount(1);
  await expect(page.locator('.pc-continue-dock')).toHaveCount(0);
  const more = page.locator('[data-role-admin-intent="toggleRecentPractice"]');
  await expect(more).toHaveText('更多记录');
  await more.click();
  await expect(page.locator('.pc-recent-practice .pc-selfstudy-draft-row')).toHaveCount(5);
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await more.click();
  await expect(page.locator('.pc-recent-practice .pc-selfstudy-draft-row')).toHaveCount(1);
  await expect(page.locator('#cp-latest')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unified-recent-practice.png') });
  await page.locator('[data-role-admin-intent="openSpecialtyResult:0"]').click();
  await expect(page.locator('#exam-result-panel')).toContainText('正确率67%');
  await page.locator('[data-specialty-review]').click();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 2));
  expect(await page.evaluate(() => window.examViewer.userAnswers['0:1'])).toBe(1);
});

test('专项结果由服务端判分，查看答案不影响正确率且提交可重试', async ({ request }) => {
  const { loginApi, uniqueLoginId } = require('./helpers/session');
  const user = await loginApi(request, uniqueLoginId('specialty_flow'));
  const headers = { Authorization: `Bearer ${user.token}` };
  const paper = (await (await request.get('/api/v1/exams/N2_2010_07', { headers })).json()).data;
  const qs = paper.exam_info.sections[0].passages.flatMap(p => p.questions);
  const payload = { label: '漢字読み测试', submission_id: 'flow-once', questions: [
    { exam_id: 'N2_2010_07', question_id: String(qs[0].id), answer: qs[0].correct_answer, viewed: false },
    { exam_id: 'N2_2010_07', question_id: String(qs[1].id), answer: qs[1].correct_answer, viewed: true },
    { exam_id: 'N2_2010_07', question_id: String(qs[2].id), answer: Number(qs[2].correct_answer) === 1 ? 2 : 1, viewed: false }
  ] };
  const response = await request.post('/api/v1/answers/specialty-session', { headers, data: payload });
  expect(response.ok(), await response.text()).toBeTruthy();
  const saved = (await response.json()).data;
  expect(saved.statistics.correct_count).toBe(1);
  expect(saved.statistics.wrong_count).toBe(1);
  expect(saved.statistics.viewed_count).toBe(1);
  expect(saved.statistics.accuracy).toBe(50);
  const again = await request.post('/api/v1/answers/specialty-session', { headers, data: payload });
  expect((await again.json()).data.idempotent_replay).toBe(true);
  const history = await request.get(`/api/v1/answers/${user.user_id || user.id}/__specialty/attempts`, { headers });
  expect((await history.json()).data).toHaveLength(1);
  const chapterUrl = `/api/v1/chapters?family=jlpt&level=N2&user_id=${user.user_id || user.id}`;
  const chapters = (await (await request.get(chapterUrl, { headers })).json()).data.items;
  const chapter = chapters.find(item => item.section_name === paper.exam_info.sections[0].section_name);
  expect(chapter.answered).toBe(2);
  expect(chapter.correct).toBe(1);
  const viewedAgain = await request.post('/api/v1/answers/specialty-session', { headers, data: { ...payload, submission_id: 'flow-viewed', questions: [{ ...payload.questions[0], viewed: true }] } });
  expect(viewedAgain.ok()).toBeTruthy();
  const after = (await (await request.get(chapterUrl, { headers })).json()).data.items.find(item => item.id === chapter.id);
  expect(after.answered).toBe(2);
  expect(after.correct).toBe(1);
  const corrected = await request.post('/api/v1/answers/specialty-session', { headers, data: { ...payload, submission_id: 'flow-corrected', questions: [{ ...payload.questions[2], answer: qs[2].correct_answer }] } });
  expect(corrected.ok()).toBeTruthy();
  const latest = (await (await request.get(chapterUrl, { headers })).json()).data.items.find(item => item.id === chapter.id);
  expect(latest.answered).toBe(2);
  expect(latest.correct).toBe(2);
  const detail = (await (await request.get(`/api/v1/chapters/${encodeURIComponent(chapter.id)}?user_id=${user.user_id || user.id}`, { headers })).json()).data;
  expect(detail.questions.filter(q => q.status === 'correct')).toHaveLength(2);
  expect(detail.questions.filter(q => q.status === 'wrong')).toHaveLength(0);
  expect(detail.questions.filter(q => q.status !== 'correct' && q.status !== 'wrong').length + 2).toBe(latest.question_count);
});

test('整卷草稿题量来自真实试卷，不能把已答条数当作总题数', async ({ request }) => {
  const { loginApi, uniqueLoginId } = require('./helpers/session');
  const user = await loginApi(request, uniqueLoginId('draft_total'));
  const id = user.user_id || user.id;
  const headers = { Authorization: `Bearer ${user.token}` };
  const response = await request.post(`/api/v1/drafts/${id}`, { headers, data: { exam_id: 'N2_2010_07', exam_mode: 'practice', total_questions: 1, answered_count: 1, answers: { '0:1': 2 } } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const draft = (await response.json()).data;
  expect(draft.answered_count).toBe(1);
  expect(draft.total_questions).toBeGreaterThan(1);
  const recent = (await (await request.get(`/api/v1/recent-learning/${id}`, { headers })).json()).data.items.find(item => item.exam_id === 'N2_2010_07');
  expect(recent.total_questions).toBe(draft.total_questions);
  expect(recent.answered_count).toBe(1);
  const again = (await (await request.get(`/api/v1/recent-learning/${id}`, { headers })).json()).data.items.find(item => item.exam_id === 'N2_2010_07');
  expect(again.updated_at).toBe(recent.updated_at);
});

test('真实2010表記题正常作答不变成看答案学习，解析换行正常', async ({ page }) => {
  await loginWithPassword(page, uniqueLoginId('student_chapters'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window.APIClient.saveSpecialtySession = async payload => ({ submission_id: payload.submission_id, statistics: { practice_label: payload.label, session_questions: payload.questions } });
    window.navigateLearningWorkspace('openStudentFreePractice:');
  });
  await page.locator('#cp-exam').selectOption('JLPT-N2');
  const row = page.locator('.cp-topic').filter({ hasText: '問題2 - 表記' });
  await row.locator('[data-cp-stat="unanswered"]').click();
  await expect(page.locator('#chapter-modal')).toBeHidden();
  await expect(page.locator('#specialty-question-source')).toContainText('2010年7月');
  for (let i = 0; i < 3; i++) {
    const q = await page.evaluate(() => {
      const v = window.examViewer;
      const q = v.currentExam.exam_info.sections[v.currentSectionIndex].questions[v.currentQuestionIndex];
      return { id: String(q.id), answer: Number(q.correct_answer) };
    });
    await page.locator(`[data-question-id="${q.id}"][data-option-index="${q.answer}"]`).first().click();
    expect(await page.evaluate(() => window.examViewer.showAnswers)).toBe(false);
    await page.locator('#specialty-question-feedback button').click();
    await expect(page.locator('#specialty-question-feedback')).toContainText('答对了');
    await expect(page.locator('.explanation').first()).not.toContainText('\\n');
    if (i < 2) {
      await page.locator('.specialty-nav .next-btn').click();
      await expect.poll(() => page.evaluate(() => window.examViewer.specialtyPractice.index)).toBe(i + 1);
    }
  }
  await page.evaluate(() => window.examViewer.finishPractice());
  await expect(page.locator('#exam-result-panel')).toContainText('独立作答 3 题');
  await expect(page.locator('#exam-result-panel')).toContainText('正确率100%');
  await expect(page.locator('#exam-result-panel')).toContainText('看答案学习0题');
  await expect(page.locator('#exam-result-panel')).toContainText('2010年7月');
});
