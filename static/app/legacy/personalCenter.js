"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
(function () {
    const DEBUG = false;
    const log = (...args) => {
        if (DEBUG) {
            console.log('[PC]', ...args);
        }
    };
    const DEFAULT_TEMPLATE = `<div class="pc-overlay" data-action="pc-close"></div>
<aside class="pc-panel" role="dialog" aria-modal="true" aria-label="个人中心">
  <header class="pc-header">
    <div class="pc-user-inline">
      <div class="pc-avatar" id="pc-avatar"></div>
      <div class="pc-user-meta">
        <div class="pc-name" id="pc-name"></div>
        <div class="pc-roles" id="pc-roles"></div>
      </div>
    </div>
    <button class="pc-close" data-action="pc-close" aria-label="关闭">×</button>
  </header>
  <nav class="pc-nav" id="pc-nav"></nav>
  <main class="pc-content" id="pc-content" tabindex="0"></main>
  <footer class="pc-footer">Exam Viewer · Personal Center</footer>
</aside>`;
    const sections = [
        { id: 'dashboard', title: '概览', gate: (u) => !u.guest },
        { id: 'profile', title: '个人资料', gate: (u) => !u.guest },
        { id: 'roles', title: '角色权限', gate: (u) => !u.guest },
        { id: 'community', title: '社群', gate: (u) => !u.guest },
        { id: 'balance', title: '账户', gate: (u) => !u.guest },
        { id: 'admin-hub', title: '管理面板', gate: (u) => hasAnyRole(u, ['teacher', 'reviewer', 'academicAdmin', 'systemAdmin', 'superAdmin']) },
        { id: 'system-flags', title: '系统开关', gate: (u) => hasAnyRole(u, ['superAdmin']) },
        { id: 'logout', title: '退出登录', gate: (u) => !u.guest }
    ];
    const featureItems = [
        {
            id: 'recharge',
            title: '充值',
            icon: '💰',
            intent: 'openRecharge',
            gate: (u) => !u.guest
        },
        {
            id: 'redeem',
            title: '兑换',
            icon: '🎁',
            intent: 'openRedeem',
            gate: (u) => !u.guest
        },
        {
            id: 'coupons',
            title: '卡券',
            icon: '🎫',
            intent: 'openCoupons',
            gate: (u) => !u.guest
        },
        {
            id: 'profile',
            title: '个人信息',
            icon: '👤',
            intent: 'gotoProfile',
            gate: (u) => !u.guest
        },
        {
            id: 'community',
            title: '加入社群',
            icon: '💬',
            intent: 'joinCommunity',
            gate: (u) => !u.guest
        },
        {
            id: 'questions',
            title: '题目管理',
            icon: '🗂️',
            intent: 'openQuestionManager',
            gate: (u) => hasAnyRole(u, ['teacher', 'academicAdmin', 'systemAdmin', 'superAdmin'])
        },
        {
            id: 'approvals',
            title: '角色审批',
            icon: '🛂',
            intent: 'openRoleApprovals',
            gate: (u) => hasAnyRole(u, ['systemAdmin', 'superAdmin'])
        },
        {
            id: 'stats',
            title: '统计',
            icon: '📊',
            intent: 'openStats',
            gate: (u) => hasAnyRole(u, ['systemAdmin', 'superAdmin'])
        },
        {
            id: 'sysFlags',
            title: '系统开关',
            icon: '⚙️',
            intent: 'openSystemFlags',
            gate: (u) => hasAnyRole(u, ['superAdmin'])
        }
    ];
    const roleDefs = [
        { id: 'guest', name: '访客', desc: '未登录，仅可浏览公开内容', risk: 'low' },
        { id: 'student', name: '学生', desc: '做题 / 积分 / 充值', risk: 'low' },
        { id: 'teacher', name: '教师', desc: '组卷 / 题库管理 / 布置', risk: 'medium' },
        { id: 'reviewer', name: '阅卷', desc: '阅卷审核、质检', risk: 'medium' },
        { id: 'academicAdmin', name: '教务', desc: '课程/科目/班级高级配置', risk: 'medium' },
        { id: 'systemAdmin', name: '系统管理员', desc: '系统级管理（非高危开关）', risk: 'high' },
        { id: 'superAdmin', name: '超级管理员', desc: '全部权限 + 高危系统操作', risk: 'critical' }
    ];
    let activeSection = 'dashboard';
    let allUsers = [];
    let localContext = { guest: true };
    let systemFlags = [
        { key: 'maintenanceMode', value: false, risk: 'high', desc: '全站维护模式' },
        { key: 'betaNewEditor', value: true, risk: 'medium', desc: '新编辑器灰度' },
        { key: 'enableWeChatLogin', value: true, risk: 'low', desc: '启用微信登录' }
    ];
    let riskModal = null;
    let wechatTimer = null;
    function escapeHtml(v) {
        return String(v).replace(/[&<>'"`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;', '`': '&#96;' }[c] || c));
    }
    function initials(name) {
        const n = typeof name === 'string' ? name.trim() : '';
        return n ? n.charAt(0).toUpperCase() : 'U';
    }
    function hasAnyRole(ctx, roles) {
        return Array.isArray(ctx.roles) && ctx.roles.some((r) => roles.includes(r));
    }
    function visibleFeatures(ctx) {
        return featureItems.filter((item) => item.gate(ctx));
    }
    function showToast(msg) {
        let el = document.getElementById('pc-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'pc-toast';
            el.className = 'pc-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        window.setTimeout(() => {
            el?.classList.remove('show');
        }, 1800);
    }
    function getContextManager() {
        const cls = window.UserContextManager;
        return cls?.getInstance?.() ?? null;
    }
    function getContext() {
        const manager = getContextManager();
        return manager ? manager.getUserContext() : { ...localContext };
    }
    function setContext(ctx) {
        const manager = getContextManager();
        if (manager) {
            manager.setUserContext(ctx);
        }
        else {
            localContext = ctx;
            window.dispatchEvent(new CustomEvent('userContextChanged', { detail: ctx }));
        }
    }
    async function loadUsers() {
        if (allUsers.length > 0) {
            return;
        }
        const api = window.APIClient;
        if (!api || typeof api.getUsersByRole !== 'function') {
            allUsers = [];
            return;
        }
        const roles = ['guest', 'student', 'teacher', 'reviewer', 'academicAdmin', 'systemAdmin', 'superAdmin'];
        const map = new Map();
        for (const role of roles) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const users = (await api.getUsersByRole(role));
                users.forEach((u) => {
                    if (typeof u.id !== 'string') {
                        return;
                    }
                    map.set(u.id, {
                        id: u.id,
                        displayName: typeof u.displayName === 'string' ? u.displayName : u.id,
                        roleIds: Array.isArray(u.roleIds) ? u.roleIds.filter((v) => typeof v === 'string') : [],
                        balance: u.balance && typeof u.balance === 'object'
                            ? {
                                credits: typeof u.balance.credits === 'number'
                                    ? u.balance.credits
                                    : 0,
                                updatedAt: typeof u.balance.updatedAt === 'string'
                                    ? u.balance.updatedAt
                                    : new Date().toISOString()
                            }
                            : undefined,
                        email: typeof u.email === 'string' ? u.email : undefined,
                        avatar: typeof u.avatar === 'string' ? u.avatar : null,
                        lastLoginAt: typeof u.lastLoginAt === 'string' ? u.lastLoginAt : undefined,
                        status: typeof u.status === 'string' ? u.status : undefined,
                        accessibleLevels: Array.isArray(u.accessibleLevels)
                            ? u.accessibleLevels.filter((v) => typeof v === 'string')
                            : undefined
                    });
                });
            }
            catch (error) {
                log('load role users failed', role, error);
            }
        }
        allUsers = Array.from(map.values());
    }
    function ensureRoot() {
        let root = document.getElementById('personal-center');
        if (root) {
            return root;
        }
        root = document.createElement('div');
        root.id = 'personal-center';
        root.className = 'pc-hidden';
        root.innerHTML = DEFAULT_TEMPLATE;
        root.addEventListener('click', (e) => {
            const t = e.target;
            if (t?.dataset.action === 'pc-close') {
                closePanel();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) {
                closePanel();
            }
        });
        document.body.appendChild(root);
        return root;
    }
    function isOpen() {
        const root = document.getElementById('personal-center');
        return Boolean(root?.classList.contains('pc-open'));
    }
    function openPanel() {
        const root = ensureRoot();
        root.classList.remove('pc-hidden');
        root.classList.add('pc-open');
        void renderIdentity();
        renderSections();
        renderSectionContent();
    }
    function closePanel() {
        const root = document.getElementById('personal-center');
        if (!root) {
            return;
        }
        root.classList.remove('pc-open');
        root.classList.add('pc-hidden');
    }
    async function buildTrigger() {
        let trigger = document.getElementById('user-menu-trigger');
        if (!trigger) {
            trigger = document.createElement('div');
            trigger.id = 'user-menu-trigger';
            trigger.className = 'pc-trigger';
            (document.getElementById('exam-workarea') || document.body).appendChild(trigger);
            trigger.onclick = () => {
                if (getContext().guest) {
                    openWechatModal();
                }
                else {
                    openPanel();
                }
            };
        }
        const ctx = getContext();
        trigger.textContent = ctx.guest ? '登录' : initials(ctx.displayName);
        trigger.title = ctx.guest ? '登录账号' : `${ctx.displayName || ''} - 打开个人中心`;
        await loadUsers();
    }
    function renderSections() {
        const nav = document.getElementById('pc-nav');
        if (!nav) {
            return;
        }
        const ctx = getContext();
        nav.innerHTML = sections
            .filter((s) => s.gate(ctx))
            .map((s) => `<button class="pc-nav-item${s.id === activeSection ? ' active' : ''}" data-sec="${s.id}">${s.title}</button>`)
            .join('');
        nav.onclick = (e) => {
            const t = e.target;
            const btn = t?.closest('button.pc-nav-item');
            if (!btn) {
                return;
            }
            activeSection = btn.dataset.sec;
            renderSections();
            renderSectionContent();
        };
    }
    async function renderIdentity() {
        const ctx = getContext();
        const nameEl = document.getElementById('pc-name');
        const rolesEl = document.getElementById('pc-roles');
        const avatarEl = document.getElementById('pc-avatar');
        if (!nameEl || !rolesEl || !avatarEl) {
            return;
        }
        await loadUsers();
        nameEl.textContent = ctx.guest ? '未登录' : ctx.displayName || '用户';
        rolesEl.textContent = ctx.guest ? '' : (ctx.roles || []).join(', ');
        if (ctx.guest || !ctx.avatar) {
            avatarEl.textContent = ctx.guest ? 'G' : initials(ctx.displayName || 'U');
        }
        else {
            avatarEl.innerHTML = `<img src="${escapeHtml(ctx.avatar)}" alt="avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`;
        }
        const oldSwitch = nameEl.parentElement?.querySelector('select.pc-user-switch');
        oldSwitch?.remove();
        if (ctx.guest) {
            return;
        }
        const select = document.createElement('select');
        select.className = 'pc-user-switch';
        select.style.fontSize = 'inherit';
        select.style.marginLeft = '4px';
        if (allUsers.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '无用户';
            option.disabled = true;
            option.selected = true;
            select.appendChild(option);
        }
        else {
            allUsers.forEach((user) => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.displayName ? `${user.displayName} (${user.id})` : user.id;
                option.selected = user.id === ctx.id;
                select.appendChild(option);
            });
        }
        select.onchange = () => {
            const user = allUsers.find((item) => item.id === select.value);
            if (!user) {
                return;
            }
            window.setUserContext?.({
                id: user.id,
                displayName: user.displayName,
                roles: user.roleIds,
                balance: user.balance || { credits: 0, updatedAt: new Date().toISOString() },
                email: user.email || '',
                avatar: user.avatar || null,
                lastLoginAt: user.lastLoginAt || new Date().toLocaleString(),
                status: user.status || 'active',
                accessibleLevels: user.accessibleLevels || ['*'],
                guest: false
            });
        };
        nameEl.parentElement?.appendChild(select);
    }
    function renderDashboard(ctx) {
        const balance = ctx.balance?.credits ?? 0;
        const points = 0;
        const coupons = 0;
        const features = visibleFeatures(ctx);
        const roles = escapeHtml((ctx.roles || []).join(', ') || '无');
        const welcomeName = ctx.displayName ? `，${escapeHtml(ctx.displayName)}` : '';
        return `<div class="pc-dashboard">
			<div class="pc-dashboard-cards">
				<div class="pc-card pc-balance-card">
					<div class="pc-stat-pair">
						<div class="stat-item">
							<div class="stat-label">我的余额</div>
							<div class="stat-value">¥${balance}</div>
							<button class="pc-inline-btn" data-fx="recharge">充值</button>
						</div>
						<div class="stat-divider"></div>
						<div class="stat-item">
							<div class="stat-label">我的积分</div>
							<div class="stat-value">${points}</div>
							<button class="pc-inline-btn" data-fx="redeem">兑换</button>
						</div>
					</div>
				</div>
				<div class="pc-card pc-coupon-card">
					<div class="coupon-row">
						<div class="coupon-count">
							<div class="coupon-label">我的卡券</div>
							<div class="coupon-value">${coupons} 张</div>
						</div>
						<button class="pc-text-link" data-fx="viewCouponExp">优惠券即将过期 ›</button>
					</div>
				</div>
			</div>
			<div class="pc-card pc-service-card">
				<div class="pc-service-header">服务 / 功能</div>
				<div class="pc-service-grid">
					${features
            .map((item) => `<button class="service-item" data-intent="${item.intent}" title="${escapeHtml(item.title)}">
								<div class="svc-icon">${item.icon}</div>
								<div class="svc-title">${escapeHtml(item.title)}</div>
							</button>`)
            .join('')}
				</div>
			</div>
			<div class="pc-card pc-meta-card">
				<div class="pc-meta-line">欢迎${welcomeName}！</div>
				<div class="pc-meta-line">当前角色：${roles}</div>
				<div class="pc-meta-line subtle">更多功能将逐步开放。</div>
			</div>
		</div>`;
    }
    function renderRoles(ctx) {
        const owned = ctx.roles || [];
        const ownedStr = escapeHtml(owned.join(', ') || '无');
        const isSuper = owned.includes('superAdmin');
        let extra = '';
        if (isSuper) {
            const rows = roleDefs
                .map((role) => `<tr>
						<td>${escapeHtml(role.id)}</td>
						<td>${escapeHtml(role.name)}</td>
						<td>${escapeHtml(role.desc)}</td>
						<td><span class="risk-badge role-risk-${role.risk}">${role.risk}</span></td>
						<td>${owned.includes(role.id) ? '<span class="role-owned">✔</span>' : ''}</td>
					</tr>`)
                .join('');
            const blocks = roleDefs
                .map((role) => {
                const users = allUsers.filter((u) => u.roleIds.includes(role.id));
                if (users.length === 0) {
                    return '';
                }
                const list = users
                    .slice(0, 5)
                    .map((u) => `<li data-impersonate="${escapeHtml(u.id)}" title="切换为该用户">
								<span class="ru-name">${escapeHtml(u.displayName)}</span>
								<span class="ru-id">${escapeHtml(u.id)}</span>
							</li>`)
                    .join('');
                const more = users.length > 5 ? `<div class="ru-more">+${users.length - 5} 更多…</div>` : '';
                return `<div class="role-users-block" data-role="${escapeHtml(role.id)}">
						<div class="role-users-head"><strong>${escapeHtml(role.name)}</strong><span class="ru-count">(${users.length})</span></div>
						<ul class="role-user-list">${list}</ul>${more}
					</div>`;
            })
                .join('');
            extra = `<h3 style="margin-top:16px;">系统角色总览（仅 superAdmin 可见）</h3>
				<table class="roles-table"><thead><tr><th>ID</th><th>名称</th><th>说明</th><th>风险</th><th>拥有</th></tr></thead><tbody>${rows}</tbody></table>
				<p class="subtle" style="margin-top:8px;">下方是各角色的模拟用户（点击可快速切换身份，仅前端）。</p>
				<div class="role-users-grid">${blocks}</div>`;
        }
        return `<div class="pc-section"><h2>角色与权限</h2>
			<p>已拥有角色：${ownedStr}</p>
			<p><button disabled>申请教师（占位）</button> <button disabled>申请阅卷（占位）</button></p>
			${extra}
		</div>`;
    }
    function renderSystemFlags() {
        const maintenanceOn = systemFlags.find((f) => f.key === 'maintenanceMode')?.value ?? false;
        const rows = systemFlags
            .map((f) => `<tr>
					<td class="sf-key">${escapeHtml(f.key)}</td>
					<td class="sf-desc">${escapeHtml(f.desc)}</td>
					<td class="sf-val"><span class="flag-val ${f.value ? 'on' : 'off'}">${f.value ? 'ON' : 'OFF'}</span></td>
					<td class="sf-risk"><span class="risk-badge risk-${f.risk}">${f.risk}</span></td>
					<td class="sf-act"><button class="sf-toggle" data-flag="${f.key}" data-risk="${f.risk}">${f.value ? '关闭' : '开启'}</button></td>
				</tr>`)
            .join('');
        return `<div class="pc-section system-flags">
			<h2>系统开关 / 运维</h2>
			<div class="maintenance-card">
				<div class="mc-left">
					<div class="mc-title">维护模式</div>
					<div class="mc-desc">当前：<strong>${maintenanceOn ? '开启' : '关闭'}</strong>。开启后普通用户访问将受限。</div>
				</div>
				<div class="mc-right">
					<button class="mc-toggle" data-maintenance>${maintenanceOn ? '关闭维护' : '开启维护'}</button>
				</div>
			</div>
			<h3>功能开关</h3>
			<table class="sf-table">
				<thead><tr><th>Key</th><th>描述</th><th>值</th><th>风险</th><th>操作</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
			<p class="sf-hint">以上为本地模拟数据，后续将接入后端 API（GET/PUT /admin/feature-flags）。风险级别 high 需要输入确认词。</p>
		</div>`;
    }
    function handleFeatureIntent(intent) {
        switch (intent) {
            case 'gotoProfile':
                activeSection = 'profile';
                renderSections();
                renderSectionContent();
                break;
            case 'openSystemFlags':
                activeSection = 'system-flags';
                renderSections();
                renderSectionContent();
                break;
            case 'openRecharge':
            case 'openRedeem':
            case 'openCoupons':
            case 'joinCommunity':
            case 'openQuestionManager':
            case 'openRoleApprovals':
            case 'openStats':
                showToast(`功能占位: ${intent}`);
                break;
            default:
                showToast(`未识别 intent: ${intent}`);
                break;
        }
    }
    function attachDashboardHandlers(container) {
        container.onclick = (event) => {
            const target = event.target;
            const fx = target?.closest('[data-fx]');
            if (fx) {
                showToast(`功能占位: ${fx.getAttribute('data-fx') || ''}`);
                return;
            }
            const serviceItem = target?.closest('button.service-item');
            if (serviceItem) {
                handleFeatureIntent(serviceItem.dataset.intent || '');
            }
        };
    }
    function attachRolesHandlers(container) {
        const grid = container.querySelector('.role-users-grid');
        if (!grid) {
            return;
        }
        grid.addEventListener('click', (event) => {
            const target = event.target;
            const item = target?.closest('li[data-impersonate]');
            if (!item) {
                return;
            }
            const userId = item.dataset.impersonate || '';
            const user = allUsers.find((u) => u.id === userId);
            if (!user) {
                return;
            }
            showToast(`切换为 ${user.displayName}`);
            window.setUserContext?.({
                id: user.id,
                displayName: user.displayName,
                roles: user.roleIds,
                balance: user.balance || { credits: 0, updatedAt: new Date().toISOString() },
                email: user.email || '',
                avatar: user.avatar || null,
                lastLoginAt: user.lastLoginAt || new Date().toLocaleString(),
                status: user.status || 'active',
                accessibleLevels: user.accessibleLevels || ['*'],
                guest: false
            });
        });
    }
    function attachSystemFlagsHandlers(container) {
        container.onclick = (event) => {
            const target = event.target;
            if (!target) {
                return;
            }
            if (target.hasAttribute('data-maintenance')) {
                confirmRisk('维护模式切换', 'MAINTAIN', () => {
                    systemFlags = systemFlags.map((f) => (f.key === 'maintenanceMode' ? { ...f, value: !f.value } : f));
                    renderSectionContent();
                });
                return;
            }
            const key = target.getAttribute('data-flag');
            if (!key) {
                return;
            }
            const flag = systemFlags.find((f) => f.key === key);
            if (!flag) {
                return;
            }
            if (flag.risk === 'high') {
                confirmRisk(`切换 ${key}`, key.toUpperCase(), () => {
                    systemFlags = systemFlags.map((f) => (f.key === key ? { ...f, value: !f.value } : f));
                    renderSectionContent();
                });
                return;
            }
            systemFlags = systemFlags.map((f) => (f.key === key ? { ...f, value: !f.value } : f));
            renderSectionContent();
        };
    }
    function renderSectionContent() {
        const container = document.getElementById('pc-content');
        if (!container) {
            return;
        }
        const ctx = getContext();
        container.onclick = null;
        switch (activeSection) {
            case 'dashboard':
                container.innerHTML = renderDashboard(ctx);
                attachDashboardHandlers(container);
                break;
            case 'profile':
                container.innerHTML = `<div class="pc-section"><h2>个人资料</h2><p>昵称：${escapeHtml(ctx.displayName || '未设置')}</p><p>UID：${escapeHtml(ctx.id || '-')}</p><p>最近登录：${escapeHtml(ctx.lastLoginAt || '-')}</p></div>`;
                break;
            case 'roles':
                container.innerHTML = renderRoles(ctx);
                attachRolesHandlers(container);
                break;
            case 'community':
                container.innerHTML = `<div class="pc-section"><h2>社群</h2><p>加入学习社群以获取更多资料。</p><p><button disabled>加入社群（占位）</button></p></div>`;
                break;
            case 'balance':
                container.innerHTML = `<div class="pc-section"><h2>账户</h2><p>余额：${ctx.balance?.credits ?? 0}</p><p><button disabled>充值（占位）</button></p></div>`;
                break;
            case 'admin-hub':
                container.innerHTML = `<div class="pc-section"><h2>管理面板</h2><ul><li><button disabled>题目管理（占位）</button></li><li><button disabled>角色审批（占位）</button></li><li><button disabled>统计报表（占位）</button></li></ul></div>`;
                break;
            case 'system-flags':
                container.innerHTML = renderSystemFlags();
                attachSystemFlagsHandlers(container);
                break;
            case 'logout':
                window.logoutUser?.();
                break;
        }
        container.scrollTop = 0;
    }
    function ensureRiskModal() {
        if (riskModal) {
            return riskModal;
        }
        riskModal = document.createElement('div');
        riskModal.id = 'risk-modal';
        riskModal.className = 'risk-hidden';
        riskModal.innerHTML = `<div class="risk-backdrop" data-rm-act="close"></div>
			<div class="risk-panel">
				<div class="risk-header"><strong id="risk-title"></strong><button class="risk-close" data-rm-act="close">×</button></div>
				<div class="risk-body" id="risk-body"></div>
				<div class="risk-footer" id="risk-footer"></div>
			</div>`;
        riskModal.addEventListener('click', (event) => {
            const target = event.target;
            if (target?.dataset.rmAct === 'close' || target?.dataset.rmAct === 'cancel') {
                riskModal?.classList.remove('risk-open');
                riskModal?.classList.add('risk-hidden');
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && riskModal?.classList.contains('risk-open')) {
                riskModal.classList.remove('risk-open');
                riskModal.classList.add('risk-hidden');
            }
        });
        document.body.appendChild(riskModal);
        return riskModal;
    }
    function confirmRisk(title, word, onConfirm) {
        const modal = ensureRiskModal();
        const titleEl = modal.querySelector('#risk-title');
        const bodyEl = modal.querySelector('#risk-body');
        const footerEl = modal.querySelector('#risk-footer');
        if (!titleEl || !bodyEl || !footerEl) {
            return;
        }
        titleEl.textContent = title;
        bodyEl.innerHTML = `<div class="risk-desc">这是高风险操作，请确认后继续。</div>
			<div class="risk-level">风险等级: <span class="risk-tag risk-high">HIGH</span></div>
			<div class="risk-input-row">请输入 <code>${word}</code> 确认：<input id="risk-input" class="risk-input" /></div>`;
        footerEl.innerHTML = `<button class="risk-btn" data-rm-act="cancel">取消</button><button class="risk-btn primary" id="risk-ok" disabled>确认</button>`;
        modal.classList.remove('risk-hidden');
        modal.classList.add('risk-open');
        const input = modal.querySelector('#risk-input');
        const ok = modal.querySelector('#risk-ok');
        if (!input || !ok) {
            return;
        }
        input.oninput = () => {
            ok.disabled = input.value.trim() !== word;
        };
        ok.onclick = () => {
            modal.classList.remove('risk-open');
            modal.classList.add('risk-hidden');
            onConfirm();
        };
        window.setTimeout(() => input.focus(), 20);
    }
    function openWechatModal() {
        let modal = document.getElementById('wechat-login-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'wechat-login-modal';
            modal.className = 'wechat-hidden';
            modal.innerHTML = `<div class="wechat-backdrop" data-wc-act="close"></div>
				<div class="wechat-panel" role="dialog" aria-modal="true" aria-label="微信登录">
					<div class="wechat-header">
						<strong>微信扫码登录</strong>
						<button class="wechat-close" data-wc-act="close" aria-label="关闭">×</button>
					</div>
					<div class="wechat-body">
						<div class="wechat-qr-box" id="wechat-qr-box">
							<div class="wechat-qr-placeholder">生成中…</div>
						</div>
						<div class="wechat-status" id="wechat-status"></div>
					</div>
					<div class="wechat-footer">
						<button class="wc-btn" data-wc-act="refresh">刷新二维码</button>
						<button class="wc-btn" data-wc-act="close">取消</button>
					</div>
				</div>`;
            modal.addEventListener('click', (event) => {
                const target = event.target;
                const action = target?.dataset.wcAct;
                if (action === 'close') {
                    closeWechatModal();
                }
                else if (action === 'refresh') {
                    openWechatModal();
                }
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    closeWechatModal();
                }
            });
            document.body.appendChild(modal);
        }
        modal.classList.remove('wechat-hidden');
        modal.classList.add('wechat-open');
        const status = modal.querySelector('#wechat-status');
        if (status) {
            status.textContent = '请扫码登录（模拟）';
        }
        const qr = modal.querySelector('#wechat-qr-box');
        if (qr) {
            const token = Math.random().toString(36).slice(2, 8).toUpperCase();
            qr.innerHTML = `<canvas width="180" height="180"></canvas>`;
            const canvas = qr.querySelector('canvas');
            const ctx = canvas?.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, 180, 180);
                ctx.fillStyle = '#000';
                ctx.font = '12px monospace';
                ctx.fillText('WECHAT QR', 40, 70);
                ctx.fillText(token, 60, 95);
                ctx.fillText('模拟', 70, 120);
            }
        }
        if (wechatTimer !== null) {
            window.clearTimeout(wechatTimer);
        }
        wechatTimer = window.setTimeout(() => {
            const superAdmin = allUsers.find((u) => u.id === 'superAdmin01') || {
                id: 'superAdmin01',
                displayName: '超级管理员0111',
                roleIds: ['superAdmin'],
                balance: { credits: 1000, updatedAt: new Date().toISOString() }
            };
            window.setUserContext?.({
                id: superAdmin.id,
                displayName: superAdmin.displayName,
                roles: superAdmin.roleIds,
                balance: superAdmin.balance,
                guest: false
            });
            closeWechatModal();
            openPanel();
        }, 1000);
    }
    function closeWechatModal() {
        const modal = document.getElementById('wechat-login-modal');
        if (modal) {
            modal.classList.remove('wechat-open');
            modal.classList.add('wechat-hidden');
        }
        if (wechatTimer !== null) {
            window.clearTimeout(wechatTimer);
            wechatTimer = null;
        }
    }
    window.setUserContext = (ctx) => {
        setContext({ ...ctx, guest: false });
        void buildTrigger();
        if (isOpen()) {
            void renderIdentity();
            renderSections();
            renderSectionContent();
        }
    };
    window.logoutUser = () => {
        setContext({ guest: true });
        closePanel();
        void buildTrigger();
    };
    window.openPersonalCenter = () => openPanel();
    window.refreshPersonalCenterTrigger = () => buildTrigger();
    window.getUserContext = () => ({ ...getContext() });
    window._pcDebug = {
        openPanel,
        closePanel,
        buildTrigger,
        loadUsers,
        utils: { escapeHtml, initials, showToast, hasAnyRole, visibleFeatures }
    };
    const init = () => {
        void buildTrigger();
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        window.setTimeout(init, 0);
    }
    else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
//# sourceMappingURL=personalCenter.js.map