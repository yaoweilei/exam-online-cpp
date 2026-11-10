const { test, expect } = require('@playwright/test');
const { openTaskDetails } = require('./helpers/task-navigation');
const { loginWithPassword, stubPracticeDraftSync } = require('./helpers/session');

async function setGoalDate(page, value) {
  await page.locator('#sg-date').evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function openHome(page, scenario = 'ready', targetOverride = '') {
  const target = targetOverride || (scenario === 'crosslevel' ? 'JLPT N3' : 'JLPT N2');
  await page.route('**/api/v1/me/study-goals', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'OK', data: { items: [{ goal_id: 'goal_test_n2', title: '备考', exam_target: target, target_date: '2099-12-01', daily_question_target: 12 }] } }) });
  });
  await loginWithPassword(page, 'student_demo');
  await expect(page.locator('#learning-shell')).toBeAttached();
  await page.waitForLoadState('networkidle');
  await page.evaluate(({ scenario, target }) => {
    const api = window.APIClient;
    const question = (exam_id, question_id, source, section_type = '') => ({
      exam_id, question_id, source, section_type,
      ...(source === 'srs_due' ? { card_id: `${exam_id}:${question_id}` } : {})
    });
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_test_n2', title: '备考', exam_target: target, target_date: '2099-12-01', daily_question_target: 12 }] });
    api.getWrongQuestionSummary = async () => { if (scenario === 'counts_error') throw new Error('summary unavailable'); return { total: 15, active: 12, mastered: 3 }; };
    api.getBookmarks = async () => { if (scenario === 'counts_error') throw new Error('bookmarks unavailable'); return { questions: [{ question_id: 'a' }, { question_id: 'b' }, { question_id: 'c' }] }; };
    api.listRecentLearning = async () => ({ items: scenario === 'empty' ? [] : [
      { exam_id: 'N2_2024_07', status: 'submitted', answered_count: 20, total_questions: 20 },
      ...(scenario === 'diagnosis_draft' ? [{ exam_id: 'N2_DIAGNOSTIC_V1', status: 'draft', answered_count: 8, total_questions: 40, last_section_index: 0, last_question_index: 7 }] : []),
      ...(['completed', 'diagnosis_draft', 'diagnostic', 'observing', 'weak', 'debt', 'phase_shift', 'today_complete'].includes(scenario) ? [] : [{ exam_id: 'N2_2025_07', status: 'draft', answered_count: scenario === 'ready' ? 2 : 1, total_questions: 2, last_section_index: 2, last_question_index: 1 }])
    ] });
    api.listMyAssignments = async () => ({ items: scenario === 'assignments' ? [
      { assignment_id: 'urgent', exam_id: 'N2_2025_07', title: '阅读作业', due_at: '2020-01-01', own_submission: {} },
      { assignment_id: 'later', exam_id: 'N2_2025_07', title: '听力作业', due_at: '2099-01-01', own_submission: {} },
      { assignment_id: 'done', title: '已交作业', own_submission: { submitted_at: '2026-01-01' } }
    ] : [] });
    api.listSrsDue = async () => ({ items: scenario === 'empty' ? [] : scenario === 'debt'
      ? Array.from({ length: 25 }, (_, index) => question('N2_2025_07', String(index + 10), 'srs_due'))
      : [question('N2_2025_07', '1', 'srs_due')] });
    api.sampleWrongQuestions = async () => ({ items: scenario === 'empty' ? [] : [question('N2_2025_07', '1', 'wrong_question'), question('N2_2025_07', '2', 'wrong_question')] });
    api.getDailyPractice = async () => {
      if (scenario === 'error') throw new Error('NetworkError when attempting to fetch resource.');
      if (['empty', 'diagnosis_draft'].includes(scenario)) return { items: [], completed_question_ids: [] };
      if (scenario === 'today_complete') return {
        items: [question('N2_2025_07', '3', 'recommended', 'reading')],
        completed_question_ids: ['N2_2025_07\u001f3']
      };
      const due = scenario === 'debt'
        ? Array.from({ length: 25 }, (_, index) => question('N2_2025_07', String(index + 10), 'srs_due'))
        : [question('N2_2025_07', '1', 'srs_due')];
      const wrong = [
        { ...question('N2_2025_07', '1', 'wrong_question'), wrong_count: 2 },
        { ...question('N2_2025_07', '2', 'wrong_question'), wrong_count: 2 }
      ];
      const recommended = scenario === 'observing' ? [] : [question('N2_2025_07', '3', 'recommended', 'reading'), question('N1_2025_07', '4', 'recommended', 'reading'), question('N2_2025_07', '5', 'recommended', 'grammar')];
      return { items: [...due, ...wrong, ...recommended], completed_question_ids: ['5'] };
    };
    api.getAdaptiveLearningProfile = async () => ['empty', 'completed', 'diagnosis_draft'].includes(scenario) ? null : ({
      exam_target: 'JLPT N2', available_targets: ['JLPT N2'],
      updated_at: scenario === 'stale' ? '2026-01-01T10:00:00Z' : new Date().toISOString(),
      model_version: 'mastery-v0.1', daily_minutes: 20, knowledge_target: 5,
      weak_knowledge: [{}, {}, {}, {}, {}],
      domains: {
		vocabulary: { score: scenario === 'diagnostic' ? 50 : 68, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 1 : 7, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		grammar: { score: scenario === 'diagnostic' ? 100 : 74, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 2 : 8, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		reading: { score: scenario === 'diagnostic' ? 0 : scenario === 'phase_shift' ? 55 : 52, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 0 : 5, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		listening: { score: scenario === 'diagnostic' ? 50 : scenario === 'phase_shift' ? 35 : 61, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 1 : 6, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 }
      }
    });
    api.getAnswerAttempts = async (_userId, examId) => scenario === 'crosslevel' && examId === '__specialty' ? [] : scenario === 'diagnostic' ? [{ statistics: { results: {
      '0:1': { section_index: 0, status: 'correct' }, '0:2': { section_index: 0, status: 'wrong' },
      '1:3': { section_index: 1, status: 'correct' }, '1:4': { section_index: 1, status: 'correct' },
      '2:5': { section_index: 2, status: 'wrong' }, '2:6': { section_index: 2, status: 'wrong' },
      '3:7': { section_index: 3, status: 'correct' }, '3:8': { section_index: 3, status: 'wrong' }
    } }, saved_at: new Date().toISOString() }] : [{ statistics: { diagnostic_answered_count: 40, score: 80, correct_count: 8, wrong_count: 2, unanswered_count: 0 }, saved_at: new Date().toISOString() }];
    // Startup now opens the home page; refresh its data after installing fixtures.
    window.dispatchEvent(new Event('examAnswersSubmitted'));
    window.navigateLearningWorkspace('__overview__');
    window.openPersonalCenter();
  }, { scenario, target });
  const shell = page.locator('#platform-admin-shell');
  await expect(shell.locator('.pc-selfstudy-goal')).toContainText(target);
  await expect(shell.locator('.pc-selfstudy-goal')).toContainText('每天 20 分钟');
  await expect(shell.locator('.pc-learning-home')).not.toContainText('mastery-v0.1');
  await expect(shell.locator('section[aria-label="今天的学习"]')).not.toContainText('正在读取');
  await expect(shell.locator('.pc-workbench-stage')).toHaveCount(0);
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  return shell;
}

async function installPaperPracticeFixtures(page) {
  await page.evaluate(() => {
    window.__paperPracticeSaved = null;
    window.APIClient.getExams = async ({ family }) => family === 'eju' ? [{ id: '2020_01' }] : [{ id: 'N2_2020_12' }, { id: 'N2_2019_07' }];
    const question = id => ({ id, question: `真题题组测试${id}`, options: ['正确', '错误'], correct_answer: 1, explanation: '题组练习解析' });
    window.APIClient.getExam = async id => !id.startsWith('N') ? { family: 'eju', exam_info: { sections: [
      { section_type: 'reading', section_name: '读解 第一题组', passages: [{ questions: [question(10), question(11)] }] },
      { section_type: 'listening_reading', section_name: '听读解 第一题组', questions: [question(12)] }
    ] } } : { family: 'jlpt', exam_info: { exam_level: 'N2', sections: [
      { section_type: 'vocabulary', section_name: '問題1 - 漢字読み', questions: [question(1), question(2)] },
      { section_type: 'grammar', section_name: '問題7 - 文の文法', questions: [question(3)] },
      { section_type: 'reading', section_name: '問題10 - 短文', questions: [question(4), question(5)] },
      { section_type: 'reading', section_name: '問題11 - 中文', questions: [question(6)] },
      { section_type: 'listening', section_name: '聴解', questions: [question(7)] }
    ] } };
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
    window.APIClient.saveSpecialtySession = async payload => {
      window.__paperPracticeSaved = { submission_id: payload.submission_id, saved_at: new Date().toISOString(), statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: payload.questions.length, correct_count: payload.questions.filter(q => q.status === 'correct').length, wrong_count: payload.questions.filter(q => q.status === 'wrong').length } };
      return window.__paperPracticeSaved;
    };
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === '__specialty' && window.__paperPracticeSaved ? [window.__paperPracticeSaved] : [];
  });
}

test('登录后真题可选多个题组，按所选范围作答并保存后返回原试卷', async ({ page }, testInfo) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  const free = shell.getByRole('region', { name: '自由练习', exact: true });
  await free.getByRole('button', { name: /真题模式/ }).click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-practice="N2_2020_12"]').click();
  const setup = pane.getByRole('region', { name: '选择练习题组' });
  await expect(setup.locator('[data-paper-section]')).toHaveCount(5);
  await expect(setup.locator('[role="status"]')).toHaveText('已选 1 个题组，共 2 题');
  await setup.getByRole('combobox', { name: '练习内容' }).selectOption('阅读');
  await expect(setup.locator('[data-paper-section]')).toHaveCount(2);
  await setup.locator('[data-paper-section="3"]').check();
  await expect(setup.locator('[role="status"]')).toHaveText('已选 2 个题组，共 3 题');
  await page.screenshot({ path: testInfo.outputPath('signed-in-paper-groups-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await setup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('signed-in-paper-groups-mobile.png') });
  await setup.getByRole('button', { name: '开始练习', exact: true }).click();
  const nav = page.locator('.task-nav');
  await expect(nav).toBeVisible();
  await expect(page.locator('#specialty-practice-mode')).toHaveText('题组练习');
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.questions.map(q => [q.examId, q.questionId]))).toEqual([['N2_2020_12', '4'], ['N2_2020_12', '5'], ['N2_2020_12', '6']]);
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/practice-scrubber-active/);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('4', 1));
  await nav.locator('.next-btn').click();
  await expect(nav.locator('.question-counter')).toHaveText('2 / 3');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('5', 2));
  await nav.locator('.next-btn').click();
  await expect(nav.locator('.question-counter')).toHaveText('3 / 3');
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(3);
  await openTaskDetails(page);
  await nav.locator('.question-counter').click();
  await expect(page.locator('#question-map-overlay .question-map-item')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await openTaskDetails(page);
  await nav.getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(page.locator('#exam-result-panel')).toContainText('已保存本次结果');
  await expect(page.locator('#exam-result-panel')).toContainText('正确率50%');
  expect(await page.evaluate(() => window.__paperPracticeSaved.statistics.session_questions.map(q => q.question_id))).toEqual(['4', '5']);
  await page.locator('#exam-result-panel').getByRole('button', { name: '返回真题模式', exact: true }).click();
  await expect(pane).toBeVisible();
  await expect(free.locator('#cp-inline-host')).toBeHidden();
  await expect(setup.getByRole('combobox', { name: '练习内容' })).toHaveValue('阅读');
  await expect(setup.locator('input:checked')).toHaveCount(2);
  await expect(pane.locator('[data-paper-exam]')).toHaveValue('JLPT-N2');
  // Whole-paper practice uses the same confirmation flow across all question types.
  await pane.locator('[data-paper-open="N2_2019_07"]').click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => [window.examViewer.examMode, window.examViewer.specialtyPractice.questions.length])).toEqual(['practice', 7]);
  await expect(page.locator('#specialty-practice-mode')).toHaveText('整套练习');
  await expect(page.locator('#submit-exam')).toBeHidden();
});

test('整套练习逐题确认并跨题型跳转，结束保存整卷记录且可只读回顾', async ({ page }, testInfo) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    window.__wholePaperSaves = [];
    window.APIClient.savePracticeGroup = async payload => {
      window.__wholePaperSaves.push(payload);
      const results = Object.fromEntries(Object.entries(payload.answers).map(([key, answer]) => [key, { status: answer === 1 ? 'correct' : 'wrong' }]));
      window.__wholePaperRecord = { submission_id: payload.submission_id, answers: payload.answers, statistics: { results, practice_label: payload.label, section_indexes: payload.section_indexes } };
      return window.__wholePaperRecord;
    };
    window.APIClient.listRecentLearning = async () => ({ items: window.__wholePaperRecord ? [
      // Older mock drafts can coexist with an ended whole-paper practice. Even
      // if the draft is returned first, it must not revive the ended practice.
      { exam_id: 'N2_2020_12', status: 'draft', answered_count: 1, total_questions: 7 },
      { exam_id: 'N2_2020_12', source: 'practice_group', practice_label: window.__wholePaperRecord.statistics.practice_label, status: 'submitted', answered_count: 3, total_questions: 7 }
    ] : [] });
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === 'N2_2020_12__practice' && window.__wholePaperRecord ? [window.__wholePaperRecord] : [];
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  const nav = page.locator('.task-nav');
  await expect(nav.locator('.question-counter')).toHaveText('1 / 7');
  await expect(page.locator('#submit-exam')).toBeHidden();
  await expect(page.getByText('模拟考试计时', { exact: true })).toBeHidden();
  await expect(page.locator('.specialty-bookmark-star')).toBeVisible();
  const confirm = page.locator('.specialty-confirm-answer');
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  await confirm.click();
  await expect(page.locator('#specialty-question-feedback')).toContainText('答对了');
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
  expect(await page.evaluate(() => [window.examViewer.showAnswers, window.examViewer.showExplanations, window.examViewer.showReadingKana, window.examViewer.showReadingZh])).toEqual([true, true, true, true]);
  await nav.locator('.next-btn').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await nav.locator('.question-counter').click();
  await expect(page.locator('#question-map-overlay .question-map-item')).toHaveCount(7);
  await page.locator('[data-specialty-index="4"]').click();
  await expect(nav.locator('.question-counter')).toHaveText('5 / 7');
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(2);
  expect(await page.evaluate(() => window.examViewer.canUseReadingAssists())).toBe(false);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('5', 1));
  await page.screenshot({ path: testInfo.outputPath('whole-paper-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeVisible();
  expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('whole-paper-mobile.png') });
  await nav.getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(page.locator('#exam-result-panel')).toContainText('已保存本次结果');
  await expect(page.locator('#exam-result-panel')).toContainText('正确率67%');
  const saved = await page.evaluate(() => window.__wholePaperSaves);
  expect(saved).toHaveLength(1);
  expect(saved[0].exam_id).toBe('N2_2020_12');
  expect(saved[0].section_indexes).toEqual([0, 1, 2, 3, 4]);
  expect(saved[0].answers).toEqual({ '0:1': 1, '0:2': 2, '2:5': 1 });
  await page.locator('#exam-result-panel').getByRole('button', { name: '返回真题模式', exact: true }).click();
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('region', { name: '选择练习题组' })).toHaveCount(0);
  await expect(pane.locator('[data-paper-open="N2_2020_12"]')).toHaveText('查看作答');
  await expect(pane.locator('[data-paper-open="N2_2020_12"]').locator('xpath=ancestor::div[contains(@class,"pc-paper-row")]')).toContainText('已结束');
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.locator('.pc-recent-practice')).not.toContainText('进行中');
  await page.evaluate(() => window.dispatchEvent(new Event('examAnswersSubmitted')));
  await shell.getByRole('button', { name: /真题模式/ }).click();
  await expect(pane.locator('[data-paper-open="N2_2020_12"]')).toHaveText('查看作答');
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  await expect(page.locator('#specialty-practice-mode')).toHaveText('整套回顾');
  await expect(nav.locator('.question-counter')).toHaveText('1 / 7');
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '1'))).toBe(1);
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
  await nav.getByRole('button', { name: '返回真题模式', exact: true }).click();
  expect(await page.evaluate(() => window.__wholePaperSaves.length)).toBe(1);
});

test('整套练习普通返回保留进行中状态，刷新后继续同一题且不生成结束记录', async ({ page }) => {
  test.setTimeout(120000);
  let shell = await openHome(page);
  const fixtures = async () => {
    await installPaperPracticeFixtures(page);
    await page.evaluate(() => {
      window.__unexpectedFinishes = 0;
      window.APIClient.savePracticeGroup = async () => { window.__unexpectedFinishes++; throw new Error('普通返回不应结束练习'); };
    });
  };
  await fixtures();
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  let pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  const nav = page.locator('.task-nav');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('1', 1));
  await page.locator('.specialty-confirm-answer').click();
  await nav.locator('.next-btn').click();
  await page.evaluate(() => window.examViewer.answerManager.selectOption('2', 2));
  await page.locator('[data-ls-return-navigation]').click();
  await expect(pane).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  await expect(pane.locator('[data-paper-open="N2_2020_12"]')).toHaveText('继续练习');
  expect(await page.evaluate(() => window.__unexpectedFinishes)).toBe(0);
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  await expect(nav.locator('.question-counter')).toHaveText('2 / 7');
  expect(await page.evaluate(() => [window.examViewer.answerManager.getAnswerComposite(0, '2'), window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([2, true]);
  await page.locator('.ls-topbar-home').click();
  await expect(shell).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
  expect(await page.evaluate(() => window.__unexpectedFinishes)).toBe(0);
  // openHome reloads and signs in as the same user; only persisted progress survives.
  shell = await openHome(page);
  await fixtures();
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  pane = shell.locator('#paper-library');
  await expect(pane.locator('[data-paper-open="N2_2020_12"]')).toHaveText('继续练习');
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  await expect(nav.locator('.question-counter')).toHaveText('2 / 7');
  expect(await page.evaluate(() => [window.examViewer.answerManager.getAnswerComposite(0, '2'), window.examViewer.canAnswerSpecialtyQuestion()])).toEqual([2, true]);
  await page.locator('[data-ls-return-navigation]').click();
  await expect(pane.locator('[data-paper-open="N2_2020_12"]')).toHaveText('继续练习');
  expect(await page.evaluate(() => window.__unexpectedFinishes)).toBe(0);
});

test('整套练习兼容旧模拟草稿，继续时保留已确认题和当前选择', async ({ page }) => {
  await stubPracticeDraftSync(page);
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    window.APIClient.getDraft = async () => ({ exam_id: 'N2_2020_12', exam_mode: 'mock', answers: { '0:1': 2, '1:3': 1, '2:4': 1 }, last_section_index: 2, last_question_index: 0 });
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-open="N2_2020_12"]').click();
  const nav = page.locator('.task-nav');
  await expect(nav.locator('.question-counter')).toHaveText('4 / 7');
  expect(await page.evaluate(() => [window.examViewer.examMode, window.examViewer.answerManager.getAnswerComposite(2, '4')])).toEqual(['practice', 1]);
  await page.locator('.specialty-confirm-answer').click();
  await nav.locator('.next-btn').click();
  await expect(nav.locator('.question-counter')).toHaveText('5 / 7');
  await page.evaluate(() => window.examViewer.answerManager.selectOption('5', 2));
  // Simulate reopening after a reload: only the per-user persisted draft remains.
  await page.evaluate(async () => {
    const viewer = window.examViewer;
    viewer.specialtyPractice = null;
    viewer.specialtyOutcomes.clear();
    viewer.specialtyAnswers.clear();
    viewer.specialtyRevealed.clear();
    await viewer.startWholePaperPractice('N2_2020_12', 'ignored', { returnContext: {} });
  });
  await expect(nav.locator('.question-counter')).toHaveText('5 / 7');
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(2, '5'))).toBe(2);
  await nav.locator('.question-counter').click();
  await page.locator('[data-specialty-index="0"]').click();
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '1'))).toBe(2);
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
  expect(await page.evaluate(() => window.examViewer.getSpecialtyQuestionMapItems().filter(item => item.status !== 'unanswered').length)).toBe(4);
});

test('EJU整套练习区分不同题型的同号题，保存失败保留答案并可重试', async ({ page }) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    const getExam = window.APIClient.getExam;
    window.APIClient.getExam = async id => {
      const data = await getExam(id);
      data.exam_info.sections.unshift({ section_type: 'writing', section_title: '記述問題', questions: [{ id: 10, question: '作文题目', prompt: '作文题目', correct_answer: null }] });
      data.exam_info.sections[1].section_title = '読解：文章を読んで答えてください。';
      return data;
    };
    window.__wholeRetryCalls = [];
    window.APIClient.savePracticeGroup = async payload => {
      window.__wholeRetryCalls.push(payload);
      if (window.__wholeRetryCalls.length === 1) throw new Error('offline');
      return { submission_id: payload.submission_id, answers: payload.answers, statistics: { results: { '1:10': { status: 'correct' } } } };
    };
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-exam]').selectOption('EJU');
  await pane.locator('[data-paper-open="2020_01"]').click();
  const nav = page.locator('.task-nav');
  await expect(nav.locator('.question-counter')).toHaveText('1 / 4');
  await nav.locator('.question-counter').click();
  await page.locator('[data-specialty-index="1"]').click();
  await expect(page.locator('.section-instruction-text')).toHaveText('読解：文章を読んで答えてください。');
  await expect(page.locator('#task-session-panel .section-instruction-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(1);
  await page.evaluate(() => window.examViewer.answerManager.selectOption('10', 1));
  await page.locator('.specialty-confirm-answer').click();
  await nav.locator('.question-counter').click();
  await page.locator('[data-specialty-index="0"]').click();
  expect(await page.evaluate(() => [window.examViewer.currentSectionIndex, window.examViewer.canAnswerSpecialtyQuestion(), window.examViewer.canUseReadingAssists()])).toEqual([0, true, false]);
  expect(await page.evaluate(() => window.examViewer.getSpecialtyQuestionMapItems().map(item => item.status))).toEqual(['unanswered', 'correct', 'unanswered', 'unanswered']);
  await nav.getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(page.locator('[data-specialty-save]')).toContainText('保存失败');
  await expect(page.locator('[data-specialty-home]')).toBeDisabled();
  expect(await page.evaluate(() => !!window.examViewer.getWholePaperProgress('2020_01'))).toBe(true);
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.locator('[data-specialty-save]')).toContainText('已保存本次结果');
  const calls = await page.evaluate(() => window.__wholeRetryCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[1].answers).toEqual({ '1:10': 1 });
  expect(calls[1].section_indexes).toEqual([0, 1, 2]);
  await page.getByRole('button', { name: '关闭练习结果', exact: true }).click();
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
});

test('已有整卷交卷记录以只读回顾打开，不重新提交或覆盖原答案', async ({ page }) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    window.APIClient.getExams = async () => [{ id: 'N2_2024_07' }];
    window.APIClient.getDraft = async () => { throw new Error('不应读取草稿'); };
    window.APIClient.getAnswerAttempts = async (_user, exam) => exam === 'N2_2024_07' ? [{ answers: { '0:1': 2 }, statistics: { results: { '0:1': { status: 'wrong' } } } }] : [];
    window.APIClient.savePracticeGroup = async () => { throw new Error('不应保存只读回顾'); };
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  await shell.locator('[data-paper-open="N2_2024_07"]').click();
  await expect(page.locator('#specialty-practice-mode')).toHaveText('整套回顾');
  await expect(page.locator('#submit-exam')).toBeHidden();
  expect(await page.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
  expect(await page.evaluate(() => window.examViewer.answerManager.getAnswerComposite(0, '1'))).toBe(2);
  expect(await page.evaluate(() => window.examViewer.getSpecialtyQuestionMapItems()[0].status)).toBe('incorrect');
  await page.locator('.task-nav').getByRole('button', { name: '返回真题模式', exact: true }).click();
  await expect(shell.locator('#paper-library')).toBeVisible();
  await expect(page.locator('#exam-result-modal')).toBeHidden();
});

test('真题题组读取失败可重试，旧请求不覆盖新试卷且未选题组不能开始', async ({ page }) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    const original = window.APIClient.getExam;
    window.__groupResolvers = {};
    window.__groupFailed = false;
    window.APIClient.getExam = async id => {
      if (!window.__groupFailed) { window.__groupFailed = true; throw new Error('读取题组测试失败'); }
      return new Promise(resolve => { window.__groupResolvers[id] = async () => resolve(await original(id)); });
    };
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-practice="N2_2020_12"]').click();
  await expect(pane.getByRole('alert')).toContainText('读取题组测试失败');
  await pane.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.__groupResolvers.N2_2020_12)).toBe(true);
  await pane.locator('[data-paper-practice="N2_2019_07"]').click();
  await expect.poll(() => page.evaluate(() => !!window.__groupResolvers.N2_2019_07)).toBe(true);
  await page.evaluate(() => window.__groupResolvers.N2_2020_12());
  await expect(pane).toContainText('正在读取题组');
  await page.evaluate(() => window.__groupResolvers.N2_2019_07());
  await expect(pane.locator('[data-paper-practice="N2_2020_12"]').first()).toHaveAttribute('aria-expanded', 'false');
  const setup = pane.getByRole('region', { name: '选择练习题组' });
  await setup.locator('[data-paper-section="0"]').uncheck();
  await expect(setup.getByRole('button', { name: '开始练习', exact: true })).toBeDisabled();
  await setup.getByRole('combobox', { name: '练习内容' }).selectOption('听力');
  await expect(setup.locator('[data-paper-section]')).toHaveCount(1);
  await expect(setup.locator('[role="status"]')).toHaveText('已选 1 个题组，共 1 题');
});

test('EJU真题按题组选练包含文章下的题目，切换考试清除原题组', async ({ page }) => {
  const shell = await openHome(page);
  await installPaperPracticeFixtures(page);
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-practice="N2_2020_12"]').click();
  await expect(pane.getByRole('region', { name: '选择练习题组' })).toBeVisible();
  await pane.locator('[data-paper-exam]').selectOption('EJU');
  await expect(pane.getByRole('region', { name: '选择练习题组' })).toHaveCount(0);
  await pane.locator('[data-paper-practice="2020_01"]').click();
  const setup = pane.getByRole('region', { name: '选择练习题组' });
  await setup.getByRole('combobox', { name: '练习内容' }).selectOption('读解');
  await expect(setup.locator('[role="status"]')).toHaveText('已选 1 个题组，共 2 题');
  await setup.getByRole('button', { name: '开始练习', exact: true }).click();
  await expect(page.locator('.task-nav .question-counter')).toHaveText('1 / 2');
  expect(await page.evaluate(() => window.examViewer.specialtyPractice.questions.map(q => q.questionId))).toEqual(['10', '11']);
  await expect(page.locator('#current-question-container')).toContainText('真题题组测试10');
  await expect(page.locator('#practice-scrubber')).toHaveCount(0);
});

test('学习首页深色主题覆盖卡片文字和展开区，切回浅色保留原配色', async ({ page }, testInfo) => {
  const shell = await openHome(page, 'empty');
  await installPaperPracticeFixtures(page);
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [{ id: 'N2', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み', question_count: 3, answered: 2, correct: 1 }] });
  });
  const home = shell.locator('#student-learning-home');
  const setTheme = async mode => {
    await page.locator('.ls-theme-trigger').click();
    await page.locator(`.ls-theme-menu [data-theme-mode="${mode}"]`).click();
  };
  const assertDark = async (surface = home) => {
    await expect.poll(() => surface.evaluate(root => {
      const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
      const luminance = value => rgb(value).slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const issues = [];
      for (const el of root.querySelectorAll('*')) {
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el), color = rgb(style.backgroundColor);
        if ((color[3] ?? 1) >= .9 && Math.min(...color.slice(0, 3)) > 200) issues.push(`浅色背景: ${el.id || el.className}`);
      }
      for (const el of root.querySelectorAll('h1, h3, .pc-selfstudy-goal small, .pc-selfstudy-shortcut strong, .pc-archive-link-copy small, .pc-selfstudy-start, #sg-form .pc-org-field > span, .pc-goal-date-trigger > span, .pc-goal-calendar-grid button:not(:disabled)')) {
        if (!el.getClientRects().length) continue;
        let parent = el;
        while (parent && (rgb(getComputedStyle(parent).backgroundColor)[3] ?? 1) < .9) parent = parent.parentElement;
        const front = luminance(getComputedStyle(el).color), back = luminance(getComputedStyle(parent || root).backgroundColor);
        const contrast = (Math.max(front, back) + .05) / (Math.min(front, back) + .05);
        if (contrast < 4.5) issues.push(`文字对比不足: ${el.className || el.tagName}: ${contrast.toFixed(2)}`);
      }
      return issues;
    })).toEqual([]);
  };
  await setTheme('dark');
  await expect(page.locator('body')).not.toHaveClass(/light-theme/);
  await assertDark();
  await page.screenshot({ path: testInfo.outputPath('student-home-dark-desktop.png') });
  await page.locator('[data-ls-group="practice"]').click();
  await home.getByRole('button', { name: /真题模式/ }).click();
  const papers = shell.locator('#paper-library');
  await papers.locator('[data-paper-practice="N2_2020_12"]').click();
  await expect(papers.locator('.pc-paper-practice-setup')).toBeVisible();
  await assertDark(papers);
  await page.screenshot({ path: testInfo.outputPath('paper-library-dark.png') });
  await shell.locator('[data-workspace-back]').click();
  await expect(home).toBeVisible();
  await home.locator('[data-role-admin-intent="openStudentFreePractice:"]').click();
  await expect(home.locator('#cp-inline-host #chapter-modal')).toBeVisible();
  await assertDark();
  await home.locator('[data-archive-section="records"]').click();
  await assertDark();
  await home.locator('[data-role-admin-intent="openStudyGoal"]').click();
  await expect(home.locator('#sg-form')).toBeVisible();
  await assertDark();
  await home.locator('#sg-exam-target-trigger').click();
  await expect(home.locator('#sg-exam-target-menu')).toBeVisible();
  await assertDark();
  await home.locator('#sg-exam-target-trigger').click();
  await home.locator('#sg-date-trigger').click();
  await expect(home.locator('#sg-date-popover')).toBeVisible();
  await assertDark();
  await home.locator('#sg-date-trigger').click();
  await page.screenshot({ path: testInfo.outputPath('student-home-dark-goal.png') });
  await home.locator('[data-role-admin-intent="openStudyGoal"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await home.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await home.locator('.pc-selfstudy-choose').scrollIntoViewIfNeeded();
  await assertDark();
  await page.screenshot({ path: testInfo.outputPath('student-home-dark-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setTheme('light');
  await page.locator('.ls-menu .ls-home').click();
  await expect(home.locator('.pc-workspace-overview-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(home.locator('.pc-selfstudy-primary')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(home.locator('.pc-selfstudy-choose')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('首页最近练习与档案入口不重复，手机布局不溢出', async ({ page }, testInfo) => {
  const shell = await openHome(page);
  const preview = shell.locator('#student-learning-home');
  const learning = preview.getByRole('region', { name: '今天的学习', exact: true });
  const freePractice = preview.getByRole('region', { name: '自由练习', exact: true });
  const archive = preview.getByRole('region', { name: '学习档案', exact: true });
  for (const [group, title] of [[learning, '系统学习'], [freePractice, '自由练习'], [archive, '学习档案']]) {
    await expect(group.locator(':scope > .pc-grouped-heading').getByText(title, { exact: true })).toBeVisible();
    await expect(group.locator(':scope > .pc-grouped-list')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  await expect(learning).toContainText('系统学习');
  await expect(learning.locator('.pc-selfstudy-steps > li').first()).toContainText('到期复习');
  await expect(learning.locator('.pc-selfstudy-steps > li')).toHaveCount(3);
  await expect(learning).toContainText('阅读');
  await expect(learning).not.toContainText('JLPT N1');
  await expect(learning).not.toContainText('待提交');
  await expect(preview.getByRole('region', { name: '待办提醒', exact: true })).toHaveCount(0);
  await expect(preview.locator('nav')).toHaveCount(0);
  await expect(freePractice.getByRole('button', { name: /专项模式/ })).toHaveCount(1);
  await expect(freePractice.getByRole('button', { name: /真题模式/ })).toHaveCount(1);
  await expect(freePractice).not.toContainText('错题复习');
  await expect(freePractice).not.toContainText('学习记录');
  const recent = freePractice.getByRole('region', { name: '最近练习', exact: true });
  await expect(recent).toBeVisible();
  await expect(recent.locator('summary')).toHaveCount(0);
  await expect(recent.getByRole('button', { name: /查看结果/ })).toBeVisible();
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await recent.getByRole('button', { name: '更多记录', exact: true }).click();
  await expect(recent).toContainText('JLPT N2 · 2025年7月真题');
  await recent.getByRole('button', { name: '收起记录', exact: true }).click();
  await expect(archive.getByRole('button')).toHaveCount(3);
  await expect(archive.getByRole('button', { name: /学习记录/ })).toHaveCount(1);
  await expect(archive.getByRole('button', { name: /错题与收藏/ })).toHaveCount(1);
  await expect(archive.getByRole('button', { name: /学习报告/ })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await learning.scrollIntoViewIfNeeded();
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('selfstudy-today-mobile.png') });
  await archive.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('selfstudy-archive-mobile.png') });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await archive.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await learning.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(shell.locator('#srs-modal')).toBeVisible();
});

test('首页子菜单定位对应内容块并橙色高亮，手机可导航', async ({ page }, testInfo) => {
  await page.route('**/api/v1/me/courses', route => route.fulfill({ json: { code: 'OK', data: {} } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  const menu = page.locator('.ls-menu');
  await expect(menu.getByRole('button', { name: '学习首页', exact: true })).toBeVisible();
  await expect(menu.locator('[data-ls-group]')).toHaveCount(3);
  await expect(menu.locator('.ls-home-child:visible')).toHaveCount(4);
  const goalLink = menu.locator('[data-ls-intent="openStudyGoal"]');
  await goalLink.click();
  await expect(shell.locator('.pc-selfstudy-goal > button')).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('[data-ls-panel] [data-ls-intent]')).toHaveCount(0);
  for (const [group, title, card] of [['study', '系统学习', '.pc-selfstudy-primary'], ['practice', '自由练习', '.pc-selfstudy-choose'], ['review', '学习档案', '.pc-selfstudy-archive']]) {
    const button = menu.locator(`[data-ls-group="${group}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'location');
    await expect(button).toHaveCSS('border-left-color', 'rgb(255, 122, 45)');
    await expect(goalLink).not.toHaveClass(/is-active/);
    const bounds = await button.boundingBox();
    const homeBounds = await menu.locator('.ls-home').boundingBox();
    expect(bounds.x - homeBounds.x).toBe(20);
    await expect(button).not.toHaveAttribute('aria-expanded', /.+/);
    await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
    await expect(shell.locator(card)).toBeVisible();
    await expect(shell.locator(card)).toHaveCSS('background-color', 'rgb(255, 247, 239)');
    await expect(shell.locator(card)).toHaveCSS('box-shadow', /255, 122, 45/);
    await expect(shell.locator('.pc-selfstudy-goal')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(menu.locator('[data-ls-continue]')).not.toBeVisible();
  }
  await menu.locator('[data-ls-intent="__overview__"]').click();
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-ls-home-section', /.+/);
  const drafts = shell.locator('.pc-recent-practice');
  await expect(drafts).toHaveAttribute('aria-label', '最近练习');
  await expect(drafts.locator('summary')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('student-home-navigation-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await shell.locator('[data-platform-admin-nav-trigger]').click();
  await expect(menu).toBeVisible();
  await menu.locator('[data-ls-group="review"]').click();
  await expect(page.locator('body')).not.toHaveClass(/ls-drawer-open/);
  await expect(shell.locator('.pc-selfstudy-archive')).toBeVisible();
  await expect(shell.locator('.pc-selfstudy-archive')).toHaveCSS('background-color', 'rgb(255, 247, 239)');
  expect(await shell.locator('.pc-learning-home').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('student-archive-mobile.png') });
});

test('系统学习与首页使用同一份目标内任务，作业另有入口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const shell = await openHome(page);
  await expect(shell).toBeVisible();
  const overviewTask = await shell.getByRole('region', { name: '今天的学习' }).innerText();
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-today'));
  const todayPage = shell.locator('.pc-learning-home');
  await expect(todayPage).toBeVisible();
  await expect(todayPage.getByRole('region', { name: '今天的学习' })).toHaveText(overviewTask, { useInnerText: true });
  await expect(todayPage).not.toContainText('JLPT N1');
  await expect(shell.locator('#review-workbench-modal')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('learning-ia-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await todayPage.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await page.setViewportSize({ width: 1600, height: 900 });
  await todayPage.getByRole('button', { name: '查看我的作业' }).click();
  await expect(shell.locator('.pc-platform-admin-content')).toContainText('我的作业');
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
});

test('重点和基础今日任务不等待慢速题目队列，首页不下载诊断试卷', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  await page.evaluate(() => {
    const api = window.APIClient;
    const pendingQueue = new Promise((resolve) => {
      window.__releaseStudentQueue = () => resolve({ items: [], completed_question_ids: [] });
    });
    window.__diagnosticExamLoads = 0;
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_speed', is_primary: true, exam_target: 'JLPT N3', target_date: '2099-12-01', daily_minutes: 20 }] });
    api.listRecentLearning = async () => ({ items: [] });
    api.listMyAssignments = async () => ({ items: [] });
    api.listSrsDue = () => pendingQueue;
    api.sampleWrongQuestions = () => pendingQueue;
    api.getDailyPractice = () => pendingQueue;
    api.getAdaptiveLearningProfile = async () => ({
      exam_target: 'JLPT N3', updated_at: '2026-09-22T10:00:00Z',
      domains: {
        vocabulary: { score: 72, observation_count: 10, correct_count: 7, evidence: 'sufficient', learning_days: 3, material_count: 3 },
        grammar: { score: 68, observation_count: 10, correct_count: 7, evidence: 'sufficient', learning_days: 3, material_count: 3 },
        reading: { score: 51, observation_count: 10, correct_count: 5, evidence: 'sufficient', learning_days: 3, material_count: 3 },
        listening: { score: 64, observation_count: 10, correct_count: 6, evidence: 'sufficient', learning_days: 3, material_count: 3 }
      }
    });
    api.getAnswerAttempts = async () => [{ statistics: { score: 65 }, saved_at: '2026-09-22T10:00:00Z' }];
    api.getExam = async () => { window.__diagnosticExamLoads += 1; return {}; };
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('本阶段重点：阅读', { timeout: 1500 });
  await expect(focus).not.toContainText('正在读取学习记录');
  await expect(shell.getByRole('region', { name: '今日计划' })).not.toContainText('正在生成今日计划');
  expect(await page.evaluate(() => window.__diagnosticExamLoads)).toBe(0);
  await page.evaluate(() => window.__releaseStudentQueue());
});

test('学员子页面顶部统一返回学习首页，首页不显示返回按钮', async ({ page }) => {
  const shell = await openHome(page);
  const back = shell.locator('.pc-topbar-back');
  await expect(back).toHaveCount(0);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-learning-archive'));
    const home = shell.getByRole('button', { name: '返回学习首页', exact: true });
    await expect(home).toBeVisible();
    await home.click();
    await expect(shell.locator('#student-learning-home .pc-workspace-overview-card h1')).toHaveText('学习首页');
    await expect(back).toHaveCount(0);
  }
});

test('待提交与完成分开，真实清单去重并按等级筛选，续学直达试卷', async ({ page }, testInfo) => {
  const shell = await openHome(page);
  const continuation = shell.locator('.pc-learning-continue');
  await expect(continuation).toContainText('本阶段重点：阅读');
  const completedSection = shell.locator('.pc-learning-completed');
  await expect(completedSection).not.toHaveAttribute('open', '');
  await expect(completedSection.locator('.pc-learning-completed-list')).not.toBeVisible();
  await completedSection.locator('summary').click();
  await expect(completedSection.locator('.pc-learning-completed-list')).toBeVisible();
  await expect(completedSection).toContainText('2024年7月');
  await expect(shell.locator('section[aria-label="老师的作业"]')).toHaveCount(0);
  const today = shell.locator('section[aria-label="今日计划"]');
  await expect(today.locator('.pc-daily-plan-row')).toHaveCount(1);
  await expect(today).toContainText('继续 JLPT N2 · 2025年7月真题');
  await expect(today).toContainText('20 分钟');
  const abilities = shell.getByRole('region', { name: '四项能力概况' });
  await expect(abilities.locator('.pc-focus-ability')).toHaveCount(4);
  await expect(abilities).toContainText('68%');
  await abilities.getByRole('button', { name: /词汇/ }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('当前掌握度　68%');
  await expect(shell.locator('#student-learning-detail')).toContainText('10 次有效作答 · 答对 7 次');
  await expect(shell.locator('#student-learning-detail')).not.toContainText('跨日证据');
  await expect(shell.locator('#student-learning-detail')).toHaveClass(/pc-learning-tool-page/);
  await expect(shell.getByRole('button', { name: '打开生词本', exact: true })).toBeVisible();
  await expect(shell.getByRole('button', { name: '返回总览', exact: true })).toBeVisible();
  await shell.getByRole('button', { name: '返回总览', exact: true }).click();
  await shell.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('诊断完成');
  await expect(shell.getByRole('button', { name: '返回总览', exact: true })).toBeVisible();
  await shell.getByRole('button', { name: '返回总览', exact: true }).click();
  await shell.screenshot({ path: testInfo.outputPath('student-home-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell.locator('.pc-learning-home')).toBeVisible();
  expect(await shell.locator('.pc-learning-home').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('student-home-mobile.png') });
  await shell.locator('.pc-learning-completed summary').click();
  await shell.getByRole('button', { name: '查看结果', exact: true }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('80 分');
  await expect(shell.getByRole('button', { name: '返回总览', exact: true })).toBeVisible();
  await shell.getByRole('button', { name: '返回总览', exact: true }).click();
  await page.evaluate(() => {
    window.APIClient.getExam = async (id) => { window.__openedStudentExam = id; return {}; };
    window.examViewer.loadExamData = () => {};
    window.examViewer.jumpToQuestion = (s, q) => { window.__studentPosition = [s, q]; };
  });
  await shell.locator('.pc-daily-plan-row').filter({ hasText: 'JLPT N2 · 2025年7月真题' }).click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => [window.__openedStudentExam, window.__studentPosition])).toEqual(['N2_2025_07', [2, 1]]);
});

test('只有紧急作业置顶，普通作业留在清单下方', async ({ page }) => {
  const shell = await openHome(page, 'assignments');
  await expect(shell.locator('.pc-today-priority')).toContainText('阅读作业');
  await expect(shell.locator('.pc-workbench-stage').nth(1)).toContainText('02重点');
  await expect(shell.locator('.pc-workbench-stage').nth(2)).toContainText('03今日');
  await expect(shell.locator('section[aria-label="老师的作业"]')).toContainText('听力作业');
  await expect(shell.locator('.pc-learning-home')).not.toContainText('已交作业');
  await expect(shell.locator('section[aria-label="今日计划"]')).toContainText('已答 1/2 题');
});

test('新学生没有虚假完成状态，已提交记录不成为续学任务', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  await expect(shell.locator('.pc-learning-continue')).toContainText('尚未形成重点');
  await expect(shell.locator('.pc-learning-continue')).toContainText('JLPT N2 尚未诊断');
  await expect(shell.getByRole('region', { name: '今日计划' })).toContainText('完成入门诊断');
  await expect(shell.locator('.pc-learning-home')).not.toContainText('已完成');
  await page.reload();
  const completedShell = await openHome(page, 'completed');
  await expect(completedShell.locator('.pc-learning-continue')).toContainText('尚未形成重点');
  await expect(completedShell.locator('.pc-learning-completed')).toBeVisible();
});

test('提交完成后首页立即把待提交状态移到最近完成', async ({ page }) => {
  const shell = await openHome(page, 'ready');
  await expect(shell.getByRole('region', { name: '今日计划' })).toContainText('已答完，待提交');
  await page.evaluate(() => {
    window.APIClient.listRecentLearning = async () => ({ items: [
      { exam_id: 'N2_2025_07', status: 'submitted', answered_count: 2, total_questions: 2, updated_at: '2026-09-24T10:00:00Z' }
    ] });
    window.dispatchEvent(new CustomEvent('examAnswersSubmitted', { detail: { userId: 'student_demo', examId: 'N2_2025_07' } }));
  });
  await expect(shell.getByRole('region', { name: '今日计划' })).not.toContainText('待提交');
  await expect(shell.locator('.pc-learning-completed')).toContainText('1 条');
});

test('题组练习的最近完成读取独立练习历史而非同卷草稿', async ({ page }) => {
  const shell = await openHome(page, 'completed');
  await page.evaluate(() => {
    const api = window.APIClient;
    api.listRecentLearning = async () => ({ items: [
      { exam_id: 'N3_2024_12', status: 'draft', answered_count: 5, total_questions: 5 },
      { exam_id: 'N3_2024_12', exam_title: 'JLPT-N3-2024_12 · 词汇 / 语法', source: 'practice_group', status: 'submitted', practice_label: '词汇 / 语法', answered_count: 5, total_questions: 5, correct_count: 4, wrong_count: 1 }
    ] });
    api.getAnswerAttempts = async (_userId, examId) => {
      window.__practiceHistoryExamId = examId;
      return examId.endsWith('__practice') ? [{ saved_at: '2026-10-01T10:00:00Z', answers: { '4:31': 3 }, statistics: {
        practice_label: '词汇 / 语法', section_indexes: [4], practice_total_questions: 5, practice_answered_count: 5,
        correct_count: 4, wrong_count: 1, results: { '4:32': { status: 'wrong', question_id: '2', user_answer: '1', correct_answer: '3' } }
      } }] : [];
    };
    window.__reviewSaveCalls = 0;
    api.savePracticeGroup = async () => { window.__reviewSaveCalls += 1; return {}; };
    window.dispatchEvent(new Event('practiceRecordSaved'));
    window.openPersonalCenter();
  });
  await expect(shell).toBeVisible();
  await expect(shell.locator('.pc-learning-completed')).toContainText('1 条');
  await shell.locator('.pc-learning-completed summary').click();
  await shell.getByRole('button', { name: '查看结果', exact: true }).click();
  const detail = shell.locator('#student-learning-detail');
  await expect(detail.locator('#student-learning-detail-title')).toHaveText('JLPT N3 · 2024年12月真题 · 词汇 / 语法');
  await expect(detail).toContainText('已答 5/5');
  await expect(detail).toContainText('正确 4 · 错误 1');
  await expect(detail).toContainText('题 2');
  await expect(detail).toContainText('选 1 · 正确 3');
  expect(await page.evaluate(() => window.__practiceHistoryExamId)).toBe('N3_2024_12__practice');
  await detail.getByRole('button', { name: '复习原题' }).click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => ({
    mode: window.examViewer.savedPracticeMode,
    submitted: window.examViewer.isSubmitted,
    answer: window.examViewer.userAnswers['4:31'],
    section: window.examViewer.currentSectionIndex
  }))).toEqual({ mode: 'review', submitted: true, answer: 3, section: 4 });
  await expect(page.locator('#current-question-container')).toContainText('31.');
  await expect(page.locator('#saved-practice-notice')).toContainText('不能修改');
  await page.locator('#current-question-container .option').first().click();
  expect(await page.evaluate(() => window.examViewer.userAnswers['4:31'])).toBe(3);
  await page.evaluate(() => window.examViewer.finishPractice());
  expect(await page.evaluate(() => window.__reviewSaveCalls)).toBe(0);
});

test('历史题组再测试从空答案开始并生成新的提交', async ({ page }) => {
  const shell = await openHome(page, 'completed');
  await page.evaluate(() => {
    const api = window.APIClient;
    api.listRecentLearning = async () => ({ items: [{
      exam_id: 'N3_2024_12', source: 'practice_group', status: 'submitted', practice_label: '词汇 / 语法',
      answered_count: 5, total_questions: 5, correct_count: 4, wrong_count: 1
    }] });
    api.getAnswerAttempts = async () => [{ saved_at: '2026-10-01T10:00:00Z', answers: { '4:31': 3 }, statistics: {
      practice_label: '词汇 / 语法', section_indexes: [4], practice_total_questions: 5,
      practice_answered_count: 5, correct_count: 4, wrong_count: 1
    } }];
    window.__newPracticeSubmissions = [];
    window.__retestDraftSaves = 0;
    api.savePracticeGroup = async (payload) => { window.__newPracticeSubmissions.push(payload); return {}; };
    api.saveDraft = async () => { window.__retestDraftSaves += 1; return { revision: 1 }; };
    window.dispatchEvent(new Event('practiceRecordSaved'));
    window.openPersonalCenter();
  });
  await expect(shell).toBeVisible();
  await shell.locator('.pc-learning-completed summary').click();
  await shell.getByRole('button', { name: '查看结果', exact: true }).click();
  await shell.getByRole('button', { name: '再测试' }).click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => ({
    mode: window.examViewer.savedPracticeMode,
    submitted: window.examViewer.isSubmitted,
    answer: window.examViewer.userAnswers['4:31'],
    section: window.examViewer.currentSectionIndex
  }))).toEqual({ mode: 'retest', submitted: false, answer: undefined, section: 4 });
  await page.evaluate(() => {
    window.examViewer.answerManager.setAnswerComposite(4, '31', 2);
    window.examViewer.finishPractice();
  });
  await expect.poll(() => page.evaluate(() => window.__newPracticeSubmissions.length)).toBe(1);
  const submitted = await page.evaluate(() => window.__newPracticeSubmissions[0]);
  expect(submitted.exam_id).toBe('N3_2024_12');
  expect(submitted.section_indexes).toEqual([4]);
  expect(submitted.answers['4:31']).toBe(2);
  expect(submitted.submission_id).toBeTruthy();
  expect(await page.evaluate(() => window.__retestDraftSaves)).toBe(0);
});

test('今日计划完成后提供当前目标的自由学习入口', async ({ page }) => {
  const shell = await openHome(page, 'today_complete');
  const today = shell.getByRole('region', { name: '今日计划' });
  await expect(today.locator('.pc-workbench-stage')).toContainText('20 分钟 · 已完成');
  await expect(today).toContainText('今日学习已完成');
  await expect(today).toContainText('可以继续自由练习');
  await expect(today.getByRole('button', { name: '专项练习', exact: true })).toBeVisible();
  await expect(today.getByRole('button', { name: '完整试卷', exact: true })).toBeVisible();
  await expect(today.locator('.pc-free-study-domain')).toHaveCount(4);
  await expect(today.locator('.pc-free-study-domain.is-focus')).toContainText('阅读');
  await expect(today.getByRole('button', { name: '开始学习', exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [
      { id: 'read-long', family: 'jlpt', level: 'N2', section_type: 'reading', skill_key: 'reading.long', question_count: 8 },
      { id: 'grammar-form', family: 'jlpt', level: 'N2', section_type: 'grammar', skill_key: 'grammar.form', question_count: 8 }
    ] });
  });
  await today.locator('.pc-free-study-domain').filter({ hasText: '阅读' }).click();
  const modal = page.locator('#chapter-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#cp-title')).toHaveText('阅读专项练习');
  await expect(modal.locator('#cp-note')).toContainText('仅显示 JLPT N2 · 阅读');
  await expect(modal.locator('#cp-filters')).toBeHidden();
  await expect(modal.locator('#cp-body')).toContainText('长篇阅读');
  await expect(modal.locator('#cp-body')).not.toContainText('语法形式');
  await shell.getByRole('button', { name: '返回总览', exact: true }).click();

  await shell.getByRole('region', { name: '今日计划' }).getByRole('button', { name: '完整试卷', exact: true }).click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#exam-family-select')).toHaveValue('jlpt');
  await expect(page.locator('#exam-level-select')).toHaveValue('N2');
});

test('单个清单接口断开时仍保留今日计划并可以重试', async ({ page }) => {
  const shell = await openHome(page, 'error');
  const today = shell.getByRole('region', { name: '今日计划' });
	await expect(today).toContainText('暂时无法连接服务，请确认后端已启动。');
  await expect(today).not.toContainText('NetworkError');
  await expect(today.locator('.pc-daily-plan-row')).toHaveCount(1);
  await page.evaluate(() => { window.APIClient.getDailyPractice = async () => ({ items: [] }); });
  await shell.getByRole('button', { name: '重试', exact: true }).click();
  await expect(shell.locator('section[aria-label="今日计划"]')).toContainText('20 分钟');
  await expect(today).not.toContainText('部分学习数据暂未加载');
});

test('少量诊断证据只形成初步画像，不直接判定最大短板', async ({ page }) => {
  const shell = await openHome(page, 'diagnostic');
  const primaryAction = shell.locator('.pc-learning-continue');
  await expect(primaryAction).toContainText('诊断进行中');
  await expect(primaryAction).toContainText('已完成 8/40 题');
  await expect(primaryAction).not.toContainText('本阶段重点：阅读');
  const abilities = shell.getByRole('region', { name: '四项能力概况' });
  await expect(abilities).toContainText('50%');
  await expect(abilities).toContainText('100%');
  await expect(shell.getByRole('region', { name: '学习概况', exact: true })).toHaveCount(0);
  const today = shell.getByRole('region', { name: '今日计划' });
  await expect(today).toContainText('继续完成入门诊断');
  await expect(today.locator('.pc-workbench-stage')).toContainText('20 分钟');
  await expect(today.locator('.pc-daily-plan-row > b')).toHaveCount(0);
});

test('初步诊断完成后在合并的学习重点中继续安排学习', async ({ page }) => {
  const shell = await openHome(page, 'observing');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('初步重点：阅读');
	await expect(focus).toContainText('诊断结果中，这项相对较弱。');
  await expect(focus).not.toContainText('继续校准');
  await expect(focus.getByRole('region', { name: '四项能力概况' })).toContainText('阅读52%');
  await expect(focus.getByRole('button', { name: '开始练习', exact: true })).toHaveCount(0);
  await expect(shell.getByRole('region', { name: '今日计划' }).getByRole('button', { name: '开始学习', exact: true })).toBeVisible();
  await expect(focus).not.toContainText('继续观察中');
  await expect(focus).not.toContainText('继续诊断');
});

test('充分证据选出阶段重点，并按目标时间生成不重复的今日计划', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('本阶段重点：阅读');
  await expect(focus).toContainText('阅读 10 次作答 · 当前表现 52%');
  await expect(focus.locator('.pc-focus-ability.is-focus')).toContainText('阅读52%');
  const today = shell.getByRole('region', { name: '今日计划' });
  await expect(today.locator('.pc-daily-plan-row').first()).toContainText('阅读');
  await expect(today.locator('.pc-workbench-stage')).toContainText('20 分钟');
  await expect(today.locator('.pc-daily-plan-row > b')).toHaveCount(0);
  const focusTask = today.locator('.pc-daily-plan-row').filter({ hasText: '长句阅读训练' });
  await expect(focusTask).toContainText('1 题');
  await page.evaluate(() => {
    window.APIClient.getExam = async (id) => {
      window.__openedStudentExam = id;
      return { exam_info: { sections: [{ questions: [{ id: '3' }] }] } };
    };
    window.examViewer.loadExamData = () => {};
    window.examViewer.jumpToQuestion = (section, question) => { window.__studentPosition = [section, question]; };
  });
  await focusTask.click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => [window.__openedStudentExam, window.__studentPosition])).toEqual(['N2_2025_07', [0, 0]]);
});

test('到期复习达到阈值时调整今日计划，但不抢走阶段重点', async ({ page }) => {
  const shell = await openHome(page, 'debt');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('本阶段重点：阅读');
  await expect(focus).not.toContainText('到期复习');
  const today = shell.getByRole('region', { name: '今日计划' });
  await expect(today.locator('.pc-daily-plan-row')).toHaveCount(2);
  await expect(today.locator('.pc-daily-plan-index')).toHaveCount(0);
  await expect(today.locator('.pc-daily-plan-row').first()).toContainText('到期复习');
  await expect(today).toContainText('10 道题');
  await expect(today).not.toContainText('阅读练习');
  await expect(today.locator('.pc-workbench-stage')).toContainText('20 分钟');
  await expect(today.locator('.pc-daily-plan-row > b')).toHaveCount(0);
});

test('错题订正按单题提交，答对后完成今日任务并保留后续掌握判定', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  await page.evaluate(() => {
    window.APIClient.getAnswerAttempts = async () => [{ statistics: { diagnostic_answered_count: 40, correct_count: 40, wrong_count: 0 }, saved_at: new Date().toISOString() }];
    window.__wrongCorrectionCompleted = false;
    window.APIClient.getDailyPractice = async () => ({
      items: window.__wrongCorrectionCompleted ? [] : [{
        exam_id: 'N2_2025_07', question_id: '2', source: 'wrong_question', wrong_count: 2,
        question_snapshot: { id: 2, question: '訂正する問題', options: ['正解', '不正解'], correct_answer: 1 }
      }],
      completed_question_ids: window.__wrongCorrectionCompleted ? ['N2_2025_07\u001f2'] : []
    });
    window.APIClient.getExam = async () => ({ exam_info: { sections: [{
      section_title: '問題1　正しいものを選びなさい。',
      questions: [{
        id: 2, question: '訂正する問題', options: ['正解', '不正解'], correct_answer: 1,
        explanation: '【题目解析】\n这是订正后的完整解析。',
        explanation_expand: '【补充解析】\n这是延伸学习内容。'
      }]
    }] } });
    window.APIClient.submitWrongQuestionCorrection = async (userId, questionId, payload) => {
      window.__wrongCorrectionRequest = { userId, questionId, payload };
      window.__wrongCorrectionCompleted = true;
      return { correct: true, correct_answer: '1', correct_streak: 1, mastered: false, completed_today: true };
    };
    window.dispatchEvent(new Event('examAnswersSubmitted'));
  });
  const today = shell.locator('.pc-selfstudy-steps');
  await expect(today).toContainText('错题订正');
  await today.locator('[data-role-admin-intent="openStudentQueue:wrong"]').click();
  await shell.locator('#student-learning-detail').getByRole('button', { name: '去订正' }).click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#wrong-correction-bar')).toContainText('重新独立作答');
  await page.locator('[data-question-id="2"][data-option-index="1"]').click();
  await page.getByRole('button', { name: '提交订正', exact: true }).click();
  await expect(page.locator('#wrong-correction-bar')).toContainText('订正正确');
  await expect(page.locator('#wrong-correction-bar')).toContainText('之后会再安排复习');
  await expect(page.locator('#current-question-container')).toContainText('这是订正后的完整解析。');
  await expect(page.locator('#current-question-container .explanation')).toHaveCount(2);
  await expect(page.locator('#current-question-container .explanation').nth(0)).not.toContainText('补充解析');
  await expect(page.locator('#current-question-container .explanation.answer-extras')).toContainText('这是延伸学习内容。');
  expect(await page.evaluate(() => window.__wrongCorrectionRequest)).toEqual({
    userId: 'usr_019ee051-2faa-7c21-b088-5916feb77974', questionId: '2',
    payload: { exam_id: 'N2_2025_07', actual_question_id: '2', section_index: 0, answer: 1, exam_target: 'JLPT N2', submission_id: expect.any(String) }
  });
  await page.getByRole('button', { name: '返回今日', exact: true }).click();
  await expect(shell).toBeVisible();
  await expect(shell.locator('.pc-selfstudy-steps')).not.toContainText('错题订正');
});

test('到期复习只读取当前目标，并展示正式题目样式和完整解析', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  await page.evaluate(() => {
    window.APIClient.getAnswerAttempts = async () => [{ statistics: { diagnostic_answered_count: 40, correct_count: 40, wrong_count: 0 }, saved_at: new Date().toISOString() }];
    window.__srsDailyCompleted = false;
    window.__srsGrades = [];
    window.APIClient.getDailyPractice = async () => ({ items: [
      { card_id: 'N2_2016_07:1', exam_id: 'N2_2016_07', question_id: '1', source: 'srs_due' }
    ], completed_question_ids: window.__srsDailyCompleted ? ['N2_2016_07\u001f1'] : [] });
    window.APIClient.reviewSrsCard = async (_userId, _cardId, grade) => { window.__srsGrades.push(grade); };
    window.APIClient.completeDailyPracticeItem = async (questionId, examId) => {
      window.__srsDailyCompleted = true;
      window.__srsCompletedItem = { questionId, examId };
    };
    window.APIClient.listSrsDue = async () => ({ items: [
      { card_id: 'N1_2020_07:1', exam_id: 'N1_2020_07', question_id: '1', due_at: '2026-01-01T00:00:00Z', snapshot: { question: '不应出现的N1题目' } },
      { card_id: 'N2_2016_07:1', exam_id: 'N2_2016_07', question_id: '1', due_at: '2026-01-02T00:00:00Z', snapshot: { question: '旧快照' } }
    ] });
    window.APIClient.getExam = async (examId) => {
      window.__srsExamId = examId;
      return { exam_info: { sections: [{
        section_title: '問題1　＿＿の言葉の読み方として最もよいものを選びなさい。',
        passages: [{ questions: [{
          id: 1,
          question: '歯医者に行って虫歯の治療を受けた。',
          options: ['1.じりょ', '2.ちりょ', '3.じりょう', '4.ちりょう'],
          correct_answer: 4,
          target_words: ['治療'],
          explanation: '【题目解析】\n这是完整题目解析。',
          explanation_expand: '【补充解析】\n这是补充解析。'
        }] }]
      }] } };
    };
    window.dispatchEvent(new Event('examAnswersSubmitted'));
  });
  await shell.locator('.pc-selfstudy-steps [data-role-admin-intent="openSrsReview"]').first().click();
  const review = shell.locator('#srs-modal');
  await expect(review).toContainText('歯医者に行って虫歯の治療を受けた。');
  await expect(review).not.toContainText('不应出现的N1题目');
  expect(await page.evaluate(() => window.__srsExamId)).toBe('N2_2016_07');
  await expect(review.locator('.pc-srs-option')).toHaveCount(4);
  await expect(review.locator('.pc-srs-answer-body')).not.toBeVisible();
  await expect(review.locator('#srs-footer')).not.toBeVisible();
  await review.getByText('查看答案与解析', { exact: true }).click();
  await expect(review.locator('.pc-srs-answer-body')).toBeVisible();
  await expect(review.locator('#srs-footer')).toBeVisible();
  await expect(review).toContainText('这是完整题目解析。');
  await expect(review).toContainText('这是补充解析。');
  await expect(review.locator('.pc-srs-explanation')).toHaveCount(2);
  await expect(review.locator('.pc-srs-explanation').nth(0)).not.toContainText('补充解析');
  await expect(review.locator('.pc-srs-explanation-expand')).toContainText('这是补充解析。');
  await expect(review.locator('.pc-srs-option.is-correct')).toContainText('4.ちりょう');
  await review.getByRole('button', { name: '再来', exact: true }).click();
  await expect(review).toContainText('歯医者に行って虫歯の治療を受けた。');
  await review.getByText('查看答案与解析', { exact: true }).click();
  await review.getByRole('button', { name: '再来', exact: true }).click();
  await expect(review).toContainText('本次计划复习已完成');
  expect(await page.evaluate(() => ({ grades: window.__srsGrades, completed: window.__srsCompletedItem }))).toEqual({
    grades: [0, 0], completed: { questionId: '1', examId: 'N2_2016_07' }
  });
});

test('旧诊断复习卡可从复合题号恢复真实题面', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  await page.evaluate(() => {
    window.APIClient.getDailyPractice = async () => ({ items: [
      { card_id: 'N2_DIAGNOSTIC_V1:0:1', exam_id: 'N2_DIAGNOSTIC_V1', question_id: '1', source: 'srs_due' }
    ], completed_question_ids: [] });
    window.APIClient.listSrsDue = async () => ({ items: [{
      card_id: 'N2_DIAGNOSTIC_V1:0:1', exam_id: 'N2_DIAGNOSTIC_V1', question_id: '0:1',
      due_at: '2026-01-01T00:00:00Z', snapshot: {}
    }] });
    window.APIClient.getExam = async () => ({ exam_info: { sections: [{
      section_title: '問題1　言葉の読み方として最もよいものを選びなさい。',
      passages: [{ questions: [{
        id: 1, question: '素晴らしい才能を発揮した。', options: ['1.ぜいのう', '2.ざいのう', '3.せいのう', '4.さいのう'],
        correct_answer: 4, explanation: '【题目解析】\n才能的读音是さいのう。'
      }] }]
    }] } });
  });
  await shell.getByRole('region', { name: '今日计划' }).locator('.pc-daily-plan-row').filter({ hasText: '到期复习' }).click();
  const review = shell.locator('#srs-modal');
  await expect(review).toContainText('素晴らしい才能を発揮した。');
  await expect(review.locator('.pc-srs-card-meta')).toContainText('问题 1');
  await expect(review).not.toContainText('0:1');
  await expect(review).not.toContainText('无题面快照');
});

test('阶段重点在完成五组前保持稳定，不因下一次最低分变化而跳动', async ({ page }) => {
  let shell = await openHome(page, 'weak');
  await expect(shell.getByRole('region', { name: '学习重点' })).toContainText('本阶段重点：阅读');
  await page.reload();
  shell = await openHome(page, 'phase_shift');
  await expect(shell.getByRole('region', { name: '学习重点' })).toContainText('本阶段重点：阅读');
  await expect(shell.getByRole('region', { name: '学习重点' })).not.toContainText('本阶段重点：听力');
});

test('超过90天的能力画像提示更新并在详情说明原因', async ({ page }) => {
  const shell = await openHome(page, 'stale');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('建议更新能力画像');
  await expect(focus).toContainText('超过 90 天没有新的作答');
  await focus.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('建议更新能力画像');
  await expect(shell.locator('#student-learning-detail')).toContainText('超过 90 天没有新的作答，请更新诊断');
});

test('EJU目标使用记述读解听读解听解四域并生成对应能力画像', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  await page.evaluate(() => {
    const api = window.APIClient;
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_eju', is_primary: true, exam_target: 'EJU 日本語', title: 'EJU 日本語备考', target_date: '2099-11-01', daily_minutes: 30 }] });
    api.listRecentLearning = async () => ({ items: [] });
    api.listMyAssignments = async () => ({ items: [] });
    api.listSrsDue = async () => ({ items: [] });
    api.sampleWrongQuestions = async () => ({ items: [] });
    api.getDailyPractice = async () => ({ items: [{ exam_id: '2024_01', question_id: '1', section_type: 'reading', source: 'recommended' }], completed_question_ids: [] });
    api.getAdaptiveLearningProfile = async (target) => {
      window.__adaptiveTarget = target;
      return {
        exam_target: 'EJU 日本語', available_targets: ['EJU 日本語'], updated_at: '2026-09-21T10:00:00Z', model_version: 'mastery-v0.2',
        domains: {
          writing: { score: 58, observation_count: 8, correct_count: 5, evidence: 'insufficient', learning_days: 1, material_count: 1 },
          reading: { score: 66, observation_count: 8, correct_count: 6, evidence: 'insufficient', learning_days: 1, material_count: 1 },
          listening_reading: { score: 48, observation_count: 8, correct_count: 4, evidence: 'insufficient', learning_days: 1, material_count: 1 },
          listening: { score: 62, observation_count: 8, correct_count: 5, evidence: 'insufficient', learning_days: 1, material_count: 1 }
        }
      };
    };
    api.getAnswerAttempts = async () => [{ statistics: { score: 60 }, saved_at: '2026-09-21T10:00:00Z' }];
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  await expect(shell.locator('.pc-goal-summary')).toContainText('EJU 日本語');
  const abilities = shell.getByRole('region', { name: '四项能力概况' });
  await expect(abilities.locator('.pc-focus-ability')).toHaveCount(4);
  await expect(abilities).toContainText('记述58%');
  await expect(abilities).toContainText('读解66%');
  await expect(abilities).toContainText('听读解48%');
  await expect(abilities).toContainText('听解62%');
  await expect(shell.getByRole('region', { name: '学习重点' })).toContainText('初步重点：听读解');
  await expect.poll(() => page.evaluate(() => window.__adaptiveTarget)).toBe('EJU 日本語');
  await shell.getByRole('button', { name: '查看详情', exact: true }).click();
  const detail = shell.locator('#student-learning-detail');
  await expect(detail).toContainText('EJU 日本語 · 40题入门诊断');
  await expect(detail).toContainText('已形成初步重点');
  await expect(detail).not.toContainText('JLPT N2');
});

test('没有完成EJU测评时不采用JLPT同名领域数据', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  await page.evaluate(() => {
    const api = window.APIClient;
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_eju', is_primary: true, exam_target: 'EJU 日本語', target_date: '2099-11-01', daily_minutes: 30 }] });
    api.listRecentLearning = async () => ({ items: [] });
    api.listMyAssignments = async () => ({ items: [] });
    api.listSrsDue = async () => ({ items: [] });
    api.sampleWrongQuestions = async () => ({ items: [] });
    api.getDailyPractice = async () => ({ items: [], completed_question_ids: [] });
    api.getAdaptiveLearningProfile = async () => ({
      exam_target: 'JLPT N2', available_targets: ['JLPT N2'],
      domains: {
        reading: { score: 6, observation_count: 10, correct_count: 1 },
        listening: { score: 13, observation_count: 10, correct_count: 2 }
      }
    });
    api.getAnswerAttempts = async () => [];
    api.getExam = async (examId) => { window.__openedDiagnosticExam = examId; return {}; };
    window.examViewer.loadExamData = () => {};
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  const abilities = shell.getByRole('region', { name: '四项能力概况' });
  await expect(abilities).toContainText('记述未评估');
  await expect(abilities).toContainText('读解未评估');
  await expect(abilities).toContainText('听读解未评估');
  await expect(abilities).toContainText('听解未评估');
  await expect(abilities).not.toContainText('6%');
  await expect(abilities).not.toContainText('13%');
	await expect(shell.getByRole('region', { name: '学习重点' })).toContainText('尚未形成重点');
  await shell.getByRole('button', { name: '查看详情', exact: true }).click();
	await shell.getByRole('button', { name: '开始40题诊断', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__openedDiagnosticExam)).toBe('EJU_JAPANESE_DIAGNOSTIC_V1');
});

test('切换已保存目标时加载各自画像且不误报目标变更', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  await page.evaluate(() => {
    const api = window.APIClient;
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_eju', is_primary: true, exam_target: 'EJU 日本語', target_date: '2099-11-01', daily_minutes: 30 }] });
    api.listRecentLearning = async () => ({ items: [] });
    api.listMyAssignments = async () => ({ items: [] });
    api.listSrsDue = async () => ({ items: [] });
    api.sampleWrongQuestions = async () => ({ items: [] });
    api.getDailyPractice = async () => ({ items: [], completed_question_ids: [] });
    api.getAdaptiveLearningProfile = async () => ({ exam_target: 'EJU 日本語', available_targets: ['JLPT N2'], updated_at: '', domains: {} });
    api.getAnswerAttempts = async () => [];
    window.openPersonalCenter();
  });
  const shell = page.locator('#platform-admin-shell');
  const focus = shell.getByRole('region', { name: '学习重点' });
  await expect(focus).toContainText('尚未形成重点');
  await expect(focus).toContainText('EJU 日本語 尚未诊断');
  await expect(focus).not.toContainText('已切换');
  await expect(focus).not.toContainText('词汇');
  await focus.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('尚未开始入门诊断');
});

test('目标设置可选择 JLPT N1 N2 N3 并保存日期与每日时间', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  await page.evaluate(() => {
    window.__savedStudyGoal = null;
    window.APIClient.updateStudyGoal = async (goalId, payload) => {
      window.__savedStudyGoal = { goalId, payload };
      window.APIClient.listStudyGoals = async () => ({ items: [
        { goal_id: 'goal_legacy_eju', title: '旧目标', exam_target: 'EJU', target_date: '2099-01-01' },
        { goal_id: goalId, is_primary: true, ...payload }
      ] });
      return { goal_id: goalId, ...payload };
    };
  });
  await shell.getByRole('button', { name: '调整目标', exact: true }).click();
  const goalPage = page.locator('#study-goal-modal');
  await expect(goalPage).toBeVisible();
  await expect(goalPage.locator('#sg-title')).toHaveCount(0);
  await expect(goalPage.locator('#sg-exam-target option')).toHaveText(['JLPT N1', 'JLPT N2', 'JLPT N3', 'EJU 日本語']);
  await expect(goalPage.locator('#sg-exam-target')).toHaveValue('JLPT N2');
  await expect(goalPage.locator('#sg-minutes option')).toHaveText(['10 分钟', '15 分钟', '20 分钟', '30 分钟', '45 分钟', '60 分钟', '2 小时', '3 小时']);
  await expect(goalPage.locator('#sg-form .pc-org-form-actions button')).toHaveText(['返回', '保存修改']);
  await goalPage.getByRole('button', { name: '返回', exact: true }).click();
  await expect(goalPage).toBeHidden();
  expect(await page.evaluate(() => window.__savedStudyGoal)).toBeNull();
  await shell.getByRole('button', { name: '调整目标', exact: true }).click();
  await expect(goalPage).toBeVisible();
  for (const level of ['JLPT N2', 'JLPT N3', 'JLPT N1']) {
    await goalPage.locator('#sg-exam-target-trigger').click();
    await goalPage.locator(`[data-goal-value="${level}"]`).click();
    await expect(goalPage.locator('#sg-date')).toHaveValue('2026-12-06');
  }
  await setGoalDate(page, '2099-12-06');
  await goalPage.locator('#sg-minutes').selectOption('30');
  await goalPage.locator('#sg-form button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__savedStudyGoal)).toEqual({
    goalId: 'goal_test_n2',
    payload: { title: 'JLPT N1 备考计划', exam_target: 'JLPT N1', target_date: '2099-12-06', daily_minutes: 30 }
  });
  await expect(goalPage).toBeHidden();
  await expect(shell.locator('.pc-learning-home')).toBeVisible();
  await expect(shell.locator('.pc-goal-summary')).toContainText('JLPT N1 · 剩余');
  await expect(shell.locator('.pc-goal-summary')).toContainText('每天 30 分钟');
  await expect(shell.locator('.pc-goal-summary')).not.toContainText('暂按系统建议');
  await expect(shell.getByRole('region', { name: '学习重点' })).toContainText('目标已改为 JLPT N1，请完成对应诊断');
});

test('新建目标默认 JLPT N1 并可选择 EJU 日本語', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  await page.evaluate(() => {
    window.__savedStudyGoal = null;
    window.APIClient.listStudyGoals = async () => ({ items: [] });
    window.APIClient.createStudyGoal = async (payload) => {
      window.__savedStudyGoal = payload;
      return { goal_id: 'goal_test_eju', ...payload };
    };
  });
  await shell.getByRole('button', { name: '调整目标', exact: true }).click();
  const goalPage = page.locator('#study-goal-modal');
  await expect(goalPage.locator('#sg-exam-target')).toHaveValue('JLPT N1');
  await expect(goalPage.locator('#sg-date')).toHaveValue('2026-12-06');
  await expect(goalPage.locator('#sg-date-trigger')).toContainText('2026 年 12 月 6 日');
  await expect(goalPage.locator('#sg-date-label')).toHaveText('考试日期 （自动填入；可手选）');
  const targetTrigger = goalPage.locator('#sg-exam-target-trigger');
  await targetTrigger.click();
  await expect(goalPage.locator('#sg-exam-target-menu')).toBeVisible();
  await goalPage.getByRole('option', { name: 'EJU 日本語', exact: true }).click();
  await expect(targetTrigger).toContainText('EJU 日本語');
  await expect(goalPage.locator('#sg-date')).toHaveValue('2026-11-08');
  await expect(goalPage.locator('#sg-date-trigger')).toContainText('2026 年 11 月 8 日');
  await goalPage.locator('#sg-date-trigger').click();
  const calendar = goalPage.locator('#sg-date-popover');
  await expect(calendar).toBeVisible();
  const presets = calendar.locator('[data-calendar-preset]');
  await expect(presets).toHaveCount(2);
  await expect(presets.nth(0)).toContainText('下一场');
  await expect(presets.nth(0)).toContainText('2026 年 11 月 8 日');
  await expect(presets.nth(0)).toContainText('官方');
  await expect(presets.nth(1)).toContainText('下下场');
  await expect(presets.nth(1)).toContainText('2027 年 6 月 20 日');
  await expect(presets.nth(1)).toContainText('预计');
  await presets.nth(1).click();
  await expect(calendar).toBeHidden();
  await expect(goalPage.locator('#sg-date')).toHaveValue('2027-06-20');
  await expect(goalPage.locator('#sg-date-trigger')).toContainText('预计 · 2027 年 6 月 20 日');
  await setGoalDate(page, '2099-11-01');
  await goalPage.locator('#sg-minutes').selectOption('180');
  await goalPage.locator('#sg-form button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__savedStudyGoal)).toEqual({
    title: 'EJU 日本語 备考计划', exam_target: 'EJU 日本語', target_date: '2099-11-01', daily_minutes: 180
  });
  await expect(goalPage).toBeHidden();
  await expect(shell.locator('.pc-learning-home')).toBeVisible();
});

test('普通套餐最多设置两个目标并可在目标间切换编辑', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  await page.evaluate(() => {
    window.APIClient.listStudyGoals = async () => ({ items: [
      { goal_id: 'goal_n2', exam_target: 'JLPT N2', title: 'JLPT N2 备考计划', target_date: '2099-07-01', daily_minutes: 20 },
      { goal_id: 'goal_eju', exam_target: 'EJU 日本語', title: 'EJU 日本語 备考计划', target_date: '2099-11-01', daily_minutes: 30 }
    ] });
  });
  await shell.getByRole('button', { name: '调整目标', exact: true }).click();
  const goalPage = page.locator('#study-goal-modal');
  await expect(goalPage.locator('.pc-goal-list-head')).toContainText('已设置 2/2 个目标');
  await expect(goalPage.locator('[data-sg-new]')).toBeDisabled();
  await goalPage.locator('[data-sg-edit="goal_eju"]').click();
  await expect(goalPage.locator('#sg-exam-target')).toHaveValue('EJU 日本語');
  await expect(goalPage.locator('#sg-date')).toHaveValue('2099-11-01');
  await expect(goalPage.locator('#sg-minutes')).toHaveValue('30');
});

test('提交40题诊断后持久化四域掌握证据且同日分数封顶', async ({ page }) => {
  await loginWithPassword(page, 'student_demo');
  const profile = await page.evaluate(async () => {
    const api = window.APIClient;
    const user = JSON.parse(localStorage.getItem('exam_v2_user') || '{}');
    const exam = await api.getExam('N2_DIAGNOSTIC_V1', user.id || user.user_id);
    const answers = {};
    for (const [sectionIndex, section] of (exam.exam_info.sections || []).entries()) {
      const questions = [...(section.questions || []), ...(section.passages || []).flatMap((passage) => passage.questions || [])];
      for (const question of questions) answers[`${sectionIndex}:${String(question.id)}`] = question.correct_answer ?? question.answer;
    }
    const nonce = `${Date.now()}-${Math.random()}`;
    await api.submitAnswers(user.id || user.user_id, 'N2_DIAGNOSTIC_V1', answers, `diagnostic-${nonce}`, `attempt-${nonce}`, 'mock');
    return api.getAdaptiveLearningProfile();
  });
  for (const domain of ['vocabulary', 'grammar', 'reading', 'listening']) {
    expect(profile.domains[domain].observation_count).toBe(10);
    expect(profile.domains[domain].score).toBe(60);
    expect(profile.domains[domain].retention_score).toBeNull();
  }
  expect(profile.weak_knowledge).toHaveLength(5);
  expect(profile.daily_minutes).toBe(20);
  expect(profile.knowledge_target).toBe(5);
  expect(profile.practice_target).toBe(10);
});


test('首页目标原地展开编辑，取消保存及切换后收起', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const shell = await openHome(page);
  await page.evaluate(() => {
    window.__goalItems = [
      { goal_id: 'current_n2', exam_target: 'JLPT N2', target_date: '2099-12-06', daily_minutes: 20, is_primary: true },
      { goal_id: 'other_n3', exam_target: 'JLPT N3', target_date: '2099-12-06', daily_minutes: 30, is_primary: false }
    ];
    window.__goalUpdates = [];
    window.APIClient.listStudyGoals = async () => ({ items: window.__goalItems });
    window.APIClient.updateStudyGoal = async (id, payload) => {
      window.__goalUpdates.push({ id, payload });
      window.__goalItems = window.__goalItems.map(g => ({ ...g, ...(g.goal_id === id ? payload : {}), is_primary: g.goal_id === id }));
      return window.__goalItems.find(g => g.goal_id === id);
    };
    window.navigateLearningWorkspace('openStudyGoal');
  });
  const goalPage = page.locator('#study-goal-modal');
  const home = shell.locator('#student-learning-home');
  const toggle = home.locator('.pc-selfstudy-goal > button');
  await expect(home.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  await expect(home.locator('#sg-inline-host #study-goal-modal')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(goalPage.locator('#sg-form')).toBeVisible();
  await expect(goalPage.locator('#sg-editor-title')).toHaveText('修改 JLPT N2 目标');
  await expect(goalPage.locator('#sg-editor-title')).toBeVisible();
  await expect(goalPage.locator('.pc-goal-current')).toBeHidden();
  await expect(goalPage.locator('[data-sg-new]')).toBeHidden();
  await expect(goalPage.locator('#sg-editor-note')).toContainText('不叠加其他目标的时间');
  const summaryBounds = await toggle.boundingBox();
  const editorBounds = await goalPage.locator('#sg-form').boundingBox();
  expect(editorBounds.y).toBeGreaterThan(summaryBounds.y + summaryBounds.height);
  await page.screenshot({ path: testInfo.outputPath('goals-inline-desktop.png') });
  await goalPage.locator('#sg-minutes').selectOption('45');
  await goalPage.getByRole('button', { name: '取消', exact: true }).click();
  await expect(home.locator('#sg-inline-host')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.__goalUpdates)).toEqual([]);
  await toggle.click();
  await expect(goalPage.locator('#sg-minutes')).toHaveValue('20');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await home.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('goals-inline-mobile.png') });
  await goalPage.locator('#sg-minutes').selectOption('45');
  await goalPage.getByRole('button', { name: '保存目标', exact: true }).click();
  await expect(home.locator('#sg-inline-host')).toBeHidden();
  await expect(home.locator('.pc-selfstudy-goal')).toContainText('每天 45 分钟');
  await toggle.click();
  await goalPage.locator('.pc-goal-others > summary').click();
  await goalPage.locator('[data-sg-primary="other_n3"]').click();
  await expect(home.locator('#sg-inline-host')).toBeHidden();
  await expect(home.locator('.pc-selfstudy-goal')).toContainText('JLPT N3');
  expect(await page.evaluate(() => window.__goalUpdates.at(-1))).toEqual({ id: 'other_n3', payload: { is_primary: true } });
});

test('空目标页显示设置表单并可保存首个目标', async ({ page }) => {
  const shell = await openHome(page);
  await page.evaluate(() => {
    window.__goalItems = [];
    window.APIClient.listStudyGoals = async () => ({ items: window.__goalItems });
    window.APIClient.createStudyGoal = async payload => {
      const goal = { goal_id: 'new_n3', ...payload, is_primary: true };
      window.__goalItems.push(goal);
      return goal;
    };
    window.navigateLearningWorkspace('openStudyGoal');
  });
  const goalPage = page.locator('#study-goal-modal');
  await expect(goalPage.locator('#sg-form')).toBeVisible();
  await expect(goalPage.locator('#sg-editor-title')).toHaveText('设置学习目标');
  await goalPage.locator('#sg-exam-target-trigger').click();
  await goalPage.getByRole('option', { name: 'JLPT N3', exact: true }).click();
  await setGoalDate(page, '2099-12-06');
  await goalPage.getByRole('button', { name: '保存目标', exact: true }).click();
  await expect(goalPage).toBeHidden();
  await expect(shell.locator('.pc-selfstudy-goal')).toContainText('JLPT N3');
});


test('学习档案原地切换摘要，按需加载并支持失败重试', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  await page.evaluate(() => {
    window.__archiveReportCalls = 0;
    window.APIClient.getLearningReport = async () => {
      window.__archiveReportCalls++;
      if (window.__archiveReportCalls === 1) throw new Error('报告暂不可用');
      return { period: 'week', answers: { questions: 12, accuracy: 75 } };
    };
    window.APIClient.getBookmarks = async () => ({ questions: [{ exam_id: 'N2_2025_07', question_no: '7', question_id: '7', reason: '长句理解', question_snapshot: { question: '收藏内容' } }] });
  });
  const archive = shell.getByRole('region', { name: '学习档案', exact: true });
  const summary = archive.getByRole('region', { name: '档案摘要' });
  await expect(summary).toBeHidden();
  expect(await page.evaluate(() => window.__archiveReportCalls)).toBe(0);
  await archive.getByRole('button', { name: '学习记录', exact: true }).click();
  await expect(summary).toContainText('最近学习');
  await expect(summary.locator('li')).toHaveCount(2);
  await expect(summary).toContainText('已提交');
  await expect(summary).toContainText('未完成');
  await archive.getByRole('button', { name: '错题与收藏', exact: true }).click();
  await expect(summary).toContainText('到期复习题');
  await expect(archive.getByRole('button', { name: '学习记录', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await summary.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(summary).toContainText('已收藏1道题');
  await expect(summary).toContainText('长句理解');
  await archive.getByRole('button', { name: '学习报告', exact: true }).click();
  await expect(summary.getByRole('alert')).toContainText('报告暂不可用');
  await summary.getByRole('button', { name: '重试', exact: true }).click();
  await expect(summary).toContainText('已作答12题');
  await expect(summary).toContainText('正确率75.0%');
  await expect(summary).toContainText('多次测评');
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__archiveReportCalls)).toBe(2);
  await archive.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('archive-summary-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await archive.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await archive.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('archive-summary-mobile.png') });
  await archive.getByRole('button', { name: '学习报告', exact: true }).click();
  await expect(summary).toBeHidden();
  await archive.getByRole('button', { name: '学习记录', exact: true }).click();
  await summary.getByRole('button', { name: '查看全部学习记录' }).click();
  await expect(shell.locator('.pc-platform-admin-content')).toContainText('学习记录');
  await expect(shell.locator('.pc-selfstudy-archive')).toHaveCount(0);
});

test('最近学习按状态提供继续练习和查看结果入口', async ({ page }, testInfo) => {
  const shell = await openHome(page);
  const recordsTab = shell.locator('[data-archive-section="records"]');
  const summary = shell.locator('#student-archive-summary');
  await recordsTab.click();
  const draft = summary.locator('li').filter({ hasText: '2025年7月真题' });
  const submitted = summary.locator('li').filter({ hasText: '2024年7月真题' });
  const specialty = summary.locator('li').filter({ hasText: '专项练习' });
  await expect(draft.getByRole('button', { name: '继续练习' })).toBeVisible();
  await expect(submitted.getByRole('button', { name: '查看结果' })).toBeVisible();
  await expect(specialty.getByRole('button', { name: '查看结果' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('archive-record-actions-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: testInfo.outputPath('archive-record-actions-desktop.png') });
  await submitted.getByRole('button', { name: '查看结果' }).click();
  await expect(shell.locator('#student-learning-detail')).toContainText('80 分');
  await expect(shell.locator('#student-learning-detail-title')).toContainText('2024年7月真题');
  await page.evaluate(() => window.navigateLearningWorkspace('__overview__'));
  if (await recordsTab.getAttribute('aria-expanded') !== 'true') await recordsTab.click();
  await specialty.getByRole('button', { name: '查看结果' }).click();
  await expect(page.locator('.specialty-result')).toBeVisible();
  await expect(page.locator('.specialty-result-topic')).toHaveText('专项练习');
  await page.getByRole('button', { name: '关闭练习结果', exact: true }).click();
  await page.evaluate(() => {
    window.APIClient.getExam = async id => { window.__archiveOpenedExam = id; return {}; };
    window.examViewer.loadExamData = () => {};
    window.examViewer.jumpToQuestion = (section, question) => { window.__archiveOpenedPosition = [section, question]; };
  });
  await draft.getByRole('button', { name: '继续练习' }).click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => [window.__archiveOpenedExam, window.__archiveOpenedPosition])).toEqual(['N2_2025_07', [2, 1]]);
});

test('学习档案没有数据时显示空状态', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  await page.evaluate(() => {
    window.APIClient.getLearningReport = async () => ({ answers: { questions: 0, accuracy: 100 } });
    window.APIClient.getBookmarks = async () => ({ questions: [] });
  });
  const archive = shell.getByRole('region', { name: '学习档案', exact: true });
  const summary = archive.getByRole('region', { name: '档案摘要' });
  await archive.getByRole('button', { name: '学习记录', exact: true }).click();
  await expect(summary).toContainText('暂无学习记录');
  await archive.getByRole('button', { name: '错题与收藏', exact: true }).click();
  await summary.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(summary).toContainText('暂无收藏');
  await archive.getByRole('button', { name: '学习报告', exact: true }).click();
  await expect(summary).toContainText('近7天暂无');
  await expect(summary).not.toContainText('100%');
  await expect(summary).toContainText('能力证据还不足');
});


test('首页未溢出时无滚动条，缩小窗口后只在内容区滚动，返回做题可正常滚动', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const shell = await openHome(page);
  const content = shell.locator('.pc-platform-admin-content');
  const scrollbar = shell.locator('.pc-platform-overlay-scrollbar');
  await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)).toBe(0);
  expect(await content.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
  await expect(scrollbar).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 560 });
  await expect(scrollbar).toBeVisible();
  expect(await content.evaluate(el => el.scrollHeight > el.clientHeight)).toBeTruthy();
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(scrollbar).toBeHidden();
  await page.setViewportSize({ width: 390, height: 1100 });
  await expect(scrollbar).toBeHidden();
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight)).toBeTruthy();
  await page.evaluate(() => window.closeLearningWorkspace());
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('首页重绘与课程详情共享课程读取，失败可重试', async ({ page }) => {
  let requests = 0;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/me/courses**', async route => {
    if (++requests === 1) {
      await blocked;
      return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: '课程暂不可用' } });
    }
    return route.fulfill({ json: { code: 'OK', data: {
      groups: [{ name: '测试班级' }],
      lessons: [{ lesson_id: 'test-lesson', title: '下节日语课', status: 'scheduled', starts_at: '2099-12-01T01:00:00Z', ends_at: '2099-12-01T02:00:00Z' }]
    } } });
  });
  await loginWithPassword(page, 'student_demo');
  const shell = page.locator('#platform-admin-shell');
  const summary = shell.locator('[data-institution-flow="course-summary"]');
  try {
    await expect(summary.getByRole('status')).toHaveText('正在读取课程…');
    for (let index = 0; index < 3; index++) {
      await page.evaluate(() => window.navigateLearningWorkspace('__overview__'));
      await expect(summary.getByRole('status')).toBeVisible();
    }
    expect(requests).toBe(1);
  } finally {
    release();
  }
  await expect(summary.getByRole('alert')).toHaveText('课程暂不可用');
  await summary.getByRole('button', { name: '重新读取' }).click();
  await expect(summary).toContainText('下节日语课');
  expect(requests).toBe(2);
  await summary.getByRole('button', { name: '课程与课时' }).click();
  const details = shell.locator('[data-institution-flow="courses"]');
  await expect(details).toContainText('下节日语课');
  expect(requests).toBe(2);
  await details.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(details).toContainText('下节日语课');
  expect(requests).toBe(3);
});

test('首页未诊断时明确显示开始诊断和用途，不误报今日完成', async ({ page }) => {
  const shell = await openHome(page, 'empty');
  const today = shell.getByRole('region', { name: '今天的学习', exact: true });
  await expect(today.locator('.pc-today-progress')).toHaveText('诊断未开始');
  const diagnosis = today.getByRole('button', { name: '开始诊断 →', exact: true });
  const recentAction = shell.getByRole('region', { name: '最近练习', exact: true })
    .getByRole('button', { name: '查看结果 →', exact: true });
  await expect(diagnosis).toBeVisible();
  await expect(today).toContainText('40 题 · 约35分钟 · 用于安排学习重点');
  const buttonStyle = button => button.evaluate(el => {
    const { backgroundColor, borderRadius, minHeight, paddingInline } = getComputedStyle(el);
    return { backgroundColor, borderRadius, minHeight, paddingInline };
  });
  expect(await buttonStyle(diagnosis)).toEqual(await buttonStyle(recentAction));
  await expect(today).not.toContainText('完成入门诊断');
  await expect(today).not.toContainText('今日已完成');
});

for (const [target, examId] of [['JLPT N3', 'N3_DIAGNOSTIC_V1'], ['JLPT N2', 'N2_DIAGNOSTIC_V1'], ['EJU 日本語', 'EJU_JAPANESE_DIAGNOSTIC_V1']]) {
  test(`首页开始${target}诊断归属系统学习，返回后可继续原诊断`, async ({ page }, testInfo) => {
    const shell = await openHome(page, 'empty', target);
    await page.evaluate(() => {
      const api = window.APIClient;
      api.getDraft = async () => null;
      api.saveDraft = async () => ({ revision: 1 });
      window.examViewer.examMode = 'practice';
    });
    await expect(shell.locator('.pc-selfstudy-goal')).toContainText(target);
    await expect(shell.locator('.pc-today-progress')).toHaveText('诊断未开始');
    await shell.locator('.pc-selfstudy-start').click();
    await expect(shell).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.examViewer._currentExamId)).toBe(examId);
    expect(await page.evaluate(() => ({ kind: window.examViewer.getLearningSessionKind(), mode: window.examViewer.examMode, specialty: window.examViewer.specialtyPractice, type: window.examViewer.currentExam.exam_info.paper_type }))).toEqual({ kind: 'diagnostic', mode: 'mock', specialty: null, type: 'diagnostic' });
    await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-ls-group="practice"]')).not.toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.ls-paper-header h2')).toHaveText('入门诊断');
    await expect(page.locator('.ls-paper-picker')).toBeHidden();
    await expect(page.locator('[data-ls-continue]')).toHaveText('继续诊断');
    await page.locator('[data-ls-continue]').click();
    await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: testInfo.outputPath('diagnostic-navigation.png') });
    await page.locator('[data-ls-return-navigation]').click();
    await expect(shell).toBeVisible();
    await shell.locator('.pc-selfstudy-start').click();
    await expect(shell).toBeHidden();
    await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe(examId);
  });
}

test('首页诊断草稿显示真实进度，并从继续诊断恢复原题', async ({ page }) => {
  const shell = await openHome(page, 'diagnosis_draft');
  await expect(shell.locator('.pc-today-progress')).toHaveText('诊断进行中 · 已答8/40题');
  await expect(shell.locator('.pc-selfstudy-start')).toContainText('继续诊断');
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await page.evaluate(() => {
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', paper_type: 'diagnostic', sections: [{ section_type: 'vocabulary', section_name: '诊断', questions: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, question: `诊断题${i + 1}`, options: ['一', '二'], correct_answer: 1 })) }] } });
    window.APIClient.getDraft = async () => ({ exam_id: 'N2_DIAGNOSTIC_V1', exam_mode: 'mock', answers: { '0:1': 1 }, answered_count: 8, last_section_index: 0, last_question_index: 7, revision: 1 });
    window.APIClient.saveDraft = async () => ({ revision: 1 });
  });
  await shell.locator('.pc-selfstudy-start').click();
  await expect(page.locator('#learning-topbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.examViewer.currentQuestionIndex)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.examViewer.userAnswers['0:1'])).toBe(1);
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ls-continue]')).toHaveText('继续诊断');
  await expect(page.locator('.ls-paper-header h2')).toHaveText('入门诊断');
  await page.locator('[data-ls-return-navigation]').click();
  await expect(shell).toBeVisible();
  await page.evaluate(() => {
    window.examViewer.examMode = 'practice';
    window.navigateLearningWorkspace('openStudentRecent:N2_DIAGNOSTIC_V1');
  });
  await expect(shell).toBeHidden();
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => window.examViewer.examMode)).toBe('mock');
  await expect.poll(() => page.evaluate(() => window.examViewer.currentQuestionIndex)).toBe(7);
});

test('首页今日进度按当前目标去重，档案显示有依据的数量', async ({ page }) => {
  const shell = await openHome(page);
  await expect(shell.locator('.pc-today-progress')).toHaveText('今日已完成 1/4题');
  await expect(shell.locator('[data-archive-section="records"]')).toContainText('近期3条');
  await expect(shell.locator('[data-archive-section="review"]')).toContainText('待订正12');
  await expect(shell.locator('[data-archive-section="review"]')).toContainText('收藏3');
});

test('首页档案数量读取失败时保留入口，不把未知数量显示为零', async ({ page }) => {
  const shell = await openHome(page, 'counts_error');
  const review = shell.locator('[data-archive-section="review"]');
  await expect(review).toBeVisible();
  await expect(review.locator('small')).toHaveCount(0);
  await expect(review).not.toContainText('待订正0');
  await expect(review).not.toContainText('收藏0');
});

test('首页跨等级记录有提示，任务与最近练习操作一致且没有重复浮条', async ({ page }, testInfo) => {
  const shell = await openHome(page, 'crosslevel');
  await expect(shell.locator('.pc-recent-practice')).toContainText('其他等级 · JLPT N2');
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  const colors = await shell.evaluate(el => {
    const style = selector => getComputedStyle(el.querySelector(selector));
    return { start: style('.pc-selfstudy-start').backgroundColor, recent: style('.pc-recent-practice .pc-selfstudy-draft-row > button').backgroundColor };
  });
  expect(colors.start).toBe(colors.recent);
  await page.screenshot({ path: testInfo.outputPath('home-actions-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await shell.locator('.pc-selfstudy-home').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('home-actions-mobile.png') });
});

test('首页今日完成后转为自由练习入口，不重复启动已完成的计划', async ({ page }) => {
  const shell = await openHome(page, 'today_complete');
  await expect(shell.locator('.pc-today-progress')).toHaveText('今日已完成 · 1题');
  await expect(shell.locator('.pc-selfstudy-steps')).toHaveCount(0);
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await shell.locator('.pc-selfstudy-start').click();
  await expect(shell.locator('#student-learning-home > header h1')).toHaveText('自由练习');
});

test('首页继续操作集中在任务卡，开始任务并返回后可继续且保留最近记录', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const shell = await openHome(page);
  const dock = shell.locator('.pc-continue-dock');
  const history = shell.locator('.pc-selfstudy-choose .pc-recent-practice');
  await expect(history).toBeVisible();
  await expect(history.locator('.pc-selfstudy-draft-row')).toHaveCount(1);
  await expect(dock).toHaveCount(0);
  await expect(history.locator('.pc-selfstudy-draft-row')).toHaveCount(1);
  await history.getByRole('button', { name: '更多记录' }).click();
  await expect(history.locator('.pc-selfstudy-draft-row')).toHaveCount(3);
  await expect(history).toContainText('继续练习');
  await expect(dock).toHaveCount(0);
  await page.evaluate(() => {
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'reading', section_name: '阅读', questions: [{ id: '3', question: '系统学习测试', options: ['一', '二'], correct_answer: 1 }] }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
  });
  await shell.locator('.pc-selfstudy-steps button[data-role-admin-intent^="openSystemPractice:"]').first().click();
  await expect(page.locator('#platform-admin-shell')).not.toHaveClass(/pc-platform-admin-open/);
  await page.evaluate(() => window.navigateLearningWorkspace('__overview__'));
  await expect(dock).toHaveCount(0);
  await expect(shell.locator('.pc-selfstudy-start')).toContainText('继续学习');
  await expect(history).toContainText('最近练习');
  await page.screenshot({ path: testInfo.outputPath('continue-learning-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await history.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  const box = await history.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('continue-learning-mobile.png') });
});

test('今日系统学习已完成且没有未完成自由练习时隐藏底部入口', async ({ page }) => {
  const shell = await openHome(page, 'today_complete');
  await expect(shell.locator('.pc-selfstudy-choose .pc-recent-practice')).toBeVisible();
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
});

test('没有进行中任务时在系统学习卡片开始，不添加浮动待学提示', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await expect(shell.locator('.pc-selfstudy-start')).toContainText('开始学习');
});

test('首页专项练习在自由练习卡片内展开，筛选返回和收起留在首页', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: ['N1', 'N2'].map(level => ({ id: level, family: 'jlpt', level, section_type: 'vocabulary', section_name: '問題1 - 漢字読み', question_count: 3, answered: 2, correct: 1 })) });
    window.APIClient.getChapterDetail = async id => ({ questions: [
      { exam_id: id + '_2025_07', question_id: '1', status: 'correct', stem: '答对题干' },
      { exam_id: id + '_2025_07', question_id: '2', status: 'wrong', stem: '答错题干' },
      { exam_id: id + '_2025_07', question_id: '3', status: '', stem: '未做题干' }
    ] });
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '問題1 - 漢字読み', questions: [1, 2, 3].map(id => ({ id, question: `专项题干${id}`, options: ['正确', '错误'], correct_answer: 1, explanation: '答对题解析' })) }] } });
    window.APIClient.getDraft = async () => null;
    window.APIClient.saveDraft = async () => ({ revision: 1 });
  });
  const free = shell.getByRole('region', { name: '自由练习', exact: true });
  const toggle = free.locator('[data-role-admin-intent="openStudentFreePractice:"]');
  await expect(free.locator('#cp-inline-host')).toBeHidden();
  await toggle.click();
  await expect(free.locator('#cp-inline-host #chapter-modal')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  await expect(free.locator('#cp-exam')).toHaveValue('JLPT-N2');
  await expect(shell.locator('.pc-continue-dock')).toHaveCount(0);
  await expect(free.locator('.pc-recent-practice')).toHaveCount(1);
  await free.locator('[data-cp-stat="correct"]').click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#specialty-question-feedback')).toContainText('此前答对');
  await openTaskDetails(page);
  await page.locator('.specialty-nav').getByRole('button', { name: '返回专项', exact: true }).click();
  await expect(shell).toBeVisible();
  await expect(shell.locator('.cp-question-view')).toHaveCount(0);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await free.locator('#cp-exam').selectOption('JLPT-N1');
  await expect(free.locator('.cp-exam-group')).toHaveAttribute('aria-label', 'N1专项练习');
  await page.screenshot({ path: testInfo.outputPath('practice-inline-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await free.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await free.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('practice-inline-mobile.png') });
  await toggle.click();
  await expect(free.locator('#cp-inline-host')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
});


test('真题独立页面按考试展示全部年份，返回原入口', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  await page.evaluate(() => {
    window.APIClient.listChapters = async () => ({ items: [{ id: 'cp_n2', family: 'jlpt', level: 'N2', section_type: 'vocabulary', section_name: '問題1 - 漢字読み', question_count: 3, answered: 0, correct: 0 }] });
    window.APIClient.getExams = async ({ family, level }) => family === 'eju' ? [{ id: '2020_01' }, { id: 'EJU_2020_02' }] : level === 'N2' ? [{ id: 'N2_2020_12' }, { id: 'N2_2024_07' }, { id: 'N2_2025_07' }, { id: 'N2_DIAGNOSTIC_V1' }, ...Array.from({ length: 9 }, (_, index) => ({ id: `N2_${2019 - index}_07` }))] : [];
  });
  const free = shell.getByRole('region', { name: '自由练习', exact: true });
  const specialty = free.locator('[data-role-admin-intent="openStudentFreePractice:"]');
  const papers = free.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]');
  await specialty.click();
  await expect(free.locator('#cp-filters select')).toHaveCount(3);
  await expect(free.locator('#cp-reload')).toHaveCount(0);
  await papers.click();
  await expect(free).toHaveCount(0);
  await expect(shell.getByRole('heading', { name: '真题模式', exact: true })).toBeVisible();
  const pane = shell.locator('#paper-library');
  await expect(pane).toBeVisible();
  await expect(pane.locator('select')).toHaveCount(2);
  await expect(pane.getByRole('combobox', { name: '试卷排序' })).toHaveValue('desc');
  await expect(pane.locator('[data-paper-exam]')).toHaveValue('JLPT-N2');
  await expect(pane.locator('[data-paper-year]')).toHaveCount(0);
  await expect(pane.locator('.pc-paper-row')).toHaveCount(10);
  await expect(pane.locator('.pc-paper-row strong').nth(0)).toHaveText('2025年7月真题');
  await expect(pane.locator('.pc-paper-row strong').nth(1)).toHaveText('2024年7月真题');
  await expect(pane.locator('.pc-paper-row strong').nth(2)).toHaveText('2020年12月真题');
  const expand = pane.locator('[data-paper-expand]');
  await expect(expand).toHaveAccessibleName('展开剩余 2 套真题');
  await expand.click();
  await expect(pane.locator('.pc-paper-row')).toHaveCount(12);
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expand.click();
  await expect(pane.locator('.pc-paper-row')).toHaveCount(10);
  await expect(pane).toContainText('继续练习');
  await expect(pane).toContainText('2024年7月真题');
  await expect(pane).toContainText('查看作答');
  await expect(pane).toContainText('2020年12月真题');
  await expect(pane).toContainText('整套练习');
  const order = pane.getByRole('combobox', { name: '试卷排序' });
  await order.selectOption('asc');
  await expect(pane.locator('.pc-paper-row')).toHaveCount(10);
  await expect(pane.locator('.pc-paper-row strong').first()).toHaveText('2011年7月真题');
  await expand.click();
  const ascending = await pane.locator('[data-paper-open]').evaluateAll(items => items.map(item => item.dataset.paperOpen));
  await page.evaluate(() => { window.__paperSortRandom = Math.random; Math.random = () => 0; });
  await order.selectOption('random');
  await page.evaluate(() => { Math.random = window.__paperSortRandom; delete window.__paperSortRandom; });
  await expect(pane.locator('.pc-paper-row')).toHaveCount(10);
  await expand.click();
  const randomized = await pane.locator('[data-paper-open]').evaluateAll(items => items.map(item => item.dataset.paperOpen));
  expect(randomized).not.toEqual(ascending);
  expect([...randomized].sort()).toEqual([...ascending].sort());
  await expand.click();
  await expand.click();
  expect(await pane.locator('[data-paper-open]').evaluateAll(items => items.map(item => item.dataset.paperOpen))).toEqual(randomized);
  await order.selectOption('desc');
  await expect(pane.locator('.pc-paper-row strong').first()).toHaveText('2025年7月真题');
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('paper-library-desktop.png') });
  await pane.locator('[data-paper-exam]').selectOption('EJU');
  await expect(pane.locator('.pc-paper-row strong')).toHaveText(['2020年第2回真题', '2020年第1回真题']);
  await expect(pane).toContainText('2020年第1回真题');
  await expect(pane.locator('.pc-paper-row')).toHaveCount(2);
  await expect(pane.locator('[data-paper-expand]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('paper-library-mobile.png') });
  await pane.locator('[data-paper-exam]').selectOption('JLPT-N1');
  await expect(pane).toContainText('暂无收录');
  await expect(pane.locator('.pc-paper-row')).toHaveCount(0);
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.getByRole('heading', { name: '学习首页', exact: true })).toBeVisible();
  await expect(papers).toBeFocused();
  await expect(pane).toHaveCount(0);
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-free-practice'));
  await papers.click();
  await expect(pane).toBeVisible();
  await shell.locator('[data-workspace-back]').click();
  await expect(shell.getByRole('heading', { name: '自由练习', exact: true, level: 1 })).toBeVisible();
  await specialty.click();
  await expect(free.locator('#cp-inline-host')).toBeVisible();
  await expect(pane).toBeHidden();
});

test('学习菜单与内容相邻，超过1234px的留白均分在两侧', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  const menu = page.locator('#learning-shell .ls-menu');
  const paper = shell.locator(':scope > .pc-platform-workspace');
  for (const width of [1600, 1234, 1180, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    const m = await menu.boundingBox();
    const p = await paper.boundingBox();
    expect(m.width).toBeCloseTo(240, 0);
    expect(p.x).toBeCloseTo(m.x + m.width, 0);
    expect(m.x).toBeCloseTo(Math.max(0, (width - 1234) / 2), 0);
    expect(width - p.x - p.width).toBeCloseTo(m.x, 0);
    expect(p.width).toBeCloseTo(Math.min(994, width - 240), 0);
  }
  await page.screenshot({ path: testInfo.outputPath('adjacent-tablet.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('adjacent-desktop.png') });
  await shell.locator('[data-platform-admin-nav-trigger]').click();
  await expect(menu).toBeHidden();
  const collapsed = await paper.boundingBox();
  expect(collapsed.width).toBeCloseTo(994, 0);
  expect(collapsed.x).toBeCloseTo((1600 - 994) / 2, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await shell.locator('[data-platform-admin-nav-trigger]').click();
  await expect(menu).toBeVisible();
  expect(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
});

test('实际做题页缩到平板宽度时，菜单与白色题纸之间没有灰色缝隙', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const shell = await openHome(page);
  await page.evaluate(async () => {
    const v = window.examViewer;
    v._currentExamId = 'N1_2025_07';
    v.examMode = 'practice';
    v.loadExamData(await window.APIClient.getExam('N1_2025_07'));
  });
  await page.evaluate(() => window.closeLearningWorkspace());
  const menu = page.locator('#learning-shell .ls-menu');
  const paper = page.locator('#current-question-container');
  for (const width of [1600, 1234, 1180, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox();
    const p = await paper.boundingBox();
    expect(p.x).toBeCloseTo(m.x + m.width, 0);
    await expect(page.locator('#exam-workarea')).toHaveCSS('padding-left', '0px');
    await expect(page.locator('#exam-workarea')).toHaveCSS('padding-right', '0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    if (width === 974) await page.screenshot({ path: testInfo.outputPath('question-tablet-no-gap.png') });
  }
});

test('低于1100px自动隐藏学员菜单，首页和做题页均可打开抽屉', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const shell = await openHome(page);
  await expect(shell.locator('[data-platform-admin-close]')).toHaveCount(0);
  await expect(shell.locator('[data-platform-admin-account-menu]')).toBeVisible();
  await expect(shell.locator('.pc-topbar-home')).toHaveCount(0);
  const menu = page.locator('#learning-shell .ls-menu');
  const paper = shell.locator(':scope > .pc-platform-workspace');
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 820 });
  await expect(menu).toBeVisible();
  for (const width of [1099, 1024, 974, 820]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(menu).toBeHidden();
    const rect = await paper.boundingBox();
    expect(rect.width).toBeCloseTo(Math.min(width, 994), 0);
    await shell.locator('[data-platform-admin-nav-trigger]').click();
    await expect(menu).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/ls-drawer-open/);
    const openRect = await paper.boundingBox();
    expect(openRect.x).toBeCloseTo(rect.x, 0);
    expect(openRect.width).toBeCloseTo(rect.width, 0);
    await page.locator('.ls-backdrop').click({ position: { x: width - 260, y: 100 } });
    await expect(menu).toBeHidden();
  }
  await page.setViewportSize({ width: 1024, height: 820 });
  await page.screenshot({ path: testInfo.outputPath('home-compact-1100.png') });
  await page.evaluate(async () => {
    const v = window.examViewer;
    v._currentExamId = 'N1_2025_07'; v.examMode = 'practice';
    v.loadExamData(await window.APIClient.getExam('N1_2025_07'));
  });
  await page.evaluate(() => window.closeLearningWorkspace());
  await expect(menu).toBeHidden();
  await page.locator('#learning-topbar .ls-mobile-toggle').click();
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 820 });
  await expect(page.locator('body')).not.toHaveClass(/ls-drawer-open/);
  await expect(menu).toBeVisible();
});
