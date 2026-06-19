const { test, expect } = require('@playwright/test');
const {
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
	page.once('dialog', async (dialog) => {
		expect(dialog.message()).toContain('评分结果');
		await dialog.accept();
	});
	await page.evaluate(() => window.examViewer.submitAnswers());
	const submitPayload = await (await submitResponsePromise).json();
	expect(submitPayload.code).toBe('OK');
	expect(submitPayload.data.total_questions).toBeGreaterThan(0);
	expect(submitPayload.data.correct_count).toBeGreaterThanOrEqual(1);
	expect(submitPayload.data.results[`${firstQuestion.sectionIndex}:${firstQuestion.questionId}`].status).toBe('correct');

	await page.locator('#toggle-answers').click();
	await expect(page.locator('#current-question-container')).not.toContainText('加载失败');
	await page.locator('#toggle-explanations').click();
	await expect(page.locator('#current-question-container')).not.toContainText('加载失败');

	const savedResponse = await request.get(
		`/api/v1/answers/${encodeURIComponent(firstQuestion.userId)}/${encodeURIComponent(firstQuestion.examId)}`
	);
	expect(savedResponse.ok()).toBeTruthy();
	const savedPayload = await savedResponse.json();
	expect(savedPayload.code).toBe('OK');
	expect(savedPayload.data.answers[`${firstQuestion.sectionIndex}:${firstQuestion.questionId}`]).toBe(optionIndex);

	const progressResponse = await request.get(`/api/v1/progress/${encodeURIComponent(firstQuestion.userId)}/exams`);
	expect(progressResponse.ok()).toBeTruthy();
	const progressPayload = await progressResponse.json();
	expect(progressPayload.code).toBe('OK');
	expect(progressPayload.data[firstQuestion.examId]).toBeGreaterThan(0);
});

test('学习闭环支持单题收藏、今日复习工作台和推荐复习反馈', async ({ page }) => {
	const loginId = uniqueLoginId('student_learning_loop');
	await stubNoisyPersonalCenterApis(page);
	await loginWithPassword(page, loginId);
	await loadEjuPaper(page);
	await selectViewerCategory(page, 'reading');

	const bookmarkButton = page.locator('#current-question-container .question-bookmark-btn').first();
	await expect(bookmarkButton).toBeVisible({ timeout: 20000 });
	await bookmarkButton.click();
	await expect(page.locator('text=收藏当前题')).toBeVisible();
	await page.locator('.qb-reason').fill('E2E 收藏原因：这道题需要复盘定位句。');

	const bookmarkResponse = page.waitForResponse((response) =>
		response.url().includes('/api/v1/bookmarks/') &&
		response.url().includes('/questions') &&
		response.request().method() === 'POST'
	);
	page.once('dialog', async (dialog) => {
		expect(dialog.message()).toContain('已收藏');
		await dialog.accept();
	});
	await page.locator('.qb-submit').click();
	const bookmarkPayload = await (await bookmarkResponse).json();
	expect(bookmarkPayload.code).toBe('OK');
	expect(bookmarkPayload.data.questions.length).toBeGreaterThan(0);

	await page.locator('#user-menu-trigger, [aria-label*="打开个人中心"]').first().click();
	await expect(page.locator('#personal-center.pc-open')).toBeVisible();

	await page.locator('button.service-item[title="收藏夹"]').click();
	await expect(page.locator('#bf-modal')).toBeVisible();
	await expect(page.locator('#bf-body')).toContainText('单题收藏');
	await expect(page.locator('#bf-body')).toContainText('E2E 收藏原因');
	await expect(page.locator('#bf-body button[data-bf-action="open-question"]').first()).toBeVisible();
	await page.locator('#bf-close').click();
	await expect(page.locator('#bf-modal')).toBeHidden();

	await page.locator('button.service-item[title="推荐复习"]').click();
	await expect(page.locator('#recommended-review-modal')).toBeVisible();
	const recommendationBody = page.locator('#rr-body');
	await expect(recommendationBody.locator('button[data-rr-action="open"]').first()).toBeVisible({ timeout: 20000 });
	await recommendationBody.locator('button[data-rr-action="feedback"][data-value="useful"]').first().click();
	await expect(recommendationBody).toContainText('已反馈：有用');
	await page.locator('#rr-close').click();
	await expect(page.locator('#recommended-review-modal')).toBeHidden();

	await page.locator('button.service-item[title="今日复习"]').click();
	await expect(page.locator('#review-workbench-modal')).toBeVisible();
	await expect(page.locator('#rw-body')).toContainText('SRS 到期');
	await expect(page.locator('#rw-body')).toContainText('错题复习');
	await expect(page.locator('#rw-body')).toContainText('每日一练');
});
