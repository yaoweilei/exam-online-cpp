const { test, expect } = require('@playwright/test');
const { loginApi, loginWithPassword, uniqueLoginId } = require('./helpers/session');

const flatten = paper => paper.exam_info.sections.flatMap((s, section) =>
  (s.questions?.length ? s.questions : (s.passages || []).flatMap(p => p.questions || [])).map(q => ({ q, section })));
const correct = q => q.correct_answer ?? q.answer;
const wrong = q => Number(correct(q)) % 4 + 1;
async function actor(request, prefix) {
  const user = await loginApi(request, uniqueLoginId(prefix));
  const id = user.user_id || user.id, headers = { Authorization: `Bearer ${user.token}` };
  const get = async url => (await (await request.get(url, { headers })).json()).data;
  const post = async (url, data) => request.post(url, { headers, data });
  return { id, headers, get, post };
}
const dailyUrl = minutes => `/api/v1/me/daily-practice?count=50&minutes=${minutes}&target=JLPT%20N3`;
const key = item => `${item.exam_id}\u001f${item.section_index}:${item.question_id}`;

test('EJU诊断只含38道可作答客观题；相同会话并发提交只增加一次证据', async ({ request }) => {
  const a = await actor(request, 'round2_diagnostic');
  const paper = await a.get('/api/v1/exams/EJU_JAPANESE_DIAGNOSTIC_V1');
  const questions = flatten(paper);
  expect(questions).toHaveLength(38);
  expect(paper.exam_info.title).toContain('（38题）');
  expect(paper.exam_info.sections[0].diagnostic_excluded).toBe(true);
  expect(questions.every(({ q }) => q.options?.length && correct(q) != null && q.has_ans !== false)).toBe(true);
  const payload = { user_id: a.id, exam_id: 'EJU_JAPANESE_DIAGNOSTIC_V1', attempt_id: 'shared-diagnostic', answers: Object.fromEntries(questions.map(({ q, section }) => [`${section}:${q.id}`, correct(q)])) };
  const partial = await a.post('/api/v1/answers/submit', { ...payload, answers: {}, submission_id: 'partial' });
  expect(partial.status()).toBe(422);
  const responses = await Promise.all(['page-a', 'page-b'].map(submission_id => a.post('/api/v1/answers/submit', { ...payload, submission_id })));
  const results = await Promise.all(responses.map(async r => { expect(r.ok(), await r.text()).toBe(true); return (await r.json()).data; }));
  expect(results.filter(r => r.idempotent_replay)).toHaveLength(1);
  expect(results[0].diagnostic_answered_count).toBe(38);
  expect(results[0].total_questions).toBe(38);
  const profile = await a.get('/api/v1/me/adaptive-learning?exam_target=EJU%20%E6%97%A5%E6%9C%AC%E8%AA%9E');
  expect(Object.values(profile.domains).reduce((n, d) => n + (d.observation_count || 0), 0)).toBe(38);
});

test('错题自动进入已有今日计划，调整时间和重新生成都保留完成记录', async ({ request }) => {
  const a = await actor(request, 'round2_reviews');
  await a.get(dailyUrl(20));
  const paper = await a.get('/api/v1/exams/N3_2010_07');
  const { q, section } = flatten(paper)[0];
  const saved = await a.post('/api/v1/answers/specialty-session', { label: '系统训练', learning_origin: 'system', submission_id: 'wrong-once', questions: [{ exam_id: 'N3_2010_07', question_id: String(q.id), section_index: section, answer: wrong(q), viewed: false }] });
  expect(saved.ok(), await saved.text()).toBe(true);
  const plan = await a.get(dailyUrl(20));
  const review = plan.items.find(i => i.exam_id === 'N3_2010_07' && i.question_id === String(q.id) && i.section_index === section && i.source === 'srs_due');
  expect(review).toBeTruthy();
  await a.post('/api/v1/me/daily-practice/complete', { exam_id: review.exam_id, question_id: `${review.section_index}:${review.question_id}`, target: 'JLPT N3' });
  const changed = await a.get(dailyUrl(30));
  expect(changed.completed_question_ids).toContain(key(review));
  expect(changed.items.some(i => key(i) === key(review))).toBe(true);
  const regenerated = await a.post('/api/v1/me/daily-practice/regenerate', { count: 50, minutes: 20, target: 'JLPT N3' });
  expect((await regenerated.json()).data.completed_question_ids).toContain(key(review));
});

test('完成新诊断后重排未开始任务，保留成果并覆盖薄弱听力', async ({ request }) => {
  const a = await actor(request, 'round2_focus');
  const before = await a.get(dailyUrl(20));
  const done = before.items[0];
  await a.post('/api/v1/me/daily-practice/complete', { exam_id: done.exam_id, question_id: `${done.section_index}:${done.question_id}`, target: 'JLPT N3' });
  const paper = await a.get('/api/v1/exams/N3_DIAGNOSTIC_V1');
  const answers = Object.fromEntries(flatten(paper).map(({ q, section }) => [`${section}:${q.id}`, paper.exam_info.sections[section].section_type === 'listening' ? wrong(q) : correct(q)]));
  const response = await a.post('/api/v1/answers/submit', { user_id: a.id, exam_id: 'N3_DIAGNOSTIC_V1', answers, attempt_id: 'new-baseline', submission_id: 'new-baseline' });
  expect(response.ok(), await response.text()).toBe(true);
  const after = await a.get(dailyUrl(20));
  expect(after.diagnostic_version).not.toBe(before.diagnostic_version);
  expect(after.completed_question_ids).toContain(key(done));
  expect(after.items.some(i => i.section_type === 'listening' && i.source === 'recommended')).toBe(true);
  expect(after.planned_minutes).toBeLessThanOrEqual(20);
});

test('练习云草稿保留完整会话；结束后旧页面不能重新创建已结束进度', async ({ request }) => {
  const a = await actor(request, 'round2_session');
  const draft = { submission: 'cloud-session', ownerId: a.id, mode: 'unanswered', session: { label: '专项', index: 1, questions: ['1', '2'].map(questionId => ({ examId: 'N3_2010_07', questionId, sectionIndex: 0 })) }, returnContext: { surface: 'chapter' }, answers: [['N3_2010_07', { answers: { '0:1': 1 }, checked: [] }]], outcomes: [], revealed: ['N3_2010_07:0:1'], updatedAt: Date.now() };
  const url = `/api/v1/practice-drafts/${a.id}`;
  const save = await a.post(url, { session_draft: draft, base_revision: 0 });
  expect(save.ok(), await save.text()).toBe(true);
  expect((await a.get(url)).items[0].session_draft).toEqual(draft);
  expect((await a.post(url, { session_draft: draft, base_revision: 0 })).ok()).toBe(true);
  const conflict = await a.post(url, { session_draft: { ...draft, updatedAt: Date.now() + 1, answers: [] }, base_revision: 0 });
  expect(conflict.status()).toBe(409);
  const end = await a.post('/api/v1/answers/specialty-session', { label: '专项', submission_id: draft.submission, questions: [{ exam_id: 'N3_2010_07', question_id: '1', section_index: 0, answer: 1, viewed: false }] });
  expect(end.ok(), await end.text()).toBe(true);
  expect((await a.get(url)).items).toHaveLength(0);
  const late = await a.post(url, { session_draft: draft, base_revision: 1 });
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe('ATTEMPT_SUBMITTED');
});

test('整套练习在第二个浏览器恢复确认状态、选择和当前位置', async ({ page, browser }, info) => {
  const username = uniqueLoginId('round2_cloud_ui');
  await loginWithPassword(page, username);
  await page.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
  await page.locator('#student-learning-home').getByRole('button', { name: '真题模式 按试卷练' }).click();
  await page.locator('[data-paper-exam]').selectOption('JLPT-N3');
  const entry = page.locator('[data-paper-open]').first(), examId = await entry.getAttribute('data-paper-open');
  await entry.click();
  await page.locator('[data-option-index="1"]').first().click();
  await page.locator('.specialty-confirm-answer').click();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.locator('[data-option-index="2"]').first().click();
  await page.getByRole('button', { name: '返回学习首页', exact: true }).click();
  await page.evaluate(() => window.examViewer.flushPracticeDrafts());
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:8081', viewport: { width: 1440, height: 1100 } });
  try {
    const other = await ctx.newPage(); await loginWithPassword(other, username);
    await other.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
    await expect.poll(() => other.evaluate(id => window.examViewer.getWholePaperProgress(id)?.answered, examId)).toBe(2);
    await other.locator('#student-learning-home').getByRole('button', { name: '真题模式 按试卷练' }).click();
    await other.locator('[data-paper-exam]').selectOption('JLPT-N3');
    await other.locator(`[data-paper-open="${examId}"]`).click();
    await expect(other.locator('.task-nav .question-counter')).toHaveText(/2 \/ /);
    expect(await other.evaluate(() => window.examViewer.showAnswers)).toBe(false);
    await other.getByRole('button', { name: '上一题', exact: true }).click();
    expect(await other.evaluate(() => window.examViewer.showAnswers)).toBe(true);
    expect(await other.evaluate(() => window.examViewer.canAnswerSpecialtyQuestion())).toBe(false);
    await other.screenshot({ path: info.outputPath('cloud-restored-confirmed.png') });
    await other.getByRole('button', { name: '结束练习', exact: true }).click();
    await expect(other.locator('[data-specialty-save]')).toContainText('已保存本次结果');
    await other.locator('[data-specialty-home]').click();
    await other.reload({ waitUntil: 'domcontentloaded' });
    await other.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
    await other.waitForLoadState('networkidle');
    expect(await other.evaluate(id => window.examViewer.getWholePaperProgress(id), examId)).toBeNull();
  } finally { await ctx.close(); }
});

test('真实EJU入口从读解开始，题卡不包含无效项目', async ({ page }, info) => {
  await loginWithPassword(page, uniqueLoginId('round2_eju_ui'));
  await page.evaluate(async () => { await window.APIClient.createStudyGoal({ title: 'EJU 日本語备考', exam_target: 'EJU 日本語', target_date: '2026-11-08', daily_minutes: 20 }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
  const home = page.locator('#student-learning-home');
  await expect(home.locator('.pc-selfstudy-start')).toContainText('开始诊断');
  await expect(home).toContainText('38 题');
  await home.locator('.pc-selfstudy-start').click();
  await expect(page.locator('#submit-exam')).toHaveText('提交诊断');
  await expect(page.locator('[data-option-index="1"]').first()).toBeVisible();
  await expect(page.locator('.task-nav .question-counter')).toHaveText('1 / 38');
  await page.locator('.task-nav .question-counter').click();
  await expect(page.locator('#question-map-overlay .question-map-item')).toHaveCount(38);
  await page.screenshot({ path: info.outputPath('eju-objective-38.png') });
});

test('EJU不同题型的错题分别进入复习计划', async ({ request }) => {
  const a = await actor(request, 'round2_eju_identity');
  const paper = await a.get('/api/v1/exams/2024_01');
  const rows = flatten(paper).filter(({ q }) => q.options?.length && correct(q) != null);
  const first = rows[0];
  expect(first).toBeTruthy();
  const other = rows.find(row => row.section !== first.section);
  const saved = await a.post('/api/v1/answers/specialty-session', { label: 'EJU分题型复习', learning_origin: 'system', submission_id: 'same-number', questions: [first, other].map(({ q, section }) => ({ exam_id: '2024_01', question_id: String(q.id), section_index: section, answer: wrong(q), viewed: false })) });
  expect(saved.ok(), await saved.text()).toBe(true);
  const plan = await a.get('/api/v1/me/daily-practice?count=50&minutes=30&target=EJU%20%E6%97%A5%E6%9C%AC%E8%AA%9E');
  for (const row of [first, other]) expect(plan.items.some(item => item.exam_id === '2024_01' && item.question_id === String(row.q.id) && item.section_index === row.section && item.source === 'srs_due')).toBe(true);
});

test('真实今日复习卡可查看评分；调整目标时间后仍显示已完成', async ({ page }, info) => {
  await loginWithPassword(page, uniqueLoginId('round2_srs_ui'));
  await page.evaluate(async () => {
    const api = window.APIClient;
    await api.createStudyGoal({ title: 'JLPT N3备考', exam_target: 'JLPT N3', target_date: '2026-12-06', daily_minutes: 20 });
    const diagnostic = await api.getExam('N3_DIAGNOSTIC_V1');
    const answers = Object.fromEntries(diagnostic.exam_info.sections.flatMap((s, index) => (s.questions?.length ? s.questions : (s.passages || []).flatMap(p => p.questions || [])).map(q => [`${index}:${q.id}`, q.correct_answer ?? q.answer])));
    const user = window.examViewer.userId;
    const submit = await fetch('/api/v1/answers/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user, exam_id: 'N3_DIAGNOSTIC_V1', answers, attempt_id: 'baseline', submission_id: 'baseline' }) });
    if (!submit.ok) throw new Error(await submit.text());
    const paper = await api.getExam('N3_2010_07'), section = paper.exam_info.sections[0];
    const q = (section.questions?.length ? section.questions : section.passages.flatMap(p => p.questions || []))[0];
    await api.saveSpecialtySession({ label: '专项练习', submission_id: 'first-wrong', questions: [{ exam_id: 'N3_2010_07', question_id: String(q.id), section_index: 0, answer: Number(q.correct_answer ?? q.answer) % 4 + 1, viewed: false }] });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
  const home = page.locator('#student-learning-home');
  await expect(home.locator('.pc-selfstudy-steps')).toContainText('到期复习');
  await home.locator('.pc-selfstudy-start').click();
  const srs = page.locator('#srs-modal');
  await expect(srs).toContainText('包んで');
  await srs.getByText('查看答案与解析', { exact: true }).click();
  await srs.getByRole('button', { name: '良好', exact: true }).click();
  await expect(srs).toContainText('本次计划复习已完成');
  await page.getByRole('button', { name: '返回学习首页', exact: true }).click();
  await expect(home.locator('.pc-today-progress')).toContainText('今日已完成 1/');
  await home.getByRole('button', { name: '调整', exact: true }).click();
  await page.locator('#sg-minutes').selectOption('30');
  await page.locator('#sg-form button[type="submit"]').click();
  await expect(home.locator('.pc-selfstudy-goal')).toContainText('每天 30 分钟');
  await expect(home.locator('.pc-today-progress')).toContainText('今日已完成 1/');
  await page.screenshot({ path: info.outputPath('srs-completed-after-goal-change.png') });
});

test('阅读和听力复习卡保留原材料与可读取音频', async ({ page }, info) => {
  await loginWithPassword(page, uniqueLoginId('round2_materials'));
  await page.evaluate(async () => {
    const api = window.APIClient;
    await api.createStudyGoal({ title: 'JLPT N3备考', exam_target: 'JLPT N3', target_date: '2026-12-06', daily_minutes: 30 });
    const diagnostic = await api.getExam('N3_DIAGNOSTIC_V1');
    const flatten = paper => paper.exam_info.sections.flatMap((s, section) => (s.questions?.length ? s.questions : (s.passages || []).flatMap(p => p.questions || [])).map(q => ({ q, section })));
    const answers = Object.fromEntries(flatten(diagnostic).map(({ q, section }) => [`${section}:${q.id}`, q.correct_answer ?? q.answer]));
    const response = await fetch('/api/v1/answers/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: window.examViewer.userId, exam_id: 'N3_DIAGNOSTIC_V1', answers, attempt_id: 'baseline', submission_id: 'baseline' }) });
    if (!response.ok) throw new Error(await response.text());
    const paper = await api.getExam('N3_2010_07'), rows = flatten(paper);
    const selected = ['reading', 'listening'].map(type => rows.find(row => paper.exam_info.sections[row.section].section_type === type && (row.q.correct_answer ?? row.q.answer) != null));
    await api.saveSpecialtySession({ label: '材料复习', submission_id: 'materials', questions: selected.map(({ q, section }) => ({ exam_id: 'N3_2010_07', question_id: String(q.id), section_index: section, answer: Number(q.correct_answer ?? q.answer) % 4 + 1, viewed: false })) });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#ls-menu').getByRole('button', { name: '学习首页', exact: true }).click();
  await page.locator('#student-learning-home [data-role-admin-intent="openSrsReview"]').first().click();
  const srs = page.locator('#srs-modal');
  let sawReading = false, sawListening = false;
  for (let n = 0; n < 2; n++) {
    await expect(srs.locator('.pc-srs-card')).toBeVisible();
    const cardId = await srs.locator('#srs-body').getAttribute('data-card-id');
    if (await srs.locator('audio').count()) {
      sawListening = true;
      const response = await page.request.get(await srs.locator('audio').getAttribute('src'), { headers: { Range: 'bytes=0-63' }, timeout: 10000 });
      expect(response.ok()).toBe(true);
    } else {
      sawReading = true;
      await expect(srs.locator('.pc-srs-material')).not.toHaveText('');
    }
    await page.screenshot({ path: info.outputPath(`review-material-${n}.png`) });
    await srs.getByText('查看答案与解析', { exact: true }).click();
    await srs.getByRole('button', { name: '良好', exact: true }).click();
    if (n === 0) await expect.poll(() => srs.locator('#srs-body').getAttribute('data-card-id')).not.toBe(cardId);
  }
  expect([sawReading, sawListening]).toEqual([true, true]);
  await expect(srs).toContainText('本次计划复习已完成');
});
