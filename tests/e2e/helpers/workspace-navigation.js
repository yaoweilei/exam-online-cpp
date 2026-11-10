const { expect } = require('@playwright/test');

async function navigateWorkspace(shell, key, platform = false) {
  if (key === 'openRoleContent:org-course-packages' && await shell.locator('[data-role-overview=orgContentAdmin]').count()) return;
  if (key === 'openRoleContent:account-messages') { await shell.locator('[data-global-messages]').click(); return; }
  const consolidated = {
    'openRoleContent:teacher-assign': ['openRoleContent:teacher-review', 'button[data-intent="openRoleContent:teacher-assign"]'],
    'openRoleContent:teacher-unsubmitted': ['openRoleContent:teacher-review', 'button[data-teacher-assignment-filter=unsubmitted]'],
    'openRoleContent:teacher-arrange': ['openRoleContent:teacher-schedule', 'button[data-intent="openRoleContent:teacher-arrange"]'],
    'openRoleContent:assistant-arrange': ['openRoleContent:teacher-schedule', 'button[data-intent="openRoleContent:teacher-arrange"]'],
    'openRoleContent:assistant-remind': ['openRoleContent:assistant-followup', 'assignments'],
    'openRoleContent:assistant-renewal': ['openRoleContent:assistant-followup', 'risk'],
    'openRoleContent:assistant-alerts': ['openRoleContent:assistant-followup', 'alerts']
  }[key];
  if (consolidated && !platform) {
    await navigateWorkspace(shell, consolidated[0]);
    if (consolidated[1].startsWith('button')) await shell.locator(consolidated[1]).first().click();
    else await shell.locator('[data-institution-flow=followups] [data-flow-filter]').selectOption(consolidated[1]);
    return;
  }
  const attribute = platform ? 'data-platform-admin-page' : 'data-role-admin-intent';
  const selector = `[${attribute}=${JSON.stringify(key)}]`;
  const button = shell.locator(`.pc-platform-sidebar [data-workspace-section]${selector}`);
  if (await button.count()) {
    if (!(await button.isVisible())) await shell.locator('[data-platform-admin-nav-trigger]').click();
    await button.click();
    return;
  }
  // Learner navigation keeps its established menu implementation.
  const legacy = shell.locator(`.pc-platform-sidebar ${selector}`).first();
  await expect(legacy).toBeAttached();
  await legacy.evaluate(button => button.click());
}

async function workspaceDestinations(shell, platform = false) {
  const attribute = platform ? 'data-platform-admin-page' : 'data-role-admin-intent';
  return shell.locator('.pc-platform-sidebar').evaluate((sidebar, attr) => {
    return [...sidebar.querySelectorAll(`[${attr}]`)].map(button => ({ key: button.getAttribute(attr), name: button.getAttribute('aria-label') || button.textContent.trim() }));
  }, attribute);
}

module.exports = { navigateWorkspace, workspaceDestinations };
