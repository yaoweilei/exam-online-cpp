const { test, expect } = require('@playwright/test');

async function openListeningQuestion(page) {
  await page.goto('/');
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="eju"]').click();
  await home.locator('[data-gw="browse"][data-domain="听解"]').click();
  const paper = home.locator('[data-gw="paper"][data-exam="2024_01"]');
  if (!(await paper.isVisible())) await home.locator('.gw-earlier-years summary').click();
  await paper.click();
  await home.locator('.practice-start-btn').click();
  await expect(home).toBeHidden();

  await page.evaluate(() => {
    const viewer = window.examViewer;
    const sections = viewer.currentExam.exam_info.sections;
    const sectionIndex = sections.findIndex(section => section.questions.some(question => question.audio && question.script));
    const questionIndex = sections[sectionIndex].questions.findIndex(question => question.audio && question.script);
    viewer.jumpToQuestion(sectionIndex, questionIndex, false);
  });
}

test('听力题只显示播放器，核对答案后才显示原文', async ({ page }) => {
  await openListeningQuestion(page);

  const question = page.locator('#current-question-container');
  await expect(question.locator('.audio-player')).toBeVisible();
  const enhance = question.locator('.audio-enhance');
  await expect(enhance.locator('select')).toBeVisible();
  await expect(enhance.locator('select')).toHaveAttribute('aria-label', '播放倍速');
  await expect(enhance.locator('input[type="checkbox"]')).toBeVisible();
  await expect(enhance.locator('button, .audio-ab-status')).toHaveCount(0);
  await expect(enhance).not.toContainText('倍速');
  await expect(enhance).not.toContainText('复读');
  const layout = await page.evaluate(() => {
    const play = document.querySelector('.audio-btn').getBoundingClientRect();
    const progress = document.querySelector('.audio-progress').getBoundingClientRect();
    const avatar = document.querySelector('#user-menu-trigger').getBoundingClientRect();
    const enhance = document.querySelector('.audio-enhance').getBoundingClientRect();
    return { playSize: play.width, avatarSize: avatar.width, playToTrackGap: progress.left - play.right, sameRow: Math.abs(play.top + play.height / 2 - enhance.top - enhance.height / 2) <= 1 };
  });
  expect(layout.playSize).toBe(layout.avatarSize);
  expect(layout.playToTrackGap).toBeGreaterThanOrEqual(11);
  expect(layout.sameRow).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowLayout = await enhance.evaluate(element => {
    const labels = [...element.querySelectorAll('label')].map(label => label.getBoundingClientRect());
    const play = document.querySelector('.audio-btn').getBoundingClientRect();
    const controls = element.getBoundingClientRect();
    return {
      sameRow: Math.abs(labels[0].top + labels[0].height / 2 - labels[1].top - labels[1].height / 2) <= 1,
      sameRowWithPlay: Math.abs(play.top + play.height / 2 - controls.top - controls.height / 2) <= 1,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  expect(narrowLayout.sameRow).toBe(true);
  expect(narrowLayout.sameRowWithPlay).toBe(true);
  expect(narrowLayout.overflow).toBe(false);
  await page.setViewportSize({ width: 320, height: 844 });
  const compactLayout = await enhance.evaluate(element => {
    const play = document.querySelector('.audio-btn').getBoundingClientRect();
    const controls = element.closest('.audio-controls').getBoundingClientRect();
    const settings = element.getBoundingClientRect();
    return {
      sameRow: Math.abs(play.top + play.height / 2 - settings.top - settings.height / 2) <= 1,
      fits: settings.right <= controls.right + 1
    };
  });
  expect(compactLayout.sameRow).toBe(true);
  expect(compactLayout.fits).toBe(true);
  await enhance.locator('select').selectOption('1.25');
  await enhance.locator('input[type="checkbox"]').check();
  await expect(page.locator('.listening-practice-bar, .listening-stage-btn, #listening-practice-settings')).toHaveCount(0);
  await expect(question.locator('.script-container')).toHaveCount(0);

  await question.locator('.option').first().click();
  await page.locator('#question-navigation .check-btn').click();
  await expect(question.locator('.script-container')).toBeVisible();
});

test('管理员的原文编辑按钮随听力原文一起显示', async ({ page }) => {
  await openListeningQuestion(page);
  await page.evaluate(() => {
    const renderer = window.examViewer.questionRenderer;
    renderer.isAdmin = () => true;
    renderer.renderCurrentQuestion();
  });

  const question = page.locator('#current-question-container');
  await expect(question.locator('.script-container, .script-toolbar')).toHaveCount(0);
  await question.locator('.option').first().click();
  await page.locator('#question-navigation .check-btn').click();
  await expect(question.locator('.script-container')).toBeVisible();
  await expect(question.locator('.script-toolbar .edit-btn[title="编辑听力原文 / 时间戳"]')).toBeVisible();
});

test('播放进度高亮原文时不自动滚动页面', async ({ page }) => {
  await openListeningQuestion(page);
  await page.setViewportSize({ width: 390, height: 600 });
  await page.evaluate(() => {
    const viewer = window.examViewer;
    viewer.showAnswers = true;
    viewer.questionRenderer.renderCurrentQuestion();
    const first = document.querySelector('.script-line');
    const later = first.cloneNode(true);
    first.dataset.start = '00:00';
    first.dataset.end = '00:01';
    later.dataset.start = '00:30';
    later.dataset.end = '00:40';
    later.style.marginTop = '1200px';
    first.parentElement.appendChild(later);
    window.scrollTo(0, 0);
    viewer.audioManager.updateScriptHighlight(first.dataset.questionId, 35);
  });
  await expect(page.locator('.script-line').last()).toHaveClass(/active/);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('暂停后即使播放请求稍后完成，图标仍恢复为播放', async ({ page }) => {
  await page.addInitScript(() => {
    class MockAudio extends EventTarget {
      constructor(src) {
        super();
        this.src = src;
        this.paused = true;
        this.currentTime = 0;
        this.duration = 180;
        this.readyState = 1;
        window.__testAudio = this;
      }
      setAttribute() {}
      play() {
        this.paused = false;
        this.dispatchEvent(new Event('playing'));
        return new Promise(resolve => { this.resolvePlay = resolve; });
      }
      pause() {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
      }
    }
    window.Audio = MockAudio;
  });
  await openListeningQuestion(page);

  const playButton = page.locator('#current-question-container .audio-btn');
  await playButton.click();
  await expect(playButton).toHaveAttribute('data-playing', 'true');
  await playButton.click();
  await expect(playButton).toHaveAttribute('data-playing', 'false');
  await page.evaluate(() => window.__testAudio.resolvePlay());
  await expect(playButton).toHaveAttribute('aria-label', '播放音频');
  await expect.poll(() => playButton.evaluate(button => getComputedStyle(button, '::before').borderLeftWidth)).toBe('9px');
});
