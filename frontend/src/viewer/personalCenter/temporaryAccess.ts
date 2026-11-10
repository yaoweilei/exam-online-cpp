type Row = Record<string, any>;
type Hooks = { owner: string; initial?: Row; current: () => boolean; search: (query: string) => Promise<unknown[]>; load: (id: string) => Promise<unknown>; preview: (id: string, value: Row) => Promise<unknown>; save: (id: string, value: Row) => Promise<unknown>; confirm: (message: string) => Promise<boolean>; notice: (message: string) => void };
type State = { query: string; users: Row[]; user?: Row; grants: Row[]; loaded: boolean; error: string; busy: boolean; edit: boolean; role: string; expiry: string; page: number; pickerFallback?: boolean; expiryDate?: string; expiryTime?: string; draft?: { base: Row[]; payload: Row; preview: Row; revoke: boolean }; sequence: number };
const states = new Map<string, State>();
const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const roles: Row = { assistant: '教务管理员', teacher: '教师', orgAdmin: '机构管理员', contentAdmin: '内容管理员' };
const list = (v: unknown): Row[] => Array.isArray(v) ? v : [];
const id = (u: Row) => String(u.id || u.user_id || '');
const name = (u: Row) => String(u.display_name || u.displayName || u.username || id(u));
const grants = (v: unknown) => { const value = v as Row, before = value.before || value; return Array.isArray(before.temporary_grants) ? before.temporary_grants : [...list(before.active_temporary_grants), ...list(before.expired_temporary_grants)]; };

export function bindTemporaryAccess(host: HTMLElement, hooks: Hooks): void {
  if (host.dataset.bound) return;
  host.dataset.bound = 'true';
  let s = states.get(hooks.owner);
  if (!s) { s = { query: '', users: [], grants: [], loaded: false, error: '', busy: false, edit: false, role: 'assistant', expiry: '', page: 1, sequence: 0 }; states.clear(); states.set(hooks.owner, s); }
  const state = s;
  if (state.pickerFallback === undefined) state.pickerFallback = typeof document.createElement('input').showPicker !== 'function';
  const generation = ++state.sequence; state.busy = false;
  const valid = () => host.isConnected && hooks.current() && state.sequence === generation;
  const expired = (g: Row) => Boolean(g.expires_at && Date.parse(g.expires_at) <= Date.now());
  const field = (label: string, body: string) => `<label class="pc-org-field"><span>${label}</span>${body}</label>`;
  function render() {
    if (!valid()) return;
    host.className = 'pc-temporary-access pc-floating-search-owner';
    const selected = state.user;
    const preview = state.draft;
    host.innerHTML = `${state.error ? `<p role="alert" class="pc-flow-error">${h(state.error)}</p>` : ''}
      ${selected ? `<div class="pc-access-user"><div><strong>${h(name(selected))}</strong><small>${h(selected.username || id(selected))}</small></div><div class="pc-access-user-actions"><button type="button" class="pc-inline-ghost" data-temp-change>更换用户</button><button class="pc-inline-ghost" type="button" data-temp-refresh>刷新</button></div></div><div class="pc-access-list-head"><strong>授权记录</strong><button class="pc-inline-btn" type="button" data-temp-new${state.edit ? ' disabled' : ''}>新增授权</button></div>
      ${state.loaded ? `<div class="pc-access-records">${state.grants.slice((state.page-1)*10,state.page*10).map((g,offset) => `<article><div><strong>${h(roles[g.role_id] || g.role_id || '自定义权限')}${g.effect === 'deny' ? ' · 限制' : ''}</strong><small>${g.expires_at ? h(new Date(g.expires_at).toLocaleString('zh-CN',{hour12:false}))+' 到期' : '未设置到期时间'}</small></div><span>${expired(g) ? '已到期' : '有效'}</span>${!expired(g) ? `<button type="button" class="pc-inline-ghost" data-temp-revoke="${(state.page-1)*10+offset}">撤销</button>` : ''}</article>`).join('') || '<p class="pc-admin-note">该用户暂无临时授权。</p>'}</div>${state.grants.length>10 ? `<nav class="pc-workflow-pagination"><button type="button" data-temp-page="${state.page-1}"${state.page===1?' disabled':''}>上一页</button><span>${state.page} / ${Math.ceil(state.grants.length/10)} 页</span><button type="button" data-temp-page="${state.page+1}"${state.page*10>=state.grants.length?' disabled':''}>下一页</button></nav>` : ''}` : '<p role="status">正在读取授权记录…</p>'}
      ${state.edit ? `<form data-temp-grant-form class="pc-access-editor"><h3>新增授权</h3><div class="pc-org-form-grid">${field('临时角色',`<select name="role" class="pc-profile-input">${Object.entries(roles).map(([key,label])=>`<option value="${key}"${state.role===key?' selected':''}>${label}</option>`).join('')}</select>`)}${field('有效期',state.pickerFallback ? `<span class="pc-access-expiry-fallback"><input class="pc-profile-input" type="date" name="expiryDate" aria-label="到期日期" required value="${h(state.expiryDate || state.expiry.split('T')[0])}"><input class="pc-profile-input" type="time" name="expiryTime" aria-label="到期时间" required value="${h(state.expiryTime || state.expiry.split('T')[1])}"></span>` : `<span class="pc-access-expiry-control"><input class="pc-profile-input" type="datetime-local" name="expiry" required value="${h(state.expiry)}"><button type="button" data-temp-pick-expiry aria-label="选择到期日期和时间"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg></button></span>`)}</div><div class="pc-org-form-actions"><button type="button" class="pc-inline-ghost" data-temp-cancel>取消</button><button class="pc-inline-btn" type="submit">预览授权</button></div></form>` : ''}
      ${preview ? `<section class="pc-access-preview" aria-label="授权变更预览"><strong>${preview.revoke?'撤销':'新增'}授权预览 · ${h(name(selected))}</strong><p>变更前 ${preview.base.length} 条，变更后 ${preview.payload.temporary_grants.length} 条临时授权。</p><p>新增权限 ${list(preview.preview.added_permissions).length} 项，移除权限 ${list(preview.preview.removed_permissions).length} 项。</p><p>确认后立即生效，该用户现有登录会话将失效。</p><button class="pc-inline-ghost" type="button" data-temp-cancel-preview>取消预览</button><button class="pc-inline-btn" type="button" data-temp-commit>确认${preview.revoke?'撤销':'授权'}</button></section>` : ''}`
      : `<p class="pc-admin-note">搜索并选择用户，查看该用户的有效及已到期授权。</p>${state.users.map((u,i)=>`<button type="button" class="pc-access-candidate" data-temp-user="${i}"><strong>${h(name(u))}</strong><small>${h(u.username || id(u))}</small><span aria-hidden="true">›</span></button>`).join('')}`}
      <form data-temp-search-form class="pc-floating-search"><div class="pc-floating-search-row"><button type="submit" class="pc-floating-search-submit" aria-label="搜索授权用户"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg></button><input class="pc-profile-input" name="query" aria-label="搜索授权用户" placeholder="账号 / 姓名 / 手机号 / 邮箱" value="${h(state.query)}"></div></form>`;
    if (state.busy) host.querySelectorAll<HTMLInputElement>('button,input,select').forEach(el=>el.disabled=true);
  }
  async function run(action: () => Promise<void>) {
    if (state.busy) return; state.busy = true; state.error = ''; render();
    try { await action(); } catch(e) { if(valid()) state.error = e instanceof Error ? e.message : '操作失败，请重试'; }
    finally { if(valid()) { state.busy=false; render(); } }
  }
  async function select(user: Row) {
    state.user=user;state.role='assistant';state.expiry='';state.expiryDate='';state.expiryTime='';state.loaded=false;state.edit=false;state.draft=undefined;state.page=1;state.grants=[];
    await run(async()=>{const value=await hooks.load(id(user));if(valid()){state.grants=grants(value);state.loaded=true;}});
  }
  async function preview(next: (base: Row[]) => Row[], revoke: boolean) {
    const current=await hooks.load(id(state.user!));if(!valid())return;
    const base=grants(current), payload={temporary_grants:next(base)};
    const result=await hooks.preview(id(state.user!),payload) as Row;if(!valid())return;
    const conflicts=list(result.conflicts || result.after?.conflicts);if(conflicts.length)throw Error('权限冲突：'+conflicts.join('；'));
    state.draft={base,payload,preview:result,revoke};
  }
  host.addEventListener('input',e=>{const target=e.target as HTMLInputElement;if(target.name==='query')state.query=target.value;if(target.name==='expiryDate'||target.name==='expiryTime'){if(target.name==='expiryDate')state.expiryDate=target.value;else state.expiryTime=target.value;state.expiry=state.expiryDate&&state.expiryTime?state.expiryDate+'T'+state.expiryTime:'';state.draft=undefined;host.querySelector('.pc-access-preview')?.remove();}if(target.name==='expiry'){state.expiry=target.value;state.draft=undefined;host.querySelector('.pc-access-preview')?.remove();}});
  host.addEventListener('change',e=>{const target=e.target as HTMLSelectElement;if(target.name==='role'){state.role=target.value;state.draft=undefined;host.querySelector('.pc-access-preview')?.remove();}});
  host.addEventListener('submit',e=>{
    e.preventDefault();e.stopPropagation();const form=e.target as HTMLFormElement;
    if(form.hasAttribute('data-temp-search-form'))void run(async()=>{const users=await hooks.search(state.query.trim());if(valid()){state.user=undefined;state.edit=false;state.draft=undefined;state.users=list(users);if(!users.length)state.error='没有找到匹配的用户。';}});
    else if(form.hasAttribute('data-temp-grant-form'))void run(async()=>{const time=new Date(state.expiry);if(!state.expiry||!Number.isFinite(time.getTime())||time.getTime()<=Date.now())throw Error('有效期必须晚于当前时间');await preview(base=>[...base,{role_id:state.role,effect:'allow',permissions:[],expires_at:time.toISOString()}],false);});
  });
  host.addEventListener('click',e=>{
    const target=e.target as HTMLElement;
    if (!state.busy && (target.closest('[data-temp-pick-expiry]') || target.matches('input[name=expiry]'))) {
      const input=host.querySelector<HTMLInputElement>('input[name=expiry]');
      if(input) { try { if(typeof input.showPicker !== 'function')throw Error('unsupported'); input.showPicker(); } catch { state.pickerFallback=true;state.expiryDate=state.expiry.split('T')[0]||'';state.expiryTime=state.expiry.split('T')[1]||'';render();host.querySelector<HTMLInputElement>('[name=expiryDate]')?.focus({preventScroll:true}); } }
      return;
    }
    const button=target.closest<HTMLButtonElement>('button');if(!button||state.busy)return;
    if(button.hasAttribute('data-temp-user'))void select(state.users[Number(button.dataset.tempUser)]);
    if(button.hasAttribute('data-temp-change')){state.user=undefined;state.edit=false;state.draft=undefined;render();}
    if(button.hasAttribute('data-temp-refresh')&&state.user)void select(state.user);
    if(button.hasAttribute('data-temp-new')){state.edit=true;state.draft=undefined;render();}
    if(button.hasAttribute('data-temp-cancel')){state.edit=false;state.draft=undefined;render();}
    if(button.hasAttribute('data-temp-cancel-preview')){state.draft=undefined;render();}
    if(button.hasAttribute('data-temp-page')){state.page=Number(button.dataset.tempPage);render();}
    if(button.hasAttribute('data-temp-revoke')){const target=JSON.stringify(state.grants[Number(button.dataset.tempRevoke)]);void run(()=>preview(base=>{const at=base.findIndex(g=>JSON.stringify(g)===target);if(at<0)throw Error('授权记录已变化，请刷新后重试');return base.filter((_,i)=>i!==at);},true));}
    if(button.hasAttribute('data-temp-commit'))void run(async()=>{
      const draft=state.draft;if(!draft)return;
      if(!await hooks.confirm(`确认${draft.revoke?'撤销':'新增'} ${name(state.user!)} 的临时授权？该用户现有登录会话将失效。`)||!valid())return;
      const latest=await hooks.load(id(state.user!));if(!valid())return;
      if(JSON.stringify(grants(latest))!==JSON.stringify(draft.base))throw Error('授权记录已被修改，请重新预览后再确认。');
      await hooks.save(id(state.user!),{...draft.payload,confirmation:'确认修改平台权限',reauth_password:''});
      if(!valid())return;state.draft=undefined;state.edit=false;
      const value=await hooks.load(id(state.user!));if(valid()){state.grants=grants(value);state.loaded=true;hooks.notice('临时授权已更新，原登录会话已失效');}
    });
  });
  render();
  if(hooks.initial && (!state.user || id(state.user)!==id(hooks.initial)))void select(hooks.initial).then(()=>{if(valid()){state.edit=true;render();}});
  else if(state.user&&!state.loaded)void select(state.user);
}
