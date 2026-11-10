import { createUuid } from '../../uuid.js';
import { asRecord, escapeHtml as h, isWorkspaceSessionError, renderWorkspaceSessionError } from './utils.js';
import { renderInstitutionFlow, bindInstitutionFlows } from './institutionWorkflow.js';
import { localDateTime, localDay } from './presentation.js';
import { disclosureArrow } from './groupedList.js';
import { renderOutlineIcon } from './icons.js';

type Row = Record<string, any>;
type Kind = 'progress' | 'weakness' | 'setup' | 'operations' | 'platform-operations' | 'comments' | 'feedback';
type Hooks = {
  owner: string; token: string; orgId: string; current: () => boolean; changed: () => void;
  navigate: (kind: string, id: string, org?: string) => void;
  password: (title: string) => Promise<string | null>; confirm: (text: string) => Promise<boolean>;
};
type State = { data: Row; values: Record<string, string>; selected: Set<string>; error: string; busy: boolean; page: number; step: number; group: string; requestId: string; filter: string; disclosureOpen?: boolean; operationSections?: Set<string>; readId?: number; loading?: boolean; loginRequired?: boolean };
const states = new Map<string, State>();
const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const display = (row: Row = {}) => String(row.display_name || row.username || row.name || row.id || '');
const pct = (value: unknown) => typeof value === 'number' ? value.toFixed(1) + '%' : '—';
const date = (value: unknown) => localDateTime(value, '未安排');
const plain = (value: unknown) => { const row = asRecord(value); const text = row ? row.question || row.text || row.title || '' : value; const el = document.createElement('div'); el.innerHTML = typeof text === 'string' ? text : ''; return el.textContent || ''; };
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };
const option = (value: string, label: string, selected = '') => '<option value="' + h(value) + '"' + (value === selected ? ' selected' : '') + '>' + h(label) + '</option>';
const button = (label: string, action: string, extra = '') => '<button type="button" class="pc-inline-ghost" data-product-action="' + action + '" ' + extra + '>' + label + '</button>';
const empty = (text: string) => '<p class="pc-flow-empty">' + h(text) + '</p>';
const labels: Record<string, string> = { scheduled: '待上课', completed: '已完成', cancelled: '已取消', active: '正常', pending: '待跟进', contacted: '已联系' };

export function renderProductPanel(kind: Kind, org = '', student = '', id = ''): string {
  return '<section class="pc-institution-flow pc-product-panel" data-product-panel="' + kind + '" data-org="' + h(org) + '" data-student="' + h(student) + '" data-id="' + h(id) + '"><p role="status">正在读取…</p></section>';
}

export function bindProductPanels(root: HTMLElement, hooks: Hooks): void {
  root.querySelectorAll<HTMLElement>('[data-product-panel]').forEach(host => {
    if (host.closest('[data-task-panel][hidden]')) return;
    const kind = host.dataset.productPanel as Kind, org = host.dataset.org || hooks.orgId, student = host.dataset.student || hooks.owner, id = host.dataset.id || '';
    const key = [hooks.owner, kind, org, student, id].join(':');
    if (!states.has(key)) states.set(key, { data: {}, values: { from: day(kind === 'progress' ? -89 : -6), to: day(), date: new Date().toISOString().slice(0, 10) }, selected: new Set(), error: '', busy: false, page: 1, step: 0, group: '', requestId: createUuid(), filter: 'all' });
    const s = states.get(key)!;
    const disclosure = host.closest<HTMLDetailsElement>('details');
    if (disclosure && !host.dataset.lazy) {
      host.dataset.lazy = 'true';
      if (s.disclosureOpen !== undefined) disclosure.open = s.disclosureOpen;
      disclosure.addEventListener('toggle', () => { s.disclosureOpen = disclosure.open; if (disclosure.open) bindProductPanels(root, hooks); });
    }
    if (disclosure && !disclosure.open) {
      return;
    }
    if (host.dataset.bound) return; host.dataset.bound = 'true';
    const valid = () => hooks.current() && host.isConnected && root.contains(host);
    const request = async (path: string, payload?: Row) => {
      if (!valid() || !window.APIClient) throw new Error('页面已变化，请重新打开');
      return await window.APIClient.request(path + (payload ? '' : (path.includes('?') ? '&' : '?') + new URLSearchParams({ token: hooks.token })),
        payload ? { method: 'POST', body: JSON.stringify({ ...payload, token: hooks.token }) } : {});
    };
    const input = (name: string, label: string, type = 'text', extra = '') => '<label class="pc-org-field"><span>' + label + '</span><input class="pc-profile-input" name="' + name + '" type="' + type + '" value="' + h(s.values[name] || '') + '" ' + extra + '/></label>';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const range = () => input('from', '开始日期', 'date', 'required') + input('to', '结束日期', 'date', 'required');
    const link = (label: string, destination: string, target: string, targetOrg = org) => '<button class="pc-inline-ghost" type="button" data-product-open="' + destination + '" data-target="' + h(target) + '" data-target-org="' + h(targetOrg) + '">' + label + '</button>';
    const pager = (count: number) => count > 20 ? '<div class="pc-flow-toolbar pc-product-pagination"><span>共 ' + count + ' 条 · 第 ' + s.page + '/' + Math.ceil(count / 20) + ' 页</span>' + button('上一页', 'previous', s.page <= 1 ? 'disabled' : '') + button('下一页', 'next', s.page >= Math.ceil(count / 20) ? 'disabled' : '') + '</div>' : '';
    const slice = (rows: Row[]) => { s.page = Math.min(s.page, Math.max(1, Math.ceil(rows.length / 20))); return rows.slice((s.page - 1) * 20, s.page * 20); };
    const summary = (rows: [string, string][]) => '<div class="pc-product-summary">' + rows.map(([label, value]) => '<div><small>' + label + '</small><strong>' + h(value) + '</strong></div>').join('') + '</div>';
    function progress(): string {
      const data = s.data, total = data.total || {}, before = data.before || {}, after = data.after || {};
      const targets = [...new Set([...list(data.targets) as unknown as string[], s.values.target || data.target || ''].filter(Boolean))];
      const skills = (Array.isArray(data.skills) ? data.skills : []) as string[];
      const points = list(data.daily), x = (i: number) => 35 + i * 610 / Math.max(1, points.length - 1), y = (value: number) => 140 - value * 1.15;
      const chart = points.length > 1 ? '<svg class="pc-product-chart" viewBox="0 0 680 175" role="img" aria-label="所选日期的独立作答正确率趋势"><path d="M35 20V140H650" fill="none" stroke="currentColor" opacity=".3"/><text x="0" y="28">100%</text><text x="8" y="143">0%</text><polyline fill="none" stroke="var(--workspace-accent, #b84b13)" stroke-width="2.5" points="' + points.map((p, i) => x(i) + ',' + y(p.accuracy)).join(' ') + '"/><text x="35" y="167">' + h(points[0].date) + '</text><text x="565" y="167">' + h(points[points.length - 1].date) + '</text></svg>' : '';
      const midpoint = String(data.midpoint || '');
      const earlierEnd = /^\d{4}-\d{2}-\d{2}$/.test(midpoint) ? new Date(Date.parse(midpoint + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) : '';
      const earlierRange = midpoint && data.from < midpoint ? data.from + ' — ' + earlierEnd : '暂无可比较时段';
      const laterRange = midpoint ? midpoint + ' — ' + data.to : '读取后显示日期区间';
      const comparison = '<div class="pc-product-summary pc-progress-comparison"><div><small>前期 · ' + h(earlierRange) + '</small><strong>' + pct(before.accuracy) + '</strong><span>' + (before.questions || 0) + ' 题 · ' + (before.attempts || 0) + ' 次独立作答</span></div><div><small>本期 · ' + h(laterRange) + '</small><strong>' + pct(after.accuracy) + '</strong><span>' + (after.questions || 0) + ' 题 · ' + (after.attempts || 0) + ' 次独立作答</span></div><div><small>正确率变化</small><strong>' + (typeof data.change_points === 'number' ? (data.change_points >= 0 ? '+' : '') + data.change_points.toFixed(1) + ' 个百分点' : '样本不足') + '</strong><span>共 ' + (total.questions || 0) + ' 题；时区 ' + h(data.timezone || timezone) + '</span></div></div>';
      return '<h2>学习进步</h2><form data-product-form="filters" class="pc-product-filters">' + range() + '<label class="pc-org-field"><span>考试目标</span><select name="target" class="pc-profile-input">' + (targets.map(value => option(value, value, s.values.target || data.target)).join('') || '<option value="">暂无记录</option>') + '</select></label><label class="pc-org-field"><span>题型</span><select class="pc-profile-input" name="skill">' + option('', '全部题型', s.values.skill) + skills.map(value => option(value, value, s.values.skill)).join('') + '</select></label><button class="pc-inline-btn" type="submit">查看进步</button></form>' +
        comparison +
        '<p class="pc-admin-note">' + h(data.note || '') + '</p>' +
        (!data.sufficient && total.questions ? '<p class="pc-product-warning">当前样本较少，变化仅供初步参考。</p>' : '') + chart +
        (points.length ? '<details class="pc-progress-daily"><summary>每日作答明细 · ' + points.length + ' 天</summary><div class="pc-product-table"><table><thead><tr><th>日期</th><th>答对 / 独立作答</th><th>正确率</th></tr></thead><tbody>' + slice(points).map(p => '<tr><td>' + h(p.date) + '</td><td>' + p.correct + ' / ' + p.questions + '</td><td>' + pct(p.accuracy) + '</td></tr>').join('') + '</tbody></table></div>' + pager(points.length) + '</details>' : empty('所选范围内还没有可比较的独立作答记录。'));
    }
    function weakness(): string {
      const items = list(s.data.items), exams = [...new Set(items.map(row => String(row.exam_id)))], skills = [...new Set(items.map(row => String(row.skill)))];
      if (!s.values.exam && exams.length) s.values.exam = exams[0];
      const shown = items.filter(row => row.exam_id === s.values.exam && (!s.values.skill || row.skill === s.values.skill));
      return '<h2>根据薄弱项布置作业</h2><p class="pc-admin-note">从该学员最近一次各卷作答的错题选题，仅分配给当前学员。</p>' + (items.length ? '<form data-product-form="weakness"><div class="pc-product-filters"><label class="pc-org-field"><span>试卷</span><select name="exam" class="pc-profile-input" data-product-local-filter>' + exams.map(value => option(value, String(items.find(row => row.exam_id === value)?.exam_title || value), s.values.exam)).join('') + '</select></label><label class="pc-org-field"><span>题型</span><select class="pc-profile-input" name="skill" data-product-local-filter>' + option('', '全部薄弱题型', s.values.skill) + skills.map(value => option(value, value, s.values.skill)).join('') + '</select></label></div>' +
        '<fieldset class="pc-product-choices"><legend>选择作业题目</legend>' + shown.map(row => '<label><input type="checkbox" name="question_ids" value="' + h(row.question_id) + '"' + (s.selected.has(row.question_id) ? ' checked' : '') + '/><span>' + h(row.skill + ' · ' + row.question_id + ' · ' + plain(row.question).slice(0, 120)) + '</span></label>').join('') + '</fieldset>' +
        '<div class="pc-product-filters"><label class="pc-org-field"><span>所属班级</span><select class="pc-profile-input" name="group" required>' + list(s.data.groups).map(row => option(row.group_id, row.name, s.values.group)).join('') + '</select></label>' + input('title', '作业标题', 'text', 'required maxlength="120"') + input('due', '截止时间（可选）', 'datetime-local') + '</div><p>接收学员：<strong>' + h(display(s.data.student)) + '</strong></p><button class="pc-inline-btn" type="submit">布置所选错题</button></form>' : empty('暂无可定位的错题。学员独立作答后，可在这里选题。'));
    }
    function setup(): string {
      const data = s.data, students = list(data.students), teachers = list(data.teachers), templates = list(data.templates).filter(row => row.eligible);
      const steps = ['成员与邀请', '分班与课时', '安排首课'];
      const heading = `<header class="pc-setup-progress"><span>第 ${s.step + 1} 步，共 ${steps.length} 步</span><h2 aria-current="step" tabindex="-1">${steps[s.step]}</h2></header>`;
      if (s.step === 0) return `${heading}
        <dl class="pc-setup-group pc-setup-facts">
          <div><dt>当前机构</dt><dd>${h(data.organization_name || '—')}</dd></div>
          <div><dt>学员</dt><dd>${students.length} 位</dd></div>
          <div><dt>可授课职员</dt><dd>${teachers.length} 位</dd></div>
        </dl>
        <section class="pc-setup-section">
          <div class="pc-setup-section-head"><h3>添加成员</h3>${button('刷新成员', 'refresh')}</div>
          <div class="pc-setup-group pc-setup-rows">
            ${link(`添加或邀请成员${disclosureArrow}`, 'member-invite', '')}
            <details class="pc-setup-import"><summary>批量添加学员${disclosureArrow}</summary>${renderInstitutionFlow('import', org)}</details>
          </div>
          <p class="pc-setup-note">${students.length && teachers.length ? '确认成员后，继续分班和分配课时。' : '请添加至少一位学员，并确认有可授课职员。机构管理员也可授课。'}</p>
        </section>
        <div class="pc-setup-footer">
          <button type="button" class="pc-inline-btn pc-setup-primary" data-product-action="setup-next">下一步：分班与课时</button>
          ${data.last_setup_group_id ? button('继续安排首课', 'resume-setup') : ''}
        </div>`;
      if (s.step === 2) return `${heading}
        <p class="pc-setup-note">班级已保存，可以新增首课。</p>
        ${renderInstitutionFlow('lessons', org, s.group)}
        <div class="pc-setup-group pc-setup-rows">
          ${link(`查看班级${disclosureArrow}`, 'group', s.group)}
          ${link(`返回机构首页${disclosureArrow}`, 'overview', '')}
          ${button(`再配置一个班级${disclosureArrow}`, 'setup-new')}
        </div>`;
      const choices = (values: Row[], field: string, label: string) => `<fieldset class="pc-setup-section">
        <legend>${label}</legend>
        <div class="pc-setup-group pc-setup-choices">${values.map(row => {
          const id = String(row.id || row.user_id);
          return `<label><input name="${field}" type="checkbox" value="${h(id)}"${s.selected.has(field + ':' + id) ? ' checked' : ''}/><span>${h(display(row))}</span></label>`;
        }).join('') || '<p class="pc-setup-note">暂无可选成员，请返回上一步添加。</p>'}</div>
      </fieldset>`;
      return `${heading}
        <form class="pc-setup-form" data-product-form="setup">
          <section class="pc-setup-section">
            <h3>班级信息</h3>
            <div class="pc-setup-group pc-setup-fields">${input('name', '班级名称', 'text', 'required maxlength="120"')}${input('subject', '科目（可选）', 'text', 'maxlength="120"')}</div>
          </section>
          ${choices(students, 'student_ids', '学员（至少一位）')}
          ${choices(teachers, 'teacher_ids', '授课老师（至少一位）')}
          <section class="pc-setup-section">
            <h3>课时（可选）</h3>
            <div class="pc-setup-group">
              <div class="pc-setup-fields"><label class="pc-org-field"><span>课程模板</span><select class="pc-profile-input" name="template_id">${option('', '暂不分配课时', s.values.template_id)}${templates.map(row => option(row.course_package_id, row.title + ' · ' + row.total_lessons + ' 课时', s.values.template_id)).join('')}</select></label></div>
              <div class="pc-setup-rows">${link(`维护课程模板${disclosureArrow}`, 'packages', '')}</div>
            </div>
            <p class="pc-setup-note">已有同模板有效课时账户的学员会继续使用原账户。</p>
          </section>
          <div class="pc-setup-footer">
            ${button('上一步', 'setup-back')}
            <button class="pc-inline-btn pc-setup-primary" type="submit">保存并安排首课</button>
          </div>
        </form>`;
    }
    function operations(): string {
      const data = s.data, values = data.summary || {}, rows = list(data.lessons), groupIds = [...new Set(rows.map(row => String(row.group_id)))];
      const filtered = rows.filter(row => (!s.values.group || String(row.group_id) === s.values.group) && (s.filter === 'all' || s.filter === 'overdue' && row.overdue || s.filter === 'leave' && (row.leave || row.leave_requests) || row.status === s.filter));
      const metrics = [
        ['已完成 / 已排课', (values.completed || 0) + ' / ' + (values.scheduled || 0)],
        ['出勤率', pct(values.attendance_rate)]
      ];
      if (values.overdue > 0) metrics.push(['待结算', String(values.overdue)]);
      if (values.pending_leave > 0) metrics.push(['待确认请假', String(values.pending_leave)]);
      const statuses = [['all', '全部课次'], ['completed', '已完成'], ['overdue', '已结束待结算'], ['leave', '有请假记录'], ['cancelled', '已取消']];
      const followups = list(data.followups);
      const rangeLabel = data.from && data.to ? `${data.from} – ${data.to}` : '';
      const section = (id: string, title: string, value: string, body: string) => `<details class="pc-settings-surface pc-settings-disclosure" data-operation-section="${id}"${s.operationSections?.has(id) ? ' open' : ''}>
        <summary>${title}${value ? `<span class="pc-settings-summary-value">${h(value)}</span>` : ''}${disclosureArrow}</summary>
        ${body}
      </details>`;
      const lessonRows = slice(filtered).map(row => `<article class="pc-flow-row">
        <div><strong>${h(row.title)}</strong><small>${h(row.group_name + ' · ' + date(row.starts_at) + ' · ' + (labels[row.status] || row.status) + (row.overdue ? ' · 待结算' : ''))}</small>
        <small>出勤 ${row.present} · 请假 ${row.leave} · 缺席/待补课 ${row.absent}</small></div>${link('处理课次', 'group', row.group_id)}
      </article>`).join('');
      const followupRows = followups.map(row => `<article class="pc-flow-row">
        <div><strong>${h(display(row.student))}</strong><small>${h('负责人：' + display(row.owner) + ' · 下次：' + date(row.next_at))}</small></div>
        ${link('学员档案', 'student', String(row.student?.id || ''))}
      </article>`).join('');
      return `${section('range', '统计时段', rangeLabel, `<form data-product-form="filters">
          <div class="pc-operations-fields">${range()}</div>
          <button class="pc-inline-ghost pc-operations-apply" type="submit">查看看板</button>
        </form>
        ${data.note ? `<p class="pc-settings-note pc-operations-note">${h(data.note)}</p>` : ''}`)}
      ${data.summary ? `<section>
        <h2 class="pc-settings-caption">教学履约与跟进</h2>
        <dl class="pc-settings-surface pc-settings-facts">${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>
        ${!rows.length ? '<p class="pc-settings-note">所选时段暂无课次。</p>' : ''}
      </section>` : ''}
      ${rows.length ? section('lessons', '课次记录', `${rows.length} 条`, `
          <div class="pc-operations-fields">
            <select class="pc-profile-input" name="group" data-product-local-filter aria-label="看板班级">${option('', '全部班级', s.values.group)}${groupIds.map(value => option(value, String(rows.find(row => row.group_id === value)?.group_name), s.values.group)).join('')}</select>
            <select class="pc-profile-input" data-product-filter aria-label="课次状态">${statuses.map(([value, label]) => option(value, label, s.filter)).join('')}</select>
          </div>
          ${lessonRows || empty('所选时间和条件下暂无课次。')}${pager(filtered.length)}
        `) : ''}
      ${followups.length ? section('followups', '待跟进', `${followups.length} 条`, followupRows) : ''}`;
    }
    function platform(): string {
      const data = s.data, counts = data.counts || {}, labels: Record<string, string> = { all: '全部待办', failed_payment: '当日失败支付', overdue_order: '跨日支付订单', overdue_refund: '跨日退款', blocked_content: '发布阻断', overdue_content: '跨日发布流程', service_issue: '服务异常' };
      const count = list(data.items).length;
      if (host.closest('.pc-home-settings-list')) {
        const value = s.error ? '—' : s.loading ? '加载中' : count + ' 项';
        return `<button type="button" class="pc-home-settings-row" data-platform-admin-page="reminders"><span class="pc-home-settings-icon" aria-hidden="true">${renderOutlineIcon('clock')}</span><span class="pc-home-settings-label">运行提醒</span><span class="pc-home-settings-value">${value}</span>${disclosureArrow}</button>`;
      }
      const rows = list(data.items).filter(row => s.filter === 'all' || row.type === s.filter);
      const pageCount = Math.ceil(rows.length / 20);
      const settings = `<details class="pc-platform-reminder-settings pc-settings-surface pc-settings-disclosure" data-operation-section="checks"${s.operationSections?.has('checks') ? ' open' : ''}>
        <summary>统计范围与服务检查${disclosureArrow}</summary>
        <form data-product-form="filters" class="pc-product-filters">${input('date', '统计日期（UTC）', 'date', 'required')}<button class="pc-inline-btn" type="submit">刷新待办</button></form>
        <p class="pc-admin-note">提醒按所选 UTC 日期统计。</p>
        ${data.note ? `<p class="pc-admin-note">${h(data.note)}</p>` : ''}
        <dl class="pc-settings-facts">${list(data.checks).map(row => `<div><dt>${h(row.name)}</dt><dd>${h(row.detail || (row.ready ? '正常' : '异常，请检查服务配置或存储'))}${row.last_verified_at ? `<br><small>最近成功校验 ${h(date(row.last_verified_at))}</small>` : ''}${row.backup_created_at ? `<br><small>副本生成时间 ${h(date(row.backup_created_at))}</small>` : ''}</dd></div>`).join('')}</dl>
      </details>`;
      const titles: Record<string, string> = { failed_payment: '支付失败', overdue_order: '订单待支付', overdue_refund: '退款待处理', blocked_content: '发布受阻', overdue_content: '发布待处理' };
      const records = slice(rows).map(row => {
        const title = titles[row.type] || row.title;
        const reference = String(row.id || '');
        const meta = [row.scope_type ? row.scope_type === 'organization' ? '机构' : '个人' : '', row.created_at ? date(row.created_at) : '', reference.length > 12 ? '尾号 ' + reference.slice(-6) : reference].filter(Boolean).join(' · ');
        const copy = `<span class="pc-grouped-copy"><strong class="pc-grouped-title">${h(title)}</strong>${meta ? `<small class="pc-grouped-meta">${h(meta)}</small>` : ''}</span>`;
        const destination = String(row.destination || '');
        return ['order', 'refund', 'content'].includes(destination)
          ? `<button class="pc-lite-row pc-grouped-entry" type="button" data-product-open="${h(destination)}" data-target="${h(row.id)}" title="${h(row.title)}">${copy}${disclosureArrow}</button>`
          : `<div class="pc-lite-row pc-grouped-entry pc-lite-row-static" title="${h(row.title)}">${copy}</div>`;
      }).join('');
      return `<div class="pc-platform-reminders">
        <section aria-label="待处理提醒"><h2 class="pc-settings-caption">待处理提醒</h2>
          <div class="pc-settings-surface pc-platform-reminder-list">
            <label class="pc-platform-reminder-filter"><span>类别</span><select class="pc-profile-input" aria-label="筛选运行提醒" data-product-filter>${Object.entries(labels).map(([key,title]) => option(key,title + '（' + (key === 'all' ? count : counts[key] || 0) + '）',s.filter)).join('')}</select></label>
            ${records || (s.loading || s.error ? '' : empty('当前条件下没有运行提醒。'))}
            ${pageCount > 1 ? `<nav class="pc-platform-reminder-pagination" aria-label="运行提醒分页">
              <span>共 ${rows.length} 条</span>
              <div>
                ${button('上一页', 'previous', s.page <= 1 ? 'disabled' : '')}
                <span>第 ${s.page} / ${pageCount} 页</span>
                ${button('下一页', 'next', s.page >= pageCount ? 'disabled' : '')}
              </div>
            </nav>` : ''}
          </div>
        </section>
        ${settings}
      </div>`;
    }
    function comments(): string {
      return '<details class="pc-product-comments"><summary>我的常用评语</summary><p class="pc-admin-note">点击评语追加到当前学员的评语框，保存失败会保留输入。</p><div class="pc-product-comment-list">' +
        ['注意核对题干中的关键词。', '请复习本次错题，并写出选择理由。', '这次完成得很好，继续保持。'].map(value => button(h(value), 'use-comment', 'data-comment="' + h(value) + '"')).join('') +
        list(s.data.items).map(row => '<div>' + button(h(row.text), 'use-comment', 'data-comment="' + h(row.text) + '"') + button('删除', 'delete-comment', 'data-comment-id="' + h(row.comment_id) + '"') + '</div>').join('') + '</div><form data-product-form="comments"><label class="pc-org-field"><span>保存新的常用评语</span><textarea class="pc-profile-input" name="text" rows="2" maxlength="400" required>' + h(s.values.text || '') + '</textarea></label><button class="pc-inline-ghost" type="submit">保存常用评语</button></form></details>';
    }
    function feedback(): string {
      const item = s.data.feedback || {}, source = String(item.submitted_version_id || ''), resolved = String(item.resolved_version_id || '');
      return '<p>反馈时版本：' + h(source || '旧记录未保留版本') + '</p>' + (resolved ? '<p>处理完成版本：' + h(resolved) + '</p>' : '') + '<p class="pc-admin-note">' + (source && resolved && source !== resolved ? '处理后内容版本已变化。' : '打开当前原题修改后，可通过固定的“返回反馈处理”入口回来。') + '</p>' +
        (s.data.source_available ? '<details><summary>查看反馈时的题目快照</summary>' + (list(s.data.source_questions).map(row => '<article class="pc-product-source"><strong>' + h(row.section) + '</strong><p>' + h(plain(row.question?.question || row.question?.text)) + '</p>' + list(row.question?.options).map(value => '<p>' + h(plain(typeof value === 'string' ? value : value.text || value.option)) + '</p>').join('') + '</article>').join('') || empty('题号存在歧义或属于整卷反馈，请核对当前原题。')) + '</details>' : empty('这条旧反馈没有可用快照，请核对当前原题和处理记录。')) +
        '<details><summary>处理记录（' + list(item.processing_history).length + '）</summary>' + list(item.processing_history).map(row => '<p>' + h(date(row.changed_at) + ' · ' + row.status + ' · ' + (row.public_reply || '')) + '</p>').join('') + '</details>';
    }
    function render(): void {
      if (!valid()) return;
      const previousStep = host.querySelector('.pc-setup-progress h2')?.textContent;
      const importOpen = host.querySelector<HTMLDetailsElement>('.pc-setup-import')?.open;
      const focusedFilter = ['operations', 'platform-operations'].includes(kind) && host.contains(document.activeElement)
        ? ['[data-product-local-filter]', '[data-product-filter]'].find(selector => document.activeElement?.matches(selector))
        : undefined;
      const homeReminder = kind === 'platform-operations' && host.closest('.pc-home-settings-list');
      if (s.loginRequired && !homeReminder) {
        host.innerHTML = renderWorkspaceSessionError();
        return;
      }
      host.innerHTML = (!homeReminder && s.loading ? '<p role="status" data-product-read-status>正在更新，请稍候…</p>' : '') + (!homeReminder && s.error ? '<p class="pc-flow-error" role="alert">' + h(s.error) + '</p>' + button('重试读取', 'refresh') : '') +
        (kind === 'progress' ? progress() : kind === 'weakness' ? weakness() : kind === 'setup' ? setup() : kind === 'operations' ? operations() : kind === 'platform-operations' ? platform() : kind === 'comments' ? comments() : feedback());
      if (importOpen) host.querySelector('.pc-setup-import')?.setAttribute('open', '');
      const stepHeading = host.querySelector<HTMLElement>('.pc-setup-progress h2');
      if (previousStep && stepHeading && previousStep !== stepHeading.textContent) stepHeading.focus();
      if (focusedFilter) host.querySelector<HTMLElement>(focusedFilter)?.focus({ preventScroll: true });
      if (s.busy) host.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = true; });
      bindInstitutionFlows(host, { ...hooks, orgId: org });
    }
    async function load(): Promise<void> {
      const readId = s.readId = (s.readId || 0) + 1;
      const currentRead = () => valid() && s.readId === readId;
      const values = { ...s.values };
      s.error = '';
      s.loginRequired = false;
      s.loading = true; host.setAttribute('aria-busy', 'true');
      if (host.querySelector('form') && !host.querySelector('[data-product-read-status]')) {
        const status = document.createElement('p'); status.dataset.productReadStatus = ''; status.setAttribute('role', 'status'); status.textContent = '正在更新，请稍候…'; host.prepend(status);
      }
      const filters = new URLSearchParams();
      for (const field of kind === 'platform-operations' ? ['date'] : kind === 'progress' ? ['from','to','target','skill'] : kind === 'operations' ? ['from','to'] : []) if (values[field]) filters.set(field, values[field]);
      if (kind === 'progress' || kind === 'operations') filters.set('timezone', timezone);
      let path = kind === 'progress' ? student === hooks.owner ? '/me/learning-progress?' + filters : '/institution/students/' + encodeURIComponent(student) + '/progress?org_id=' + encodeURIComponent(org) + '&' + filters
        : kind === 'weakness' ? '/institution/students/' + encodeURIComponent(student) + '/weakness-questions?org_id=' + encodeURIComponent(org)
        : kind === 'platform-operations' ? '/admin/operations?' + filters
        : kind === 'feedback' ? '/feedback/' + encodeURIComponent(id) + '/context?paper_id=' + encodeURIComponent(org)
        : '/institution/organizations/' + encodeURIComponent(org) + '/' + (kind === 'operations' ? 'operations?' + filters : kind === 'comments' ? 'review-comments' : 'setup');
      try {
        const result: Row = asRecord(await request(path)) || {}; if (!currentRead()) return; s.data = result;
        if (kind === 'operations' && s.values.group && !list(result.lessons).some(row => String(row.group_id) === s.values.group)) s.values.group = '';
        if (kind === 'progress' && s.values.target === values.target) s.values.target = result.target || '';
        if (kind === 'weakness' && !s.values.exam && list(result.items).length) { s.values.exam = result.items[0].exam_id; s.selected = new Set(list(result.items).filter(row => row.exam_id === s.values.exam).map(row => row.question_id)); }
        if (kind === 'weakness' && !s.values.title) s.values.title = display(result.student) + ' · 薄弱项复习';
      } catch (error) {
        if (!currentRead()) return;
        s.data = {};
        s.loginRequired = kind === 'platform-operations' && isWorkspaceSessionError(error);
        s.error = error instanceof Error ? error.message : '读取失败';
      }
      if (!currentRead()) return;
      s.loading = false; host.setAttribute('aria-busy', 'false');
      render();
    }
    const capture = (form: HTMLFormElement) => { new FormData(form).forEach((value, key) => { if (!['student_ids','teacher_ids','question_ids'].includes(key)) s.values[key] = String(value); }); };
    host.addEventListener('toggle', event => {
      const el = event.target as HTMLDetailsElement;
      const section = el.dataset.operationSection;
      if (section && host.contains(el)) {
        const open = s.operationSections ??= new Set<string>();
        if (el.open) open.add(section); else open.delete(section);
      }
    }, true);
    host.addEventListener('input', event => { const input = event.target as HTMLInputElement; if (input.name && !['checkbox','radio'].includes(input.type)) s.values[input.name] = input.value; });
    host.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (input.type === 'checkbox') { const value = kind === 'setup' ? input.name + ':' + input.value : input.value; input.checked ? s.selected.add(value) : s.selected.delete(value); }
      if (input.matches('[data-product-local-filter]')) { s.values[input.name] = input.value; if (input.name === 'exam') s.selected = new Set(list(s.data.items).filter(row => row.exam_id === input.value).map(row => row.question_id)); s.page = 1; render(); }
      if (input.matches('[data-product-filter]')) { s.filter = input.value; s.page = 1; render(); }
    });
    host.addEventListener('click', async event => {
      const open = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-product-open]');
      if (open) { hooks.navigate(open.dataset.productOpen || '', open.dataset.target || '', open.dataset.targetOrg); return; }
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-product-action]');
      if (!target || s.busy) return;
      const action = target.dataset.productAction;
      if (action === 'refresh') { await load(); return; }
      if (action === 'previous' || action === 'next') { s.page = Math.max(1, s.page + (action === 'next' ? 1 : -1)); render(); return; }
      if (action === 'setup-next') { await load(); if (!list(s.data.students).length || !list(s.data.teachers).length) { s.error = '请先添加至少一位学员，并确保有授课职员。'; } else s.step = 1; render(); return; }
      if (action === 'setup-back') { s.step = 0; render(); return; }
      if (action === 'resume-setup') { s.group = s.data.last_setup_group_id; s.step = 2; render(); return; }
      if (action === 'setup-new') { s.requestId = createUuid(); s.group = ''; s.step = 1; render(); return; }
      if (action === 'use-comment') {
        const cards = [...root.querySelectorAll<HTMLElement>('[data-assignment-student]')];
        const current = cards.find(row => row.contains(document.activeElement)) || cards.find(row => row.classList.contains('pc-review-current')) || cards.find(row => row.dataset.reviewPending === 'true') || cards[0];
        const input = current?.querySelector<HTMLTextAreaElement>('[data-submission-comment]');
        if (input) { input.value = [input.value.trim(), target.dataset.comment || ''].filter(Boolean).join('\n'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus({ preventScroll: true }); }
        return;
      }
      if (action === 'delete-comment') { try { await request('/institution/organizations/' + encodeURIComponent(org) + '/review-comments', { comment_id: target.dataset.commentId, remove: true }); await load(); } catch (error) { s.error = String(error); render(); } }
    });
    host.addEventListener('submit', async event => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-product-form]');
      if (!form) return; event.preventDefault(); event.stopPropagation(); if (s.busy || !form.reportValidity()) return;
      capture(form); s.error = ''; const values = new FormData(form);
      if (form.dataset.productForm === 'filters') { s.page = 1; await load(); return; }
      try {
        s.busy = true; form.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = true; });
        if (kind === 'setup') {
          const result: Row = asRecord(await request('/institution/organizations/' + encodeURIComponent(org) + '/setup', { name: s.values.name, subject: s.values.subject || '', template_id: s.values.template_id || '', student_ids: values.getAll('student_ids'), teacher_ids: values.getAll('teacher_ids'), request_id: s.requestId })) || {};
          if (!valid()) return; s.group = result.learning_group_id; s.step = 2; hooks.changed();
        } else if (kind === 'weakness') {
          const questions = values.getAll('question_ids'); if (!questions.length) throw new Error('请至少选择一道题。');
          const result: Row = asRecord(await request('/organizations/' + encodeURIComponent(org) + '/learning-groups/' + encodeURIComponent(String(values.get('group') || '')) + '/assignments', { title: s.values.title, exam_id: s.values.exam, question_ids: questions, target_student_ids: [student], auto_reminder_enabled: false, due_at: s.values.due ? new Date(s.values.due).toISOString() : '' })) || {};
          hooks.changed(); hooks.navigate('assignment', result.assignment_id, org); return;
        } else if (kind === 'comments') { await request('/institution/organizations/' + encodeURIComponent(org) + '/review-comments', { text: s.values.text }); s.values.text = ''; await load(); }
      } catch (error) {
        s.error = error instanceof Error ? error.message : '保存失败，请重试';
        const alert = document.createElement('p'); alert.className = 'pc-flow-error'; alert.setAttribute('role','alert'); alert.textContent = s.error; form.querySelector('.pc-flow-error')?.remove(); form.prepend(alert);
        return;
      } finally { s.busy = false; form.querySelectorAll<HTMLButtonElement>('button').forEach(el => { el.disabled = false; }); }
      render();
    });
    void load();
  });
}
