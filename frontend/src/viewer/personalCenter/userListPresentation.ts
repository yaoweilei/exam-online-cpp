import { escapeHtml as h } from './utils.js';

export function renderUserRole(labels: string[]): string {
  const roles = [...new Set(labels.filter(Boolean))];
  const full = roles.join(' / ') || '未设置角色';
  return `<span class="pc-user-role" title="${h(full)}" aria-label="${h(full)}"><span>${h(roles[0] || full)}</span>${roles.length > 1 ? `<small>+${roles.length - 1}</small>` : ''}</span>`;
}

export function renderUserStatus(status: string): string {
  const labels: Record<string, string> = { active: '正常', disabled: '已停用', suspended: '已停用', banned: '已封禁', deleted: '已注销', pending: '待激活', inactive: '未启用' };
  const stopped = ['disabled', 'suspended', 'banned', 'deleted', 'inactive'].includes(status);
  return `<span class="pc-user-status ${status === 'pending' ? 'is-pending' : stopped ? 'is-disabled' : 'is-active'}">${stopped ? '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5"/></svg>' : ''}${h(labels[status] || status)}</span>`;
}

export function renderUserDetailArrow(name: string, intent: string): string {
  return `<button class="pc-user-detail" type="button" data-intent="${h(intent)}" aria-label="查看${h(name)}详情" title="查看用户详情"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="m6 4 4 4-4 4"/></svg></button>`;
}

export function renderUserListItem(name: string, account: string, roles: string[], status: string, intent: string): string {
  return `<li><button type="button" class="pc-user-entry" data-intent="${h(intent)}" aria-label="查看${h(name)}详情"><span class="pc-user-entry-copy"><span class="pc-user-entry-heading"><span class="pc-user-entry-name" title="${h(name)}">${h(name)}</span>${status && status !== 'active' ? renderUserStatus(status) : ''}</span><span class="pc-user-entry-meta">${renderUserRole(roles)}${account && account !== name ? `<span class="pc-user-entry-account" title="${h(account)}"> · ${h(account)}</span>` : ''}</span></span><svg class="pc-user-entry-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="m6 4 4 4-4 4"/></svg></button></li>`;
}
