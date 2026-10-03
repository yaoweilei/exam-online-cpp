import type { AppStore } from '../state/store.js';

/** Shared navigation frame. Existing exam controls retain their event handlers. */
export function initLearningShell(store: AppStore): void {
  if (document.getElementById('learning-shell')) return;
  const app = window as Window & {
    navigateLearningWorkspace?: (intent: string) => void;
    closeLearningWorkspace?: () => void;
  };
  const icons = [
    '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path class="home-door" d="M10 14h4v7h-4z"/>',
    '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    '<path d="M4 4h7v16H4zM13 4h7v16h-7zM11 6h2"/>',
    '<path d="M4 20h17M7 16v-5M12 16V7M17 16V3"/>'
  ];
  const groups = [
    { id: 'study', name: '学习', title: '学习安排', links: [['学习总览', '__overview__'], ['今日学习', 'openStudentQueue'], ['我的作业', 'openAssignments']] },
    { id: 'practice', name: '练习', title: '试卷练习', links: [] },
    { id: 'review', name: '复习', title: '复习资料', links: [['复习资料', 'openRoleContent:student-review-library'], ['收藏题目', 'openBookmarkFolders']] },
    { id: 'history', name: '记录', title: '学习记录', links: [['最近学习', 'openRecentLearningPage'], ['学习报告', 'openLearningReport']] }
  ];
  const experienceIcon = '<path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M7 7h6M7 11h3"/><path d="m14 15 5-5 3 3-5 5-4 1zM18 11l3 3"/>';
  const menuIcon = (intent: string) => {
    const path = intent === '__overview__' ? icons[0]
      : intent === 'guestExperience' ? experienceIcon
      : intent === 'openStudentQueue' ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
      : intent === 'openAssignments' ? '<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>'
      : intent === 'openBookmarkFolders' ? '<path d="M6 3h12v18l-6-4-6 4z"/>'
      : intent === 'openLearningReport' ? icons[3] : icons[2];
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  };
  const shell = document.createElement('div');
  shell.id = 'learning-shell';
  shell.innerHTML = `<nav class="ls-rail" aria-label="工作台分类">${groups.map((group, i) => `<button type="button" data-ls-group="${group.id}" title="${group.title}" aria-label="${group.title}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[i]}</svg><span>${group.name}</span></button>`).join('')}<button class="ls-collapse" type="button" aria-label="收起功能菜单" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM9 4v16"/></svg><span>收起</span></button></nav>
    <aside class="ls-menu" aria-label="工作台功能"><header><strong>日语学习</strong><button class="ls-close" type="button" aria-label="关闭导航">×</button></header><button type="button" class="ls-link ls-continue" data-ls-continue>${menuIcon('openStudentQueue')}<span>继续练习</span></button>${groups.map(group => `<section data-ls-panel="${group.id}" hidden><h2>${group.title}</h2>${group.links.map(([label, intent]) => `<button class="ls-link" type="button" data-ls-intent="${intent}">${menuIcon(intent)}<span>${label}</span></button>`).join('')}${group.id === 'practice' ? '<div class="ls-paper-header"><h2>当前试卷</h2><p class="ls-current-paper" id="ls-current-paper"></p><p class="ls-range-summary" hidden></p><details class="ls-paper-picker"><summary aria-label="更换试卷">更换</summary><div id="ls-paper-fields"></div></details></div><h2 class="ls-category-heading">题型</h2><div id="ls-exam-controls"></div><details class="ls-settings"><summary><span aria-hidden="true">⚙</span> 练习设置</summary><div id="ls-settings-host"></div></details>' : ''}</section>`).join('')}<footer></footer></aside>`;
  const topbar = document.createElement('header');
  topbar.id = 'learning-topbar';
  topbar.innerHTML = '<button class="ls-mobile-toggle" type="button" aria-label="打开工作台导航" aria-expanded="false"><span class="ls-mobile-toggle-mark" aria-hidden="true"></span></button><strong>试卷练习</strong><div id="learning-account"></div>';
  const backdrop = document.createElement('button');
  backdrop.className = 'ls-backdrop';
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', '关闭导航');
  document.body.append(shell, backdrop);
  document.getElementById('exam-content')?.before(topbar);
  document.body.classList.add('learning-shell-active');
  const guestRail = document.createElement('div');
  guestRail.className = 'ls-guest-rail';
  guestRail.innerHTML = [['home', '首页', icons[0]], ['experience', '先试一题', experienceIcon], ['exams', '选择考试', icons[1]]].map(([action, label, icon]) => `<button type="button" data-ls-guest-action="${action}" aria-label="${label}" title="${label}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('');
  shell.querySelector('.ls-rail')?.prepend(guestRail);
  const guestPanel = document.createElement('section');
  guestPanel.dataset.lsPanel = 'guest';
  guestPanel.hidden = true;
  guestPanel.innerHTML = `<h2>开始学习</h2><button class="ls-link" type="button" data-ls-guest-action="home">${menuIcon('__overview__')}<span>首页</span></button><h2>先试一题</h2><button class="ls-link" type="button" data-ls-guest-action="experience">${menuIcon('guestExperience')}<span>N3 短篇阅读体验</span></button><h2>选择考试</h2><button class="ls-link" type="button" data-ls-guest-action="jlpt">${menuIcon('openAssignments')}<span>JLPT · N3 / N2 / N1</span></button><button class="ls-link" type="button" data-ls-guest-action="eju">${menuIcon('openAssignments')}<span>EJU · 日本语</span></button><p class="ls-guest-note">登录后作答可自动保存进度。</p>`;
  shell.querySelector('.ls-menu footer')?.before(guestPanel);
  const practicePanel = shell.querySelector<HTMLElement>('[data-ls-panel="practice"]')!;
  const guestTools = document.createElement('div');
  guestTools.className = 'ls-guest-paper-tools';
  guestTools.hidden = true;
  guestPanel.querySelector('.ls-guest-note')?.before(guestTools);
  for (const family of ['jlpt', 'eju']) {
    const summary = document.createElement('p');
    summary.className = 'ls-selected-summary';
    summary.dataset.family = family;
    summary.hidden = true;
    guestPanel.querySelector(`[data-ls-guest-action="${family}"]`)?.after(summary);
  }
  let guest = store.getState().user.guest;
  const move = (id: string, host: string) => {
    const element = document.getElementById(id);
    const parent = document.getElementById(host);
    if (element && parent) parent.append(element);
  };
  move('exam-controls', 'ls-exam-controls');
  move('exam-settings-control', 'ls-settings-host');
    const themeSelect = document.getElementById('theme-mode-select') as HTMLSelectElement | null;
    if (themeSelect) {
      const themeControl = document.createElement('div');
      themeControl.className = 'ls-theme-control';
      themeControl.innerHTML = `<button type="button" class="ls-theme-trigger" title="显示主题" aria-label="显示主题" aria-expanded="false" aria-controls="ls-theme-menu"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg></button><div id="ls-theme-menu" class="ls-theme-menu" role="group" aria-label="显示主题" hidden><strong>显示主题</strong>${[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([mode, label]) => `<button type="button" role="radio" aria-checked="false" data-theme-mode="${mode}">${label}<span aria-hidden="true">✓</span></button>`).join('')}</div>`;
      shell.querySelector('.ls-collapse')?.before(themeControl);
      const oldLabel = themeSelect.closest('label');
      themeControl.append(themeSelect);
      themeSelect.hidden = true;
      oldLabel?.remove();
      const trigger = themeControl.querySelector<HTMLButtonElement>('.ls-theme-trigger')!;
      const menu = themeControl.querySelector<HTMLElement>('.ls-theme-menu')!;
      const syncTheme = () => themeControl.querySelectorAll<HTMLElement>('[data-theme-mode]').forEach(button => button.setAttribute('aria-checked', String(button.dataset.themeMode === themeSelect.value)));
      const closeTheme = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
      trigger.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        trigger.setAttribute('aria-expanded', String(!menu.hidden));
        syncTheme();
        if (!menu.hidden) menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
      });
      menu.addEventListener('click', event => {
        const option = (event.target as HTMLElement).closest<HTMLElement>('[data-theme-mode]');
        if (!option) return;
        themeSelect.value = option.dataset.themeMode!;
        themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        syncTheme();
        closeTheme();
        trigger.focus();
      });
      themeSelect.addEventListener('change', syncTheme);
      document.addEventListener('click', event => { if (!themeControl.contains(event.target as Node)) closeTheme(); });
      themeControl.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) { event.stopPropagation(); closeTheme(); trigger.focus(); }
      });
      syncTheme();
    }
    const assistMenu = document.getElementById('learning-tools-menu');
    assistMenu?.setAttribute('role', 'group');
    assistMenu?.setAttribute('aria-label', '显示辅助');
    assistMenu?.querySelectorAll('button').forEach(button => button.setAttribute('role', 'switch'));
  // Move the labelled controls rather than duplicating their listeners.
  const settings = document.getElementById('exam-settings-menu');
  if (settings) {
    settings.removeAttribute('role');
    for (const slot of ['family', 'level', 'paper']) {
      const label = settings.querySelector(`[data-exam-setting-slot="${slot}"]`)?.parentElement;
      if (label) document.getElementById('ls-paper-fields')?.append(label);
    }
  }
  move('user-menu-trigger', 'learning-account');
  move('theme-toggle', 'learning-account');
  move('answer-save-status', 'learning-account');
  move('exam-timer-slot', 'learning-account');
  function syncPaperSummary(): void {
    const viewer = (window as Window & { examViewer?: { _currentExamId?: string | null; practiceRangeLocked?: boolean; practiceScope?: { label: string; sectionIndexes: number[] } | null; currentSectionIndex?: number; currentExam?: { family?: string; exam_info?: { sections?: { section_name?: string; section_type?: string }[] } } } }).examViewer;
    document.body.classList.toggle('ls-range-locked', !!viewer?.practiceRangeLocked);
    document.body.classList.toggle('ls-scoped-practice', !!viewer?.practiceRangeLocked && !!viewer?.practiceScope);
    shell.querySelector('.ls-paper-header h2')!.textContent = viewer?.practiceRangeLocked ? '当前练习' : '当前试卷';
    const rangeSummary = shell.querySelector<HTMLElement>('.ls-range-summary')!;
    rangeSummary.hidden = !viewer?.practiceRangeLocked;
    rangeSummary.textContent = viewer?.practiceScope ? `${viewer.practiceScope.label} · ${viewer.practiceScope.sectionIndexes.length} 个题组` : '完整试卷';
    const id = viewer?._currentExamId || '';
    const level = id.match(/N[1-3]/)?.[0] || '';
    const date = id.match(/(20\d{2})[_-](\d{2})/);
    const family = /EJU/i.test(id) || viewer?.currentExam?.family?.toLowerCase() === 'eju' ? 'EJU' : /N[1-3]/.test(id) ? 'JLPT' : '';
    const text = [family && `${family}${level ? ` ${level}` : ''}`, date && `${date[1]}年${family === 'EJU' ? `第${Number(date[2])}回` : `${Number(date[2])}月`}`].filter(Boolean).join(' · ') || '选择一份试卷开始练习';
    shell.querySelector('#ls-current-paper')!.textContent = text;
    const section = viewer?.currentExam?.exam_info?.sections?.[viewer.currentSectionIndex || 0];
    const category = ({ vocabulary: '词汇', grammar: '语法', reading: '阅读', listening: '听力', writing: '记述', listening_reading: '听读解' } as Record<string, string>)[section?.section_type || ''] || '';
    guestPanel.querySelectorAll<HTMLElement>('.ls-selected-summary').forEach(summary => {
      summary.hidden = document.body.classList.contains('guest-welcome-open') || summary.dataset.family !== family.toLowerCase() || !id;
      summary.textContent = [text, category, section?.section_name].filter(Boolean).join(' · ');
    });
  }
  new MutationObserver(syncPaperSummary).observe(document.getElementById('ls-exam-controls')!, { childList: true, subtree: true });
  new MutationObserver(syncPaperSummary).observe(document.getElementById('current-question-container')!, { childList: true, subtree: true });
  window.addEventListener('practiceRangeChanged', syncPaperSummary);
  shell.addEventListener('change', syncPaperSummary);
  // Only one secondary control group needs to be expanded at a time.
  for (const detail of shell.querySelectorAll<HTMLDetailsElement>('.ls-paper-picker, .ls-settings')) {
    detail.addEventListener('toggle', () => {
      if (detail.open) shell.querySelectorAll<HTMLDetailsElement>('.ls-paper-picker, .ls-settings').forEach(other => { if (other !== detail) other.open = false; });
    });
  }
  const returnButton = document.querySelector('.gw-return');
  if (returnButton) shell.querySelector('.ls-menu footer')?.before(returnButton);
  let currentGroup = 'practice';
  function syncGuestView(view: string): void {
    if (!guest) return;
    guestTools.append(practicePanel);
    guestTools.hidden = view !== 'paper';
    guestPanel.classList.toggle('ls-paper-view', view === 'paper');
      if (view === 'paper') closeDrawer();
    selectGroup('guest', false);
    practicePanel.hidden = view !== 'paper';
    syncPaperSummary();
    const selected = view === 'paper' ? 'exams' : view;
    guestRail.querySelectorAll<HTMLElement>('[data-ls-guest-action]').forEach(button => {
      const active = button.dataset.lsGuestAction === selected;
      button.setAttribute('aria-pressed', String(active));
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const selectedLink = view === 'exams' || view === 'paper' ? document.getElementById('guest-welcome')?.dataset.family : selected;
    guestPanel.querySelectorAll<HTMLElement>('[data-ls-guest-action]').forEach(button => {
      const active = button.dataset.lsGuestAction === selectedLink;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function syncGuestState(): void {
    guest = store.getState().user.guest;
    document.body.classList.toggle('ls-guest-navigation', guest);
    if (guest) syncGuestView(document.body.classList.contains('guest-welcome-open') ? document.getElementById('guest-welcome')?.dataset.view || 'home' : 'paper');
    else {
      guestPanel.before(practicePanel);
      guestTools.hidden = true;
      if (currentGroup === 'guest') selectGroup('practice', false);
    }
  }
  function selectGroup(id: string, closeWorkspace = true): void {
    currentGroup = id;
    shell.querySelectorAll<HTMLElement>('[data-ls-panel]').forEach(panel => { panel.hidden = panel.dataset.lsPanel !== id; });
    shell.querySelectorAll<HTMLElement>('[data-ls-group]').forEach(button => {
      const active = button.dataset.lsGroup === id;
      button.setAttribute('aria-pressed', String(active));
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (id === 'practice') {
      syncPaperSummary();
      if (closeWorkspace) app.closeLearningWorkspace?.();
      topbar.querySelector('strong')!.textContent = '试卷练习';
    }
  }
  function closeDrawer(): void {
    document.body.classList.remove('ls-drawer-open');
    topbar.querySelector('button')!.setAttribute('aria-expanded', 'false');
  }
  shell.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('.gw-return')) { closeDrawer(); return; }
    const guestAction = target.closest<HTMLElement>('[data-ls-guest-action]');
    if (guestAction) {
      window.dispatchEvent(new CustomEvent('guestWelcomeNavigate', { detail: { action: guestAction.dataset.lsGuestAction } }));
      closeDrawer();
      return;
    }
    if (target.closest('[data-ls-continue]')) { selectGroup('practice'); closeDrawer(); }
    const group = target.closest<HTMLElement>('[data-ls-group]');
    if (group) {
      selectGroup(group.dataset.lsGroup!);
      document.body.classList.remove('ls-menu-collapsed');
      if (window.innerWidth < 768) document.body.classList.add('ls-drawer-open');
      syncCollapse();
      const first = shell.querySelector<HTMLButtonElement>(`[data-ls-panel="${currentGroup}"] [data-ls-intent]`);
      first?.click();
    }
    const link = target.closest<HTMLElement>('[data-ls-intent]');
    if (link) {
      app.navigateLearningWorkspace?.(link.dataset.lsIntent!);
      shell.querySelectorAll('.ls-link').forEach(el => el.classList.toggle('is-active', el === link));
      closeDrawer();
    }
    if (target.closest('.ls-close')) closeDrawer();
    if (target.closest('.category-menu-item, #open-question-map, #submit-exam')) closeDrawer();
    if (target.closest('.ls-collapse')) {
      if (window.innerWidth < 768) document.body.classList.toggle('ls-drawer-open');
      else document.body.classList.toggle('ls-menu-collapsed');
      syncCollapse();
      window.dispatchEvent(new Event('resize'));
    }
  });
  function syncCollapse(): void {
    const collapsed = document.body.classList.contains('ls-menu-collapsed');
    const button = shell.querySelector('.ls-collapse')!;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开功能菜单' : '收起功能菜单');
    button.querySelector('span')!.textContent = collapsed ? '展开' : '收起';
  }
  topbar.querySelector('button')!.addEventListener('click', () => {
    const open = document.body.classList.toggle('ls-drawer-open');
    topbar.querySelector('button')!.setAttribute('aria-expanded', String(open));
    if (open) (guest ? guestRail.querySelector<HTMLButtonElement>('[aria-pressed="true"]') : shell.querySelector<HTMLButtonElement>(`[data-ls-group="${currentGroup}"]`))?.focus();
  });
  shell.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !document.body.classList.contains('ls-drawer-open') || window.innerWidth > 700) return;
    const focusable = Array.from(shell.querySelectorAll<HTMLElement>('button, select, summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0 && !el.hasAttribute('disabled'));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('ls-drawer-open')) {
      closeDrawer();
      topbar.querySelector<HTMLButtonElement>('button')!.focus();
    }
  });
  window.addEventListener('learningWorkspaceChanged', ((event: CustomEvent<{ role: string; intent: string }>) => {
    if (event.detail.role !== 'student') return;
    const group = groups.find(group => group.links.some(([, intent]) => intent === event.detail.intent));
    if (event.detail.intent === '__practice__') selectGroup('practice', false);
    else if (group) selectGroup(group.id, false);
    shell.querySelectorAll<HTMLElement>('[data-ls-intent]').forEach(link => link.classList.toggle('is-active', link.dataset.lsIntent === event.detail.intent));
  }) as EventListener);
  selectGroup('practice');
  window.addEventListener('guestWelcomeChanged', ((event: CustomEvent<{ view: string }>) => syncGuestView(event.detail.view)) as EventListener);
  store.subscribe(syncGuestState);
  syncGuestState();
}
