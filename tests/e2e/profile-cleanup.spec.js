const { test, expect } = require('@playwright/test');
const { loginWithPassword, uniqueLoginId } = require('./helpers/session');
const fs = require('node:fs');
const path = require('node:path');
const artifacts = path.resolve(__dirname, '../../artifacts/avatar-all-20261103');
fs.mkdirSync(artifacts, { recursive: true });

async function profile(page, username = uniqueLoginId('student_profile')) {
  await loginWithPassword(page, username);
  await page.evaluate(() => window.openPersonalCenter());
  await page.waitForLoadState('networkidle');
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-account-destination=account-profile]').click();
  const root = page.locator('.pc-profile-page');
  await expect(root).toBeVisible();
  return root;
}

test('个人资料采用平铺白底，折叠区和头像在手机平板桌面均不溢出', async ({ page }) => {
  const root = await profile(page);
  await expect(root).not.toContainText('当前昵称');
  await expect(root).not.toContainText('最近登录');
  await expect(root.getByRole('button', { name: /^昵称/ })).toBeVisible();
  await expect(root.locator('#pc-display-name-input')).toHaveCount(0);
  const contacts = root.locator('[data-profile-section=contacts]');
  const avatar = root.locator('[data-profile-section=avatar]');
  await expect(contacts).not.toHaveAttribute('open', '');
  await expect(avatar).not.toHaveAttribute('open', '');
  await expect(contacts.locator('summary')).toContainText('未绑定');
  for (const width of [360, 540, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 540) await page.screenshot({ path: path.join(artifacts, 'profile-540.png') });
    await contacts.locator(':scope > summary').click();
    await expect(contacts.locator('.pc-verify-row-card')).toHaveCount(2);
    for (const card of await contacts.locator('.pc-verify-row-card').all()) {
      await expect(card).toHaveCSS('box-shadow', 'none');
      await expect(card).toHaveCSS('background-image', 'none');
      await expect(card).toHaveCSS('border-radius', '0px');
    }
    await avatar.locator(':scope > summary').click();
    const choices = root.locator('[data-profile-avatar-choices]');
    await expect(choices.locator('button')).toHaveCount(24);
    expect(await choices.locator('button').evaluateAll(buttons => new Set(buttons.map(button => button.dataset.styleKey)).size)).toBe(24);
    await expect(avatar).not.toContainText('更多风格');
    if ([360, 540, 768].includes(width)) await page.screenshot({ path: path.join(artifacts, `expanded-${width}.png`) });
    await expect(choices.locator('.pc-avatar-style-chip-img').first()).toHaveCSS('width', '40px');
    expect(await choices.evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBeGreaterThanOrEqual(4);
    if ([360, 540, 768].includes(width)) await avatar.screenshot({ path: path.join(artifacts, `avatar-${width}.png`) });
    expect(await page.locator('#platform-admin-shell main').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await avatar.locator(':scope > summary').click();
    await contacts.locator(':scope > summary').click();
  }
  await root.locator('[data-profile-destination=student-account-plan]').click();
  await expect(page.locator('[data-account-recharge-panel]')).toBeVisible();
  await page.locator('[data-workspace-back]').click();
  await expect(root).toBeVisible();
});

test('昵称从独立页面修改，保存和返回正确，重新加载仍保留资料', async ({ page }) => {
  let root = await profile(page);
  const name = `学习者_${Date.now().toString(36)}`;
  const nicknameRow = root.locator('[data-profile-destination=account-nickname]');
  const previousName = await nicknameRow.locator('strong').textContent();
  await page.setViewportSize({ width: 360, height: 740 });
  await nicknameRow.click();
  const input = page.getByRole('textbox', { name: '昵称', exact: true });
  await expect(page.getByRole('heading', { name: '修改昵称' })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(previousName);
  await page.getByRole('button', { name: '清空昵称' }).click();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: '返回个人资料' }).click();
  await expect(nicknameRow).toContainText(previousName);
  await nicknameRow.click();
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator('#pc-toast')).toContainText('昵称已保存');
  await expect(nicknameRow).toContainText(name);
  await expect(input).toHaveCount(0);
  await root.locator('[data-profile-section=avatar]>summary').click();
  const candidate = root.locator('[data-profile-avatar-choices] button').nth(2);
  const url = await candidate.getAttribute('data-profile-avatar-url');
  await candidate.click();
  await expect(root.locator('[data-profile-avatar-choices] button.active')).toHaveCount(1);
  await expect(root.locator('[data-profile-avatar-status]')).toContainText('尚未保存');
  await expect(root.locator('#pc-avatar-preview-chip img')).toHaveAttribute('src', url);
  await root.locator('#pc-avatar-apply').click();
  await expect(page.locator('#pc-toast')).toContainText('头像已更新');
  await expect(root.locator('[data-profile-avatar-status]')).toHaveText('当前头像');
  await expect(page.locator('.pc-platform-admin-avatar img')).toHaveAttribute('src', url);
  const stored = (await (await page.request.get('/api/v1/me/context')).json()).data;
  expect(JSON.stringify(stored.profile)).toContain(name);
  expect(JSON.stringify(stored.profile)).toContain(url);
  await page.reload();
  await page.waitForFunction(() => typeof window.openPersonalCenter === 'function');
  await page.evaluate(() => window.openPersonalCenter());
  await page.waitForLoadState('networkidle');
  await page.locator('[data-platform-admin-account-menu]').click();
  await page.locator('[data-account-destination=account-profile]').click();
  root = page.locator('.pc-profile-page');
  await expect(nicknameRow).toContainText(name);
  await root.locator('[data-profile-section=avatar]>summary').click();
  await expect(root.locator('#pc-avatar-preview-chip img')).toHaveAttribute('src', url);
  const first = root.locator('[data-profile-avatar-choices] button').first();
  const before = await first.getAttribute('data-profile-avatar-url');
  await root.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(first).not.toHaveAttribute('data-profile-avatar-url', before);
  const editor = page.locator('#pc-avatar-editor-page');
  const style = editor.getByLabel('头像风格');
  const preview = editor.getByAltText('头像预览');
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
    await root.getByRole('button', { name: '自定义', exact: true }).click();
    await expect(page.getByRole('heading', { name: '定制头像' })).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(page.locator('#pc-avatar-editor-modal')).toHaveCount(0);
    await expect(style.locator('option')).toHaveCount(24);
    await expect(editor.locator('#pc-editor-save')).toBeInViewport({ ratio: 1 });
    const fields = editor.locator('#pc-editor-tab-content select');
    const first = await fields.nth(0).boundingBox();
    const second = await fields.nth(1).boundingBox();
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeCloseTo(first.y, 0);
    expect(await editor.locator('.pc-avatar-editor-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const before = await preview.getAttribute('src');
    await style.selectOption('adventurer');
    await expect(preview).not.toHaveAttribute('src', before);
    const afterStyle = await preview.getAttribute('src');
    await editor.getByRole('button', { name: '随机头像' }).click();
    await expect(preview).not.toHaveAttribute('src', afterStyle);
    if (width === 360) {
      page.once('dialog', async dialog => { expect(dialog.message()).toContain('尚未保存'); await dialog.dismiss(); });
      await page.getByRole('button', { name: '返回个人资料' }).click();
      await expect(editor).toBeVisible();
      page.once('dialog', dialog => dialog.accept());
      await editor.getByRole('button', { name: '取消' }).click();
      await expect(editor).toBeHidden();
      continue;
    }
    const customAvatar = await preview.getAttribute('src');
    await editor.getByRole('button', { name: '保存头像', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(root.locator('#pc-avatar-preview-chip img')).toHaveAttribute('src', customAvatar);
    await expect(page.locator('.pc-platform-admin-avatar img')).toHaveAttribute('src', customAvatar);
    const updated = (await (await page.request.get('/api/v1/me/context')).json()).data;
    expect(JSON.stringify(updated.profile)).toContain(customAvatar);
  }
});

test('绑定表单显示字段校验，实际验证手机号后账号安全状态更新，改绑保留旧联系人确认', async ({ page }) => {
  const root = await profile(page);
  await root.locator('[data-profile-section=contacts]>summary').click();
  await root.locator('[data-profile-phone-security]').click();
  const security = page.locator('.pc-security-page');
  const entry = security.locator('[data-account-action=phone]');
  const form = security.locator('[data-phone-verify-form]');
  await form.locator('button[type=submit]').click();
  await expect(form.locator('[data-verify-phone]')).toHaveAttribute('aria-invalid', 'true');
  const phone = `139${String(Date.now()).slice(-8)}`;
  await form.locator('[data-verify-phone]').fill(phone);
  await form.locator('button[type=submit]').click();
  await expect(form.locator('[data-verify-phone-code]')).toHaveAttribute('aria-invalid', 'true');
  const sent = page.waitForResponse(r => r.url().includes('/auth/phone/send-code') && r.request().method() === 'POST');
  await form.locator('[data-phone-send-code]').click();
  const payload = await (await sent).json();
  expect(payload.code).toBe('OK');
  expect(payload.data.debug_code).toBeTruthy();
  await form.locator('[data-verify-phone-code]').fill(payload.data.debug_code);
  await form.locator('button[type=submit]').click();
  await expect(page.locator('#pc-toast')).toContainText('手机号已验证');
  await expect(entry).toContainText('已验证');
  await entry.click();
  await expect(form).toContainText('先确认当前联系人');
  await expect(security.locator('[data-contact-change-send]')).toHaveCount(1);
});

test('七个角色共用相同资料结构，身份显示当前角色', async ({ page }) => {
  const root = await profile(page, uniqueLoginId('superadmin_profile'));
  const shell = page.locator('#platform-admin-shell');
  for (const role of ['superAdmin', 'student', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin']) {
    await page.locator('[data-platform-admin-account-menu]').click();
    await page.locator('.pc-role-identity-menu>summary').click();
    await page.locator(`[data-role-workbench=${role}]`).click();
    await expect(shell).toHaveAttribute('data-learning-role', role);
    await page.waitForLoadState('networkidle');
    await page.locator('[data-platform-admin-account-menu]').click();
    await page.locator('[data-account-destination=account-profile]').click();
    await expect(root.locator(':scope > .pc-card')).toHaveCount(4);
    await expect(root.locator('[aria-label="身份与机构"]')).not.toContainText('知识就是力量');
    await expect(root.locator('[data-profile-section=contacts]')).not.toHaveAttribute('open', '');
  }
});
