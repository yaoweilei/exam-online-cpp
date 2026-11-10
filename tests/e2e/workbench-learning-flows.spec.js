const { test, expect } = require('@playwright/test');
const { loginWithPassword, loginApi, uniqueLoginId, stubPracticeDraftSync } = require('./helpers/session');

async function auditLogin(page, username) {
  try { await loginWithPassword(page, username); }
  catch (error) {
    // The refreshed workspace can replace the old viewer's avatar before the
    // legacy login helper observes it. Verify the actual authenticated shell.
    if (!await page.locator('[data-platform-admin-account-menu]').isVisible()
      || await page.evaluate(() => window.getUserContext?.().username) !== username) throw error;
  }
  await page.waitForLoadState('networkidle');
}

async function openAuditHome(page, scenario = 'normal') {
  await stubPracticeDraftSync(page);
  await page.route('**/api/v1/me/study-goals', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { code: 'OK', data: { items: [{ goal_id: 'audit', exam_target: 'JLPT N2', target_date: '2099-12-01', daily_minutes: 20 }] } } })
    : route.continue());
  await auditLogin(page, 'student_demo');
  await page.waitForLoadState('networkidle');
  await page.evaluate(scenario => {
    const api = window.APIClient;
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'audit', exam_target: 'JLPT N2', target_date: '2099-12-01', daily_minutes: 20 }] });
    api.listRecentLearning = async () => ({ items: [] });
    api.listMyAssignments = async () => ({ items: [] });
    api.getWrongQuestionSummary = async () => ({ total: 0, active: 0 });
    api.getBookmarks = async () => ({ questions: [] });
    api.getAnswerAttempts = async () => [{ statistics: { results: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`0:${i + 1}`, { status: 'correct' }])) }, saved_at: new Date().toISOString() }];
    api.getAdaptiveLearningProfile = async () => ({ exam_target: 'JLPT N2', updated_at: new Date().toISOString(), domains: Object.fromEntries(['vocabulary', 'grammar', 'reading', 'listening'].map(id => [id, { score: id === 'reading' ? 50 : 80, observation_count: 20, correct_count: 10, evidence: 'sufficient', learning_days: 5, material_count: 5 }])) });
    const due = id => ({ card_id: `N2_2020_07:${id}`, exam_id: 'N2_2020_07', question_id: String(id), source: 'srs_due' });
    api.getDailyPractice = async () => ({ items: scenario === 'srs' ? [due(1), due(2)] : scenario === 'system' ? [{ exam_id: 'N2_2020_07', question_id: '2', section_index: 0, section_type: 'reading', source: 'recommended' }] : scenario === 'wrong' && !window.__wrongDone ? [{ exam_id: 'N2_2020_07', question_id: '2', section_index: 0, source: 'wrong_question', question_snapshot: { id: 2 } }] : [], completed_question_ids: [] });
    api.listSrsDue = async () => ({ items: [due(1), due(2)] });
    api.getDraft = async () => null;
    api.saveDraft = async () => ({ revision: 1 });
    window.__dailyCompletions = [];
    api.completeDailyPracticeItem = async (questionId, examId, target) => { window.__dailyCompletions.push({ questionId, examId, target }); };
    api.saveSpecialtySession = async payload => { window.__savedSession = payload; return { submission_id: payload.submission_id, statistics: { practice_label: payload.label, session_questions: payload.questions, total_questions: payload.questions.length, correct_count: payload.questions.filter(q => q.status === 'correct').length, wrong_count: payload.questions.filter(q => q.status === 'wrong').length } }; };
    api.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: [{ section_type: 'reading', section_name: '読解', questions: [1, 2, 3].map(id => ({ id, question: `审查题目${id}`, options: ['正确', '错误'], correct_answer: 1, explanation: `审查解析${id}` })) }] } });
    window.dispatchEvent(new Event('examAnswersSubmitted'));
    window.navigateLearningWorkspace('__overview__');
  }, scenario);
  await expect(page.locator('.pc-selfstudy-goal')).toContainText('JLPT N2');
  await expect(page.locator('.pc-today-progress')).not.toContainText('正在读取');
  return page.locator('#platform-admin-shell');
}

test('账号菜单实际入口可进入工作台，四个学习导航可返回', async ({ page }, info) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => window.closeLearningWorkspace());
  await page.locator('#user-menu-trigger').click();
  await page.getByRole('menuitem', { name: /进入学习工作台/ }).click();
  await expect(shell).toBeVisible();
  await expect(shell.locator('#student-learning-home h1')).toHaveText('学习首页');
  for (const intent of ['openStudyGoal', 'openRoleContent:student-today', 'openRoleContent:student-free-practice', 'openRoleContent:student-learning-archive']) {
    await page.evaluate(intent => window.navigateLearningWorkspace(intent), intent);
    await expect(shell).toBeVisible();
    await page.evaluate(() => window.navigateLearningWorkspace('__overview__'));
    await expect(shell.locator('#student-learning-home h1')).toHaveText('学习首页');
  }
  await page.screenshot({ path: info.outputPath('entry-home.png') });
});

test('超级管理员选择学员身份后，从账号菜单进入学习首页', async ({ page }) => {
  await auditLogin(page, 'superadmin_demo');
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  await shell.getByLabel('切换当前身份').selectOption('student');
  await page.evaluate(() => {
    window.APIClient.getDraft = async () => null;
    window.examViewer._currentExamId = 'N3_2010_07';
    window.examViewer.examMode = 'practice';
    window.examViewer.loadExamData({ family: 'jlpt', exam_info: { exam_level: 'N3', sections: [{ section_type: 'vocabulary', section_name: '漢字読み', questions: [{ id: 1, question: '账号入口审查', options: ['一', '二'], correct_answer: 1 }] }] } });
    window.closeLearningWorkspace();
  });
  await page.locator('#user-menu-trigger').click();
  await page.getByRole('menuitem', { name: /进入学习工作台/ }).click();
  await expect(shell).toHaveAttribute('data-learning-role', 'student');
  await expect(shell.locator('#student-learning-home h1')).toHaveText('学习首页');
});

test('学习档案摘要可切换，报告失败可重试，手机可打开完整记录', async ({ page }, info) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    window.__reportCalls = 0;
    window.APIClient.getLearningReport = async () => { if (++window.__reportCalls === 1) throw new Error('审查报告失败'); return { period: 'week', answers: { questions: 12, accuracy: 75 } }; };
  });
  const summary = shell.locator('#student-archive-summary');
  await shell.locator('[data-archive-section="records"]').click();
  await expect(summary).toContainText('最近学习');
  await shell.locator('[data-archive-section="review"]').click();
  await expect(summary).toContainText('近期错题0道');
  await summary.locator('[data-archive-review-tab="bookmarks"]').click();
  await expect(summary).toContainText('暂无收藏');
  await shell.locator('[data-archive-section="report"]').click();
  await expect(summary.getByRole('alert')).toContainText('审查报告失败');
  await summary.locator('[data-archive-retry="report"]').click();
  await expect(summary).toContainText('已作答12题 · 正确率75.0%');
  expect(await page.evaluate(() => window.__reportCalls)).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  expect(await shell.locator('#student-learning-home').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('archive-mobile.png') });
  await shell.locator('[data-archive-section="records"]').click();
  await summary.locator('[data-role-admin-intent="openRecentLearningPage"]').click();
  await expect(shell.locator('.pc-platform-admin-content')).toContainText('学习记录');
});

test('系统错题订正可独立提交并返回，正常到期复习逐题推进', async ({ page }) => {
  const shell = await openAuditHome(page, 'wrong');
  await page.evaluate(() => {
    window.APIClient.submitWrongQuestionCorrection = async (_u, q, payload) => {
      window.__wrongDone = true; window.__wrongPayload = { q, payload };
      return { correct: true, correct_answer: '1', correct_streak: 1, mastered: false, completed_today: true };
    };
  });
  await shell.locator('.pc-selfstudy-steps [data-role-admin-intent="openStudentQueue:wrong"]').click();
  await shell.locator('#student-learning-detail').getByRole('button', { name: '去订正' }).click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#wrong-correction-bar')).toContainText('重新独立作答');
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#exam-settings-toggle').click();
  for (const name of ['answers', 'explanations', 'kana', 'zh']) await expect(page.locator(`#learning-menu-${name}`)).toBeDisabled();
  await expect(page.locator('#exam-mode-select')).toBeHidden();
  await page.locator('#exam-settings-toggle').click();
  await page.locator('[data-question-id="2"][data-option-index="1"]').click();
  await page.getByRole('button', { name: '提交订正', exact: true }).click();
  await expect(page.locator('#wrong-correction-bar')).toContainText('订正正确');
  await expect(page.locator('#current-question-container')).toContainText('审查解析2');
  expect(await page.evaluate(() => window.__wrongPayload.payload.answer)).toBe(1);
  await page.getByRole('button', { name: '返回今日', exact: true }).click();
  await expect(shell).toBeVisible();
  await openAuditHome(page, 'srs');
  await page.evaluate(() => { window.__grades = []; window.APIClient.reviewSrsCard = async (_u, id) => { window.__grades.push(id); }; });
  await shell.locator('[data-role-admin-intent="openSrsReview"]').first().click();
  const review = shell.locator('#srs-modal');
  for (const n of [1, 2]) {
    await expect(review).toContainText(`审查题目${n}`);
    await expect(review.locator('#srs-footer')).toBeHidden();
    await review.getByText('查看答案与解析', { exact: true }).click();
    await review.getByRole('button', { name: '良好', exact: true }).click();
  }
  await expect(review).toContainText('本次计划复习已完成');
  expect(await page.evaluate(() => window.__grades)).toEqual(['N2_2020_07:1', 'N2_2020_07:2']);
});

test('到期复习评分失败后重试保留当前题，下一题不漏做也不误记完成', async ({ page }) => {
  const shell = await openAuditHome(page, 'srs');
  await page.evaluate(() => {
    window.__gradeCalls = [];
    window.APIClient.reviewSrsCard = async (_u, id, grade) => { window.__gradeCalls.push({ id, grade }); if (window.__gradeCalls.length === 1) throw new Error('审查模拟网络失败'); };
  });
  await shell.locator('[data-role-admin-intent="openSrsReview"]').first().click();
  const review = shell.locator('#srs-modal');
  await expect(review).toContainText('审查题目1');
  await review.getByText('查看答案与解析', { exact: true }).click();
  await review.getByRole('button', { name: '良好', exact: true }).click();
  await expect(review).toContainText('审查题目1');
  await review.getByRole('button', { name: '良好', exact: true }).click();
  await expect(review).toContainText('审查题目2');
  await expect(review).not.toContainText('本次计划复习已完成');
  expect(await page.evaluate(() => window.__gradeCalls.map(c => c.id))).toEqual(['N2_2020_07:1', 'N2_2020_07:1']);
  expect(await page.evaluate(() => window.__dailyCompletions.map(c => c.questionId))).toEqual(['1']);
  await review.getByText('查看答案与解析', { exact: true }).click();
  await review.getByRole('button', { name: '良好', exact: true }).click();
  await expect(review).toContainText('本次计划复习已完成');
  expect(await page.evaluate(() => window.__gradeCalls.map(c => c.id))).toEqual(['N2_2020_07:1', 'N2_2020_07:1', 'N2_2020_07:2']);
  expect(await page.evaluate(() => window.__dailyCompletions.map(c => c.questionId))).toEqual(['1', '2']);
});

test('系统推荐只练任务内题目，重置考试与解析状态并在结束后记录今日完成', async ({ page }, info) => {
  const shell = await openAuditHome(page, 'system');
  await page.evaluate(() => { window.examViewer.examMode = 'mock'; window.examViewer.showAnswers = true; window.examViewer.showExplanations = true; });
  await shell.locator('.pc-selfstudy-steps [data-role-admin-intent^="openSystemPractice:"]').first().click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#current-question-container')).toContainText('审查题目2');
  const state = await page.evaluate(() => ({ mode: window.examViewer.examMode, scope: window.examViewer.practiceScope, count: window.examViewer.getPracticeQuestions().length, specialty: window.examViewer.specialtyPractice }));
  expect(state.mode).toBe('practice');
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-ls-return-navigation]')).toBeVisible();
  await expect(page.locator('[data-ls-continue]')).toHaveText('继续当前学习');
  await expect(page.locator('[data-ls-continue] svg')).toHaveCount(1);
  await page.locator('[data-ls-continue]').click();
  await expect(page.locator('[data-ls-group="study"]')).toHaveAttribute('aria-current', 'page');
  expect(state.specialty.questions).toEqual([{ examId: 'N2_2020_07', questionId: '2', sectionIndex: 0 }]);
  await expect(page.locator('.task-nav .question-counter')).toHaveText('1 / 1');
  await expect(page.locator('#current-question-container .correct-option')).toHaveCount(0);
  await expect(page.locator('#current-question-container .explanation')).toHaveCount(0);
  await expect(page.locator('.specialty-confirm-answer')).toBeDisabled();
  await page.locator('[data-question-id="2"][data-option-index="1"]').click();
  await page.locator('.specialty-confirm-answer').click();
  await expect(page.locator('#current-question-container .correct-option')).toHaveCount(1);
  await page.locator('.task-nav .exit-specialty-btn').click();
  await expect(page.locator('[data-specialty-save]')).toContainText('已保存本次结果');
  expect(await page.evaluate(() => window.__dailyCompletions)).toEqual([{ questionId: '0:2', examId: 'N2_2020_07', target: 'JLPT N2' }]);
  await page.locator('[data-specialty-home]').click();
  await page.evaluate(() => {
    window.navigateLearningWorkspace('__overview__');
    window.examViewer.examMode = 'practice';
    window.examViewer.showAnswers = true;
    window.examViewer.showExplanations = true;
    window.examViewer.showReadingKana = true;
    window.examViewer.showReadingZh = true;
  });
  await shell.locator('.pc-selfstudy-steps [data-role-admin-intent^="openSystemPractice:"]').first().click();
  await expect(page.locator('#current-question-container')).toContainText('审查题目2');
  await expect(page.locator('#current-question-container .correct-option')).toHaveCount(0);
  await expect(page.locator('#current-question-container .explanation')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.examViewer.userAnswers).length)).toBe(0);
  await page.screenshot({ path: info.outputPath('system-task-before-answer.png') });
});

test('多套练习分别暂存，刷新后可以指定恢复旧练习且互不覆盖', async ({ page }) => {
  await openAuditHome(page);
  await page.evaluate(async () => {
    const viewer = window.examViewer;
    await viewer.startWholePaperPractice('N2_2020_07', 'A试卷', { fresh: true, returnContext: { surface: 'paper' } });
    viewer.answerManager.setAnswerComposite(0, '1', 1); viewer.persistSpecialtyDraft();
    window.__beforeSwitch = viewer.getWholePaperProgress('N2_2020_07');
    await viewer.startWholePaperPractice('N2_2019_07', 'B试卷', { fresh: true, returnContext: { surface: 'paper' } });
    viewer.answerManager.setAnswerComposite(0, '1', 2); viewer.persistSpecialtyDraft();
    window.__afterSwitch = { a: viewer.getWholePaperProgress('N2_2020_07'), b: viewer.getWholePaperProgress('N2_2019_07') };
  });
  expect(await page.evaluate(() => window.__beforeSwitch.answered)).toBe(1);
  expect(await page.evaluate(() => window.__afterSwitch)).toEqual({ a: { answered: 1, total: 3 }, b: { answered: 1, total: 3 } });
  const shell = await openAuditHome(page);
  await shell.locator('[data-role-admin-intent="toggleRecentPractice"]').click();
  const row = shell.locator('.pc-recent-practice .pc-selfstudy-draft-row').filter({ hasText: 'A试卷' });
  await row.getByRole('button', { name: /继续练习/ }).click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => ({ exam: window.examViewer._currentExamId, answer: window.examViewer.userAnswers['0:1'], b: window.examViewer.getWholePaperProgress('N2_2019_07') }))).toEqual({ exam: 'N2_2020_07', answer: 1, b: { answered: 1, total: 3 } });
  await page.evaluate(() => { const owner = window.examViewer.userId; window.examViewer.userId = 'another-user'; window.__foreignDrafts = window.examViewer.getSpecialtyDraftProgresses(); window.examViewer.userId = owner; });
  expect(await page.evaluate(() => window.__foreignDrafts)).toEqual([]);
});

test('系统学习结果已保存但今日完成标记失败时，可重试且保留同一次提交', async ({ page }) => {
  const shell = await openAuditHome(page, 'system');
  await page.evaluate(() => {
    window.__submissionIds = []; window.__completionCalls = 0;
    const save = window.APIClient.saveSpecialtySession;
    window.APIClient.saveSpecialtySession = async payload => { window.__submissionIds.push(payload.submission_id); return save(payload); };
    window.APIClient.completeDailyPracticeItem = async () => { if (++window.__completionCalls === 1) throw new Error('完成标记失败'); };
  });
  await shell.locator('.pc-selfstudy-steps [data-role-admin-intent^="openSystemPractice:"]').first().click();
  await page.locator('[data-question-id="2"][data-option-index="1"]').click();
  await page.locator('.specialty-confirm-answer').click();
  await page.locator('.exit-specialty-btn').click();
  await expect(page.locator('[data-specialty-save]')).toContainText('保存失败');
  expect(await page.evaluate(() => window.examViewer.getSpecialtyDraftProgresses().filter(p => p.mode === 'system').length)).toBe(1);
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.locator('[data-specialty-save]')).toContainText('已保存本次结果');
  expect(await page.evaluate(() => window.__submissionIds.length)).toBe(2);
  expect(await page.evaluate(() => new Set(window.__submissionIds).size)).toBe(1);
  expect(await page.evaluate(() => window.examViewer.getSpecialtyDraftProgresses().filter(p => p.mode === 'system').length)).toBe(0);
});

test('EJU按题组选读解准确定位同号题，提交与回顾保留题型位置', async ({ page }, info) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    window.APIClient.getExams = async () => [{ id: '2020_01' }];
    window.APIClient.getExam = async () => ({ family: 'eju', exam_info: { sections: [
      { section_type: 'writing', section_name: '記述', questions: [{ id: 1, question: '不应进入的记述题', has_ans: false }] },
      { section_type: 'reading', section_name: '読解', questions: [{ id: 1, question: '应当进入的读解题', options: ['正确', '错误'], correct_answer: 1 }] }
    ] } });
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-exam]').selectOption('EJU');
  await pane.locator('[data-paper-practice="2020_01"]').click();
  const setup = pane.getByRole('region', { name: '选择练习题组' });
  await setup.getByRole('combobox', { name: '练习内容' }).selectOption('读解');
  await setup.locator('[data-paper-section="1"]').check();
  await setup.locator('[data-paper-practice-start]').click();
  await expect(shell).toBeHidden();
  await expect(page.locator('#current-question-container')).toContainText('应当进入的读解题');
  await expect(page.locator('#current-question-container')).not.toContainText('不应进入的记述题');
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(1);
  await page.locator('[data-question-id="1"][data-option-index="1"]').click();
  await page.locator('.specialty-confirm-answer').click();
  await page.locator('.task-nav .exit-specialty-btn').click();
  await expect(page.locator('[data-specialty-save]')).toContainText('已保存本次结果');
  expect(await page.evaluate(() => window.__savedSession.questions[0].section_index)).toBe(1);
  await page.locator('[data-specialty-review]').click();
  expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(1);
  await expect(page.locator('#current-question-container')).toContainText('应当进入的读解题');
  await page.screenshot({ path: info.outputPath('eju-reading-review.png') });
});

test('整套入口忽略迟到的旧草稿请求，保留后来打开的试卷', async ({ page }) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    window.APIClient.getExams = async () => [{ id: 'N2_2020_07' }, { id: 'N2_2019_07' }];
    let requests = 0;
    window.APIClient.getDraft = async () => {
      requests += 1;
      if (requests === 1) return new Promise(resolve => { window.__releaseOldPaper = () => resolve(null); });
      return null;
    };
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const pane = shell.locator('#paper-library');
  await pane.locator('[data-paper-open="N2_2020_07"]').click();
  await expect(pane.locator('[data-paper-open="N2_2020_07"]')).toBeDisabled();
  await pane.locator('[data-paper-open="N2_2019_07"]').click();
  await expect(shell).toBeHidden();
  expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe('N2_2019_07');
  await page.evaluate(() => window.__releaseOldPaper());
  await expect(pane.locator('[data-paper-open="N2_2020_07"]')).toBeEnabled();
  expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe('N2_2019_07');
});

test('旧单份暂存迁移后仍可恢复，结束一套不清除另一套进度', async ({ page }) => {
  await openAuditHome(page);
  await page.evaluate(async () => {
    const v = window.examViewer;
    await v.startWholePaperPractice('N2_2020_07', '旧版A', { fresh: true, returnContext: { surface: 'paper' } });
    v.answerManager.setAnswerComposite(0, '1', 2); v.persistSpecialtyDraft();
    localStorage.removeItem(`examViewer.specialtyDrafts.v2:${v.userId}`);
    await v.startWholePaperPractice('N2_2019_07', '新版B', { fresh: true, returnContext: { surface: 'paper' } });
    v.answerManager.setAnswerComposite(0, '1', 1); v.persistSpecialtyDraft();
    window.APIClient.savePracticeGroup = async payload => ({ submission_id: payload.submission_id, statistics: { results: { '0:1': { status: 'correct' } } } });
    await v.finishSpecialtyPractice();
    window.__remainingDrafts = { a: v.getWholePaperProgress('N2_2020_07'), b: v.getWholePaperProgress('N2_2019_07') };
    await v.startWholePaperPractice('N2_2020_07', '旧版A', { returnContext: { surface: 'paper' } });
  });
  expect(await page.evaluate(() => window.__remainingDrafts)).toEqual({ a: { answered: 1, total: 3 }, b: null });
  expect(await page.evaluate(() => [window.examViewer._currentExamId, window.examViewer.userAnswers['0:1']])).toEqual(['N2_2020_07', 2]);
});

test('整套入口离开页面后忽略迟到的试卷内容，不中断当前页面', async ({ page }) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    window.APIClient.getExams = async () => [{ id: 'N2_2020_07' }];
    window.APIClient.getExam = async () => new Promise(resolve => {
      window.__releasePaperData = () => resolve({ family: 'jlpt', exam_info: { sections: [{ section_type: 'reading', questions: [{ id: 1, question: '迟到的题目', options: ['一', '二'], correct_answer: 1 }] }] } });
    });
  });
  await shell.locator('[data-role-admin-intent="openCurrentTargetExamLibrary"]').click();
  const entry = shell.locator('[data-paper-open="N2_2020_07"]');
  await entry.evaluate(button => { window.__pendingEntryButton = button; });
  await entry.click();
  await expect.poll(() => page.evaluate(() => typeof window.__releasePaperData)).toBe('function');
  const previous = await page.evaluate(() => window.examViewer._currentExamId);
  await page.evaluate(() => window.navigateLearningWorkspace('openRoleContent:student-learning-archive'));
  await page.evaluate(() => window.__releasePaperData());
  await expect.poll(() => page.evaluate(() => window.__pendingEntryButton.disabled)).toBe(false);
  await expect(shell.locator('#student-learning-home h1')).toHaveText('学习档案');
  expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe(previous);
});

test('EJU同号题在服务端分别判分并保存题型位置，专项统计互不污染', async ({ request }) => {
  const user = await loginApi(request, uniqueLoginId('section_identity'));
  const headers = { Authorization: `Bearer ${user.token}` };
  const paper = (await (await request.get('/api/v1/exams/2024_01', { headers })).json()).data;
  const reading = paper.exam_info.sections[1];
  const question = (reading.questions?.length ? reading.questions : reading.passages.flatMap(p => p.questions || [])).find(q => String(q.id) === '1');
  expect(question.correct_answer).toBeTruthy();
  const payload = { label: 'EJU同号题分段验证', submission_id: 'sections-once', questions: [
    { exam_id: '2024_01', question_id: '1', section_index: 0, answer: '記述の回答', viewed: false },
    { exam_id: '2024_01', question_id: '1', section_index: 1, answer: question.correct_answer, viewed: false }
  ] };
  const response = await request.post('/api/v1/answers/specialty-session', { headers, data: payload });
  expect(response.ok(), await response.text()).toBe(true);
  const saved = (await response.json()).data;
  expect(saved.statistics.session_questions.map(q => [q.section_index, q.status])).toEqual([[0, 'ungraded'], [1, 'correct']]);
  const replay = await request.post('/api/v1/answers/specialty-session', { headers, data: payload });
  expect((await replay.json()).data.idempotent_replay).toBe(true);
  const duplicate = await request.post('/api/v1/answers/specialty-session', { headers, data: { ...payload, submission_id: 'bad-duplicate', questions: [payload.questions[1], payload.questions[1]] } });
  expect(duplicate.status()).toBe(422);
  const invalid = await request.post('/api/v1/answers/specialty-session', { headers, data: { ...payload, submission_id: 'bad-section', questions: [{ ...payload.questions[1], section_index: -1 }] } });
  expect(invalid.status()).toBe(422);
  const chapters = (await (await request.get('/api/v1/chapters?family=eju', { headers })).json()).data.items;
  const userId = user.user_id || user.id;
  const detail = await request.get(`/api/v1/chapters/${encodeURIComponent(chapters.find(c => c.section_type === 'reading').id)}?user_id=${userId}`, { headers });
  const row = (await detail.json()).data.questions.find(q => q.exam_id === '2024_01' && q.question_id === '1');
  expect(row.section_index).toBe(1);
  expect(row.status).toBe('correct');
});

test('诊断固定模式并锁定辅助，题号贯穿各部分，未答完保留草稿', async ({ page }, info) => {
  await openAuditHome(page);
  await page.evaluate(() => {
    const v = window.examViewer;
    window.APIClient.submitAnswers = async () => { window.__diagnosticSubmits = (window.__diagnosticSubmits || 0) + 1; return { total_questions: 4, correct_count: 4, unanswered_count: 0, accuracy: 100, completion: 100, score: 100 }; };
    v._currentExamId = 'N2_DIAGNOSTIC_V1'; v.examMode = 'practice';
    v.loadExamData({ family: 'jlpt', exam_info: { paper_type: 'diagnostic', exam_level: 'N2', sections: ['vocabulary', 'reading'].map((type, s) => ({ section_type: type, section_name: type, questions: [1, 2].map(n => ({ id: s * 2 + n, question: `诊断审查${s * 2 + n}`, options: ['对', '错'], correct_answer: 1 })) })) } });
    window.closeLearningWorkspace();
  });
  await expect(page.locator('#submit-exam')).toHaveText('提交诊断');
  await expect(page.locator('.task-nav .question-counter')).toHaveText('1 / 4');
  await page.locator('#exam-settings-toggle').click();
  await expect(page.locator('#exam-mode-select')).toBeHidden();
  for (const name of ['answers', 'explanations', 'kana', 'zh']) await expect(page.locator(`#learning-menu-${name}`)).toBeDisabled();
  await page.locator('#exam-settings-toggle').click();
  await page.evaluate(async () => {
    await window.examViewer.setExamMode('practice', true);
    window.examViewer.toggleAnswers(); window.examViewer.toggleReadingKana();
    await window.examViewer.submitAnswers();
  });
  expect(await page.evaluate(() => [window.examViewer.examMode, window.examViewer.showAnswers, window.examViewer.showReadingKana, window.__diagnosticSubmits || 0])).toEqual(['mock', false, false, 0]);
  await page.evaluate(() => {
    const v = window.examViewer;
    for (let s = 0; s < 2; s++) for (let n = 1; n <= 2; n++) v.answerManager.setAnswerComposite(s, String(s * 2 + n), 1);
    v.jumpToQuestion(1, 0);
  });
  await expect(page.locator('.task-nav .question-counter')).toHaveText('3 / 4');
  await page.locator('#submit-exam').click();
  await page.getByRole('button', { name: '提交诊断', exact: true }).last().click();
  await expect(page.locator('#exam-result-panel')).toContainText('诊断已完成');
  await expect(page.locator('[data-result-action="learning-plan"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('diagnostic-complete.png') });
  await page.locator('[data-result-action="learning-plan"]').click();
  await expect(page.locator('#student-learning-home h1')).toHaveText('系统学习');
});

test('部分诊断的未答结果不算完成，并可恢复旧提交继续答题', async ({ page }) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { paper_type: 'diagnostic', exam_level: 'N2', sections: [{ section_type: 'vocabulary', section_name: '词汇', questions: Array.from({ length: 40 }, (_, n) => ({ id: n + 1, question: `旧诊断${n + 1}`, options: ['对', '错'], correct_answer: 1 })) }] } });
    window.APIClient.getAnswerAttempts = async () => [{ answers: { '0:1': 1 }, statistics: { results: { '0:1': { status: 'correct' }, ...Object.fromEntries(Array.from({ length: 39 }, (_, i) => [`0:${i + 2}`, { status: 'unanswered' }])) } } }];
    window.dispatchEvent(new Event('examAnswersSubmitted'));
    window.navigateLearningWorkspace('openRoleContent:student-today');
  });
  await expect(shell.locator('.pc-today-progress')).toHaveText('诊断待完善');
  await expect(shell.locator('.pc-selfstudy-start')).toContainText('继续诊断');
  await shell.locator('.pc-selfstudy-start').click();
  await expect(shell).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.examViewer.userAnswers['0:1'])).toBe(1);
  expect(await page.evaluate(() => window.examViewer.currentQuestionIndex)).toBe(1);
});

test('初步诊断后的每日计划完成一个领域后可继续其他领域直到全部完成', async ({ page }) => {
  const shell = await openAuditHome(page);
  await page.evaluate(() => {
    const domains = ['vocabulary', 'reading', 'grammar'];
    window.__doneDaily = [];
    window.APIClient.getAdaptiveLearningProfile = async () => ({ exam_target: 'JLPT N2', domains: Object.fromEntries(domains.map(id => [id, { score: id === 'vocabulary' ? 40 : 70, observation_count: 2, correct_count: 1, evidence: 'insufficient' }])) });
    window.APIClient.getDailyPractice = async () => ({ items: domains.map((id, s) => ({ exam_id: 'N2_2020_07', question_id: String(s + 1), section_index: s, section_type: id, source: 'recommended' })), completed_question_ids: window.__doneDaily });
    window.APIClient.completeDailyPracticeItem = async (id, exam) => window.__doneDaily.push(`${exam}\u001f${id}`);
    window.APIClient.getExam = async () => ({ family: 'jlpt', exam_info: { exam_level: 'N2', sections: domains.map((type, s) => ({ section_type: type, section_name: type, questions: [{ id: s + 1, question: `计划审查${s + 1}`, options: ['对', '错'], correct_answer: 1 }] })) } });
    window.dispatchEvent(new Event('examAnswersSubmitted'));
    window.navigateLearningWorkspace('openRoleContent:student-today');
  });
  await expect(shell.locator('.pc-today-progress')).toHaveText('今日未开始 · 3题');
  for (let count = 1; count <= 3; count++) {
    await shell.locator('.pc-selfstudy-start').click();
    await expect(shell).toBeHidden();
    await page.locator('[data-option-index="1"]').click();
    await page.locator('.task-nav .exit-specialty-btn').click();
    await expect(page.locator('[data-specialty-save]')).toContainText('已保存本次结果');
    await page.locator('[data-specialty-home]').click();
    await expect(shell.locator('.pc-today-progress')).toHaveText(count < 3 ? `今日已完成 ${count}/3题` : '今日已完成 · 3题');
  }
  await expect(shell.locator('.pc-selfstudy-start')).toContainText('自由练习');
});

test('交卷后切换到新练习不复用已提交标识，也不冲刷上一场答案', async ({ page }) => {
  await openAuditHome(page);
  await page.evaluate(async () => {
    const v = window.examViewer;
    window.__savedDrafts = [];
    window.APIClient.saveDraft = async (_user, draft) => { window.__savedDrafts.push(draft); return { revision: 1 }; };
    window.APIClient.submitAnswers = async (_u, _e, _a, _s, attempt) => { window.__oldAttempt = attempt; return { total_questions: 3, correct_count: 1, unanswered_count: 2, accuracy: 100, completion: 33, score: 1 }; };
    window.APIClient.clearDraft = async () => {};
    v._currentExamId = 'N2_2020_07'; v.loadExamData(await window.APIClient.getExam('N2_2020_07'));
    v.answerManager.setAnswerComposite(0, '1', 1);
    await v.answerManager.flushCurrentDraft();
    await v.answerManager.submitAnswers();
    await v.startWholePaperPractice('N2_2019_07', '另一套', { fresh: true, returnContext: { surface: 'paper' } });
    window.__draftsAfterTransition = window.__savedDrafts.length;
    v.specialtyPractice = null;
    v._currentExamId = 'N2_2018_07'; v.loadExamData(await window.APIClient.getExam('N2_2018_07'));
    v.answerManager.setAnswerComposite(0, '2', 1);
    await v.answerManager.flushCurrentDraft();
  });
  const state = await page.evaluate(() => ({ attempts: window.__savedDrafts.map(d => d.attempt_id), old: window.__oldAttempt, transition: window.__draftsAfterTransition }));
  expect(state.transition).toBe(1);
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[1]).not.toBe(state.old);
});

test('云草稿按试卷隔离，提交诊断不删除另一套进度，未完成诊断被拒绝', async ({ request }) => {
  const user = await loginApi(request, uniqueLoginId('draft_isolation'));
  const id = user.user_id || user.id;
  const headers = { Authorization: `Bearer ${user.token}` };
  const draftUrl = `/api/v1/drafts/${id}`;
  for (const [exam, attempt] of [['N3_2010_07', 'paper-a'], ['N3_DIAGNOSTIC_V1', 'diagnostic-b']]) {
    const saved = await request.post(draftUrl, { headers, data: { exam_id: exam, attempt_id: attempt, answers: { '0:1': 1 }, base_revision: 0 } });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
  const incomplete = await request.post('/api/v1/answers/submit', { headers, data: { user_id: id, exam_id: 'N3_DIAGNOSTIC_V1', answers: { '0:1': 1 }, attempt_id: 'diagnostic-b', submission_id: 'partial' } });
  expect(incomplete.status()).toBe(422);
  expect((await incomplete.json()).code).toBe('DIAGNOSTIC_INCOMPLETE');
  const exam = (await (await request.get('/api/v1/exams/N3_DIAGNOSTIC_V1', { headers })).json()).data;
  const answers = Object.fromEntries(exam.exam_info.sections.flatMap((section, s) => (section.questions?.length ? section.questions : (section.passages || []).flatMap(p => p.questions || [])).map(q => [`${s}:${q.id}`, q.correct_answer || q.answer || 1])));
  const submitted = await request.post('/api/v1/answers/submit', { headers, data: { user_id: id, exam_id: 'N3_DIAGNOSTIC_V1', answers, attempt_id: 'diagnostic-b', submission_id: 'complete' } });
  expect(submitted.ok(), await submitted.text()).toBe(true);
  const kept = (await (await request.get(`${draftUrl}?exam_id=N3_2010_07`, { headers })).json()).data;
  expect(kept.answers['0:1']).toBe(1);
  await request.delete(`${draftUrl}?exam_id=N3_DIAGNOSTIC_V1&attempt_id=diagnostic-b`, { headers });
  expect((await (await request.get(`${draftUrl}?exam_id=N3_2010_07`, { headers })).json()).data.answers['0:1']).toBe(1);
});

test('专项和题组的独立作答进入画像与错题，查看和重复提交不增加证据', async ({ request }) => {
  const user = await loginApi(request, uniqueLoginId('learning_hooks'));
  const id = user.user_id || user.id;
  const headers = { Authorization: `Bearer ${user.token}` };
  const exam = (await (await request.get('/api/v1/exams/N3_2010_07', { headers })).json()).data;
  const section = exam.exam_info.sections[0];
  const questions = section.questions?.length ? section.questions : section.passages.flatMap(p => p.questions || []);
  const correct = q => q.correct_answer || q.answer;
  const payload = { label: '系统训练', learning_origin: 'system', submission_id: 'hooks-specialty', questions: questions.slice(0, 3).map((q, n) => ({ exam_id: 'N3_2010_07', question_id: String(q.id), section_index: 0, answer: n === 1 ? Number(correct(q)) % 4 + 1 : correct(q), viewed: n === 2 })) };
  for (let n = 0; n < 2; n++) {
    const response = await request.post('/api/v1/answers/specialty-session', { headers, data: payload });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const profile = async () => (await (await request.get('/api/v1/me/adaptive-learning?exam_target=JLPT%20N3', { headers })).json()).data;
  expect((await profile()).domains.vocabulary.observation_count).toBe(2);
  const wrong = (await (await request.get(`/api/v1/wrong-questions/${id}`, { headers })).json()).data;
  expect(wrong.items.some(q => q.exam_id === 'N3_2010_07' && String(q.question_id).split(':').pop() === String(questions[1].id))).toBe(true);
  const cards = (await (await request.get(`/api/v1/srs/${id}/cards`, { headers })).json()).data.items;
  expect(cards).toHaveLength(1);
  const grouped = { exam_id: 'N3_2010_07', label: '按题组练习', submission_id: 'hooks-group', section_indexes: [0], answers: { [`0:${questions[2].id}`]: correct(questions[2]) } };
  for (let n = 0; n < 2; n++) expect((await request.post('/api/v1/answers/practice-group', { headers, data: grouped })).ok()).toBe(true);
  expect((await profile()).domains.vocabulary.observation_count).toBe(3);
});
