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
