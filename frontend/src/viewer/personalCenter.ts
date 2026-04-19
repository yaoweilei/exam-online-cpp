/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface PCBalance {
	credits: number;
	updatedAt: string;
}

interface PCSubscription {
	plan: string;
	status: string;
	expiresAt: string;
}

interface PCUser {
	id: string;
	displayName: string;
	roleIds: string[];
	balance?: PCBalance;
	email?: string;
	avatar?: string | null;
	lastLoginAt?: string;
	status?: string;
	accessibleLevels?: string[];
	subscription?: PCSubscription;
	scopeType?: string;
	organizationType?: string;
}

interface PCContext {
	guest: boolean;
	id?: string;
	displayName?: string;
	roles?: string[];
	balance?: PCBalance;
	email?: string;
	avatar?: string | null;
	lastLoginAt?: string;
	status?: string;
	accessibleLevels?: string[];
	subscription?: PCSubscription;
	scopeType?: string;
	organizationType?: string;
}

interface PCContextManager {
	getUserContext: () => PCContext;
	setUserContext: (ctx: PCContext) => void;
}

interface SectionDef {
	id: 'dashboard' | 'profile' | 'roles' | 'community' | 'balance' | 'admin-hub' | 'system-flags' | 'logout';
	title: string;
	gate: (ctx: PCContext) => boolean;
	nav?: boolean;
}

interface SystemFlag {
	key: string;
	value: boolean;
	risk: 'low' | 'medium' | 'high';
	desc: string;
}

interface FeatureItem {
	id: string;
	title: string;
	icon: string;
	intent: string;
	gate: (ctx: PCContext) => boolean;
}

interface RoleDef {
	id: string;
	name: string;
	desc: string;
	risk: 'low' | 'medium' | 'high' | 'critical';
}

interface AvatarPreset {
	id: string;
	label: string;
	role: string;
	avatarUrl: string;
}

interface AvatarPalette {
	bg: string;
	hair: string;
	shirt: string;
	skin: string;
	accent: string;
	line: string;
}

interface AvatarSeed {
	id: string;
	label: string;
	role: string;
	hairStyle: 'short' | 'part' | 'bob' | 'buzz' | 'wave' | 'cap';
	accessory: 'none' | 'glasses' | 'badge' | 'star' | 'book' | 'bolt' | 'leaf' | 'ribbon';
	palette: AvatarPalette;
}

(function () {
	const DEBUG = false;
	const log = (...args: unknown[]) => {
		if (DEBUG) {
			console.log('[PC]', ...args);
		}
	};

	const DEFAULT_TEMPLATE = `<div class="pc-overlay" data-action="pc-close"></div>
<aside class="pc-panel" role="dialog" aria-modal="true" aria-label="个人中心">
  <header class="pc-header">
	<div class="pc-header-main">
	  <div class="pc-header-top">
		<div class="pc-user-inline">
		  <div class="pc-avatar" id="pc-avatar"></div>
		  <div class="pc-user-meta">
			<div class="pc-name" id="pc-name"></div>
			<div class="pc-roles" id="pc-roles"></div>
		  </div>
		</div>
		<div class="pc-header-actions">
		  <button class="pc-close" data-action="pc-close" aria-label="关闭">×</button>
		</div>
	  </div>
	  <div class="pc-header-overview" id="pc-header-overview"></div>
	</div>
  </header>
  <nav class="pc-nav" id="pc-nav"></nav>
  <main class="pc-content" id="pc-content" tabindex="0"></main>
	<footer class="pc-footer">
	  <div class="pc-footer-actions" id="pc-footer-actions"></div>
	  <div class="pc-footer-meta">Exam Viewer · Personal Center</div>
	</footer>
</aside>`;

	const sections: SectionDef[] = [
		{ id: 'dashboard', title: '我的', gate: (u) => !u.guest, nav: true },
		{ id: 'profile', title: '资料', gate: (u) => !u.guest, nav: false },
		{ id: 'admin-hub', title: '管理', gate: (u) => hasAnyRole(u, ['teacher', 'reviewer', 'orgAdmin', 'systemAdmin', 'superAdmin']), nav: true }
	];

	const featureItems: FeatureItem[] = [
		{
			id: 'recharge',
			title: '充值',
			icon: 'wallet',
			intent: 'openRecharge',
			gate: (u) => !u.guest
		},
		{
			id: 'redeem',
			title: '兑换',
			icon: 'gift',
			intent: 'openRedeem',
			gate: (u) => !u.guest
		},
		{
			id: 'coupons',
			title: '卡券',
			icon: 'ticket',
			intent: 'openCoupons',
			gate: (u) => !u.guest
		},
		{
			id: 'profile',
			title: '个人信息',
			icon: 'profileMark',
			intent: 'gotoProfile',
			gate: (u) => !u.guest
		},
		{
			id: 'community',
			title: '加入社群',
			icon: 'community',
			intent: 'joinCommunity',
			gate: (u) => !u.guest
		},
		{
			id: 'questions',
			title: '题目管理',
			icon: 'folder',
			intent: 'openQuestionManager',
			gate: (u) => hasAnyRole(u, ['teacher', 'orgAdmin', 'systemAdmin', 'superAdmin'])
		},
		{
			id: 'approvals',
			title: '角色审批',
			icon: 'badge',
			intent: 'openRoleApprovals',
			gate: (u) => hasAnyRole(u, ['systemAdmin', 'superAdmin'])
		},
		{
			id: 'stats',
			title: '统计',
			icon: 'chart',
			intent: 'openStats',
			gate: (u) => hasAnyRole(u, ['systemAdmin', 'superAdmin'])
		},
		{
			id: 'sysFlags',
			title: '系统开关',
			icon: 'settings',
			intent: 'openSystemFlags',
			gate: (u) => hasAnyRole(u, ['superAdmin'])
		}
	];

	const roleDefs: RoleDef[] = [
		{ id: 'guest', name: '访客', desc: '未登录，仅可浏览公开内容', risk: 'low' },
		{ id: 'student', name: '学生', desc: '做题 / 积分 / 充值', risk: 'low' },
		{ id: 'teacher', name: '教师', desc: '组卷 / 题库管理 / 布置', risk: 'medium' },
		{ id: 'reviewer', name: '阅卷', desc: '阅卷审核、质检', risk: 'medium' },
		{ id: 'orgAdmin', name: '组织管理员', desc: '组织空间内的成员与资源管理', risk: 'medium' },
		{ id: 'systemAdmin', name: '系统管理员', desc: '系统级管理（非高危开关）', risk: 'high' },
		{ id: 'superAdmin', name: '超级管理员', desc: '全部权限 + 高危系统操作', risk: 'critical' }
	];

	const avatarPresets: AvatarPreset[] = buildAvatarPresets();

	let activeSection: SectionDef['id'] = 'dashboard';
	let allUsers: PCUser[] = [];
	let localContext: PCContext = { guest: true };
	let systemFlags: SystemFlag[] = [
		{ key: 'maintenanceMode', value: false, risk: 'high', desc: '全站维护模式' },
		{ key: 'betaNewEditor', value: true, risk: 'medium', desc: '新编辑器灰度' },
		{ key: 'enableWeChatLogin', value: true, risk: 'low', desc: '启用微信登录' }
	];
	let riskModal: HTMLDivElement | null = null;
	let wechatTimer: number | null = null;

	function escapeHtml(v: unknown): string {
		return String(v).replace(/[&<>'"`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;', '`': '&#96;' }[c] || c));
	}

	function svgToDataUri(svg: string): string {
		return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
	}

	function deriveFallbackDisplayName(ctx: PCContext): string {
		const rawId = (ctx.id || '').trim();
		if (!rawId) {
			return '我的账号';
		}
		const normalized = rawId.replace(/^usr_/, '');
		return `用户${normalized.slice(0, 6)}`;
	}

	function preferredDisplayName(ctx: PCContext): string {
		const explicit = (ctx.displayName || '').trim();
		if (explicit) {
			return explicit;
		}
		return deriveFallbackDisplayName(ctx);
	}

	function renderAccessory(kind: AvatarSeed['accessory'], accent: string, line: string): string {
		const bubble = (inner: string) =>
			`<g transform="translate(62 58)">
				<circle cx="10" cy="10" r="9.8" fill="#fff"/>
				<circle cx="10" cy="10" r="8.7" fill="none" stroke="${accent}" stroke-width="1.7"/>
				${inner}
			</g>`;

		switch (kind) {
			case 'glasses':
				return `<g fill="none" stroke="${line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="40.5" cy="46" r="4.3"/>
					<circle cx="55.5" cy="46" r="4.3"/>
					<path d="M44.8 46h6.4"/>
				</g>`;
			case 'badge':
				return bubble(`<circle cx="10" cy="8.2" r="2.6" fill="none" stroke="${accent}" stroke-width="1.5"/><path d="M7.5 13 9.2 10.5 10 12.5 10.8 10.5 12.5 13" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
			case 'star':
				return bubble(`<path d="M10 4.1 11.9 7.8 16 8.3 13 11 13.9 15.1 10 13 6.1 15.1 7 11 4 8.3 8.1 7.8Z" fill="${accent}"/>`);
			case 'book':
				return bubble(`<g fill="none" stroke="${accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 6.4h4.9a2 2 0 0 1 2 2v5H7.5a2.1 2.1 0 0 0-2.3 2.1Z"/><path d="M14.8 6.4H10a2 2 0 0 0-2 2v7.1a2.1 2.1 0 0 1 2.3-2.1h4.5Z"/></g>`);
			case 'bolt':
				return bubble(`<path d="M11.2 3.9 7.2 9.6h3.2l-1.7 6.1 5.6-7.3h-3.1Z" fill="${accent}"/>`);
			case 'leaf':
				return bubble(`<g fill="none" stroke="${accent}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M14.9 5.4c-5.3 0-8.5 3.5-8.5 8.1 0 1 .2 1.9.5 2.7 5.2-.2 9.2-4.1 9.5-9.2-.4-.1-1-.2-1.5-.2Z"/><path d="M7.1 15.5c2-2 4.5-4 7.2-5.6"/></g>`);
			case 'ribbon':
				return `<g fill="none" stroke="${accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M34.5 24.5c1.8 0 3.1 1.1 3.1 2.8 0 1.5-.8 2.8-2.9 4.3"/><path d="M61.5 24.5c-1.8 0-3.1 1.1-3.1 2.8 0 1.5.8 2.8 2.9 4.3"/></g>`;
			case 'none':
			default:
				return '';
		}
	}

	function renderHair(kind: AvatarSeed['hairStyle'], color: string): string {
		switch (kind) {
			case 'part':
				return `<path d="M30.4 39c.7-11.7 8.5-20 18.2-20 8.2 0 15.9 5.9 18.5 16.3-5.7-3.3-11.4-4.6-16.6-4.6l-3.3 4.4-1.7-4.4c-4.6.5-9.2 3-15.1 8.3Z" fill="${color}"/>`;
			case 'bob':
				return `<path d="M28.8 36.8c1-11.3 8.8-19.2 19.2-19.2 10.9 0 19.1 8.1 19.6 19.5-1 4.8-3.1 8-6 10-2.8-5.6-7.4-8.2-13.5-8.2-6.2 0-10.9 2.7-13.9 8.3-3.7-2.3-5.1-5.8-5.4-10.4Z" fill="${color}"/>`;
			case 'buzz':
				return `<path d="M31.6 38c2.9-9.7 10.4-15.3 17.5-15.3 9.1 0 16 5.9 18.1 15.6-6.1-2.5-12.1-3.7-18-3.7-5.9 0-11.9 1.2-17.6 3.4Z" fill="${color}"/>`;
			case 'wave':
				return `<path d="M27.8 39c1.3-11.7 9.7-20.1 20.3-20.1 9.1 0 16.9 6.2 19.8 16.5-4.4-3-7.7-4.4-10.9-4.4-4.1 0-7.4 1.5-10.1 4.3-2.7-1.7-5.1-2.4-7.6-2.4-3.8 0-7.2 1.8-11.5 6.1Z" fill="${color}"/>`;
			case 'cap':
				return `<path d="M28.2 37.2c3.7-9.8 11.5-15.7 21.3-15.7 8.2 0 15.3 3.9 20 10.1L29 37.8Z" fill="${color}"/><path d="M28.8 37.8h41.6c-2 4.7-6.7 7.2-13.8 7.2H40.1c-5.8 0-9.6-2.3-11.3-7.2Z" fill="${color}" opacity="0.95"/>`;
			case 'short':
			default:
				return `<path d="M30.2 39c.6-11.1 8.4-19.4 18.5-19.4 10.7 0 18.4 7.9 19 19.2-4.8-4.9-10.8-7-18.6-7-7.1 0-13.3 2.2-18.9 7.2Z" fill="${color}"/>`;
		}
	}

	function buildAvatarSvg(seed: AvatarSeed): string {
		const gradientId = `bg-${seed.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
		const shirtId = `shirt-${seed.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${seed.label}">
			<defs>
				<linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="#ffffff"/>
					<stop offset="100%" stop-color="${seed.palette.bg}"/>
				</linearGradient>
				<linearGradient id="${shirtId}" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="${seed.palette.shirt}"/>
					<stop offset="100%" stop-color="${seed.palette.accent}"/>
				</linearGradient>
			</defs>
			<rect width="96" height="96" rx="24" fill="url(#${gradientId})"/>
			<circle cx="78" cy="18" r="11" fill="${seed.palette.accent}" opacity="0.1"/>
			<circle cx="18" cy="77" r="14" fill="${seed.palette.accent}" opacity="0.08"/>
			<path d="M14 96c3-17.8 16-31.4 34-31.4S79 78.2 82 96" fill="url(#${shirtId})"/>
			<path d="M30 96c2.2-10.8 9.2-17.2 18-17.2s15.8 6.4 18 17.2" fill="${seed.palette.shirt}" opacity="0.88"/>
			<path d="M42 57h12v11.2a6 6 0 0 1-12 0Z" fill="${seed.palette.skin}"/>
			<circle cx="31.2" cy="43.8" r="3.3" fill="${seed.palette.skin}" opacity="0.92"/>
			<circle cx="64.8" cy="43.8" r="3.3" fill="${seed.palette.skin}" opacity="0.92"/>
			<circle cx="48" cy="42.4" r="18.8" fill="${seed.palette.skin}"/>
			${renderHair(seed.hairStyle, seed.palette.hair)}
			<path d="M37.6 41.3c1-.8 2.2-1.2 3.5-1.2 1.1 0 2.3.4 3.5 1.2" fill="none" stroke="${seed.palette.line}" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
			<path d="M51.4 41.3c1-.8 2.2-1.2 3.5-1.2 1.1 0 2.3.4 3.5 1.2" fill="none" stroke="${seed.palette.line}" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
			<ellipse cx="40.6" cy="46.1" rx="1.9" ry="2.1" fill="${seed.palette.line}"/>
			<ellipse cx="55.4" cy="46.1" rx="1.9" ry="2.1" fill="${seed.palette.line}"/>
			<path d="M48 46.8v3.5" fill="none" stroke="${seed.palette.line}" stroke-width="1.4" stroke-linecap="round" opacity="0.45"/>
			<path d="M42.8 53.1c1.9 2.3 4 3.1 5.2 3.1 1.4 0 3.4-.8 5.2-3.1" fill="none" stroke="${seed.palette.line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
			<circle cx="37.2" cy="50.8" r="2.1" fill="${seed.palette.accent}" opacity="0.12"/>
			<circle cx="58.8" cy="50.8" r="2.1" fill="${seed.palette.accent}" opacity="0.12"/>
			${renderAccessory(seed.accessory, seed.palette.accent, seed.palette.line)}
		</svg>`;
	}

	function buildAvatarPresets(): AvatarPreset[] {
		const seeds: AvatarSeed[] = [
			{ id: 'student-sky', label: '学生蓝', role: '学生', hairStyle: 'short', accessory: 'book', palette: { bg: '#eef5ff', hair: '#2f3f56', shirt: '#7ea4f8', skin: '#f5d1b5', accent: '#3c6df0', line: '#253244' } },
			{ id: 'teacher-amber', label: '教师棕', role: '教师', hairStyle: 'part', accessory: 'glasses', palette: { bg: '#fff4e7', hair: '#4d3428', shirt: '#d69c58', skin: '#f1cfb0', accent: '#5a4031', line: '#34251d' } },
			{ id: 'reviewer-plum', label: '阅卷紫', role: '阅卷', hairStyle: 'bob', accessory: 'badge', palette: { bg: '#f5edff', hair: '#47325f', shirt: '#9878d8', skin: '#f4d5bd', accent: '#6f57b5', line: '#372749' } },
			{ id: 'orgadmin-mint', label: '组织绿', role: '组织管理员', hairStyle: 'wave', accessory: 'leaf', palette: { bg: '#edf9f4', hair: '#274a3e', shirt: '#5cb990', skin: '#f0cbaa', accent: '#23936a', line: '#234137' } },
			{ id: 'sysadmin-slate', label: '系统灰', role: '系统管理员', hairStyle: 'buzz', accessory: 'bolt', palette: { bg: '#eff2f6', hair: '#36404a', shirt: '#8595a6', skin: '#eecaa8', accent: '#4c5d70', line: '#27313b' } },
			{ id: 'superadmin-gold', label: '超管金', role: '超级管理员', hairStyle: 'cap', accessory: 'star', palette: { bg: '#fff7e6', hair: '#5b4320', shirt: '#d6aa45', skin: '#f3d2b6', accent: '#d38b0d', line: '#43311a' } },
			{ id: 'mentor-rose', label: '导师粉', role: '导师', hairStyle: 'bob', accessory: 'ribbon', palette: { bg: '#fff0f4', hair: '#6a3b50', shirt: '#dc8ca7', skin: '#f5d2bd', accent: '#c85f87', line: '#4a2a38' } },
			{ id: 'designer-coral', label: '设计橙', role: '设计', hairStyle: 'wave', accessory: 'star', palette: { bg: '#fff2ec', hair: '#6d3b2b', shirt: '#ef8f72', skin: '#f3cfb7', accent: '#ef6b47', line: '#4f2c22' } },
			{ id: 'coder-indigo', label: '开发靛', role: '开发', hairStyle: 'short', accessory: 'bolt', palette: { bg: '#eef1ff', hair: '#243459', shirt: '#6f82da', skin: '#f2d0b0', accent: '#435bcd', line: '#1f2d4b' } },
			{ id: 'reader-lime', label: '阅读青', role: '阅读', hairStyle: 'part', accessory: 'book', palette: { bg: '#f4fbe8', hair: '#435336', shirt: '#a7cb5b', skin: '#f1d0b2', accent: '#6d9e24', line: '#314127' } },
			{ id: 'athlete-red', label: '活力红', role: '运动', hairStyle: 'buzz', accessory: 'ribbon', palette: { bg: '#fff0ed', hair: '#3d2b2a', shirt: '#ea7a66', skin: '#efcaab', accent: '#dc4d3a', line: '#352422' } },
			{ id: 'analyst-teal', label: '分析青', role: '分析', hairStyle: 'short', accessory: 'badge', palette: { bg: '#ebf8f8', hair: '#244348', shirt: '#62b7bd', skin: '#efd1b4', accent: '#278793', line: '#1f3639' } },
			{ id: 'speaker-violet', label: '演讲紫', role: '表达', hairStyle: 'wave', accessory: 'glasses', palette: { bg: '#f7efff', hair: '#4a3565', shirt: '#a37ad8', skin: '#f4d3ba', accent: '#7f5bc5', line: '#39294d' } },
			{ id: 'explorer-sand', label: '探索卡其', role: '探索', hairStyle: 'cap', accessory: 'leaf', palette: { bg: '#faf3e8', hair: '#59462f', shirt: '#c9ab76', skin: '#f0cfaf', accent: '#8c6d34', line: '#453521' } }
		];

		return [
			{ id: 'default', label: '默认', role: '系统', avatarUrl: '' },
			...seeds.map((seed) => ({
				id: seed.id,
				label: seed.label,
				role: seed.role,
				avatarUrl: svgToDataUri(buildAvatarSvg(seed))
			}))
		];
	}

	function syncStoredProfilePatch(patch: { avatarUrl?: string; displayName?: string }): void {
		try {
			const raw = localStorage.getItem('exam_v2_user');
			if (!raw) {
				return;
			}
			const stored = JSON.parse(raw) as Record<string, unknown>;
			if (Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')) {
				stored.avatar = patch.avatarUrl || '';
				stored.avatar_url = patch.avatarUrl || '';
			}
			if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
				stored.display_name = patch.displayName || '';
				stored.displayName = patch.displayName || '';
			}
			const profile = stored.profile;
			if (profile && typeof profile === 'object') {
				if (Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')) {
					(profile as Record<string, unknown>).avatar_url = patch.avatarUrl || '';
				}
				if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
					(profile as Record<string, unknown>).display_name = patch.displayName || '';
				}
			}
			localStorage.setItem('exam_v2_user', JSON.stringify(stored));
		} catch (error) {
			log('syncStoredProfilePatch failed', error);
		}
	}

	function renderOutlineIcon(name: string, className = ''): string {
		const cls = className ? ` class="${className}"` : '';
		const svg = (paths: string) =>
			`<svg${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
		switch (name) {
			case 'wallet':
				return svg('<path d="M4 8.5h16v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><path d="M7 8V6.8A1.8 1.8 0 0 1 8.8 5h9.2"/><path d="M20 11.5h-4.2a1.8 1.8 0 1 0 0 3.6H20"/>');
			case 'gift':
				return svg('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8v12"/><path d="M4 12h16"/><path d="M12 8c0-2-1-3-2.6-3-1.3 0-2.2.9-2.2 2.1 0 1.2.9 1.9 2.8 1.9H12Z"/><path d="M12 8c0-2 1-3 2.6-3 1.3 0 2.2.9 2.2 2.1 0 1.2-.9 1.9-2.8 1.9H12Z"/>');
			case 'ticket':
				return svg('<path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17v-2a2 2 0 0 0 0-4V9A1.5 1.5 0 0 1 6 7.5Z"/><path d="M12 9v2"/><path d="M12 13v2"/>');
			case 'community':
				return svg('<path d="M5 8.5A3.5 3.5 0 0 1 8.5 5h7A3.5 3.5 0 0 1 19 8.5v4a3.5 3.5 0 0 1-3.5 3.5H11l-3.8 3v-3H8.5A3.5 3.5 0 0 1 5 12.5Z"/><path d="M12 8.5v4"/><path d="M10 10.5h4"/>');
			case 'folder':
				return svg('<path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h3l1.6 2H17a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5Z"/>');
			case 'badge':
				return svg('<circle cx="12" cy="8" r="3"/><path d="M9 16.5h6"/><path d="M7 19l3-1.5 2-5"/><path d="M17 19l-3-1.5-2-5"/>');
			case 'chart':
				return svg('<path d="M5 18.5h14"/><path d="M7.5 15.5v-3"/><path d="M12 15.5v-6"/><path d="M16.5 15.5v-8"/><path d="M7.5 12.5 12 9.5 16.5 7.5"/>');
			case 'settings':
				return svg('<circle cx="12" cy="12" r="3"/><path d="M12 4.5v2"/><path d="M12 17.5v2"/><path d="M4.5 12h2"/><path d="M17.5 12h2"/><path d="M6.7 6.7l1.4 1.4"/><path d="M15.9 15.9l1.4 1.4"/><path d="M17.3 6.7l-1.4 1.4"/><path d="M8.1 15.9l-1.4 1.4"/>');
			case 'brandMark':
				return svg('<path d="M6 17.8V6.2"/><path d="M6 6.2c2.3 2.1 3.8 4.2 4.6 6.2"/><path d="M10.6 12.4c.9-2.5 2.4-4.6 4.5-6.2"/><path d="M15.1 6.2v11.6"/><path d="M7.8 17.8h5.8"/><path d="M16.9 6.4 18.2 5"/><path d="M17.2 6.7 19 6.4"/>');
			case 'login':
				return svg('<circle cx="10" cy="8" r="3"/><path d="M4.8 18.2c1.5-2.8 3.3-4.2 5.2-4.2 1.3 0 2.5.5 3.6 1.6"/><path d="M14.5 12h5"/><path d="M17 9.5 19.5 12 17 14.5"/>');
			case 'profileMark':
			default:
				return svg('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 18.5c1.6-3 3.8-4.5 6.5-4.5s4.9 1.5 6.5 4.5"/>');
		}
	}

	function hasAnyRole(ctx: PCContext, roles: string[]): boolean {
		return Array.isArray(ctx.roles) && ctx.roles.some((r) => roles.includes(r));
	}

	function visibleFeatures(ctx: PCContext): FeatureItem[] {
		return featureItems.filter((item) => item.gate(ctx));
	}

	function roleLabels(roles: string[] | undefined): string[] {
		if (!Array.isArray(roles)) {
			return [];
		}
		return roles.map((role) => roleDefs.find((item) => item.id === role)?.name || role);
	}

	function showToast(msg: string): void {
		let el = document.getElementById('pc-toast') as HTMLDivElement | null;
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

	function getContextManager(): PCContextManager | null {
		const cls = window.UserContextManager as { getInstance?: () => PCContextManager } | undefined;
		return cls?.getInstance?.() ?? null;
	}

	function getContext(): PCContext {
		const manager = getContextManager();
		return manager ? manager.getUserContext() : { ...localContext };
	}

	function setContext(ctx: PCContext): void {
		const manager = getContextManager();
		if (manager) {
			manager.setUserContext(ctx);
		} else {
			localContext = ctx;
			window.dispatchEvent(new CustomEvent('userContextChanged', { detail: ctx }));
		}
	}

	async function loadUsers(): Promise<void> {
		if (allUsers.length > 0) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getUsersByRole !== 'function') {
			allUsers = [];
			return;
		}
		const roles = ['guest', 'student', 'teacher', 'reviewer', 'orgAdmin', 'systemAdmin', 'superAdmin'];
		const map = new Map<string, PCUser>();
		for (const role of roles) {
			try {
				// eslint-disable-next-line no-await-in-loop
				const users = (await api.getUsersByRole(role)) as Record<string, unknown>[];
				users.forEach((u) => {
					if (typeof u.id !== 'string') {
						return;
					}
					const subscriptionValue =
						u.subscription && typeof u.subscription === 'object'
							? (u.subscription as Record<string, unknown>)
							: null;
					map.set(u.id, {
						id: u.id,
						displayName:
							typeof u.display_name === 'string'
								? u.display_name
								: typeof u.displayName === 'string'
									? u.displayName
									: typeof u.username === 'string'
										? u.username
										: u.id,
						roleIds: Array.isArray(u.role_ids)
							? u.role_ids.filter((v): v is string => typeof v === 'string')
							: Array.isArray(u.roles)
								? u.roles.filter((v): v is string => typeof v === 'string')
								: Array.isArray(u.roleIds)
									? u.roleIds.filter((v): v is string => typeof v === 'string')
									: [],
						balance:
							u.balance && typeof u.balance === 'object'
								? {
										credits:
											typeof (u.balance as Record<string, unknown>).credits === 'number'
												? ((u.balance as Record<string, unknown>).credits as number)
												: 0,
										updatedAt:
											typeof (u.balance as Record<string, unknown>).updatedAt === 'string'
												? ((u.balance as Record<string, unknown>).updatedAt as string)
												: new Date().toISOString()
								  }
								: undefined,
						email: typeof u.email === 'string' ? u.email : undefined,
						avatar:
							typeof u.avatar_url === 'string'
								? u.avatar_url
								: typeof u.avatar === 'string'
									? u.avatar
									: null,
						lastLoginAt:
							typeof u.last_active_at === 'string'
								? u.last_active_at
								: typeof u.lastLoginAt === 'string'
									? u.lastLoginAt
									: undefined,
						status: typeof u.status === 'string' ? u.status : undefined,
						accessibleLevels: Array.isArray(u.accessible_levels)
							? u.accessible_levels.filter((v): v is string => typeof v === 'string')
							: Array.isArray(u.accessibleLevels)
								? u.accessibleLevels.filter((v): v is string => typeof v === 'string')
								: undefined,
						subscription: subscriptionValue
							? {
									plan: typeof subscriptionValue.plan === 'string' ? subscriptionValue.plan : 'free',
									status: typeof subscriptionValue.status === 'string' ? subscriptionValue.status : 'active',
									expiresAt: typeof subscriptionValue.expires_at === 'string' ? subscriptionValue.expires_at : ''
							  }
							: undefined,
						scopeType: typeof u.scope_type === 'string' ? u.scope_type : undefined,
						organizationType: typeof u.organization_type === 'string' ? u.organization_type : undefined
					});
				});
			} catch (error) {
				log('load role users failed', role, error);
			}
		}
		allUsers = Array.from(map.values());
	}

	function planLabel(plan: string | undefined): string {
		if (!plan) {
			return 'free';
		}
		return plan.toUpperCase();
	}

	function scopeLabel(ctx: PCContext): string {
		if (ctx.organizationType === 'business') {
			return '企业空间';
		}
		if (ctx.organizationType === 'school') {
			return '学校空间';
		}
		if (ctx.scopeType === 'organization') {
			return '组织空间';
		}
		return '知识就是力量';
	}

	function openLoginModal(): void {
		if (window.__openLoginModal) {
			window.__openLoginModal();
			return;
		}
		const trigger = document.getElementById('login-entry-btn') as HTMLButtonElement | null;
		trigger?.click();
	}

	function ensureRoot(): HTMLDivElement {
		let root = document.getElementById('personal-center') as HTMLDivElement | null;
		if (root) {
			return root;
		}
		root = document.createElement('div');
		root.id = 'personal-center';
		root.className = 'pc-hidden';
		root.innerHTML = DEFAULT_TEMPLATE;
		root.addEventListener('click', (e) => {
			const t = e.target as HTMLElement | null;
			if (t?.dataset.action === 'pc-close') {
				closePanel();
				return;
			}
			if (t?.dataset.action === 'pc-logout') {
				window.logoutUser?.();
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

	function isOpen(): boolean {
		const root = document.getElementById('personal-center');
		return Boolean(root?.classList.contains('pc-open'));
	}

	function openPanel(): void {
		const root = ensureRoot();
		root.classList.remove('pc-hidden');
		root.classList.add('pc-open');
		void renderIdentity();
		renderSections();
		renderSectionContent();
	}

	function closePanel(): void {
		const root = document.getElementById('personal-center');
		if (!root) {
			return;
		}
		root.classList.remove('pc-open');
		root.classList.add('pc-hidden');
	}

	async function buildTrigger(): Promise<void> {
		let trigger = document.getElementById('user-menu-trigger') as HTMLDivElement | null;
		if (!trigger) {
			trigger = document.createElement('div');
			trigger.id = 'user-menu-trigger';
			trigger.className = 'pc-trigger';
			(document.getElementById('exam-workarea') || document.body).appendChild(trigger);
			trigger.onclick = () => {
				if (getContext().guest) {
					openLoginModal();
				} else {
					openPanel();
				}
			};
		}
		const ctx = getContext();
		trigger.innerHTML = renderOutlineIcon(ctx.guest ? 'profileMark' : 'brandMark', 'pc-trigger-icon');
		trigger.title = ctx.guest ? '登录账号' : `${preferredDisplayName(ctx)} - 打开个人中心`;
		trigger.setAttribute('aria-label', ctx.guest ? '登录账号' : '打开个人中心');
		if (DEBUG) {
			await loadUsers();
		}
	}

	function renderSections(): void {
		const nav = document.getElementById('pc-nav');
		if (!nav) {
			return;
		}
		const ctx = getContext();
		const visibleSections = sections.filter((s) => s.gate(ctx) && s.nav !== false);
		nav.innerHTML = visibleSections
			.map((s) => `<button class="pc-nav-item${s.id === activeSection ? ' active' : ''}" data-sec="${s.id}">${s.title}</button>`)
			.join('');
		nav.style.display = visibleSections.length > 1 ? 'flex' : 'none';
		nav.onclick = (e) => {
			const t = e.target as HTMLElement | null;
			const btn = t?.closest('button.pc-nav-item') as HTMLButtonElement | null;
			if (!btn) {
				return;
			}
			activeSection = btn.dataset.sec as SectionDef['id'];
			renderSections();
			renderSectionContent();
		};
	}

	async function renderIdentity(): Promise<void> {
		const ctx = getContext();
		const nameEl = document.getElementById('pc-name');
		const rolesEl = document.getElementById('pc-roles');
		const avatarEl = document.getElementById('pc-avatar');
		const overviewEl = document.getElementById('pc-header-overview');
		const footerActionsEl = document.getElementById('pc-footer-actions');
		if (!nameEl || !rolesEl || !avatarEl || !overviewEl) {
			return;
		}

		const subtitleParts = [
			scopeLabel(ctx),
			roleLabels(ctx.roles).slice(0, 2).join(' / ')
		].filter(Boolean);
		nameEl.textContent = ctx.guest ? '未登录' : preferredDisplayName(ctx);
		rolesEl.textContent = ctx.guest ? '登录后查看会员信息' : subtitleParts.join(' · ');
		overviewEl.innerHTML = renderHeaderOverview(ctx);
		if (footerActionsEl) {
			footerActionsEl.innerHTML = ctx.guest
				? ''
				: '<button class="pc-footer-action pc-logout-action" data-action="pc-logout">退出登录</button>';
		}

		if (ctx.guest || !ctx.avatar) {
			avatarEl.innerHTML = renderOutlineIcon(ctx.guest ? 'profileMark' : 'brandMark', 'pc-avatar-icon');
		} else {
			avatarEl.innerHTML = `<img class="pc-avatar-image" src="${escapeHtml(ctx.avatar)}" alt="avatar" />`;
		}

		const oldSwitch = nameEl.parentElement?.querySelector('select.pc-user-switch');
		oldSwitch?.remove();
		if (ctx.guest || !DEBUG) {
			return;
		}

		await loadUsers();

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
		} else {
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
				subscription: user.subscription,
				scopeType: user.scopeType,
				organizationType: user.organizationType,
				guest: false
			});
		};

		nameEl.parentElement?.appendChild(select);
	}

	function renderHeaderOverview(ctx: PCContext): string {
		const balance = ctx.balance?.credits ?? 0;
		const points = 0;
		const coupons = 0;
		const plan = planLabel(ctx.subscription?.plan);
		return `<div class="pc-overview-head">
			<div>
				<div class="pc-overview-title">账户概览</div>
				<div class="pc-overview-subtitle">余额、积分与卡券汇总</div>
			</div>
			<div class="pc-plan-badge">${plan}</div>
		</div>
		<div class="pc-summary-stats">
			<div class="pc-summary-stat">
				<span>余额</span>
				<strong>¥${balance}</strong>
			</div>
			<div class="pc-summary-stat">
				<span>积分</span>
				<strong>${points}</strong>
			</div>
			<div class="pc-summary-stat">
				<span>卡券</span>
				<strong>${coupons} 张</strong>
			</div>
		</div>`;
	}

	function renderDashboard(ctx: PCContext): string {
		const features = visibleFeatures(ctx);
		const displayName = preferredDisplayName(ctx);
		const email = escapeHtml(ctx.email || '未绑定');
		const lastLogin = escapeHtml(ctx.lastLoginAt || '暂无');
		return `<div class="pc-dashboard">
			<div class="pc-card pc-service-card">
				<div class="pc-service-grid">
					${features
						.map(
							(item) => `<button class="service-item" data-intent="${item.intent}" title="${escapeHtml(item.title)}">
								<div class="svc-icon">${renderOutlineIcon(item.icon, 'pc-service-icon')}</div>
								<div class="svc-title">${escapeHtml(item.title)}</div>
							</button>`
						)
						.join('')}
				</div>
			</div>
			<div class="pc-card pc-info-card">
				<div class="pc-service-header">账号信息</div>
				<div class="pc-info-list">
					<div class="pc-info-row"><span>昵称</span><strong>${escapeHtml(displayName)}</strong></div>
					<div class="pc-info-row"><span>UID</span><strong>${escapeHtml(ctx.id || '-')}</strong></div>
					<div class="pc-info-row"><span>邮箱</span><strong>${email}</strong></div>
					<div class="pc-info-row"><span>最近登录</span><strong>${lastLogin}</strong></div>
				</div>
			</div>
		</div>`;
	}

	function renderRoles(ctx: PCContext): string {
		const owned = ctx.roles || [];
		const ownedStr = escapeHtml(owned.join(', ') || '无');
		const isSuper = owned.includes('superAdmin');
		let extra = '';
		if (isSuper) {
			const rows = roleDefs
				.map(
					(role) => `<tr>
						<td>${escapeHtml(role.id)}</td>
						<td>${escapeHtml(role.name)}</td>
						<td>${escapeHtml(role.desc)}</td>
						<td><span class="risk-badge role-risk-${role.risk}">${role.risk}</span></td>
						<td>${owned.includes(role.id) ? '<span class="role-owned">✔</span>' : ''}</td>
					</tr>`
				)
				.join('');
			const blocks = roleDefs
				.map((role) => {
					const users = allUsers.filter((u) => u.roleIds.includes(role.id));
					if (users.length === 0) {
						return '';
					}
					const list = users
						.slice(0, 5)
						.map(
							(u) => `<li data-impersonate="${escapeHtml(u.id)}" title="切换为该用户">
								<span class="ru-name">${escapeHtml(u.displayName)}</span>
								<span class="ru-id">${escapeHtml(u.id)}</span>
							</li>`
						)
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

	function renderProfileCard(ctx: PCContext): string {
		const roleNames = roleLabels(ctx.roles);
		const explicitDisplayName = (ctx.displayName || '').trim();
		const fallbackName = deriveFallbackDisplayName(ctx);
		const currentName = preferredDisplayName(ctx);
		return `<div class="pc-profile-stack">
			<div class="pc-profile-toolbar">
				<button class="pc-text-link pc-profile-back" data-profile-back>返回我的</button>
			</div>
			<div class="pc-card pc-info-card pc-avatar-picker-card">
				<div class="pc-service-header">头像选择</div>
				<div class="pc-avatar-picker-note">提供 14 组可选头像，选择后会保存到当前账号资料。</div>
				<div class="pc-avatar-picker-grid">
					${avatarPresets
						.map((preset) => {
							const active = (ctx.avatar || '') === preset.avatarUrl;
							const preview = preset.avatarUrl
								? `<img class="pc-avatar-choice-image" src="${preset.avatarUrl}" alt="${escapeHtml(preset.label)}" />`
								: `<span class="pc-avatar-choice-fallback">${renderOutlineIcon('profileMark', 'pc-avatar-choice-icon')}</span>`;
							return `<button class="pc-avatar-choice${active ? ' active' : ''}" data-avatar-id="${preset.id}" data-avatar-url="${preset.avatarUrl}" title="${escapeHtml(`${preset.label} / ${preset.role}`)}">
								<span class="pc-avatar-choice-preview">${preview}</span>
								<span class="pc-avatar-choice-name">${escapeHtml(preset.label)}</span>
								<span class="pc-avatar-choice-role">${escapeHtml(preset.role)}</span>
							</button>`;
						})
						.join('')}
				</div>
			</div>
			<div class="pc-card pc-info-card">
				<div class="pc-service-header">基础资料</div>
				<div class="pc-profile-edit-row">
					<label class="pc-profile-edit-label" for="pc-display-name-input">昵称</label>
					<div class="pc-profile-edit-inline">
						<input class="pc-profile-input" id="pc-display-name-input" type="text" maxlength="32" value="${escapeHtml(explicitDisplayName || fallbackName)}" placeholder="${escapeHtml(fallbackName)}" />
						<button class="pc-inline-btn" data-save-display-name>保存</button>
					</div>
					<div class="pc-avatar-picker-note">未设置时会先按账号生成默认昵称，你也可以改成自己的名字。</div>
				</div>
				<div class="pc-info-list">
					<div class="pc-info-row"><span>当前昵称</span><strong>${escapeHtml(currentName)}</strong></div>
					<div class="pc-info-row"><span>UID</span><strong>${escapeHtml(ctx.id || '-')}</strong></div>
					<div class="pc-info-row"><span>邮箱</span><strong>${escapeHtml(ctx.email || '未绑定')}</strong></div>
					<div class="pc-info-row"><span>最近登录</span><strong>${escapeHtml(ctx.lastLoginAt || '-')}</strong></div>
				</div>
			</div>
			<div class="pc-card pc-info-card">
				<div class="pc-service-header">身份与套餐</div>
				<div class="pc-tag-list">
					${roleNames.length > 0 ? roleNames.map((role) => `<span class="pc-tag">${escapeHtml(role)}</span>`).join('') : '<span class="pc-tag muted">普通用户</span>'}
				</div>
				<div class="pc-info-list">
					<div class="pc-info-row"><span>当前空间</span><strong>${escapeHtml(scopeLabel(ctx))}</strong></div>
					<div class="pc-info-row"><span>当前套餐</span><strong>${escapeHtml(planLabel(ctx.subscription?.plan))} / ${escapeHtml(ctx.subscription?.status || 'active')}</strong></div>
					<div class="pc-info-row"><span>到期时间</span><strong>${escapeHtml(ctx.subscription?.expiresAt || '长期')}</strong></div>
				</div>
			</div>
		</div>`;
	}

	async function saveSelectedAvatar(avatarUrl: string): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后再选择头像');
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.updateProfile !== 'function') {
			showToast('头像保存接口暂不可用');
			return;
		}
		try {
			await api.updateProfile(ctx.id, { avatar_url: avatarUrl });
			setContext({ ...ctx, avatar: avatarUrl || null });
			syncStoredProfilePatch({ avatarUrl });
			await renderIdentity();
			renderSectionContent();
			showToast(avatarUrl ? '头像已更新' : '已恢复默认头像');
		} catch (error) {
			log('save avatar failed', error);
			showToast('头像保存失败');
		}
	}

	async function saveDisplayName(inputValue: string): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后再设置昵称');
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.updateProfile !== 'function') {
			showToast('昵称保存接口暂不可用');
			return;
		}
		const nextDisplayName = inputValue.trim() || deriveFallbackDisplayName(ctx);
		if (nextDisplayName === (ctx.displayName || '').trim()) {
			showToast('昵称没有变化');
			return;
		}
		try {
			await api.updateProfile(ctx.id, { display_name: nextDisplayName });
			setContext({ ...ctx, displayName: nextDisplayName });
			syncStoredProfilePatch({ displayName: nextDisplayName });
			void buildTrigger();
			await renderIdentity();
			renderSectionContent();
			showToast('昵称已保存');
		} catch (error) {
			log('save display name failed', error);
			showToast('昵称保存失败');
		}
	}

	function attachProfileHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const backBtn = target?.closest('[data-profile-back]') as HTMLButtonElement | null;
			if (backBtn) {
				activeSection = 'dashboard';
				renderSections();
				renderSectionContent();
				return;
			}
			const saveBtn = target?.closest('[data-save-display-name]') as HTMLButtonElement | null;
			if (saveBtn) {
				const input = container.querySelector('#pc-display-name-input') as HTMLInputElement | null;
				void saveDisplayName(input?.value || '');
				return;
			}
			const choice = target?.closest('button[data-avatar-id]') as HTMLButtonElement | null;
			if (!choice) {
				return;
			}
			const avatarUrl = choice.dataset.avatarUrl || '';
			void saveSelectedAvatar(avatarUrl);
		};
		container.onkeydown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.key !== 'Enter' || target?.id !== 'pc-display-name-input') {
				return;
			}
			event.preventDefault();
			void saveDisplayName((target as HTMLInputElement).value || '');
		};
	}

	function renderSystemFlags(): string {
		const maintenanceOn = systemFlags.find((f) => f.key === 'maintenanceMode')?.value ?? false;
		const rows = systemFlags
			.map(
				(f) => `<tr>
					<td class="sf-key">${escapeHtml(f.key)}</td>
					<td class="sf-desc">${escapeHtml(f.desc)}</td>
					<td class="sf-val"><span class="flag-val ${f.value ? 'on' : 'off'}">${f.value ? 'ON' : 'OFF'}</span></td>
					<td class="sf-risk"><span class="risk-badge risk-${f.risk}">${f.risk}</span></td>
					<td class="sf-act"><button class="sf-toggle" data-flag="${f.key}" data-risk="${f.risk}">${f.value ? '关闭' : '开启'}</button></td>
				</tr>`
			)
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

	function handleFeatureIntent(intent: string): void {
		switch (intent) {
			case 'gotoProfile':
				activeSection = 'profile';
				renderSections();
				renderSectionContent();
				break;
			case 'openSystemFlags':
			case 'openQuestionManager':
			case 'openRoleApprovals':
			case 'openStats':
				activeSection = 'admin-hub';
				renderSections();
				renderSectionContent();
				break;
			case 'openRecharge':
			case 'openRedeem':
			case 'openCoupons':
			case 'joinCommunity':
				showToast(`功能占位: ${intent}`);
				break;
			default:
				showToast(`未识别 intent: ${intent}`);
				break;
		}
	}

	function attachDashboardHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const fx = target?.closest('[data-fx]') as HTMLElement | null;
			if (fx) {
				showToast(`功能占位: ${fx.getAttribute('data-fx') || ''}`);
				return;
			}
			const serviceItem = target?.closest('button.service-item') as HTMLButtonElement | null;
			if (serviceItem) {
				handleFeatureIntent(serviceItem.dataset.intent || '');
			}
		};
	}

	function attachRolesHandlers(container: HTMLElement): void {
		const grid = container.querySelector('.role-users-grid');
		if (!grid) {
			return;
		}
		grid.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			const item = target?.closest('li[data-impersonate]') as HTMLLIElement | null;
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
				subscription: user.subscription,
				scopeType: user.scopeType,
				organizationType: user.organizationType,
				guest: false
			});
		});
	}

	function attachSystemFlagsHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
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

	function renderSectionContent(): void {
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
				container.innerHTML = renderProfileCard(ctx);
				attachProfileHandlers(container);
				break;
			case 'roles':
				container.innerHTML = renderProfileCard(ctx);
				attachProfileHandlers(container);
				break;
			case 'community':
				container.innerHTML = `<div class="pc-section"><h2>社群</h2><p>加入学习社群以获取更多资料。</p><p><button disabled>加入社群（占位）</button></p></div>`;
				break;
			case 'balance':
				container.innerHTML = `<div class="pc-section"><h2>账户</h2><p>余额：${ctx.balance?.credits ?? 0}</p><p><button disabled>充值（占位）</button></p></div>`;
				break;
			case 'admin-hub':
				container.innerHTML = `<div class="pc-section"><h2>管理面板</h2><p>当前空间：${escapeHtml(scopeLabel(ctx))}</p><p>当前角色：${escapeHtml((ctx.roles || []).join(', ') || '无')}</p><ul><li><button disabled>题目管理（占位）</button></li><li><button disabled>成员管理（占位）</button></li><li><button disabled>统计报表（占位）</button></li></ul></div>${hasAnyRole(ctx, ['superAdmin']) ? renderSystemFlags() : ''}`;
				if (hasAnyRole(ctx, ['superAdmin'])) {
					attachSystemFlagsHandlers(container);
				}
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

	function ensureRiskModal(): HTMLDivElement {
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
			const target = event.target as HTMLElement | null;
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

	function confirmRisk(title: string, word: string, onConfirm: () => void): void {
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
		const input = modal.querySelector('#risk-input') as HTMLInputElement | null;
		const ok = modal.querySelector('#risk-ok') as HTMLButtonElement | null;
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

	function openWechatModal(): void {
		openLoginModal();
	}

	function closeWechatModal(): void {
		if (wechatTimer !== null) {
			window.clearTimeout(wechatTimer);
			wechatTimer = null;
		}
	}

	window.setUserContext = (ctx: Record<string, unknown>) => {
		const next = ctx as unknown as PCContext;
		setContext({ ...next, guest: next.guest === true ? true : false });
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
		utils: { escapeHtml, showToast, hasAnyRole, visibleFeatures }
	};

	const init = () => {
		void buildTrigger();
	};
	if (document.readyState === 'complete' || document.readyState === 'interactive') {
		window.setTimeout(init, 0);
	} else {
		document.addEventListener('DOMContentLoaded', init);
	}
})();
