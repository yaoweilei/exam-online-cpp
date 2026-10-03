const { test, expect } = require('@playwright/test');
const { loginWithPassword } = require('./helpers/session');

async function setGoalDate(page, value) {
  await page.locator('#sg-date').evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function openHome(page, scenario = 'ready') {
  await loginWithPassword(page, 'student_demo');
  await page.evaluate((scenario) => {
    const api = window.APIClient;
    const question = (exam_id, question_id, source, section_type = '') => ({
      exam_id, question_id, source, section_type,
      ...(source === 'srs_due' ? { card_id: `${exam_id}:${question_id}` } : {})
    });
    api.listStudyGoals = async () => ({ items: [{ goal_id: 'goal_test_n2', title: 'N2备考', exam_target: 'JLPT N2', target_date: '2099-12-01', daily_question_target: 12 }] });
    api.listRecentLearning = async () => ({ items: scenario === 'empty' ? [] : [
      { exam_id: 'N2_2024_07', status: 'submitted', answered_count: 20, total_questions: 20 },
      ...(['completed', 'diagnostic', 'observing', 'weak', 'debt', 'phase_shift', 'today_complete'].includes(scenario) ? [] : [{ exam_id: 'N2_2025_07', status: 'draft', answered_count: scenario === 'ready' ? 2 : 1, total_questions: 2, last_section_index: 2, last_question_index: 1 }])
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
      if (scenario === 'empty') return { items: [], completed_question_ids: [] };
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
    api.getAdaptiveLearningProfile = async () => ['empty', 'completed'].includes(scenario) ? null : ({
      exam_target: 'JLPT N2', available_targets: ['JLPT N2'],
      updated_at: scenario === 'stale' ? '2026-01-01T10:00:00Z' : '2026-09-18T10:00:00Z',
      model_version: 'mastery-v0.1', daily_minutes: 20, knowledge_target: 5,
      weak_knowledge: [{}, {}, {}, {}, {}],
      domains: {
		vocabulary: { score: scenario === 'diagnostic' ? 50 : 68, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 1 : 7, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		grammar: { score: scenario === 'diagnostic' ? 100 : 74, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 2 : 8, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		reading: { score: scenario === 'diagnostic' ? 0 : scenario === 'phase_shift' ? 55 : 52, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 0 : 5, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 },
		listening: { score: scenario === 'diagnostic' ? 50 : scenario === 'phase_shift' ? 35 : 61, observation_count: scenario === 'diagnostic' ? 2 : 10, correct_count: scenario === 'diagnostic' ? 1 : 6, evidence: ['observing', 'diagnostic'].includes(scenario) ? 'insufficient' : 'sufficient', learning_days: 3, material_count: 3 }
      }
    });
    api.getAnswerAttempts = async () => scenario === 'diagnostic' ? [{ statistics: { results: {
      '0:1': { section_index: 0, status: 'correct' }, '0:2': { section_index: 0, status: 'wrong' },
      '1:3': { section_index: 1, status: 'correct' }, '1:4': { section_index: 1, status: 'correct' },
      '2:5': { section_index: 2, status: 'wrong' }, '2:6': { section_index: 2, status: 'wrong' },
      '3:7': { section_index: 3, status: 'correct' }, '3:8': { section_index: 3, status: 'wrong' }
    } }, saved_at: '2026-09-18T10:00:00Z' }] : [{ statistics: { score: 80, correct_count: 8, wrong_count: 2, unanswered_count: 0 }, saved_at: '2026-09-18T10:00:00Z' }];
    window.openPersonalCenter();
  }, scenario);
  const shell = page.locator('#platform-admin-shell');
  await expect(shell.locator('.pc-goal-summary')).toContainText('JLPT N2 · 剩余');
  await expect(shell.locator('.pc-goal-summary')).toContainText('系统建议每天 20 分钟');
  await expect(shell.locator('.pc-goal-summary')).not.toContainText('mastery-v0.1');
  await expect(shell.locator('section[aria-label="今日计划"]')).not.toContainText('正在生成');
  await expect(shell.locator('.pc-workbench-stage')).toHaveCount(4);
  await expect(shell.locator('.pc-learning-home')).toContainText('01目标');
  await expect(shell.locator('.pc-learning-home')).toContainText('02重点');
  await expect(shell.locator('.pc-learning-home')).toContainText('03今日');
  await expect(shell.locator('.pc-learning-home')).toContainText('04最近');
  return shell;
}

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
    window.dispatchEvent(new CustomEvent('wrongCorrectionSubmitted'));
  });
  const today = shell.getByRole('region', { name: '今日计划' });
  await expect(today).toContainText('错题订正');
  await today.locator('.pc-daily-plan-row').filter({ hasText: '错题订正' }).click();
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
    payload: { exam_id: 'N2_2025_07', actual_question_id: '2', section_index: 0, answer: 1, exam_target: 'JLPT N2' }
  });
  await page.getByRole('button', { name: '返回今日', exact: true }).click();
  await expect(shell).toBeVisible();
  await expect(shell.getByRole('region', { name: '今日计划' })).not.toContainText('错题订正');
});

test('到期复习只读取当前目标，并展示正式题目样式和完整解析', async ({ page }) => {
  const shell = await openHome(page, 'weak');
  await page.evaluate(() => {
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
  });
  await shell.getByRole('region', { name: '今日计划' }).locator('.pc-daily-plan-row').filter({ hasText: '到期复习' }).click();
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
  await expect(review).toContainText('今日到期题目已复习完成');
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
