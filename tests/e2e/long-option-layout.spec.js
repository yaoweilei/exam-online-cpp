const { test, expect } = require('@playwright/test');

test('长选项只显示一次编号，选项正文与题干对齐', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-target="JLPT N1"]').click();
  await home.locator('[data-gw="browse"][data-domain="阅读"]').click();
  const paper = home.locator('[data-gw="paper"][data-exam="N1_2025_07"]');
  if (!(await paper.isVisible())) await home.locator('.gw-earlier-years summary').click();
  await paper.click();
  await home.locator('.practice-start-btn').click();
  await expect(home).toBeHidden();

  await page.evaluate(async () => {
    const viewer = window.examViewer;
    const sections = viewer.currentExam.exam_info.sections;
    const sectionIndex = sections.findIndex(section => section.questions.some(question => Number(question.id) === 45));
    const questionIndex = sections[sectionIndex].questions.findIndex(question => Number(question.id) === 45);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
    await viewer.toggleReadingKana(true);
    await viewer.toggleReadingZh(true);
  });

  const question = page.locator('#current-question-container .jlpt-long-options');
  await expect(question.locator('.option')).toHaveCount(4);
  await expect(question.locator('.option').first().locator('.option-number')).toHaveText('1.');
  await expect(question.locator('.option').first().locator('.text-assist-source')).not.toContainText(/^\s*1[.．]/);
  await expect(question.locator('.option').first().locator('.sentence-zh')).not.toContainText(/^\s*1[.．]/);
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const alignment = await question.evaluate(element => {
      const body = element.querySelector('.question-text .text-assist-wrap').getBoundingClientRect();
      const option = element.querySelector('.option-text').getBoundingClientRect();
      return Math.abs(body.left - option.left);
    });
    expect(alignment).toBeLessThanOrEqual(1);
  }

  const selectedOption = question.locator('.option').nth(2);
  await selectedOption.click();
  await expect(selectedOption).toHaveClass(/selected/);
  const selectedColors = await selectedOption.evaluate(element => ({
    option: getComputedStyle(element).color,
    ruby: getComputedStyle(element.querySelector('.text-assist-source ruby rt')).color,
    translation: getComputedStyle(element.querySelector('.sentence-zh')).color
  }));
  expect(selectedColors.ruby).toBe(selectedColors.option);
  expect(selectedColors.translation).toBe(selectedColors.option);
});
