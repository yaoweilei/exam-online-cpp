const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const filterIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6M15 14v6"/></svg>';

const searches = [
  ['.pc-platform-org-directory [data-managed-org-query]', 'form'],
  ['[data-role-home-package-query]', 'form'],
  ['[data-org-member-list-query]', 'form'],
  ['[data-org-staff-query]', 'form'],
  ['[data-org-campus-list-query]', 'form'],
  ['[data-org-package-list-query]', 'form'],
  ['[data-org-learning-list-query]', 'form'],
  ['[data-platform-feedback-query]', 'form'],
  ['[data-platform-payment-query]', 'form'],
  ['[data-content-workflow-query]', 'form'],
  ['[data-platform-flag-query]', '.pc-platform-flag-toolbar'],
  ['[data-flow-query]', '.pc-flow-toolbar'],
  ['[data-audit-log-surface="embedded"] #al-actor', '.pc-audit-filters']
] as const;

/** Move the original controls, preserving draft values, form ownership and delegated handlers. */
export function bindFloatingSearch(container: HTMLElement): void {
  for (const [selector, controlSelector] of searches) {
    for (const input of container.querySelectorAll<HTMLInputElement>(selector)) {
      const controls = input.closest<HTMLElement>(controlSelector);
      if (!controls || controls.classList.contains('pc-floating-search')) continue;
      const paymentAdvanced = controls.nextElementSibling;
      if (paymentAdvanced?.matches('[data-platform-payment-advanced]')) {
        // The floating filter is already a disclosure; show its fields directly.
        const fields = [...paymentAdvanced.children].filter(child => child.tagName !== 'SUMMARY');
        for (const field of fields) {
          if (field.tagName === 'DIV') controls.append(...field.children);
          else controls.append(field);
        }
        paymentAdvanced.remove();
      }
      const owner = controls.closest<HTMLElement>('.pc-home-packages, .pc-platform-org-directory, [data-content-inline-panel], [data-institution-flow], [data-audit-log-surface], .pc-org-simple-workspace, .pc-org-subsection, .pc-subpage') || controls.parentElement;
      if (!owner || owner === controls) continue;
      const submit = controls.querySelector<HTMLButtonElement>('button[type="submit"], #al-search') || document.createElement('button');
      const nativeForm = controls instanceof HTMLFormElement;
      const originalLabel = input.getAttribute('aria-label') || input.placeholder || '搜索';
      input.setAttribute('aria-label', originalLabel);
      if (!input.placeholder) input.placeholder = originalLabel;
      const row = document.createElement('div'); row.className = 'pc-floating-search-row';
      const oldInputParent = input.parentElement;
      row.append(input);
      // Search field captions are redundant with the pill placeholder and accessible label.
      if (oldInputParent?.tagName === 'LABEL' && !oldInputParent.querySelector('input,select,button,textarea')) oldInputParent.remove();
      submit.type = nativeForm ? 'submit' : 'button';
      submit.classList.add('pc-floating-search-submit');
      submit.setAttribute('aria-label', originalLabel);
      submit.title = '搜索'; submit.innerHTML = searchIcon;
      row.prepend(submit);
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'pc-floating-search-clear';
      clear.setAttribute('aria-label', '清除搜索'); clear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      clear.hidden = !input.value;
      input.addEventListener('input', () => { clear.hidden = !input.value; });
      clear.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus({ preventScroll: true }); if (!submit.disabled) submit.click(); });
      row.append(clear);
      if (!nativeForm && !submit.id) submit.addEventListener('click', () => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      if (!nativeForm && submit.id) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit.click(); } });
      // Pagination stays immediately after the records, outside the floating dock.
      const pagers = [...controls.querySelectorAll<HTMLElement>('.pc-member-list-pagination, .pc-package-pagination, .pc-org-form-actions:has([data-org-campus-list-page])')];
      pagers.forEach(pager => { pager.classList.add('pc-floating-search-pagination'); pager.remove(); });
      const remaining = [...controls.childNodes];
      controls.replaceChildren(...pagers, row);
      if (remaining.some(node => node instanceof Element && (node.matches('select,button,input,textarea,details') || node.querySelector('select,button,input,textarea,details')))) {
        const disclosure = document.createElement('details'); disclosure.className = 'pc-floating-search-filters';
        const summary = document.createElement('summary'); summary.setAttribute('aria-label', '搜索筛选'); summary.title = '筛选'; summary.innerHTML = filterIcon;
        const panel = document.createElement('div'); panel.className = 'pc-floating-search-options'; panel.append(...remaining);
        // Flatten legacy secondary filter disclosures inside the single panel.
        for (const nested of panel.querySelectorAll('details.pc-content-extra-filters, details.pc-compact-filters')) {
          nested.replaceWith(...[...nested.childNodes].filter(node => !(node instanceof Element && node.tagName === 'SUMMARY')));
        }
        for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')) {
          const oldLabel = field.closest('label');
          if (oldLabel && oldLabel.querySelectorAll('select,input').length === 1 && !oldLabel.dataset.splitFilterLabel) continue;
          if (oldLabel) oldLabel.dataset.splitFilterLabel = 'true';
          const caption = field.getAttribute('aria-label') || (field.matches('[data-org-campus-list-order]') ? '顺序' : field.matches('[data-org-campus-list-page-size]') ? '每页数量' : field.matches('[data-flow-filter]') ? '状态' : field.getAttribute('placeholder') || '筛选条件');
          const label = document.createElement('label'); label.className = 'pc-org-field';
          const text = document.createElement('span'); text.textContent = caption;
          if (oldLabel) oldLabel.before(label); else field.before(label);
          label.append(text, field);
        }
        panel.querySelectorAll('label[data-split-filter-label]').forEach(label => label.remove());
        // The search action lives in the pill, not a duplicate filter toolbar.
        panel.querySelectorAll('button[type="submit"]').forEach(button => button.remove());
        disclosure.append(summary, panel); row.append(disclosure);
        controls.addEventListener('keydown', e => { if (e.key === 'Escape') { disclosure.open = false; input.focus({ preventScroll: true }); } });
      }
      controls.classList.add('pc-floating-search'); owner.classList.add('pc-floating-search-owner'); owner.append(controls);
    }
  }
}
