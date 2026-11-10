import { escapeHtml as h } from './utils.js';

const icon = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
type UserSearchOptions = { sort?: 'created_at' | 'username'; order?: 'asc' | 'desc'; pageSize?: number };
export function renderUserSearchForm(draft: string, searched: boolean, options: UserSearchOptions = {}): string {
  const sort = options.sort === 'username' ? 'username' : 'created_at';
  const order = options.order === 'asc' ? 'asc' : 'desc';
  const filter = icon('<path d="M4 7h16M4 17h16M9 4v6M15 14v6"/>');
  return `<form class="pc-admin-list-search-form pc-user-search-pill" data-platform-user-search-form><div class="pc-admin-list-search-row"><button class="pc-user-search-icon" type="submit" aria-label="执行用户搜索" title="搜索">${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>')}</button><label class="pc-admin-list-search-field"><input class="pc-profile-input" type="search" aria-label="搜索用户" maxlength="128" data-platform-user-search-input value="${h(draft)}" placeholder="账号 / 姓名 / 手机号 / 邮箱" /></label><button class="pc-user-search-icon" type="button" data-platform-user-clear aria-label="清除用户搜索" title="清除"${draft || searched ? '' : ' hidden'}>${icon('<path d="m7 7 10 10M17 7 7 17"/>')}</button><button class="pc-user-search-icon" type="button" data-user-search-voice hidden aria-label="语音输入" aria-pressed="false" title="语音输入：由浏览器提供，可能使用联网识别服务">${icon('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>')}</button><details class="pc-floating-search-filters pc-user-search-filters"><summary aria-label="用户排序" title="排序">${filter}</summary><div class="pc-floating-search-options"><label class="pc-org-field"><span>排序字段</span><select class="pc-profile-input" data-platform-user-sort><option value="created_at"${sort === 'created_at' ? ' selected' : ''}>创建时间</option><option value="username"${sort === 'username' ? ' selected' : ''}>账号</option></select></label><label class="pc-org-field"><span>顺序</span><select class="pc-profile-input" data-platform-user-order><option value="desc"${order === 'desc' ? ' selected' : ''}>降序</option><option value="asc"${order === 'asc' ? ' selected' : ''}>升序</option></select></label><label class="pc-org-field"><span>每页数量</span><select class="pc-profile-input" data-platform-user-page-size>${[10, 20, 50].map(size => `<option value="${size}"${size === (options.pageSize || 10) ? ' selected' : ''}>${size} 条</option>`).join('')}</select></label></div></details></div><p class="pc-user-voice-status" data-user-voice-status role="status" aria-live="polite" hidden></p></form>`;
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
export function bindUserSearchVoice(container: HTMLElement): void {
  container.querySelectorAll<HTMLFormElement>('[data-platform-user-search-form]').forEach(form => {
    if (form.dataset.voiceBound) return;
    form.dataset.voiceBound = 'true';
    const button = form.querySelector<HTMLButtonElement>('[data-user-search-voice]');
    const input = form.querySelector<HTMLInputElement>('[data-platform-user-search-input]');
    const status = form.querySelector<HTMLElement>('[data-user-voice-status]');
    if (!button || !input || !status) return;
    const api = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    button.hidden = !window.isSecureContext || typeof (api.SpeechRecognition || api.webkitSpeechRecognition) !== 'function';
    if (button.hidden) { status.hidden = true; status.textContent = ''; return; }
    let active: Recognition | null = null, timer = 0, observer: MutationObserver | null = null;
    const message = (text: string) => { if (form.isConnected) { status.textContent = text; status.hidden = false; } };
    const cleanup = () => { active = null; window.clearTimeout(timer); observer?.disconnect(); observer = null; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', '语音输入'); window.removeEventListener('pagehide', cancel); };
    const cancel = () => { const previous = active; cleanup(); try { previous?.abort(); } catch {} };
    const unavailable = () => { cancel(); button.hidden = true; status.textContent = ''; status.hidden = true; };
    button.addEventListener('click', () => {
      if (active) { cancel(); message('已停止语音输入。'); return; }
      const api = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Constructor = api.SpeechRecognition || api.webkitSpeechRecognition;
      if (typeof Constructor !== 'function' || !window.isSecureContext) { unavailable(); return; }
      const original = input.value;
      let received = false, failed = false;
      try {
        const recognition = new Constructor(); active = recognition;
        recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = false;
        recognition.onresult = event => {
          if (active !== recognition || !form.isConnected) return;
          if (input.value !== original) { failed = true; message('输入内容已修改，未覆盖当前文字。'); cancel(); return; }
          const text = Array.from(event.results as ArrayLike<any>).filter(row => row.isFinal).map(row => String(row[0]?.transcript || '')).join('').trim();
          if (!text) return;
          received = true; input.value = text.slice(0, 128); input.dispatchEvent(new Event('input', { bubbles: true }));
          form.querySelector<HTMLButtonElement>('[data-platform-user-clear]')?.removeAttribute('hidden');
          message('已转为文字，请核对后点击放大镜或按回车搜索。');
        };
        recognition.onerror = event => { if (active !== recognition || !form.isConnected) return; failed = true; if (event.error === 'service-not-allowed' || event.error === 'language-not-supported') { unavailable(); return; } message(event.error === 'not-allowed' ? '无法使用麦克风，请检查浏览器权限，或使用键盘输入。' : event.error === 'no-speech' ? '没有听清，请重试或使用键盘输入。' : '语音识别暂不可用，请检查网络或使用键盘输入。'); cancel(); };
        recognition.onend = () => { if (active !== recognition) return; if (!received && !failed) message('未识别到文字，可重试或使用键盘输入。'); cleanup(); };
        button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-label', '停止语音输入');
        message('正在聆听，再点麦克风可停止。识别服务由浏览器提供，可能需要联网。');
        observer = new MutationObserver(() => { if (!form.isConnected) cancel(); }); observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('pagehide', cancel);
        recognition.start(); timer = window.setTimeout(() => { if (active === recognition) { cancel(); message('语音输入已超时，请重试。'); } }, 30000);
      } catch (error) { if (error instanceof DOMException && error.name === 'NotSupportedError') { unavailable(); } else { cancel(); message('无法启动语音输入，请使用键盘输入。'); } }
    });
  });
}
