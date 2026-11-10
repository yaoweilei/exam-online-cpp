const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');

test('底部导航始终与题干内容列右边缘对齐', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginWithPassword(page, uniqueLoginId('student_nav_alignment'));
  // Login now opens the learning home. Enter an actual practice session before
  // measuring the exam navigation rather than relying on the old landing page.
  await page.evaluate(async () => {
    await window.examViewer.startSpecialtyPractice('导航布局检查', [
      { examId: 'N3_2010_07', questionId: '1', sectionIndex: 0 },
      { examId: 'N3_2010_07', questionId: '2', sectionIndex: 0 }
    ], false);
    window.closeLearningWorkspace();
    window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));
  });
  await expect(page.locator('#question-navigation .next-btn')).toBeVisible();

  for (const width of [1600, 1000, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => {
      const paper = document.querySelector('#current-question-container .question-content').getBoundingClientRect();
      const navigation = document.querySelector('#question-navigation .question-nav').getBoundingClientRect();
      return Math.abs(paper.right - navigation.right);
    })).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => {
      const previous = document.querySelector('#question-navigation .prev-btn').getBoundingClientRect();
      const next = document.querySelector('#question-navigation .next-btn').getBoundingClientRect();
      return Math.abs(previous.width - next.width);
    })).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1600, height: 900 });
  const alignmentAfterMovingAvatar = await page.evaluate(() => {
    const avatar = document.getElementById('user-menu-trigger');
    avatar.style.transform = 'translateX(-120px)';
    window.examViewer.syncFloatingNavigationAlignment();
    const paper = document.querySelector('#current-question-container .question-content').getBoundingClientRect();
    const navigation = document.querySelector('#question-navigation .question-nav').getBoundingClientRect();
    return Math.abs(paper.right - navigation.right);
  });
  expect(alignmentAfterMovingAvatar).toBeLessThanOrEqual(1);
});
