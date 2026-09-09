const { test, expect } = require('@playwright/test');
const { clearBrowserSession, expectGuestEntry } = require('./helpers/session');

const viewports = [
  { name: '手机', width: 390, height: 844 },
	{ name: '临界窄屏', width: 500, height: 900 },
	{ name: '临界宽屏', width: 540, height: 900 },
  { name: '小窗口', width: 640, height: 900 },
  { name: '窄桌面', width: 842, height: 900 },
  { name: '桌面', width: 1440, height: 1100 }
];

async function expectViewportLayout(page, rootSelector, label, mobile) {
  const issues = await page.locator(rootSelector).evaluate((root, options) => {
    const viewportWidth = document.documentElement.clientWidth;
    const problems = [];
    if (document.documentElement.scrollWidth > viewportWidth + 1) {
      problems.push(`页面横向溢出 ${document.documentElement.scrollWidth}/${viewportWidth}`);
    }
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const controls = Array.from(root.querySelectorAll('button,input,select,textarea')).filter(visible);
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      if (box.left < -1 || box.right > viewportWidth + 1) {
        problems.push(`控件越界 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.id || control.tagName}`);
      }
      const compactNativeControl = control instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(control.type);
      const minimumHeight = options.mobile ? 40 : 24;
      if (!compactNativeControl && (box.width < 24 || box.height < minimumHeight)) {
        problems.push(`控件过小 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.id || control.tagName} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    return problems.slice(0, 30);
  }, { mobile });
  expect(issues, label).toEqual([]);
}

async function loadPaper(page) {
  const family = page.locator('#exam-family-select');
  const paper = page.locator('#exam-paper-select');
	const settingsToggle = page.locator('#exam-settings-toggle');
	let openedSettings = false;
  await expect(family).toContainText('EJU', { timeout: 20000 });
  if (!await family.isVisible()) {
	if (await settingsToggle.isVisible()) {
	  await settingsToggle.click();
	  openedSettings = true;
	} else {
	  await page.locator('#mobile-paper-toggle').click();
	}
	await expect(family).toBeVisible();
  }
  await family.selectOption('eju');
  await expect(paper).toContainText('2023_02', { timeout: 20000 });
  if (!await paper.isVisible()) {
    await page.locator('#mobile-paper-toggle').click();
    await expect(paper).toBeVisible();
  }
  await paper.selectOption('2023_02');
  await expect(page.locator('#current-question-container')).not.toBeEmpty({ timeout: 20000 });
	if (openedSettings && await settingsToggle.getAttribute('aria-expanded') === 'true') await settingsToggle.click();
}

for (const viewport of viewports) {
  test(`${viewport.name} 首页、登录和答题主界面均可操作且不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await clearBrowserSession(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expectViewportLayout(page, 'body', `${viewport.name} 首页`, viewport.width <= 520);

    const loginTrigger = await expectGuestEntry(page);
    await loginTrigger.click();
	await expect(page.locator('#login-modal')).toBeVisible();
	await expectViewportLayout(page, '#login-modal', `${viewport.name} 登录弹窗`, viewport.width <= 520);
	const agreement = page.locator('#login-agreement');
	const phoneInput = page.locator('#login-phone');
	const sendCode = page.locator('#login-btn-send-code');
	await expect(agreement).not.toBeChecked();
	await phoneInput.fill('13800138000');
	await expect(sendCode).toBeDisabled();
	await agreement.check();
	await expect(agreement).toBeChecked();
	await expect(sendCode).toBeEnabled();
	await agreement.uncheck();
	await expect(agreement).not.toBeChecked();
	await expect(sendCode).toBeDisabled();
	await phoneInput.fill('');
	const loginLayout = await page.locator('#login-modal .login-box').evaluate((box) => {
	  const boxRect = box.getBoundingClientRect();
	  const brandRect = box.querySelector('.login-brand').getBoundingClientRect();
	  const panelRect = box.querySelector('.login-panel.is-active').getBoundingClientRect();
	  const modeRect = box.querySelector('.login-mode-bar').getBoundingClientRect();
	  const modeButtons = [...box.querySelectorAll('.login-mode-bar button')]
		.filter((button) => button.offsetParent !== null)
		.map((button) => button.getBoundingClientRect());
	  return {
		insideViewport: boxRect.left >= 0 && boxRect.right <= innerWidth && boxRect.top >= 0 && boxRect.bottom <= innerHeight,
		width: boxRect.width,
		height: boxRect.height,
		aspectRatio: getComputedStyle(box).aspectRatio,
		brandPanelGap: panelRect.top - brandRect.bottom,
		modeInside: modeRect.left >= boxRect.left && modeRect.right <= boxRect.right,
		modeOneRow: modeButtons.every((button) => Math.abs(button.top - modeButtons[0].top) <= 1),
		modeButtonMaxHeight: Math.max(...modeButtons.map((button) => button.height)),
		activePanelVisible: panelRect.width > 0 && panelRect.height > 0
	  };
	});
	expect(loginLayout).toMatchObject({
	  insideViewport: true,
	  modeInside: true,
	  modeOneRow: true,
	  activePanelVisible: true
	});
	expect(loginLayout.aspectRatio).toBe(viewport.width <= 420 ? 'auto' : '390 / 844');
	expect(loginLayout.width).toBeLessThanOrEqual(421);
	expect(loginLayout.height).toBeLessThanOrEqual(viewport.height + 1);
	expect(loginLayout.brandPanelGap).toBeGreaterThanOrEqual(100);
	expect(loginLayout.modeButtonMaxHeight).toBeLessThanOrEqual(49);
	const phoneLoginHeight = loginLayout.height;
	await page.locator('[data-mode="password"]').click();
	const passwordViews = page.locator('[data-panel="password"] .login-password-view');
	await expect(passwordViews.filter({ visible: true })).toHaveCount(1);
	await expect(page.locator('[data-password-panel="login"]')).toBeVisible();
	await expect(page.locator('#login-modal-title')).toHaveText('密码登录');
	const passwordInput = page.locator('#login-password');
	const passwordToggle = page.locator('#login-password-toggle');
	await passwordInput.fill('TestPass123');
	await expect(passwordInput).toHaveAttribute('type', 'password');
	await expect(passwordToggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.login-eye-closed')).toBeVisible();
	await expect(page.locator('.login-eye-open')).toBeHidden();
	await passwordToggle.click();
	await expect(passwordInput).toHaveAttribute('type', 'text');
	await expect(passwordToggle).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.login-eye-open')).toBeVisible();
	await expect(page.locator('.login-eye-closed')).toBeHidden();
	await passwordToggle.click();
	await expect(passwordInput).toHaveAttribute('type', 'password');
	await expect(passwordToggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.login-password-forgot')).toHaveText('忘记密码？');
	await expect(page.locator('[data-password-panel="register"], [data-password-panel="reset"], .login-password-links')).toHaveCount(0);
	await expect(page.locator('[data-mode="password"]')).toBeHidden();
	const passwordLoginHeight = await page.locator('#login-modal .login-box').evaluate((box) => box.getBoundingClientRect().height);
	expect(Math.abs(passwordLoginHeight - phoneLoginHeight)).toBeLessThanOrEqual(1);
	expect(passwordLoginHeight).toBeLessThanOrEqual(viewport.height + 1);
	await page.locator('.login-password-forgot').click();
	await expect(page.locator('#login-modal-title')).toHaveText('验证码登录');
	await expect(page.locator('[data-mode="phone"]')).toBeHidden();
	await expect(page.locator('[data-mode="password"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(loginTrigger).toBeFocused();

    await loadPaper(page);
	await expect(page.locator('#exam-controls .category-dropdown-label')).toHaveCount(3);
	await expect(page.locator('#exam-controls')).toContainText('記述/読解');
    await expectViewportLayout(page, '#exam-workarea', `${viewport.name} 答题主界面`, viewport.width <= 520);

	{
      const rowAlignment = await page.locator('#exam-workarea').evaluate(() => {
		const top = ['exam-family-select', 'exam-level-select', 'exam-paper-select', 'theme-toggle']
		  .map((id) => document.getElementById(id).getBoundingClientRect());
		const categories = [...document.querySelectorAll('#exam-controls .category-dropdown-label')]
		  .map((element) => element.getBoundingClientRect());
		const answerCard = document.getElementById('open-question-map').getBoundingClientRect();
		const submit = document.getElementById('submit-exam').getBoundingClientRect();
		const account = document.getElementById('user-menu-trigger').getBoundingClientRect();
		const settings = document.getElementById('exam-settings-toggle').getBoundingClientRect();
		const commandBar = document.getElementById('exam-command-bar').getBoundingClientRect();
		return {
		  family: document.getElementById('exam-family-select').value,
		  compactSettings: settings.width > 0 && settings.height > 0,
		  submitVisible: submit.width > 0 && submit.height > 0,
		  oneLine: Math.abs(top[0].top - answerCard.top) <= 1,
		  commandBarHeight: commandBar.height,
		  commandBarLeftGap: commandBar.left - document.getElementById('exam-workarea').getBoundingClientRect().left,
		  commandBarRightGap: document.getElementById('exam-workarea').getBoundingClientRect().right - commandBar.right,
		  compactTopDeltas: [...categories.slice(0, 3), answerCard, top[3], submit]
			.filter((box) => box.width > 0 && box.height > 0)
			.map((box) => Math.abs(box.top - categories[0].top)),
		  settingsAccountLeftDelta: Math.abs(settings.left - account.left),
		  settingsAccountGap: settings.top - account.bottom,
		  settingsInsideBar: settings.left >= commandBar.left && settings.right <= commandBar.right,
		  accountInsideBar: account.left >= commandBar.left && account.right <= commandBar.right,
		  categoryDeltas: categories.slice(0, 3).map((box, index) => Math.abs(box.left - top[index].left)),
		  rowTopDeltas: [...top, ...categories.slice(0, 3), answerCard, submit, account]
			.filter((box) => box.width > 0 && box.height > 0)
			.map((box) => Math.abs(box.top - top[0].top)),
		  answerCardLeftDelta: Math.abs(answerCard.left - top[3].left),
		  answerCardWidthDelta: Math.abs(answerCard.width - top[3].width),
		  submitLeftDelta: Math.abs(submit.left - account.left),
		  submitWidthDelta: Math.abs(submit.width - account.width),
		  submitAccountGap: account.left - submit.right
		};
      });
	  if (rowAlignment.compactSettings) {
		for (const delta of rowAlignment.compactTopDeltas) expect(delta).toBeLessThanOrEqual(1);
		expect(rowAlignment.commandBarHeight).toBeLessThanOrEqual(64);
		expect(Math.abs(rowAlignment.commandBarLeftGap)).toBeLessThanOrEqual(1);
		expect(Math.abs(rowAlignment.commandBarRightGap)).toBeLessThanOrEqual(1);
		expect(rowAlignment.settingsAccountLeftDelta).toBeLessThanOrEqual(1);
		expect(rowAlignment.settingsAccountGap).toBeGreaterThanOrEqual(4);
		expect(rowAlignment.settingsAccountGap).toBeLessThanOrEqual(12);
		expect(rowAlignment.settingsInsideBar).toBeTruthy();
		expect(rowAlignment.accountInsideBar).toBeTruthy();
	  } else if (rowAlignment.oneLine) {
		for (const delta of rowAlignment.rowTopDeltas) expect(delta).toBeLessThanOrEqual(1);
		expect(rowAlignment.commandBarHeight).toBeLessThanOrEqual(64);
		expect(rowAlignment.submitAccountGap).toBeGreaterThanOrEqual(0);
		expect(rowAlignment.submitAccountGap).toBeLessThanOrEqual(8);
	  } else {
		if (rowAlignment.family === 'jlpt') {
		  for (const delta of rowAlignment.categoryDeltas) expect(delta).toBeLessThanOrEqual(1);
		  expect(rowAlignment.answerCardLeftDelta).toBeLessThanOrEqual(1);
		}
		expect(rowAlignment.answerCardWidthDelta).toBeLessThanOrEqual(1);
		expect(rowAlignment.submitLeftDelta).toBeLessThanOrEqual(1);
	  }
	  if (rowAlignment.submitVisible) expect(rowAlignment.submitWidthDelta).toBeLessThanOrEqual(1);

	  if (viewport.name === '桌面') {
		await page.locator('#width-slider').evaluate((slider) => {
		  slider.value = '640';
		  slider.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect(page.locator('#exam-workarea')).toHaveAttribute('data-width', '640');
		const narrowed = await page.locator('#exam-command-bar').evaluate((bar) => {
		  const boxes = [
			...document.querySelectorAll('#exam-controls .category-dropdown-label'),
			document.getElementById('open-question-map'),
			document.getElementById('submit-exam')
		  ].filter(Boolean).map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
		  const account = document.getElementById('user-menu-trigger').getBoundingClientRect();
		  const settings = document.getElementById('exam-settings-toggle').getBoundingClientRect();
		  const range = document.getElementById('width-slider').getBoundingClientRect();
		  const question = document.getElementById('current-question-container').getBoundingClientRect();
		  const barBox = bar.getBoundingClientRect();
		  return {
			barHeight: barBox.height,
			oneRow: boxes.every((box) => Math.abs(box.top - boxes[0].top) <= 1),
			leftAligned: boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right),
			accountInside: account.left >= barBox.left && account.right <= barBox.right,
			settingsInside: settings.left >= barBox.left && settings.right <= barBox.right,
			settingsVisible: settings.width > 0 && settings.height > 0,
			settingsBelowAccount: settings.top >= account.bottom,
			settingsAccountLeftDelta: Math.abs(settings.left - account.left),
			toolbarToSliderGap: range.top - barBox.bottom,
			sliderToQuestionGap: question.top - range.bottom,
			sliderSettingsGap: settings.left - range.right,
			widthLabelAbsent: !document.getElementById('width-value-label'),
			themeHidden: getComputedStyle(document.getElementById('theme-toggle')).display === 'none',
			legacyHidden: ['toggle-answers', 'toggle-explanations', 'toggle-reading-kana', 'toggle-reading-zh']
			  .every((id) => getComputedStyle(document.getElementById(id)).display === 'none')
		  };
		});
		expect(narrowed).toMatchObject({
		  oneRow: true,
		  leftAligned: true,
		  accountInside: true,
		  settingsInside: true,
		  settingsVisible: true,
		  settingsBelowAccount: true,
		  widthLabelAbsent: true,
		  themeHidden: true,
		  legacyHidden: true
		});
		expect(narrowed.settingsAccountLeftDelta).toBeLessThanOrEqual(1);
		expect(narrowed.barHeight).toBeLessThanOrEqual(64);
		expect(narrowed.toolbarToSliderGap).toBeGreaterThanOrEqual(4);
		expect(narrowed.toolbarToSliderGap).toBeLessThanOrEqual(10);
		expect(narrowed.sliderToQuestionGap).toBeGreaterThanOrEqual(4);
		expect(narrowed.sliderToQuestionGap).toBeLessThanOrEqual(10);
		expect(narrowed.sliderSettingsGap).toBeGreaterThanOrEqual(8);

		await page.locator('#width-slider').evaluate((slider) => {
		  slider.value = '440';
		  slider.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect(page.locator('#exam-workarea')).toHaveAttribute('data-width', '440');
		const compactDeadZone = await page.locator('#exam-command-bar').evaluate((bar) => {
		  const barBox = bar.getBoundingClientRect();
		  const accountBox = document.getElementById('user-menu-trigger').getBoundingClientRect();
		  const primaryControls = [
			...document.querySelectorAll('#exam-controls .category-dropdown-label'),
			document.getElementById('open-question-map'),
			document.getElementById('submit-exam')
		  ].filter((element) => element && getComputedStyle(element).display !== 'none')
			.map((element) => element.getBoundingClientRect());
		  return {
			barHeight: barBox.height,
			controlsInside: primaryControls.every((box) => box.left >= barBox.left && box.right <= accountBox.left - 6),
			settingsVisible: document.getElementById('exam-settings-toggle').getBoundingClientRect().width > 0,
			themeHidden: getComputedStyle(document.getElementById('theme-toggle')).display === 'none',
			legacyHidden: ['toggle-answers', 'toggle-explanations', 'toggle-reading-kana', 'toggle-reading-zh']
			  .every((id) => getComputedStyle(document.getElementById(id)).display === 'none')
		  };
		});
		expect(compactDeadZone).toMatchObject({
		  controlsInside: true,
		  settingsVisible: true,
		  themeHidden: true,
		  legacyHidden: true
		});
		expect(compactDeadZone.barHeight).toBeLessThanOrEqual(64);
	  }
    }

	const navigationLayout = await page.locator('#question-navigation').evaluate((navigation) => {
	  const viewportHeight = document.documentElement.clientHeight;
	  const navigationBox = navigation.getBoundingClientRect();
	  const workareaBox = document.getElementById('exam-workarea').getBoundingClientRect();
	  const accountBox = document.getElementById('user-menu-trigger').getBoundingClientRect();
	  const groupBox = navigation.querySelector('.question-nav').getBoundingClientRect();
	  const buttons = [...navigation.querySelectorAll('.nav-btn')].map((button) => button.getBoundingClientRect());
	  return {
		workareaRightInset: workareaBox.right - navigationBox.right,
		accountRightDelta: Math.abs(navigationBox.right - accountBox.right),
		bottomGap: viewportHeight - navigationBox.bottom,
		groupWidth: groupBox.width,
		buttonWidthDelta: Math.abs(buttons[0].width - buttons[1].width),
		buttonHeightDelta: Math.abs(buttons[0].height - buttons[1].height),
		buttonWidth: buttons[0].width,
		buttonHeight: buttons[0].height,
		transparentBackground: window.getComputedStyle(navigation).backgroundColor === 'rgba(0, 0, 0, 0)'
	  };
	});
	expect(navigationLayout.workareaRightInset).toBeGreaterThanOrEqual(0);
	expect(navigationLayout.workareaRightInset).toBeLessThanOrEqual(20);
	expect(navigationLayout.accountRightDelta).toBeLessThanOrEqual(1);
	expect(navigationLayout.bottomGap).toBeGreaterThanOrEqual(29);
	expect(navigationLayout.bottomGap).toBeLessThanOrEqual(31);
	expect(navigationLayout.groupWidth).toBeGreaterThanOrEqual(190);
	expect(navigationLayout.groupWidth).toBeLessThanOrEqual(192);
	expect(navigationLayout.buttonWidthDelta).toBeLessThanOrEqual(1);
	expect(navigationLayout.buttonHeightDelta).toBeLessThanOrEqual(1);
	expect(navigationLayout.buttonWidth).toBeGreaterThanOrEqual(88);
	expect(navigationLayout.buttonWidth).toBeLessThanOrEqual(89);
	expect(navigationLayout.buttonHeight).toBeGreaterThanOrEqual(40);
	expect(navigationLayout.buttonHeight).toBeLessThanOrEqual(41);
	expect(navigationLayout.transparentBackground).toBe(true);

    if (viewport.width <= 520) {
      const widthUsage = await page.locator('.current-question').evaluate((card) => {
        const option = card.querySelector('.option');
        const question = card.querySelector('.question');
        const usableContent = option || question;
        const cardBox = card.getBoundingClientRect();
        const usableContentBox = usableContent.getBoundingClientRect();
        const toolbarBox = document.querySelector('#exam-command-bar').getBoundingClientRect();
        const settingsBox = document.querySelector('#exam-settings-toggle').getBoundingClientRect();
        const accountBox = document.querySelector('#user-menu-trigger').getBoundingClientRect();
        const rangeBox = document.querySelector('#width-slider').getBoundingClientRect();
        return {
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
          cardLeft: cardBox.left,
          cardRightGap: document.documentElement.clientWidth - cardBox.right,
          cardTop: cardBox.top,
          toolbarHeight: toolbarBox.height,
          usableContentWidth: usableContentBox.width,
          questionPaddingLeft: window.getComputedStyle(question).paddingLeft,
          topPrevExists: Boolean(document.querySelector('#top-prev')),
          topNextExists: Boolean(document.querySelector('#top-next')),
          settingsVisible: settingsBox.width > 0 && settingsBox.height > 0,
          settingsBelowAccount: settingsBox.top >= accountBox.bottom,
          settingsAccountLeftDelta: Math.abs(settingsBox.left - accountBox.left),
          rangeVisible: rangeBox.width > 0 && rangeBox.height > 0,
          rangeSettingsGap: settingsBox.left - rangeBox.right,
          examTitleExists: Boolean(document.querySelector('.exam-title')),
          timerBarExists: Boolean(document.querySelector('#exam-timer-bar')),
          examHeaderDisplay: window.getComputedStyle(document.querySelector('#exam-header')).display,
          paperSelectVisible: document.querySelector('#exam-paper-select').getBoundingClientRect().width > 0,
          paperToggleVisible: document.querySelector('#mobile-paper-toggle').getBoundingClientRect().width > 0,
          legacyVisible: ['toggle-answers', 'toggle-explanations', 'toggle-reading-kana', 'toggle-reading-zh', 'mobile-tools-toggle']
            .some((id) => document.getElementById(id).getBoundingClientRect().width > 0)
        };
      });
      expect(widthUsage.cardLeft).toBeLessThanOrEqual(5);
      expect(widthUsage.cardRightGap).toBeLessThanOrEqual(5);
      expect(widthUsage.cardTop).toBeLessThan(widthUsage.viewportHeight * 0.6);
      expect(widthUsage.toolbarHeight).toBeLessThanOrEqual(90);
      expect(widthUsage.usableContentWidth).toBeGreaterThanOrEqual(widthUsage.viewportWidth * 0.9);
      expect(widthUsage.questionPaddingLeft).toBe('0px');
      expect(widthUsage.topPrevExists).toBe(false);
      expect(widthUsage.topNextExists).toBe(false);
      expect(widthUsage.settingsVisible).toBe(true);
      expect(widthUsage.settingsBelowAccount).toBe(true);
      expect(widthUsage.settingsAccountLeftDelta).toBeLessThanOrEqual(1);
      expect(widthUsage.rangeVisible).toBe(true);
      expect(widthUsage.rangeSettingsGap).toBeGreaterThanOrEqual(8);
      expect(widthUsage.examTitleExists).toBe(false);
      expect(widthUsage.timerBarExists).toBe(false);
      expect(widthUsage.examHeaderDisplay).toBe('none');
      expect(widthUsage.paperSelectVisible).toBe(false);
      expect(widthUsage.paperToggleVisible).toBe(false);
      expect(widthUsage.legacyVisible).toBe(false);

      const toolbarAlignment = await page.locator('#exam-controls').evaluate((controls) => {
        const categories = Array.from(controls.querySelectorAll('.category-slot'))
		  .map((slot) => slot.querySelector('.category-dropdown-label'))
		  .filter(Boolean)
		  .map((label) => label.getBoundingClientRect());
		const answerCard = document.getElementById('open-question-map').getBoundingClientRect();
		return {
		  oneRow: [...categories.slice(0, 3), answerCard].every((box) => Math.abs(box.top - categories[0].top) <= 1),
		  ordered: [...categories.slice(0, 3), answerCard].every((box, index, boxes) => index === 0 || box.left >= boxes[index - 1].right),
		  answerCardIconVisible: document.querySelector('#open-question-map .answer-card-icon').getBoundingClientRect().width > 0,
		  answerCardTextVisible: document.querySelector('#open-question-map .answer-card-text').getBoundingClientRect().width > 0
		};
      });
	  expect(toolbarAlignment).toEqual({
		oneRow: true,
		ordered: true,
		answerCardIconVisible: true,
		answerCardTextVisible: false
	  });

	  const settingsToggle = page.locator('#exam-settings-toggle');
	  await settingsToggle.click();
	  await expect(page.locator('#exam-family-select')).toBeVisible();
	  await expect(page.locator('#exam-paper-select')).toBeVisible();
	  await expect(page.locator('#exam-mode-select')).toBeVisible();
	  await expect(page.locator('#theme-mode-select')).toBeVisible();
	  await settingsToggle.click();
    }

    const instructionToggle = page.locator('.section-instruction-toggle').first();
    await expect(instructionToggle).toHaveAttribute('aria-expanded', 'false');
    const collapsedInstruction = await instructionToggle.locator('.section-instruction-text').evaluate((text) => ({
      whiteSpace: window.getComputedStyle(text).whiteSpace,
      lineHeight: Number.parseFloat(window.getComputedStyle(text).lineHeight),
      height: text.getBoundingClientRect().height,
      overflowing: text.scrollWidth > text.clientWidth
    }));
    expect(collapsedInstruction.whiteSpace).toBe('nowrap');
    expect(collapsedInstruction.height).toBeLessThanOrEqual(collapsedInstruction.lineHeight + 1);
    await instructionToggle.click();
    await expect(instructionToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(instructionToggle.locator('.section-instruction-action')).toHaveText('收起');
    await instructionToggle.click();
    await expect(instructionToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(instructionToggle.locator('.section-instruction-action')).toHaveText('展开');

    // 产品优化层不能覆盖答题区既有的蓝色主题。
    await expect(page.locator('#submit-exam')).toHaveCSS('background-color', 'rgb(0, 122, 204)');
	await expect(page.locator('#toggle-answers')).toHaveCSS('background-color', 'rgb(232, 232, 232)');
	const compactSettingsToggle = page.locator('#exam-settings-toggle');
	const desktopLearningTools = page.locator('#learning-tools-toggle');
	if (await compactSettingsToggle.isVisible()) {
	  await compactSettingsToggle.click();
	  await page.locator('#learning-menu-answers').click();
	  await expect(page.locator('#learning-menu-answers')).toHaveCSS('background-color', 'rgb(0, 122, 204)');
	  await compactSettingsToggle.click();
	} else if (await desktopLearningTools.isVisible()) {
	  await desktopLearningTools.click();
	  await page.locator('#learning-menu-answers').click();
	  await expect(page.locator('#learning-menu-answers')).toHaveCSS('background-color', 'rgb(0, 122, 204)');
	  await expect(desktopLearningTools).toHaveAttribute('aria-label', /已开启 1 项/);
	} else {
	  await page.locator('#toggle-answers').click();
	  await expect(page.locator('#toggle-answers')).toHaveCSS('background-color', 'rgb(0, 122, 204)');
	}

    await page.locator('#open-question-map').click();
    await expect(page.locator('#question-map-overlay')).toBeVisible();
    await expectViewportLayout(page, '#question-map-overlay', `${viewport.name} 答题卡`, viewport.width <= 520);
    if (viewport.width <= 520) {
      const mapMetrics = await page.locator('#question-map-content').evaluate((content) => {
        const dialog = content.parentElement;
        const current = content.querySelector('.question-map-item.current');
        const firstGrid = content.querySelector('.question-map-section-questions');
        return {
          contentClientWidth: content.clientWidth,
          contentScrollWidth: content.scrollWidth,
          dialogClientWidth: dialog.clientWidth,
          dialogScrollWidth: dialog.scrollWidth,
          itemHeight: current.getBoundingClientRect().height,
          outlineStyle: window.getComputedStyle(current).outlineStyle,
          boxShadow: window.getComputedStyle(current).boxShadow,
          gridColumns: window.getComputedStyle(firstGrid).gridTemplateColumns.split(' ').length
        };
      });
      expect(mapMetrics.contentScrollWidth).toBeLessThanOrEqual(mapMetrics.contentClientWidth + 1);
      expect(mapMetrics.dialogScrollWidth).toBeLessThanOrEqual(mapMetrics.dialogClientWidth + 1);
      expect(mapMetrics.itemHeight).toBeLessThanOrEqual(40);
      expect(mapMetrics.outlineStyle).toBe('none');
      expect(mapMetrics.boxShadow).not.toBe('none');
      expect(mapMetrics.gridColumns).toBe(6);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#question-map-overlay')).toBeHidden();
  });
}

test('听力音频支持手机浏览器所需的分段加载', async ({ request }) => {
  const audioPath = encodeURI('/data/audio/jlpt/n1/2025_07/2025年07月N1真题_2.01_01.mp3');
  const response = await request.get(audioPath, { headers: { Range: 'bytes=0-1023' } });
  expect(response.status()).toBe(206);
  expect(response.headers()['content-type']).toContain('audio/mpeg');
  expect(response.headers()['accept-range'] || response.headers()['accept-ranges']).toBe('bytes');
  expect(response.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
  expect((await response.body()).length).toBe(1024);
});
