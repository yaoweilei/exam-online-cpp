/** Keep permission controls and server validation intact while simplifying the read/edit views. */
export function bindCompactRoleEditor(container: HTMLElement, selectRole: (id: string, select: HTMLSelectElement) => void, cancel: (form: HTMLFormElement) => void): void {
  container.querySelectorAll<HTMLSelectElement>('[data-platform-role-picker]').forEach(select => {
    if (select.dataset.bound) return;
    select.dataset.bound = 'true'; select.addEventListener('change', () => selectRole(select.value, select));
  });
  container.querySelectorAll<HTMLFormElement>('[data-platform-role-template-form]').forEach(form => {
    if (form.classList.contains('pc-role-editor-compact')) return;
    form.classList.add('pc-role-editor-compact');
    form.dataset.rolePreview = String(Boolean(form.querySelector('[data-role-diff]')));
    const policy = form.querySelector<HTMLInputElement>('[data-role-org-override]');
    if (policy) {
      policy.setAttribute('role', 'switch');
      policy.setAttribute('aria-label', '允许机构调整本角色权限');
    }
    const header = form.querySelector('.pc-platform-role-editor-head > div');
    const description = header?.querySelector('p'), code = header?.querySelector('code');
    description?.classList.add('pc-role-description');
    if (code) code.hidden = true;
    const editor = form.querySelector<HTMLDetailsElement>('.pc-platform-role-adjust');
    const heading = form.querySelector('.pc-platform-role-section-head');
    const headingCopy = heading?.querySelector('div');
    const count = heading?.querySelector('em');
    if (headingCopy) { headingCopy.classList.add('pc-role-heading-copy'); if (count) headingCopy.append(count); }
    if (editor && heading) {
      const pencil = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12.5 3.5 4 4M3 17l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L3 17Z"/></svg>';
      const check = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'pc-role-edit-button'; edit.innerHTML = pencil + '<span>编辑</span>'; edit.setAttribute('aria-expanded', 'false');
      heading.append(edit);
      edit.addEventListener('click', () => {
        const editing = !editor.open; editor.open = editing; form.classList.toggle('is-editing', editing);
        edit.innerHTML = (editing ? check : pencil) + `<span>${editing ? '完成' : '编辑'}</span>`; edit.setAttribute('aria-expanded', String(editing));
      });
    }
    const actions = form.querySelector('.pc-platform-role-save .pc-org-form-actions');
    if (actions && editor) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pc-inline-ghost'; button.textContent = '取消修改'; button.dataset.roleCancel = '';
      button.addEventListener('click', () => cancel(form)); actions.prepend(button);
    }
  });
}
