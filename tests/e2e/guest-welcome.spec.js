const { test, expect } = require('@playwright/test');

test('手机在没有原生 randomUUID 时仍可打开首页', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('#guest-welcome .gw-account-trigger')).toBeVisible();
  await page.locator('#guest-welcome .gw-account-trigger').click();
  await expect(page.locator('#login-modal')).toBeVisible();
});

test('访客首页刷新和滚动后保持全宽顶栏', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 500 });
  await page.goto('/');
  const topbar = page.locator('#learning-topbar');
  const root = page.locator('#guest-welcome');
  const login = root.locator('.gw-account-trigger');

  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(topbar.locator('.ls-mobile-toggle')).toBeVisible();
    await expect(login).toBeVisible();
    const bar = await topbar.boundingBox();
    const menu = await page.locator('.ls-menu').boundingBox();
    const content = await root.boundingBox();
    const paper = await root.locator('.gw-content').boundingBox();
    const account = await login.boundingBox();
    expect(bar.y).toBe(0);
    expect(bar.height).toBe(44);
    expect(bar.x).toBe(0);
    expect(bar.width).toBeGreaterThanOrEqual(1580);
    expect(Math.abs(paper.x + paper.width - account.x - account.width)).toBeLessThanOrEqual(16);
    expect(menu.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(content.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await root.evaluate((element) => { element.scrollTop = 300; });
    expect((await topbar.boundingBox()).y).toBe(bar.y);
    if (attempt === 0) await page.reload();
  }

  await topbar.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(topbar).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(topbar.locator('.ls-mobile-toggle')).toBeVisible();
  await expect(login).toBeVisible();
  const mobilePaper = await root.locator('.gw-content').boundingBox();
  const mobileAccount = await login.boundingBox();
  expect((await topbar.boundingBox()).height).toBe(44);
  expect(Math.abs(mobilePaper.x + mobilePaper.width - mobileAccount.x - mobileAccount.width)).toBeLessThanOrEqual(16);
  await login.click();
  await expect(page.locator('#login-modal')).toBeVisible();
});

test('试卷按年份分组，较早年份可展开且保持试卷与题型选择', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  await root.locator('[data-gw="jlpt"]').click();
  await root.locator('[data-gw="target"][data-target="JLPT N1"]').click();
  await root.locator('[data-gw="browse"][data-domain="阅读"]').click();
  await expect(root.locator('.gw-year-group[data-year="2021"]')).toBeVisible();
  const years = await root.locator('.gw-year-group').evaluateAll(items => items.map(item => Number(item.dataset.year)));
  expect(years).toEqual([...years].sort((a, b) => b - a));
  await expect(root.locator('.gw-year-group:visible')).toHaveCount(years.filter(year => year >= 2021).length);
  expect(await root.locator('.gw-earlier-years .gw-year-group').evaluateAll(items => items.every(item => Number(item.dataset.year) < 2021))).toBeTruthy();
  await expect(root.locator('[data-gw="paper"]').first()).toHaveText(/^\d+月\s*→$/);
  await expect(root.locator('.gw-earlier-years')).not.toHaveAttribute('open', '');
  await root.locator('.gw-earlier-years summary').click();
  await expect(root.locator('.gw-year-group:visible')).toHaveCount(years.length);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  const olderPaper = root.locator('.gw-earlier-years [data-gw="paper"]').first();
  const id = await olderPaper.getAttribute('data-exam');
  await olderPaper.click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(root).toBeHidden();
  expect(await page.evaluate(() => window.examViewer._currentExamId)).toBe(id);
  await page.locator('.ls-mobile-toggle').click();
  await page.locator('.gw-return').click();
  await root.locator('[data-gw="eju"]').click();
  await root.locator('[data-gw="browse"][data-domain="读解"]').click();
  await expect(root.locator('[data-gw="paper"]').first()).toHaveText(/^第[12]回\s*→$/);
  await expect(root.locator('.gw-year-group[data-year="2021"]')).toBeVisible();
  expect(await root.locator('.gw-year-group:visible').evaluateAll(items => items.every(item => Number(item.dataset.year) >= 2021))).toBeTruthy();
  await expect(root.locator('.gw-earlier-years')).not.toHaveAttribute('open', '');
  expect(await root.locator('.gw-earlier-years .gw-year-group').evaluateAll(items => items.every(item => Number(item.dataset.year) < 2021))).toBeTruthy();
});

test('中间栏只保留考试入口，右侧橙色选择并显示最终题型摘要', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  const menu = page.locator('.ls-menu');
  await menu.locator('[data-ls-guest-action="jlpt"]').click();
  await expect(menu.locator('[data-gw="target"], [data-gw="browse"], [data-gw="paper"]')).toHaveCount(0);
  await expect(root.locator('[data-gw="jlpt"]')).toHaveAttribute('aria-expanded', 'true');
  await root.locator('[data-gw="target"][data-target="JLPT N3"]').click();
  await expect(root.locator('.gw-levels [aria-pressed="true"]')).toHaveCSS('background-color', 'rgb(255, 243, 233)');
  await root.locator('[data-gw="browse"][data-domain="阅读"]').click();
  await expect(root.locator('.gw-selected-context')).toContainText('JLPT N3 · 阅读');
  await expect(root.locator('.gw-selected-context')).toHaveCSS('background-color', 'rgb(255, 243, 233)');
  await root.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(root).toBeHidden();
  await expect(page.locator('#ls-current-paper')).toBeVisible();
  await expect(menu.locator('.ls-selected-summary[data-family="jlpt"]')).toContainText('阅读');
  await expect(menu.locator('[data-gw="target"], [data-gw="browse"], [data-gw="paper"]')).toHaveCount(0);
});

test('手机选择EJU后收起导航，在内容栏选择题型和试卷', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.ls-mobile-toggle').click();
  const menu = page.locator('.ls-menu');
  await menu.locator('[data-ls-guest-action="eju"]').click();
  await expect(menu).toBeHidden();
  const root = page.locator('#guest-welcome');
  await expect(root.locator('[data-gw="eju"]')).toHaveAttribute('aria-expanded', 'true');
  await root.locator('[data-gw="browse"][data-domain="听读解"]').click();
  await expect(root.locator('.gw-selected-context')).toContainText('听读解');
  await root.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(root).toBeHidden();
  await expect(menu).toBeHidden();
});

test('窄屏游客菜单点击外侧即可收起', async ({ page }) => {
  for (const width of [740, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const toggle = page.locator('.ls-mobile-toggle');
    await toggle.click();
    const icon = await toggle.locator('.ls-mobile-toggle-mark').evaluate(element => ({
      topWidth: getComputedStyle(element, '::before').width,
      middle: getComputedStyle(element, '::before').boxShadow,
      bottomWidth: getComputedStyle(element, '::after').width,
    }));
    expect(icon.topWidth).toBe('20px');
    expect(icon.middle).not.toBe('none');
    expect(icon.bottomWidth).toBe('20px');
    await expect(page.locator('.ls-menu')).toBeVisible();
    await expect(page.locator('.ls-backdrop')).toBeVisible();
    await page.locator('.ls-backdrop').click({ position: { x: width - 12, y: 200 } });
    await expect(page.locator('.ls-menu')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
});

test('游客侧栏可收起并在首页与试卷页重新展开', async ({ page }) => {
  for (const width of [1600, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const collapse = page.locator('.ls-menu footer .ls-collapse');
    const reopen = page.locator('.ls-mobile-toggle');
    await expect(collapse).toBeVisible();
    await expect(collapse).toContainText('收起');
    await collapse.click();
    await expect(page.locator('.ls-menu')).toBeHidden();
    await expect(page.locator('#guest-welcome')).toHaveJSProperty('offsetLeft', Math.max(0, (width - 994) / 2));
    await expect(reopen).toBeVisible();
    await expect(reopen).toHaveAttribute('aria-label', '展开功能菜单');
    const icon = await reopen.locator('.ls-mobile-toggle-mark').evaluate(element => ({
      width: element.getBoundingClientRect().width,
      topWidth: getComputedStyle(element, '::before').width,
      middle: getComputedStyle(element, '::before').boxShadow,
      bottomWidth: getComputedStyle(element, '::after').width,
    }));
    expect(icon.width).toBe(20);
    expect(icon.topWidth).toBe('20px');
    expect(icon.middle).not.toBe('none');
    expect(icon.bottomWidth).toBe('20px');
    await reopen.click();
    await expect(page.locator('.ls-menu')).toBeVisible();
    await expect(page.locator('#guest-welcome')).toHaveJSProperty('offsetLeft', Math.max(0, (width - 240 - 994) / 2) + 240);
  }
  const home = page.locator('#guest-welcome');
  await home.locator('[data-gw="jlpt"]').click();
  await home.locator('[data-target="JLPT N3"]').click();
  await home.locator('[data-gw="browse"]:visible').last().click();
  await home.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(home).toBeHidden();
  await page.locator('.ls-menu footer .ls-collapse').click();
  await expect(page.locator('#exam-content')).toHaveCSS('margin-left', '0px');
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await expect(page.locator('#exam-content')).toHaveCSS('margin-left', '240px');
});

test('登录遮罩覆盖导航和正文，关闭后恢复原页面操作', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  const guestAccount = root.locator('.gw-header [data-gw="login"]');
  await expect(guestAccount.locator('svg')).toBeVisible();
  await expect(guestAccount).toHaveAttribute('aria-label', '登录账号');
  const desktopAccount = await guestAccount.boundingBox();
  expect(desktopAccount.width).toBe(28);
  expect(desktopAccount.y).toBe(10);
  expect(1600 - desktopAccount.x - desktopAccount.width).toBe(10);
  await expect(page.locator('.ls-rail')).toBeHidden();
  expect((await page.locator('.ls-menu').boundingBox()).x).toBe(0);
  await root.locator('[data-gw="login"]').click();
  const modal = page.locator('#login-modal');
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(element => element.parentElement === document.body)).toBeTruthy();
  const covered = await page.evaluate(() => [
    [28, 36], [140, 120], [500, 120]
  ].every(([x, y]) => document.elementFromPoint(x, y)?.id === 'login-modal'));
  expect(covered).toBeTruthy();
  await page.mouse.click(28, 36);
  await expect(modal).toBeHidden();
  await expect(root.locator('h1')).toHaveText('把日语一点点学会');
  await page.locator('.ls-menu [data-ls-guest-action="experience"]').click();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await page.locator('.ls-menu [data-ls-guest-action="home"]').click();
  await expect(root.locator('.gw-goals')).toBeVisible();
  await expect(root.locator('.gw-passage')).toHaveCount(0);
  await page.locator('.ls-menu [data-ls-guest-action="experience"]').click();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.ls-menu')).toHaveCSS('border-radius', '0px');
  await expect(page.locator('.ls-menu')).toHaveCSS('top', '0px');
  await page.locator('.ls-menu [data-ls-guest-action="experience"]').click();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAccount = await guestAccount.boundingBox();
  expect(mobileAccount.width).toBe(24);
  expect(mobileAccount.y).toBe(6);
  expect(390 - mobileAccount.x - mobileAccount.width).toBe(6);
  await root.locator('[data-gw="login"]').click();
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => !!document.elementFromPoint(24, 18)?.closest('#login-modal'))).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
});

test('游客首页、体验作答、刷新恢复及登录后单题保存', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  await expect(root).toContainText('把日语一点点学会');
  await root.locator('[data-gw="jlpt"]').click();
  await expect(root.locator('[data-gw="jlpt"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(root.locator('h1')).toHaveText('把日语一点点学会');
  await expect(root.locator('.gw-levels button')).toHaveCount(3);
  await root.locator('[data-target="JLPT N3"]').click();
  await expect(root).toContainText('选择练习内容');
  await expect(root).toContainText('接下来选择年份和试卷，再开始作答。');
  await page.locator('.ls-menu [data-ls-guest-action="home"]').click();
  await root.locator('[data-gw="experience"]').click();
  await expect(root.locator('.gw-passage')).toContainText('朝日市');
  await expect(root.locator('[data-gw="check"]')).toBeDisabled();
  await root.locator('[data-answer="2"]').click();
  await root.locator('[data-gw="check"]').click();
  await expect(root.locator('.gw-result')).toContainText('答对了');
  await expect(root.locator('details')).not.toHaveAttribute('open', '');
  await page.reload();
  await root.locator('[data-gw="experience"]').click();
  await expect(root.locator('.gw-result')).toContainText('答对了');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/guest-experience-mobile.png' });
  const result = await page.evaluate(async () => {
    await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'student_demo', password: '' }) });
    const response = await fetch('/api/v1/me/context');
    const payload = await response.json();
    const context = payload.data || payload;
    localStorage.setItem('exam_v2_user', JSON.stringify({ ...context.user, guest: false, token: '', profile: context.profile, membership: context.membership, permissions: context.permissions }));
    const saved = JSON.parse(localStorage.getItem('japanese.guest-experience.v1'));
    const submit = await fetch('/api/v1/me/experience', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_id: 59, answer: saved.answer, submission_id: saved.id }) });
    return { status: submit.status, body: await submit.json() };
  });
  expect(result.status).toBe(200);
  expect((result.body.data || result.body).statistics.total_questions).toBe(1);
  await page.reload();
  await expect(root).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/ls-guest-navigation/);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator('.ls-menu > [data-ls-group="study"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('japanese.guest-experience.v1'))).toBeNull();
});

test('N3 单题只可完成一次，仍可继续体验 JLPT 和 EJU', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  await root.locator('[data-gw="experience"]').click();
  await root.locator('[data-gw="answer"]').first().click();
  await root.locator('[data-gw="check"]').click();
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('experience').remaining)).toBe(0);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('jlpt').remaining)).toBe(1);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(1);
  await expect(root.getByRole('button', { name: '登录后再试' })).toBeVisible();
  await root.locator('[data-gw="home"]:visible').first().click();
  await expect(root.locator('.gw-history-row')).toHaveCount(1);
  expect(await root.evaluate(element => Boolean(element.querySelector('.gw-goals').compareDocumentPosition(element.querySelector('.gw-history')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
  await page.reload();
  await expect(root.locator('.gw-history-row')).toHaveCount(1);
  await root.locator('[data-gw="review-experience"]').click();
  await expect(root.locator('.gw-result')).toBeVisible();
  await root.locator('[data-gw="home"]:visible').first().click();
  await root.locator('[data-gw="jlpt"]').click();
  await root.locator('[data-target="JLPT N3"]').click();
  await root.locator('[data-gw="browse"][data-domain="阅读"]').click();
  await expect(root.locator('h1')).toHaveText('选择试卷');
});

test('访客体验次数随临时结果转存或到期而恢复', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('japanese.guest-practice-trials.v2', JSON.stringify({ jlpt: 'practice:jlpt-1', eju: 'practice:eju-1' }));
    localStorage.setItem('japanese.pending-practice-results.v1', JSON.stringify([
      { exam_id: 'JLPT-N3-2024_12', label: '词汇 / 语法', section_indexes: [0], answers: { '0:1': 1 }, submission_id: 'jlpt-1', created_at: Date.now() },
      { exam_id: 'EJU-JAPANESE-2024_01', label: '读解', section_indexes: [0], answers: { '0:1': 1 }, submission_id: 'eju-1', created_at: Date.now() }
    ]));
  });
  await page.reload();
  const root = page.locator('#guest-welcome');
  await expect(root.locator('.gw-history-row')).toHaveCount(2);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('jlpt').remaining)).toBe(0);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(0);

  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('japanese.pending-practice-results.v1'));
    records[1].created_at = Date.now() - 8 * 86400000;
    localStorage.setItem('japanese.pending-practice-results.v1', JSON.stringify(records));
  });
  await page.reload();
  await expect(root.locator('.gw-history-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(1);

  await page.evaluate(() => localStorage.removeItem('japanese.pending-practice-results.v1'));
  await page.reload();
  await expect(root.locator('.gw-history')).toHaveCount(0);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('jlpt').remaining)).toBe(1);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('eju').remaining)).toBe(1);
  await root.locator('[data-gw="jlpt"]').click();
  await root.locator('[data-gw="target"][data-target="JLPT N3"]').click();
  await root.locator('[data-gw="browse"][data-domain="阅读"]').click();
  await expect(root.locator('h1')).toHaveText('选择试卷');

  await page.evaluate(() => localStorage.setItem('japanese.guest-experience.v1', JSON.stringify({ sample: 0, answer: 1, checked: true, savedAt: Date.now(), id: 'experience-1', completed: [] })));
  await page.reload();
  await expect(root.locator('.gw-history-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('experience').remaining)).toBe(0);
  await page.evaluate(() => localStorage.removeItem('japanese.guest-experience.v1'));
  await page.reload();
  await expect(root.locator('[data-gw="experience"]')).toBeVisible();
  expect(await page.evaluate(() => window.GuestTrialQuota.guestTrialStatus('experience').remaining)).toBe(1);
  await root.locator('[data-gw="experience"]').click();
  await expect(root.locator('.gw-options')).toBeVisible();
});

test('游客导航与正文宽度、背景统一，手机菜单可进入体验', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  await expect(page.locator('.ls-rail')).toBeHidden();
  const menu = page.locator('.ls-menu');
  expect((await menu.boundingBox()).x).toBe((1600 - 240 - 994) / 2);
  for (const width of [2915, 1600, 1180, 820, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const menu = document.querySelector('.ls-menu').getBoundingClientRect();
      const content = document.querySelector('#guest-welcome').getBoundingClientRect();
      const menuStyle = getComputedStyle(document.querySelector('.ls-menu'));
      return { menuWidth: menu.width, menuRight: menu.right, menuBottom: menu.bottom, contentLeft: content.left, contentTop: content.top, contentRight: content.right, contentBottom: content.bottom,
        menuLeftBorder: menuStyle.borderLeftWidth, menuTopBorder: menuStyle.borderTopWidth, menuBottomBorder: menuStyle.borderBottomWidth,
        pageWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.menuWidth).toBe(240);
    expect(geometry.contentLeft).toBe(geometry.menuRight);
    expect(geometry.contentTop).toBe(44);
    expect(geometry.contentRight).toBe(width - Math.max(0, (width - 240 - 994) / 2));
    expect(geometry.contentRight - geometry.contentLeft).toBeLessThanOrEqual(994);
    expect(geometry.menuLeftBorder).toBe('0px');
    expect(geometry.menuTopBorder).toBe('0px');
    expect(geometry.menuBottomBorder).toBe('0px');
    expect(geometry.menuBottom).toBe(900);
    expect(geometry.contentBottom).toBe(900);
    expect(geometry.pageWidth).toBeLessThanOrEqual(width + 1);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(menu.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-current', 'page');
  const desktopTheme = await menu.locator('.ls-theme-trigger').boundingBox();
  const desktopCollapse = await menu.locator('footer .ls-collapse').boundingBox();
  expect(desktopTheme.y + desktopTheme.height).toBeLessThanOrEqual(desktopCollapse.y);
  expect(900 - desktopCollapse.y - desktopCollapse.height).toBeLessThanOrEqual(20);
  await expect(menu.locator('.ls-guest-root > .ls-guest-root-row [data-ls-guest-action="home"]')).toHaveText('首页');
  await expect(menu.locator('.ls-guest-home-links > [data-ls-guest-action="experience"]')).toHaveText('N3 短篇阅读体验');
  await expect(menu.locator('.ls-guest-home-links > .ls-guest-exams > [data-ls-guest-toggle="exams"]')).toHaveText('选择考试');
  await expect(menu.locator('.ls-guest-children > [data-ls-guest-action="jlpt"]')).toHaveText('JLPT');
  await expect(menu.locator('.ls-guest-children > [data-ls-guest-action="eju"]')).toHaveText('EJU');
  await expect(menu.locator('[data-ls-panel="guest"] > h2')).toHaveCount(0);
  const homeGroup = menu.locator('[data-ls-guest-toggle="home"]');
  await homeGroup.click();
  await expect(homeGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(menu.locator('[data-ls-guest-action="experience"]')).toBeHidden();
  await homeGroup.click();
  await expect(menu.locator('[data-ls-guest-action="experience"]')).toBeVisible();
  const examGroup = menu.locator('[data-ls-guest-toggle="exams"]');
  await expect(examGroup).toHaveAttribute('aria-expanded', 'true');
  expect(await examGroup.evaluate(element => Number(getComputedStyle(element, '::after').transform.match(/matrix\(([^,]+)/)?.[1]))).toBeLessThan(0);
  await examGroup.click();
  await expect(menu.locator('[data-ls-guest-action="jlpt"]')).toBeHidden();
  await expect(examGroup).toHaveAttribute('aria-expanded', 'false');
  expect(await examGroup.evaluate(element => Number(getComputedStyle(element, '::after').transform.match(/matrix\(([^,]+)/)?.[1]))).toBeGreaterThan(0);
  await examGroup.click();
  await expect(menu.locator('[data-ls-guest-action="jlpt"]')).toBeVisible();
  await expect(menu.locator('[data-ls-guest-action="home"]')).toHaveCSS('border-left-width', '0px');
  expect(await root.evaluate(element => element.querySelector('.gw-experience').compareDocumentPosition(element.querySelector('.gw-goals')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(root.locator('.gw-experience')).toContainText('无需登录');
  await expect(page.locator('.ls-menu > [data-ls-group="study"]')).toBeHidden();
  const layout = await root.locator('.gw-content').evaluate(element => {
    const style = getComputedStyle(element);
    return { textWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      background: style.backgroundColor, surround: getComputedStyle(element.parentElement).backgroundColor };
  });
  expect(layout.textWidth).toBe(754);
  expect(layout.background).toBe('rgb(255, 255, 255)');
  expect(layout.surround).toBe(layout.background);
  await page.locator('.ls-menu [data-ls-guest-action="eju"]').click();
  await expect(root.locator('[data-gw="eju"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('[data-ls-guest-action="eju"]')).toHaveAttribute('aria-current', 'page');
  await root.locator('[data-gw="jlpt"]').click();
  await root.locator('[data-target="JLPT N2"]').click();
  await expect(menu.locator('[data-ls-guest-action="jlpt"]')).toHaveAttribute('aria-current', 'page');
  await expect(menu.locator('[data-ls-guest-action="eju"]')).not.toHaveClass(/is-active/);
  await root.locator('[data-gw="browse"]:visible').last().click();
  await expect(root.locator('h1')).toHaveText('选择试卷');
  await expect(menu.locator('[data-ls-guest-action="jlpt"]')).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.ls-menu')).toBeHidden();
  await page.locator('.ls-mobile-toggle').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  const mobileTheme = await menu.locator('.ls-theme-trigger').boundingBox();
  expect(844 - mobileTheme.y - mobileTheme.height).toBeLessThanOrEqual(20);
  await page.locator('.ls-menu [data-ls-guest-action="experience"]').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await expect(menu.locator('[data-ls-guest-action="experience"]')).toHaveAttribute('aria-current', 'page');
  await root.locator('[data-gw="home"]:visible').click();
  await expect(root.locator('h1')).toHaveText('把日语一点点学会');
  await expect(menu.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-current', 'page');
  await expect(root.locator('[data-gw="jlpt"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(root.locator('[data-gw="login"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('游客可浏览当前等级及EJU试卷并返回首页', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('#guest-welcome');
  await root.locator('[data-gw="jlpt"]').click();
  await root.locator('[data-target="JLPT N3"]').click();
  await root.locator('[data-gw="browse"]:visible').last().click();
  await expect(root.locator('[data-gw="paper"]').first()).toBeVisible();
  await root.locator('[data-gw="paper"]').first().click();
  await page.locator('#guest-welcome .practice-start-btn').click();
  await expect(root).toBeHidden();
  await page.locator('.gw-return').click();
  await root.locator('[data-gw="eju"]').click();
  await expect(root.locator('#gw-jlpt-content')).toBeHidden();
  await expect(root).toContainText('听读解');
  await root.locator('[data-gw="browse"]:visible').last().click();
  await expect(root.locator('[data-gw="paper"]').first()).toBeVisible();
});
