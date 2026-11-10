const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');

async function login(page, username = uniqueLoginId('round3_fixed')) {
  await loginApi(page.request, username);
  const context = (await (await page.request.get('/api/v1/me/context')).json()).data;
  await page.addInitScript(user => {
    localStorage.setItem('exam_v2_user', JSON.stringify(user));
    localStorage.removeItem('exam_v2_token');
  }, { ...context.user, guest: false, token: '', profile: context.profile, membership: context.membership, permissions: context.permissions, subscription: context.subscription });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ls-menu')).toBeVisible();
}
async function seed(page, minutes = 20, backlog = 1) {
  await login(page);
  return page.evaluate(async ({ minutes, backlog }) => {
    const api = window.APIClient, id = window.examViewer.userId;
    await api.createStudyGoal({ title: 'JLPT N3备考', exam_target: 'JLPT N3', target_date: '2026-12-06', daily_minutes: minutes });
    const flatten = paper => paper.exam_info.sections.flatMap((s, section) => (s.questions?.length ? s.questions : (s.passages || []).flatMap(p => p.questions || [])).map(q => ({ q, section })));
    const diagnostic = await api.getExam('N3_DIAGNOSTIC_V1');
    const answers = Object.fromEntries(flatten(diagnostic).map(({ q, section }) => [`${section}:${q.id}`, q.correct_answer ?? q.answer]));
    const response = await fetch('/api/v1/answers/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id, exam_id: 'N3_DIAGNOSTIC_V1', answers, attempt_id: 'baseline', submission_id: 'baseline' }) });
    if (!response.ok) throw new Error(await response.text());
    const selected = flatten(await api.getExam('N3_2010_07')).filter(({ q }) => (q.correct_answer ?? q.answer) != null).slice(0, backlog);
    await api.saveSpecialtySession({ label: '专项练习', submission_id: 'wrong', questions: selected.map(({ q, section }) => ({ exam_id: 'N3_2010_07', question_id: String(q.id), section_index: section, answer: Number(q.correct_answer ?? q.answer) % 4 + 1, viewed: false })) });
    return { id, q: selected[0].q };
  }, { minutes, backlog });
}
async function home(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
  await expect(page.locator('#student-learning-home .pc-today-progress')).not.toContainText('正在读取');
  await page.waitForLoadState('networkidle');
  return page.locator('#student-learning-home');
}
async function review(page, panel) {
  await panel.locator('[data-role-admin-intent="openSrsReview"]').first().click();
  const srs = page.locator('#srs-modal');
  await expect(srs.locator('.pc-srs-card')).toBeVisible();
  await srs.getByText('查看答案与解析', { exact: true }).click();
  return srs;
}

test('目标30分钟实际生成30分钟；改为10分钟后题单同步且保留完成记录', async ({ page }) => {
  await seed(page, 30);
  const budgets = [];
  page.on('response', async response => {
    if (response.ok() && response.url().includes('/me/daily-practice?') && new URL(response.url()).searchParams.get('target') === 'JLPT N3') budgets.push((await response.json()).data.daily_minutes);
  });
  const panel = await home(page);
  await expect.poll(() => budgets.at(-1)).toBe(30);
  const plan = await page.evaluate(() => window.APIClient.getDailyPractice(50, 30, 'JLPT N3'));
  const item = plan.items[0];
  await page.evaluate(async item => {
    await window.APIClient.completeDailyPracticeItem(`${item.section_index}:${item.question_id}`, item.exam_id, 'JLPT N3');
    window.dispatchEvent(new Event('examAnswersSubmitted'));
  }, item);
  await expect(panel.locator('.pc-today-progress')).toContainText('今日已完成 1/');
  await panel.getByRole('button', { name: '调整', exact: true }).click();
  await page.locator('#sg-minutes').selectOption('10');
  await page.locator('#sg-form button[type="submit"]').click();
  await expect(panel.locator('.pc-selfstudy-goal')).toContainText('每天 10 分钟');
  await expect.poll(() => budgets.at(-1)).toBe(10);
  await expect(panel.locator('.pc-today-progress')).toContainText('今日已完成 1/');
});

test('评分成功但进度保存失败，保留当前题；重试只补存进度', async ({ page }, info) => {
  await seed(page);
  const panel = await home(page), srs = await review(page, panel);
  let scores = 0;
  page.on('request', req => { if (/\/srs\/[^/]+\/review$/.test(req.url())) scores++; });
  await page.route('**/api/v1/me/daily-practice/complete', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"OFFLINE","message":"进度保存中断"}' }));
  await srs.getByRole('button', { name: '良好', exact: true }).click();
  await expect(srs.getByRole('alert')).toContainText('评分已保存，今日进度尚未保存');
  await expect(srs.getByRole('alert')).toBeVisible();
  await page.screenshot({ path: info.outputPath('pending-progress-retry.png') });
  await expect(srs).not.toContainText('本次计划复习已完成');
  await srs.getByText('查看答案与解析', { exact: true }).click();
  await srs.getByText('查看答案与解析', { exact: true }).click();
  await expect(srs.getByRole('button', { name: '良好', exact: true })).not.toBeVisible();
  await page.unroute('**/api/v1/me/daily-practice/complete');
  await srs.getByRole('button', { name: '重试保存进度', exact: true }).click();
  await expect(srs).toContainText('本次计划复习已完成');
  expect(scores).toBe(1);
  await page.getByRole('button', { name: '返回学习首页', exact: true }).click();
  await expect(panel.locator('.pc-today-progress')).toContainText('今日已完成 1/');
});

test('未保存的复习进度刷新后保留；首页重试补存且不再次评分', async ({ page }) => {
  await seed(page);
  const panel = await home(page), srs = await review(page, panel);
  let scores = 0;
  page.on('request', req => { if (/\/srs\/[^/]+\/review$/.test(req.url())) scores++; });
  await page.route('**/api/v1/me/daily-practice/complete', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"OFFLINE","message":"保存失败"}' }));
  await srs.getByRole('button', { name: '良好', exact: true }).click();
  await expect(srs.getByRole('alert')).toContainText('评分已保存');
  await home(page);
  await expect(panel.getByRole('alert')).toContainText('今日进度同步失败');
  await expect(panel.locator('.pc-today-progress')).toContainText('今日进度暂不可用');
  await page.unroute('**/api/v1/me/daily-practice/complete');
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel.locator('.pc-today-progress')).toContainText('今日已完成 1/');
  expect(scores).toBe(1);
});

test('同一订正并发重试只算一次；新作答可继续累计，改答案复用标识被拒绝', async ({ request }) => {
  const user = await loginApi(request, uniqueLoginId('round3_idempotence'));
  const id = user.id || user.user_id, headers = { Authorization: `Bearer ${user.token}` };
  const saved = await request.post('/api/v1/answers/specialty-session', { headers, data: { label: '专项', submission_id: 'wrong', questions: [{ exam_id: 'N3_2010_07', question_id: '1', section_index: 0, answer: 2, viewed: false }] } });
  expect(saved.ok()).toBe(true);
  const url = `/api/v1/wrong-questions/${id}/0%3A1/correction`;
  const payload = { exam_id: 'N3_2010_07', actual_question_id: '1', section_index: 0, answer: 1, exam_target: 'JLPT N3', submission_id: 'answer-once' };
  const results = await Promise.all([1, 2].map(async () => {
    const response = await request.post(url, { headers, data: payload }); expect(response.ok()).toBe(true); return (await response.json()).data;
  }));
  expect(results.map(r => r.correct_streak)).toEqual([1, 1]);
  expect(results.filter(r => r.idempotent_replay)).toHaveLength(1);
  expect(results.every(r => !r.mastered)).toBe(true);
  const conflict = await request.post(url, { headers, data: { ...payload, answer: 2 } });
  expect(conflict.status()).toBe(409);
  const next = await request.post(url, { headers, data: { ...payload, submission_id: 'independent-answer' } });
  expect((await next.json()).data.mastered).toBe(true);
  const original = await request.post(url, { headers, data: payload });
  expect((await original.json()).data.correct_streak).toBe(1);
});

test('订正保存后响应丢失，页面重试不会提前标记掌握', async ({ page }, info) => {
  const { id, q } = await seed(page);
  await page.evaluate(async id => {
    const paper = await window.APIClient.getExam('N3_2010_07'), viewer = window.examViewer;
    window.closeLearningWorkspace();
    viewer._currentExamId = 'N3_2010_07'; viewer.examMode = 'practice';
    viewer.beginWrongQuestionCorrection({ userId: id, examId: 'N3_2010_07', questionId: '0:1', actualQuestionId: '1', sectionIndex: 0, questionIndex: 0, examTarget: 'JLPT N3', position: 1, total: 1, hasNext: false });
    viewer.loadExamData(paper); viewer.jumpToQuestion(0, 0);
  }, id);
  let requests = 0;
  const payloads = [];
  await page.route('**/api/v1/wrong-questions/*/*/correction', async route => {
    payloads.push(route.request().postDataJSON());
    if (++requests === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); }
    else await route.continue();
  });
  await page.locator(`[data-option-index="${q.correct_answer ?? q.answer}"]`).first().click();
  const submit = page.locator('[data-correction-action="submit"]');
  await submit.click(); await expect.poll(() => requests).toBe(1); await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('#wrong-correction-bar')).toContainText('订正正确');
  const state = await page.evaluate(id => window.APIClient.getWrongQuestions(id, { status: 'all' }), id);
  expect(state.items[0].correct_streak).toBe(1);
  expect(state.items[0].mastered).toBe(false);
  expect(payloads[0].submission_id).toBeTruthy();
  expect(payloads[1].submission_id).toBe(payloads[0].submission_id);
  await page.screenshot({ path: info.outputPath('correction-retry-once.png') });
});

test('完成计划内8道复习后仍剩到期题，提示只称本次计划完成', async ({ page }, info) => {
  test.setTimeout(240000);
  const { id } = await seed(page, 20, 16);
  const panel = await home(page);
  await panel.locator('[data-role-admin-intent="openSrsReview"]').first().click();
  const srs = page.locator('#srs-modal');
  await expect(srs.locator('.pc-srs-card')).toBeVisible();
  let graded = 0;
  for (; graded < 10; graded++) {
    if (!(await srs.locator('.pc-srs-card').count())) break;
    const card = await srs.locator('#srs-body').getAttribute('data-card-id');
    await srs.getByText('查看答案与解析', { exact: true }).click();
    await srs.getByRole('button', { name: '良好', exact: true }).click();
    await expect.poll(() => srs.locator('#srs-body').getAttribute('data-card-id'), { timeout: 45000 }).not.toBe(card);
  }
  expect(graded).toBe(8);
  await expect(srs).toContainText('本次计划复习已完成');
  expect((await page.evaluate(id => window.APIClient.listSrsDue(id, 100), id)).items).toHaveLength(8);
  await page.screenshot({ path: info.outputPath('planned-review-complete.png') });
});
