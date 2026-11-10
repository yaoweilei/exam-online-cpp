import { createUuid } from '../../uuid.js';
import { bindFloatingSearch } from './floatingSearch.js';
import { escapeHtml as h, asRecord } from './utils.js';
import { localDateTime } from './presentation.js';
import { renderPlanningPanel, bindPlanningPanel } from './planningPanels.js';
type Row = Record<string, any>;
type Kind = 'import' | 'followups' | 'lessons' | 'courses' | 'course-summary';
type Hooks = { token: string; owner: string; orgId: string; changed: () => void; password: (title: string) => Promise<string | null>; confirm: (message: string) => Promise<boolean> };
type State = { data: Row; error: string; busy: boolean; query: string; filter: string; selected: string; edit: string; complete: boolean; text: string; previewText: string; importResult?: Row; followDrafts?: Record<string, Record<string, string>>; correction?: boolean; correctionRequest?: string; correctionRevision?: number; correctionDraft?: Row };
const states = new Map<string, State>();
const courseReadMaxAgeMs = 20_000;
const courseReadTimeoutMs = 10_000;
let courseRead: { owner: string; token: string; expiresAt: number; result: Promise<Row> } | undefined;

export function readInstitutionCourses(owner: string, token: string, refresh = false): Promise<Row> {
  if (courseRead?.owner === owner && courseRead.token === token &&
      (courseRead.expiresAt === Infinity || (!refresh && courseRead.expiresAt > Date.now()))) {
    return courseRead.result;
  }
  const signal = AbortSignal.timeout(courseReadTimeoutMs);
  const result = (async () => {
    if (!window.APIClient) throw new Error('接口暂不可用');
    try {
      const query = new URLSearchParams({ token });
      return asRecord(await window.APIClient.request('/me/courses?' + query, { signal })) || {};
    } catch (error) {
      if (signal.aborted) throw new Error('课程读取超时，请重试');
      throw error;
    }
  })();
  const read = { owner, token, expiresAt: Infinity, result };
  courseRead = read;
  void result.then(
    () => { read.expiresAt = Date.now() + courseReadMaxAgeMs; },
    () => { read.expiresAt = Date.now() + 5_000; }
  );
  return result;
}

const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const name = (row: Row = {}) => String(row.display_name || row.username || row.name || row.id || '');
const date = (value: unknown) => localDateTime(value, '未安排');
const localTime = (value: unknown) => { if (!value) return ''; const d = new Date(String(value)); return Number.isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
const iso = (value: FormDataEntryValue | null) => value ? new Date(String(value)).toISOString() : '';
const statusText: Record<string, string> = { pending: '待跟进', contacted: '已联系', completed: '已完成', scheduled: '已排课', cancelled: '已取消', present: '出勤', absent: '缺席', leave: '请假', makeup: '需补课', active: '正常', depleted: '已用完', expired: '已到期' };
const button = (label: string, action: string, extra = '') => '<button type="button" class="pc-inline-ghost" data-flow-action="' + action + '" ' + extra + '>' + label + '</button>';
const empty = (message: string) => '<p class="pc-flow-empty">' + h(message) + '</p>';
const option = (id: unknown, text: string, selected: unknown) => '<option value="' + h(String(id || '')) + '"' + (id === selected ? ' selected' : '') + '>' + h(text) + '</option>';

function courseSummary(content: string): string {
  return '<h2 class="pc-grouped-heading">我的课程</h2><div class="pc-grouped-list">' + content + '</div>';
}

const courseLoading = '<p role="status">正在读取课程…</p>';

export function renderInstitutionFlow(kind: Kind, orgId = '', groupId = '', studentId = '', filter = 'all'): string {
  const summary = kind === 'course-summary';
  const loading = summary ? courseSummary(courseLoading) : '<p role="status">正在读取…</p>';
  return '<section class="pc-institution-flow' + (summary ? ' pc-grouped-card' : '') + '" data-institution-flow="' + kind + '" data-org="' + h(orgId) + '" data-group="' + h(groupId) + '" data-student="' + h(studentId) + '" data-default-filter="' + h(filter) + '">' + loading + '</section>';
}

export function bindInstitutionFlows(root: HTMLElement, hooks: Hooks): void {
  root.querySelectorAll<HTMLElement>('[data-institution-flow]').forEach(host => {
    if (host.closest('[data-task-panel][hidden]')) return;
    if (host.dataset.bound) return;
    host.dataset.bound = 'true';
    const kind = host.dataset.institutionFlow as Kind, orgId = host.dataset.org || hooks.orgId;
    const groupId = host.dataset.group || '', studentId = host.dataset.student || '';
    const key = [hooks.owner, orgId, kind, groupId, studentId, host.dataset.defaultFilter].join(':');
    let s = states.get(key);
    if (!s) { s = { data: {}, error: '', busy: false, query: '', filter: host.dataset.defaultFilter || 'all', selected: studentId, edit: '', complete: false, text: '', previewText: '' }; states.set(key, s); }
    const state = s;
    const valid = () => host.isConnected && root.contains(host);
    const api = async (path: string, payload?: Row): Promise<Row> => {
      if (!window.APIClient) throw new Error('接口暂不可用');
      return asRecord(await window.APIClient.request(path + (payload ? '' : (path.includes('?') ? '&' : '?') + new URLSearchParams({ token: hooks.token })),
        payload ? { method: 'POST', body: JSON.stringify({ ...payload, token: hooks.token }) } : {})) || {};
    };
    const followPath = '/institution/organizations/' + encodeURIComponent(orgId) + '/followups';
    const lessonPath = '/institution/organizations/' + encodeURIComponent(orgId) + '/learning-groups/' + encodeURIComponent(groupId) + '/lessons';
    const input = (field: string, label: string, value = '', type = 'text', extra = '') => '<label class="pc-org-field"><span>' + label + '</span><input class="pc-profile-input" name="' + field + '" type="' + type + '" value="' + h(value) + '" ' + extra + ' /></label>';
    const riskReasons = (student: Row): string[] => {
      const id = String(student.id || student.user_id);
      const reasons = list(state.data.course_packages).filter(p => p.student_id === id && p.record_type === 'assignment' && p.needs_attention && !['paused', 'cancelled', 'archived'].includes(p.status))
        .map(p => String(p.title || p.subject || '课程包') + '：' + String(p.attention_reason || '需关注'));
      if (['medium', 'high'].includes(student.activity_risk?.level)) reasons.push('学习中断：' + student.activity_risk.reason);
      return reasons;
    };
    const followups = () => {
      const all = list(state.data.items), students = list(state.data.students);
      const selectedStudent = students.find(student => String(student.id || student.user_id) === state.selected);
      const saved = all.find(row => row.followup_id === state.edit) || {};
      const draft = state.followDrafts?.[state.selected + ':' + state.edit];
      const editing = { ...saved, ...draft };
      const records = all.filter(row => !studentId || row.student_id === studentId);
      const visible = students.filter(student => {
        const id = String(student.id || student.user_id), own = records.filter(row => row.student_id === id);
        return (!studentId || id === studentId) && (!state.query || name(student).toLowerCase().includes(state.query.toLowerCase())) &&
          (state.filter === 'all' || ['risk', 'alerts'].includes(state.filter) && riskReasons(student).length ||
           own.some(row => state.filter === 'today' ? row.status !== 'completed' && row.next_at && Date.parse(row.next_at) <= Date.now() :
             state.filter === 'mine' ? row.owner_id === hooks.owner && row.status !== 'completed' : row.status === state.filter));
      });
      const assignmentRows = list(state.data.assignments).filter(row => (Number(row.student_count) - Number(row.submitted_count) + Number(row.returned_count || 0)) > 0)
        .filter(row => state.filter !== 'alerts' || row.due_at && Date.parse(row.due_at) < Date.now()).filter(row => !state.query || String(row.title).toLowerCase().includes(state.query.toLowerCase())).map(row =>
          '<article class="pc-flow-row"><div><strong>' + h(row.title) + '</strong><small>' + h(row.submitted_count + '/' + row.student_count + ' 已交' + (row.returned_count ? ' · ' + row.returned_count + ' 待重做' : '') + ' · 截止 ' + date(row.due_at)) + '</small></div><div class="pc-flow-actions"><button type="button" class="pc-inline-ghost" data-intent="openRoleContent:teacher-assignment:' + h(row.assignment_id) + '">查看作业</button><button type="button" class="pc-inline-ghost" data-inst-assignment-remind="' + h(row.assignment_id) + '">催交</button></div></article>').join('');
      const standaloneStudent = state.selected ? '<p class="pc-admin-note">' + h(name(selectedStudent) || state.selected) + '</p>' : '';
      const editor = state.selected ? '<form data-flow-form="followup" class="pc-flow-editor"><h3>' + (state.edit ? '更新跟进' : '安排跟进') + '</h3>' + standaloneStudent + '<div class="pc-org-form-grid pc-org-form-grid-2"><label class="pc-org-field"><span>负责人</span><select name="owner_id" class="pc-profile-input">' +
        list(state.data.staff).map(person => option(person.id || person.user_id, name(person), editing.owner_id || hooks.owner)).join('') + '</select></label><label class="pc-org-field"><span>状态</span><select name="status" class="pc-profile-input">' +
        ['pending', 'contacted', 'completed'].map(status => option(status, statusText[status], editing.status || 'pending')).join('') + '</select></label>' +
        input('next_at', '下次跟进时间', draft?.next_at ?? localTime(saved.next_at), 'datetime-local') + '</div><label class="pc-org-field"><span>跟进内容</span><textarea class="pc-profile-input" name="text" rows="3" required maxlength="2000">' + h(editing.text || '') +
        '</textarea></label><label class="pc-org-field"><span>处理结果（完成时必填）</span><textarea class="pc-profile-input" name="result" rows="2" maxlength="2000">' + h(editing.result || '') +
        '</textarea></label><div class="pc-flow-actions"><button class="pc-inline-btn" type="submit">保存跟进</button>' + (!studentId ? button('返回名单', 'back-followup') : '') + button('取消编辑', 'cancel-followup') + '</div></form>' : '';
      // Editing is a task of its own. Keep the list query/filter in state so
      // cancel/save can restore the same list without a search dock over it.
      if (state.selected) return editor;
      const studentRows = visible.map(student => {
        const id = String(student.id || student.user_id), own = records.filter(row => row.student_id === id);
        const active = own.filter(row => row.status !== 'completed');
        return '<article class="pc-flow-row' + (id === state.selected ? ' is-selected' : '') + '" data-followup-student="' + h(id) + '"><div><strong>' + h(name(student)) + '</strong><small>' + h(riskReasons(student).join('；') || (student.activity_risk?.observing ? '新学员观察期' : '暂无异常提醒')) + '</small><small>' +
          h(active.length ? active.length + ' 项待跟进' + (active[0].next_at ? ' · 下次 ' + date(active[0].next_at) : '') : '暂无待跟进安排') +
          '</small></div><div class="pc-flow-actions">' + button('安排跟进', 'select-student', 'data-id="' + h(id) + '"') +
          '<button class="pc-inline-ghost" type="button" data-intent="openRoleContent:teacher-student:' + h(encodeURIComponent(id)) + '">档案</button></div></article>' + (id === state.selected ? editor : '');
      }).join('');
      const rows = state.filter === 'assignments' ? assignmentRows : state.filter === 'alerts' ? assignmentRows + studentRows : studentRows;
      const history = records.filter(row => !state.selected || row.student_id === state.selected).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return '<div class="pc-flow-toolbar"><input class="pc-profile-input" type="search" data-flow-query placeholder="搜索学员" aria-label="搜索跟进学员" value="' + h(state.query) + '"/><select class="pc-profile-input" data-flow-filter aria-label="跟进筛选">' +
        [['all', '全部学员'], ['today', '已到跟进时间'], ['mine', '我负责的待办'], ['pending', '待跟进'], ['contacted', '已联系'], ['completed', '已完成'], ['risk', '需关注课时或学习'], ['assignments', '待交 / 待重做作业'], ['alerts', '逾期与异常']].map(([id, label]) => option(id, label, state.filter)).join('') +
        '</select>' + button('搜索', 'search') + button('刷新', 'refresh') + '</div>' + (selectedStudent && (state.filter === 'assignments' || !visible.some(student => String(student.id || student.user_id) === state.selected)) ? editor : '') + rows + (!rows ? empty('没有符合条件的记录。') : '') +
        '<details class="pc-flow-history"' + (studentId || state.selected ? ' open' : '') + '><summary>全部跟进记录（' + history.length + '）</summary>' +
        (history.map(row => '<article class="pc-flow-row"><div><strong>' + h(name(row.student) + ' · ' + (statusText[row.status] || row.status)) + '</strong><p>' + h(row.text) + '</p>' +
          (row.result ? '<p>结果：' + h(row.result) + '</p>' : '') + '<small>' + h('负责人：' + name(row.owner) + ' · ' + date(row.updated_at)) + '</small>' +
          (list(row.history).length ? '<details><summary>修改记录（' + row.history.length + '）</summary>' + row.history.map((change: Row) => '<p>' + h(date(change.changed_at) + ' · ' + (statusText[change.status] || change.status) + ' · ' + change.text + ' · ' + (change.result || '')) + '</p>').join('') + '</details>' : '') +
          '</div>' + button('更新', 'edit-followup', 'data-id="' + h(row.followup_id) + '"') + '</article>').join('') || empty('还没有跟进记录。')) + '</details>';
    };
    const importForm = () => '<form data-flow-form="import"><p>每行一位学员：姓名,邮箱,手机,student。邮箱和手机至少填一项；已有成员会跳过。</p><label class="pc-org-field"><span>待导入学员</span><textarea class="pc-profile-input" name="text" rows="5" maxlength="65536" required placeholder="张三,student@example.com,,student">' + h(state.text) +
      '</textarea></label><p class="pc-admin-note">每批最多 100 位。先预览匹配结果，再确认添加已有账号或创建加入邀请。</p><div class="pc-flow-actions"><button class="pc-inline-btn" type="submit">预览导入</button>' + button('填写示例', 'import-example') + '</div></form>' +
      (state.importResult ? '<section class="pc-flow-import-results"><h3>' + (state.importResult.committed ? '导入结果' : '预览结果') + '</h3><p>' +
        h(state.importResult.committed ? '已添加 ' + state.importResult.summary.added + ' · 已创建邀请 ' + state.importResult.summary.invited + ' · 跳过 ' + state.importResult.summary.skipped + ' · 失败 ' + state.importResult.summary.failed : '共 ' + state.importResult.summary.total + ' 行，请检查下面的处理方式。') +
        '</p>' + list(state.importResult.rows).map(row => '<article class="pc-flow-row"><strong>' + h(row.row + '. ' + row.name) + '</strong><span>' + h(row.message) + '</span></article>').join('') +
        (!state.importResult.committed && list(state.importResult.rows).some(row => ['add', 'invite'].includes(row.action)) ? button('确认导入学员', 'import-commit') : '') +
        (state.importResult.committed && state.importResult.summary.failed ? button('仅重试失败行', 'import-retry') : '') + '</section>' : '');
    const lessonForm = () => {
      const lessons = list(state.data.items), editing = lessons.find(row => row.lesson_id === state.edit) || {};
      const upcoming = lessons.filter(row => !['completed','cancelled'].includes(row.status) && Date.parse(row.ends_at || row.starts_at) >= Date.now()).sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at)));
      const upcomingIds = new Set(upcoming.map(row => row.lesson_id));
      const ordered = [...upcoming, ...lessons.filter(row => !upcomingIds.has(row.lesson_id)).sort((a,b) => String(b.starts_at).localeCompare(String(a.starts_at)))];
      const homework = '<label class="pc-org-field"><span>关联课后作业（可选）</span><select name="assignment_id" class="pc-profile-input"><option value="">暂不关联</option>' + list(state.data.assignments).map(row => option(row.assignment_id, row.title, editing.assignment_id)).join('') + '</select></label>';
      const editor = !state.correction && (state.edit || state.complete) ? '<form data-flow-form="lesson" class="pc-flow-editor"><h3>' + (state.complete ? '确认出勤与课时' : state.edit === 'new' ? '新增课次' : '编辑课次 / 改期') + '</h3><div class="pc-org-form-grid pc-org-form-grid-2">' +
        input('title', '课次标题', editing.title || '', 'text', 'required maxlength="120"') + input('starts_at', '开始时间', localTime(editing.starts_at), 'datetime-local', 'required') + input('ends_at', '结束时间', localTime(editing.ends_at), 'datetime-local', 'required') +
        '</div>' + homework + (!state.complete ? '<fieldset class="pc-flow-students"><legend>授课学员（补课可只选需要参加的学员）</legend>' + list(state.data.students).filter(student => !student.historical_only || editing.student_ids?.includes(student.id || student.user_id)).map(student => '<label><input type="checkbox" name="student_ids" value="' + h(String(student.id || student.user_id)) + '"' + (!editing.student_ids || editing.student_ids.includes(student.id || student.user_id) ? ' checked' : '') + '/>' + h(name(student)) + '</label>').join('') + '</fieldset><label class="pc-org-field"><span>关联原课次（仅补课时选择）</span><select name="makeup_for" class="pc-profile-input"><option value="">普通课次</option>' + lessons.filter(row => row.status === 'completed').map(row => option(row.lesson_id, row.title, editing.makeup_for)).join('') + '</select></label>' : '') + '<label class="pc-org-field"><span>课后反馈（学员可见）</span><textarea class="pc-profile-input" name="feedback" rows="2" maxlength="2000">' + h(editing.feedback || '') + '</textarea></label>' +
        (state.complete ? '<p class="pc-admin-note">出勤默认扣 1 次，缺席、请假和待补课默认不扣。请逐人确认；保存后生成课时明细。</p><div class="pc-flow-attendance">' +
          list(state.data.students).filter(student => !editing.student_ids || editing.student_ids.includes(student.id || student.user_id)).map(student => {
            const id = String(student.id || student.user_id), leaveRequest = list(editing.leave_requests).find(row => row.student_id === id), packages = list(state.data.course_packages).filter(p => p.student_id === id && p.status === 'active' && p.remaining_lessons > 0 && (!p.expires_at || Date.parse(p.expires_at) > Date.now()));
            return '<details class="pc-attendance-person" data-flow-attendance="' + h(id) + '"><summary><strong>' + h(name(student)) + (leaveRequest ? '<small>请假申请：' + h(leaveRequest.reason) + '</small>' : '') + '</strong><span data-attendance-summary>' + (leaveRequest ? '请假' : '出勤') + ' · 扣 ' + (packages.length && !leaveRequest ? 1 : 0) + ' 次</span></summary><div class="pc-attendance-fields"><label>出勤<select class="pc-profile-input" data-attendance-status>' +
              ['present', 'absent', 'leave', 'makeup'].map(status => option(status, statusText[status], leaveRequest ? 'leave' : 'present')).join('') + '</select></label><label>课时账户<select class="pc-profile-input" data-attendance-package><option value="">不扣课 / 请选择账户</option>' +
              packages.map(p => option(p.course_package_id, String(p.title || p.subject) + ' · 剩余 ' + p.remaining_lessons, packages[0]?.course_package_id)).join('') + '</select></label><label>扣课次数<input class="pc-profile-input" type="number" data-attendance-charge min="0" max="10" step="1" value="' + (packages.length && !leaveRequest ? 1 : 0) + '"/></label></div></details>';
          }).join('') + '</div>' : '') + '<div class="pc-flow-actions"><button type="submit" class="pc-inline-btn">' + (state.complete ? '完成并结算课时' : '保存课次') + '</button>' + button('取消编辑', 'cancel-lesson') + '</div></form>' : '';
      const effective = list(editing.corrected_attendance || editing.attendance);
      const draft = state.correctionDraft || {};
      const correctionEditor = state.correction ? '<form data-flow-form="correction" class="pc-flow-editor"><h3>更正已结算课次 · ' + h(editing.title) + '</h3><p class="pc-admin-note">保留原始出勤和扣课流水。先预览变化，再由机构管理员确认；历史授课名单和补课关联保持不变。</p><div class="pc-flow-attendance">' + effective.map(original => {
        const entry = list(draft.attendance).find(row => row.student_id === original.student_id) || original;
        const accounts = list(state.data.course_packages).filter(row => row.record_type === 'assignment' && row.student_id === original.student_id);
        return '<div data-flow-attendance="' + h(original.student_id) + '"><strong>' + h(name(list(state.data.students).find(row => (row.id || row.user_id) === original.student_id)) || original.student_id) + '<small>当前：' + h(statusText[original.status] || original.status) + ' · 扣 ' + original.charge + ' 次</small></strong><label>更正出勤<select class="pc-profile-input" data-attendance-status>' + ['present','absent','leave','makeup'].map(value => option(value,statusText[value],entry.status)).join('') + '</select></label><label>更正账户<select class="pc-profile-input" data-attendance-package><option value="">不扣课 / 请选择账户</option>' + accounts.map(account => option(account.course_package_id,String(account.title || account.subject || '课时账户') + ' · 剩余 ' + account.remaining_lessons + ' · ' + (statusText[account.status] || account.status),entry.course_package_id)).join('') + '</select></label><label>更正扣课次数<input class="pc-profile-input" type="number" data-attendance-charge min="0" max="10" step="1" required value="' + h(entry.charge) + '"/></label></div>';
      }).join('') + '</div><label class="pc-org-field"><span>更正原因</span><textarea class="pc-profile-input" name="reason" rows="3" maxlength="2000" required>' + h(draft.reason || '') + '</textarea></label><div class="pc-flow-actions"><button type="submit" class="pc-inline-btn">预览并确认更正</button>' + button('重新载入当前记录','reload-correction') + button('取消更正','cancel-lesson') + '</div></form>' : '';
      if (state.edit || state.complete || state.correction) return editor + correctionEditor;
      return '<p class="pc-admin-note">' + h(String(state.data.organization_name || '') + ' · ' + String(state.data.group?.name || '')) + '</p><div class="pc-home-section-head"><h2>班级课次</h2>' + button('＋ 新增课次', 'new-lesson') + '</div>' + (upcoming[0] ? '<p class="pc-admin-note" data-next-lesson>下节课：' + h(upcoming[0].title + ' · ' + date(upcoming[0].starts_at)) + '</p>' : '') + renderPlanningPanel() +
        (ordered.map(row => '<article class="pc-flow-row"><div><strong>' + h(row.title) + '</strong><small>' +
          h(date(row.starts_at) + ' — ' + date(row.ends_at) + ' · ' + (statusText[row.status] || row.status)) + '</small>' +
          (row.feedback ? '<p>课后反馈：' + h(row.feedback) + '</p>' : '') +
          (row.status === 'completed' ? '<small>' + list(row.corrected_attendance || row.attendance).map(entry => h(name(list(state.data.students).find(p => (p.id || p.user_id) === entry.student_id)) + '：' + statusText[entry.status] + '，扣 ' + entry.charge + ' 次')).join('；') + '</small>' : '') +
          (list(row.attendance_corrections).length ? '<details class="pc-flow-corrections"><summary>更正记录（' + row.attendance_corrections.length + '）</summary><p>原始记录：' + list(row.attendance).map(entry => h(name(list(state.data.students).find(person => (person.id || person.user_id) === entry.student_id)) + ' · ' + (statusText[entry.status] || entry.status) + ' · 扣 ' + entry.charge + ' 次')).join('；') + '</p>' + list(row.attendance_corrections).map(change => '<p>' + h(date(change.created_at) + ' · ' + change.reason) + '</p>').join('') + '</details>' : '') +
          '</div><div class="pc-flow-actions">' + (row.status !== 'completed' ? button('编辑 / 改期', 'edit-lesson', 'data-id="' + h(row.lesson_id) + '"') + (row.status !== 'cancelled' ? button('上课结算', 'complete-lesson', 'data-id="' + h(row.lesson_id) + '"') + button('取消课次', 'cancel-course', 'data-id="' + h(row.lesson_id) + '"') : '') : state.data.can_correct_settlement ? button('更正出勤 / 扣课','correct-lesson','data-id="' + h(row.lesson_id) + '"') : '') +
          '</div></article>').join('') || empty('还没有独立课次，点击“新增课次”安排本班每一次授课。'));
    };
    const courses = () => {
      const data = state.data, lessons = list(data.lessons).slice().sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
      const upcoming = lessons.filter(row => !['completed', 'cancelled', 'no_show', 'archived'].includes(row.status) && Date.parse(row.ends_at || row.starts_at) >= Date.now());
      if (kind === 'course-summary') {
        const hasCourses = list(data.groups).length || list(data.course_packages).length || list(data.lessons).length || list(data.past_assignments).length;
        host.hidden = !hasCourses && !state.error;
        return hasCourses ? courseSummary('<div class="pc-selfstudy-draft-row"><p>' +
          h(upcoming.length ? '下节课：' + upcoming[0].title + ' · ' + date(upcoming[0].starts_at) : '暂无待上课程，排课后会显示在这里。') +
          '</p><button type="button" data-role-admin-intent="openRoleContent:student-courses">课程与课时 →</button></div>') : '';
      }
      const pastAssignments = list(data.past_assignments).length ? '<details class="pc-flow-past-assignments"><summary>原班已交作业（' + data.past_assignments.length + '）</summary><p class="pc-admin-note">已离班的历史结果，保留自己的提交与老师评语。</p>' + list(data.past_assignments).map(row => '<article class="pc-flow-row"><div><strong>' + h(row.title) + '</strong><small>' + h(row.group_name + ' · ' + date(row.submitted_at) + ' · ' + (row.review_status === 'reviewed' ? '已批改' : '已提交，待批改')) + '</small>' + (typeof row.manual_score === 'number' ? '<p>老师评分：' + h(row.manual_score) + '</p>' : '') + (row.teacher_comment ? '<p>老师评语：' + h(row.teacher_comment) + '</p>' : '') + '</div></article>').join('') + '</details>' : '';
      const lessonRows = (state.filter === 'history' ? lessons.filter(row => !upcoming.includes(row)) : upcoming);
      return '<div class="pc-flow-toolbar"><select class="pc-profile-input" data-flow-filter aria-label="课程记录筛选">' + [['all', '待上课程'], ['history', '历史课程与反馈']].map(([id, label]) => option(id, label, state.filter)).join('') + '</select>' + button('刷新', 'refresh') +
        '</div>' + (lessonRows.map(row => '<article class="pc-flow-row"><div><strong>' + h(row.title) + '</strong><small>' + h(date(row.starts_at) + ' · ' + (row.organization_name || '') + ' · ' + (statusText[row.status] || row.status)) +
          '</small>' + (row.feedback ? '<p>老师反馈：' + h(row.feedback) + '</p>' : '') + (row.own_attendance ? '<small>' + h(statusText[row.own_attendance.status] + ' · 扣课 ' + row.own_attendance.charge + ' 次') + '</small>' : '') + (list(row.own_attendance_corrections).length ? '<details><summary>我的更正记录（' + row.own_attendance_corrections.length + '）</summary>' + list(row.own_attendance_corrections).map(change => '<p>' + h(date(change.created_at) + ' · ' + (statusText[change.before.status] || change.before.status) + '/扣' + change.before.charge + '次 → ' + (statusText[change.after.status] || change.after.status) + '/扣' + change.after.charge + '次') + '</p>').join('') + '</details>' : '') + (row.own_leave_request && row.status === 'scheduled' ? '<small>已申请请假，等待老师确认出勤</small>' : '') + '</div>' + (row.status === 'scheduled' && !String(row.lesson_id).startsWith('legacy:') ? button(row.own_leave_request ? '修改请假申请' : '申请请假', 'request-leave', 'data-id="' + h(row.lesson_id) + '"') : '') + (row.homework?.exam_id ? '<button type="button" class="pc-inline-ghost" data-intent="openAssignmentExam:' + h(encodeURIComponent(row.homework.assignment_id)) + ':' + h(encodeURIComponent(row.homework.exam_id)) + '">课后作业：' + h(row.homework.title) + '</button>' : '') + '</article>').join('') || empty(state.filter === 'history' ? '暂无历史课程。' : '暂无待上课程。')) +
        (state.selected ? '<form data-flow-form="leave" class="pc-flow-editor"><label class="pc-org-field"><span>请假原因（等待老师确认，不直接改变扣课）</span><textarea class="pc-profile-input" name="reason" maxlength="160" required></textarea></label><div class="pc-flow-actions"><button type="submit" class="pc-inline-btn">提交请假申请</button>' + button('取消', 'cancel-leave') + '</div></form>' : '') + '<details open><summary>我的班级与老师</summary>' + (list(data.groups).map(group => '<p><strong>' + h(group.name) + '</strong> · ' + h(list(group.teachers).map(name).join('、') || '老师待安排') + ' · ' + h(group.organization_name) + '</p>').join('') || empty('老师分班后会显示在这里。')) +
        '</details><h3>课时账户</h3>' + (list(data.course_packages).map(p => '<article class="pc-flow-row"><div><strong>' + h(p.title || p.subject) + '</strong><small>' + h(p.organization_name + ' · 剩余 ' + p.remaining_lessons + '/' + p.total_lessons + ' 次 · ' + (p.expires_at ? date(p.expires_at) + ' 到期' : '长期有效')) +
          '</small></div><span>' + h(p.expires_at && Date.parse(p.expires_at) < Date.now() ? '已到期' : statusText[p.status] || p.status) + '</span></article>').join('') || empty('机构分配课时后会显示在这里。')) +
        '<details><summary>扣课明细（' + list(data.ledger).length + '）</summary><p class="pc-admin-note">此处记录逐课次结算的扣课，原有账户余额已保留。</p>' + (list(data.ledger).slice().reverse().map(row => '<article class="pc-flow-row"><div><strong>' + h(row.lesson_title) + '</strong><small>' + h(date(row.created_at)) +
          '</small></div><span>' + h(row.change + ' 次 · 结余 ' + row.balance_after + ' 次') + '</span></article>').join('') || empty('暂无扣课记录。')) + '</details>' + pastAssignments;
    };
    function render() {
      if (!valid()) return;
      host.hidden = false;
      const error = state.error ? '<p class="pc-flow-error" role="alert">' + h(state.error) + '</p>' + button('重新读取', 'refresh') : '';
      if (state.error && (kind === 'courses' || kind === 'course-summary') && !Object.keys(state.data).length) {
        host.innerHTML = kind === 'course-summary' ? courseSummary(error) : error;
        return;
      }
      host.innerHTML = error +
        (kind === 'import' ? importForm() : kind === 'followups' ? followups() : kind === 'lessons' ? lessonForm() : courses()) +
        (state.busy ? '<p role="status">正在处理，请稍候…</p>' : '');
      bindFloatingSearch(host);
      if (kind === 'lessons') bindPlanningPanel(host,state.data,orgId,groupId,hooks,load);
      host.querySelectorAll<HTMLButtonElement>('button').forEach(el => { if (state.busy && !el.hasAttribute('data-intent')) el.disabled = true; });
    }
    async function load(refresh = false) {
      state.error = '';
      if (kind === 'import') { render(); return; }
      const studentCourses = kind === 'course-summary' || kind === 'courses';
      if (studentCourses && refresh && valid()) {
        host.innerHTML = kind === 'course-summary' ? courseSummary(courseLoading) : courseLoading;
      }
      try {
        const data = studentCourses
          ? await readInstitutionCourses(hooks.owner, hooks.token, refresh)
          : await api(kind === 'followups' ? followPath : lessonPath);
        if (!valid()) return;
        state.data = data;
        if (studentCourses) window.dispatchEvent(new CustomEvent('institutionCoursesLoaded', { detail: { hasCourses: !!(list(data.groups).length || list(data.course_packages).length || list(data.lessons).length || list(data.past_assignments).length), owner: hooks.owner, data } }));
      } catch (error) {
        if (!valid()) return;
        state.data = {}; state.error = error instanceof Error ? error.message : '读取失败，请重试';
      }
      render();
    }
    host.addEventListener('input', event => {
      const target = event.target as HTMLInputElement;
      if (target.matches('textarea[name=text]') && kind === 'import') {
        state.text = target.value;
        if (state.text !== state.previewText) { state.importResult = undefined; host.querySelector('.pc-flow-import-results')?.remove(); }
      }
      if (target.matches('[data-flow-query]')) state.query = target.value;
    });
    host.addEventListener('change', event => {
      const target = event.target as HTMLInputElement;
      if (target.matches('[data-flow-filter]')) { state.filter = target.value; render(); }
      
      if (target.matches('[data-attendance-status]')) {
        const charge = target.closest('[data-flow-attendance]')?.querySelector<HTMLInputElement>('[data-attendance-charge]');
        if (charge) charge.value = target.value === 'present' ? '1' : '0';
      }
      const person = target.closest('[data-flow-attendance]');
      const summary = person?.querySelector('[data-attendance-summary]');
      if (summary) summary.textContent = (statusText[person!.querySelector<HTMLSelectElement>('[data-attendance-status]')!.value] || '出勤') + ' · 扣 ' + person!.querySelector<HTMLInputElement>('[data-attendance-charge]')!.value + ' 次';
    });
    const rememberFollowup = (event: Event) => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-flow-form=followup]');
      if (!form) return;
      const drafts = state.followDrafts ||= {};
      drafts[state.selected + ':' + state.edit] = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]));
    };
    host.addEventListener('input', rememberFollowup);
    host.addEventListener('change', rememberFollowup);
    host.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-flow-query]')) { event.preventDefault(); render(); }
    });
    const captureCorrection = (event: Event) => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-flow-form="correction"]');
      if (!form) return;
      state.correctionDraft = { reason: form.querySelector<HTMLTextAreaElement>('[name=reason]')!.value, attendance: [...form.querySelectorAll<HTMLElement>('[data-flow-attendance]')].map(row => ({ student_id: row.dataset.flowAttendance, status: row.querySelector<HTMLSelectElement>('[data-attendance-status]')!.value, course_package_id: row.querySelector<HTMLSelectElement>('[data-attendance-package]')!.value, charge: row.querySelector<HTMLInputElement>('[data-attendance-charge]')!.value })) };
    };
    host.addEventListener('input', captureCorrection); host.addEventListener('change', captureCorrection);
    host.addEventListener('click', async event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-flow-action]');
      if (!target || state.busy) return;
      const action = target.dataset.flowAction, id = target.dataset.id || '';
      if (action === 'request-leave') { state.selected = id; render(); return; }
      if (action === 'cancel-leave') { state.selected = ''; render(); return; }
      if (action === 'search') { render(); return; }
      if (action === 'refresh') { await load(true); return; }
      if (action === 'select-student') { state.selected = id; state.edit = ''; render(); return; }
      if (action === 'back-followup') { state.selected = studentId; state.edit = ''; render(); return; }
      if (action === 'edit-followup') { const row = list(state.data.items).find(row => row.followup_id === id); state.selected = row?.student_id || ''; state.edit = id; render(); return; }
      if (action === 'cancel-followup') { delete state.followDrafts?.[state.selected + ':' + state.edit]; state.selected = studentId; state.edit = ''; render(); return; }
      if (action === 'correct-lesson') { const row = list(state.data.items).find(row => row.lesson_id === id); state.edit = id; state.correction = true; state.complete = false; state.correctionRequest = createUuid(); state.correctionRevision = Number(row?.attendance_revision || 0); state.correctionDraft = undefined; render(); return; }
      if (action === 'reload-correction') { const reason = state.correctionDraft?.reason || ''; await load(); state.correctionRevision = Number(list(state.data.items).find(row => row.lesson_id === state.edit)?.attendance_revision || 0); state.correctionRequest = createUuid(); state.correctionDraft = { reason }; render(); return; }
      if (action === 'new-lesson' || action === 'edit-lesson' || action === 'complete-lesson') { state.correction = false; state.edit = action === 'new-lesson' ? 'new' : id; state.complete = action === 'complete-lesson'; render(); host.scrollIntoView({ block: 'start' }); return; }
      if (action === 'cancel-lesson') { state.edit = ''; state.complete = false; state.correction = false; state.correctionDraft = undefined; render(); return; }
      if (action === 'import-example') { state.text = '张三,student@example.com,,student'; state.importResult = undefined; render(); return; }
      if (action === 'import-retry') { state.text = list(state.importResult?.rows).filter(row => row.action === 'error').map(row => row.raw).join('\n'); state.importResult = undefined; render(); return; }
      state.busy = true; state.error = ''; render();
      try {
        if (action === 'cancel-course') {
          const row = list(state.data.items).find(row => row.lesson_id === id);
          if (row && await hooks.confirm('确认取消“' + row.title + '”？学员会在课程消息中看到更新。')) {
            await api(lessonPath, { ...row, status: 'cancelled' }); hooks.changed(); await load();
          }
        } else if (action === 'import-commit' && state.previewText === state.text && state.importResult) {
          if (await hooks.confirm('确认按预览结果导入学员？已有账号将加入机构，新账号将创建加入邀请。')) {
            const password = await hooks.password('批量导入学员');
            if (password !== null) { state.importResult = await api('/organizations/' + encodeURIComponent(orgId) + '/student-import', { text: state.previewText, commit: true, confirmation: '确认导入学员', reauth_password: password }); hooks.changed(); }
          }
        }
      } catch (error) { state.error = error instanceof Error ? error.message : '保存失败'; }
      finally { state.busy = false; render(); }
    });
    host.addEventListener('submit', async event => {
      const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-flow-form]');
      if (!form) return;
      event.preventDefault(); event.stopPropagation();
      if (state.busy || !form.reportValidity()) return;
      const values = new FormData(form);
      if (form.dataset.flowForm === 'correction') {
        const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button')];
        const disabled = controls.map(control => control.disabled);
        const attendance = [...form.querySelectorAll<HTMLElement>('[data-flow-attendance]')].map(row => ({ student_id: row.dataset.flowAttendance, status: row.querySelector<HTMLSelectElement>('[data-attendance-status]')!.value, course_package_id: row.querySelector<HTMLSelectElement>('[data-attendance-package]')!.value, charge: Number(row.querySelector<HTMLInputElement>('[data-attendance-charge]')!.value) }));
        const payload = { reason: String(values.get('reason') || '').trim(), attendance, expected_revision: state.correctionRevision || 0, request_id: state.correctionRequest };
        state.busy = true; controls.forEach(control => { control.disabled = true; });
        try {
          const path = lessonPath + '/' + encodeURIComponent(state.edit) + '/corrections';
          const preview = await api(path + '/preview', payload);
          if (!valid()) return;
          if (!preview.replayed) {
            const accountTitle = (entry: Row) => entry.charge ? String(list(state.data.course_packages).find(row => row.course_package_id === entry.course_package_id)?.title || entry.course_package_id) : '不扣课';
            const changes = list(preview.correction?.changes).map(change => name(list(state.data.students).find(row => (row.id || row.user_id) === change.student_id)) + '：' + statusText[change.before.status] + '/' + accountTitle(change.before) + '/扣' + change.before.charge + '次 → ' + statusText[change.after.status] + '/' + accountTitle(change.after) + '/扣' + change.after.charge + '次').join('；');
            const balances = list(preview.balances).map(row => (row.title || '课时账户') + ' 剩余 ' + row.remaining_lessons + ' 次').join('；') || '本次不调整课时余额';
            if (!await hooks.confirm('请核对更正预览：' + changes + '。更正后：' + balances + '。原因：' + payload.reason + '。原始流水将保留。')) return;
            const password = await hooks.password('更正已结算课次'); if (password === null || !valid()) return;
            await api(path, { ...payload, expected_organization_revision: preview.organization_revision, confirmation: '确认更正课时', reauth_password: password });
          }
          hooks.changed(); state.correction = false; state.correctionDraft = undefined; state.edit = ''; state.error = ''; await load();
        } catch (error) {
          state.error = error instanceof Error ? error.message : '更正失败，请重试';
          if (form.isConnected) { form.querySelector('.pc-flow-error')?.remove(); const alert = document.createElement('p'); alert.className = 'pc-flow-error'; alert.setAttribute('role','alert'); alert.textContent = state.error; form.prepend(alert); }
        } finally { state.busy = false; controls.forEach((control,index) => { if (control.isConnected) control.disabled = disabled[index]; }); if (!form.isConnected && valid()) render(); }
        return;
      }
      let payload: Row;
      try {
        if (form.dataset.flowForm === 'leave') {
          const lesson = list(state.data.lessons).find(row => row.lesson_id === state.selected);
          payload = { org_id: lesson?.organization_id || orgId, reason: String(values.get('reason') || '').trim() };
        } else if (kind === 'import') {
          state.text = String(values.get('text') || '');
          payload = { text: state.text, commit: false };
        } else if (kind === 'followups') {
          payload = { student_id: state.selected, followup_id: state.edit, text: String(values.get('text') || '').trim(), result: String(values.get('result') || '').trim(), owner_id: values.get('owner_id'), status: values.get('status'), next_at: iso(values.get('next_at')) };
          if (payload.status === 'completed' && !payload.result) throw new Error('完成跟进时请填写处理结果');
        } else {
          payload = { lesson_id: state.edit === 'new' ? '' : state.edit, title: values.get('title'), starts_at: iso(values.get('starts_at')), ends_at: iso(values.get('ends_at')), feedback: values.get('feedback'), assignment_id: values.get('assignment_id'), status: state.complete ? 'completed' : 'scheduled', student_ids: state.complete ? list(state.data.items).find(row => row.lesson_id === state.edit)?.student_ids : values.getAll('student_ids'), makeup_for: state.complete ? list(state.data.items).find(row => row.lesson_id === state.edit)?.makeup_for || '' : values.get('makeup_for') };
          if (payload.starts_at >= payload.ends_at) throw new Error('结束时间必须晚于开始时间');
          if (state.complete) {
            payload.attendance = [...form.querySelectorAll<HTMLElement>('[data-flow-attendance]')].map(row => ({ student_id: row.dataset.flowAttendance, status: row.querySelector<HTMLSelectElement>('[data-attendance-status]')!.value, course_package_id: row.querySelector<HTMLSelectElement>('[data-attendance-package]')!.value, charge: Number(row.querySelector<HTMLInputElement>('[data-attendance-charge]')!.value) }));
            if (!await hooks.confirm('确认完成本课次并结算 ' + payload.attendance.reduce((sum: number, row: Row) => sum + row.charge, 0) + ' 次课时？请先核对每人的出勤和账户。')) return;
          }
        }
        state.busy = true; state.error = ''; form.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
        const response = await api(form.dataset.flowForm === 'leave' ? '/me/lessons/' + encodeURIComponent(state.selected) + '/leave' : kind === 'import' ? '/organizations/' + encodeURIComponent(orgId) + '/student-import' : kind === 'followups' ? followPath : lessonPath, payload);
        if (form.dataset.flowForm === 'leave' && courseRead?.owner === hooks.owner) courseRead = undefined;
        if (!valid()) return;
        if (kind === 'import') { state.importResult = response; state.previewText = state.text; }
        else { delete state.followDrafts?.[state.selected + ':' + state.edit]; state.edit = ''; state.complete = false; if (!studentId) state.selected = ''; hooks.changed(); await load(); }
      } catch (error) {
        state.error = error instanceof Error ? error.message : '保存失败，请重试';
        // Keep the live form and all entered values after a failed save.
        if (form.isConnected) {
          host.querySelector('.pc-flow-error')?.remove();
          const alert = document.createElement('p'); alert.className = 'pc-flow-error'; alert.setAttribute('role', 'alert'); alert.textContent = state.error; form.prepend(alert);
          state.busy = false; form.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); return;
        }
      } finally { state.busy = false; }
      render();
    });
    if (kind === 'import') render();
    void load();
  });
}
