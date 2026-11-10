import { asRecord, escapeHtml } from './utils.js';

type Row = Record<string, unknown>;
interface ComposerInput {
  owner: string;
  kind: 'assignment' | 'prep';
  groups: Row[];
  organizations: Row[];
  groupId?: string;
  plan?: Row;
}
interface ComposerState {
  key: string; input: ComposerInput; values: Record<string, string>; exams: Row[];
  paper: Row | null; loading: boolean; loaded: boolean; error: string; busy: boolean; preserveScope: boolean;
  copiedQuestionIds?: string[];
}
let state: ComposerState | null = null;
const plain = (value: unknown): string => {
  const node = document.createElement('div'); node.innerHTML = typeof value === 'string' ? value : '';
  return node.textContent?.trim() || '';
};
const idOf = (row: Row) => String(row.id || row.exam_id || '');
const groupKey = (row: Row) => `${row.organization_id || row.org_id}:${row.learning_group_id || row.group_id || row.id}`;
function paperItems(paper: Row | null) {
  const sections = (asRecord(paper?.exam_info)?.sections || []) as Row[];
  return sections.flatMap((section, index) => {
    const direct = section.questions as Row[] | undefined;
    const questions = direct?.length ? direct : ((section.passages || []) as Row[]).flatMap(p => (p.questions || []) as Row[]);
    return questions.map(q => ({ key: `${index}:${q.id}`, section: String(section.section_name || section.name || ''),
      text: plain(q.question || q.text), haystack: `${section.section_name || section.name || section.type || ''} ${section.section_type || ''} ${q.type || section.type || ''} ${q.id}`.toLowerCase() }));
  });
}
function selectedItems(s: ComposerState) {
  const all = paperItems(s.paper), first = Number(s.values.start || 1), last = Number(s.values.end || all.length);
  if (s.copiedQuestionIds) { const keys = new Set(s.copiedQuestionIds); return all.filter(q => keys.has(q.key)); }
  if (s.preserveScope) {
    const keys = new Set((s.input.plan?.question_ids || []) as string[]);
    return all.filter(q => keys.has(q.key));
  }
  return all.slice(first - 1, last).filter(q => s.input.kind !== 'prep' || !s.values.focus || q.haystack.includes(s.values.focus.toLowerCase()));
}
export function renderTeachingComposer(input: ComposerInput): string {
  const planId = String(input.plan?.lesson_prep_id || '');
  const key = `${input.owner}:${input.kind}:${planId}:${input.groupId || ''}`;
  if (state?.key !== key) {
    const preferred = input.groups.find(g => String(g.learning_group_id) === (input.groupId || input.plan?.learning_group_id)) || input.groups[0];
    state = { key, input, values: { group: preferred ? groupKey(preferred) : '', exam: String(input.plan?.exam_id || ''),
      title: String(input.plan?.title || ''), start: input.plan?.question_start ? String(input.plan.question_start) : '',
      end: input.plan?.question_end ? String(input.plan.question_end) : '', due: '', focus: String(input.plan?.focus_keyword || '') },
      exams: [], paper: null, loading: false, loaded: false, error: String(input.plan?.scope_error || ''), busy: false, preserveScope: !!input.plan };
  }
  const s = state; s.input = input;
  const groups = input.groups.map(g => {
    const org = input.organizations.find(o => String(o.organization_id || o.id) === String(g.organization_id || g.org_id));
    return `<option value="${escapeHtml(groupKey(g))}"${s.values.group === groupKey(g) ? ' selected' : ''}>${escapeHtml(`${g.name || '学习组'}${org?.name ? ` · ${org.name}` : ''}`)}</option>`;
  }).join('');
  const exams = s.exams.map(exam => `<option value="${escapeHtml(idOf(exam))}"${idOf(exam) === s.values.exam ? ' selected' : ''}>${escapeHtml(String(exam.title || exam.name || idOf(exam)))}</option>`).join('');
  const prep = input.kind === 'prep', count = paperItems(s.paper).length;
  const field = (name: string, title: string, type = 'text', extra = '') => `<label class="pc-org-field"><span>${title}</span><input class="pc-profile-input" name="${name}" type="${type}" value="${escapeHtml(s.values[name] || '')}" ${extra} /></label>`;
  return `<form class="pc-card pc-teaching-form" data-teaching-composer data-kind="${input.kind}">
    ${!prep ? '<div class="pc-flow-actions"><button type="button" class="pc-inline-ghost" data-teaching-copy' + (s.loading || s.busy || !groups ? ' disabled' : '') + '>复制本班上次作业</button><small>沿用标题和题目；截止时间、定向名单与提交记录不复制。</small></div>' : ''}
    <div class="pc-org-form-grid pc-org-form-grid-2">
      <label class="pc-org-field"><span>学习组</span><select class="pc-profile-input" name="group" required>${groups || '<option value="">暂无分配的学习组</option>'}</select></label>
      <label class="pc-org-field"><span>试卷</span><select class="pc-profile-input" name="exam" required ${s.loading ? 'disabled' : ''}><option value="">${s.loading ? '正在读取试卷…' : '请选择试卷'}</option>${exams}</select></label>
      ${field('title', prep ? '方案标题' : '作业标题', 'text', 'required maxlength="120"')}
      ${prep ? field('focus', '考点关键词（可选）', 'text', 'maxlength="100" placeholder="例如 読解、聴解"') : field('due', '截止时间（可选）', 'datetime-local')}
    </div>
    <details class="pc-teaching-scope"${s.values.start || s.values.end ? ' open' : ''}><summary>题目范围（默认整卷）</summary><div class="pc-org-form-grid pc-org-form-grid-2">
      ${field('start', '起始题序', 'number', `min="1" step="1" ${count ? `max="${count}"` : ''} placeholder="从首题开始"`)}
      ${field('end', '结束题序', 'number', `min="1" step="1" ${count ? `max="${count}"` : ''} placeholder="至末题"`)}
    </div><p class="pc-admin-note">题序按试卷显示顺序计算，留空表示整卷。</p></details>
    ${prep && input.plan ? '<p class="pc-admin-note" data-teaching-scope-note></p><button class="pc-inline-ghost" type="button" data-teaching-reset-scope>重新选择范围</button>' : ''}
    ${groups ? '' : '<p class="pc-admin-note">尚未分配学习组，请联系机构管理员为你添加授课关系。</p>'}
    <details class="pc-teaching-preview" aria-label="题目预览"><summary><strong data-teaching-summary></strong></summary><ol data-teaching-preview></ol></details>
    <p data-teaching-error class="pc-teaching-error" role="alert">${escapeHtml(s.error)}</p>
    <div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit" ${!groups || s.busy ? 'disabled' : ''}>${s.busy ? '正在保存…' : prep ? '保存备课方案' : '布置作业'}</button><button class="pc-inline-ghost" type="button" data-teaching-retry ${s.error ? '' : 'hidden'}>重新读取试卷</button></div>
  </form>`;
}
export function bindTeachingComposer(root: HTMLElement, hooks: { token: string; render: () => void; isCurrent: () => boolean; saved: (kind: 'assignment' | 'prep', id: string) => Promise<void> }): void {
  const form = root.querySelector<HTMLFormElement>('[data-teaching-composer]'), s = state;
  if (!form || !s || form.dataset.bound) return;
  form.dataset.bound = 'true';
  const api = window.APIClient!;
  const capture = () => { new FormData(form).forEach((value, key) => { s.values[key] = String(value); }); };
  const preview = () => {
    const all = paperItems(s.paper), items = selectedItems(s);
    form.querySelector('[data-teaching-summary]')!.textContent = !s.values.exam ? '选择试卷后预览题目' : s.loading ? '正在读取题目…' : `${s.copiedQuestionIds ? '沿用上次作业' : s.preserveScope ? '保留原方案' : '本次'} ${items.length} 题 · 试卷共 ${all.length} 题`;
    const note = form.querySelector('[data-teaching-scope-note]');
    if (note) note.textContent = s.preserveScope ? '保留原方案的题目；修改试卷、题序或考点后重新选题。' : '将按当前试卷、题序和考点重新选题。';
    const reset = form.querySelector<HTMLButtonElement>('[data-teaching-reset-scope]');
    if (reset) reset.hidden = !s.preserveScope;
    form.querySelector('[data-teaching-preview]')!.innerHTML = items.slice(0, 8).map(q => `<li><span>${escapeHtml(q.section)}</span> ${escapeHtml(q.text || '题目内容请在作答页查看')}</li>`).join('') + (items.length > 8 ? '<li>其余题目已包含在所选范围中</li>' : '');
  };
  const load = async (library = false) => {
    if (s.loading) return;
    s.loading = true; s.error = s.preserveScope ? String(s.input.plan?.scope_error || '') : ''; preview();
    form.querySelector<HTMLSelectElement>('[name="exam"]')!.disabled = true;
    try {
      if (library) { s.exams = (await api.getExams()).map(v => asRecord(v) || {}); s.loaded = true; }
      if (s.values.exam) {
        s.paper = asRecord(await api.getExam(s.values.exam));
        if (!s.values.title) {
          const exam = s.exams.find(e => idOf(e) === s.values.exam);
          s.values.title = `${String(exam?.title || exam?.name || s.values.exam)} ${s.input.kind === 'prep' ? '备课' : '作业'}`;
        }
      }
    } catch (error) { s.loaded = true; s.error = error instanceof Error ? error.message : '读取试卷失败，请重试'; }
    finally { s.loading = false; if (state === s && hooks.isCurrent()) hooks.render(); }
  };
  const scopeChanged = (event: Event) => {
    if (['exam', 'start', 'end', 'focus'].includes((event.target as HTMLInputElement).name)) {
      s.preserveScope = false;
      s.copiedQuestionIds = undefined;
      s.error = '';
      if (s.input.plan?.scope_error) form.querySelector('[data-teaching-error]')!.textContent = '';
    }
  };
  form.addEventListener('input', event => { scopeChanged(event); capture(); preview(); });
  form.addEventListener('change', event => {
    scopeChanged(event);
    capture();
    if ((event.target as HTMLInputElement).name === 'exam') { s.paper = null; void load(); } else preview();
  });
  form.querySelector('[data-teaching-retry]')?.addEventListener('click', () => { void load(true); });
  form.querySelector('[data-teaching-copy]')?.addEventListener('click', () => {
    if (s.busy || s.loading) return; capture(); const groupKey = s.values.group; const [org,group] = groupKey.split(':');
    if (!org || !group) return;
    void (async () => {
      s.busy = true; const controls = [...form.querySelectorAll<HTMLInputElement>('input,select,button')]; const disabled = controls.map(control => control.disabled); controls.forEach(control => { control.disabled = true; });
      try {
        const result = asRecord(await api.request('/organizations/' + encodeURIComponent(org) + '/learning-groups/' + encodeURIComponent(group) + '/assignments?' + new URLSearchParams({ token: hooks.token })));
        if (state !== s || !hooks.isCurrent() || groupKey !== s.values.group) return;
        const items = Array.isArray(result?.items) ? result.items.map(row => asRecord(row) || {}) : [];
        const previous = items.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
        if (!previous) throw new Error('本班还没有可复制的作业。');
        s.values.exam = String(previous.exam_id || ''); s.values.title = String(previous.title || '') + '（副本）'; s.values.due = '';
        s.values.start = previous.question_start ? String(previous.question_start) : ''; s.values.end = previous.question_end ? String(previous.question_end) : '';
        s.copiedQuestionIds = Array.isArray(previous.question_ids) && previous.question_ids.length ? previous.question_ids.map(String) : undefined;
        s.paper = null; await load();
      } catch (error) { s.error = error instanceof Error ? error.message : '复制失败，请重试'; }
      finally { s.busy = false; controls.forEach((control,index) => { if (control.isConnected) control.disabled = disabled[index]; }); if (state === s && hooks.isCurrent()) hooks.render(); }
    })();
  });
  form.querySelector('[data-teaching-reset-scope]')?.addEventListener('click', () => { s.preserveScope = false; s.error = ''; form.querySelector('[data-teaching-error]')!.textContent = ''; preview(); });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (s.busy || s.loading) return;
    capture();
    void (async () => {
      const errorHost = form.querySelector<HTMLElement>('[data-teaching-error]')!;
      const items = selectedItems(s), all = paperItems(s.paper);
      if (s.copiedQuestionIds && items.length !== s.copiedQuestionIds.length) { errorHost.textContent = '上次作业的题目已变化，请重新选择题目范围后保存。'; return; }
      const first = Number(s.values.start || 1), last = Number(s.values.end || all.length);
      if (s.preserveScope && (s.input.plan?.scope_error || items.length !== ((s.input.plan?.question_set || []) as Row[]).length)) {
        errorHost.textContent = '原备课题目无法完整匹配，请重新选择题目范围后保存。'; return;
      }
      if (!s.values.group || !s.values.exam || !s.values.title.trim() || !items.length || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > all.length) {
        errorHost.textContent = '请选择学习组、试卷并填写标题，题目范围须在试卷内。'; return;
      }
      const [org, group] = s.values.group.split(':');
      const payload = { title: s.values.title.trim(), exam_id: s.values.exam, question_start: Number(s.values.start || 0), question_end: Number(s.values.end || 0) };
      s.busy = true; form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = true;
      try {
        const result = asRecord(s.input.kind === 'prep'
          ? await api.saveLessonPrepPlan(hooks.token, { ...payload, org_id: org, learning_group_id: group, lesson_prep_id: String(s.input.plan?.lesson_prep_id || ''), focus_keyword: s.values.focus.trim(), limit: 500, hide_answers: s.input.plan?.hide_answers ?? true, preserve_question_scope: s.preserveScope })
          : await api.createLearningGroupAssignment(org, group, { ...payload, ...(s.copiedQuestionIds ? { question_ids: items.map(item => item.key) } : {}), due_at: s.values.due ? new Date(s.values.due).toISOString() : '', auto_reminder_enabled: false })) || {};
        if (state === s) state = null;
        await hooks.saved(s.input.kind, String(result.lesson_prep_id || result.assignment_id || ''));
      } catch (error) { errorHost.textContent = error instanceof Error ? error.message : '保存失败，请重试'; }
      finally { s.busy = false; if (form.isConnected) form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false; }
    })();
  });
  preview();
  if (!s.loaded) void load(true);
}
