import { escapeHtml } from './utils.js';
import { renderOutlineIcon } from './icons.js';
import { disclosureArrow } from './groupedList.js';

type HomeGroup = {
  label: string;
  actions: Array<{ title: string; icon: string; intent: string; value?: string; note?: string }>;
  trailing?: string;
};

export type PlatformAdminPage = 'overview' | 'users' | 'roles' | 'access' | 'organizations' | 'content' | 'feedback' | 'payments' | 'pricing' | 'flags' | 'audit' | 'reminders';

/** Sidebar and home use the same destinations. */
export function platformAdminNavigation(): Array<{ group: string; items: Array<{ id: PlatformAdminPage; label: string; icon: string }> }> {
  return [
    { group: '', items: [{ id: 'overview', label: '总览', icon: 'chart' }] },
    { group: '用户与权限', items: [{ id: 'users', label: '用户管理', icon: 'profileMark' }, { id: 'roles', label: '角色权限', icon: 'settings' }, { id: 'access', label: '临时授权', icon: 'profileMark' }] },
    { group: '机构', items: [{ id: 'organizations', label: '机构管理', icon: 'folder' }] },
    { group: '内容管理', items: [{ id: 'content', label: '内容工作流', icon: 'badge' }, { id: 'feedback', label: '反馈处理', icon: 'community' }] },
    { group: '交易管理', items: [{ id: 'payments', label: '订单与支付', icon: 'wallet' }, { id: 'pricing', label: '价格与套餐', icon: 'ticket' }] },
    { group: '系统设置', items: [{ id: 'flags', label: '功能开关', icon: 'settings' }, { id: 'audit', label: '审计日志', icon: 'badge' }, { id: 'reminders', label: '运行提醒', icon: 'clock' }] }
  ];
}

/** Home shortcuts expose every destination, including when the sidebar is closed. */
export function renderHomeManagementGroups(groups: HomeGroup[], role: 'superAdmin' | 'teacher' | 'assistant' | 'orgAdmin' | 'contentAdmin' = 'superAdmin'): string {
  const title = role === 'teacher' ? '教学功能' : role === 'assistant' ? '教务功能' : role === 'orgAdmin' ? '日常管理' : role === 'contentAdmin' ? '常用功能' : '管理功能';
  const actionAttribute = role === 'superAdmin' ? 'data-platform-admin-page' : 'data-role-admin-intent';
  const sections = groups.filter(group => group.actions.length).map(group => `
    <section class="pc-home-settings-group"${group.label ? ` aria-label="${escapeHtml(group.label)}"` : ''}>
      ${group.label ? `<h3>${escapeHtml(group.label)}</h3>` : ''}
      <div class="pc-home-settings-list">
        ${group.actions.map(action => `<button type="button" class="pc-home-settings-row" ${actionAttribute}="${escapeHtml(action.intent)}">
          <span class="pc-home-settings-icon" aria-hidden="true">${renderOutlineIcon(action.icon)}</span>
          <span class="pc-home-settings-label">${escapeHtml(action.title)}${action.note ? `<small class="pc-home-settings-note">${escapeHtml(action.note)}</small>` : ''}</span>
          ${action.value ? `<span class="pc-home-settings-value">${escapeHtml(action.value)}</span>` : ''}${disclosureArrow}
        </button>`).join('')}${group.trailing || ''}
      </div>
    </section>`).join('');
  return `<section class="pc-home-functions pc-home-settings" aria-label="${title}" data-role-home-functions="${role}"><div class="pc-home-settings-groups">${sections}</div></section>`;
}
