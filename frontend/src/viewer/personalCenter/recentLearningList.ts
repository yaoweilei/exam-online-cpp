import { disclosureArrow, renderGroupedRow } from './groupedList.js';

type LearningRow = { title: string; desc: string; meta?: string; intent?: string };
export const recentLearningPageSize = 10;

export function renderRecentLearningList(rows: LearningRow[], requestedPage: number): string {
  const pages = Math.max(1, Math.ceil(rows.length / recentLearningPageSize));
  const page = Math.min(pages, Math.max(1, Math.trunc(requestedPage) || 1));
  const visible = rows.slice((page - 1) * recentLearningPageSize, page * recentLearningPageSize);
  return `<section class="pc-card pc-grouped-card pc-recent-learning-list" data-recent-fit="${visible.length >= 8}" aria-label="学习记录" style="--recent-row-count:${Math.max(1, visible.length)}"><div class="pc-grouped-list" role="list">${visible.map(row => `<div role="listitem">${renderGroupedRow({ title: row.title, desc: row.desc, intent: row.intent, label: `${row.meta || '查看记录'}：${row.title}，${row.desc}` })}</div>`).join('')}</div><nav class="pc-recent-learning-pagination" aria-label="学习记录分页"><span>共 ${rows.length} 条</span><div><button type="button" data-recent-learning-page="${page - 1}" aria-label="上一页学习记录"${page <= 1 ? ' disabled' : ''}>${disclosureArrow}</button><span>${page} / ${pages} 页</span><button type="button" data-recent-learning-page="${page + 1}" aria-label="下一页学习记录"${page >= pages ? ' disabled' : ''}>${disclosureArrow}</button></div></nav></section>`;
}
