const { test, expect } = require('@playwright/test');
const { clearBrowserSession, expectGuestEntry, stubNoisyPersonalCenterApis } = require('./helpers/session');

const viewports = [
  { name: '手机', width: 390, height: 844 },
  { name: '窄桌面', width: 842, height: 900 },
  { name: '桌面', width: 1440, height: 1100 }
];

const studentModals = [
  { intent: 'openReviewWorkbench', id: '#review-workbench-modal' },
  { intent: 'openChapterPath', id: '#chapter-modal' },
  { intent: 'openLearningReport', id: '#learning-report-modal' },
  { intent: 'openStudyGoal', id: '#study-goal-modal' }
];

const reviewLibraryModals = [
  { intent: 'openWrongQuestions', id: '#wq-modal' },
  { intent: 'openVocabNotebook', id: '#vocab-modal' }
];

async function loginStudent(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await stubNoisyPersonalCenterApis(page);
  await (await expectGuestEntry(page)).click();
  await page.locator('[data-dev-login="student_demo"]').click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await page.evaluate(() => window.openPersonalCenter?.());
  await expect(page.locator('#platform-admin-shell')).toBeVisible();
}

async function expectModalLayout(page, selector, mobile) {
  const issues = await page.locator(selector).evaluate((modal, isMobile) => {
    const panel = modal.querySelector('.pc-legacy-modal-panel, .pc-confirm-dialog');
    if (!panel) return ['缺少标准弹窗面板'];
    const box = panel.getBoundingClientRect();
    const problems = [];
    if (box.left < -1 || box.top < -1 || box.right > window.innerWidth + 1 || box.bottom > window.innerHeight + 1) {
      problems.push(`面板越过视口 ${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`);
    }
    if (panel.scrollWidth > panel.clientWidth + 1) {
      problems.push(`面板横向溢出 ${panel.scrollWidth}/${panel.clientWidth}`);
    }
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const controlBox = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && controlBox.width > 0 && controlBox.height > 0;
    };
    for (const control of Array.from(panel.querySelectorAll('button,input,select,textarea')).filter(visible)) {
      const controlBox = control.getBoundingClientRect();
      if (controlBox.left < box.left - 1 || controlBox.right > box.right + 1) {
        problems.push(`控件越界 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName}`);
      }
      const minimum = isMobile ? 40 : 24;
      if (controlBox.width < 24 || controlBox.height < minimum) {
        problems.push(`控件过小 ${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName} ${Math.round(controlBox.width)}x${Math.round(controlBox.height)}`);
      }
    }
    return problems.slice(0, 20);
  }, mobile);
  expect(issues, selector).toEqual([]);
}

for (const viewport of viewports) {
  test(`${viewport.name} 学员功能弹窗均可见、可关闭且不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginStudent(page);

    for (const item of studentModals) {
      const trigger = page.locator(`#platform-admin-shell [data-role-admin-intent="${item.intent}"]`).first();
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.locator(item.id)).toBeVisible({ timeout: 20000 });
      await expectModalLayout(page, item.id, viewport.width <= 520);
      await page.keyboard.press('Escape');
      await expect(page.locator(item.id)).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    // 错题本和生词本已经收拢到“复习资料”，按用户真实可达路径审计弹窗。
    await page.locator('#platform-admin-shell').getByRole('button', { name: '复习资料', exact: true }).click();
    for (const item of reviewLibraryModals) {
      const trigger = page.locator(`#platform-admin-shell [data-intent="${item.intent}"]`).first();
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.locator(item.id)).toBeVisible({ timeout: 20000 });
      await expectModalLayout(page, item.id, viewport.width <= 520);
      await page.keyboard.press('Escape');
      await expect(page.locator(item.id)).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });
}
