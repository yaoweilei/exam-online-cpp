const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { loginWithPassword, openPersonalCenter, stubNoisyPersonalCenterApis } = require('./helpers/session');

const repoRoot = path.resolve(__dirname, '..', '..');
const prepareScript = path.join(repoRoot, 'backend', 'tools', 'prepare_org_invite_demo.ps1');

const INVITEE_LOGIN_ID = 'student_invite_demo';
const INVITEE_EMAIL = 'orginvite.demo@example.local';
const INVITEE_PHONE = '13800138099';
const ORGANIZATION_NAME = 'Invite Demo Org';

function prepareDemoData() {
  execFileSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', prepareScript, '-BaseDir', repoRoot],
    { cwd: repoRoot, stdio: 'inherit' }
  );
}

test.beforeEach(() => {
  prepareDemoData();
});

test('被邀请用户可在个人中心接受组织邀请', async ({ page }) => {
  await stubNoisyPersonalCenterApis(page, { includeInvitations: false });
  await loginWithPassword(page, INVITEE_LOGIN_ID);
  await openPersonalCenter(page);

  const pendingCard = page.locator('.pc-card.pc-info-card', { hasText: '待处理组织邀请' }).first();
  await expect(pendingCard).toBeVisible();
  const pendingInviteItem = pendingCard.locator('.pc-pending-invite-item', { hasText: ORGANIZATION_NAME }).first();
  await expect(pendingInviteItem).toContainText(new RegExp(`${INVITEE_EMAIL}|${INVITEE_PHONE}`));
  await pendingInviteItem.locator('[data-pending-invite-accept]').click();

  await expect(page.locator('#pc-toast')).toHaveText(/已加入组织/);
  await expect(pendingCard.locator('.pc-pending-invite-item', { hasText: ORGANIZATION_NAME })).toHaveCount(0);
});
