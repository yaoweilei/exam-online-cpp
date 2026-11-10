const { expect } = require('@playwright/test');

async function openTaskDetails(page) {
  const panel = page.locator('#task-session-panel');
  if (!(await panel.isVisible())) await page.locator('.task-details-toggle').click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.task-details-toggle')).toHaveAttribute('aria-expanded', 'true');
}

module.exports = { openTaskDetails };
