import { escapeHtml } from './utils.js';

export function renderRoleHomeButton(role: string, label: string): string {
  const destination = role === 'student' ? '学习首页' : role === 'superAdmin' ? '平台总览' : label + '主页';
  const attributes = role === 'superAdmin' ? 'data-platform-admin-page="overview"' : 'data-role-admin-intent="__overview__"';
  return `<button type="button" class="pc-workspace-home" data-workspace-home="${escapeHtml(role)}" ${attributes} aria-label="返回${escapeHtml(destination)}" title="返回${escapeHtml(destination)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 10.5 12 3l9 7.5V21H3zM10 21v-7h4v7"/></svg></button>`;
}
