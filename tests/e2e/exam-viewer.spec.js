const { test, expect } = require('@playwright/test');
const {
	loginApi,
	loginWithPassword,
	stubNoisyPersonalCenterApis,
	uniqueLoginId
} = require('./helpers/session');

async function loadEjuPaper(page, paperId = '2023_02') {
	await page.goto('/', { waitUntil: 'domcontentloaded' });

	const familySelect = page.locator('#exam-family-select');
	const paperSelect = page.locator('#exam-paper-select');

	await expect(familySelect).toContainText('EJU', { timeout: 20000 });
	await familySelect.selectOption('eju');
	await expect(paperSelect).toContainText(paperId, { timeout: 20000 });
	await paperSelect.selectOption(paperId);

	await expect(page.locator('#exam-header')).toContainText(`EJU-Japanese-${paperId}`, { timeout: 20000 });
	await page.waitForFunction(() => {
		const viewer = window.examViewer;
		return Boolean(viewer?.currentExam?.exam_info?.sections?.length);
	});
}

async function selectViewerCategory(page, categoryId) {
	await page.evaluate((id) => {
		window.examViewer?.selectCategory?.(id);
	}, categoryId);
	await page.waitForFunction((id) => window.examViewer?.currentCategory === id, categoryId);
}

test('试卷查看器可以通过 Web 选择 EJU 试卷并打开学习辅助面板', async ({ page }) => {
	await loadEjuPaper(page);

	const questionContainer = page.locator('#current-question-container');
	await expect(questionContainer).not.toContainText('当前章节没有可用的题目');
	await expect(questionContainer).not.toContainText('加载失败');
	await expect(questionContainer).not.toBeEmpty();

  await page.locator('#toggle-answers').click();
  await expect(questionContainer).not.toContainText('加载失败');

  await page.locator('#toggle-explanations').click();
  await expect(questionContainer).not.toContainText('加载失败');

  await page.locator('#toggle-reading-kana').click();
  await page.locator('#toggle-reading-zh').click();
  await expect(questionContainer).not.toContainText('加载失败');

	await page.locator('#open-question-map').click();
	await expect(page.locator('#question-map-overlay')).toBeVisible();
	await expect(page.locator('#question-map-content .question-map-item').first()).toBeVisible();
});

test('EJU 答题卡不显示 Section 小题分组文案', async ({ page }) => {
	await loadEjuPaper(page);

	await page.locator('#open-question-map').click();
	const mapContent = page.locator('#question-map-content');
	await expect(page.locator('#question-map-overlay')).toBeVisible();
	await expect(mapContent.locator('.question-map-item').first()).toBeVisible();
	await expect(mapContent).not.toContainText(/Section/i);

	const sectionLabels = await mapContent.locator('.question-map-section-label').allTextContents();
	expect(sectionLabels.every((text) => !/section/i.test(text))).toBeTruthy();
});

test('EJU 听力类解析不显示原文版式图片块', async ({ page }) => {
	await loadEjuPaper(page);
	const questionContainer = page.locator('#current-question-container');

	for (const categoryId of ['listening_reading', 'listening']) {
		await selectViewerCategory(page, categoryId);
		await page.evaluate(() => {
			window.examViewer?.toggleAnswers?.(true);
		});
		await expect(questionContainer).not.toContainText('加载失败');
		await expect(questionContainer).not.toContainText('原文版式');
		await expect(questionContainer.locator('.script-layout-image-wrap')).toHaveCount(0);
	}
});

test('EJU 听力核心支持播放、暂停、transcript 阶段显示和逐句定位', async ({ page }) => {
	await page.addInitScript(() => {
		class MockAudio extends EventTarget {
			static instances = [];

			constructor(src) {
				super();
				this.src = src;
				this.paused = true;
				this.currentTime = 0;
				this.duration = 180;
				this.readyState = 1;
				this.playbackRate = 1;
				this.loop = false;
				MockAudio.instances.push(this);
			}

			play() {
				this.paused = false;
				this.dispatchEvent(new Event('play'));
				return Promise.resolve();
			}

			pause() {
				this.paused = true;
				this.dispatchEvent(new Event('pause'));
			}

			load() {
				this.readyState = 1;
				this.dispatchEvent(new Event('loadedmetadata'));
			}
		}

		window.Audio = MockAudio;
		window.__mockAudioInstances = MockAudio.instances;
	});

	await loadEjuPaper(page);
	await selectViewerCategory(page, 'listening');

	const timedQuestion = await page.evaluate(() => {
		const viewer = window.examViewer;
		const section = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex];
		const questions = Array.isArray(section.questions) ? section.questions : [];
		const index = questions.findIndex((question) =>
			Array.isArray(question.script) && question.script.some((line) => line.start && line.end)
		);
		if (index < 0) {
			throw new Error('No timed listening question found');
		}
		viewer.currentQuestionIndex = index;
		viewer.questionRenderer.renderCurrentQuestion();
		const question = questions[index];
		const firstTimedLine = question.script.find((line) => line.start && line.end);
		return {
			questionId: String(question.id),
			audio: question.audio,
			lineStart: firstTimedLine.start
		};
	});

	const questionContainer = page.locator('#current-question-container');
	await expect(questionContainer.locator('.audio-player')).toBeVisible();
	await expect(questionContainer.locator('.audio-btn')).toHaveAttribute('data-playing', 'false');
	await expect(questionContainer.locator('.script-container')).toHaveClass(/script-stage-hidden/);

	await questionContainer.locator('.audio-btn').click();
	await expect(questionContainer.locator('.audio-btn')).toHaveAttribute('data-playing', 'true');
	await expect.poll(async () => {
		return await page.evaluate(() => {
			const audio = window.__mockAudioInstances?.[0];
			return audio ? { src: audio.src, paused: audio.paused } : null;
		});
	}).toEqual({ src: timedQuestion.audio, paused: false });

	await questionContainer.locator('.audio-btn').click();
	await expect(questionContainer.locator('.audio-btn')).toHaveAttribute('data-playing', 'false');
	await expect.poll(async () => {
		return await page.evaluate(() => window.__mockAudioInstances?.[0]?.paused);
	}).toBe(true);

	await questionContainer.locator('.listening-stage-btn[data-stage="reveal"]').click();
	await expect(questionContainer.locator('.script-container')).not.toHaveClass(/script-stage-hidden/);

	const firstTimedLine = questionContainer.locator(`.script-line[data-question-id="${timedQuestion.questionId}"][data-start="${timedQuestion.lineStart}"]`).first();
	await expect(firstTimedLine).toBeVisible();
	await firstTimedLine.click();

	await expect(firstTimedLine).toHaveClass(/active/);
	await expect(questionContainer.locator('.audio-btn')).toHaveAttribute('data-playing', 'true');
	await expect.poll(async () => {
		return await page.evaluate((lineStart) => {
			const parseTime = (value) => {
				const parts = String(value).split(':').map(Number);
				if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
				if (parts.length === 2) return parts[0] * 60 + parts[1];
				return 0;
			};
			const audio = window.__mockAudioInstances?.[0];
			const expected = Math.max(0, parseTime(lineStart) - 0.18);
			return audio ? Math.abs(audio.currentTime - expected) < 0.02 : false;
		}, timedQuestion.lineStart);
	}).toBe(true);
});

test('试卷学习核心流程可以作答、跳题、提交并记录进度', async ({ page, request }) => {
	const loginId = uniqueLoginId('student_exam_core');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	await expect(page.locator('#current-question-container .option').first()).toBeVisible({ timeout: 20000 });

	const firstQuestion = await page.evaluate(() => {
		const viewer = window.examViewer;
		const section = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex];
		const question = section.questions[viewer.currentQuestionIndex];
		return {
			examId: viewer._currentExamId,
			userId: viewer.userId,
			sectionIndex: viewer.currentSectionIndex,
			questionIndex: viewer.currentQuestionIndex,
			questionId: String(question.id),
			correctAnswer: Number(question.correct_answer || question.answer || 1),
			questionText: String(question.question || question.stem || '')
		};
	});
	expect(firstQuestion.examId).toBeTruthy();
	expect(firstQuestion.userId).toBeTruthy();
	expect(firstQuestion.questionId).toBeTruthy();

	const optionIndex = firstQuestion.correctAnswer > 0 ? firstQuestion.correctAnswer : 1;
	await page.locator(
		`#current-question-container .option[data-question-id="${firstQuestion.questionId}"][data-option-index="${optionIndex}"]`
	).click();
	await expect(page.locator('#current-question-container .option.selected')).toHaveAttribute('data-option-index', String(optionIndex));

	const compositeAnswer = await page.evaluate((info) => {
		const viewer = window.examViewer;
		return viewer.answerManager.getAnswerComposite(info.sectionIndex, info.questionId);
	}, firstQuestion);
	expect(compositeAnswer).toBe(optionIndex);

	await page.locator('#open-question-map').click();
	const mapContent = page.locator('#question-map-content');
	await expect(page.locator('#question-map-overlay')).toBeVisible();
	await expect(mapContent.locator('.question-map-item.current')).toHaveClass(/answered/);

	const jumpTarget = mapContent.locator(`.question-map-item[data-section="${firstQuestion.sectionIndex}"]`).nth(1);
	await expect(jumpTarget).toBeVisible();
	await jumpTarget.click();
	await expect.poll(async () => {
		return await page.evaluate(() => window.examViewer.currentQuestionIndex);
	}).toBe(1);
	await page.locator('#question-map-overlay [aria-label="关闭"]').click();
	await expect(page.locator('#question-map-overlay')).toBeHidden();

	const submitResponsePromise = page.waitForResponse((response) =>
		response.url().includes('/api/v1/answers/submit') && response.request().method() === 'POST'
	);
	await page.evaluate(() => window.examViewer.submitAnswers());
	const submitPayload = await (await submitResponsePromise).json();
	expect(submitPayload.code).toBe('OK');
	expect(submitPayload.data.total_questions).toBeGreaterThan(0);
	expect(submitPayload.data.correct_count).toBeGreaterThanOrEqual(1);
	expect(submitPayload.data.results[`${firstQuestion.sectionIndex}:${firstQuestion.questionId}`].status).toBe('correct');

	await expect(page.locator('#exam-result-modal')).toBeVisible();
	await expect(page.locator('#exam-result-panel')).toContainText('试卷已提交');
	await expect(page.locator('#exam-result-panel')).toContainText('正确率');
	await page.locator('[data-result-action="explanations"]').click();
	await expect(page.locator('#exam-result-modal')).toBeHidden();
	expect(await page.evaluate(() => ({ answers: window.examViewer.showAnswers, explanations: window.examViewer.showExplanations }))).toEqual({ answers: true, explanations: true });
	await expect(page.locator('#current-question-container')).not.toContainText('加载失败');

	const persisted = await page.evaluate(async (info) => ({
		answers: await window.APIClient.getAnswers(info.userId, info.examId),
		progress: await window.APIClient.getExamProgress(info.userId)
	}), firstQuestion);
	expect(persisted.answers.answers[`${firstQuestion.sectionIndex}:${firstQuestion.questionId}`]).toBe(optionIndex);
	expect(persisted.progress[firstQuestion.examId]).toBeGreaterThan(0);
});

test('私人学习数据接口拒绝访问其他用户', async ({ request }) => {
	const owner = await loginApi(request, uniqueLoginId('student_data_owner'));
	const attacker = await loginApi(request, uniqueLoginId('student_data_attacker'));
	const headers = { Authorization: `Bearer ${attacker.token}` };
	for (const path of [
		`/api/v1/drafts/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/timers/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/recent-learning/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/progress/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/profile/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/bookmarks/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/wrong-questions/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/srs/${encodeURIComponent(owner.user_id)}/due`,
		`/api/v1/statistics/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/recommendations/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/streaks/${encodeURIComponent(owner.user_id)}/summary`,
		`/api/v1/vocab-notebook/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/chapters?user_id=${encodeURIComponent(owner.user_id)}`
	]) {
		const response = await request.get(path, { headers });
		expect(response.status()).toBe(403);
		const payload = await response.json();
		expect(payload.code).toBe('FORBIDDEN');
	}
	for (const path of [
		`/api/v1/profile/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/bookmarks/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/wrong-questions/${encodeURIComponent(owner.user_id)}`,
		`/api/v1/statistics/${encodeURIComponent(owner.user_id)}`
	]) {
		const response = await request.get(path);
		expect(response.status()).toBe(401);
	}
	const ownDraft = await request.get(`/api/v1/drafts/${encodeURIComponent(attacker.user_id)}`, { headers });
	expect(ownDraft.ok()).toBeTruthy();
	const superAdmin = await loginApi(request, 'superadmin_demo');
	const adminRead = await request.get(`/api/v1/drafts/${encodeURIComponent(owner.user_id)}`, {
		headers: { Authorization: `Bearer ${superAdmin.token}` }
	});
	expect(adminRead.ok()).toBeTruthy();
});

test('数字查询参数非法时返回可读校验错误而不是服务异常', async ({ request }) => {
	const user = await loginApi(request, uniqueLoginId('student_query_validation'));
	const headers = { Authorization: `Bearer ${user.token}` };
	for (const item of [
		{ path: `/api/v1/statistics/${encodeURIComponent(user.user_id)}/learning-curve?days=abc`, parameter: 'days' },
		{ path: `/api/v1/recommendations/${encodeURIComponent(user.user_id)}?limit=51`, parameter: 'limit' },
		{ path: `/api/v1/recent-learning/${encodeURIComponent(user.user_id)}?limit=0`, parameter: 'limit' },
		{ path: `/api/v1/answers/${encodeURIComponent(user.user_id)}/missing-exam/attempts?limit=1x`, parameter: 'limit' }
	]) {
		const response = await request.get(item.path, { headers });
		expect(response.status()).toBe(422);
		const payload = await response.json();
		expect(payload.code).toBe('VALIDATION_ERROR');
		expect(payload.message).toContain(item.parameter);
	}

	const valid = await request.get(
		`/api/v1/statistics/${encodeURIComponent(user.user_id)}/learning-curve?days=1`,
		{ headers }
	);
	expect(valid.ok()).toBeTruthy();
});

test('关键写接口拒绝越界请求体并返回真实每日一练', async ({ request }) => {
	const user = await loginApi(request, uniqueLoginId('student_body_validation'));
	const headers = { Authorization: `Bearer ${user.token}` };
	for (const item of [
		{ method: 'put', path: `/api/v1/streaks/${encodeURIComponent(user.user_id)}/goal`, data: { daily_questions: 0 }, parameter: 'daily_questions' },
		{ method: 'post', path: `/api/v1/wrong-questions/${encodeURIComponent(user.user_id)}/sample`, data: { count: 51 }, parameter: 'count' },
		{ method: 'post', path: `/api/v1/srs/${encodeURIComponent(user.user_id)}/review`, data: { card_id: 'missing-card', grade: 4 }, parameter: 'grade' },
		{ method: 'post', path: `/api/v1/srs/${encodeURIComponent(user.user_id)}/cards`, data: { question_id: '1' }, parameter: 'exam_id' },
		{ method: 'post', path: '/api/v1/me/daily-practice/regenerate', data: { count: '10' }, parameter: 'count' },
		{
			method: 'post', path: '/api/v1/me/study-goals',
			data: { title: 'N2 目标', target_date: '2026-12-01', note: 'x'.repeat(501) }, parameter: 'note'
		},
		{
			method: 'post', path: `/api/v1/wrong-questions/${encodeURIComponent(user.user_id)}/reset`,
			data: {}, parameter: 'confirmation'
		},
		{
			method: 'post', path: '/api/v1/payments/refunds',
			data: { order_id: 'missing-order' }, parameter: 'confirmation'
		}
	]) {
		const response = await request[item.method](item.path, { headers, data: item.data });
		expect(response.status()).toBe(422);
		const payload = await response.json();
		expect(payload.code).toBe('VALIDATION_ERROR');
		expect(payload.message).toContain(item.parameter);
	}

	const invalidCount = await request.get('/api/v1/me/daily-practice?count=0', { headers });
	expect(invalidCount.status()).toBe(422);
	const dailyResponse = await request.get('/api/v1/me/daily-practice?count=1', { headers });
	expect(dailyResponse.ok()).toBeTruthy();
	const daily = (await dailyResponse.json()).data;
	expect(daily.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	expect(daily.target_count).toBe(1);
	expect(Array.isArray(daily.items)).toBeTruthy();
	expect(Array.isArray(daily.completed_question_ids)).toBeTruthy();

	const reset = await request.post(`/api/v1/wrong-questions/${encodeURIComponent(user.user_id)}/reset`, {
		headers,
		data: { confirmation: '清空错题本' }
	});
	expect(reset.ok()).toBeTruthy();
	const resetStateResponse = await request.get(`/api/v1/wrong-questions/${encodeURIComponent(user.user_id)}`, { headers });
	expect(resetStateResponse.ok()).toBeTruthy();
	const resetState = (await resetStateResponse.json()).data;
	expect(resetState.reset_audit.actor_user_id).toBe(user.user_id);
	expect(resetState.reset_audit.previous_question_count).toBeGreaterThanOrEqual(0);
	expect(resetState.reset_audit.reset_count).toBeGreaterThanOrEqual(1);
	const superAdmin = await loginApi(request, uniqueLoginId('superadmin_wrong_reset_audit'));
	const auditResponse = await request.get(
		`/api/v1/admin/audit-logs?action=${encodeURIComponent('wrong_questions.reset')}&actor_id=${encodeURIComponent(user.user_id)}&limit=10`,
		{ headers: { Authorization: `Bearer ${superAdmin.token}` } }
	);
	expect(auditResponse.ok()).toBeTruthy();
	const audit = (await auditResponse.json()).data;
	expect(audit.items.some((item) => item.details?.target_user_id === user.user_id)).toBeTruthy();
});

test('交卷结果支持错题复盘和再做一次', async ({ page }) => {
	const loginId = uniqueLoginId('student_result_review');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	const wrongAnswer = await page.evaluate(() => {
		const viewer = window.examViewer;
		const section = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex];
		const question = section.questions[viewer.currentQuestionIndex];
		const correct = Number(question.correct_answer || question.answer || 1);
		const optionCount = Array.isArray(question.options) ? question.options.length : 4;
		return { questionId: String(question.id), option: correct === 1 && optionCount > 1 ? 2 : 1 };
	});
	await page.locator(`#current-question-container .option[data-question-id="${wrongAnswer.questionId}"][data-option-index="${wrongAnswer.option}"]`).click();
	await page.evaluate(() => window.examViewer.submitAnswers());
	await expect(page.locator('#exam-result-modal')).toBeVisible({ timeout: 20000 });
	await expect(page.locator('.exam-result-stats .is-wrong strong')).not.toHaveText('0');

	await page.locator('[data-result-action="wrong"]').click();
	await expect(page.locator('#exam-review-bar')).toBeVisible();
	await expect(page.locator('#exam-review-bar')).toContainText('回答错误');
	expect(await page.evaluate(() => ({ answers: window.examViewer.showAnswers, explanations: window.examViewer.showExplanations }))).toEqual({ answers: true, explanations: true });
	await page.locator('[data-review-action="close"]').click();
	await expect(page.locator('#exam-review-bar')).toHaveCount(0);

	await page.evaluate(() => window.examViewer.answerManager.showResults({
		total_questions: 1, correct_count: 0, wrong_count: 1, unanswered_count: 0,
		score: 0, accuracy: 0, completion: 100, results: {}
	}));
	await page.locator('[data-result-action="retry"]').click();
	await expect(page.locator('#exam-result-modal')).toBeHidden();
	await expect(page.locator('#submit-exam')).toBeEnabled();
	expect(await page.evaluate(() => ({
		submitted: window.examViewer.isSubmitted,
		answered: Object.values(window.examViewer.userAnswers).filter((value) => value !== null && value !== undefined && value !== '').length
	}))).toEqual({ submitted: false, answered: 0 });
});

test('结果弹窗支持 Esc、焦点锁定和关闭后焦点恢复', async ({ page }) => {
	await loadEjuPaper(page);
	await page.locator('#submit-exam').focus();
	await page.evaluate(() => window.examViewer.answerManager.showResults({
		total_questions: 2, correct_count: 1, wrong_count: 1, unanswered_count: 0,
		score: 50, accuracy: 50, completion: 100, results: {}
	}));
	await expect(page.locator('#exam-result-modal')).toBeVisible();
	await expect(page.locator('[data-result-action="explanations"]')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.locator('#exam-result-modal')).toBeHidden();
	await expect(page.locator('#submit-exam')).toBeFocused();
});

test('断网和网络恢复状态对用户可见', async ({ page }) => {
	await loadEjuPaper(page);
	const banner = page.locator('#network-status-banner');
	await page.evaluate(() => window.dispatchEvent(new Event('offline')));
	await expect(banner).toBeVisible();
	await expect(banner).toContainText('网络已断开');
	await expect(banner).toHaveClass(/is-offline/);

	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(banner).toContainText('网络已恢复');
	await expect(banner).toHaveClass(/is-online/);
	await expect(banner).toBeHidden({ timeout: 5000 });
});

test('模拟考试提交前锁定学习辅助，保存答案并在提交后解锁', async ({ page }) => {
	const loginId = uniqueLoginId('student_mock_mode');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await page.selectOption('#exam-mode-select', 'mock');
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	await expect(page.locator('#toggle-answers')).toBeDisabled();
	await expect(page.locator('#toggle-explanations')).toBeDisabled();
	await expect(page.locator('#toggle-reading-kana')).toBeDisabled();
	await expect(page.locator('#toggle-reading-zh')).toBeDisabled();
	await expect(page.locator('#submit-exam')).toBeEnabled();

	await page.locator('#current-question-container .option').first().click();
	await expect(page.locator('#answer-save-status')).toHaveText('已保存', { timeout: 10000 });

	await page.locator('#submit-exam').click();
	await expect(page.locator('.app-dialog')).toContainText('提交后不能继续修改');
	await page.locator('.app-dialog [data-app-dialog-confirm]').click();
	await expect.poll(async () => page.evaluate(() => window.examViewer.isSubmitted)).toBe(true);

	await expect(page.locator('#toggle-answers')).toBeEnabled();
	await expect(page.locator('#toggle-reading-kana')).toBeEnabled();
	await expect(page.locator('#submit-exam')).toBeDisabled();
	await expect(page.locator('#answer-save-status')).toHaveText('已提交');
});

test('切换答题模式使用站内确认并在取消后恢复焦点', async ({ page }) => {
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	await page.locator('#current-question-container .option').first().click();
	const modeSelect = page.locator('#exam-mode-select');
	await modeSelect.selectOption('mock');
	await expect(page.locator('.app-dialog')).toContainText('清空当前答案');
	await expect(modeSelect).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(page.locator('.app-dialog')).toHaveCount(0);
	await expect(modeSelect).toHaveValue('practice');
	await expect(modeSelect).toBeFocused();

	await modeSelect.selectOption('mock');
	await page.locator('.app-dialog [data-app-dialog-confirm]').click();
	await expect(modeSelect).toHaveValue('mock');
	expect(await page.evaluate(() => Object.values(window.examViewer.userAnswers).filter((value) => value !== null && value !== undefined && value !== '').length)).toBe(0);
});

test('刷新页面后恢复草稿答案和上次答题位置', async ({ page }) => {
	const loginId = uniqueLoginId('student_resume_draft');
	await stubNoisyPersonalCenterApis(page, { includeDrafts: false });
	await loginWithPassword(page, loginId);
	await page.selectOption('#exam-mode-select', 'practice');
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	const answered = await page.evaluate(() => {
		const viewer = window.examViewer;
		const section = viewer.currentExam.exam_info.sections[viewer.currentSectionIndex];
		const question = section.questions[viewer.currentQuestionIndex];
		return { examId: viewer._currentExamId, sectionIndex: viewer.currentSectionIndex, questionId: String(question.id) };
	});
	await page.locator('#current-question-container .option').first().click();
	await page.locator('#top-next').click();
	const savedPosition = await page.evaluate(() => ({
		sectionIndex: window.examViewer.currentSectionIndex,
		questionIndex: window.examViewer.currentQuestionIndex
	}));
	await expect(page.locator('#answer-save-status')).toHaveText('已保存', { timeout: 10000 });

	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.examViewer?.userId && window.examViewer.userId !== 'guest' && window.APIClient);
	await page.evaluate(async (examId) => {
		const exam = await window.APIClient.getExam(examId);
		window.examViewer._currentExamId = examId;
		window.examViewer.loadExamData(exam);
	}, answered.examId);
	await expect.poll(async () => page.evaluate((info) =>
		window.examViewer.answerManager.getAnswerComposite(info.sectionIndex, info.questionId), answered
	), { timeout: 10000 }).toBe(1);

	const restored = await page.evaluate(({ answered, savedPosition }) => ({
		answer: window.examViewer.answerManager.getAnswerComposite(answered.sectionIndex, answered.questionId),
		sectionIndex: window.examViewer.currentSectionIndex,
		questionIndex: window.examViewer.currentQuestionIndex,
		expectedSectionIndex: savedPosition.sectionIndex,
		expectedQuestionIndex: savedPosition.questionIndex
	}), { answered, savedPosition });
	expect(restored.answer).toBe(1);
	expect(restored.sectionIndex).toBe(restored.expectedSectionIndex);
	expect(restored.questionIndex).toBe(restored.expectedQuestionIndex);
});

test('草稿保存失败后自动重试', async ({ page }) => {
	const loginId = uniqueLoginId('student_draft_retry');
	await stubNoisyPersonalCenterApis(page, { includeDrafts: false });
	let saveAttempts = 0;
	await page.route('**/api/v1/drafts/**', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		saveAttempts += 1;
		if (saveAttempts === 1) {
			await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TEMPORARY_FAILURE', message: 'temporary failure' }) });
			return;
		}
		await route.continue();
	});
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	await page.locator('#current-question-container .option').first().click();

	await expect(page.locator('#answer-save-status')).toContainText('保存失败，5 秒后重试', { timeout: 10000 });
	await expect(page.locator('#answer-save-status')).toHaveText('已保存', { timeout: 12000 });
	expect(saveAttempts).toBeGreaterThanOrEqual(2);
});

test('多设备草稿冲突时允许保留本机或使用云端版本', async ({ page }) => {
	const loginId = uniqueLoginId('student_draft_conflict');
	await stubNoisyPersonalCenterApis(page, { includeDrafts: false });
	let remoteRequested = false;
	let forcedPayload = null;
	let localSnapshot = null;
	await page.route('**/api/v1/drafts/**', async (route) => {
		const method = route.request().method();
		if (method === 'GET') {
			const localAnswers = localSnapshot?.answers || {};
			const firstKey = Object.keys(localAnswers)[0];
			const remoteAnswers = firstKey ? { ...localAnswers, [firstKey]: Number(localAnswers[firstKey]) === 1 ? 2 : 1, '0:remote-only': 3 } : { '0:remote-only': 3 };
			const data = remoteRequested
				? { exam_id: '2023_02', revision: 2, answered_count: 2, answers: remoteAnswers, last_section_index: 0, last_question_index: 0 }
				: { exam_id: '2023_02', revision: 1, answered_count: 0, answers: {}, last_section_index: 0, last_question_index: 0 };
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK', data }) });
			return;
		}
		if (method === 'POST') {
			const payload = route.request().postDataJSON();
			if (!payload.force_overwrite) {
				localSnapshot = payload;
				remoteRequested = true;
				await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'DRAFT_CONFLICT', message: 'conflict', data: null }) });
				return;
			}
			forcedPayload = payload;
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK', data: { ...payload, revision: 3 } }) });
			return;
		}
		await route.continue();
	});
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	await page.locator('#current-question-container .option').first().click();
	await expect(page.locator('#exam-result-modal')).toBeVisible({ timeout: 10000 });
	await expect(page.locator('#exam-result-panel')).toContainText('其他设备的答题进度');
	await expect(page.locator('.draft-conflict-row')).toHaveCount(1);
	await page.locator('[data-draft-choice="merge"]').click();
	await expect.poll(() => forcedPayload, { timeout: 10000 }).not.toBeNull();
	expect(forcedPayload.force_overwrite).toBe(true);
	expect(forcedPayload.base_revision).toBe(2);
	expect(forcedPayload.answers['0:remote-only']).toBe(3);
});

test('重复点击交卷只发送一次请求并可查看历史', async ({ page }) => {
	const loginId = uniqueLoginId('student_submit_idempotent');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	await page.locator('#current-question-container .option').first().click();
	let submitRequests = 0;
	page.on('request', (request) => {
		if (request.url().includes('/api/v1/answers/submit') && request.method() === 'POST') submitRequests += 1;
	});
	await page.evaluate(() => Promise.all([window.examViewer.answerManager.submitAnswers(), window.examViewer.answerManager.submitAnswers()]));
	await expect(page.locator('#exam-result-modal')).toBeVisible();
	expect(submitRequests).toBe(1);
	await page.locator('[data-result-action="history"]').click();
	await expect(page.locator('#exam-result-panel')).toContainText('交卷历史');
	await expect(page.locator('.exam-history-row')).toHaveCount(1);
	await page.locator('.exam-history-row').click();
	await expect(page.locator('#exam-result-panel')).toContainText(/学习练习|模拟考试/);
	await expect(page.locator('.exam-attempt-question').first()).toBeVisible();
	await page.locator('[data-attempt-retry]').click();
	await expect(page.locator('#exam-result-modal')).toBeHidden();
	await expect(page.locator('#exam-review-bar')).toContainText('错题重练');
	expect(await page.evaluate(() => window.examViewer.isSubmitted)).toBe(false);
});

test('模拟考试分段超时后进入下一部分且不能返回', async ({ page }) => {
	await loadEjuPaper(page);
	await page.selectOption('#exam-mode-select', 'mock');
	const early = await page.evaluate(() => {
		const viewer = window.examViewer;
		viewer.currentExam.exam_info.allow_early_section_advance = false;
		const start = viewer.currentSectionIndex;
		viewer.jumpToQuestion(start + 1, 0);
		return { start, current: viewer.currentSectionIndex };
	});
	expect(early.current).toBe(early.start);
	await expect(page.locator('#answer-save-status')).toContainText('不允许提前');
	const initial = await page.evaluate(() => {
		const viewer = window.examViewer;
		const start = viewer.currentSectionIndex;
		viewer.onSectionExpired(start);
		return { start, current: viewer.currentSectionIndex };
	});
	expect(initial.current).toBeGreaterThan(initial.start);
	await page.evaluate((sectionIndex) => window.examViewer.jumpToQuestion(sectionIndex, 0), initial.start);
	expect(await page.evaluate(() => window.examViewer.currentSectionIndex)).toBe(initial.current);
	await expect(page.locator('#answer-save-status')).toContainText('不能返回修改');
});

test('分段计时展示剩余时间并发出五分钟和一分钟提醒', async ({ page }) => {
	await loadEjuPaper(page);
	await page.evaluate(() => {
		window.__timerToasts = [];
		window.showToast = (message) => window.__timerToasts.push(message);
		const manager = window.examViewer.examTimerManager;
		manager.applySnapshot({ elapsed_seconds: 120, section_limit_seconds: 600, section_remaining_seconds: 300 });
		manager.renderBar();
		manager.checkExpiry();
	});
	await expect(page.locator('#exam-timer-bar')).toContainText('本部分剩余 05:00');
	expect(await page.evaluate(() => window.__timerToasts)).toContain('第 1 部分还剩 5 分钟');
	await page.evaluate(() => {
		const manager = window.examViewer.examTimerManager;
		manager.applySnapshot({ elapsed_seconds: 360, section_limit_seconds: 600, section_remaining_seconds: 60 });
		manager.renderBar();
		manager.checkExpiry();
	});
	await expect(page.locator('#exam-timer-bar')).toContainText('本部分剩余 01:00');
	expect(await page.evaluate(() => window.__timerToasts)).toContain('第 1 部分还剩 1 分钟');
});

test('模拟考试时间到后自动交卷', async ({ page }) => {
	const loginId = uniqueLoginId('student_timer_submit');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await page.selectOption('#exam-mode-select', 'mock');
	await loadEjuPaper(page);

	page.on('dialog', async (dialog) => {
		await dialog.accept();
	});
	await page.evaluate(() => {
		const viewer = window.examViewer;
		viewer.examTimerManager.startForExam(viewer._currentExamId, { totalLimitSeconds: 1 });
	});
	await expect(page.locator('#exam-timer-bar')).toBeVisible({ timeout: 10000 });
	await page.evaluate(() => window.examViewer.examTimerManager.sendTick());
	await expect.poll(async () => page.evaluate(() => window.examViewer.isSubmitted), { timeout: 15000 }).toBe(true);
	await expect(page.locator('#answer-save-status')).toHaveText('已提交');
	await expect(page.locator('#submit-exam')).toBeDisabled();
});

test('学习闭环支持单题收藏并在个人中心查看', async ({ page }) => {
	const loginId = uniqueLoginId('student_learning_loop');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	const bookmarkButton = page.locator('#current-question-container .question-bookmark-btn').first();
	await expect(bookmarkButton).toBeVisible({ timeout: 20000 });
	await bookmarkButton.click();
	await expect(page.locator('text=收藏当前题')).toBeVisible();
	await page.locator('.qb-new-folder').click();
	await expect(page.locator('.app-dialog')).toContainText('请输入文件夹名称');
	await page.locator('.app-dialog-input').fill('E2E 读解复盘');
	const folderResponse = page.waitForResponse((response) => response.url().includes('/api/v1/bookmark-folders/') && response.request().method() === 'POST');
	await page.locator('.app-dialog [data-app-dialog-confirm]').click();
	expect((await (await folderResponse).json()).code).toBe('OK');
	await expect(page.locator('.qb-status')).toContainText('文件夹已创建');
	await page.locator('.qb-reason').fill('E2E 收藏原因：这道题需要复盘定位句。');

	const bookmarkResponse = page.waitForResponse((response) =>
		response.url().includes('/api/v1/bookmarks/') &&
		response.url().includes('/questions') &&
		response.request().method() === 'POST'
	);
	await page.locator('.qb-submit').click();
	const bookmarkPayload = await (await bookmarkResponse).json();
	expect(bookmarkPayload.code).toBe('OK');
	expect(bookmarkPayload.data.questions.length).toBeGreaterThan(0);
	await expect(page.locator('#app-toast')).toContainText('已收藏当前题');

	await page.locator('#user-menu-trigger, [aria-label*="打开个人中心"]').first().click();
	await expect(page.locator('#personal-center.pc-open')).toBeVisible();

	await page.locator('#personal-center [data-dashboard-page="favorites"]').click();
	await expect(page.locator('#personal-center .pc-subpage')).toContainText('收藏');
	await expect(page.locator('#personal-center .pc-subpage')).toContainText('E2E 收藏原因');
	await expect(page.locator('#personal-center .pc-subpage').getByRole('button', { name: '去做题' }).first()).toBeVisible();
});

test('题目反馈提供字段提示、提交锁和非阻塞成功提示', async ({ page }) => {
	const loginId = uniqueLoginId('student_question_feedback');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	await page.locator('#current-question-container .feedback-btn').first().click();
	const feedbackDialog = page.locator('[aria-labelledby="fb-title"]');
	await expect(feedbackDialog).toBeVisible();
	await feedbackDialog.locator('.fb-submit').click();
	await expect(feedbackDialog.locator('.fb-status')).toContainText('请填写详细描述');
	await feedbackDialog.locator('.fb-desc').fill('E2E 题目反馈：解析中的定位句需要复核。');
	const response = page.waitForResponse((item) => item.url().includes('/api/v1/feedback') && item.request().method() === 'POST');
	await feedbackDialog.locator('.fb-submit').click();
	expect((await (await response).json()).code).toBe('OK');
	await expect(feedbackDialog).toHaveCount(0);
	await expect(page.locator('#app-toast')).toContainText('反馈已提交');
});

test('内容编辑弹窗支持键盘操作并仅在真实保存成功后关闭', async ({ page }) => {
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, 'contentadmin_demo');
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');
	const editButton = page.locator('#current-question-container .edit-btn[title="编辑题目"]').first();
	await expect(editButton).toBeVisible();
	await editButton.focus();
	await editButton.click();
	let editor = page.locator('.edit-dialog');
	await expect(editor).toHaveAttribute('role', 'dialog');
	await expect(editor).toHaveAttribute('aria-modal', 'true');
	await expect(editor.locator('textarea, input').first()).toBeFocused();
	await editor.locator('.edit-dialog-close').focus();
	await page.keyboard.press('Shift+Tab');
	await expect(editor.locator('.edit-dialog-save')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(editor).toHaveCount(0);
	await expect(editButton).toBeFocused();

	await editButton.click();
	editor = page.locator('.edit-dialog');
	const questionInput = editor.locator('.edit-question');
	await questionInput.fill('E2E 编辑失败后应保留的题干');
	await page.evaluate(() => {
		window.APIClient.updateExam = async () => {
			await new Promise((resolve) => setTimeout(resolve, 250));
			throw new Error('E2E 保存失败');
		};
	});
	const saveButton = editor.locator('.edit-dialog-save');
	await saveButton.click();
	await expect(saveButton).toBeDisabled();
	await expect(saveButton).toHaveAttribute('aria-busy', 'true');
	await expect(editor.locator('.edit-dialog-status')).toContainText('保存失败');
	await expect(editor).toBeVisible();
	await expect(questionInput).toHaveValue('E2E 编辑失败后应保留的题干');

	await page.evaluate(() => { window.APIClient.updateExam = async () => ({}); });
	await saveButton.click();
	await expect(editor).toHaveCount(0);
	await expect(page.locator('#app-toast')).toContainText('内容已保存');
	await expect(page.locator('#current-question-container .edit-btn[title="编辑题目"]').first()).toBeFocused();
});
