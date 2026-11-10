import { escapeHtml as h } from './utils.js';

type Panel = { id: string; label: string; content: string };
const selections = new Map<string, string>();

export function renderTaskPanels(key: string, panels: Panel[], initial = panels[0]?.id): string {
  const active = selections.get(key) || initial;
  const prefix = 'task-' + encodeURIComponent(key);
  return `<section class="pc-task-workspace" data-task-workspace="${h(key)}"><div class="pc-task-tabs" role="tablist" aria-label="详情内容">${panels.map(panel =>
    `<button type="button" role="tab" id="${h(prefix + '-tab-' + panel.id)}" aria-controls="${h(prefix + '-' + panel.id)}" aria-selected="${panel.id === active}" tabindex="${panel.id === active ? 0 : -1}" data-task-tab="${h(panel.id)}">${h(panel.label)}</button>`).join('')}</div>${panels.map(panel =>
    `<section role="tabpanel" id="${h(prefix + '-' + panel.id)}" aria-labelledby="${h(prefix + '-tab-' + panel.id)}" data-task-panel="${h(panel.id)}"${panel.id === active ? '' : ' hidden'}>${panel.content}</section>`).join('')}</section>`;
}

export function bindTaskPanels(root: HTMLElement, activate: () => void): void {
  root.querySelectorAll<HTMLElement>('[data-task-workspace]').forEach(workspace => {
    if (workspace.dataset.taskBound) return;
    workspace.dataset.taskBound = 'true';
    const tabs = [...workspace.querySelectorAll<HTMLButtonElement>('[data-task-tab]')].filter(tab => tab.closest('[data-task-workspace]') === workspace);
    const select = (tab: HTMLButtonElement) => {
      selections.set(workspace.dataset.taskWorkspace!, tab.dataset.taskTab!);
      tabs.forEach(item => { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; });
      workspace.querySelectorAll<HTMLElement>('[data-task-panel]').forEach(panel => {
        if (panel.closest('[data-task-workspace]') === workspace) panel.hidden = panel.dataset.taskPanel !== tab.dataset.taskTab;
      });
      activate();
    };
    tabs.forEach((tab, index) => {
      tab.onclick = event => { event.stopPropagation(); select(tab); };
      tab.onkeydown = event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); select(tabs[next]); tabs[next].focus({ preventScroll: true });
      };
    });
  });
}
