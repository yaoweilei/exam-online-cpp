const { test, expect } = require('@playwright/test');
const { clearBrowserSession, expectGuestEntry, loginApi, openPersonalCenter, stubNoisyPersonalCenterApis, uniqueLoginId } = require('./helpers/session');

async function loginWithDevUser(page, loginId, apiFixtures = {}, options = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!options.skipApiStubs) {
    await stubNoisyPersonalCenterApis(page, apiFixtures);
  }

  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await expect(page.locator('#login-modal')).toBeVisible();
  const button = page.locator(`[data-dev-login="${loginId}"]`);
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await openPersonalCenter(page);
}

test('学员个人中心使用简约学习工作台', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  await expect(page.locator('#pc-header-overview')).not.toContainText('账户概览');
  await expect(page.locator('#pc-header-overview')).toContainText('学分');
  await expect(page.locator('#pc-header-overview')).toContainText('今日学习');

  await expect(page.locator('.pc-workbench-focus')).toHaveCount(0);
  await expect(page.locator('.pc-workbench-card')).toHaveCount(0);
  await expect(page.locator('.pc-workbench-more-card')).toHaveCount(0);
  await expect(page.locator('.pc-compact-list-card')).toHaveCount(0);

  const contentCard = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' });
  await expect(contentCard).toContainText('最近学习');
  await expect(contentCard).toContainText('收藏');
  await expect(contentCard).toContainText('每日一练');
  await expect(contentCard).toContainText('今日复习');
  await expect(contentCard).toContainText('错题本');
  await expect(contentCard).toContainText('学习报告');
  await expect(contentCard).toContainText('生词本');
  await expect(contentCard).toContainText('学习路径');
  await expect(contentCard).toContainText('社区讨论');
  await expect(contentCard).toContainText('推荐复习');
  await expect(contentCard).not.toContainText('我的账户');
  await expect(contentCard.locator('.pc-student-content-group')).toHaveCount(3);
  await expect(contentCard.locator('.pc-my-content-item')).toHaveCount(12);
  await expect(contentCard.locator('.pc-my-content-placeholder')).toHaveCount(0);
  await expect(contentCard.locator('[data-student-content-group="today"] .pc-my-content-item')).toHaveCount(4);
  await expect(contentCard.locator('[data-student-content-group="review"] .pc-my-content-item')).toHaveCount(4);
  await expect(contentCard.locator('[data-student-content-group="progress"] .pc-my-content-item')).toHaveCount(4);
  const personalizedRecommendation = contentCard.locator('[data-entitlement-locked="true"]').filter({ hasText: '推荐复习' });
  await expect(personalizedRecommendation).toContainText('PRO');

  const accountCard = page.locator('.pc-my-account-card');
  await expect(accountCard).toContainText('我的账户');
  await expect(accountCard.locator('[data-dashboard-page="account-core"]')).toContainText('账户');
  await expect(accountCard.locator('[data-dashboard-page="account-plan"]')).toContainText('套餐');
  await expect(accountCard.locator('[data-dashboard-page="account-coupons"]')).toContainText('卡券');
  await expect(accountCard.locator('[data-dashboard-page="account-feedback"]')).toContainText('反馈');
  await expect(page.locator('.pc-dashboard-simple')).not.toContainText('组织邀请入口');
});

test('我的作业进入真实列表而不是只滚动首页横幅', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    assignments: [{
      assignment_id: 'asg_student_ui',
      exam_id: '2023_02',
      title: 'EJU 听读解周练',
      due_at: '2030-08-15T10:00:00Z',
      own_submission: {
        submitted_at: '2030-08-10T08:30:00Z',
        teacher_comment: '订正第 3 题后再复习'
      },
      own_reminders: []
    }]
  });

  await page.locator('[data-intent="openAssignments"]').first().click();
  const subpage = page.locator('.pc-subpage');
  await expect(subpage).toContainText('我的作业');
  await expect(subpage).toContainText('EJU 听读解周练');
  await expect(subpage).toContainText('已提交');
  await expect(subpage).toContainText('订正第 3 题后再复习');
  await expect(subpage.locator('[data-intent^="openAssignmentExam:"]')).toHaveCount(1);
  await expect(page.locator('#pc-assignments-banner')).toHaveCount(0);
});

test('多端同步使用统一确认、按钮忙碌态和可访问表格', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  let stateRequests = 0;
  let pushRequests = 0;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'sync_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/me/sync/state', async (route) => {
    stateRequests += 1;
    if (stateRequests > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({
        server_time: '2026-07-18T12:00:00.000Z',
        modules: { progress: { exists: true, modified_at: '2026-07-18T11:00:00.000Z', size: 12 } }
      }))
    });
  });
  await page.route('**/api/v1/me/sync/push', async (route) => {
    pushRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({ status: 'conflict', written: {}, conflicts: { progress: { reason: 'newer_remote' } } }))
    });
  });

  await page.evaluate(() => {
    const manager = window.UserContextManager?.getInstance?.();
    const userId = manager?.getUserContext?.()?.id || 'usr_demo_student_001';
    localStorage.setItem(`sync.snapshot.${userId}.progress`, JSON.stringify({
      modified_at: '2026-07-18T10:00:00.000Z',
      content: { completed: 3 }
    }));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-dashboard-page="account-core"]').click();
  const syncEntry = page.locator('[data-intent="openSyncDevices"]');
  await expect(syncEntry).toContainText('多端同步');
  await syncEntry.click();
  const modal = page.locator('#sync-devices-modal');
  await expect(modal).toBeVisible();
  const dialog = modal.locator('[role="dialog"]');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  })).toBeTruthy();
  const tableRegion = modal.locator('.pc-responsive-table-region');
  await expect(tableRegion).toHaveAttribute('role', 'region');
  await expect(tableRegion).toHaveAttribute('tabindex', '0');
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();

  const refreshButton = modal.locator('#sd-refresh');
  await refreshButton.click();
  await expect(refreshButton).toBeDisabled();
  await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
  await expect(refreshButton).toBeEnabled();

  const pushButton = modal.locator('#sd-push');
  await pushButton.click();
  await expect(pushButton).toBeDisabled();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('同步冲突');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pc-confirm-dialog')).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(pushButton).toBeEnabled();
  await expect(pushButton).toBeFocused();
  expect(pushRequests).toBe(1);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(syncEntry).toBeFocused();
});

test('学习报告支持移动端对话框、周期忙碌态和 FREE 月报升级提示', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  const requestedPeriods = [];
  await page.route('**/api/v1/me/learning-report?period=*', async (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') || 'week';
    requestedPeriods.push(period);
    if (requestedPeriods.length > 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        code: 'OK', message: 'ok',
        data: {
          period, since: '2026-07-01',
          answers: { exams: 2, questions: 20, accuracy: 0.8, wrong: 4, papers: [] },
          wrong_questions: { added_in_period: 4 }, srs: { due: 3 }, streak: { current: 5, best: 8 }
        }
      })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator('[data-intent="openLearningReport"]');
  await expect(entry).toBeVisible();
  await entry.click();

  const modal = page.locator('#learning-report-modal');
  const dialog = modal.locator('[role="dialog"]');
  await expect(modal).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-labelledby', 'lr-title');
  await expect(modal.locator('#lr-close')).toBeFocused();
  expect(await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  })).toBeTruthy();
  await expect(modal).toContainText('80.0%');

  const week = modal.locator('#lr-week');
  await week.click();
  await expect(week).toBeDisabled();
  await expect(week).toHaveAttribute('aria-busy', 'true');
  await expect(week).toBeEnabled();

  const month = modal.locator('#lr-month');
  await expect(month).toHaveAttribute('data-entitlement-locked', 'true');
  await expect(month).toContainText('PRO');
  await month.click();
  await expect(page.locator('#pc-recharge-modal')).toBeVisible();
  expect(requestedPeriods).not.toContain('month');
  await page.locator('#recharge-close').click();
  await expect(page.locator('#pc-recharge-modal')).toBeHidden();

  await modal.locator('#lr-close').click();
  await expect(modal).toBeHidden();
  await expect(entry).toBeFocused();
});

test('学习工具旧弹窗统一支持移动端、Esc 和焦点归还', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    bookmarkFolders: [], bookmarks: { questions: [] }, dailyPractice: { items: [], completed_question_ids: [] }
  });

  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'learning_tools_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/wrong-questions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({
        items: [{
          question_id: 'q_entitlement',
          exam_id: 'exam_entitlement',
          wrong_count: 1,
          question_snapshot: { question: '权益测试题', correct_answer: 'A', explanation: '基础解析' }
        }],
        summary: { total: 1, active: 1, mastered: 0 }
      }))
    });
  });
  await page.route('**/api/v1/srs/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [] })) });
  });
  await page.route('**/api/v1/me/study-goals*', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 250));
    const data = route.request().method() === 'POST' ? { goal_id: 'goal_e2e' } : { items: [] };
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok(data)) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const openTool = async ({ intent, modalId, closeId, titleId, synthetic = false }) => {
    let entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator(`[data-intent="${intent}"]`);
    if (synthetic) {
      const entryId = `learning-tool-entry-${intent}`;
      await page.evaluate(({ intent, entryId }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = entryId;
        button.className = 'service-item';
        button.dataset.intent = intent;
        button.textContent = intent;
        document.querySelector('#pc-content')?.appendChild(button);
      }, { intent, entryId });
      entry = page.locator(`#${entryId}`);
    }
    await expect(entry).toBeVisible();
    await entry.click();
    const modal = page.locator(`#${modalId}`);
    const dialog = modal.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', titleId);
    await expect(modal.locator(`#${closeId}`)).toBeFocused();
    expect(await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth;
    })).toBeTruthy();
    return { entry, modal };
  };

  const cases = [
    { intent: 'openWrongQuestions', modalId: 'wq-modal', closeId: 'wq-close', titleId: 'wq-title' },
    { intent: 'openSrsReview', modalId: 'srs-modal', closeId: 'srs-close', titleId: 'srs-title', synthetic: true },
    { intent: 'openReviewWorkbench', modalId: 'review-workbench-modal', closeId: 'rw-close', titleId: 'rw-title' }
  ];
  for (const item of cases) {
    const { entry, modal } = await openTool(item);
    if (item.intent === 'openWrongQuestions') {
      const related = modal.locator('[data-wq-action="related"]');
      await expect(related).toHaveAttribute('data-entitlement-locked', 'true');
      await expect(related).toContainText('PRO');
      await related.click();
      await expect(page.locator('#pc-recharge-modal')).toBeVisible();
      await page.locator('#recharge-close').click();
      await expect(page.locator('#pc-recharge-modal')).toBeHidden();

      const reset = modal.locator('#wq-reset');
      await reset.click();
      const riskModal = page.locator('#risk-modal');
      await expect(riskModal).toBeVisible();
      await expect(riskModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'risk-title');
      await expect(riskModal.locator('#risk-input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(riskModal).toBeHidden();
      await expect(reset).toBeFocused();
      await expect(modal).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(entry).toBeFocused();
  }

  const { entry: goalEntry, modal: goalModal } = await openTool({
    intent: 'openStudyGoal', modalId: 'study-goal-modal', closeId: 'sg-close', titleId: 'sg-modal-title'
  });
  await goalModal.locator('#sg-title').fill('N1 冲刺');
  await goalModal.locator('#sg-date').fill('2026-12-01');
  const submit = goalModal.locator('#sg-form button[type="submit"]');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(goalModal).toBeHidden();
  await expect(goalEntry).toBeFocused();
});

test('每日一练、排行榜、生词本、学习路径和社区统一弹窗体验', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', { dailyPractice: { items: [], completed_question_ids: [] } });
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'remaining_modals_e2e', ts: new Date().toISOString() });
  await page.route('**/api/v1/leaderboard*', async (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') || 'week';
    if (period === 'month') await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ period, generated_at: '2026-07-19T00:00:00Z', items: [] })) });
  });
  await page.route('**/api/v1/vocab-notebook/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [] })) });
  });
  await page.route('**/api/v1/chapters*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ items: [], count: 0 })) });
  });
  await page.route('**/api/v1/community/2023_02*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ posts: [] })) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const openTool = async ({ intent, modalId, closeId, titleId, synthetic = false }) => {
    let entry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator(`[data-intent="${intent}"]`);
    if (synthetic) {
      const entryId = `remaining-modal-entry-${intent}`;
      await page.evaluate(({ intent, entryId }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = entryId;
        button.className = 'service-item';
        button.dataset.intent = intent;
        button.textContent = intent;
        document.querySelector('#pc-content')?.appendChild(button);
      }, { intent, entryId });
      entry = page.locator(`#${entryId}`);
    }
    await expect(entry).toBeVisible();
    await entry.click();
    const modal = page.locator(`#${modalId}`);
    const dialog = modal.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', titleId);
    await expect(modal.locator(`#${closeId}`)).toBeFocused();
    expect(await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= window.innerWidth;
    })).toBeTruthy();
    return { entry, modal };
  };

  const cases = [
    { intent: 'openDailyPractice', modalId: 'daily-practice-modal', closeId: 'dp-close', titleId: 'dp-title' },
    { intent: 'openLeaderboard', modalId: 'leaderboard-modal', closeId: 'lb-close', titleId: 'lb-title', synthetic: true },
    { intent: 'openVocabNotebook', modalId: 'vocab-modal', closeId: 'vocab-close', titleId: 'vocab-title' },
    { intent: 'openChapterPath', modalId: 'chapter-modal', closeId: 'cp-close', titleId: 'cp-title' }
  ];
  for (const item of cases) {
    const { entry, modal } = await openTool(item);
    if (item.intent === 'openLeaderboard') {
      const month = modal.locator('#lb-month');
      await month.click();
      await expect(month).toBeDisabled();
      await expect(month).toHaveAttribute('aria-busy', 'true');
      await expect(month).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(entry).toBeFocused();
  }

  const communityEntry = page.locator('.pc-my-content-card').filter({ hasText: '我的内容' }).locator('[data-intent="openCommunity"]');
  await expect(communityEntry).toBeVisible();
  await communityEntry.click();
  const paperInputDialog = page.locator('.pc-confirm-dialog');
  await expect(paperInputDialog).toBeVisible();
  await paperInputDialog.locator('[data-pc-input]').fill('2023_02');
  await paperInputDialog.locator('[data-pc-input-ok]').click();
  const community = page.locator('#community-modal');
  await expect(community).toBeVisible();
  await expect(community.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'cm-title');
  await expect(community.locator('#cm-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(community).toBeHidden();
  await expect(communityEntry).toBeFocused();
});

test('超级管理员运营仪表盘支持键盘关闭和焦点归还', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
  await page.evaluate(() => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.id = 'admin-dashboard-e2e-entry';
    entry.className = 'service-item';
    entry.dataset.intent = 'openAdminDashboard';
    entry.textContent = '运营仪表盘';
    document.querySelector('#pc-content')?.appendChild(entry);
  });
  const entry = page.locator('#admin-dashboard-e2e-entry');
  await entry.click();
  const modal = page.locator('#admin-dashboard-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'ad-title');
  await expect(modal.locator('#ad-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(entry).toBeFocused();
});

test('学员我的内容支持最近学习和收藏子页面', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    recentLearning: [
      {
        exam_id: '2023_02', exam_title: 'EJU 2023年第2回 读解', status: 'draft',
        answered_count: 8, total_questions: 10, last_section_index: 1, last_question_index: 32,
        updated_at: '2026-07-17T08:00:00.000Z'
      },
      {
        exam_id: 'N2_2024_12', exam_title: 'JLPT N2 2024年12月 文字词汇', status: 'submitted',
        answered_count: 25, total_questions: 25, last_section_index: 0, last_question_index: 20,
        updated_at: '2026-07-16T08:00:00.000Z'
      }
    ],
    bookmarkFolders: [
      { folder_id: 'reading', name: '读解易错题' },
      { folder_id: 'listening', name: '听力表格题' }
    ],
    bookmarks: {
      questions: [
        { bookmark_id: 'bookmark-reading', exam_id: '2023_02', question_id: '29', question_no: '29', section_index: 1, folder_id: 'reading', reason: '段落主旨' },
        { bookmark_id: 'bookmark-listening', exam_id: '2023_02', question_id: '35', question_no: '35', section_index: 2, folder_id: 'listening', reason: '表格信息' }
      ]
    }
  });

  await page.locator('[data-dashboard-page="recent"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('最近学习');
  await expect(page.locator('.pc-subpage')).toContainText('EJU 2023年第2回 读解');
  await expect(page.locator('.pc-subpage .pc-lite-row').filter({ hasText: 'EJU 2023年第2回 读解' })).toHaveAttribute('data-intent', 'openExamQuestion:2023_02:33:1');
  await expect(page.locator('.pc-subpage .pc-lite-row').filter({ hasText: 'JLPT N2 2024年12月 文字词汇' })).toHaveAttribute('data-intent', 'openExamQuestion:N2_2024_12:21:0');
  await expect(page.locator('#pc-header-back')).toBeVisible();
  await page.locator('[data-dashboard-back]').click();
  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('收藏');

  await page.locator('[data-dashboard-page="favorites"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('收藏');
  await expect(page.locator('.pc-subpage')).toContainText('收藏题：读解易错题');
  await expect(page.locator('.pc-subpage [data-favorite-question-open]').filter({ hasText: '收藏题：读解易错题' }).first()).toHaveAttribute('data-question-id', '29');
  await expect(page.locator('.pc-subpage [data-favorite-question-open]').filter({ hasText: '收藏题：听力表格题' }).first()).toHaveAttribute('data-question-id', '35');
  await page.locator('#pc-header-back').click();
  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('最近学习');
});

test('每日一练重新生成期间阻止重复提交', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo', {
    dailyPractice: {
      date: '2026-07-17', target_count: 1, completed_question_ids: [],
      items: [{ exam_id: '2023_02', question_id: '29', source: 'wrong_question' }]
    }
  });
  let regenerateCalls = 0;
  await page.route('**/api/v1/me/daily-practice/regenerate', async (route) => {
    regenerateCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { items: [] } })
    });
  });

  await page.locator('[data-daily-action="open"]').click();
  await expect(page.locator('#daily-practice-modal')).toBeVisible();
  const regenerate = page.locator('#dp-regen');
  await regenerate.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(regenerate).toBeDisabled();
  await expect(regenerate).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => regenerateCalls).toBe(1);
  await expect(regenerate).toBeEnabled();
  expect(regenerateCalls).toBe(1);
});

test('我的账户作为首页同级卡片显示四个固定入口', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  const accountCard = page.locator('.pc-my-account-card');
  await expect(accountCard).toBeVisible();
  await expect(accountCard.locator('.pc-account-entry')).toHaveCount(4);
  await expect(accountCard.locator('[data-dashboard-page="account-core"]')).toContainText('账户');
  await expect(accountCard.locator('[data-dashboard-page="account-plan"]')).toContainText('套餐');
  await expect(accountCard.locator('[data-dashboard-page="account-coupons"]')).toContainText('卡券');
  await expect(accountCard.locator('[data-dashboard-page="account-feedback"]')).toContainText('反馈');
});

test('账户安全表单提供字段错误并阻止重复提交', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  let passwordCalls = 0;
  await page.route('**/api/v1/auth/password/change', async (route) => {
    passwordCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { changed: true } })
    });
  });

  await page.locator('[data-dashboard-page="account-core"]').click();
  await page.locator('[data-account-action="password"]').click();
  let form = page.locator('form[data-account-password-form]');
  const newPassword = form.locator('[data-account-new-password]');
  const confirmPassword = form.locator('[data-account-confirm-password]');
  await form.locator('button[type="submit"]').click();
  await expect(newPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('请输入新密码');

  await newPassword.fill('abc');
  await confirmPassword.fill('abc');
  await form.locator('button[type="submit"]').click();
  await expect(newPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('至少 8 位');

  await newPassword.fill('ValidPass123');
  await confirmPassword.fill('Different123');
  await form.locator('button[type="submit"]').click();
  await expect(confirmPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('两次输入');

  const currentPassword = form.locator('[data-account-current-password]');
  if (await currentPassword.count()) await currentPassword.fill('CurrentPass123');
  await confirmPassword.fill('ValidPass123');
  const submit = form.locator('button[type="submit"]');
  await submit.evaluate((button) => { button.click(); button.click(); });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => passwordCalls).toBe(1);
  await expect(page.locator('#pc-toast')).toContainText('密码已更新');

  await page.locator('[data-account-action="wechat"]').click();
  form = page.locator('form[data-account-wechat-form]');
  await form.locator('[data-account-wechat-code]').fill('');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-account-wechat-code]')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.pc-field-error')).toContainText('请先完成微信授权');
});

test('平台角色模板和临时授权必须先预览再确认', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
  let templatePreviewCalls = 0;
  let templateUpdateCalls = 0;
  let accessPreviewCalls = 0;
  let accessUpdateCalls = 0;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'platform_access_e2e', ts: new Date().toISOString() });

  await page.route('**/api/v1/admin/role-templates?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok([{ id: 'teacher', name: '老师', description: '测试模板', default_permissions: ['assignment.review'], allow_organization_override: true, protected: false }]))
  }));
  await page.route('**/api/v1/admin/role-templates/teacher/preview', async (route) => {
    templatePreviewCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ added: ['assignment.create'], removed: [], conflicts: [] })) });
  });
  await page.route('**/api/v1/admin/role-templates/teacher', (route) => {
    templateUpdateCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ updated: true })) });
  });
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok({ temporary_grants: [] }))
  }));
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access/preview', async (route) => {
    accessPreviewCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ before: { temporary_grants: [] }, after: { temporary_grants: [{}], conflicts: [] } })) });
  });
  await page.route('**/api/v1/admin/users/usr_access_e2e/platform-access', (route) => {
    accessUpdateCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ updated: true })) });
  });

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="角色权限"]').click();
  const templateForm = page.locator('[data-platform-role-template-form][data-role-id="teacher"]');
  await expect(templateForm).toBeVisible({ timeout: 20000 });
  const permissions = templateForm.locator('[data-role-permissions]');
  await permissions.fill('');
  await templateForm.locator('button[type="submit"]').click();
  await expect(permissions).toHaveAttribute('aria-invalid', 'true');
  await expect(templateForm.locator('.pc-field-error')).toContainText('不能为空');

  await permissions.fill('assignment.review\nassignment.create');
  let templateSubmit = templateForm.locator('button[type="submit"]');
  await templateSubmit.evaluate((button) => { button.click(); button.click(); });
  await expect(templateSubmit).toBeDisabled();
  await expect(templateSubmit).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => templatePreviewCalls).toBe(1);
  await expect(page.locator('[data-role-diff]')).toBeVisible();
  expect(templateUpdateCalls).toBe(0);

  await permissions.fill('assignment.review\nassignment.create\ngradebook.view');
  await templateForm.locator('button[type="submit"]').click();
  await expect.poll(() => templatePreviewCalls).toBe(2);
  expect(templateUpdateCalls).toBe(0);
  await templateForm.locator('button[type="submit"]').click();
  await expect.poll(() => templateUpdateCalls).toBe(1);

  const accessForm = page.locator('[data-platform-user-access-form]');
  await accessForm.locator('[data-platform-access-user-id]').fill('usr_access_e2e');
  await accessForm.locator('[data-platform-access-role]').selectOption('assistant');
  await accessForm.locator('[data-platform-access-expiry]').fill('2027-07-19T12:00');
  let accessSubmit = accessForm.locator('button[type="submit"]');
  await accessSubmit.click();
  await accessSubmit.evaluate((button) => button.click());
  await expect.poll(() => accessPreviewCalls).toBe(1);
  await expect(page.locator('[data-platform-access-diff]')).toBeVisible();
  expect(accessUpdateCalls).toBe(0);
  accessSubmit = accessForm.locator('button[type="submit"]');
  await accessSubmit.click();
  await expect.poll(() => accessUpdateCalls).toBe(1);
});

test('内容发布与回滚使用确认、顺序门禁和行内错误', async ({ page }) => {
  await loginWithDevUser(page, 'contentadmin_demo');
  let publishCalls = 0;
  let rollbackCalls = 0;
  let inspectCalls = 0;
  let batchInspectCalls = 0;
  let batchInspectBody = null;
  let publishBody = null;
  let rollbackBody = null;
  const ok = (data) => ({ code: 'OK', message: 'ok', data, request_id: 'content_workflow_e2e', ts: new Date().toISOString() });
  const workflow = [{
    exam_id: 'workflow_e2e', status: 'secondary_approved',
    inspection: { passed: true, errors: [] },
    reviews: { analysis: { status: 'approved' }, secondary: { status: 'approved' } },
    versions: [{ id: 'ver_workflow_e2e', kind: 'published', created_at: '2026-07-19T10:00:00Z' }]
  }, {
    exam_id: 'workflow_pending_e2e', status: 'quality_failed',
    inspection: { passed: false, errors: ['missing image'] }, reviews: {}, versions: []
  }];

  await page.route('**/api/v1/exams?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok([{ id: 'workflow_e2e', title: '内容工作流测试卷' }, { id: 'workflow_pending_e2e', title: '待质检测试卷' }]))
  }));
  await page.route('**/api/v1/admin/content/workflow?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(ok(workflow))
  }));
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/inspect', async (route) => {
    inspectCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 500, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: 'INSPECTION_FAILED', message: '图片资源检查失败' }) });
  });
  await page.route('**/api/v1/admin/content/workflow/inspect-batch', async (route) => {
    batchInspectCalls += 1;
    batchInspectBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(ok({ requested_count: 2, processed_count: 2, passed_count: 1, failed_count: 1, unavailable_count: 0, items: [] }))
    });
  });
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/publish', async (route) => {
    publishCalls += 1;
    publishBody = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ version_id: 'ver_new_e2e', status: 'published' })) });
  });
  await page.route('**/api/v1/admin/content/workflow/workflow_e2e/versions/ver_workflow_e2e/rollback', async (route) => {
    rollbackCalls += 1;
    rollbackBody = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(ok({ id: 'ver_rollback_e2e', kind: 'rollback' })) });
  });

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="发布工作流"]').click();
  const row = page.locator('[data-content-workflow-row][data-exam-id="workflow_e2e"]');
  await expect(row).toBeVisible({ timeout: 20000 });
  const publish = row.locator('[data-content-workflow-action="publish"]');
  await expect(publish).toBeEnabled();
	const pendingRow = page.locator('[data-content-workflow-row][data-exam-id="workflow_pending_e2e"]');
	await expect(pendingRow.locator('[data-content-workflow-action="analysis"]')).toBeDisabled();
	await expect(pendingRow.locator('[data-content-workflow-action="secondary"]')).toBeDisabled();
	await expect(pendingRow.locator('[data-content-workflow-action="publish"]')).toBeDisabled();

  await row.locator('[data-content-workflow-select]').check();
  await pendingRow.locator('[data-content-workflow-select]').check();
  const batchInspect = page.locator('[data-content-workflow-batch-inspect]');
  await expect(batchInspect).toContainText('批量质检（2）');
  await batchInspect.click();
  await expect.poll(() => batchInspectCalls).toBe(1);
  expect(batchInspectBody.exam_ids.sort()).toEqual(['workflow_e2e', 'workflow_pending_e2e'].sort());
  await expect(page.locator('[data-content-workflow-batch-message]')).toContainText('已检查 2 份：通过 1，发现阻断问题 1');

  await publish.click();
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.pc-confirm-dialog')).toContainText('生成正式版本');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-cancel]').click();
  await expect(publish).toBeEnabled();
  await expect(publish).toBeFocused();
  expect(publishCalls).toBe(0);

  await publish.evaluate((button) => { button.click(); button.click(); });
  await expect(page.locator('.pc-confirm-dialog')).toHaveCount(1);
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect.poll(() => publishCalls).toBe(1);
  await expect(page.locator('#pc-toast')).toContainText('内容已发布并生成版本');
  expect(publishBody.confirmation).toBe('确认发布');

  const rollback = row.locator('[data-content-workflow-action="rollback"][data-version-id="ver_workflow_e2e"]');
  await rollback.click();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('历史快照覆盖');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect.poll(() => rollbackCalls).toBe(1);
  expect(rollbackBody.confirmation).toBe('确认回滚');
	await expect(row.locator('[data-content-workflow-action="inspect"]')).toBeDisabled();
	await expect(page.locator('#pc-toast')).toContainText('已回滚并生成新的版本记录');

  const inspect = row.locator('[data-content-workflow-action="inspect"]');
	await inspect.click();
  await expect(inspect).toBeDisabled();
  await expect.poll(() => inspectCalls).toBe(1);
  await expect(row.locator('[data-content-workflow-message]')).toContainText('图片资源检查失败');
  await expect(inspect).toBeEnabled();
});

test('联系人验证和推荐码表单提供字段错误与重复提交保护', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  let sendCodeCalls = 0;
  await page.route('**/api/v1/auth/phone/send-code', async (route) => {
    sendCodeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 'OK', message: 'ok', data: { daily_remaining: 4 } })
    });
  });

	await page.locator('[data-dashboard-page="account-core"]').click();
	await page.locator('[data-intent="gotoProfile"]').click();
  await expect(page.locator('.pc-contact-verify-card')).toBeVisible();
  await page.locator('[data-contact-verify-toggle="phone"]').first().click();
  const phoneForm = page.locator('form[data-phone-verify-form]');
  const phoneInput = phoneForm.locator('[data-verify-phone]');
  const codeInput = phoneForm.locator('[data-verify-phone-code]');
  await phoneInput.fill('');
  await codeInput.fill('');
  await phoneForm.locator('button[type="submit"]').click();
  await expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
  await expect(phoneForm.locator('.pc-field-error')).toContainText('请输入手机号');

  await phoneInput.fill('13900001234');
  await phoneForm.locator('button[type="submit"]').click();
  await expect(codeInput).toHaveAttribute('aria-invalid', 'true');
  await expect(phoneForm.locator('.pc-field-error')).toContainText('请输入短信验证码');

  const sendButton = phoneForm.locator('[data-phone-send-code]');
  await sendButton.evaluate((button) => { button.click(); button.click(); });
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => sendCodeCalls).toBe(1);
  await expect(sendButton).toBeEnabled();
  await expect(page.locator('#pc-toast')).toContainText('手机验证码已发送');

  const referralForm = page.locator('form[data-referral-claim-form]');
  if (await referralForm.count()) {
    const referralInput = referralForm.locator('[data-referral-code]');
    await referralInput.fill('');
    await referralForm.locator('button[type="submit"]').click();
    await expect(referralInput).toHaveAttribute('aria-invalid', 'true');
    await expect(referralForm.locator('.pc-field-error')).toContainText('请输入推荐码');
  }
});

test('我的账户四个子页面都有返回和业务数据', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  await page.locator('[data-dashboard-page="account-core"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('账户');
  await expect(page.locator('.pc-subpage')).toContainText('修改密码');
  await expect(page.locator('.pc-subpage')).toContainText('数据导出');
  await page.locator('[data-dashboard-back]').click();
  await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');

  await page.locator('[data-dashboard-page="account-plan"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('套餐');
	await expect(page.locator('.pc-subpage')).toContainText('当前套餐');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('[data-dashboard-page="account-coupons"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('卡券');
	await expect(page.locator('.pc-subpage')).toContainText('列表来自钱包接口');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('[data-dashboard-page="account-feedback"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('反馈');
  await expect(page.locator('.pc-subpage')).toContainText('用户协议');
  await page.locator('#pc-header-back').click();
  await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');
});

test('反馈帮助子页入口可以打开详情并提交反馈', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');
  await page.locator('[data-dashboard-page="account-feedback"]').click();

  await page.locator('.pc-lite-row').filter({ hasText: '问题反馈' }).click();
  await expect(page.locator('.pc-subpage')).toContainText('提交反馈');
  await page.locator('[data-support-feedback-description]').fill('Playwright 反馈：解析表达需要复核');
  await page.locator('[data-support-feedback-form] button[type="submit"]').click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已提交');
  await page.locator('#pc-header-back').click();
  await page.locator('[data-dashboard-page="account-feedback"]').click();

  await page.locator('.pc-lite-row').filter({ hasText: '客服' }).click();
  await expect(page.locator('.pc-subpage')).toContainText('在线客服');
  await expect(page.locator('.pc-subpage')).toContainText('工作日 10:00-19:00');
});

test('账户相关子页列表保持左对齐', async ({ page }) => {
  await loginWithDevUser(page, 'student_demo');

  for (const pageName of ['account-plan', 'account-coupons', 'account-feedback']) {
    await page.locator(`[data-dashboard-page="${pageName}"]`).click();
    await expect(page.locator('.pc-lite-row').first()).toBeVisible();
    let styles = [];
    await expect.poll(async () => {
      styles = await page.locator('.pc-lite-row').evaluateAll((rows) => {
        return rows.map((row) => {
          const rowStyle = window.getComputedStyle(row);
          const strong = row.querySelector('strong');
          const strongStyle = strong ? window.getComputedStyle(strong) : null;
          return {
            display: rowStyle.display,
            flexDirection: rowStyle.flexDirection,
            justifyContent: rowStyle.justifyContent,
            textAlign: rowStyle.textAlign,
            strongTextAlign: strongStyle?.textAlign || ''
          };
        });
      });
      return styles.length > 0 && styles.every((style) => style.display === 'flex');
    }).toBe(true);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style.display).toBe('flex');
      expect(style.flexDirection).toBe('row');
      expect(style.justifyContent).toBe('space-between');
      expect(style.textAlign).toBe('left');
      expect(style.strongTextAlign).toBe('left');
    }
    await page.locator('[data-dashboard-back]').click();
  }

  await page.locator('[data-dashboard-page="account-core"]').click();
  const phoneAlign = await page.locator('.pc-account-phone').evaluate((el) => window.getComputedStyle(el).textAlign);
  expect(phoneAlign).toBe('left');
});

test('窄面板中的系统功能开关不会把标题挤成竖排', async ({ page }) => {
  await page.setViewportSize({ width: 842, height: 900 });
  await loginWithDevUser(page, 'superadmin_demo');

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="功能开关"]').click();
  const flagRow = page.locator('[data-platform-system-flag-row="admin_dashboard"]');
  await expect(flagRow).toContainText('管理员仪表盘', { timeout: 20000 });

  const layout = await flagRow.evaluate((row) => {
    const content = row.querySelector(':scope > span');
    const title = content?.querySelector('strong');
    const actions = row.querySelector(':scope > .pc-feedback-actions');
    const panel = document.querySelector('#personal-center .pc-panel');
    const contentBox = content?.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    const actionsBox = actions?.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const titleLineHeight = title ? Number.parseFloat(window.getComputedStyle(title).lineHeight) : 0;
    const personalCenter = document.querySelector('#personal-center');
    return {
      rowWidth: rowBox.width,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
      contentWidth: contentBox?.width ?? 0,
      titleHeight: titleBox?.height ?? 0,
      titleLineHeight,
      actionsLeft: actionsBox?.left ?? 0,
      actionsRight: actionsBox?.right ?? 0,
      rowLeft: rowBox.left,
      rowRight: rowBox.right,
      centerScrollWidth: personalCenter?.scrollWidth ?? 0,
      centerClientWidth: personalCenter?.clientWidth ?? 0
    };
  });

  expect(layout.panelWidth).toBeGreaterThanOrEqual(700);
  expect(layout.contentWidth).toBeGreaterThanOrEqual(Math.min(260, layout.rowWidth - 2));
  expect(layout.titleHeight).toBeLessThanOrEqual(layout.titleLineHeight * 1.5);
  expect(layout.actionsLeft).toBeGreaterThanOrEqual(layout.rowLeft - 1);
  expect(layout.actionsRight).toBeLessThanOrEqual(layout.rowRight + 1);
  expect(layout.centerScrollWidth).toBeLessThanOrEqual(layout.centerClientWidth + 1);
});

test('教学与管理角色显示对应简约工作台入口', async ({ page }) => {
  const cases = [
    { loginId: 'teacher_demo', removedFocus: '今日教学', removedTitle: '教学工作台', entries: ['我的学生', '学习组', '课程表', '安排课程', '待批改', '布置作业', '成绩册', '备课'], open: '我的学生', subpageText: /student_demo|暂无真实数据/ },
    { loginId: 'assistant_demo', removedFocus: '今日运营', removedTitle: '运营工作台', entries: ['催交作业', '学员跟进', '续费风险', '异常提醒', '学习组', '课程表', '课程包', '安排课程'], open: '催交作业', pageTitle: '作业', subpageText: /5 人未提交|暂无真实数据/ },
    { loginId: 'orgadmin_demo', removedFocus: '今日管理', removedTitle: '机构工作台', entries: ['成员管理', '权限管理', '机构设置', '学习组', '课程包', '机构看板'], open: '成员管理', subpageText: /成员管理|还没有可管理机构|正在读取机构数据/ },
    { loginId: 'contentadmin_demo', removedFocus: '今日内容', removedTitle: '内容工作台', entries: ['内容反馈', '发布工作流', '内容日志'], open: '内容反馈', subpageText: '列表来自反馈接口' },
    { loginId: 'superadmin_demo', removedFocus: '今日平台', removedTitle: '平台工作台', entries: ['用户搜索', '机构管理', '角色权限', '功能开关', '全站统计', '支付退款', '反馈处理', '审计日志'], open: '用户搜索', subpageText: '最近用户' }
  ];

  for (const item of cases) {
    await loginWithDevUser(page, item.loginId);
    const roleCard = page.locator('.pc-role-workbench-card');
    await expect(roleCard).not.toContainText(item.removedFocus);
    await expect(roleCard).not.toContainText(item.removedTitle);
    await expect(roleCard).not.toContainText('开始处理');
    await expect(roleCard.locator('.pc-role-section-title')).toHaveText('我的内容');
    const titles = await roleCard.locator('.pc-workbench-action .svc-title').allTextContents();
    expect(titles).toEqual(item.entries);
    await expect(roleCard).not.toContainText('核心入口');
    await expect(roleCard).not.toContainText('辅助入口');
    await expect(roleCard.locator('.pc-workbench-action')).toHaveCount(item.entries.length);
    const gridColumnCount = await roleCard.locator('.pc-role-action-grid').evaluate((grid) => window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    expect(gridColumnCount).toBe(4);
    const actionStyles = await roleCard.locator('.pc-workbench-action').evaluateAll((buttons) => {
      return buttons.map((button) => {
        const buttonStyle = window.getComputedStyle(button);
        const title = button.querySelector('.svc-title');
        const titleStyle = title ? window.getComputedStyle(title) : null;
        return {
          display: buttonStyle.display,
          flexDirection: buttonStyle.flexDirection,
          alignItems: buttonStyle.alignItems,
          textAlign: buttonStyle.textAlign,
          titleTextAlign: titleStyle?.textAlign || ''
        };
      });
    });
    for (const style of actionStyles) {
      expect(style.display).toBe('flex');
      expect(style.flexDirection).toBe('column');
      expect(style.alignItems).toBe('center');
      expect(style.textAlign).toBe('center');
      expect(style.titleTextAlign).toBe('center');
    }
    await expect(page.locator('.pc-my-account-card')).toContainText('我的账户');
    await expect(roleCard.locator('.pc-role-workbench-head')).toHaveCount(0);
    await expect(roleCard.locator('.pc-focus-button')).toHaveCount(0);
    await expect(page.locator('.pc-workbench-focus')).toHaveCount(0);
    await expect(page.locator('.pc-workbench-card')).toHaveCount(0);
    await expect(page.locator('.pc-workbench-more-card')).toHaveCount(0);
    await expect(page.locator('.pc-compact-list-card')).toHaveCount(0);

    await roleCard.locator('.pc-workbench-action').filter({ hasText: item.open }).click();
    await expect(page.locator('.pc-subpage')).toContainText(item.pageTitle || item.open);
    await expect(page.locator('.pc-subpage')).toContainText(item.subpageText);
    await expect(page.locator('.pc-subpage')).not.toContainText('管理面板');
    await page.locator('[data-dashboard-back]').click();
    await expect(page.locator('.pc-role-workbench-card')).toContainText('我的内容');

    await clearBrowserSession(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
});

test('退出并切换角色后回到新角色首页且滚动位置归零', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="支付退款"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('支付退款');
  await page.locator('#pc-content').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await page.locator('#pc-content').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.locator('.pc-logout-action').click();
  const loginEntry = await expectGuestEntry(page);
  await loginEntry.click();
  await page.locator('[data-dev-login="student_demo"]').click();
  await expect(page.locator('#login-modal')).toBeHidden({ timeout: 20000 });
  await openPersonalCenter(page);

  await expect(page.locator('.pc-my-content-card').filter({ hasText: '我的内容' })).toContainText('最近学习');
  await expect(page.locator('.pc-subpage')).toHaveCount(0);
  await expect(page.locator('#personal-center')).not.toContainText('支付退款 · 平台支付管理');
  expect(await page.locator('#pc-content').evaluate((element) => element.scrollTop)).toBe(0);
});

test('教学运营入口只展示机构接口返回的数据', async ({ page }) => {
  await loginWithDevUser(page, 'assistant_demo');

  const expectations = [
    { entry: '催交作业', source: '真实作业' },
    { entry: '学员跟进', source: '真实套餐到期时间和学习活跃度' },
    { entry: '续费风险', source: '真实套餐到期时间和学习活跃度' },
    { entry: '异常提醒', source: '真实未交作业和续费风险' },
    { entry: '学习组', source: '当前老师参与的班级' },
    { entry: '课程表', source: '已排时间的班课' },
    { entry: '课程包', source: '机构课程包接口' },
    { entry: '安排课程', source: '选择学习组进入排课详情' }
  ];

  for (const item of expectations) {
    const roleCard = page.locator('.pc-role-workbench-card');
    await roleCard.locator(`.pc-workbench-action[title="${item.entry}"]`).click();
    const subpage = page.locator('.pc-subpage');
    await expect(subpage).toContainText(item.entry);
    const subpageText = await subpage.textContent() || '';
    expect(subpageText.includes(item.source) || subpageText.includes('暂无真实数据')).toBeTruthy();
    await expect(subpage).not.toContainText(/张同学|王同学|5 人未提交|新建约课|已电话提醒补交作业/);
    await page.locator('[data-dashboard-back]').click();
  }
});

test('老师和内容管理员入口连接真实工作台、反馈、试卷及审计接口', async ({ page }) => {
  await loginWithDevUser(page, 'teacher_demo');

  const teacherExpectations = [
    { entry: '我的学生', source: '分配给当前老师的学习组' },
    { entry: '学习组', source: '当前老师参与的班级' },
    { entry: '课程表', source: '已排时间的班课' },
    { entry: '安排课程', source: '选择学习组进入排课详情' },
    { entry: '待批改', source: '机构成绩接口' },
    { entry: '布置作业', source: '真实学习组' },
    { entry: '成绩册', source: '真实作答记录' },
    { entry: '备课', source: '机构备课接口' }
  ];
  for (const item of teacherExpectations) {
    await page.locator(`.pc-role-workbench-card .pc-workbench-action[title="${item.entry}"]`).click();
    await expect(page.locator('.pc-subpage')).toContainText(item.source);
    await expect(page.locator('.pc-subpage')).not.toContainText(/7 份提交|新建作业|听读解弱项最高|按考点组卷/);
    await page.locator('[data-dashboard-back]').click();
  }

  await clearBrowserSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await loginWithDevUser(page, 'contentadmin_demo');

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="内容反馈"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('列表来自反馈接口');
  await expect(page.locator('.pc-subpage')).toContainText('题目、答案、解析、图片和音频问题');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="发布工作流"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('题目导入 → 质量检查 → 解析审核 → 复核 → 发布版本');
  await expect(page.locator('.pc-subpage')).toContainText('暂无版本记录');
  await expect(page.locator('.pc-subpage')).not.toContainText('音频切割完成后可发布');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="内容日志"]').click();
  await expect(page.locator('#audit-log-modal')).toBeVisible();
});

test('机构与平台管理我的内容入口打开具体子页面', async ({ page }) => {
  const cases = [
    {
      loginId: 'orgadmin_demo',
      expectations: [
        { entry: '成员管理', detail: /成员管理|添加 \/ 邀请|还没有可管理机构|正在读取机构数据/ },
        { entry: '权限管理', detail: /权限管理|成员权限|高级：角色默认权限|还没有可管理机构|正在读取机构数据/ },
        { entry: '机构设置', detail: /机构设置|套餐与席位|校区管理|操作审计|还没有可管理机构|正在读取机构数据/ },
        { entry: '学习组', detail: /学习组|还没有可管理机构|正在读取机构数据/ },
        { entry: '课程包', detail: /课程包|还没有可管理机构|正在读取机构数据/ },
		{ entry: '机构看板', detail: /学习组平均分趋势|暂无趋势数据|正在读取真实学习组/ }
      ]
    },
    {
      loginId: 'superadmin_demo',
      expectations: [
        { entry: '用户搜索', detail: '最近用户' },
        { entry: '机构管理', detail: '新建机构' },
        { entry: '角色权限', detail: /角色默认能力|还没有可管理机构|超级管理员可以先创建机构/ },
        { entry: '功能开关', detail: /功能开关|暂无真实数据|系统开关/ },
        { entry: '全站统计', detail: '全站统计' },
        { entry: '支付退款', detail: '发起退款' },
        { entry: '反馈处理', detail: '列表来自反馈接口' },
        { entry: '审计日志', detail: /审计日志|暂无真实数据|真实高危操作/ }
      ]
    }
  ];

  for (const roleCase of cases) {
    await loginWithDevUser(page, roleCase.loginId);
    for (const item of roleCase.expectations) {
      const roleCard = page.locator('.pc-role-workbench-card');
      await roleCard.locator(`.pc-workbench-action[title="${item.entry}"]`).click();
      if (item.entry === '审计日志') {
        const auditModal = page.locator('#audit-log-modal');
        await expect(auditModal).toBeVisible({ timeout: 20000 });
        await expect(auditModal).toContainText(item.detail);
        await auditModal.locator('#al-close').click();
        continue;
      }
      await expect(page.locator('.pc-subpage')).toContainText(item.entry);
      await expect(page.locator('.pc-subpage')).toContainText(item.detail);
      await expect(page.locator('.pc-subpage')).not.toContainText('管理面板');
      await expect(page.locator('.pc-subpage')).not.toContainText('待配置');
      await page.locator('[data-dashboard-back]').click();
      await expect(page.locator('.pc-role-workbench-card')).toContainText('我的内容');
    }
    await clearBrowserSession(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
});

test('机构管理授权和席位入口使用真实管理页面', async ({ page }) => {
  await loginWithDevUser(page, 'orgadmin_demo');

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="权限管理"]').click();
	await expect(page.locator('.pc-subpage')).toContainText(/角色默认权限|成员权限|正在读取机构数据|还没有可管理机构/);
  await expect(page.locator('.pc-subpage')).not.toContainText('已追加学习组排课权限');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="机构设置"]').click();
	await expect(page.locator('.pc-subpage')).toContainText(/套餐与席位|校区管理|操作审计|正在读取机构数据|还没有可管理机构/);
  await expect(page.locator('.pc-subpage')).not.toContainText('可回收席位');
});

test('平台管理入口支持功能开关、退款和反馈处理闭环', async ({ page, request }) => {
  const feedbackUser = await loginApi(request, uniqueLoginId('feedback_flow_student'));
  const feedbackResponse = await request.post('/api/v1/feedback', {
    data: {
      token: feedbackUser.token,
      paper_id: '2023_02',
      exam_id: '2023_02',
      question_id: '29',
      category: 'question',
      description: 'Playwright 平台反馈处理闭环'
    }
  });
  expect(feedbackResponse.ok()).toBeTruthy();

  const feedbackAdmin = await loginApi(request, 'superadmin_demo');
  const feedbackPageResponse = await request.get('/api/v1/feedback', {
    params: {
      token: feedbackAdmin.token,
      q: 'Playwright',
      page: 1,
      page_size: 1,
      sort: 'created_at',
      order: 'desc'
    }
  });
  expect(feedbackPageResponse.ok()).toBeTruthy();
  const feedbackPagePayload = await feedbackPageResponse.json();
  expect(feedbackPagePayload.data.page).toBe(1);
  expect(feedbackPagePayload.data.page_size).toBe(1);
  expect(feedbackPagePayload.data.total).toBeGreaterThanOrEqual(1);
  expect(feedbackPagePayload.data.items).toHaveLength(1);
  expect(feedbackPagePayload.data.items[0].description).toContain('Playwright 平台反馈处理闭环');

  await loginWithDevUser(page, 'superadmin_demo', {}, { skipApiStubs: true });

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="功能开关"]').click();
  const flagRow = page.locator('[data-platform-system-flag-row="wrong_question_tags"]');
  await expect(flagRow).toContainText('错题归因维度', { timeout: 20000 });
  const startedFromDefault = await flagRow.getByText('默认值', { exact: true }).isVisible();
  const originalStatus = (await flagRow.locator('.pc-tag').first().textContent() || '').trim();
  await flagRow.locator('[data-platform-system-flag-action="enabled"]').click();
  await page.locator('#risk-input').fill('WRONG_QUESTION_TAGS');
  await page.locator('#risk-ok').click();
  await expect(flagRow.locator('.pc-tag').first()).not.toHaveText(originalStatus);
  await expect(flagRow).toContainText('系统设置');
  if (startedFromDefault) {
    await flagRow.locator('[data-platform-system-flag-action="default"]').click();
  } else {
    await flagRow.locator('[data-platform-system-flag-action="enabled"]').click();
  }
  await page.locator('#risk-input').fill('WRONG_QUESTION_TAGS');
  await page.locator('#risk-ok').click();
  await expect(flagRow.locator('.pc-tag').first()).toHaveText(originalStatus);
  if (startedFromDefault) await expect(flagRow).toContainText('默认值');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="支付退款"]').click();
  await page.locator('.pc-subpage .pc-lite-row').filter({ hasText: '套餐价格' }).click();
  await expect(page.locator('.pc-subpage')).toContainText('统一维护个人与机构套餐价格');
  await expect(page.locator('[data-price-scope="personal"][data-price-plan="pro"][data-price-days="30"]')).toHaveValue('19');
  await expect(page.locator('[data-price-scope="organization"][data-price-plan="pro"][data-price-days="30"]')).toHaveValue('15');
  await expect(page.locator('[data-price-min-seats="pro"]')).toHaveValue('20');
  await expect(page.locator('[data-price-tier="2"][data-price-plan="ultra"]')).toHaveValue('219');
  await expect(page.locator('[data-price-offer-card]')).toHaveCount(6);
  await expect(page.locator('[data-price-offer-card][data-offer-scope="personal"][data-offer-id="first_purchase"] [data-offer-discount]')).toHaveValue('20');
  await expect(page.locator('[data-price-offer-card][data-offer-scope="organization"][data-offer-id="renewal"] [data-offer-discount]')).toHaveValue('5');
  await expect(page.locator('[data-renewal-reminder-days]')).toHaveValue('7, 3, 1');
  await expect(page.locator('[data-renewal-price-notice-days]')).toHaveValue('7');
  await expect(page.locator('[data-renewal-grace-days]')).toHaveValue('7');
	  await expect(page.locator('.pc-renewal-operations')).toContainText('续费任务运行状态');
	  await expect(page.locator('.pc-renewal-operations')).toContainText('邮件待重试');
	  await expect(page.locator('.pc-renewal-operations')).toContainText('投递异常');
	  await expect(page.locator('.pc-renewal-operations [data-renewal-job-run]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const pricingLayout = await page.locator('[data-pricing-form]').evaluate((form) => ({
    viewportWidth: window.innerWidth,
    cards: Array.from(form.querySelectorAll('[data-price-offer-card]')).map((card) => {
      const box = card.getBoundingClientRect();
      const fields = Array.from(card.querySelectorAll('.pc-profile-input')).map((input) => input.getBoundingClientRect().width);
      return { left: box.left, right: box.right, width: box.width, fields };
    }),
    renewalFields: Array.from(form.querySelectorAll('.pc-pricing-renewal-controls .pc-profile-input')).map((input) => {
      const box = input.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    })
  }));
  for (const card of pricingLayout.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(pricingLayout.viewportWidth + 1);
    expect(card.width).toBeGreaterThan(240);
    expect(Math.max(...card.fields) - Math.min(...card.fields)).toBeLessThanOrEqual(1);
  }
  for (const field of pricingLayout.renewalFields) {
    expect(field.left).toBeGreaterThanOrEqual(0);
    expect(field.right).toBeLessThanOrEqual(pricingLayout.viewportWidth + 1);
    expect(field.width).toBeGreaterThan(240);
	  }
	  await page.setViewportSize({ width: 1440, height: 1100 });
	  const desktopPricingOverflow = await page.locator('.pc-content').evaluate((content) => {
	    const form = content.querySelector('[data-pricing-form]');
	    return {
	      contentClientWidth: content.clientWidth,
	      contentScrollWidth: content.scrollWidth,
	      formClientWidth: form?.clientWidth ?? 0,
	      formScrollWidth: form?.scrollWidth ?? 0
	    };
	  });
	  expect(desktopPricingOverflow.contentScrollWidth).toBeLessThanOrEqual(desktopPricingOverflow.contentClientWidth + 1);
	  expect(desktopPricingOverflow.formScrollWidth).toBeLessThanOrEqual(desktopPricingOverflow.formClientWidth + 1);
	  await page.locator('[data-pricing-form] button[type="submit"]').click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect(page.locator('#pc-toast')).toContainText('套餐价格、续费提醒与优惠规则已保存');
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="支付退款"]').click();
  await page.locator('[data-platform-refund-order-id]').fill('pay_missing_for_e2e');
  await page.locator('[data-platform-refund-form] button[type="submit"]').click();
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  await expect(page.locator('#pc-toast')).toContainText(/退款申请失败|Payment order not found|not found/);
  await page.locator('[data-dashboard-back]').click();

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="反馈处理"]').click();
  await expect(page.locator('.pc-subpage')).toContainText('Playwright 平台反馈处理闭环');
	await page.locator('[data-feedback-update][data-feedback-status="reviewing"]').first().click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已受理');
  await page.locator('[data-feedback-update][data-feedback-status="resolved"]').first().click();
  await expect(page.locator('#pc-toast')).toContainText('反馈已关闭');
  await page.locator('[data-dashboard-back]').click();
  const auditEntry = page.locator('.pc-role-workbench-card .pc-workbench-action[title="审计日志"]');
  await auditEntry.click();
  const auditModal = page.locator('#audit-log-modal');
  await expect(auditModal).toBeVisible({ timeout: 20000 });
  await expect(auditModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'al-title');
  await expect(auditModal.locator('#al-close')).toBeFocused();
  await expect(auditModal).toContainText('修改反馈状态', { timeout: 20000 });
  await expect(auditModal).toContainText('平台');
  await auditModal.locator('#al-actor').fill('missing_actor_for_empty_state');
  await auditModal.locator('#al-search').click();
  await expect(auditModal.locator('[data-audit-reset-empty]')).toBeVisible();
  await auditModal.locator('[data-audit-reset-empty]').click();
  await expect(auditModal).toContainText('修改反馈状态', { timeout: 20000 });
  const detailEntry = auditModal.locator('button[data-audit-detail]').first();
  await detailEntry.click();
  const detailModal = page.locator('#audit-detail-modal');
  await expect(detailModal).toBeVisible();
  await expect(detailModal.locator('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'ald-title');
  await expect(detailModal.locator('#ald-close')).toBeFocused();
  await expect(detailModal).toContainText(/记录 ID|audit_/);
  await expect(detailModal).toContainText('结构化详情');
  await page.keyboard.press('Escape');
  await expect(detailModal).toBeHidden();
  await expect(detailEntry).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(auditModal).toBeHidden();
  await expect(auditEntry).toBeFocused();
});

test('机构管理首屏只加载分页摘要并在展开时加载详情', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo', {}, { skipApiStubs: true });
  const organizationRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/organizations')) organizationRequests.push(url);
  });

  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="机构管理"]').click();
  await expect(page.locator('[data-managed-org-list-form]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.pc-managed-org-card').first()).toBeVisible({ timeout: 20000 });
  expect(organizationRequests.some((url) => url.pathname === '/api/v1/organizations' && url.searchParams.get('summary') === '1' && url.searchParams.get('page_size') === '20')).toBeTruthy();
  expect(organizationRequests.filter((url) => url.pathname !== '/api/v1/organizations')).toHaveLength(0);
  await expect(page.locator('.pc-managed-org-card .pc-managed-org-body')).toHaveCount(0);
	const toolbarLayout = await page.locator('.pc-managed-org-toolbar').evaluate((toolbar) => {
		const outer = toolbar.getBoundingClientRect();
		const selectors = ['[data-managed-org-query]', 'button[type="submit"]', '.pc-managed-org-page-status', '[data-managed-org-page="prev"]', '[data-managed-org-page="next"]'];
		return { outer, children: selectors.map((selector) => toolbar.querySelector(selector)?.getBoundingClientRect()) };
	});
	for (const child of toolbarLayout.children) {
		expect(child.x).toBeGreaterThanOrEqual(toolbarLayout.outer.x);
		expect(child.x + child.width).toBeLessThanOrEqual(toolbarLayout.outer.x + toolbarLayout.outer.width);
	}
	expect(Math.abs(toolbarLayout.children[0].y - toolbarLayout.children[1].y)).toBeLessThanOrEqual(1);
	expect(Math.abs(toolbarLayout.children[0].height - toolbarLayout.children[1].height)).toBeLessThanOrEqual(1);
	expect(toolbarLayout.children[2].y).toBeGreaterThan(toolbarLayout.children[0].y);
	const createControlLayout = await page.locator('[data-platform-org-create-form]').evaluate((form) => {
		const plan = form.querySelector('[data-platform-org-plan]').getBoundingClientRect();
		const organizationType = form.querySelector('[data-platform-org-type]').getBoundingClientRect();
		const button = form.querySelector('button[type="submit"]').getBoundingClientRect();
		return { plan, organizationType, button };
	});
	expect(Math.abs((createControlLayout.plan.y + createControlLayout.plan.height) - (createControlLayout.button.y + createControlLayout.button.height))).toBeLessThanOrEqual(1);
	expect(Math.abs(createControlLayout.plan.height - createControlLayout.button.height)).toBeLessThanOrEqual(1);
	expect(Math.abs(createControlLayout.organizationType.width - createControlLayout.button.width)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 430, height: 900 });
  const mobileLayout = await page.locator('.pc-managed-org-toolbar').evaluate((toolbar) => {
    const box = (selector) => toolbar.querySelector(selector)?.getBoundingClientRect();
    const input = box('[data-managed-org-query]');
    const search = box('button[type="submit"]');
    const status = box('.pc-managed-org-page-status');
    const previous = box('[data-managed-org-page="prev"]');
    const next = box('[data-managed-org-page="next"]');
    return { input, search, status, previous, next };
  });
  expect(mobileLayout.search.x).toBeGreaterThanOrEqual(mobileLayout.input.x + mobileLayout.input.width);
	expect(Math.abs(mobileLayout.search.y - mobileLayout.input.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(mobileLayout.search.height - mobileLayout.input.height)).toBeLessThanOrEqual(1);
	expect(Math.abs(mobileLayout.search.width - 72)).toBeLessThanOrEqual(1);
  expect(mobileLayout.previous.y).toBeGreaterThanOrEqual(mobileLayout.status.y + mobileLayout.status.height);
  expect(mobileLayout.next.x).toBeGreaterThanOrEqual(mobileLayout.previous.x + mobileLayout.previous.width);
	await page.setViewportSize({ width: 1440, height: 1100 });

  await page.locator('.pc-managed-org-card summary').first().click();
  await expect(page.locator('.pc-managed-org-card').first().locator('.pc-managed-org-body')).toContainText(/套餐与席位|添加 \/ 邀请/, { timeout: 20000 });
  const detailPaths = organizationRequests.map((url) => url.pathname);
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/members$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/campuses$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/learning-groups$/.test(path))).toBeTruthy();
  expect(detailPaths.some((path) => /\/organizations\/[^/]+\/course-packages$/.test(path))).toBeTruthy();
});

test('平台退款提交需要明确确认并恢复按钮状态', async ({ page }) => {
  await loginWithDevUser(page, 'superadmin_demo');
  await page.locator('.pc-role-workbench-card .pc-workbench-action[title="支付退款"]').click();
  await page.locator('[data-platform-refund-order-id]').fill('pay_missing_confirmation_e2e');
  const submit = page.locator('[data-platform-refund-form] button[type="submit"]');

  const refundResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/payments/refunds') && response.request().method() === 'POST'
  );
  await submit.click();
  await expect(page.locator('.pc-confirm-dialog')).toContainText('pay_missing_confirmation_e2e');
  await page.locator('.pc-confirm-dialog [data-pc-confirm-ok]').click();
  expect((await refundResponse).status()).toBe(404);
  await expect(page.locator('#pc-toast')).toContainText(/退款申请失败|Payment order not found|not found/, { timeout: 30000 });
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText('提交退款申请');
});
