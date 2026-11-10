const { test, expect } = require('@playwright/test');

test('各身份分组列表保留完整信息、键盘详情入口和空记录，窄屏不横向溢出', async ({ page }, info) => {
  await page.route('**/__grouped_records_probe__', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/role-workspace.css"><body class="light-theme"><main id="platform-admin-shell" style="padding:16px;box-sizing:border-box;width:100%"></main>' }));
  await page.goto('/__grouped_records_probe__');
  await page.evaluate(async () => {
    const { renderGroupedList } = await import('/static/app/viewer/personalCenter/groupedList.js');
    document.querySelector('main').innerHTML = renderGroupedList('学习组', [
      { title: '周末日语班 <N3> & 阅读', desc: '12 位学员 · 每周六 09:00 · 老师：王老师', meta: '已安排 8 节课 · 待批改 3 份', intent: 'openRoleContent:teacher-group:org:group' },
      { title: '机构全称_' + 'long_identifier_'.repeat(6), desc: 'PRO · 32 位成员 · 付费席位 30 / 50', meta: '已暂停 · 2026/12/31 到期', intent: 'openRoleContent:platform-org-detail:org' },
      { title: '暂无记录', desc: '分配学习组后会显示在这里。' },
      { title: '日语 20 课时', desc: '日语 · 20 课时', meta: '已停用', action: { attribute: 'data-role-home-package-edit', value: 'course-20', organizationId: 'org-1' } }
    ]);
    window.selected = '';
    document.addEventListener('click', e => { const target = e.target.closest('[data-intent]'); if (target) window.selected = target.dataset.intent; });
  });
  for (const role of ['student','teacher','assistant','orgAdmin','orgContentAdmin','contentAdmin','superAdmin']) {
    await page.locator('main').evaluate((el, role) => el.dataset.learningRole = role, role);
    for (const width of [1440,390]) {
      await page.setViewportSize({ width, height: 844 });
      const row = page.getByRole('button').first();
      await expect(row).toContainText('周末日语班 <N3> & 阅读');
      await expect(row).toContainText('待批改 3 份');
      expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await row.focus(); await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.selected)).toBe('openRoleContent:teacher-group:org:group');
      await expect(page.locator('.pc-grouped-arrow')).toHaveCount(3);
      await expect(page.getByRole('button').nth(1)).toContainText('已暂停');
      await expect(page.locator('[data-role-home-package-edit]')).toHaveAttribute('data-org-id', 'org-1');
      await expect(page.locator('[data-role-home-package-edit]')).toContainText('已停用');
      expect(await page.locator('.pc-grouped-card').evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px');
      expect(await page.locator('main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator('.pc-grouped-list').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.screenshot({ path: info.outputPath('grouped-records-mobile-light.png') });
  await page.evaluate(() => document.body.classList.remove('light-theme'));
  const colors = await page.locator('.pc-grouped-entry').first().evaluate(el => ({ text: getComputedStyle(el).color, surface: getComputedStyle(document.querySelector('.pc-grouped-card')).backgroundColor }));
  expect(colors.text).not.toBe('rgb(38, 34, 31)');
  await page.screenshot({ path: info.outputPath('grouped-records-mobile-dark.png') });
});
