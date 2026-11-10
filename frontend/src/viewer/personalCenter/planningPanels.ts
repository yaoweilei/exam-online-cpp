import { createUuid } from '../../uuid.js';
import { escapeHtml as h, asRecord } from './utils.js';
import { localDateTime } from './presentation.js';
type Row = Record<string, any>;
type Hooks = { token: string; owner: string; changed: () => void; confirm: (message: string) => Promise<boolean>; password: (title: string) => Promise<string | null> };
const states = new Map<string, { mode: string; drafts: Record<string, Row> }>();
const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const label = (row: Row = {}) => String(row.display_name || row.username || row.name || row.id || row.user_id || '');
const localTime = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); };
const btn = (title: string, mode: string) => '<button type="button" class="pc-inline-ghost" data-planning-mode="' + mode + '">' + title + '</button>';
export function renderPlanningPanel(): string { return '<section data-planning-panel></section>'; }
export function bindPlanningPanel(root: HTMLElement, data: Row, org: string, group: string, hooks: Hooks, reload: () => Promise<void>): void {
  const found = root.querySelector<HTMLElement>('[data-planning-panel]'); if (!found || found.dataset.bound) return;
  const host: HTMLElement = found; host.dataset.bound = 'true';
  const key = [hooks.owner,org,group].join(':'); if (!states.has(key)) states.set(key,{ mode: '', drafts: {} });
  const state = states.get(key)!; let busy = false; let preview: Row | null = null; let requestId = createUuid();
  const api = async (operation: string, payload: Row): Promise<Row> => asRecord(await window.APIClient!.request('/institution/organizations/' + encodeURIComponent(org) + '/learning-groups/' + encodeURIComponent(group) + '/' + operation, { method: 'POST', body: JSON.stringify({ ...payload, token: hooks.token }) })) || {};
  const field = (key: string, title: string, type = 'text', extra = '') => '<label class="pc-org-field"><span>' + title + '</span><input class="pc-profile-input" name="' + key + '" type="' + type + '" value="' + h(String(state.drafts[state.mode]?.[key] || '')) + '" ' + extra + '></label>';
  const option = (id: string, text: string, selected: unknown) => '<option value="' + h(id) + '"' + (id === selected ? ' selected' : '') + '>' + h(text) + '</option>';
  const select = (key: string, title: string, values: Row[]) => '<label class="pc-org-field"><span>' + title + '</span><select name="' + key + '" class="pc-profile-input">' + values.map(row => option(String(row.id),String(row.name),state.drafts[state.mode]?.[key])).join('') + '</select></label>';
  function render(): void {
    const draft = state.drafts[state.mode] || {};
    const current = list(data.students).filter(row => !row.historical_only);
    const members = list(data.group?.enrollments).filter(row => (row.status || 'active') === 'active').map(row => ({ id: row.user_id, name: label([...list(data.students),...list(data.relationship_staff)].find(person => (person.id || person.user_id) === row.user_id)) || row.user_id }));
    host.innerHTML = '<div class="pc-flow-actions">' + btn('按周重复排课','batch') + btn('复制上一课','copy') + (data.can_correct_settlement ? btn('人员变更','relationship') : '') + '</div>' + (!state.mode ? '' : '<form data-planning-form class="pc-flow-editor"><h3>' + (state.mode === 'batch' ? '重复排课 · 先预览再保存' : '人员变更 · 核对影响后确认') + '</h3><div class="pc-org-form-grid pc-org-form-grid-2">' + (state.mode === 'batch' ?
      field('title','课次标题','text','required maxlength="120"') + field('starts_at','首节开始','datetime-local','required') + field('ends_at','首节结束','datetime-local','required') + field('count','课次数量','number','required min="1" max="52"') + field('interval','间隔周数','number','required min="1" max="12"') + select('assignment_id','关联本班作业（可选）',[{ id: '', name: '不关联' },...list(data.assignments).map(row => ({ id: row.assignment_id, name: row.title }))]) :
      select('kind','变更方式',[{ id: 'leave', name: '学员 / 职员离班' },{ id: 'transfer', name: '学员转班（同机构）' },{ id: 'replace_teacher', name: '更换教师 / 助教' }]) + select('member_id','原班成员',members) + '<div data-planning-target>' + select('target_group_id','目标班级',list(data.relationship_groups).filter(row => row.id !== group)) + select('followup_owner_id','目标班跟进负责人（有原班未完跟进时必选）',[{id:'',name:'请选择接任人'},...list(data.relationship_staff).map(row => ({id:row.id || row.user_id,name:label(row)}))]) + '<label><input type="checkbox" name="include_target_lessons"' + (draft.include_target_lessons ? ' checked' : '') + '> 同时加入目标班未来已排课次（逐节检查冲突）</label></div><div data-planning-replacement>' + select('replacement_id','接任职员',list(data.relationship_staff).map(row => ({ id: row.id || row.user_id, name: label(row) }))) + '</div>') + '</div>' +
      (state.mode === 'batch' ? '<fieldset class="pc-flow-students"><legend>授课学员（至少一位；只创建排课，不扣课）</legend>' + current.map(row => '<label><input type="checkbox" name="student_ids" value="' + h(row.id || row.user_id) + '"' + (!draft.student_ids || draft.student_ids.includes(row.id || row.user_id) ? ' checked' : '') + '>' + h(label(row)) + '</label>').join('') + '</fieldset><p class="pc-admin-note">按本地日历每隔指定周数重复，逐节列出日期与冲突；有冲突时整批不保存。</p>' : '<p class="pc-admin-note">只变更本机构的班级关系，不删除机构成员、不改课时余额。未完成作业、未结算课次会在预览中提示；原班历史记录保留。</p>' + field('reason','变更原因','text','required maxlength="500"')) + '<div class="pc-flow-actions"><button class="pc-inline-btn" type="submit">预览' + (state.mode === 'batch' ? '排课' : '变更影响') + '</button>' + btn('收起','') + '</div><div data-planning-preview aria-live="polite"></div></form>');
    updateKind();
  }
  function updateKind(): void { const kind = host.querySelector<HTMLSelectElement>('[name=kind]')?.value; const target = host.querySelector<HTMLElement>('[data-planning-target]'), replacement = host.querySelector<HTMLElement>('[data-planning-replacement]'); if (target) target.hidden = kind !== 'transfer'; if (replacement) replacement.hidden = kind !== 'replace_teacher'; }
  const capture = () => {
    const form = host.querySelector<HTMLFormElement>('form'); if (!form) return {};
    const values = new FormData(form); const draft: Row = Object.fromEntries(values); draft.student_ids = values.getAll('student_ids'); draft.include_target_lessons = values.has('include_target_lessons'); state.drafts[state.mode] = draft; return draft;
  };
  const changed = () => { if (busy) return; capture(); preview = null; host.querySelector('[data-planning-preview]')?.replaceChildren(); updateKind(); };
  host.addEventListener('input',changed); host.addEventListener('change',changed);
  host.addEventListener('click',event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-planning-mode]'); if (!button || busy) return; capture(); preview = null; requestId = createUuid();
    const mode = button.dataset.planningMode || '';
    state.mode = mode === 'copy' ? 'batch' : mode;
    if (mode === 'copy') {
      const previous = list(data.items).slice().sort((a,b) => String(b.starts_at).localeCompare(String(a.starts_at)))[0];
      if (previous) { const start = new Date(previous.starts_at), end = new Date(previous.ends_at); start.setDate(start.getDate()+7); end.setDate(end.getDate()+7); state.drafts.batch = { title: previous.title, starts_at: localTime(start.toISOString()), ends_at: localTime(end.toISOString()), count: '1', interval: '1', assignment_id: previous.assignment_id || '', student_ids: previous.student_ids }; }
    }
    if (state.mode === 'batch') state.drafts.batch ||= { count: '4', interval: '1' };
    render();
  });
  function showPreview(value: Row, payload: Row): void {
    const area = host.querySelector<HTMLElement>('[data-planning-preview]'); if (!area) return;
    area.innerHTML = '<h3>影响预览</h3>' + (state.mode === 'batch' ? '<ol>' + list(payload.items).map((row,index) => '<li>' + h(localDateTime(row.starts_at) + ' — ' + localDateTime(row.ends_at)) + (list(value.conflicts).filter(row => row.index === index).map(row => '<p class="pc-flow-error">' + h(row.message) + '</p>').join('')) + '</li>').join('') + '</ol>' : '<p>' + h(value.message) + '</p><p>涉及课次 ' + list(value.affected_lessons).length + ' 节 · 未完成作业 ' + list(value.pending_assignments).length + ' 份 · 转交跟进 ' + (value.followups_transferred || 0) + ' 项</p>' + list(value.affected_lessons).map(row => '<p>' + h(row.title + ' · ' + localDateTime(row.starts_at) + (row.action === 'cancel' ? ' · 取消（原班无剩余学员）' : ' · 更新安排')) + '</p>').join('') + list(value.account_balances).map(row => '<p>' + h(row.title + ' · 余额保持 ' + row.remaining_lessons + ' 次') + '</p>').join('') + list(value.pending_assignments).map(row => '<p>待完成作业：' + h(row.title) + '</p>').join('') + list(value.blockers).map(message => '<p class="pc-flow-error">' + h(message) + '</p>').join('')) + (value.can_commit ? '<button type="button" class="pc-inline-btn" data-planning-commit>核对无误，确认保存</button>' : '<p role="alert">请先处理上述问题，再重新预览。尚未保存任何变更。</p>');
  }
  async function execute(commit: boolean): Promise<void> {
    if (busy) return; const form = host.querySelector<HTMLFormElement>('form'); if (!form || !form.reportValidity()) return;
    const values = commit ? null : capture(); let payload: Row;
    try {
      if (commit) { if (!preview) return; payload = preview.payload; }
      else if (state.mode === 'batch') {
        const count = Number(values!.count), interval = Number(values!.interval); if (!values!.student_ids.length) throw new Error('请至少选择一位授课学员');
        const start = new Date(values!.starts_at), end = new Date(values!.ends_at); if (start >= end) throw new Error('结束时间必须晚于开始时间');
        payload = { request_id: requestId, items: Array.from({ length: count },(_,index) => { const a = new Date(start), b = new Date(end); a.setDate(a.getDate()+index*interval*7); b.setDate(b.getDate()+index*interval*7); return { title: values!.title, starts_at: a.toISOString(), ends_at: b.toISOString(), student_ids: values!.student_ids, assignment_id: values!.assignment_id || '' }; }) };
      } else payload = { request_id: requestId, kind: values!.kind, member_id: values!.member_id, target_group_id: values!.kind === 'transfer' ? values!.target_group_id : '', replacement_id: values!.kind === 'replace_teacher' ? values!.replacement_id : '', followup_owner_id: values!.kind === 'transfer' ? values!.followup_owner_id : '', include_target_lessons: values!.kind === 'transfer' && values!.include_target_lessons, reason: values!.reason };
      busy = true; const controls = [...form.querySelectorAll<HTMLInputElement>('input, select, button')]; const disabled = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; });
      try {
        const operation = state.mode === 'batch' ? 'lesson-batch' : 'relationship-change';
        if (commit) {
          if (!await hooks.confirm(state.mode === 'batch' ? '确认保存预览中的全部课次？此操作只排课，不扣课。' : '确认按预览变更班级关系？原始历史和课时余额保留。')) return;
          const password = state.mode === 'relationship' ? await hooks.password('变更授课关系') : '';
          if (password === null || !host.isConnected) return;
          await api(operation,{ ...payload, expected_revision: preview!.result.revision, confirmation: state.mode === 'batch' ? '确认批量排课' : '确认变更授课关系', reauth_password: password });
          if (!host.isConnected) return; hooks.changed(); delete state.drafts[state.mode]; state.mode = ''; await reload();
        } else { const result = await api(operation + '/preview',payload); if (!host.isConnected) return; preview = { payload, result }; showPreview(result,payload); }
      } finally { busy = false; controls.forEach((control,index) => { if (control.isConnected) control.disabled = disabled[index]; }); }
    } catch (error) { if (!host.isConnected) return; host.querySelector('[data-planning-error]')?.remove(); const message = document.createElement('p'); message.dataset.planningError = ''; message.className = 'pc-flow-error'; message.setAttribute('role','alert'); message.textContent = error instanceof Error ? error.message : '保存失败，请重试'; form.prepend(message); }
  }
  host.addEventListener('submit',event => { event.preventDefault(); event.stopPropagation(); host.querySelector('[data-planning-error]')?.remove(); void execute(false); });
  host.addEventListener('click',event => { if ((event.target as HTMLElement).closest('[data-planning-commit]')) void execute(true); });
  render();
}
