/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/


import type {
	PCBalance, PCSubscription, PCReferral, PCUser, PCContext, PCContextManager,
	ManagedOrganizationMember, ManagedOrganizationInvitation, PendingOrganizationInvitation,
	ManagedOrganizationAuditLog, ManagedOrganization, OrganizationMemberDraft,
	ContactVerificationDraft, ContactVerificationKind, SectionDef, SystemFlag,
	FeatureItem, RoleDef, AvatarPreset, AvatarPalette, AvatarSeed
} from './personalCenter/types.js';

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
		  <button class="pc-header-btn pc-header-back" id="pc-header-back" data-action="pc-back-home" aria-label="返回我的">返回我的</button>
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
			title: '续费',
			icon: 'wallet',
			intent: 'openRecharge',
			gate: (u) => !u.guest
		},
		{
			id: 'redeem',
			title: '兑换码',
			icon: 'gift',
			intent: 'openRedeem',
			gate: (u) => !u.guest
		},
		{
			id: 'coupons',
			title: '卡券包',
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

	const organizationMemberRoleDefs = roleDefs.filter((role) => ['student', 'teacher', 'reviewer', 'orgAdmin'].includes(role.id));

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
	let managedOrganizations: ManagedOrganization[] = [];
	let managedOrganizationsCacheKey = '';
	let managedOrganizationsLoading: Promise<void> | null = null;
	let organizationMemberDrafts: Record<string, OrganizationMemberDraft> = {};
	let organizationInviteTokenDraft = '';
	let referralCodeDraft = '';
	let contactVerificationDraft: ContactVerificationDraft = {
		email: '',
		emailCode: '',
		phone: '',
		phoneCode: '',
		changeChallengeChannel: '',
		changeChallengeCode: ''
	};
	let activeContactVerificationEditor: ContactVerificationKind | '' = '';
	let pendingInvitations: PendingOrganizationInvitation[] = [];
	let pendingInvitationsCacheKey = '';
	let pendingInvitationsLoading: Promise<void> | null = null;

	function escapeHtml(v: unknown): string {
		return String(v).replace(/[&<>'"`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;', '`': '&#96;' }[c] || c));
	}

	function svgToDataUri(svg: string): string {
		return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
	}

	function deriveFallbackDisplayName(ctx: PCContext): string {
		const username = (ctx.username || '').trim();
		if (username) {
			return username;
		}
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

	function asRecord(value: unknown): Record<string, unknown> | null {
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	}

	function readString(value: unknown): string | undefined {
		return typeof value === 'string' && value.trim() ? value : undefined;
	}

	function readBoolean(value: unknown): boolean | undefined {
		return typeof value === 'boolean' ? value : undefined;
	}

	function readNumber(value: unknown): number | undefined {
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	}

	function readCount(value: unknown): number | undefined {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === 'string' && value.trim()) {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : undefined;
		}
		return undefined;
	}

	function readStringArray(value: unknown): string[] | undefined {
		if (!Array.isArray(value)) {
			return undefined;
		}
		return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
	}

	function normalizeSubscription(value: unknown): PCSubscription | undefined {
		const raw = asRecord(value);
		if (!raw) {
			return undefined;
		}
		return {
			plan: readString(raw.plan) || 'free',
			status: readString(raw.status) || 'active',
			expiresAt: readString(raw.expiresAt) || readString(raw.expires_at) || '',
			seats: readCount(raw.seats)
		};
	}

	function normalizeReferral(value: unknown): PCReferral | undefined {
		const raw = asRecord(value);
		if (!raw) {
			return undefined;
		}
		const code = readString(raw.code) || readString(raw.referral_code) || '';
		return {
			code,
			hasReferrer: readBoolean(raw.hasReferrer) ?? readBoolean(raw.has_referrer) ?? Boolean(readString(raw.referredByCode) || readString(raw.referred_by_code)),
			referredByCode: readString(raw.referredByCode) || readString(raw.referred_by_code),
			boundAt: readString(raw.boundAt) || readString(raw.bound_at),
			rewardStatus: readString(raw.rewardStatus) || readString(raw.reward_status) || (code ? 'none' : undefined),
			rewardGrantedAt: readString(raw.rewardGrantedAt) || readString(raw.reward_granted_at),
			rewardCreditAmount: readCount(raw.rewardCreditAmount) ?? readCount(raw.reward_credit_amount),
			rewardCreditRecipientUserId: readString(raw.rewardCreditRecipientUserId) || readString(raw.reward_credit_recipient_user_id)
		};
	}

	function normalizeContext(ctx: PCContext | Record<string, unknown>): PCContext {
		const raw = ctx as Record<string, unknown>;
		const user = asRecord(raw.user);
		const profile = asRecord(raw.profile);
		const membership = asRecord(raw.membership);
		const normalizedSubscription =
			normalizeSubscription(raw.subscription) ?? normalizeSubscription(user?.subscription) ?? (ctx as PCContext).subscription;
		const balanceRecord = asRecord(raw.balance);
		const balance = balanceRecord
			? {
					credits: readNumber(balanceRecord.credits) ?? 0,
					updatedAt: readString(balanceRecord.updatedAt) || readString(balanceRecord.updated_at) || new Date().toISOString()
			  }
			: (ctx as PCContext).balance;
		const roles = Array.isArray(raw.roles)
			? raw.roles.filter((value): value is string => typeof value === 'string')
			: Array.isArray(raw.roleIds)
				? raw.roleIds.filter((value): value is string => typeof value === 'string')
				: Array.isArray(raw.role_ids)
					? raw.role_ids.filter((value): value is string => typeof value === 'string')
					: Array.isArray(user?.roles)
						? user.roles.filter((value): value is string => typeof value === 'string')
						: Array.isArray(user?.roleIds)
							? user.roleIds.filter((value): value is string => typeof value === 'string')
							: Array.isArray(user?.role_ids)
								? user.role_ids.filter((value): value is string => typeof value === 'string')
					: (ctx as PCContext).roles;
		const accessibleLevels = Array.isArray(raw.accessibleLevels)
			? raw.accessibleLevels.filter((value): value is string => typeof value === 'string')
			: Array.isArray(raw.accessible_levels)
				? raw.accessible_levels.filter((value): value is string => typeof value === 'string')
				: Array.isArray(user?.accessibleLevels)
					? user.accessibleLevels.filter((value): value is string => typeof value === 'string')
					: Array.isArray(user?.accessible_levels)
						? user.accessible_levels.filter((value): value is string => typeof value === 'string')
				: (ctx as PCContext).accessibleLevels;
		const subscriptionRecord = asRecord(raw.subscription) || asRecord(user?.subscription);
		const normalizedReferral = normalizeReferral(raw.referral) ?? normalizeReferral(user?.referral) ?? (ctx as PCContext).referral;
		const couponCount =
			readNumber(raw.couponCount) ??
			(Array.isArray(raw.coupons) ? raw.coupons.length : undefined) ??
			(subscriptionRecord && Array.isArray(subscriptionRecord.entitlements) ? subscriptionRecord.entitlements.length : 0);
		return {
			...(ctx as PCContext),
			guest: raw.guest === true,
			id: readString(raw.id) || readString(raw.user_id) || readString(user?.id) || readString(user?.user_id) || (ctx as PCContext).id,
			token: readString(raw.token) || (ctx as PCContext).token,
			displayName: readString(raw.displayName) || readString(raw.display_name) || readString(user?.displayName) || readString(user?.display_name) || (ctx as PCContext).displayName,
			username: readString(raw.username) || readString(user?.username) || readString(membership?.username) || (ctx as PCContext).username,
			memberNo:
				readString(raw.memberNo) ||
				readString(raw.member_no) ||
				readString(user?.memberNo) ||
				readString(user?.member_no) ||
				readString(membership?.memberNo) ||
				readString(membership?.member_no) ||
				(ctx as PCContext).memberNo,
			roles,
			balance,
			email: readString(raw.email) || readString(user?.email) || (ctx as PCContext).email,
			emailVerified: readBoolean(raw.email_verified) ?? readBoolean(user?.email_verified) ?? (ctx as PCContext).emailVerified,
			phone: readString(raw.phone) || readString(user?.phone) || (ctx as PCContext).phone,
			phoneVerified: readBoolean(raw.phone_verified) ?? readBoolean(user?.phone_verified) ?? (ctx as PCContext).phoneVerified,
			avatar:
				readString(raw.avatar) ||
				readString(raw.avatar_url) ||
				readString(user?.avatar) ||
				readString(user?.avatar_url) ||
				readString(profile?.avatar_url) ||
				(ctx as PCContext).avatar ||
				null,
			lastLoginAt:
				readString(raw.lastLoginAt) ||
				readString(raw.last_active_at) ||
				readString(user?.lastLoginAt) ||
				readString(user?.last_active_at) ||
				readString(profile?.last_active_at) ||
				(ctx as PCContext).lastLoginAt,
			status: readString(raw.status) || readString(user?.status) || (ctx as PCContext).status,
			accessibleLevels,
			subscription: normalizedSubscription,
			referral: normalizedReferral,
			xp: readNumber(raw.xp) ?? readNumber(user?.xp) ?? readNumber(profile?.xp) ?? (ctx as PCContext).xp,
			streakDays: readNumber(raw.streakDays) ?? readNumber(raw.streak_days) ?? readNumber(user?.streakDays) ?? readNumber(user?.streak_days) ?? readNumber(profile?.streak_days) ?? (ctx as PCContext).streakDays,
			couponCount,
			planExpiresAt:
				readString(raw.planExpiresAt) ||
				readString(raw.plan_expires_at) ||
				readString(user?.planExpiresAt) ||
				readString(user?.plan_expires_at) ||
				readString(profile?.plan_expires_at) ||
				normalizedSubscription?.expiresAt ||
				(ctx as PCContext).planExpiresAt,
			scopeType: readString(raw.scopeType) || readString(raw.scope_type) || readString(user?.scopeType) || readString(user?.scope_type) || (ctx as PCContext).scopeType,
			organizationId:
				readString(raw.organizationId) ||
				readString(raw.organization_id) ||
				readString(user?.organizationId) ||
				readString(user?.organization_id) ||
				readString(membership?.organizationId) ||
				readString(membership?.organization_id) ||
				(readString(raw.scope_type) === 'organization' ? readString(raw.scope_id) : undefined) ||
				(ctx as PCContext).organizationId,
			organizationName:
				readString(raw.organizationName) ||
				readString(raw.organization_name) ||
				readString(user?.organizationName) ||
				readString(user?.organization_name) ||
				readString(membership?.organizationName) ||
				readString(membership?.organization_name) ||
				(ctx as PCContext).organizationName,
			organizationType:
				readString(raw.organizationType) || readString(raw.organization_type) || readString(user?.organizationType) || readString(user?.organization_type) || (ctx as PCContext).organizationType
		};
	}

	function inviteTokenFromUrl(): string {
		try {
			const params = new URLSearchParams(window.location.search);
			return params.get('invite_token')?.trim() || params.get('invite_code')?.trim() || '';
		} catch {
			return '';
		}
	}

	function referralCodeFromUrl(): string {
		try {
			const params = new URLSearchParams(window.location.search);
			return (params.get('ref') || params.get('referral_code') || '').trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
		} catch {
			return '';
		}
	}

	function seedContactVerificationDraft(ctx: PCContext): void {
		if (!contactVerificationDraft.email) {
			contactVerificationDraft.email = ctx.email || '';
		}
		if (!contactVerificationDraft.phone) {
			contactVerificationDraft.phone = ctx.phone || '';
		}
	}

	function availableContactChangeChannels(ctx: PCContext): ContactVerificationKind[] {
		const channels: ContactVerificationKind[] = [];
		if (ctx.emailVerified && (ctx.email || '').trim()) {
			channels.push('email');
		}
		if (ctx.phoneVerified && (ctx.phone || '').trim()) {
			channels.push('phone');
		}
		return channels;
	}

	function requiresContactChangeChallenge(ctx: PCContext, kind: ContactVerificationKind, nextValue: string): boolean {
		const currentValue = (kind === 'email' ? ctx.email : ctx.phone) || '';
		if (availableContactChangeChannels(ctx).length === 0) {
			return false;
		}
		return nextValue.trim() !== currentValue.trim();
	}

	function contactChangeChannelLabel(channel: ContactVerificationKind): string {
		return channel === 'email' ? '当前邮箱' : '当前手机号';
	}

	function remainingDaysLabel(ctx: PCContext): string {
		const expiresAt = (ctx.planExpiresAt || ctx.subscription?.expiresAt || '').trim();
		if (!expiresAt) {
			return ctx.subscription?.status === 'expired' ? '0 天' : '长期';
		}
		const expiresAtMs = Date.parse(expiresAt);
		if (Number.isNaN(expiresAtMs)) {
			return '长期';
		}
		return `${Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 86400000))} 天`;
	}

	function triggerMonogram(ctx: PCContext): string {
		const text = preferredDisplayName(ctx).trim();
		if (!text) {
			return '我';
		}
		const [first = '我'] = Array.from(text);
		return /^[A-Za-z0-9]$/.test(first) ? first.toUpperCase() : first;
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

	function buildEmojiAvatarSvg(label: string, emoji: string, background: string, accent: string): string {
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${label}">
			<rect width="96" height="96" rx="24" fill="${background}"/>
			<circle cx="76" cy="20" r="10" fill="${accent}" opacity="0.14"/>
			<circle cx="18" cy="78" r="14" fill="${accent}" opacity="0.1"/>
			<rect x="12" y="12" width="72" height="72" rx="22" fill="#fff" opacity="0.82"/>
			<text x="48" y="55" text-anchor="middle" font-size="36" font-family="'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
		</svg>`;
	}

	function buildAvatarPresets(): AvatarPreset[] {
		const presets = [
			{ id: 'student-female', label: '女学生', role: '学生', emoji: '👩‍🎓', background: '#eef4ff', accent: '#5b7cf1' },
			{ id: 'student-male', label: '男学生', role: '学生', emoji: '👨‍🎓', background: '#edf7ff', accent: '#4e8dda' },
			{ id: 'teacher-female', label: '女教师', role: '教师', emoji: '👩‍🏫', background: '#fff3ea', accent: '#cb8c4a' },
			{ id: 'teacher-male', label: '男教师', role: '教师', emoji: '👨‍🏫', background: '#fff6e7', accent: '#b98743' },
			{ id: 'admin-female', label: '女管理员', role: '管理员', emoji: '👩‍💼', background: '#f4f1ff', accent: '#7f6ad6' },
			{ id: 'admin-male', label: '男管理员', role: '管理员', emoji: '👨‍💼', background: '#eff4f8', accent: '#71839a' },
			{ id: 'reviewer', label: '阅卷员', role: '阅卷', emoji: '🧑‍⚖️', background: '#fff0f6', accent: '#c86b93' },
			{ id: 'superadmin', label: '超级管理员', role: '超管', emoji: '👑', background: '#fff8e9', accent: '#cf9622' }
		];

		return [
			{ id: 'default', label: '默认', role: '系统', avatarUrl: '' },
			...presets.map((preset) => ({
				id: preset.id,
				label: preset.label,
				role: preset.role,
				avatarUrl: svgToDataUri(buildEmojiAvatarSvg(preset.label, preset.emoji, preset.background, preset.accent))
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
		return manager ? normalizeContext(manager.getUserContext()) : normalizeContext({ ...localContext });
	}

	function toPCUser(normalized: PCContext): PCUser {
		return {
			id: normalized.id || '',
			displayName: preferredDisplayName(normalized),
			username: normalized.username,
			memberNo: normalized.memberNo,
			roleIds: normalized.roles || [],
			balance: normalized.balance,
			email: normalized.email,
			emailVerified: normalized.emailVerified,
			phone: normalized.phone,
			phoneVerified: normalized.phoneVerified,
			avatar: normalized.avatar,
			lastLoginAt: normalized.lastLoginAt,
			status: normalized.status,
			accessibleLevels: normalized.accessibleLevels,
			subscription: normalized.subscription,
			xp: normalized.xp,
			streakDays: normalized.streakDays,
			couponCount: normalized.couponCount,
			planExpiresAt: normalized.planExpiresAt,
			scopeType: normalized.scopeType,
			organizationType: normalized.organizationType,
			organizationId: normalized.organizationId,
			organizationName: normalized.organizationName
		};
	}

	function setContext(ctx: PCContext): void {
		const normalized = normalizeContext(ctx);
		const manager = getContextManager();
		if (manager) {
			manager.setUserContext(normalized);
		} else {
			localContext = normalized;
			window.dispatchEvent(new CustomEvent('userContextChanged', { detail: normalized }));
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
					const normalized = normalizeContext({ ...u, guest: false });
					if (typeof normalized.id !== 'string' || !normalized.id) {
						return;
					}
					map.set(normalized.id, toPCUser(normalized));
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

	function organizationTypeLabel(value: string | undefined): string {
		if (value === 'business') {
			return '企业';
		}
		if (value === 'school') {
			return '学校';
		}
		return '组织';
	}

	function activeToken(ctx: PCContext): string {
		if (ctx.token && ctx.token.trim()) {
			return ctx.token.trim();
		}
		return (localStorage.getItem('exam_v2_token') || '').trim();
	}

	function managedOrganizationsKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function canManageMembers(ctx: PCContext): boolean {
		return hasAnyRole(ctx, ['orgAdmin', 'systemAdmin', 'superAdmin']);
	}

	function pendingInvitationsKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function invalidatePendingInvitations(): void {
		pendingInvitations = [];
		pendingInvitationsCacheKey = '';
		pendingInvitationsLoading = null;
	}

	function seedVerificationDraftFromPendingInvitations(): void {
		const emailInvitation = pendingInvitations.find((item) => item.channel === 'email' && !item.canAccept);
		if (emailInvitation && !contactVerificationDraft.email) {
			contactVerificationDraft.email = emailInvitation.contact;
		}
		const phoneInvitation = pendingInvitations.find((item) => item.channel === 'phone' && !item.canAccept);
		if (phoneInvitation && !contactVerificationDraft.phone) {
			contactVerificationDraft.phone = phoneInvitation.contact;
		}
	}

	function normalizePendingInvitation(value: unknown): PendingOrganizationInvitation | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const invitationId = readString(raw.invitation_id) || '';
		const inviteToken = readString(raw.invite_token) || readString(raw.invite_code) || '';
		const organizationId = readString(raw.organization_id) || '';
		if (!invitationId || !inviteToken || !organizationId) {
			return null;
		}
		return {
			invitationId,
			inviteToken,
			organizationId,
			organizationName: readString(raw.organization_name) || '未命名组织',
			organizationType: readString(raw.organization_type),
			channel: (readString(raw.channel) || 'email') as 'email' | 'phone',
			contact: readString(raw.contact) || readString(raw.email) || readString(raw.phone) || '',
			roles: readStringArray(raw.roles) || ['student'],
			message: readString(raw.message) || '',
			createdAt: readString(raw.created_at) || '',
			expiresAt: readString(raw.expires_at) || '',
			createdByUsername: readString(raw.created_by_username) || readString(raw.created_by),
			deliveryStatus: readString(raw.delivery_status),
			deliveryProvider: readString(raw.delivery_provider),
			deliveredAt: readString(raw.delivered_at),
			contactMatches: readBoolean(raw.contact_matches) ?? false,
			contactVerified: readBoolean(raw.contact_verified) ?? false,
			canAccept: readBoolean(raw.can_accept) ?? false,
			isExpired: readBoolean(raw.is_expired) ?? false,
			acceptBlockCode: readString(raw.accept_block_code),
			acceptBlockMessage: readString(raw.accept_block_message),
			acceptUrl: readString(raw.accept_url)
		};
	}

	async function ensurePendingInvitations(ctx: PCContext): Promise<void> {
		const cacheKey = pendingInvitationsKey(ctx);
		if (ctx.guest) {
			pendingInvitations = [];
			pendingInvitationsCacheKey = cacheKey;
			pendingInvitationsLoading = null;
			return;
		}

		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getMyPendingOrganizationInvitations !== 'function') {
			pendingInvitations = [];
			pendingInvitationsCacheKey = cacheKey;
			pendingInvitationsLoading = null;
			return;
		}

		if (pendingInvitationsCacheKey === cacheKey) {
			if (pendingInvitationsLoading) {
				await pendingInvitationsLoading;
			}
			return;
		}

		pendingInvitationsCacheKey = cacheKey;
		pendingInvitationsLoading = (async () => {
			try {
				const values = (await api.getMyPendingOrganizationInvitations(token)) as unknown[];
				pendingInvitations = (Array.isArray(values) ? values : [])
					.map((item) => normalizePendingInvitation(item))
					.filter((item): item is PendingOrganizationInvitation => Boolean(item))
					.sort((left, right) => {
						if (left.canAccept !== right.canAccept) {
							return left.canAccept ? -1 : 1;
						}
						return right.createdAt.localeCompare(left.createdAt);
					});
				seedVerificationDraftFromPendingInvitations();
			} catch (error) {
				pendingInvitations = [];
				log('load pending invitations failed', error);
			} finally {
				pendingInvitationsLoading = null;
				if (activeSection === 'dashboard' && isOpen()) {
					renderSectionContent();
				}
			}
		})();

		await pendingInvitationsLoading;
	}

	function getOrganizationMemberDraft(organizationId: string): OrganizationMemberDraft {
		if (!organizationMemberDrafts[organizationId]) {
			organizationMemberDrafts[organizationId] = {
				searchQuery: '',
				searchResults: [],
				selectedUserId: '',
				memberNo: '',
				batchText: '',
				inviteContact: '',
				inviteMemberNo: '',
				inviteMessage: ''
			};
		}
		return organizationMemberDrafts[organizationId];
	}

	function resetOrganizationMemberDraft(organizationId: string): void {
		organizationMemberDrafts[organizationId] = {
			searchQuery: '',
			searchResults: [],
			selectedUserId: '',
			memberNo: '',
			batchText: '',
			inviteContact: '',
			inviteMemberNo: '',
			inviteMessage: ''
		};
	}

	function readErrorMessage(error: unknown, fallback: string): string {
		if (error instanceof Error && error.message.trim()) {
			return error.message.trim();
		}
		return fallback;
	}

	function formatDateTime(value: string | undefined): string {
		if (!value) {
			return '未设置';
		}
		const ts = Date.parse(value);
		return Number.isNaN(ts)
			? value
			: new Date(ts).toLocaleString('zh-CN', {
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false
			  });
	}

	function defaultSeatsForPlan(plan: string): number {
		switch (plan) {
			case 'pro':
				return 25;
			case 'ultra':
				return 100;
			case 'free':
			default:
				return 5;
		}
	}

	function subscriptionExpirySummary(expiresAt: string | undefined, status: string): string {
		if (!expiresAt) {
			return status === 'expired' ? '已过期' : '长期有效';
		}
		const ts = Date.parse(expiresAt);
		if (Number.isNaN(ts)) {
			return `到期时间 ${expiresAt}`;
		}
		const days = Math.ceil((ts - Date.now()) / 86400000);
		if (days < 0) {
			return `已于 ${Math.abs(days)} 天前到期`;
		}
		if (days <= 7) {
			return `${days} 天后到期，请尽快续期`;
		}
		return `${days} 天后到期`;
	}

	function invitationStatusLabel(status: string): string {
		switch (status) {
			case 'accepted':
				return '已接受';
			case 'cancelled':
				return '已取消';
			case 'pending':
			default:
				return '待接受';
		}
	}

	function auditDetailSummary(value: unknown): string {
		const details = asRecord(value);
		if (!details) {
			return '';
		}
		const pieces = [
			readString(details.username),
			readString(details.contact),
			Array.isArray(details.roles) ? (details.roles as unknown[]).filter((item): item is string => typeof item === 'string').join(' / ') : '',
			readString(details.plan),
			readString(details.status),
			readString(details.expires_at)
		].filter(Boolean);
		return pieces.join(' · ');
	}

	async function refreshCurrentContextFromApi(): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getMeContext !== 'function') {
			return;
		}
		try {
			const next = (await api.getMeContext(token)) as Record<string, unknown>;
			const normalized = normalizeContext({
				...(asRecord(next.user) || {}),
				profile: next.profile,
				membership: next.membership,
				subscription: next.subscription,
				permissions: next.permissions,
				session: next.session,
				memberships: next.memberships,
				organizations: next.organizations,
				token,
				guest: false
			});
			setContext(normalized);
			seedContactVerificationDraft(normalized);
			await renderIdentity();
			void buildTrigger();
		} catch (error) {
			log('refresh context failed', error);
		}
	}

	async function sendEmailVerificationCode(email: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedEmail = email.trim();
		if (!token || !api || typeof api.sendEmailVerificationCode !== 'function') {
			showToast('邮箱验证接口暂不可用');
			return;
		}
		if (!normalizedEmail) {
			showToast('请先输入邮箱');
			return;
		}
		try {
			await api.sendEmailVerificationCode(token, normalizedEmail);
			contactVerificationDraft.email = normalizedEmail;
			showToast('邮箱验证码已发送');
		} catch (error) {
			log('send email verification failed', error);
			showToast(readErrorMessage(error, '邮箱验证码发送失败'));
		}
	}

	async function sendContactChangeChallenge(channel: ContactVerificationKind): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.sendContactChangeChallenge !== 'function') {
			showToast('修改前确认接口暂不可用');
			return;
		}
		try {
			await api.sendContactChangeChallenge(token, channel);
			contactVerificationDraft.changeChallengeChannel = channel;
			contactVerificationDraft.changeChallengeCode = '';
			showToast(channel === 'email' ? '确认码已发送到当前邮箱' : '确认码已发送到当前手机号');
		} catch (error) {
			log('send contact change challenge failed', error);
			showToast(readErrorMessage(error, '修改前确认验证码发送失败'));
		}
	}

	async function verifyEmailAddress(email: string, code: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedEmail = email.trim();
		const normalizedCode = code.trim();
		if (!token || !api || typeof api.verifyEmail !== 'function') {
			showToast('邮箱验证接口暂不可用');
			return;
		}
		if (!normalizedEmail || !normalizedCode) {
			showToast('请输入邮箱和验证码');
			return;
		}
		try {
			await api.verifyEmail(token, normalizedEmail, normalizedCode, {
				changeChallengeChannel: contactVerificationDraft.changeChallengeChannel || undefined,
				changeChallengeCode: contactVerificationDraft.changeChallengeCode.trim() || undefined
			});
			contactVerificationDraft.email = normalizedEmail;
			contactVerificationDraft.emailCode = '';
			contactVerificationDraft.changeChallengeChannel = '';
			contactVerificationDraft.changeChallengeCode = '';
			activeContactVerificationEditor = '';
			invalidatePendingInvitations();
			await refreshCurrentContextFromApi();
			await ensurePendingInvitations(getContext());
			renderSectionContent();
			showToast('邮箱已验证');
		} catch (error) {
			log('verify email failed', error);
			showToast(readErrorMessage(error, '邮箱验证失败'));
		}
	}

	async function sendPhoneVerificationCode(phone: string): Promise<void> {
		const api = window.APIClient;
		const normalizedPhone = phone.trim();
		if (!api || typeof api.sendPhoneVerificationCode !== 'function') {
			showToast('手机号验证接口暂不可用');
			return;
		}
		if (!normalizedPhone) {
			showToast('请先输入手机号');
			return;
		}
		try {
			await api.sendPhoneVerificationCode(normalizedPhone);
			contactVerificationDraft.phone = normalizedPhone;
			showToast('手机验证码已发送');
		} catch (error) {
			log('send phone verification failed', error);
			showToast(readErrorMessage(error, '手机验证码发送失败'));
		}
	}

	async function verifyPhoneNumber(phone: string, code: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedPhone = phone.trim();
		const normalizedCode = code.trim();
		if (!token || !api || typeof api.verifyPhone !== 'function') {
			showToast('手机号验证接口暂不可用');
			return;
		}
		if (!normalizedPhone || !normalizedCode) {
			showToast('请输入手机号和验证码');
			return;
		}
		try {
			await api.verifyPhone(token, normalizedPhone, normalizedCode, {
				changeChallengeChannel: contactVerificationDraft.changeChallengeChannel || undefined,
				changeChallengeCode: contactVerificationDraft.changeChallengeCode.trim() || undefined
			});
			contactVerificationDraft.phone = normalizedPhone;
			contactVerificationDraft.phoneCode = '';
			contactVerificationDraft.changeChallengeChannel = '';
			contactVerificationDraft.changeChallengeCode = '';
			activeContactVerificationEditor = '';
			invalidatePendingInvitations();
			await refreshCurrentContextFromApi();
			await ensurePendingInvitations(getContext());
			renderSectionContent();
			showToast('手机号已验证');
		} catch (error) {
			log('verify phone failed', error);
			showToast(readErrorMessage(error, '手机号验证失败'));
		}
	}

	function isOrganizationSeatFull(organization: ManagedOrganization, pendingAdds = 0): boolean {
		return organization.seats > 0 && organization.memberCount + pendingAdds >= organization.seats;
	}

	function organizationSeatSummary(organization: ManagedOrganization): string {
		if (organization.seats <= 0) {
			return `当前 ${organization.memberCount} 人，席位不限。`;
		}
		const remaining = Math.max(0, organization.seats - organization.memberCount);
		return `当前 ${organization.memberCount}/${organization.seats} 席，剩余 ${remaining} 席。`;
	}

	function normalizeOrganizationRoleToken(value: string): string | undefined {
		const normalized = value.trim().toLowerCase();
		if (!normalized) {
			return undefined;
		}
		const aliasMap: Record<string, string> = {
			student: 'student',
			学生: 'student',
			teacher: 'teacher',
			教师: 'teacher',
			reviewer: 'reviewer',
			阅卷: 'reviewer',
			阅卷员: 'reviewer',
			orgadmin: 'orgAdmin',
			admin: 'orgAdmin',
			管理员: 'orgAdmin',
			组织管理员: 'orgAdmin'
		};
		return aliasMap[normalized];
	}

	function normalizeOrganizationImportRoles(input: string): string[] {
		const tokens = input
			.split(/[|/、;；\s]+/)
			.map((token) => normalizeOrganizationRoleToken(token))
			.filter((token): token is string => Boolean(token));
		return Array.from(new Set(tokens));
	}

	function userSearchKeys(user: PCUser): string[] {
		return [user.id, user.username || '', user.displayName || '', user.email || '', user.memberNo || '']
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean);
	}

	function pickSearchCandidate(users: PCUser[], query: string): PCUser | undefined {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) {
			return undefined;
		}
		return users.find((user) => userSearchKeys(user).includes(normalizedQuery)) || (users.length === 1 ? users[0] : undefined);
	}

	function invalidateManagedOrganizations(): void {
		managedOrganizations = [];
		managedOrganizationsCacheKey = '';
		managedOrganizationsLoading = null;
	}

	function organizationMemberNoLabel(organizationType: string | undefined): string {
		return organizationType === 'school' ? '学号 / 成员号' : '工号 / 成员号';
	}

	function organizationMemberDisplayName(member: ManagedOrganizationMember): string {
		return allUsers.find((user) => user.id === member.userId)?.displayName || member.username;
	}

	function availableUsersForOrganization(organization: ManagedOrganization): PCUser[] {
		const memberIds = new Set(organization.members.map((member) => member.userId));
		return allUsers
			.filter((user) => !memberIds.has(user.id))
			.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
	}

	async function searchOrganizationCandidates(organization: ManagedOrganization, query: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const draft = getOrganizationMemberDraft(organization.id);
		draft.searchQuery = query;
		if (!token || !api || typeof api.searchUsers !== 'function') {
			showToast('用户搜索接口暂不可用');
			return;
		}

		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			draft.searchResults = [];
			draft.selectedUserId = '';
			renderSectionContent();
			return;
		}

		try {
			const memberIds = new Set(organization.members.map((member) => member.userId));
			const values = (await api.searchUsers(token, trimmedQuery, 12)) as Record<string, unknown>[];
			const candidates = Array.from(
				new Map(
					values
						.map((value) => normalizeContext({ ...value, guest: false }))
						.map((normalized) => toPCUser(normalized))
						.filter((user) => user.id && !memberIds.has(user.id))
						.map((user) => [user.id, user] as const)
				).values()
			);
			draft.searchResults = candidates;
			draft.selectedUserId = pickSearchCandidate(candidates, trimmedQuery)?.id || '';
			renderSectionContent();
			showToast(candidates.length > 0 ? `找到 ${candidates.length} 个候选账号` : '未找到可添加的账号');
		} catch (error) {
			log('search organization candidates failed', organization.id, trimmedQuery, error);
			showToast(readErrorMessage(error, '用户搜索失败'));
		}
	}

	async function persistOrganizationMembership(
		organization: ManagedOrganization,
		userId: string,
		roles: string[],
		memberNo: string
	): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationMember !== 'function') {
			throw new Error('成员管理接口暂不可用');
		}
		await api.saveOrganizationMember(organization.id, token, buildOrganizationMemberPayload(organization, userId.trim(), roles, memberNo));
	}

	async function refreshManagedOrganizations(): Promise<void> {
		const ctx = getContext();
		invalidateManagedOrganizations();
		await ensureManagedOrganizations(ctx);
		renderSectionContent();
	}

	function renderOrganizationRoleControls(selectedRoles: string[], name: string): string {
		const roleSet = new Set(selectedRoles.length > 0 ? selectedRoles : ['student']);
		return organizationMemberRoleDefs
			.map(
				(role) => `<label class="pc-role-toggle"><input type="checkbox" data-org-role name="${escapeHtml(name)}" value="${escapeHtml(role.id)}"${roleSet.has(role.id) ? ' checked' : ''} /><span>${escapeHtml(role.name)}</span></label>`
			)
			.join('');
	}

	function readOrganizationRoles(scope: ParentNode): string[] {
		const allowed = new Set(organizationMemberRoleDefs.map((role) => role.id));
		return Array.from(scope.querySelectorAll('input[data-org-role]:checked'))
			.map((input) => ((input as HTMLInputElement).value || '').trim())
			.filter((value): value is string => Boolean(value) && allowed.has(value));
	}

	function buildOrganizationMemberPayload(
		organization: ManagedOrganization,
		userId: string,
		roles: string[],
		memberNo: string
	): Record<string, unknown> {
		const normalizedMemberNo = memberNo.trim();
		const payload: Record<string, unknown> = {
			user_id: userId,
			roles
		};
		if (normalizedMemberNo) {
			payload.member_no = normalizedMemberNo;
			if (organization.organizationType === 'school') {
				payload.student_no = normalizedMemberNo;
			} else if (organization.organizationType === 'business') {
				payload.employee_no = normalizedMemberNo;
			}
		}
		return payload;
	}

	async function saveOrganizationMembership(
		organization: ManagedOrganization,
		userId: string,
		roles: string[],
		memberNo: string,
		successMessage: string
	): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationMember !== 'function') {
			showToast('成员管理接口暂不可用');
			return;
		}
		if (!userId.trim()) {
			showToast('请先选择成员');
			return;
		}
		if (roles.length === 0) {
			showToast('至少选择一个成员角色');
			return;
		}
		if (isOrganizationSeatFull(organization) && !organization.members.some((member) => member.userId === userId.trim())) {
			showToast('当前组织席位已满，请先释放席位');
			return;
		}
		try {
			await persistOrganizationMembership(organization, userId, roles, memberNo);
			resetOrganizationMemberDraft(organization.id);
			await refreshManagedOrganizations();
			showToast(successMessage);
		} catch (error) {
			log('save organization member failed', organization.id, userId, error);
			showToast(readErrorMessage(error, '成员保存失败'));
		}
	}

	async function removeOrganizationMembership(organization: ManagedOrganization, member: ManagedOrganizationMember): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.removeOrganizationMember !== 'function') {
			showToast('成员移除接口暂不可用');
			return;
		}
		const memberLabel = organizationMemberDisplayName(member);
		if (!window.confirm(`确认将 ${memberLabel} 移出 ${organization.name} 吗？`)) {
			return;
		}
		try {
			await api.removeOrganizationMember(organization.id, member.userId, token);
			await refreshManagedOrganizations();
			showToast('成员已移除');
		} catch (error) {
			log('remove organization member failed', organization.id, member.userId, error);
			showToast(readErrorMessage(error, '成员移除失败'));
		}
	}

	async function saveOrganizationInvitation(
		organization: ManagedOrganization,
		contact: string,
		roles: string[],
		memberNo: string,
		message: string
	): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationInvitation !== 'function') {
			showToast('邀请接口暂不可用');
			return;
		}
		const normalizedContact = contact.trim();
		if (!normalizedContact) {
			showToast('请输入邮箱或手机号');
			return;
		}
		if (roles.length === 0) {
			showToast('至少选择一个邀请角色');
			return;
		}
		if (isOrganizationSeatFull(organization)) {
			showToast('当前组织席位已满，请先扩容后再发邀请');
			return;
		}
		try {
			await api.saveOrganizationInvitation(organization.id, token, {
				email: normalizedContact.includes('@') ? normalizedContact : '',
				phone: normalizedContact.includes('@') ? '' : normalizedContact,
				roles,
				member_no: memberNo.trim(),
				message: message.trim()
			});
			const draft = getOrganizationMemberDraft(organization.id);
			draft.inviteContact = '';
			draft.inviteMemberNo = '';
			draft.inviteMessage = '';
			await refreshManagedOrganizations();
			showToast('邀请已创建，系统会自动投递到目标邮箱或手机号');
		} catch (error) {
			log('save organization invitation failed', organization.id, error);
			showToast(readErrorMessage(error, '邀请创建失败'));
		}
	}

	async function cancelOrganizationInvitation(organization: ManagedOrganization, invitation: ManagedOrganizationInvitation): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.cancelOrganizationInvitation !== 'function') {
			showToast('取消邀请接口暂不可用');
			return;
		}
		if (!window.confirm(`确认取消发往 ${invitation.contact} 的邀请吗？`)) {
			return;
		}
		try {
			await api.cancelOrganizationInvitation(organization.id, invitation.invitationId, token);
			await refreshManagedOrganizations();
			showToast('邀请已取消');
		} catch (error) {
			log('cancel organization invitation failed', organization.id, invitation.invitationId, error);
			showToast(readErrorMessage(error, '取消邀请失败'));
		}
	}

	async function saveOrganizationSubscription(
		organization: ManagedOrganization,
		plan: string,
		status: string,
		seatsValue: string,
		expiresAtValue: string
	): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.updateOrganizationSubscription !== 'function') {
			showToast('套餐管理接口暂不可用');
			return;
		}
		const normalizedPlan = ['free', 'pro', 'ultra'].includes(plan) ? plan : 'free';
		const normalizedStatus = ['active', 'trial', 'expired', 'canceled'].includes(status) ? status : 'active';
		const parsedSeats = Number(seatsValue);
		const seats = Number.isFinite(parsedSeats) && parsedSeats > 0 ? Math.floor(parsedSeats) : defaultSeatsForPlan(normalizedPlan);
		if (seats < organization.memberCount) {
			showToast(`席位数不能少于当前成员数 ${organization.memberCount}`);
			return;
		}
		const expiresAt = expiresAtValue.trim()
			? new Date(`${expiresAtValue.trim()}T23:59:59Z`).toISOString()
			: '';
		try {
			await api.updateOrganizationSubscription(organization.id, token, {
				plan: normalizedPlan,
				status: normalizedStatus,
				seats,
				expires_at: expiresAt
			});
			await refreshManagedOrganizations();
			showToast('组织套餐与席位已更新');
		} catch (error) {
			log('save organization subscription failed', organization.id, error);
			showToast(readErrorMessage(error, '组织套餐更新失败'));
		}
	}

	async function acceptOrganizationInvitation(inviteToken: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.acceptOrganizationInvitation !== 'function') {
			showToast('接受邀请接口暂不可用');
			return;
		}
		const normalizedToken = inviteToken.trim();
		if (!normalizedToken) {
			showToast('邀请令牌不能为空');
			return;
		}
		try {
			await api.acceptOrganizationInvitation(token, normalizedToken);
			organizationInviteTokenDraft = '';
			invalidateManagedOrganizations();
			invalidatePendingInvitations();
			await refreshCurrentContextFromApi();
			await ensurePendingInvitations(getContext());
			renderSectionContent();
			showToast('已加入组织');
		} catch (error) {
			log('accept organization invitation failed', error);
			showToast(readErrorMessage(error, '接受邀请失败'));
		}
	}

	async function claimReferralCode(referralCode: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.claimReferralCode !== 'function') {
			showToast('推荐码绑定接口暂不可用');
			return;
		}
		const normalizedCode = referralCode.trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
		if (!normalizedCode) {
			showToast('请输入推荐码');
			return;
		}
		try {
			await api.claimReferralCode(token, normalizedCode);
			referralCodeDraft = '';
			await refreshCurrentContextFromApi();
			renderSectionContent();
			showToast('推荐码已绑定');
		} catch (error) {
			log('claim referral code failed', error);
			showToast(readErrorMessage(error, '推荐码绑定失败'));
		}
	}

	async function importOrganizationMembers(organization: ManagedOrganization, rawText: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.searchUsers !== 'function') {
			showToast('批量导入接口暂不可用');
			return;
		}
		const lines = rawText
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length === 0) {
			showToast('请先输入要导入的账号');
			return;
		}

		const memberIds = new Set(organization.members.map((member) => member.userId));
		const failures: string[] = [];
		const failedRawLines: string[] = [];
		let successCount = 0;

		for (const line of lines) {
			const [queryPart = '', rolesPart = '', memberNoPart = ''] = line.split(/\s*[,，\t]\s*/);
			const query = queryPart.trim();
			if (!query) {
				continue;
			}
			if (isOrganizationSeatFull(organization, successCount)) {
				failures.push(`${query}: 席位已满`);
				failedRawLines.push(line);
				continue;
			}

			const roles = rolesPart.trim() ? normalizeOrganizationImportRoles(rolesPart) : ['student'];
			if (roles.length === 0) {
				failures.push(`${query}: 角色格式无效`);
				failedRawLines.push(line);
				continue;
			}

			try {
				const values = (await api.searchUsers(token, query, 8)) as Record<string, unknown>[];
				const candidates = Array.from(
					new Map(
						values
							.map((value) => normalizeContext({ ...value, guest: false }))
							.map((normalized) => toPCUser(normalized))
							.filter((user) => user.id && !memberIds.has(user.id))
							.map((user) => [user.id, user] as const)
					).values()
				);
				const matchedUser = pickSearchCandidate(candidates, query);
				if (!matchedUser) {
					failures.push(`${query}: 未找到唯一匹配账号`);
					failedRawLines.push(line);
					continue;
				}
				await persistOrganizationMembership(organization, matchedUser.id, roles, memberNoPart.trim());
				memberIds.add(matchedUser.id);
				successCount += 1;
			} catch (error) {
				log('batch import organization member failed', organization.id, query, error);
				failures.push(`${query}: ${readErrorMessage(error, '导入失败')}`);
				failedRawLines.push(line);
			}
		}

		const draft = getOrganizationMemberDraft(organization.id);
		draft.batchText = failedRawLines.join('\n');
		draft.searchQuery = '';
		draft.searchResults = [];
		draft.selectedUserId = '';
		draft.memberNo = '';
		await refreshManagedOrganizations();
		showToast(successCount > 0 ? `已导入 ${successCount} 人${failures.length > 0 ? `，失败 ${failures.length} 条` : ''}` : failures[0] || '批量导入未成功');
	}

	async function ensureManagedOrganizations(ctx: PCContext): Promise<void> {
		const cacheKey = managedOrganizationsKey(ctx);
		if (!canManageMembers(ctx)) {
			managedOrganizations = [];
			managedOrganizationsCacheKey = cacheKey;
			return;
		}

		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getOrganizations !== 'function' || typeof api.getOrganizationMembers !== 'function') {
			managedOrganizations = [];
			managedOrganizationsCacheKey = cacheKey;
			return;
		}

		await loadUsers();

		if (managedOrganizationsCacheKey === cacheKey) {
			if (managedOrganizationsLoading) {
				await managedOrganizationsLoading;
			}
			return;
		}

		managedOrganizationsCacheKey = cacheKey;
		managedOrganizationsLoading = (async () => {
			try {
				const organizationValues = (await api.getOrganizations(token)) as unknown[];
				const nextOrganizations: ManagedOrganization[] = [];
				for (const value of organizationValues) {
					const organization = asRecord(value);
					if (!organization) {
						continue;
					}
					const organizationId = readString(organization.organization_id) || readString(organization.scope_id);
					if (!organizationId) {
						continue;
					}
					const organizationSubscription = normalizeSubscription(organization.subscription);
					let members: ManagedOrganizationMember[] = [];
					let memberCount = readCount(organization.member_count) ?? 0;
					const invitations = Array.isArray(organization.invitations)
						? organization.invitations
								.map((item) => asRecord(item))
								.filter((item): item is Record<string, unknown> => Boolean(item))
								.map((invitation) => ({
									invitationId: readString(invitation.invitation_id) || '',
									inviteToken: readString(invitation.invite_token) || readString(invitation.invite_code) || '',
									channel: (readString(invitation.channel) || 'email') as 'email' | 'phone',
									contact: readString(invitation.contact) || readString(invitation.email) || readString(invitation.phone) || '-',
									status: readString(invitation.status) || 'pending',
									roles: readStringArray(invitation.roles) || ['student'],
									memberNo:
										readString(invitation.member_no) || readString(invitation.student_no) || readString(invitation.employee_no),
									message: readString(invitation.message) || '',
									deliveryStatus: readString(invitation.delivery_status),
									deliveryProvider: readString(invitation.delivery_provider),
									deliveryMessageId: readString(invitation.delivery_message_id),
									deliveryError: readString(invitation.delivery_error),
									deliveredAt: readString(invitation.delivered_at),
									createdAt: readString(invitation.created_at) || '',
									expiresAt: readString(invitation.expires_at) || ''
								}))
						: [];
					const auditLogs = Array.isArray(organization.audit_logs)
						? organization.audit_logs
								.map((item) => asRecord(item))
								.filter((item): item is Record<string, unknown> => Boolean(item))
								.map((audit) => ({
									auditId: readString(audit.audit_id) || '',
									action: readString(audit.action) || '',
									summary: readString(audit.summary) || '组织操作',
									actorUsername: readString(audit.actor_username) || readString(audit.actor_user_id) || '系统',
									createdAt: readString(audit.created_at) || '',
									detailText: auditDetailSummary(audit.details)
								}))
						: [];

					try {
						const memberValues = (await api.getOrganizationMembers(organizationId, token)) as unknown[];
						const memberRecords = Array.isArray(memberValues)
							? memberValues
									.map((item) => asRecord(item))
									.filter((item): item is Record<string, unknown> => Boolean(item))
							: [];
						members = memberRecords.map((member) => ({
							userId: readString(member.user_id) || '',
							username: readString(member.username) || readString(member.user_id) || '未命名成员',
							memberNo: readString(member.member_no) || readString(member.student_no) || readString(member.employee_no),
							roles: readStringArray(member.roles) || [],
							status: readString(member.status) || 'active'
						}));
						memberCount = memberCount || members.length;
					} catch (error) {
						log('load organization members failed', organizationId, error);
					}

					nextOrganizations.push({
						id: organizationId,
						name:
							readString(organization.name) ||
							readString(organization.organization_name) ||
							(ctx.organizationId === organizationId ? ctx.organizationName : undefined) ||
							'未命名组织',
						organizationType: readString(organization.organization_type) || ctx.organizationType,
						memberCount,
						seats: readCount(organization.seats) ?? organizationSubscription?.seats ?? 0,
						plan: readString(organization.plan) || organizationSubscription?.plan || 'free',
						status: readString(organization.status) || organizationSubscription?.status || 'active',
						expiresAt: readString(organization.expires_at) || organizationSubscription?.expiresAt || '',
						members,
						invitations,
						auditLogs
					});
				}
				managedOrganizations = nextOrganizations;
			} catch (error) {
				managedOrganizations = [];
				log('load managed organizations failed', error);
			} finally {
				managedOrganizationsLoading = null;
				if (activeSection === 'admin-hub' && isOpen()) {
					renderSectionContent();
				}
			}
		})();

		await managedOrganizationsLoading;
	}

	function renderOrganizationInvitationPanel(organization: ManagedOrganization): string {
		const draft = getOrganizationMemberDraft(organization.id);
		const pendingCount = organization.invitations.filter((item) => item.status === 'pending').length;
		const invitationMarkup = organization.invitations.length
			? organization.invitations
					.slice(0, 6)
					.map((invitation) => {
						const rolesText = roleLabels(invitation.roles).join(' / ') || invitation.roles.join(' / ') || '成员';
						const canCancel = invitation.status === 'pending';
						const deliveryStatus = invitation.deliveryStatus || 'queued';
						const deliverySummary =
							deliveryStatus === 'sent' || deliveryStatus === 'delivered'
								? `投递成功${invitation.deliveryProvider ? ` · ${invitation.deliveryProvider}` : ''}${invitation.deliveredAt ? ` · ${formatDateTime(invitation.deliveredAt)}` : ''}`
								: deliveryStatus === 'failed'
									? `投递失败${invitation.deliveryError ? ` · ${invitation.deliveryError}` : ''}`
									: `投递中${invitation.deliveryProvider ? ` · ${invitation.deliveryProvider}` : ''}`;
						return `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(invitation.contact)}</strong><span>${escapeHtml(invitationStatusLabel(invitation.status))} · ${escapeHtml(invitation.channel === 'email' ? '邮箱邀请' : '手机号邀请')}</span></div>${canCancel ? `<button class="pc-inline-danger" type="button" data-org-invitation-cancel data-org-id="${escapeHtml(organization.id)}" data-invitation-id="${escapeHtml(invitation.invitationId)}">取消</button>` : ''}</div><div class="pc-org-invite-meta"><span>角色：${escapeHtml(rolesText)}</span><span>到期：${escapeHtml(formatDateTime(invitation.expiresAt))}</span></div><div class="pc-admin-note">${escapeHtml(deliverySummary)}</div>${invitation.message ? `<div class="pc-admin-note">备注：${escapeHtml(invitation.message)}</div>` : ''}</div>`;
					})
					.join('')
			: '<div class="pc-org-empty">当前还没有邀请记录。创建后会显示投递状态和到期时间，对方登录后会在待处理邀请里直接看到。</div>';

		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>邀请成员</h4><span>${escapeHtml(String(pendingCount))} 个待接受</span></div><div class="pc-admin-note">支持直接填写邮箱或手机号。系统会自动发送邮件或短信，并要求对方验证匹配联系人后才能接受邀请。</div><form class="pc-org-add-form" data-org-invite-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid"><label class="pc-org-field pc-org-field-wide"><span>邮箱或手机号</span><input class="pc-profile-input" type="text" data-org-invite-contact value="${escapeHtml(draft.inviteContact)}" placeholder="name@example.com / 13800138000" /></label><label class="pc-org-field"><span>${escapeHtml(organizationMemberNoLabel(organization.organizationType))}</span><input class="pc-profile-input" type="text" maxlength="32" data-org-invite-member-no value="${escapeHtml(draft.inviteMemberNo)}" placeholder="留空自动生成" /></label></div><div class="pc-role-toggle-group">${renderOrganizationRoleControls(['student'], `org-invite-${organization.id}`)}</div><label class="pc-org-field"><span>邀请备注</span><textarea class="pc-org-batch-input" data-org-invite-message rows="3" placeholder="例如：欢迎加入第三期日语冲刺班">${escapeHtml(draft.inviteMessage)}</textarea></label><div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit">创建邀请</button></div></form><div class="pc-org-invite-list">${invitationMarkup}</div></div>`;
	}

	function renderOrganizationSubscriptionPanel(organization: ManagedOrganization): string {
		const expiryInput = organization.expiresAt ? organization.expiresAt.slice(0, 10) : '';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>套餐与席位</h4><span>${escapeHtml(subscriptionExpirySummary(organization.expiresAt, organization.status))}</span></div><form class="pc-org-add-form" data-org-subscription-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>套餐</span><select class="pc-profile-input pc-org-select" data-org-plan><option value="free"${organization.plan === 'free' ? ' selected' : ''}>FREE</option><option value="pro"${organization.plan === 'pro' ? ' selected' : ''}>PRO</option><option value="ultra"${organization.plan === 'ultra' ? ' selected' : ''}>ULTRA</option></select></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-status><option value="active"${organization.status === 'active' ? ' selected' : ''}>active</option><option value="trial"${organization.status === 'trial' ? ' selected' : ''}>trial</option><option value="expired"${organization.status === 'expired' ? ' selected' : ''}>expired</option><option value="canceled"${organization.status === 'canceled' ? ' selected' : ''}>canceled</option></select></label><label class="pc-org-field"><span>席位数</span><input class="pc-profile-input" type="number" min="1" step="1" data-org-seats value="${escapeHtml(String(organization.seats || defaultSeatsForPlan(organization.plan)))}" /></label></div><div class="pc-org-form-grid"><label class="pc-org-field"><span>到期日期</span><input class="pc-profile-input" type="date" data-org-expires-at value="${escapeHtml(expiryInput)}" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存套餐</button></div></div><div class="pc-admin-note">当前成员 ${escapeHtml(String(organization.memberCount))} 人，建议席位不低于成员数。切换套餐时会自动写入组织审计日志。</div></form></div>`;
	}

	function renderOrganizationAuditPanel(organization: ManagedOrganization): string {
		const auditMarkup = organization.auditLogs.length
			? organization.auditLogs
					.slice(0, 8)
					.map(
						(logItem) => `<div class="pc-org-audit-item"><div class="pc-org-audit-head"><strong>${escapeHtml(logItem.summary)}</strong><span>${escapeHtml(formatDateTime(logItem.createdAt))}</span></div><div class="pc-org-audit-meta">${escapeHtml(logItem.actorUsername)} · ${escapeHtml(logItem.action || 'organization.event')}</div>${logItem.detailText ? `<div class="pc-org-audit-detail">${escapeHtml(logItem.detailText)}</div>` : ''}</div>`
					)
					.join('')
			: '<div class="pc-org-empty">这里会记录谁添加了谁、谁修改了角色、谁取消了邀请以及套餐变更。</div>';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>操作审计</h4><span>最近 ${escapeHtml(String(Math.min(organization.auditLogs.length, 8)))} 条</span></div><div class="pc-org-audit-list">${auditMarkup}</div></div>`;
	}

	function renderOrganizationAddForm(organization: ManagedOrganization): string {
		const draft = getOrganizationMemberDraft(organization.id);
		const seatFull = isOrganizationSeatFull(organization);
		const selectedUser = draft.searchResults.find((user) => user.id === draft.selectedUserId);
		const memberNoLabel = organizationMemberNoLabel(organization.organizationType);
		const resultsMarkup = draft.searchResults.length
			? `<div class="pc-org-candidate-list">${draft.searchResults
					.map((user) => {
						const meta = [user.username && user.username !== user.displayName ? user.username : '', user.email || '', user.memberNo || '']
							.filter(Boolean)
							.join(' · ');
						return `<button class="pc-org-candidate${draft.selectedUserId === user.id ? ' selected' : ''}" type="button" data-org-pick-user data-org-id="${escapeHtml(organization.id)}" data-user-id="${escapeHtml(user.id)}"><strong>${escapeHtml(user.displayName)}</strong><span>${escapeHtml(meta || user.id)}</span></button>`;
					})
					.join('')}</div>`
			: `<div class="pc-admin-note">${draft.searchQuery.trim() ? '没有找到可添加的账号，请换一个关键字。' : '可按登录账号、昵称、邮箱、成员编号进行搜索。'}</div>`;
		return `<div class="pc-org-capacity${seatFull ? ' is-full' : ''}">${escapeHtml(organizationSeatSummary(organization))}${seatFull ? ' 请先移除成员或升级席位。' : ''}</div>
		<form class="pc-org-add-form" data-org-add-form data-org-id="${escapeHtml(organization.id)}">
			<div class="pc-org-form-grid">
				<label class="pc-org-field pc-org-field-wide">
					<span>搜索账号</span>
					<div class="pc-org-search-row"><input class="pc-profile-input" type="text" data-org-search-query value="${escapeHtml(draft.searchQuery)}" placeholder="输入账号 / 昵称 / 邮箱" /><button class="pc-inline-ghost" type="button" data-org-search${seatFull ? ' disabled' : ''}>搜索</button></div>
				</label>
				<label class="pc-org-field">
					<span>${escapeHtml(memberNoLabel)}</span>
					<input class="pc-profile-input" type="text" maxlength="32" data-org-add-member-no value="${escapeHtml(draft.memberNo)}" placeholder="留空自动生成" />
				</label>
			</div>
			<div class="pc-role-toggle-group">${renderOrganizationRoleControls(['student'], `org-add-${organization.id}`)}</div>
			${resultsMarkup}
			<div class="pc-admin-note">${selectedUser ? `已选择 ${escapeHtml(selectedUser.displayName)}，提交后会加入当前组织。` : '先搜索并选择一个账号，再点击添加成员。'}</div>
			<div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit"${seatFull || !selectedUser ? ' disabled' : ''}>添加成员</button></div>
		</form>
		<form class="pc-org-add-form pc-org-batch-form" data-org-batch-form data-org-id="${escapeHtml(organization.id)}">
			<label class="pc-org-field">
				<span>批量导入</span>
				<textarea class="pc-org-batch-input" data-org-batch-text rows="4" placeholder="一行一个账号，支持：账号,角色1|角色2,成员编号">${escapeHtml(draft.batchText)}</textarea>
			</label>
			<div class="pc-admin-note">示例：teacher_001,teacher|orgAdmin,EMP-0101</div>
			<div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit"${seatFull ? ' disabled' : ''}>批量导入</button></div>
		</form>`;
	}

	function renderOrganizationMemberEditor(organization: ManagedOrganization, member: ManagedOrganizationMember): string {
		const displayName = organizationMemberDisplayName(member);
		const metaParts = [member.username !== displayName ? member.username : '', member.memberNo || ''].filter(Boolean);
		return `<form class="pc-org-member-editor" data-org-member-form data-org-id="${escapeHtml(organization.id)}" data-user-id="${escapeHtml(member.userId)}">
			<div class="pc-org-member-head">
				<div class="pc-org-member-meta"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(metaParts.join(' · ') || '组织成员')}</span></div>
				<button class="pc-inline-danger" type="button" data-org-member-remove>移除成员</button>
			</div>
			<div class="pc-role-toggle-group">${renderOrganizationRoleControls(member.roles, `org-member-${organization.id}-${member.userId}`)}</div>
			<div class="pc-org-form-grid pc-org-form-grid-compact">
				<label class="pc-org-field">
					<span>${escapeHtml(organizationMemberNoLabel(organization.organizationType))}</span>
					<input class="pc-profile-input" type="text" maxlength="32" data-org-member-no value="${escapeHtml(member.memberNo || '')}" placeholder="保持当前编号" />
				</label>
				<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存变更</button></div>
			</div>
		</form>`;
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
			if (t?.dataset.action === 'pc-back-home') {
				activeSection = 'dashboard';
				renderSections();
				renderSectionContent();
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
		activeSection = 'dashboard';
		organizationInviteTokenDraft = organizationInviteTokenDraft || inviteTokenFromUrl();
		seedContactVerificationDraft(getContext());
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
		trigger.classList.toggle('authenticated', !ctx.guest);
		if (ctx.guest) {
			trigger.innerHTML = renderOutlineIcon('profileMark', 'pc-trigger-icon');
		} else if (ctx.avatar) {
			trigger.innerHTML = `<img class="pc-trigger-avatar" src="${escapeHtml(ctx.avatar)}" alt="${escapeHtml(preferredDisplayName(ctx))}" />`;
		} else {
			trigger.innerHTML = `<span class="pc-trigger-monogram">${escapeHtml(triggerMonogram(ctx))}</span>`;
		}
		trigger.title = ctx.guest ? '登录账号' : `${preferredDisplayName(ctx)} - 打开个人中心`;
		trigger.setAttribute('aria-label', ctx.guest ? '登录账号' : '打开个人中心');
		if (DEBUG) {
			await loadUsers();
		}
	}

	function syncHeaderActions(): void {
		const backBtn = document.getElementById('pc-header-back') as HTMLButtonElement | null;
		if (!backBtn) {
			return;
		}
		const currentSection = sections.find((section) => section.id === activeSection);
		backBtn.style.display = currentSection?.nav === false ? 'inline-flex' : 'none';
	}

	function renderSections(): void {
		const nav = document.getElementById('pc-nav');
		if (!nav) {
			return;
		}
		syncHeaderActions();
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
				username: user.username,
				memberNo: user.memberNo,
				roles: user.roleIds,
				balance: user.balance || { credits: 0, updatedAt: new Date().toISOString() },
				email: user.email || '',
				avatar: user.avatar || null,
				lastLoginAt: user.lastLoginAt || new Date().toLocaleString(),
				status: user.status || 'active',
				accessibleLevels: user.accessibleLevels || ['*'],
				subscription: user.subscription,
				xp: user.xp,
				streakDays: user.streakDays,
				couponCount: user.couponCount,
				planExpiresAt: user.planExpiresAt,
				scopeType: user.scopeType,
				organizationType: user.organizationType,
				guest: false
			});
		};

		nameEl.parentElement?.appendChild(select);
	}

	function renderHeaderOverview(ctx: PCContext): string {
		const remainingDays = remainingDaysLabel(ctx);
		const points = ctx.xp ?? 0;
		const coupons = ctx.couponCount ?? 0;
		const plan = planLabel(ctx.subscription?.plan);
		return `<div class="pc-overview-head">
			<div>
				<div class="pc-overview-title">账户概览</div>
			</div>
			<div class="pc-plan-badge">${plan}</div>
		</div>
		<div class="pc-summary-stats">
			<div class="pc-summary-stat">
				<span>剩余天数</span>
				<strong>${remainingDays}</strong>
			</div>
			<div class="pc-summary-stat">
				<span>学习积分</span>
				<strong>${points}</strong>
			</div>
			<div class="pc-summary-stat">
				<span>卡券</span>
				<strong>${coupons} 张</strong>
			</div>
		</div>`;
	}

	function renderContactVerificationMethod(ctx: PCContext, options: {
		kind: ContactVerificationKind;
		value: string;
		verified: boolean;
		draftValue: string;
		draftCode: string;
	}) : string {
		const isEmail = options.kind === 'email';
		const title = isEmail ? 'Email' : 'Phone';
		const currentValue = options.value.trim();
		const draftValue = options.draftValue.trim() || currentValue;
		const challengeChannels = availableContactChangeChannels(ctx);
		const needsChangeChallenge = Boolean(currentValue) && options.verified && challengeChannels.length > 0;
		const helperText = needsChangeChallenge
			? isEmail
				? '点击修改后，会先验证当前已绑定的邮箱或手机号；提交新的邮箱时，后端会强制校验这一步。变更成功后会通知旧邮箱。'
				: '点击修改后，会先验证当前已绑定的邮箱或手机号；提交新的手机号时，后端会强制校验这一步。变更成功后会通知旧手机号。'
			: isEmail
				? '收到邮箱邀请时，只需要验证这里的邮箱。首次绑定或补验证时，不需要旧联系人确认。'
				: '收到短信邀请时，只需要验证这里的手机号。首次绑定或补验证时，不需要旧联系人确认。';
		const currentLabel = currentValue || (isEmail ? '未绑定邮箱' : '未绑定手机号');
		const badgeText = !currentValue ? '未绑定' : options.verified ? '已验证' : '待验证';
		const badgeClass = !currentValue ? 'is-empty' : options.verified ? 'is-verified' : 'is-pending';
		const actionLabel = !currentValue ? '绑定' : options.verified ? '修改' : '去验证';
		const isOpen = activeContactVerificationEditor === options.kind;
		const valueAttr = isEmail ? 'data-verify-email' : 'data-verify-phone';
		const codeAttr = isEmail ? 'data-verify-email-code' : 'data-verify-phone-code';
		const sendAttr = isEmail ? 'data-email-send-code' : 'data-phone-send-code';
		const formAttr = isEmail ? 'data-email-verify-form' : 'data-phone-verify-form';
		const valuePlaceholder = isEmail ? 'name@example.com' : '13800138000';
		const codePlaceholder = isEmail ? '输入邮箱验证码' : '输入短信验证码';
		const submitLabel = isEmail ? '验证邮箱' : '验证手机号';
		const changeChallengeMarkup = needsChangeChallenge
			? `<div class="pc-verify-step"><div class="pc-verify-step-title">先确认当前联系人</div><div class="pc-verify-editor-note">可使用当前已验证的邮箱或手机号任意一种做确认。提交新的联系人前，需要先完成这一步。</div><div class="pc-verify-current-actions">${challengeChannels
				.map(
					(channel) => `<button class="pc-inline-ghost${contactVerificationDraft.changeChallengeChannel === channel ? ' is-selected' : ''}" type="button" data-contact-change-send="${channel}">发送到${contactChangeChannelLabel(channel)}</button>`
				)
				.join('')}</div><div class="pc-verify-input-row"><input class="pc-profile-input" type="text" data-contact-change-code value="${escapeHtml(contactVerificationDraft.changeChallengeCode)}" placeholder="输入当前联系人收到的确认码" /><div class="pc-verify-editor-note">${contactVerificationDraft.changeChallengeChannel ? `当前使用：${escapeHtml(contactChangeChannelLabel(contactVerificationDraft.changeChallengeChannel))}` : '先发送确认码，再输入上面的 6 位确认码'}</div></div></div>`
			: '';
		const targetStepTitle = needsChangeChallenge ? (isEmail ? '再验证新邮箱' : '再验证新手机号') : (isEmail ? '验证邮箱' : '验证手机号');
		const editorMarkup = isOpen
			? `<form class="pc-verify-editor" ${formAttr}><div class="pc-verify-editor-note">${escapeHtml(helperText)}</div>${changeChallengeMarkup}<div class="pc-verify-step"><div class="pc-verify-step-title">${targetStepTitle}</div><div class="pc-verify-input-row"><input class="pc-profile-input" type="${isEmail ? 'email' : 'text'}" ${valueAttr} value="${escapeHtml(draftValue)}" placeholder="${valuePlaceholder}" /><button class="pc-inline-ghost" type="button" ${sendAttr}>发送验证码</button></div><div class="pc-verify-input-row"><input class="pc-profile-input" type="text" ${codeAttr} value="${escapeHtml(options.draftCode)}" placeholder="${codePlaceholder}" /><div class="pc-verify-editor-actions"><button class="pc-inline-btn" type="submit">${submitLabel}</button><button class="pc-inline-ghost" type="button" data-contact-verify-toggle="${options.kind}">收起</button></div></div></div></form>`
			: '';
		return `<div class="pc-verify-row-card${isOpen ? ' is-open' : ''}"><div class="pc-verify-row-summary"><div class="pc-verify-row-label">${title}</div><div class="pc-verify-row-value${currentValue ? '' : ' is-empty'}">${escapeHtml(currentLabel)}</div><div class="pc-verify-row-meta"><span class="pc-verify-badge ${badgeClass}">${badgeText}</span><button class="pc-inline-ghost" type="button" data-contact-verify-toggle="${options.kind}">${isOpen ? '收起' : actionLabel}</button></div></div>${editorMarkup}</div>`;
	}

	function renderContactVerificationCard(ctx: PCContext): string {
		seedContactVerificationDraft(ctx);
		const verifiedCount = Number(ctx.emailVerified) + Number(ctx.phoneVerified);
		const pendingCount = 2 - verifiedCount;
		const summaryText = pendingCount > 0 ? `待验证 ${pendingCount} 项` : '全部已验证';
		const summaryClass = pendingCount > 0 ? 'is-pending' : 'is-verified';
		return `<div class="pc-card pc-info-card pc-contact-verify-card"><div class="pc-contact-verify-head"><div><div class="pc-service-header">联系人验证</div><div class="pc-admin-note">修改已绑定联系人前，会先验证当前邮箱或手机号；变更完成后会向旧联系人发送提醒。</div></div><span class="pc-verify-badge ${summaryClass}">${summaryText}</span></div><div class="pc-contact-verify-list">${renderContactVerificationMethod(ctx, { kind: 'email', value: ctx.email || '', verified: Boolean(ctx.emailVerified), draftValue: contactVerificationDraft.email || ctx.email || '', draftCode: contactVerificationDraft.emailCode })}${renderContactVerificationMethod(ctx, { kind: 'phone', value: ctx.phone || '', verified: Boolean(ctx.phoneVerified), draftValue: contactVerificationDraft.phone || ctx.phone || '', draftCode: contactVerificationDraft.phoneCode })}</div><div class="pc-contact-verify-footnote">首次绑定或补验证时只验证新联系人；改绑时要先确认当前已验证的邮箱或手机号。</div></div>`;
	}

	function renderPendingInvitationPanel(ctx: PCContext): string {
		if (ctx.guest) {
			return '';
		}
		const cacheKey = pendingInvitationsKey(ctx);
		const isLoaded = pendingInvitationsCacheKey === cacheKey && !pendingInvitationsLoading;
		if (!isLoaded) {
			return `<div class="pc-card pc-info-card"><div class="pc-service-header">待处理组织邀请</div><div class="pc-admin-note">正在读取管理员发给你的组织邀请...</div></div>`;
		}
		if (pendingInvitations.length === 0) {
			return '';
		}

		const prefillableBlockCodes = new Set([
			'INVITATION_CONTACT_BIND_REQUIRED',
			'INVITATION_EMAIL_VERIFICATION_REQUIRED',
			'INVITATION_PHONE_VERIFICATION_REQUIRED'
		]);
		const invitationMarkup = pendingInvitations
			.map((invitation) => {
				const rolesText = roleLabels(invitation.roles).join(' / ') || invitation.roles.join(' / ') || '成员';
				const stateLabel = invitation.canAccept
					? '可立即加入'
					: invitation.isExpired
						? '邀请已过期'
						: invitation.acceptBlockCode === 'ORGANIZATION_SEATS_FULL'
							? '组织席位已满'
							: '待完成验证';
				const stateClass = invitation.canAccept ? 'is-ready' : 'is-blocked';
				const helperText = invitation.canAccept
					? `已匹配受邀${invitation.channel === 'email' ? '邮箱' : '手机号'}，点击即可加入。`
					: invitation.acceptBlockMessage || '请先完成联系人验证后再接受邀请。';
				const inviterText = invitation.createdByUsername || '管理员';
				const prefillButton = !invitation.canAccept && prefillableBlockCodes.has(invitation.acceptBlockCode || '')
					? `<button class="pc-inline-ghost" type="button" data-pending-invite-prefill data-channel="${escapeHtml(invitation.channel)}" data-contact="${escapeHtml(invitation.contact)}">填入验证信息</button>`
					: '';
				const acceptButton = invitation.canAccept
					? `<button class="pc-inline-btn" type="button" data-pending-invite-accept data-invite-token="${escapeHtml(invitation.inviteToken)}">接受邀请</button>`
					: prefillButton;
				return `<div class="pc-pending-invite-item"><div class="pc-pending-invite-head"><div><strong>${escapeHtml(invitation.organizationName)}</strong><span>${escapeHtml(organizationTypeLabel(invitation.organizationType))}组织 · 邀请人 ${escapeHtml(inviterText)}</span></div><span class="pc-pending-invite-state ${stateClass}">${escapeHtml(stateLabel)}</span></div><div class="pc-pending-invite-meta"><span>角色：${escapeHtml(rolesText)}</span><span>联系人：${escapeHtml(invitation.contact)}</span><span>收到时间：${escapeHtml(formatDateTime(invitation.createdAt))}</span><span>到期时间：${escapeHtml(formatDateTime(invitation.expiresAt))}</span></div><div class="pc-admin-note">${escapeHtml(helperText)}</div>${invitation.message ? `<div class="pc-admin-note">备注：${escapeHtml(invitation.message)}</div>` : ''}<div class="pc-org-form-actions">${acceptButton}</div></div>`;
			})
			.join('');
		return `<div class="pc-card pc-info-card"><div class="pc-service-header">待处理组织邀请</div><div class="pc-admin-note">登录后会直接显示管理员发给你的组织邀请。满足联系人验证条件时，可以一键加入。</div><div class="pc-pending-invite-list">${invitationMarkup}</div></div>`;
	}

	function renderReferralCard(ctx: PCContext): string {
		const referral = ctx.referral;
		if (!referral?.code) {
			return '';
		}
		referralCodeDraft = referralCodeDraft || referralCodeFromUrl();
		const rewardText = referral.hasReferrer
			? referral.rewardStatus === 'granted' && (referral.rewardCreditAmount || 0) > 0
				? `当前账号已绑定推荐码 ${referral.referredByCode || '-'}，奖励已结算；推荐人已获得 ${referral.rewardCreditAmount || 0} credits。`
				: `当前账号已绑定推荐码 ${referral.referredByCode || '-'}，奖励状态：${referral.rewardStatus || 'pending'}`
			: '新用户注册后会自动继承 ?ref=... 的归因；奖励会在后续关键业务事件完成后结算。';
		let referralLink = '';
		try {
			const url = new URL(window.location.href);
			url.searchParams.set('ref', referral.code);
			url.searchParams.delete('invite_token');
			url.searchParams.delete('invite_code');
			referralLink = url.toString();
		} catch {
			referralLink = `?ref=${encodeURIComponent(referral.code)}`;
		}
		const claimForm = referral.hasReferrer
			? ''
			: `<form class="pc-org-add-form" data-referral-claim-form><div class="pc-org-search-row"><input class="pc-profile-input" type="text" data-referral-code value="${escapeHtml(referralCodeDraft)}" placeholder="输入推荐码，例如 REFABC123" /><button class="pc-inline-btn" type="submit">绑定推荐码</button></div></form>`;
		return `<div class="pc-card pc-info-card"><div class="pc-service-header">我的推荐</div><div class="pc-info-list"><div class="pc-info-row"><span>推荐码</span><strong>${escapeHtml(referral.code)}</strong></div><div class="pc-info-row"><span>推荐链接</span><strong class="pc-inline-url">${escapeHtml(referralLink)}</strong></div></div><div class="pc-admin-note">${escapeHtml(rewardText)}</div>${claimForm}</div>`;
	}

	function renderInviteEntryCard(inviteToken: string): string {
		if (inviteToken) {
			return `<div class="pc-card pc-info-card"><div class="pc-service-header">组织邀请链接</div><div class="pc-admin-note">已识别当前链接里的组织邀请令牌。登录后，只要当前账号完成与邀请一致的邮箱或手机号验证，对应邀请就会在上方“待处理组织邀请”里显示为可接受状态。</div></div>`;
		}
		return `<div class="pc-card pc-info-card"><div class="pc-service-header">组织邀请入口</div><div class="pc-admin-note">企业邀请现在以链接为主入口。邮件或短信只负责通知，真正可处理的邀请会在你登录后的“待处理组织邀请”里出现，不再需要手动输入邀请码。</div></div>`;
	}

	function renderDashboard(ctx: PCContext): string {
		const features = visibleFeatures(ctx);
		const displayName = preferredDisplayName(ctx);
		const loginAccount = escapeHtml(ctx.username || '-');
		const memberNoRow = ctx.memberNo
			? `<div class="pc-info-row"><span>成员编号</span><strong>${escapeHtml(ctx.memberNo)}</strong></div>`
			: '';
		organizationInviteTokenDraft = organizationInviteTokenDraft || inviteTokenFromUrl();
		const pendingInvitationCard = renderPendingInvitationPanel(ctx);
		const referralCard = renderReferralCard(ctx);
		const email = escapeHtml(ctx.email || '未绑定');
		const lastLogin = escapeHtml(ctx.lastLoginAt || '暂无');
		const inviteAccessCard = renderInviteEntryCard(organizationInviteTokenDraft);
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
					<div class="pc-info-row"><span>登录账号</span><strong>${loginAccount}</strong></div>
					${memberNoRow}
					<div class="pc-info-row"><span>邮箱</span><strong>${email}</strong></div>
					<div class="pc-info-row"><span>最近登录</span><strong>${lastLogin}</strong></div>
				</div>
			</div>
			${pendingInvitationCard}
			${referralCard}
			${renderContactVerificationCard(ctx)}
			${inviteAccessCard}
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
		const loginAccount = escapeHtml(ctx.username || '-');
		const memberNoRow = ctx.memberNo
			? `<div class="pc-info-row"><span>成员编号</span><strong>${escapeHtml(ctx.memberNo)}</strong></div>`
			: '';
		return `<div class="pc-profile-stack">
			<div class="pc-card pc-info-card pc-avatar-picker-card">
				<div class="pc-service-header">头像选择</div>
				<div class="pc-avatar-picker-note">提供 8 组简洁角色头像，适合学生、教师、管理员等常用身份。</div>
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
					<div class="pc-avatar-picker-note">未设置时会先按登录账号显示，你也可以改成自己的名字。</div>
				</div>
				<div class="pc-info-list">
					<div class="pc-info-row"><span>当前昵称</span><strong>${escapeHtml(currentName)}</strong></div>
					<div class="pc-info-row"><span>登录账号</span><strong>${loginAccount}</strong></div>
					${memberNoRow}
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
			${renderContactVerificationCard(ctx)}
		</div>`;
	}

	function renderAdminHub(ctx: PCContext): string {
		const roleText = escapeHtml((ctx.roles || []).join(', ') || '无');
		const organizationRow = ctx.organizationName
			? `<div class="pc-info-row"><span>当前组织</span><strong>${escapeHtml(ctx.organizationName)}</strong></div>`
			: '';
		const canManage = canManageMembers(ctx);
		const cacheKey = managedOrganizationsKey(ctx);
		const isLoaded = managedOrganizationsCacheKey === cacheKey && !managedOrganizationsLoading;
		let organizationPanel = '';

		if (canManage) {
			if (!isLoaded) {
				organizationPanel = `<div class="pc-card pc-info-card"><div class="pc-service-header">组织成员管理</div><div class="pc-admin-note">正在读取你可管理的组织与成员列表...</div></div>`;
			} else if (managedOrganizations.length === 0) {
				organizationPanel = `<div class="pc-card pc-info-card"><div class="pc-service-header">组织成员管理</div><div class="pc-admin-note">当前账号还没有可管理的组织。企业管理员进入组织后，这里会显示成员、席位和套餐信息。</div></div>`;
			} else {
				organizationPanel = managedOrganizations
					.map((organization) => {
						const members = organization.members.map((member) => renderOrganizationMemberEditor(organization, member)).join('');
						const seatsText = organization.seats > 0 ? `${organization.memberCount}/${organization.seats} 席` : `${organization.memberCount} 人`;
						return `<div class="pc-card pc-info-card"><div class="pc-service-header">${escapeHtml(organization.name)}</div><div class="pc-org-card"><div class="pc-org-head"><div><div class="pc-org-name">${escapeHtml(organization.name)}</div><div class="pc-org-type">${escapeHtml(organizationTypeLabel(organization.organizationType))}组织</div></div><div class="pc-org-seat">${escapeHtml(seatsText)}</div></div><div class="pc-org-meta"><div class="pc-org-metric"><span>套餐</span><strong>${escapeHtml(planLabel(organization.plan))}</strong></div><div class="pc-org-metric"><span>状态</span><strong>${escapeHtml(organization.status)}</strong></div><div class="pc-org-metric"><span>成员数</span><strong>${escapeHtml(String(organization.memberCount))}</strong></div></div><div class="pc-admin-note">这里可以直接添加成员、发起邀请、维护成员编号、查看审计记录并调整组织套餐。</div>${renderOrganizationSubscriptionPanel(organization)}${renderOrganizationInvitationPanel(organization)}${renderOrganizationAddForm(organization)}<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>成员管理</h4><span>${escapeHtml(organizationSeatSummary(organization))}</span></div><div class="pc-org-member-list">${members || '<div class="pc-org-empty">当前组织暂无成员数据，可先通过上方表单添加。</div>'}</div></div>${renderOrganizationAuditPanel(organization)}</div></div>`;
					})
					.join('');
			}
		}

		const roleNote = canManage
			? '企业管理员现在会直接看到组织成员、席位和套餐摘要。'
			: '教师和阅卷角色先保留业务入口；企业管理员进入组织后，会自动出现成员管理视图。';

		return `<div class="pc-profile-stack"><div class="pc-card pc-info-card"><div class="pc-service-header">管理面板</div><div class="pc-info-list"><div class="pc-info-row"><span>当前空间</span><strong>${escapeHtml(scopeLabel(ctx))}</strong></div>${organizationRow}<div class="pc-info-row"><span>当前角色</span><strong>${roleText}</strong></div></div><div class="pc-admin-note">${escapeHtml(roleNote)}</div></div>${organizationPanel}${hasAnyRole(ctx, ['superAdmin']) ? renderSystemFlags() : ''}</div>`;
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

	function handleContactVerificationClick(target: HTMLElement | null, scope: ParentNode): boolean {
		const toggleButton = target?.closest('[data-contact-verify-toggle]') as HTMLButtonElement | null;
		if (toggleButton) {
			const kind = (toggleButton.dataset.contactVerifyToggle || '') as ContactVerificationKind | '';
			const nextKind = activeContactVerificationEditor === kind ? '' : kind;
			contactVerificationDraft.changeChallengeChannel = '';
			contactVerificationDraft.changeChallengeCode = '';
			activeContactVerificationEditor = nextKind;
			renderSectionContent({
				preserveScroll: true,
				focusSelector: nextKind === 'email' ? '[data-verify-email]' : nextKind === 'phone' ? '[data-verify-phone]' : undefined
			});
			return true;
		}
		const changeChallengeButton = target?.closest('[data-contact-change-send]') as HTMLButtonElement | null;
		if (changeChallengeButton) {
			const channel = (changeChallengeButton.dataset.contactChangeSend || '') as ContactVerificationKind | '';
			if (channel === 'email' || channel === 'phone') {
				void sendContactChangeChallenge(channel);
			}
			return true;
		}
		const emailSendButton = target?.closest('[data-email-send-code]') as HTMLButtonElement | null;
		if (emailSendButton) {
			const input = scope.querySelector('[data-verify-email]') as HTMLInputElement | null;
			void sendEmailVerificationCode(input?.value || contactVerificationDraft.email);
			return true;
		}
		const phoneSendButton = target?.closest('[data-phone-send-code]') as HTMLButtonElement | null;
		if (phoneSendButton) {
			const input = scope.querySelector('[data-verify-phone]') as HTMLInputElement | null;
			void sendPhoneVerificationCode(input?.value || contactVerificationDraft.phone);
			return true;
		}
		return false;
	}

	function handleContactVerificationSubmit(form: HTMLFormElement): boolean {
		if (form.matches('form[data-email-verify-form]')) {
			const emailInput = form.querySelector('[data-verify-email]') as HTMLInputElement | null;
			const codeInput = form.querySelector('[data-verify-email-code]') as HTMLInputElement | null;
			void verifyEmailAddress(emailInput?.value || '', codeInput?.value || '');
			return true;
		}
		if (form.matches('form[data-phone-verify-form]')) {
			const phoneInput = form.querySelector('[data-verify-phone]') as HTMLInputElement | null;
			const codeInput = form.querySelector('[data-verify-phone-code]') as HTMLInputElement | null;
			void verifyPhoneNumber(phoneInput?.value || '', codeInput?.value || '');
			return true;
		}
		return false;
	}

	function handleContactVerificationInput(target: HTMLInputElement | HTMLTextAreaElement): boolean {
		if (target.hasAttribute('data-verify-email')) {
			contactVerificationDraft.email = target.value;
			return true;
		}
		if (target.hasAttribute('data-verify-email-code')) {
			contactVerificationDraft.emailCode = target.value;
			return true;
		}
		if (target.hasAttribute('data-contact-change-code')) {
			contactVerificationDraft.changeChallengeCode = target.value;
			return true;
		}
		if (target.hasAttribute('data-verify-phone')) {
			contactVerificationDraft.phone = target.value;
			return true;
		}
		if (target.hasAttribute('data-verify-phone-code')) {
			contactVerificationDraft.phoneCode = target.value;
			return true;
		}
		return false;
	}

	function attachProfileHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (handleContactVerificationClick(target, container)) {
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
		container.onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			const form = event.target as HTMLFormElement | null;
			if (!form) {
				return;
			}
			handleContactVerificationSubmit(form);
		};
		container.oninput = (event: Event) => {
			const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
			if (!target) {
				return;
			}
			handleContactVerificationInput(target);
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
			if (handleContactVerificationClick(target, container)) {
				return;
			}
			const pendingAcceptButton = target?.closest('[data-pending-invite-accept]') as HTMLButtonElement | null;
			if (pendingAcceptButton) {
				void acceptOrganizationInvitation(pendingAcceptButton.dataset.inviteToken || '');
				return;
			}
			const pendingPrefillButton = target?.closest('[data-pending-invite-prefill]') as HTMLButtonElement | null;
			if (pendingPrefillButton) {
				const channel = (pendingPrefillButton.dataset.channel || 'email') as 'email' | 'phone';
				const contact = pendingPrefillButton.dataset.contact || '';
				if (channel === 'email') {
					contactVerificationDraft.email = contact;
					activeContactVerificationEditor = 'email';
					showToast('已填入待验证邮箱，请先获取验证码并完成验证');
				} else {
					contactVerificationDraft.phone = contact;
					activeContactVerificationEditor = 'phone';
					showToast('已填入待验证手机号，请先获取验证码并完成验证');
				}
				renderSectionContent();
				return;
			}
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
		container.onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			const form = event.target as HTMLFormElement | null;
			if (!form) {
				return;
			}
			if (handleContactVerificationSubmit(form)) {
				return;
			}
			if (form.matches('form[data-referral-claim-form]')) {
				const input = form.querySelector('[data-referral-code]') as HTMLInputElement | null;
				void claimReferralCode(input?.value || referralCodeDraft);
				return;
			}
			if (!form.matches('form[data-org-invite-accept-form]')) {
				return;
			}
			const input = form.querySelector('[data-org-invite-code]') as HTMLInputElement | null;
			void acceptOrganizationInvitation(input?.value || organizationInviteTokenDraft);
		};
		container.oninput = (event: Event) => {
			const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
			if (!target) {
				return;
			}
			if (handleContactVerificationInput(target)) {
				return;
			}
			if (target.hasAttribute('data-referral-code')) {
				referralCodeDraft = target.value;
				return;
			}
			if (!target?.hasAttribute('data-org-invite-code')) {
				return;
			}
			organizationInviteTokenDraft = target.value;
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

	function handleSystemFlagAction(target: HTMLElement | null): boolean {
		if (!target) {
			return false;
		}
		const control = target.closest('[data-maintenance], [data-flag]') as HTMLElement | null;
		if (!control) {
			return false;
		}
		if (control.hasAttribute('data-maintenance')) {
			confirmRisk('维护模式切换', 'MAINTAIN', () => {
				systemFlags = systemFlags.map((f) => (f.key === 'maintenanceMode' ? { ...f, value: !f.value } : f));
				renderSectionContent();
			});
			return true;
		}
		const key = control.getAttribute('data-flag');
		if (!key) {
			return false;
		}
		const flag = systemFlags.find((f) => f.key === key);
		if (!flag) {
			return false;
		}
		if (flag.risk === 'high') {
			confirmRisk(`切换 ${key}`, key.toUpperCase(), () => {
				systemFlags = systemFlags.map((f) => (f.key === key ? { ...f, value: !f.value } : f));
				renderSectionContent();
			});
			return true;
		}
		systemFlags = systemFlags.map((f) => (f.key === key ? { ...f, value: !f.value } : f));
		renderSectionContent();
		return true;
	}

	function attachAdminHubHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (handleSystemFlagAction(target)) {
				return;
			}
			const invitationCancelButton = target?.closest('[data-org-invitation-cancel]') as HTMLButtonElement | null;
			if (invitationCancelButton) {
				const organization = managedOrganizations.find((item) => item.id === (invitationCancelButton.dataset.orgId || ''));
				const invitation = organization?.invitations.find((item) => item.invitationId === (invitationCancelButton.dataset.invitationId || ''));
				if (!organization || !invitation) {
					showToast('邀请信息已失效，请刷新后重试');
					return;
				}
				void cancelOrganizationInvitation(organization, invitation);
				return;
			}
			const searchButton = target?.closest('[data-org-search]') as HTMLButtonElement | null;
			if (searchButton) {
				const form = searchButton.closest('form[data-org-add-form]') as HTMLFormElement | null;
				const organization = managedOrganizations.find((item) => item.id === (form?.dataset.orgId || ''));
				const input = form?.querySelector('[data-org-search-query]') as HTMLInputElement | null;
				if (!organization || !input) {
					showToast('搜索条件已失效，请刷新后重试');
					return;
				}
				void searchOrganizationCandidates(organization, input.value || '');
				return;
			}
			const pickButton = target?.closest('[data-org-pick-user]') as HTMLButtonElement | null;
			if (pickButton) {
				const organizationId = pickButton.dataset.orgId || '';
				const draft = getOrganizationMemberDraft(organizationId);
				draft.selectedUserId = pickButton.dataset.userId || '';
				renderSectionContent();
				return;
			}
			const removeButton = target?.closest('[data-org-member-remove]') as HTMLButtonElement | null;
			if (!removeButton) {
				return;
			}
			const form = removeButton.closest('form[data-org-member-form]') as HTMLFormElement | null;
			const organizationId = form?.dataset.orgId || '';
			const userId = form?.dataset.userId || '';
			const organization = managedOrganizations.find((item) => item.id === organizationId);
			const member = organization?.members.find((item) => item.userId === userId);
			if (!organization || !member) {
				showToast('成员信息已失效，请刷新后重试');
				return;
			}
			void removeOrganizationMembership(organization, member);
		};

		container.onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			const form = event.target as HTMLFormElement | null;
			if (!form) {
				return;
			}
			if (form.matches('form[data-org-add-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const draft = getOrganizationMemberDraft(organization.id);
				const memberNoInput = form.querySelector('[data-org-add-member-no]') as HTMLInputElement | null;
				void saveOrganizationMembership(
					organization,
					draft.selectedUserId,
					readOrganizationRoles(form),
					memberNoInput?.value || '',
					'成员已添加'
				);
				return;
			}
			if (form.matches('form[data-org-invite-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const contactInput = form.querySelector('[data-org-invite-contact]') as HTMLInputElement | null;
				const memberNoInput = form.querySelector('[data-org-invite-member-no]') as HTMLInputElement | null;
				const messageInput = form.querySelector('[data-org-invite-message]') as HTMLTextAreaElement | null;
				void saveOrganizationInvitation(
					organization,
					contactInput?.value || '',
					readOrganizationRoles(form),
					memberNoInput?.value || '',
					messageInput?.value || ''
				);
				return;
			}
			if (form.matches('form[data-org-batch-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const textarea = form.querySelector('[data-org-batch-text]') as HTMLTextAreaElement | null;
				void importOrganizationMembers(organization, textarea?.value || '');
				return;
			}
			if (form.matches('form[data-org-subscription-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const planInput = form.querySelector('[data-org-plan]') as HTMLSelectElement | null;
				const statusInput = form.querySelector('[data-org-status]') as HTMLSelectElement | null;
				const seatsInput = form.querySelector('[data-org-seats]') as HTMLInputElement | null;
				const expiresAtInput = form.querySelector('[data-org-expires-at]') as HTMLInputElement | null;
				void saveOrganizationSubscription(
					organization,
					planInput?.value || organization.plan,
					statusInput?.value || organization.status,
					seatsInput?.value || String(organization.seats),
					expiresAtInput?.value || ''
				);
				return;
			}
			if (form.matches('form[data-org-member-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const memberNoInput = form.querySelector('[data-org-member-no]') as HTMLInputElement | null;
				void saveOrganizationMembership(
					organization,
					form.dataset.userId || '',
					readOrganizationRoles(form),
					memberNoInput?.value || '',
					'成员已更新'
				);
			}
		};

		container.oninput = (event: Event) => {
			const target = event.target as HTMLElement | null;
			if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
				return;
			}
			const form = target.closest('form[data-org-id]') as HTMLFormElement | null;
			const organizationId = form?.dataset.orgId || '';
			if (!organizationId) {
				return;
			}
			const draft = getOrganizationMemberDraft(organizationId);
			if (target.hasAttribute('data-org-search-query')) {
				draft.searchQuery = target.value;
				return;
			}
			if (target.hasAttribute('data-org-add-member-no')) {
				draft.memberNo = target.value;
				return;
			}
			if (target.hasAttribute('data-org-invite-contact')) {
				draft.inviteContact = target.value;
				return;
			}
			if (target.hasAttribute('data-org-invite-member-no')) {
				draft.inviteMemberNo = target.value;
				return;
			}
			if (target.hasAttribute('data-org-invite-message')) {
				draft.inviteMessage = target.value;
				return;
			}
			if (target.hasAttribute('data-org-batch-text')) {
				draft.batchText = target.value;
			}
		};

		container.onkeydown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.key !== 'Enter' || !target?.hasAttribute('data-org-search-query')) {
				return;
			}
			event.preventDefault();
			const form = target.closest('form[data-org-add-form]') as HTMLFormElement | null;
			const organization = managedOrganizations.find((item) => item.id === (form?.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return;
			}
			void searchOrganizationCandidates(organization, (target as HTMLInputElement).value || '');
		};
	}

	function attachSystemFlagsHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			handleSystemFlagAction(target);
		};
	}

	function renderSectionContent(options: { preserveScroll?: boolean; focusSelector?: string } = {}): void {
		const container = document.getElementById('pc-content');
		if (!container) {
			return;
		}
		const previousScrollTop = container.scrollTop;
		syncHeaderActions();
		const ctx = getContext();
		container.onclick = null;
		container.onsubmit = null;
		container.oninput = null;
		container.onkeydown = null;
		switch (activeSection) {
			case 'dashboard':
				void ensurePendingInvitations(ctx);
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
				container.innerHTML = renderAdminHub(ctx);
				if (canManageMembers(ctx)) {
					void ensureManagedOrganizations(ctx);
				}
				attachAdminHubHandlers(container);
				break;
			case 'system-flags':
				container.innerHTML = renderSystemFlags();
				attachSystemFlagsHandlers(container);
				break;
			case 'logout':
				window.logoutUser?.();
				break;
		}
		container.scrollTop = options.preserveScroll ? previousScrollTop : 0;
		if (options.focusSelector) {
			const focusTarget = container.querySelector(options.focusSelector) as HTMLElement | null;
			if (focusTarget) {
				window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
			}
		}
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
		const next = normalizeContext(ctx);
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
