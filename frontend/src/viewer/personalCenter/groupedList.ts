const h = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export const disclosureArrow = '<svg class="pc-grouped-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6.25 4.5 3.5 3.5-3.5 3.5"/></svg>';

type GroupedRow = { title: string; desc: string; meta?: string; badge?: string; intent?: string; label?: string; action?: {
  attribute: 'data-org-learning-group-manage' | 'data-role-home-package-edit' | 'data-role-admin-intent'; value: string; organizationId?: string;
} };

/** Text-only rows share one accessible target; action-heavy records keep their own controls. */
export function renderGroupedRow(row: GroupedRow): string {
  const copy = `<span class="pc-grouped-copy"><strong class="pc-grouped-title" title="${h(row.title)}">${h(row.title)}</strong>${row.badge ? `<span class="pc-grouped-status" title="${h(row.badge)}">${h(row.badge)}</span>` : ''}${row.desc ? `<span class="pc-grouped-description">${h(row.desc)}</span>` : ''}${row.meta ? `<span class="pc-grouped-meta">${h(row.meta)}</span>` : ''}</span>`;
  const target = row.intent ? `data-intent="${h(row.intent)}"` : row.action ? `${row.action.attribute}="${h(row.action.value)}"${row.action.organizationId ? ` data-org-id="${h(row.action.organizationId)}"` : ''}` : '';
  return target
    ? `<button class="pc-lite-row service-item pc-grouped-entry" type="button" ${target}${row.label ? ` aria-label="${h(row.label)}"` : ''}>${copy}${disclosureArrow}</button>`
    : `<div class="pc-lite-row pc-lite-row-static pc-grouped-entry">${copy}</div>`;
}

export function renderGroupedList(title: string, rows: GroupedRow[], footer = '', showHeading = true): string {
  return `<section class="pc-card pc-lite-list-card pc-grouped-card" aria-label="${h(title)}">${showHeading ? `<div class="pc-my-content-head pc-grouped-heading">${h(title)}</div>` : ''}<div class="pc-lite-list pc-grouped-list" role="list">${rows.map(row => `<div role="listitem">${renderGroupedRow(row)}</div>`).join('')}</div>${footer}</section>`;
}
