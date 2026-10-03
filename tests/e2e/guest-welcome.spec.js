const { test, expect } = require('@playwright/test');

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
  const desktopHome = await page.locator('.ls-guest-rail [data-ls-guest-action="home"]').boundingBox();
  expect(desktopAccount.y + desktopAccount.height / 2).toBe(desktopHome.y + desktopHome.height / 2);
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
  await page.locator('.ls-guest-rail [data-ls-guest-action="experience"]').click();
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
  await expect(page.locator('.ls-rail [data-ls-group="study"]')).toBeVisible();
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
  await expect(page.locator('.ls-guest-rail button')).toHaveCount(3);
  const rail = page.locator('.ls-guest-rail');
  const menu = page.locator('.ls-menu');
  await expect(rail.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-current', 'page');
  await expect(rail.locator('[data-ls-guest-action="home"]')).toHaveCSS('background-color', 'rgb(226, 228, 231)');
  const railIcons = await rail.locator('button').all();
  const firstIcon = await railIcons[0].boundingBox();
  const secondIcon = await railIcons[1].boundingBox();
  expect(secondIcon.y - firstIcon.y).toBe(52);
  await expect(menu.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-current', 'page');
  expect(await root.evaluate(element => element.querySelector('.gw-experience').compareDocumentPosition(element.querySelector('.gw-goals')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(root.locator('.gw-experience')).toContainText('无需登录');
  await expect(page.locator('.ls-rail [data-ls-group="study"]')).toBeHidden();
  const layout = await root.locator('.gw-content').evaluate(element => {
    const style = getComputedStyle(element);
    return { textWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      background: style.backgroundColor, surround: getComputedStyle(element.parentElement).backgroundColor };
  });
  expect(layout.textWidth).toBe(754);
  expect(layout.background).toBe('rgb(255, 255, 255)');
  expect(layout.surround).toBe('rgb(241, 242, 244)');
  await page.locator('.ls-menu [data-ls-guest-action="eju"]').click();
  await expect(root.locator('[data-gw="eju"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(rail.locator('[data-ls-guest-action="exams"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.locator('[data-ls-guest-action="exams"]')).toHaveAttribute('aria-current', 'page');
  await expect(rail.locator('[data-ls-guest-action="home"]')).not.toHaveAttribute('aria-current', 'page');
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
  await page.locator('.ls-menu [data-ls-guest-action="experience"]').click();
  await expect(page.locator('.ls-menu')).toBeHidden();
  await expect(root.locator('.gw-passage')).toBeVisible();
  await expect(rail.locator('[data-ls-guest-action="experience"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.locator('[data-ls-guest-action="experience"]')).toHaveAttribute('aria-current', 'page');
  await expect(menu.locator('[data-ls-guest-action="experience"]')).toHaveAttribute('aria-current', 'page');
  await root.locator('[data-gw="home"]:visible').click();
  await expect(root.locator('h1')).toHaveText('把日语一点点学会');
  await expect(rail.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rail.locator('[data-ls-guest-action="home"]')).toHaveAttribute('aria-current', 'page');
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
