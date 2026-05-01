const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const prepareScript = path.join(repoRoot, 'cpp-backend', 'tools', 'prepare_org_invite_demo.ps1');

const ADMIN_LOGIN_ID = 'orgadmin_invite_demo';
const INVITEE_LOGIN_ID = 'student_invite_demo';
const INVITEE_EMAIL = 'orginvite.demo@example.local';
const ORGANIZATION_NAME = 'Invite Demo Org';

function prepareDemoData() {
  execFileSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', prepareScript, '-BaseDir', repoRoot],
    { cwd: repoRoot, stdio: 'inherit' }
  );
}

async function loginWithDevUser(page, loginId) {
  await page.goto('/');
  await page.locator('#login-entry-btn').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('[data-mode="wechat"]').click();
  await expect(page.locator('#wechat-test-id-list')).toBeVisible();
  await page.locator('#wechat-test-id-list button', { hasText: loginId }).click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('#user-menu-trigger')).toHaveAttribute('aria-label', /打开个人中心/);
}

async function openPersonalCenter(page) {
  await page.locator('#user-menu-trigger').click();
  await expect(page.locator('#personal-center.pc-open')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '个人中心' })).toBeVisible();
}

async function openAdminHub(page) {
  await openPersonalCenter(page);
  await page.locator('button.pc-nav-item', { hasText: '管理' }).click();
  await expect(page.locator('.pc-service-header', { hasText: ORGANIZATION_NAME })).toBeVisible();
}

test.beforeEach(() => {
  prepareDemoData();
});

test('管理员重建邀请后，用户可在个人中心接受并加入组织', async ({ browser, page }) => {
  const userContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const userPage = await userContext.newPage();

  await loginWithDevUser(page, ADMIN_LOGIN_ID);
  await openAdminHub(page);

  const orgCard = page.locator('.pc-card.pc-info-card', { hasText: ORGANIZATION_NAME }).first();
  await expect(orgCard).toBeVisible();

  const emailInviteItem = orgCard.locator('.pc-org-invite-item', { hasText: INVITEE_EMAIL }).first();
  await expect(emailInviteItem).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await emailInviteItem.locator('[data-org-invitation-cancel]').click();
  await expect(page.locator('#pc-toast')).toHaveText(/邀请已取消/);
  await expect(orgCard.locator('.pc-org-invite-item', { hasText: INVITEE_EMAIL })).toHaveCount(0);

  const inviteForm = orgCard.locator('form[data-org-invite-form]');
  await inviteForm.locator('[data-org-invite-contact]').fill(INVITEE_EMAIL);
  await inviteForm.locator('[data-org-invite-member-no]').fill('E2E-EMAIL');
  await inviteForm.locator('[data-org-invite-message]').fill('Playwright e2e invite');
  await inviteForm.getByRole('button', { name: '创建邀请' }).click();

  await expect(page.locator('#pc-toast')).toHaveText(/邀请已创建/);
  await expect(orgCard.locator('.pc-org-invite-item', { hasText: INVITEE_EMAIL })).toBeVisible();

  await loginWithDevUser(userPage, INVITEE_LOGIN_ID);
  await openPersonalCenter(userPage);

  const pendingCard = userPage.locator('.pc-card.pc-info-card', { hasText: '待处理组织邀请' }).first();
  await expect(pendingCard).toBeVisible();
  const pendingInviteItem = pendingCard.locator('.pc-pending-invite-item', { hasText: ORGANIZATION_NAME }).first();
  await expect(pendingInviteItem).toContainText(INVITEE_EMAIL);
  await pendingInviteItem.locator('[data-pending-invite-accept]').click();

  await expect(userPage.locator('#pc-toast')).toHaveText(/已加入组织/);
  await expect(pendingCard.locator('.pc-pending-invite-item', { hasText: INVITEE_EMAIL })).toHaveCount(0);

  await userPage.locator('#pc-header-back').click();
  await userPage.locator('.service-item[data-intent="gotoProfile"]').click();
  await expect(userPage.locator('.pc-info-row', { hasText: '当前空间' })).toContainText(ORGANIZATION_NAME);

  await userContext.close();
});
