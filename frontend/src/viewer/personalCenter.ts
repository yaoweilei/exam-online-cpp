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
import {
	escapeHtml, svgToDataUri, asRecord, readString, readBoolean, readNumber, readCount, readStringArray,
	deriveFallbackDisplayName, preferredDisplayName, triggerMonogram
} from './personalCenter/utils.js';
import { renderAccessory, renderHair, buildAvatarSvg, buildEmojiAvatarSvg, buildAvatarPresets } from './personalCenter/avatar.js';
import { renderOutlineIcon } from './personalCenter/icons.js';
import { normalizeSubscription, normalizeReferral, normalizePendingInvitation } from './personalCenter/normalize.js';


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
			// 业务功能 1：错题本入口（功能开关：wrong_questions）
			id: 'wrongQuestions',
			title: '错题本',
			icon: 'book',
			intent: 'openWrongQuestions',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('wrong_questions') ?? true)
		},
		{
			// 业务功能 7：SRS 复习入口（功能开关：srs）
			id: 'srsReview',
			title: '今日复习',
			icon: 'book',
			intent: 'openSrsReview',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('srs') ?? true)
		},
		{
			// 业务功能 8：收藏分类入口（功能开关：bookmark_folders）
			id: 'bookmarkFolders',
			title: '收藏夹',
			icon: 'book',
			intent: 'openBookmarkFolders',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('bookmark_folders') ?? true)
		},
		{
			// 业务功能 16：每日一练入口（功能开关：daily_practice）
			id: 'dailyPractice',
			title: '每日一练',
			icon: 'chart',
			intent: 'openDailyPractice',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('daily_practice') ?? true)
		},
		{
			// 业务功能 17：学习报告入口（功能开关：learning_report）
			id: 'learningReport',
			title: '学习报告',
			icon: 'chart',
			intent: 'openLearningReport',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('learning_report') ?? true)
		},
		{
			// 个人生词本入口（功能开关：vocab_notebook）
			id: 'vocabNotebook',
			title: '生词本',
			icon: 'book',
			intent: 'openVocabNotebook',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('vocab_notebook') ?? true)
		},
		{
			// 功能 #18：章节式学习路径入口（功能开关：chapter_path）
			id: 'chapterPath',
			title: '学习路径',
			icon: 'chart',
			intent: 'openChapterPath',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('chapter_path') ?? true)
		},
		{
			// 业务功能 18：备考目标 / 倒计时入口（功能开关：study_goal）
			id: 'studyGoal',
			title: '备考目标',
			icon: 'badge',
			intent: 'openStudyGoal',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('study_goal') ?? true)
		},
		{
			// 业务功能 19：多端同步入口（功能开关：sync_devices）
			id: 'syncDevices',
			title: '多端同步',
			icon: 'sync',
			intent: 'openSyncDevices',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('sync_devices') ?? true)
		},
		{
			// 业务功能 21：排行榜入口（功能开关：leaderboard）
			id: 'leaderboard',
			title: '排行榜',
			icon: 'chart',
			intent: 'openLeaderboard',
			gate: () => false
		},
		{
			// 业务功能 10：数据导出入口（功能开关：data_export）
			id: 'dataExport',
			title: '数据导出',
			icon: 'folder',
			intent: 'openDataExport',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('data_export') ?? true)
		},
		{
			// 业务功能 12：社区讨论入口（功能开关：community）
			id: 'community',
			title: '社区讨论',
			icon: 'chat',
			intent: 'openCommunity',
			gate: () => false
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
			gate: () => false
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
		},
		{
			// 业务功能 11：管理员仪表盘（功能开关：admin_dashboard，仅 superAdmin）
			id: 'adminDashboard',
			title: '运营仪表盘',
			icon: 'chart',
			intent: 'openAdminDashboard',
			gate: (u) => hasAnyRole(u, ['superAdmin']) && (window.isFeatureEnabled?.('admin_dashboard') ?? true)
		},
		{
			// 业务功能 15：审计日志可视化（功能开关：audit_log_viewer，superAdmin / orgAdmin）
			id: 'auditLog',
			title: '审计日志',
			icon: 'badge',
			intent: 'openAuditLog',
			gate: (u) => hasAnyRole(u, ['superAdmin', 'orgAdmin']) && (window.isFeatureEnabled?.('audit_log_viewer') ?? true)
		},
		{
			// 业务功能 14：PWA 安装入口（功能开关：pwa；按钮仅在浏览器触发 beforeinstallprompt 后可用）
			id: 'installPwa',
			title: '安装应用',
			icon: 'gift',
			intent: 'installPwa',
			gate: () => (window.isFeatureEnabled?.('pwa') ?? true)
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
		window.__openLoginModal?.();
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
		const triggerHost = document.getElementById('exam-library-panel') || document.getElementById('exam-workarea') || document.body;
		if (!trigger) {
			trigger = document.createElement('div');
			trigger.id = 'user-menu-trigger';
			trigger.className = 'pc-trigger';
			triggerHost.appendChild(trigger);
			trigger.onclick = () => {
				if (getContext().guest) {
					openLoginModal();
				} else {
					openPanel();
				}
			};
		} else if (trigger.parentElement !== triggerHost) {
			triggerHost.appendChild(trigger);
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
		// 业务功能 2：异步拉取连续天数与每日目标，填充占位
		void refreshStreakSummary(ctx);
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
			<!-- 业务功能 2：学习连续天数（占位，由 refreshStreakSummary 异步填充） -->
			<div class="pc-summary-stat" id="pc-streak-stat" data-streak-stat>
				<span>连续学习</span>
				<strong>—</strong>
			</div>
			<!-- 业务功能 2：今日目标进度 -->
			<div class="pc-summary-stat" id="pc-goal-stat" data-goal-stat>
				<span>今日目标</span>
				<strong>—</strong>
			</div>
		</div>`;
	}

	// 业务功能 2：异步拉取连续天数与今日目标，填充顶部摘要中的两个占位卡片
	async function refreshStreakSummary(ctx: PCContext): Promise<void> {
		if (ctx.guest || !ctx.id) {
			return;
		}
		// 业务功能 2 的开关：被关闭则隐藏统计卡，且不发请求
		if (window.isFeatureEnabled && !window.isFeatureEnabled('streak')) {
			const root = document.getElementById('pc-streak-stat')?.parentElement;
			if (root) root.querySelectorAll('#pc-streak-stat, #pc-goal-stat').forEach((el) => ((el as HTMLElement).style.display = 'none'));
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getStreakSummary !== 'function') {
			return;  // APIClient 旧版本未注入
		}
		try {
			const data = (await api.getStreakSummary(ctx.id)) as {
				streak_current?: number;
				streak_best?: number;
				today_questions_done?: number;
				daily_goal_questions?: number;
				today_progress?: number;
				today_hit_goal?: boolean;
			};
			const streakEl = document.getElementById('pc-streak-stat');
			const goalEl = document.getElementById('pc-goal-stat');
			if (streakEl) {
				const cur = Number(data.streak_current ?? 0);
				const best = Number(data.streak_best ?? 0);
				const strong = streakEl.querySelector('strong');
				if (strong) {
					strong.innerHTML = `${cur} 天<span style="font-size:11px;color:#999;margin-left:4px;">最高 ${best}</span>`;
				}
			}
			if (goalEl) {
				const done = Number(data.today_questions_done ?? 0);
				const goal = Number(data.daily_goal_questions ?? 0);
				const hit = data.today_hit_goal === true;
				const color = hit ? '#3a7' : '#a33';
				const strong = goalEl.querySelector('strong');
				if (strong) {
					strong.innerHTML = `<span style="color:${color};">${done}</span> / ${goal} 题`;
				}
			}
		} catch {
			// 接口异常时保持占位"—"，不打扰用户
		}
	}

	// 业务功能 4：异步刷新"上次未完成"横幅；无草稿则保持隐藏
	async function refreshResumeBanner(ctx: PCContext): Promise<void> {
		const banner = document.getElementById('pc-resume-banner') as HTMLDivElement | null;
		if (!banner) return;
		if (ctx.guest || !ctx.id) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		// 业务功能 4 的开关：关闭则隐藏横幅，不发请求
		if (window.isFeatureEnabled && !window.isFeatureEnabled('resume_draft')) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		const userId = ctx.id;  // 局部窄化，便于后续闭包使用
		const api = window.APIClient;
		if (!api || typeof api.getDraft !== 'function') {
			banner.hidden = true;
			return;
		}
		try {
			const data = (await api.getDraft(userId)) as
				| {
						exam_id?: string;
						total_questions?: number;
						answered_count?: number;
						last_question_index?: number;
						last_section_index?: number;
						updated_at?: string;
				  }
				| null;
			if (!data || typeof data !== 'object' || !data.exam_id) {
				banner.hidden = true;
				banner.innerHTML = '';
				return;
			}
			const examId = String(data.exam_id);
			const total = Number(data.total_questions ?? 0);
			const answered = Number(data.answered_count ?? 0);
			const updatedAt = String(data.updated_at ?? '');
			banner.hidden = false;
			banner.innerHTML = `
				<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;">
					<div>
						<div style="font-weight:600;">上次未完成的考试</div>
						<div style="font-size:13px;color:#666;margin-top:2px;">
							试卷 <code>${escapeHtmlSafe(examId)}</code> · 已答 ${answered}${total > 0 ? ` / ${total}` : ''} 题 · 更新于 ${escapeHtmlSafe(
				updatedAt
			)}
						</div>
					</div>
					<div style="display:flex;gap:8px;">
						<button class="risk-btn primary" data-resume-action="continue" data-exam-id="${escapeHtmlSafe(
							examId
						)}">继续</button>
						<button class="risk-btn" data-resume-action="discard">放弃</button>
					</div>
				</div>`;
			// 绑定继续/放弃按钮
			banner.onclick = (event: MouseEvent) => {
				const btn = (event.target as HTMLElement | null)?.closest('button[data-resume-action]') as
					| HTMLButtonElement
					| null;
				if (!btn) return;
				const action = btn.dataset.resumeAction;
				if (action === 'discard') {
					btn.disabled = true;
					api
						.clearDraft(userId)
						.then(() => {
							showToast('已放弃上次未完成');
							void refreshResumeBanner(ctx);
						})
						.catch((err: unknown) => {
							btn.disabled = false;
							showToast(readErrorMessage(err, '放弃失败'));
						});
				} else if (action === 'continue') {
					void resumeExam(examId, data);
				}
			};
		} catch {
			banner.hidden = true;
		}
	}

	// 业务功能 6：异步刷新"我的作业"横幅；无作业则保持隐藏
	//   - 仅显示截止时间最近的 3 条
	//   - 点击「去做题」按 exam_id 加载试卷并关闭面板
	async function refreshAssignmentsBanner(ctx: PCContext): Promise<void> {
		const banner = document.getElementById('pc-assignments-banner') as HTMLDivElement | null;
		if (!banner) return;
		if (ctx.guest || !ctx.id) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		// 业务功能 6 的开关
		if (window.isFeatureEnabled && !window.isFeatureEnabled('classrooms')) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.listMyAssignments !== 'function') {
			banner.hidden = true;
			return;
		}
		try {
			const data = (await api.listMyAssignments()) as { items?: Array<Record<string, unknown>> } | null;
			const items = Array.isArray(data?.items) ? (data!.items as Array<Record<string, unknown>>) : [];
			if (items.length === 0) {
				banner.hidden = true;
				banner.innerHTML = '';
				return;
			}
			// 按 due_at 升序，未填 due_at 的排到最后
			items.sort((a, b) => {
				const da = String(a.due_at || '');
				const db = String(b.due_at || '');
				if (!da && !db) return 0;
				if (!da) return 1;
				if (!db) return -1;
				return da.localeCompare(db);
			});
			const top = items.slice(0, 3);
			const rows = top
				.map((it) => {
					const title = escapeHtmlSafe(String(it.title || '未命名作业'));
					const examId = String(it.exam_id || '');
					const dueAt = escapeHtmlSafe(String(it.due_at || '不限期'));
					return `
						<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed #eee;">
							<div>
								<div style="font-size:13px;">${title}</div>
								<div style="font-size:12px;color:#888;">截止：${dueAt} · 试卷 <code>${escapeHtmlSafe(examId)}</code></div>
							</div>
							<button class="risk-btn" data-asg-action="open" data-exam-id="${escapeHtmlSafe(examId)}">去做题</button>
						</div>`;
				})
				.join('');
			banner.hidden = false;
			banner.innerHTML = `
				<div style="padding:12px 16px;">
					<div style="font-weight:600;">📋 我的作业（${items.length}）</div>
					${rows}
				</div>`;
			// 绑定「去做题」按钮：复用 resumeExam(examId, null) 加载试卷
			banner.onclick = (event: MouseEvent) => {
				const btn = (event.target as HTMLElement | null)?.closest('button[data-asg-action="open"]') as
					| HTMLButtonElement
					| null;
				if (!btn) return;
				const examId = btn.dataset.examId || '';
				if (!examId) return;
				void resumeExam(examId, null);
			};
		} catch {
			banner.hidden = true;
		}
	}

	// 业务功能 16：异步刷新"每日一练"横幅
	//   - 拉取 GET /me/daily-practice，展示「今日 X 道，已完成 Y」与「立即开始」按钮
	//   - 受 isFeatureEnabled('daily_practice') 控制
	async function refreshDailyPracticeBanner(ctx: PCContext): Promise<void> {
		const banner = document.getElementById('pc-daily-banner') as HTMLDivElement | null;
		if (!banner) return;
		if (ctx.guest || !ctx.id) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		if (window.isFeatureEnabled && !window.isFeatureEnabled('daily_practice')) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getDailyPractice !== 'function') {
			banner.hidden = true;
			return;
		}
		try {
			const data = (await api.getDailyPractice()) as Record<string, unknown> | null;
			const items = Array.isArray(data?.items) ? (data!.items as Array<Record<string, unknown>>) : [];
			if (items.length === 0) {
				banner.hidden = true;
				banner.innerHTML = '';
				return;
			}
			const completed = Array.isArray(data?.completed_question_ids)
				? (data!.completed_question_ids as unknown[]).map(String)
				: [];
			const date = escapeHtmlSafe(String(data?.date || ''));
			banner.hidden = false;
			banner.innerHTML = `
				<div style="padding:12px 16px;">
					<div style="display:flex;justify-content:space-between;align-items:center;">
						<div>
							<div style="font-weight:600;">🎯 每日一练 · ${date}</div>
							<div style="font-size:12px;color:#888;margin-top:2px;">今日 ${items.length} 题，已完成 ${completed.length}</div>
						</div>
						<div>
							<button class="risk-btn" data-daily-action="open">立即开始</button>
							<button class="risk-btn" data-daily-action="regenerate" style="margin-left:6px;">换一批</button>
						</div>
					</div>
				</div>`;
			banner.onclick = (event: MouseEvent) => {
				const btn = (event.target as HTMLElement | null)?.closest('button[data-daily-action]') as
					| HTMLButtonElement
					| null;
				if (!btn) return;
				const action = btn.dataset.dailyAction;
				if (action === 'open') {
					void openDailyPracticePanel();
				} else if (action === 'regenerate') {
					void regenerateDailyPractice();
				}
			};
		} catch {
			banner.hidden = true;
		}
	}

	// 业务功能 4：执行续考动作
	//   1. 拉取试卷数据 -> 加载到 viewer
	//   2. 若有 last_section_index/last_question_index，则跳转到该题
	//   3. 关闭 PC 抽屉
	async function resumeExam(
		examId: string,
		draft: { last_section_index?: number; last_question_index?: number } | null
	): Promise<void> {
		const api = window.APIClient;
		const viewer = (window as unknown as {
			examViewer?: {
				loadExamData: (data: unknown) => void;
				jumpToQuestion?: (sectionIndex: number, questionIndex: number) => void;
				_currentExamId?: string | null;
			};
		}).examViewer;
		if (!api || typeof api.getExam !== 'function' || !viewer) {
			showToast('当前环境无法直接续考，请手动打开试卷');
			return;
		}
		try {
			const examData = await api.getExam(examId);
			viewer.loadExamData(examData);
			viewer._currentExamId = examId;
			const si = Math.max(0, Number(draft?.last_section_index ?? 0));
			const qi = Math.max(0, Number(draft?.last_question_index ?? 0));
			if (typeof viewer.jumpToQuestion === 'function') {
				try {
					viewer.jumpToQuestion(si, qi);
				} catch {
					// 跳题失败不阻断
				}
			}
			closePanel();
			showToast('已恢复到上次进度');
		} catch (err) {
			showToast(readErrorMessage(err, '续考失败'));
		}
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
			<!-- 业务功能 4：上次未完成续考横幅（异步填充，无草稿时保持 hidden） -->
			<div class="pc-card" id="pc-resume-banner" data-resume-banner hidden></div>
			<!-- 业务功能 6：我的作业横幅（异步填充，无作业时保持 hidden） -->
			<div class="pc-card" id="pc-assignments-banner" data-assignments-banner hidden></div>
			<!-- 业务功能 16：每日一练横幅（异步填充，无可练习时保持 hidden） -->
			<div class="pc-card" id="pc-daily-banner" data-daily-banner hidden></div>
			<!-- 业务功能 18：备考倒计时横幅（异步填充，无目标时保持 hidden） -->
			<div class="pc-card" id="pc-goal-banner" data-goal-banner hidden></div>
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
			case 'openWrongQuestions':
				// 业务功能 1：打开错题本面板
				void openWrongQuestionsPanel();
				break;
			case 'openSrsReview':
				// 业务功能 7：打开 SRS 间隔重复复习面板
				void openSrsReviewPanel();
				break;
			case 'openBookmarkFolders':
				// 业务功能 8：打开收藏夹管理面板
				void openBookmarkFoldersPanel();
				break;
			case 'openDataExport':
				// 业务功能 10：触发数据导出
				void openDataExportPanel();
				break;
			case 'openAdminDashboard':
				// 业务功能 11：打开管理员仪表盘
				void openAdminDashboardPanel();
				break;
			case 'openAuditLog':
				// 业务功能 15：打开审计日志查看器
				void openAuditLogPanel();
				break;
			case 'openDailyPractice':
				// 业务功能 16：打开每日一练
				void openDailyPracticePanel();
				break;
			case 'openLearningReport':
				// 业务功能 17：打开学习报告
				void openLearningReportPanel();
				break;
			case 'openVocabNotebook':
				// 个人生词本
				void openVocabNotebookPanel();
				break;
			case 'openChapterPath':
				// 功能 #18：章节式学习路径
				void openChapterPathPanel();
				break;
			case 'openStudyGoal':
				// 业务功能 18：打开备考目标管理
				void openStudyGoalPanel();
				break;
			case 'openSyncDevices':
				// 业务功能 19：打开多端同步面板
				void openSyncDevicesPanel();
				break;
			case 'openLeaderboard':
				// 业务功能 21：打开排行榜面板
				void openLeaderboardPanel();
				break;
			case 'installPwa':
				// 业务功能 14：触发安装提示；若浏览器尚未派发 beforeinstallprompt 则给出提示
				void triggerPwaInstall();
				break;
			case 'openCommunity':
				// 业务功能 12：打开社区讨论（个人中心入口先 prompt 试卷 ID）
				void openCommunityFromPersonalCenter();
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
				// 业务功能 4：异步刷新"上次未完成"横幅
				void refreshResumeBanner(ctx);
				// 业务功能 6：异步刷新"我的作业"横幅
				void refreshAssignmentsBanner(ctx);
				// 业务功能 16：异步刷新"每日一练"横幅
				void refreshDailyPracticeBanner(ctx);
				// 业务功能 18：异步刷新"备考倒计时"横幅
				void refreshStudyGoalBanner(ctx);
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

	// ===== 错题本（业务功能 1）=====
	// 错题本面板使用独立的 modal DOM 节点，复用既有 risk-* CSS 样式以避免追加样式表。
	let wrongQuestionModal: HTMLDivElement | null = null;
	// 当前筛选状态（保存在闭包内，不持久化）
	let wqStatus: 'active' | 'mastered' | 'all' = 'active';
	let wqSort: 'recent' | 'wrong_count' = 'recent';

	// 功能 #16：错因归因标签注册表（硬编码，与后端 WrongQuestionService::attributionTagRegistry 保持一致）
	const WQ_TAG_REGISTRY: Array<{ key: string; name: string; description: string }> = [
		{ key: 'vocab_blindspot', name: '词汇盲点', description: '生词或词义没掌握' },
		{ key: 'grammar_unsure', name: '语法不熟', description: '句型/活用判断错误' },
		{ key: 'reading_pace', name: '阅读节奏', description: '时间不够或读漏关键句' },
		{ key: 'listening_missed', name: '听力漏听', description: '关键词没抓住/走神' },
		{ key: 'careless', name: '粗心', description: '低级看错题干或填错' },
		{ key: 'option_trap', name: '选项陷阱', description: '被相近干扰项骗到' }
	];

	function ensureWrongQuestionModal(): HTMLDivElement {
		if (wrongQuestionModal) {
			return wrongQuestionModal;
		}
		const el = document.createElement('div');
		el.id = 'wq-modal';
		el.className = 'risk-hidden';
		el.innerHTML = `<div class="risk-backdrop" data-wq-act="close"></div>
			<div class="risk-panel" style="max-width:720px;width:90%;">
				<div class="risk-header"><strong id="wq-title">错题本</strong><button class="risk-close" data-wq-act="close">×</button></div>
				<div id="wq-summary" style="padding:8px 16px;font-size:13px;color:#555;"></div>
				<div id="wq-toolbar" style="display:flex;gap:8px;align-items:center;padding:0 16px 8px 16px;flex-wrap:wrap;font-size:13px;">
					<label>状态
						<select id="wq-status">
							<option value="active">未掌握</option>
							<option value="mastered">已掌握</option>
							<option value="all">全部</option>
						</select>
					</label>
					<label>排序
						<select id="wq-sort">
							<option value="recent">最近错答</option>
							<option value="wrong_count">错次最多</option>
						</select>
					</label>
					<button id="wq-reload" class="risk-btn">刷新</button>
					<button id="wq-reset" class="risk-btn" style="margin-left:auto;color:#a33;">清空错题本</button>
				</div>
				<div class="risk-body" id="wq-body" style="max-height:60vh;overflow:auto;"></div>
				<div class="risk-footer"><button class="risk-btn" data-wq-act="close">关闭</button></div>
			</div>`;
		// 关闭按钮（背景或 × 或底部"关闭"按钮）
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.wqAct === 'close') {
				el.classList.remove('risk-open');
				el.classList.add('risk-hidden');
			}
		});
		document.body.appendChild(el);
		wrongQuestionModal = el;
		return el;
	}

	// HTML 转义工具：避免快照里的内容造成 XSS
	function escapeHtmlSafe(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// 渲染单条错题为 HTML（事件通过事件委托处理）
	function renderWrongQuestionItem(item: Record<string, unknown>): string {
		const qid = String(item.question_id ?? '');
		const examId = String(item.exam_id ?? '');
		const wrongCount = Number(item.wrong_count ?? 0);
		const lastWrongAt = String(item.last_wrong_at ?? '');
		const correctAnswer = String(item.correct_answer ?? '');
		const lastUserAnswer = String(item.last_user_answer ?? '');
		const mastered = item.mastered === true;
		const snap = (item.question_snapshot ?? {}) as Record<string, unknown>;
		// 题干字段在不同题型里键名不同，按优先级取
		const stem = String(snap.question ?? snap.stem ?? snap.passage ?? '');
		const explanation = String(snap.explanation ?? '');
		const optionsRaw = snap.options;
		let optionsHtml = '';
		if (Array.isArray(optionsRaw)) {
			optionsHtml = `<ol style="margin:4px 0 0 18px;padding:0;color:#444;">${optionsRaw
				.map((o) => `<li>${escapeHtmlSafe(String(o))}</li>`)
				.join('')}</ol>`;
		}
		const masteredTag = mastered ? ' · <span style="color:#3a7;">已掌握</span>' : '';
		const masterBtn = mastered
			? `<button class="risk-btn" data-wq-action="unmaster" data-qid="${escapeHtmlSafe(qid)}">取消掌握</button>`
			: `<button class="risk-btn" data-wq-action="master" data-qid="${escapeHtmlSafe(qid)}">标记掌握</button>`;
		// 功能 #16：归因标签 chips
		const activeTags = Array.isArray(item.attribution_tags) ? (item.attribution_tags as unknown[]).map(String) : [];
		const tagsHtml = WQ_TAG_REGISTRY.map((t) => {
			const on = activeTags.includes(t.key);
			return `<button type="button" class="wq-tag-chip${on ? ' on' : ''}" data-wq-action="toggleTag" data-qid="${escapeHtmlSafe(qid)}" data-tag="${escapeHtmlSafe(t.key)}" title="${escapeHtmlSafe(t.description)}" style="margin-right:4px;margin-top:4px;padding:2px 8px;font-size:11px;border-radius:10px;border:1px solid ${on ? '#36a' : '#ccc'};background:${on ? '#e6f0ff' : '#fafafa'};color:${on ? '#36a' : '#666'};cursor:pointer;">${escapeHtmlSafe(t.name)}</button>`;
		}).join('');
		return `<div class="wq-item" style="border-top:1px solid #eee;padding:12px 16px;" data-wq-item-id="${escapeHtmlSafe(qid)}">
			<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#888;">
				<span>题目 ID: ${escapeHtmlSafe(qid)} · 试卷 ${escapeHtmlSafe(examId)} · 错 ${wrongCount} 次${masteredTag}</span>
				<span>${escapeHtmlSafe(lastWrongAt)}</span>
			</div>
			<div style="margin-top:6px;">${escapeHtmlSafe(stem) || '<em style="color:#999;">（无题干快照）</em>'}</div>
			${optionsHtml}
			<div style="margin-top:6px;font-size:13px;">
				<span style="color:#3a7;">正确答案：${escapeHtmlSafe(correctAnswer)}</span>
				<span style="margin-left:12px;color:#a33;">你的答案：${escapeHtmlSafe(lastUserAnswer)}</span>
			</div>
			${
				explanation
					? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#36a;">查看解析</summary><div style="margin-top:6px;color:#555;white-space:pre-wrap;">${escapeHtmlSafe(
							explanation
					  )}</div></details>`
					: ''
			}
			<div style="margin-top:6px;font-size:11px;color:#888;">错因归因（点击切换）：<span class="wq-tag-status" data-qid="${escapeHtmlSafe(qid)}"></span></div>
			<div style="margin-top:2px;">${tagsHtml}</div>
			<div class="wq-related" data-qid="${escapeHtmlSafe(qid)}" data-exam="${escapeHtmlSafe(examId)}" style="margin-top:6px;"></div>
			<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
				${masterBtn}
				<button class="risk-btn" data-wq-action="related" data-qid="${escapeHtmlSafe(qid)}" data-exam="${escapeHtmlSafe(examId)}">📚 同考点串题</button>
				<button class="risk-btn" data-wq-action="remove" data-qid="${escapeHtmlSafe(qid)}" style="color:#a33;">移出错题本</button>
			</div>
		</div>`;
	}

	async function reloadWrongQuestions(modal: HTMLDivElement, userId: string): Promise<void> {
		const api = window.APIClient;
		const body = modal.querySelector('#wq-body') as HTMLDivElement | null;
		const summary = modal.querySelector('#wq-summary') as HTMLDivElement | null;
		if (!api || typeof api.getWrongQuestions !== 'function' || !body) {
			if (body) body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">接口不可用</div>';
			return;
		}
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		try {
			const result = (await api.getWrongQuestions(userId, { status: wqStatus, sort: wqSort, pageSize: 50 })) as {
				items?: Record<string, unknown>[];
				total?: number;
				summary?: { total?: number; active?: number; mastered?: number };
			};
			const items = result.items ?? [];
			const sm = result.summary ?? {};
			if (summary) {
				const tagSummary = (sm as Record<string, unknown>).tag_summary as Record<string, number> | undefined;
				let tagLine = '';
				if (tagSummary && Object.keys(tagSummary).length > 0) {
					const parts = WQ_TAG_REGISTRY
						.filter((t) => tagSummary[t.key])
						.map((t) => `<span style="margin-right:8px;color:#36a;">${escapeHtmlSafe(t.name)} ${tagSummary[t.key]}</span>`);
					if (parts.length > 0) {
						tagLine = `<div style="margin-top:4px;font-size:11px;">归因分布：${parts.join('')}</div>`;
					}
				}
				summary.innerHTML = `共 <b>${sm.total ?? 0}</b> 题 · 待掌握 <b style="color:#a33;">${
					sm.active ?? 0
				}</b> · 已掌握 <b style="color:#3a7;">${sm.mastered ?? 0}</b>${tagLine}`;
			}
			if (items.length === 0) {
				body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">暂无错题，继续加油！</div>';
				return;
			}
			body.innerHTML = items.map(renderWrongQuestionItem).join('');
		} catch (error) {
			body.innerHTML = `<div style="padding:24px;text-align:center;color:#a33;">加载失败：${escapeHtmlSafe(
				readErrorMessage(error, '未知错误')
			)}</div>`;
		}
	}

	async function openWrongQuestionsPanel(): Promise<void> {
		const ctx = getContext();
		const userId = ctx.id || '';
		if (!userId) {
			showToast('请先登录后查看错题本');
			return;
		}
		const modal = ensureWrongQuestionModal();
		modal.classList.remove('risk-hidden');
		modal.classList.add('risk-open');

		// 同步下拉框为当前状态
		const statusSel = modal.querySelector('#wq-status') as HTMLSelectElement | null;
		const sortSel = modal.querySelector('#wq-sort') as HTMLSelectElement | null;
		if (statusSel) statusSel.value = wqStatus;
		if (sortSel) sortSel.value = wqSort;

		// 绑定事件（每次打开重新覆盖 onchange/onclick，避免重复触发）
		if (statusSel) {
			statusSel.onchange = () => {
				wqStatus = (statusSel.value as 'active' | 'mastered' | 'all') || 'active';
				void reloadWrongQuestions(modal, userId);
			};
		}
		if (sortSel) {
			sortSel.onchange = () => {
				wqSort = (sortSel.value as 'recent' | 'wrong_count') || 'recent';
				void reloadWrongQuestions(modal, userId);
			};
		}
		const reloadBtn = modal.querySelector('#wq-reload') as HTMLButtonElement | null;
		if (reloadBtn) reloadBtn.onclick = () => void reloadWrongQuestions(modal, userId);
		const resetBtn = modal.querySelector('#wq-reset') as HTMLButtonElement | null;
		if (resetBtn) {
			resetBtn.onclick = () => {
				confirmRisk('清空错题本', '清空错题本', () => {
					const api = window.APIClient;
					if (!api || typeof api.resetWrongQuestions !== 'function') {
						return;
					}
					api
						.resetWrongQuestions(userId)
						.then(() => {
							showToast('错题本已清空');
							void reloadWrongQuestions(modal, userId);
						})
						.catch((err: unknown) => showToast(readErrorMessage(err, '清空失败')));
				});
			};
		}

		// 列表区域的事件委托：处理"移除/标记掌握/取消掌握/切换标签/同考点串题"
		const body = modal.querySelector('#wq-body') as HTMLDivElement | null;
		if (body) {
			body.onclick = (event: MouseEvent) => {
				const btn = (event.target as HTMLElement | null)?.closest('[data-wq-action]') as
					| HTMLElement
					| null;
				if (!btn) return;
				const qid = btn.dataset.qid || '';
				const action = btn.dataset.wqAction || '';
				const api = window.APIClient;
				if (!api || (!qid && action !== 'gotoExam')) return;
				// 归因标签切换
				if (action === 'toggleTag') {
					const tag = btn.dataset.tag || '';
					if (!tag || typeof api.setWrongQuestionTags !== 'function') return;
					const itemEl = btn.closest('.wq-item') as HTMLElement | null;
					if (!itemEl) return;
					const chips = itemEl.querySelectorAll('button[data-wq-action="toggleTag"]') as NodeListOf<HTMLButtonElement>;
					const status = itemEl.querySelector(`.wq-tag-status[data-qid="${qid}"]`) as HTMLSpanElement | null;
					// 前端切换视觉态并收集最终标签集合
					btn.classList.toggle('on');
					const onNow = btn.classList.contains('on');
					btn.style.border = `1px solid ${onNow ? '#36a' : '#ccc'}`;
					btn.style.background = onNow ? '#e6f0ff' : '#fafafa';
					btn.style.color = onNow ? '#36a' : '#666';
					const tags: string[] = [];
					chips.forEach((c) => {
						if (c.classList.contains('on') && c.dataset.tag) tags.push(c.dataset.tag);
					});
					if (status) status.textContent = '保存中…';
					api
						.setWrongQuestionTags(userId, qid, tags)
						.then(() => {
							if (status) {
								status.textContent = '✓ 已保存';
								setTimeout(() => { if (status) status.textContent = ''; }, 1000);
							}
						})
						.catch((err: unknown) => {
							if (status) status.textContent = '';
							showToast(readErrorMessage(err, '保存归因失败'));
						});
					return;
				}
				// 同考点串题：展开到 .wq-related
				if (action === 'related') {
					const examId = btn.dataset.exam || '';
					if (!examId || typeof api.getRelatedQuestions !== 'function') return;
					const itemEl = btn.closest('.wq-item') as HTMLElement | null;
					const holder = itemEl?.querySelector(`.wq-related[data-qid="${qid}"]`) as HTMLDivElement | null;
					if (!holder) return;
					if (holder.dataset.loaded === '1') {
						holder.innerHTML = '';
						holder.dataset.loaded = '';
						return;
					}
					holder.innerHTML = '<div style="padding:6px 8px;color:#888;font-size:12px;">加载中…</div>';
					api
						.getRelatedQuestions(examId, qid, 8)
						.then((data: unknown) => {
							const d = (data as { items?: Array<Record<string, unknown>>; target_words?: unknown[] }) || {};
							const words = Array.isArray(d.target_words) ? d.target_words.map(String) : [];
							const items = d.items || [];
							if (items.length === 0) {
								holder.innerHTML = `<div style="padding:6px 8px;color:#888;font-size:12px;border-left:3px solid #ccd;background:#f7f7fb;">未找到同 target_words 的串题${words.length ? `（考点词：${words.map(escapeHtmlSafe).join('、')}）` : ''}</div>`;
							} else {
								const header = `<div style="padding:6px 8px;color:#555;font-size:12px;background:#f2f6ff;border-left:3px solid #36a;">📚 共 ${items.length} 题同考点${words.length ? `（${words.map(escapeHtmlSafe).join('、')}）` : ''}</div>`;
								const rows = items
									.map((it) => {
										const matched = Array.isArray(it.matched_words) ? (it.matched_words as unknown[]).map(String) : [];
										const stem = String(it.stem || '').slice(0, 80);
										const exam = String(it.exam_id || '');
										const id = String(it.question_id || '');
										return `<div style="padding:6px 8px;border-bottom:1px dashed #eee;font-size:12px;">
											<div style="display:flex;gap:6px;align-items:center;">
												<code style="font-size:11px;color:#888;">${escapeHtmlSafe(exam)} · ${escapeHtmlSafe(id)}</code>
												<span style="font-size:11px;color:#36a;">匹配：${matched.map(escapeHtmlSafe).join('、')}</span>
												<a href="#" data-wq-action="gotoExam" data-exam="${escapeHtmlSafe(exam)}" style="margin-left:auto;color:#36a;">去做这题 →</a>
											</div>
											<div style="margin-top:3px;color:#444;">${escapeHtmlSafe(stem)}</div>
										</div>`;
									})
									.join('');
								holder.innerHTML = `<div style="border:1px solid #dde;border-radius:4px;background:#fff;">${header}${rows}</div>`;
							}
							holder.dataset.loaded = '1';
						})
						.catch((err: unknown) => {
							holder.innerHTML = `<div style="padding:6px 8px;color:#a33;font-size:12px;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
						});
					return;
				}
				// 跳转到指定试卷
				if (action === 'gotoExam') {
					const exam = btn.dataset.exam || '';
					if (!exam) return;
					event.preventDefault();
					modal.classList.remove('risk-open');
					modal.classList.add('risk-hidden');
					const w = window as unknown as { openExam?: (id: string) => void };
					if (typeof w.openExam === 'function') w.openExam(exam);
					else window.location.hash = `#exam=${encodeURIComponent(exam)}`;
					return;
				}
				let promise: Promise<unknown> | null = null;
				if (action === 'remove' && typeof api.removeWrongQuestion === 'function') {
					promise = api.removeWrongQuestion(userId, qid);
				} else if (action === 'master' && typeof api.masterWrongQuestion === 'function') {
					promise = api.masterWrongQuestion(userId, qid);
				} else if (action === 'unmaster' && typeof api.unmasterWrongQuestion === 'function') {
					promise = api.unmasterWrongQuestion(userId, qid);
				}
				if (!promise) return;
				if (btn instanceof HTMLButtonElement) btn.disabled = true;
				promise
					.then(() => reloadWrongQuestions(modal, userId))
					.catch((err: unknown) => {
						if (btn instanceof HTMLButtonElement) btn.disabled = false;
						showToast(readErrorMessage(err, '操作失败'));
					});
			};
		}

		await reloadWrongQuestions(modal, userId);
	}

	// 业务功能 7：SRS 间隔重复复习面板
	//   - 拉取 due 列表
	//   - 渲染当前卡（题面 + 答案揭示）+ 0/1/2/3 评分按钮
	//   - 评分后取下一张；列表空则显示"今日已复习完毕"
	let srsModal: HTMLDivElement | null = null;
	function ensureSrsModal(): HTMLDivElement {
		if (srsModal) return srsModal;
		const modal = document.createElement('div');
		modal.className = 'risk-modal risk-hidden';
		modal.id = 'srs-modal';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:480px;max-width:680px;max-height:80vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">📚 今日复习（间隔重复）</h3>
					<button id="srs-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="srs-body" style="min-height:120px;"></div>
				<div id="srs-footer" style="margin-top:14px;display:none;text-align:center;">
					<div style="margin-bottom:8px;color:#666;font-size:12px;">回想一下，你掌握得如何？</div>
					<button class="srs-grade" data-grade="0" style="margin:0 4px;padding:8px 14px;background:#e74c3c;color:#fff;border:0;border-radius:4px;cursor:pointer;">再来</button>
					<button class="srs-grade" data-grade="1" style="margin:0 4px;padding:8px 14px;background:#f39c12;color:#fff;border:0;border-radius:4px;cursor:pointer;">困难</button>
					<button class="srs-grade" data-grade="2" style="margin:0 4px;padding:8px 14px;background:#2ecc71;color:#fff;border:0;border-radius:4px;cursor:pointer;">良好</button>
					<button class="srs-grade" data-grade="3" style="margin:0 4px;padding:8px 14px;background:#3498db;color:#fff;border:0;border-radius:4px;cursor:pointer;">容易</button>
				</div>
			</div>`;
		document.body.appendChild(modal);
		srsModal = modal;
		// 关闭
		(modal.querySelector('#srs-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	function renderSrsCard(card: Record<string, unknown> | null): string {
		if (!card) {
			return '<div style="padding:24px;text-align:center;color:#3a7;">🎉 今日复习已完成，明天见！</div>';
		}
		const snapshot = (card.snapshot as Record<string, unknown>) || {};
		const question = String(snapshot.question || '(无题面快照)');
		const correct = String(snapshot.correct_answer || '');
		const explanation = String(snapshot.explanation || '');
		const optionsHtml = Array.isArray(snapshot.options)
			? `<ul style="margin:8px 0;padding-left:20px;">${(snapshot.options as unknown[])
					.map((o) => `<li>${escapeHtmlSafe(String(o))}</li>`)
					.join('')}</ul>`
			: '';
		return `
			<div>
				<div style="font-size:12px;color:#999;margin-bottom:6px;">试卷 <code>${escapeHtmlSafe(String(card.exam_id || ''))}</code> · 题 <code>${escapeHtmlSafe(String(card.question_id || ''))}</code></div>
				<div style="font-size:14px;margin-bottom:8px;">${escapeHtmlSafe(question)}</div>
				${optionsHtml}
				<details style="margin-top:8px;">
					<summary style="cursor:pointer;color:#1976d2;">查看答案与解析</summary>
					<div style="margin-top:6px;padding:8px;background:#f5f5f5;border-radius:4px;">
						<div><strong>答案：</strong>${escapeHtmlSafe(correct)}</div>
						${explanation ? `<div style="margin-top:4px;color:#666;">${escapeHtmlSafe(explanation)}</div>` : ''}
					</div>
				</details>
			</div>`;
	}

	async function loadAndRenderSrsCard(modal: HTMLDivElement, userId: string): Promise<void> {
		const body = modal.querySelector('#srs-body') as HTMLDivElement;
		const footer = modal.querySelector('#srs-footer') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		footer.style.display = 'none';
		const api = window.APIClient;
		if (!api || typeof api.listSrsDue !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 SRS API 未注入</div>';
			return;
		}
		try {
			const data = (await api.listSrsDue(userId, 1)) as { items?: Array<Record<string, unknown>> } | null;
			const items = Array.isArray(data?.items) ? data!.items : [];
			const card = items[0] || null;
			body.innerHTML = renderSrsCard(card);
			body.dataset.cardId = card ? String(card.card_id || '') : '';
			footer.style.display = card ? 'block' : 'none';
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openSrsReviewPanel(): Promise<void> {
		const ctx = getContext();
		const userId = ctx.id || '';
		if (!userId) {
			showToast('请先登录后开始复习');
			return;
		}
		const modal = ensureSrsModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';

		// 评分按钮事件（每次打开覆盖）
		const footer = modal.querySelector('#srs-footer') as HTMLDivElement;
		footer.onclick = async (e: MouseEvent) => {
			const btn = (e.target as HTMLElement | null)?.closest('button[data-grade]') as HTMLButtonElement | null;
			if (!btn) return;
			const grade = Number(btn.dataset.grade ?? -1);
			const body = modal.querySelector('#srs-body') as HTMLDivElement;
			const cardId = body.dataset.cardId || '';
			if (!cardId) return;
			const api = window.APIClient;
			if (!api || typeof api.reviewSrsCard !== 'function') return;
			footer.querySelectorAll<HTMLButtonElement>('button.srs-grade').forEach((b) => (b.disabled = true));
			try {
				await api.reviewSrsCard(userId, cardId, grade);
				await loadAndRenderSrsCard(modal, userId);
			} catch (err) {
				showToast(readErrorMessage(err, '评分失败'));
			} finally {
				footer.querySelectorAll<HTMLButtonElement>('button.srs-grade').forEach((b) => (b.disabled = false));
			}
		};

		await loadAndRenderSrsCard(modal, userId);
	}

	// 业务功能 8：收藏夹/分类管理面板
	let bookmarkFoldersModal: HTMLDivElement | null = null;
	function ensureBookmarkFoldersModal(): HTMLDivElement {
		if (bookmarkFoldersModal) return bookmarkFoldersModal;
		const modal = document.createElement('div');
		modal.id = 'bf-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:760px;max-height:80vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">📁 我的收藏夹</h3>
					<div>
						<button id="bf-add" style="margin-right:8px;padding:6px 12px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">+ 新建文件夹</button>
						<button id="bf-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="bf-body" style="min-height:120px;"></div>
			</div>`;
		document.body.appendChild(modal);
		bookmarkFoldersModal = modal;
		(modal.querySelector('#bf-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	function renderBookmarkFolders(folders: Array<Record<string, unknown>>): string {
		if (folders.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">还没有收藏夹，点右上角新建一个吧～</div>';
		}
		return folders
			.map((f) => {
				const fid = String(f.folder_id || '');
				const name = escapeHtmlSafe(String(f.name || '未命名'));
				const color = String(f.color || '#1976d2');
				const examIds = Array.isArray(f.exam_ids) ? (f.exam_ids as unknown[]) : [];
				const examsHtml = examIds.length === 0
					? '<div style="font-size:12px;color:#999;padding:6px 0;">（暂无试卷）</div>'
					: examIds
							.map((ex) => {
								const id = escapeHtmlSafe(String(ex));
								return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px dashed #eee;">
									<code style="font-size:12px;">${id}</code>
									<button data-bf-action="remove-exam" data-fid="${escapeHtmlSafe(fid)}" data-exam-id="${id}" style="font-size:11px;padding:2px 8px;cursor:pointer;">移除</button>
								</div>`;
							})
							.join('');
				return `
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:10px;border-left:4px solid ${escapeHtmlSafe(color || '#1976d2')};">
						<div style="display:flex;justify-content:space-between;align-items:center;">
							<div style="font-weight:600;">${name} <span style="color:#999;font-weight:normal;font-size:12px;">（${examIds.length}）</span></div>
							<div>
								<button data-bf-action="rename" data-fid="${escapeHtmlSafe(fid)}" style="margin-right:6px;font-size:12px;padding:2px 8px;cursor:pointer;">重命名</button>
								<button data-bf-action="delete" data-fid="${escapeHtmlSafe(fid)}" style="font-size:12px;padding:2px 8px;cursor:pointer;color:#a33;">删除</button>
							</div>
						</div>
						<div style="margin-top:8px;">${examsHtml}</div>
					</div>`;
			})
			.join('');
	}

	async function reloadBookmarkFolders(modal: HTMLDivElement, userId: string): Promise<void> {
		const body = modal.querySelector('#bf-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.listBookmarkFolders !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.listBookmarkFolders(userId)) as { items?: Array<Record<string, unknown>> } | null;
			const items = Array.isArray(data?.items) ? data!.items : [];
			body.innerHTML = renderBookmarkFolders(items);
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openBookmarkFoldersPanel(): Promise<void> {
		const ctx = getContext();
		const userId = ctx.id || '';
		if (!userId) {
			showToast('请先登录后管理收藏夹');
			return;
		}
		const modal = ensureBookmarkFoldersModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';

		// 新建按钮（每次重新绑定）
		const addBtn = modal.querySelector('#bf-add') as HTMLButtonElement;
		addBtn.onclick = async () => {
			const name = window.prompt('请输入收藏夹名称（最多 50 字）');
			if (!name) return;
			const api = window.APIClient;
			if (!api || typeof api.createBookmarkFolder !== 'function') return;
			try {
				await api.createBookmarkFolder(userId, name.trim());
				await reloadBookmarkFolders(modal, userId);
			} catch (err) {
				showToast(readErrorMessage(err, '创建失败'));
			}
		};

		// 列表区域事件委托：重命名/删除/移除试卷
		const body = modal.querySelector('#bf-body') as HTMLDivElement;
		body.onclick = async (e: MouseEvent) => {
			const btn = (e.target as HTMLElement | null)?.closest('button[data-bf-action]') as HTMLButtonElement | null;
			if (!btn) return;
			const action = btn.dataset.bfAction || '';
			const fid = btn.dataset.fid || '';
			const api = window.APIClient;
			if (!api || !fid) return;
			try {
				if (action === 'rename' && typeof api.updateBookmarkFolder === 'function') {
					const next = window.prompt('新的文件夹名称');
					if (!next) return;
					await api.updateBookmarkFolder(userId, fid, { name: next.trim() });
				} else if (action === 'delete' && typeof api.removeBookmarkFolder === 'function') {
					if (!window.confirm('确定要删除这个文件夹吗？')) return;
					await api.removeBookmarkFolder(userId, fid);
				} else if (action === 'remove-exam' && typeof api.removeExamFromBookmarkFolder === 'function') {
					const examId = btn.dataset.examId || '';
					if (!examId) return;
					await api.removeExamFromBookmarkFolder(userId, fid, examId);
				}
				await reloadBookmarkFolders(modal, userId);
			} catch (err) {
				showToast(readErrorMessage(err, '操作失败'));
			}
		};

		await reloadBookmarkFolders(modal, userId);
	}

	// 业务功能 10：数据导出 —— 拉取 JSON 快照并触发浏览器下载
	async function openDataExportPanel(): Promise<void> {
		const ctx = getContext();
		const userId = ctx.id || '';
		if (!userId) {
			showToast('请先登录后导出数据');
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.exportUserData !== 'function') {
			showToast('客户端 API 未注入');
			return;
		}
		showToast('正在准备数据导出…');
		try {
			const data = await api.exportUserData(userId);
			// 直接生成本地 Blob 下载，避免再走一次后端
			const json = JSON.stringify(data, null, 2);
			const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			a.href = url;
			a.download = `exam-online-export-${userId}-${ts}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			showToast('数据已导出');
		} catch (err) {
			showToast(readErrorMessage(err, '导出失败'));
		}
	}

	// 业务功能 11：管理员仪表盘弹窗
	let adminDashboardModal: HTMLDivElement | null = null;
	function ensureAdminDashboardModal(): HTMLDivElement {
		if (adminDashboardModal) return adminDashboardModal;
		const modal = document.createElement('div');
		modal.id = 'admin-dashboard-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:820px;max-height:80vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">📊 运营仪表盘</h3>
					<div>
						<button id="ad-refresh" style="margin-right:8px;padding:6px 12px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">刷新</button>
						<button id="ad-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="ad-body" style="min-height:160px;"></div>
				<div style="margin-top:12px;font-size:11px;color:#999;">仅 superAdmin 可见；数据按需扫描，可能略有延迟。</div>
			</div>`;
		document.body.appendChild(modal);
		adminDashboardModal = modal;
		(modal.querySelector('#ad-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	function renderAdminOverview(data: Record<string, unknown>): string {
		const users = (data.users || {}) as Record<string, unknown>;
		const orgs = (data.organizations || {}) as Record<string, unknown>;
		const content = (data.content || {}) as Record<string, unknown>;
		const activity = (data.activity || {}) as Record<string, unknown>;
		const byRole = (users.by_role || {}) as Record<string, number>;
		const roleRows = Object.keys(byRole)
			.sort()
			.map((k) => `<tr><td style="padding:4px 8px;color:#666;">${escapeHtmlSafe(k)}</td><td style="padding:4px 8px;text-align:right;">${Number(byRole[k] || 0)}</td></tr>`)
			.join('');

		const card = (title: string, value: unknown, hint?: string): string => `
			<div style="flex:1;min-width:140px;border:1px solid #eee;border-radius:6px;padding:12px;">
				<div style="font-size:12px;color:#888;">${escapeHtmlSafe(title)}</div>
				<div style="font-size:22px;font-weight:600;margin-top:4px;">${Number(value || 0)}</div>
				${hint ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">${escapeHtmlSafe(hint)}</div>` : ''}
			</div>`;

		return `
			<div style="font-size:11px;color:#999;margin-bottom:8px;">生成时间：${escapeHtmlSafe(String(data.generated_at || ''))}</div>
			<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
				${card('用户总数', users.total)}
				${card('组织总数', orgs.total)}
				${card('试卷文件', content.exam_files)}
				${card('答题用户', activity.answer_users, '有答题记录')}
				${card('答题快照', activity.answer_papers, '所有用户合计')}
				${card('错题用户', activity.wrong_question_users)}
				${card('SRS 用户', activity.srs_users)}
				${card('收藏夹用户', activity.bookmark_folder_users)}
				${card('反馈试卷', activity.feedback_papers)}
				${card('反馈条目', activity.feedback_items)}
			</div>
			<div>
				<div style="font-weight:600;margin-bottom:6px;">用户角色分布</div>
				<table style="border-collapse:collapse;width:100%;font-size:13px;">
					<tbody>${roleRows || '<tr><td style="padding:6px 8px;color:#999;">（无）</td></tr>'}</tbody>
				</table>
			</div>`;
	}

	async function reloadAdminOverview(modal: HTMLDivElement): Promise<void> {
		const body = modal.querySelector('#ad-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.getAdminStatisticsOverview !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.getAdminStatisticsOverview()) as Record<string, unknown> | null;
			body.innerHTML = renderAdminOverview(data || {});
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openAdminDashboardPanel(): Promise<void> {
		const modal = ensureAdminDashboardModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		(modal.querySelector('#ad-refresh') as HTMLButtonElement).onclick = () => {
			void reloadAdminOverview(modal);
		};
		await reloadAdminOverview(modal);
	}

	// 业务功能 12：社区讨论面板
	//   - 入口 1：个人中心 → prompt 输入 paperId
	//   - 入口 2：window.openCommunityPanel(paperId) 供 ExamViewer 集成
	let communityModal: HTMLDivElement | null = null;
	let communityCurrentPaperId: string = '';

	function ensureCommunityModal(): HTMLDivElement {
		if (communityModal) return communityModal;
		const modal = document.createElement('div');
		modal.id = 'community-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:820px;max-height:85vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">💬 社区讨论 <span id="cm-paper" style="color:#999;font-size:12px;font-weight:normal;"></span></h3>
					<div>
						<button id="cm-new" style="margin-right:8px;padding:6px 12px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">+ 发帖</button>
						<button id="cm-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">刷新</button>
						<button id="cm-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="cm-body" style="min-height:160px;"></div>
			</div>`;
		document.body.appendChild(modal);
		communityModal = modal;
		(modal.querySelector('#cm-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	function renderCommunityPosts(posts: Array<Record<string, unknown>>, selfId: string): string {
		if (posts.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">还没有讨论，来发第一条吧～</div>';
		}
		return posts
			.map((p) => {
				const pid = String(p.post_id || '');
				const title = escapeHtmlSafe(String(p.title || ''));
				const body = escapeHtmlSafe(String(p.body || ''));
				const author = escapeHtmlSafe(String(p.author_name || p.author_id || '匿名'));
				const created = escapeHtmlSafe(String(p.created_at || ''));
				const likes = Array.isArray(p.likes) ? (p.likes as unknown[]) : [];
				const likedBySelf = likes.some((u) => String(u) === selfId);
				const comments = Array.isArray(p.comments) ? (p.comments as Array<Record<string, unknown>>) : [];
				const isOwner = String(p.author_id || '') === selfId;

				const commentsHtml = comments
					.map((c) => `
						<div style="border-top:1px dashed #eee;padding:6px 0;font-size:12px;">
							<span style="color:#666;font-weight:600;">${escapeHtmlSafe(String(c.author_name || c.author_id || '匿名'))}</span>
							<span style="color:#aaa;margin-left:6px;">${escapeHtmlSafe(String(c.created_at || ''))}</span>
							<div style="margin-top:2px;white-space:pre-wrap;">${escapeHtmlSafe(String(c.body || ''))}</div>
						</div>`)
					.join('');

				return `
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;margin-bottom:12px;">
						<div style="display:flex;justify-content:space-between;align-items:flex-start;">
							<div style="flex:1;">
								<div style="font-weight:600;font-size:14px;">${title}</div>
								<div style="font-size:11px;color:#999;margin-top:2px;">${author} · ${created}</div>
							</div>
							${isOwner ? `<button data-cm-action="delete" data-pid="${escapeHtmlSafe(pid)}" style="font-size:12px;padding:2px 8px;cursor:pointer;color:#a33;">删除</button>` : ''}
						</div>
						<div style="margin:8px 0;white-space:pre-wrap;font-size:13px;">${body}</div>
						<div style="display:flex;gap:8px;align-items:center;font-size:12px;">
							<button data-cm-action="like" data-pid="${escapeHtmlSafe(pid)}" style="padding:2px 10px;cursor:pointer;${likedBySelf ? 'background:#ffebee;color:#c62828;border:1px solid #ef9a9a;' : ''}">
								${likedBySelf ? '♥' : '♡'} ${likes.length}
							</button>
							<span style="color:#999;">评论 ${comments.length}</span>
						</div>
						<div style="margin-top:6px;">${commentsHtml}</div>
						<div style="display:flex;gap:6px;margin-top:8px;">
							<input type="text" data-cm-comment-input="${escapeHtmlSafe(pid)}" placeholder="写一条评论…" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid #ddd;border-radius:4px;" />
							<button data-cm-action="comment" data-pid="${escapeHtmlSafe(pid)}" style="padding:4px 12px;font-size:12px;cursor:pointer;">发送</button>
						</div>
					</div>`;
			})
			.join('');
	}

	async function reloadCommunity(modal: HTMLDivElement): Promise<void> {
		const body = modal.querySelector('#cm-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.listCommunityPosts !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const ctx = getContext();
			const data = (await api.listCommunityPosts(communityCurrentPaperId)) as { posts?: Array<Record<string, unknown>> } | null;
			const posts = Array.isArray(data?.posts) ? data!.posts : [];
			body.innerHTML = renderCommunityPosts(posts, ctx.id || '');
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openCommunityPanel(paperId: string): Promise<void> {
		if (!paperId) {
			showToast('未指定试卷');
			return;
		}
		communityCurrentPaperId = paperId;
		const modal = ensureCommunityModal();
		(modal.querySelector('#cm-paper') as HTMLSpanElement).textContent = `（${paperId}）`;
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';

		// 发帖
		(modal.querySelector('#cm-new') as HTMLButtonElement).onclick = async () => {
			const title = window.prompt('帖子标题（≤80）');
			if (!title) return;
			const body = window.prompt('帖子内容（≤2000）');
			if (!body) return;
			const api = window.APIClient;
			if (!api || typeof api.createCommunityPost !== 'function') return;
			try {
				await api.createCommunityPost(communityCurrentPaperId, title.trim(), body.trim());
				await reloadCommunity(modal);
			} catch (err) {
				showToast(readErrorMessage(err, '发帖失败'));
			}
		};

		// 刷新
		(modal.querySelector('#cm-refresh') as HTMLButtonElement).onclick = () => {
			void reloadCommunity(modal);
		};

		// 列表区域事件委托：删除/点赞/评论
		const body = modal.querySelector('#cm-body') as HTMLDivElement;
		body.onclick = async (e: MouseEvent) => {
			const btn = (e.target as HTMLElement | null)?.closest('button[data-cm-action]') as HTMLButtonElement | null;
			if (!btn) return;
			const action = btn.dataset.cmAction || '';
			const pid = btn.dataset.pid || '';
			const api = window.APIClient;
			if (!api || !pid) return;
			try {
				if (action === 'delete' && typeof api.deleteCommunityPost === 'function') {
					if (!window.confirm('确定要删除这条帖子吗？')) return;
					await api.deleteCommunityPost(communityCurrentPaperId, pid);
				} else if (action === 'like' && typeof api.toggleCommunityLike === 'function') {
					await api.toggleCommunityLike(communityCurrentPaperId, pid);
				} else if (action === 'comment' && typeof api.addCommunityComment === 'function') {
					const input = body.querySelector(`input[data-cm-comment-input="${pid}"]`) as HTMLInputElement | null;
					const text = input ? input.value.trim() : '';
					if (!text) return;
					await api.addCommunityComment(communityCurrentPaperId, pid, text);
					if (input) input.value = '';
				}
				await reloadCommunity(modal);
			} catch (err) {
				showToast(readErrorMessage(err, '操作失败'));
			}
		};

		await reloadCommunity(modal);
	}

	// ---------------------------------------------------------------------
	// 业务功能 15：审计日志可视化面板
	//   - superAdmin：可任意指定 org_id
	//   - orgAdmin：后端会强制限制到本人所属组织
	//   - 支持筛选：org_id / actor_id / action / since / until
	//   - 支持分页（offset/limit）与 CSV 导出（前端本地转换）
	// ---------------------------------------------------------------------
	let auditLogModal: HTMLDivElement | null = null;
	const auditLogState: {
		offset: number;
		limit: number;
		lastTotal: number;
		lastItems: Array<Record<string, unknown>>;
		actions: string[];
	} = { offset: 0, limit: 50, lastTotal: 0, lastItems: [], actions: [] };

	function ensureAuditLogModal(): HTMLDivElement {
		if (auditLogModal) return auditLogModal;
		const isSuper = hasAnyRole(getContext(), ['superAdmin']);
		const orgInput = isSuper
			? `<label style="font-size:12px;color:#666;">组织 ID <input id="al-org" type="text" placeholder="留空=全部" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;width:120px;" /></label>`
			: '';
		const modal = document.createElement('div');
		modal.id = 'audit-log-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:760px;max-width:1080px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">📜 审计日志</h3>
					<div>
						<button id="al-export" style="margin-right:8px;padding:6px 12px;cursor:pointer;">导出 CSV</button>
						<button id="al-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px;padding:10px;background:#f7f7f7;border-radius:6px;font-size:12px;">
					${orgInput}
					<label style="font-size:12px;color:#666;">操作 <select id="al-action" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;"><option value="">全部</option></select></label>
					<label style="font-size:12px;color:#666;">操作者 <input id="al-actor" type="text" placeholder="user_id" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;width:140px;" /></label>
					<label style="font-size:12px;color:#666;">起始 <input id="al-since" type="datetime-local" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;" /></label>
					<label style="font-size:12px;color:#666;">截止 <input id="al-until" type="datetime-local" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;" /></label>
					<label style="font-size:12px;color:#666;">每页 <input id="al-limit" type="number" min="1" max="500" value="50" style="margin-left:4px;padding:4px 6px;border:1px solid #ccc;border-radius:4px;width:70px;" /></label>
					<button id="al-search" style="padding:6px 14px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">查询</button>
					<button id="al-reset" style="padding:6px 12px;cursor:pointer;">重置</button>
				</div>
				<div id="al-summary" style="font-size:11px;color:#999;margin-bottom:6px;"></div>
				<div id="al-body" style="min-height:200px;"></div>
				<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
					<button id="al-prev" style="padding:6px 14px;cursor:pointer;">← 上一页</button>
					<span id="al-page" style="font-size:12px;color:#666;"></span>
					<button id="al-next" style="padding:6px 14px;cursor:pointer;">下一页 →</button>
				</div>
			</div>`;
		document.body.appendChild(modal);
		auditLogModal = modal;
		(modal.querySelector('#al-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#al-search') as HTMLButtonElement).onclick = () => {
			auditLogState.offset = 0;
			void reloadAuditLogs();
		};
		(modal.querySelector('#al-reset') as HTMLButtonElement).onclick = () => {
			const orgEl = modal.querySelector('#al-org') as HTMLInputElement | null;
			if (orgEl) orgEl.value = '';
			(modal.querySelector('#al-action') as HTMLSelectElement).value = '';
			(modal.querySelector('#al-actor') as HTMLInputElement).value = '';
			(modal.querySelector('#al-since') as HTMLInputElement).value = '';
			(modal.querySelector('#al-until') as HTMLInputElement).value = '';
			(modal.querySelector('#al-limit') as HTMLInputElement).value = '50';
			auditLogState.offset = 0;
			void reloadAuditLogs();
		};
		(modal.querySelector('#al-prev') as HTMLButtonElement).onclick = () => {
			const lim = readAuditLimit();
			auditLogState.offset = Math.max(0, auditLogState.offset - lim);
			void reloadAuditLogs();
		};
		(modal.querySelector('#al-next') as HTMLButtonElement).onclick = () => {
			const lim = readAuditLimit();
			if (auditLogState.offset + lim < auditLogState.lastTotal) {
				auditLogState.offset += lim;
				void reloadAuditLogs();
			}
		};
		(modal.querySelector('#al-export') as HTMLButtonElement).onclick = () => {
			exportAuditLogsCsv();
		};
		return modal;
	}

	function readAuditLimit(): number {
		const el = auditLogModal?.querySelector('#al-limit') as HTMLInputElement | null;
		const v = parseInt(el?.value || '50', 10);
		return Math.min(500, Math.max(1, isNaN(v) ? 50 : v));
	}

	function readAuditFilters(): {
		orgId?: string;
		actorId?: string;
		action?: string;
		since?: string;
		until?: string;
		limit: number;
		offset: number;
	} {
		const m = auditLogModal!;
		const orgEl = m.querySelector('#al-org') as HTMLInputElement | null;
		const action = (m.querySelector('#al-action') as HTMLSelectElement).value.trim();
		const actor = (m.querySelector('#al-actor') as HTMLInputElement).value.trim();
		const since = (m.querySelector('#al-since') as HTMLInputElement).value.trim();
		const until = (m.querySelector('#al-until') as HTMLInputElement).value.trim();
		const lim = readAuditLimit();
		auditLogState.limit = lim;
		// datetime-local 形如 2024-05-01T08:30，转 ISO（保留秒）
		const toIso = (v: string): string | undefined => (v ? new Date(v).toISOString() : undefined);
		return {
			orgId: orgEl ? (orgEl.value.trim() || undefined) : undefined,
			actorId: actor || undefined,
			action: action || undefined,
			since: toIso(since),
			until: toIso(until),
			limit: lim,
			offset: auditLogState.offset
		};
	}

	function renderAuditTable(items: Array<Record<string, unknown>>): string {
		if (items.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">没有匹配的日志</div>';
		}
		const rows = items
			.map((it) => {
				const t = escapeHtmlSafe(String(it.created_at || ''));
				const actor = escapeHtmlSafe(String(it.actor_username || it.actor_user_id || ''));
				const org = escapeHtmlSafe(String(it.org_id || ''));
				const action = escapeHtmlSafe(String(it.action || ''));
				const summary = escapeHtmlSafe(String(it.summary || ''));
				let detailsStr = '';
				if (it.details !== undefined && it.details !== null) {
					try {
						detailsStr = JSON.stringify(it.details);
					} catch {
						detailsStr = String(it.details);
					}
				}
				const detailsCell = detailsStr
					? `<details><summary style="cursor:pointer;color:#1976d2;">查看</summary><pre style="white-space:pre-wrap;word-break:break-all;background:#f7f7f7;padding:6px;border-radius:4px;font-size:11px;margin:4px 0 0;">${escapeHtmlSafe(detailsStr)}</pre></details>`
					: '<span style="color:#bbb;">—</span>';
				return `<tr>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;white-space:nowrap;">${t}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">${actor}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888;font-size:11px;">${org}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;"><code style="background:#f0f4ff;padding:2px 6px;border-radius:3px;font-size:11px;">${action}</code></td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">${summary}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;max-width:240px;">${detailsCell}</td>
				</tr>`;
			})
			.join('');
		return `<table style="border-collapse:collapse;width:100%;font-size:13px;">
			<thead><tr style="background:#fafafa;">
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">时间</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">操作者</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">组织</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">操作</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">摘要</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">详情</th>
			</tr></thead>
			<tbody>${rows}</tbody>
		</table>`;
	}

	async function reloadAuditLogs(): Promise<void> {
		const modal = auditLogModal!;
		const body = modal.querySelector('#al-body') as HTMLDivElement;
		const summary = modal.querySelector('#al-summary') as HTMLDivElement;
		const pageLabel = modal.querySelector('#al-page') as HTMLSpanElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.queryAuditLogs !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const params = readAuditFilters();
			const data = (await api.queryAuditLogs(params)) as Record<string, unknown> | null;
			const items = Array.isArray(data?.items) ? (data!.items as Array<Record<string, unknown>>) : [];
			const total = Number(data?.total || 0);
			auditLogState.lastItems = items;
			auditLogState.lastTotal = total;
			summary.textContent = `共 ${total} 条；当前显示 ${items.length} 条`;
			body.innerHTML = renderAuditTable(items);
			const pageStart = total === 0 ? 0 : params.offset + 1;
			const pageEnd = params.offset + items.length;
			pageLabel.textContent = `${pageStart}-${pageEnd} / ${total}`;
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function reloadAuditActions(): Promise<void> {
		const api = window.APIClient;
		if (!api || typeof api.listAuditLogActions !== 'function' || !auditLogModal) return;
		try {
			const orgEl = auditLogModal.querySelector('#al-org') as HTMLInputElement | null;
			const orgId = orgEl?.value.trim() || undefined;
			const data = (await api.listAuditLogActions(orgId)) as Record<string, unknown> | null;
			const arr = Array.isArray(data?.actions) ? (data!.actions as unknown[]).map(String) : [];
			auditLogState.actions = arr;
			const sel = auditLogModal.querySelector('#al-action') as HTMLSelectElement;
			const cur = sel.value;
			sel.innerHTML = '<option value="">全部</option>' +
				arr.map((a) => `<option value="${escapeHtmlSafe(a)}">${escapeHtmlSafe(a)}</option>`).join('');
			if (arr.includes(cur)) sel.value = cur;
		} catch {
			// 静默：下拉为空也不阻塞查询
		}
	}

	function exportAuditLogsCsv(): void {
		const items = auditLogState.lastItems;
		if (items.length === 0) {
			showToast('当前结果为空，无法导出');
			return;
		}
		const headers = ['created_at', 'actor_user_id', 'actor_username', 'org_id', 'action', 'summary', 'details'];
		const escapeCsv = (v: unknown): string => {
			let s: string;
			if (v === null || v === undefined) s = '';
			else if (typeof v === 'object') {
				try {
					s = JSON.stringify(v);
				} catch {
					s = String(v);
				}
			} else s = String(v);
			if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
			return s;
		};
		const lines: string[] = [headers.join(',')];
		for (const it of items) {
			lines.push(headers.map((h) => escapeCsv((it as Record<string, unknown>)[h])).join(','));
		}
		// 加 BOM 让 Excel 能正确识别 UTF-8
		const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const ts = new Date().toISOString().replace(/[:.]/g, '-');
		a.download = `audit-logs-${ts}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function openAuditLogPanel(): Promise<void> {
		const modal = ensureAuditLogModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadAuditActions();
		await reloadAuditLogs();
	}

	// ---------------------------------------------------------------------
	// 业务功能 16：每日一练面板
	//   - 列表显示今日 N 道题（来自错题本 + SRS 到期），点击「去做题」按 examId 加载试卷
	//   - 完成单题后调用 markComplete；底部「换一批」可强制重新生成
	// ---------------------------------------------------------------------
	let dailyModal: HTMLDivElement | null = null;

	function ensureDailyModal(): HTMLDivElement {
		if (dailyModal) return dailyModal;
		const modal = document.createElement('div');
		modal.id = 'daily-practice-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:760px;max-height:85vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">🎯 每日一练 <span id="dp-date" style="color:#999;font-size:12px;font-weight:normal;"></span></h3>
					<div>
						<button id="dp-regen" style="margin-right:8px;padding:6px 12px;cursor:pointer;">换一批</button>
						<button id="dp-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="dp-body" style="min-height:200px;"></div>
				<div style="margin-top:12px;font-size:11px;color:#999;">每日同一份清单将在 24 小时内保持稳定；可点击「换一批」强制刷新。</div>
			</div>`;
		document.body.appendChild(modal);
		dailyModal = modal;
		(modal.querySelector('#dp-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#dp-regen') as HTMLButtonElement).onclick = () => {
			void regenerateDailyPractice(true);
		};
		return modal;
	}

	function renderDailyItems(items: Array<Record<string, unknown>>, completed: string[]): string {
		if (items.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">暂无可练习题目（错题本与 SRS 队列都为空）</div>';
		}
		const done = new Set(completed);
		return items
			.map((it, idx) => {
				const qid = String(it.question_id || '');
				const examId = String(it.exam_id || '');
				const source = String(it.source || '');
				const sourceLabel = source === 'wrong_question' ? '错题本' : source === 'srs_due' ? 'SRS 到期' : source;
				const isDone = done.has(qid);
				const checkmark = isDone ? '✅' : '⬜';
				return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #eee;">
					<div style="flex:1;min-width:0;">
						<div style="font-size:13px;">${checkmark} 第 ${idx + 1} 题 <span style="color:#888;font-size:11px;">${escapeHtmlSafe(sourceLabel)}</span></div>
						<div style="font-size:11px;color:#888;margin-top:2px;">试卷 <code>${escapeHtmlSafe(examId)}</code> · 题 <code>${escapeHtmlSafe(qid)}</code></div>
					</div>
					<div style="display:flex;gap:6px;">
						<button class="risk-btn" data-dp-action="open" data-exam-id="${escapeHtmlSafe(examId)}" data-question-id="${escapeHtmlSafe(qid)}">去做题</button>
						${isDone ? '' : `<button class="risk-btn" data-dp-action="complete" data-question-id="${escapeHtmlSafe(qid)}">标记完成</button>`}
					</div>
				</div>`;
			})
			.join('');
	}

	async function reloadDailyPractice(): Promise<void> {
		const modal = dailyModal!;
		const body = modal.querySelector('#dp-body') as HTMLDivElement;
		const dateEl = modal.querySelector('#dp-date') as HTMLSpanElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.getDailyPractice !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.getDailyPractice()) as Record<string, unknown> | null;
			const items = Array.isArray(data?.items) ? (data!.items as Array<Record<string, unknown>>) : [];
			const completed = Array.isArray(data?.completed_question_ids)
				? (data!.completed_question_ids as unknown[]).map(String)
				: [];
			dateEl.textContent = String(data?.date || '');
			body.innerHTML = renderDailyItems(items, completed);
			body.onclick = async (e: MouseEvent) => {
				const btn = (e.target as HTMLElement | null)?.closest('button[data-dp-action]') as
					| HTMLButtonElement
					| null;
				if (!btn) return;
				const action = btn.dataset.dpAction;
				const qid = btn.dataset.questionId || '';
				const examId = btn.dataset.examId || '';
				if (action === 'open' && examId) {
					await resumeExam(examId, null);
				} else if (action === 'complete' && qid) {
					try {
						await api.completeDailyPracticeItem(qid);
						await reloadDailyPractice();
						void refreshDailyPracticeBanner(getContext());
					} catch (err) {
						showToast(readErrorMessage(err, '标记失败'));
					}
				}
			};
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openDailyPracticePanel(): Promise<void> {
		const modal = ensureDailyModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadDailyPractice();
	}

	async function regenerateDailyPractice(reloadModal: boolean = false): Promise<void> {
		const api = window.APIClient;
		if (!api || typeof api.regenerateDailyPractice !== 'function') return;
		try {
			await api.regenerateDailyPractice();
			void refreshDailyPracticeBanner(getContext());
			if (reloadModal && dailyModal) await reloadDailyPractice();
			showToast('已重新生成');
		} catch (err) {
			showToast(readErrorMessage(err, '重新生成失败'));
		}
	}

	// ---------------------------------------------------------------------
	// 业务功能 17：学习报告面板（周/月小结）
	//   - 顶部 tab 切换 week/month
	//   - 卡片展示总题量/正确率/错题增量/SRS 待复习/连续天数
	//   - 列出周期内最近答题（最多 20 条）
	// ---------------------------------------------------------------------
	let learningReportModal: HTMLDivElement | null = null;
	let learningReportPeriod: 'week' | 'month' = 'week';

	function ensureLearningReportModal(): HTMLDivElement {
		if (learningReportModal) return learningReportModal;
		const modal = document.createElement('div');
		modal.id = 'learning-report-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:820px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">📈 学习报告</h3>
					<div>
						<button id="lr-week" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本周</button>
						<button id="lr-month" style="margin-right:8px;padding:6px 12px;cursor:pointer;">本月</button>
						<button id="lr-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="lr-body" style="min-height:200px;"></div>
			</div>`;
		document.body.appendChild(modal);
		learningReportModal = modal;
		(modal.querySelector('#lr-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#lr-week') as HTMLButtonElement).onclick = () => {
			learningReportPeriod = 'week';
			void reloadLearningReport();
		};
		(modal.querySelector('#lr-month') as HTMLButtonElement).onclick = () => {
			learningReportPeriod = 'month';
			void reloadLearningReport();
		};
		return modal;
	}

	function renderLearningReport(data: Record<string, unknown>): string {
		const ans = (data.answers || {}) as Record<string, unknown>;
		const wq = (data.wrong_questions || {}) as Record<string, unknown>;
		const srs = (data.srs || {}) as Record<string, unknown>;
		const streak = (data.streak || {}) as Record<string, unknown>;
		const period = String(data.period || '');
		const since = escapeHtmlSafe(String(data.since || ''));
		const accuracy = Number(ans.accuracy || 0);
		const accPct = (accuracy * 100).toFixed(1);
		const card = (title: string, value: unknown, hint?: string): string => `
			<div style="flex:1;min-width:130px;border:1px solid #eee;border-radius:6px;padding:12px;">
				<div style="font-size:12px;color:#888;">${escapeHtmlSafe(title)}</div>
				<div style="font-size:22px;font-weight:600;margin-top:4px;">${escapeHtmlSafe(String(value ?? 0))}</div>
				${hint ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">${escapeHtmlSafe(hint)}</div>` : ''}
			</div>`;

		const papers = Array.isArray(ans.papers) ? (ans.papers as Array<Record<string, unknown>>) : [];
		const paperRows = papers.length === 0
			? '<tr><td style="padding:8px;color:#999;" colspan="4">本周期暂无答题记录</td></tr>'
			: papers
					.map((p) => {
						const acc = Number(p.accuracy || 0) * 100;
						return `<tr>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">${escapeHtmlSafe(String(p.exam_id || ''))}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;color:#666;">${escapeHtmlSafe(String(p.saved_at || ''))}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${Number(p.correct_count || 0)} / ${Number(p.total_questions || 0)}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${acc.toFixed(1)}%</td>
						</tr>`;
					})
					.join('');

		return `
			<div style="font-size:11px;color:#999;margin-bottom:8px;">周期：${escapeHtmlSafe(period)} · 起：${since}</div>
			<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
				${card('完成试卷', ans.exams)}
				${card('答题数', ans.questions)}
				${card('正确率', accPct + '%')}
				${card('答错', ans.wrong)}
				${card('错题新增', wq.added_in_period, '本期沉淀')}
				${card('SRS 待复习', srs.due)}
				${card('当前连胜', streak.current, '天')}
				${card('最佳连胜', streak.best, '天')}
			</div>
			<div style="font-weight:600;margin-bottom:6px;">最近答题</div>
			<table style="border-collapse:collapse;width:100%;font-size:13px;">
				<thead><tr style="background:#fafafa;">
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">试卷</th>
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">提交时间</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确/总题</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确率</th>
				</tr></thead>
				<tbody>${paperRows}</tbody>
			</table>`;
	}

	async function reloadLearningReport(): Promise<void> {
		const modal = learningReportModal!;
		const body = modal.querySelector('#lr-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.getLearningReport !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.getLearningReport(learningReportPeriod)) as Record<string, unknown> | null;
			body.innerHTML = renderLearningReport(data || {});
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openLearningReportPanel(): Promise<void> {
		const modal = ensureLearningReportModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadLearningReport();
	}

	// ---------------------------------------------------------------------
	// 业务功能 18：备考目标 / 倒计时
	//   - 仪表盘横幅显示最近的目标 + 剩余天数
	//   - 管理 modal 列出全部目标，可新增/编辑/删除
	// ---------------------------------------------------------------------
	function daysUntil(yyyymmdd: string): number {
		// 以本地日期 00:00 为基准，避免时区抖动
		const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!m) return 0;
		const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
		const today = new Date();
		const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		return Math.round((target.getTime() - t0.getTime()) / 86400000);
	}

	async function refreshStudyGoalBanner(ctx: PCContext): Promise<void> {
		const banner = document.getElementById('pc-goal-banner') as HTMLDivElement | null;
		if (!banner) return;
		if (ctx.guest || !ctx.id) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		if (window.isFeatureEnabled && !window.isFeatureEnabled('study_goal')) {
			banner.hidden = true;
			banner.innerHTML = '';
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.listStudyGoals !== 'function') {
			banner.hidden = true;
			return;
		}
		try {
			const data = (await api.listStudyGoals()) as { items?: Array<Record<string, unknown>> } | null;
			const items = Array.isArray(data?.items) ? data!.items : [];
			if (items.length === 0) {
				banner.hidden = false;
				banner.innerHTML = `
					<div style="display:flex;justify-content:space-between;align-items:center;">
						<div>🎯 还没有设定备考目标，设定一个让自己更有动力。</div>
						<button class="pc-btn" data-pc-action="open-goal">立即设定</button>
					</div>`;
				const btn = banner.querySelector('[data-pc-action="open-goal"]') as HTMLButtonElement | null;
				if (btn) btn.onclick = () => void openStudyGoalPanel();
				return;
			}
			// 选取最近未过期目标，否则取首个
			const future = items.filter((g) => daysUntil(String(g.target_date || '')) >= 0);
			const pick = (future.length > 0 ? future : items)[0];
			const days = daysUntil(String(pick.target_date || ''));
			const dailyTarget = Number(pick.daily_question_target || 0);
			banner.hidden = false;
			banner.innerHTML = `
				<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
					<div>
						<div style="font-size:12px;color:#888;">备考倒计时</div>
						<div style="font-size:20px;font-weight:600;margin-top:2px;">${escapeHtmlSafe(String(pick.title || ''))}</div>
						<div style="font-size:13px;color:#666;margin-top:2px;">距离 ${escapeHtmlSafe(String(pick.target_date || ''))}：
							<span style="color:${days < 0 ? '#a33' : '#0a7'};font-weight:600;">${days >= 0 ? days + ' 天' : '已过期 ' + Math.abs(days) + ' 天'}</span>
							${dailyTarget > 0 ? `· 建议每日 ${dailyTarget} 题` : ''}
						</div>
					</div>
					<button class="pc-btn" data-pc-action="open-goal">管理目标</button>
				</div>`;
			const btn = banner.querySelector('[data-pc-action="open-goal"]') as HTMLButtonElement | null;
			if (btn) btn.onclick = () => void openStudyGoalPanel();
		} catch {
			banner.hidden = true;
		}
	}

	let studyGoalModal: HTMLDivElement | null = null;

	function ensureStudyGoalModal(): HTMLDivElement {
		if (studyGoalModal) return studyGoalModal;
		const modal = document.createElement('div');
		modal.id = 'study-goal-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:720px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">🎯 备考目标管理</h3>
					<button id="sg-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="sg-list" style="margin-bottom:14px;"></div>
				<form id="sg-form" style="border-top:1px solid #eee;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
					<label style="grid-column:1/-1;font-size:12px;color:#666;">新增目标</label>
					<input id="sg-title" placeholder="目标标题，如：CET6 冲刺 / EJU 文综稳定 320+" maxlength="80" style="grid-column:1/-1;padding:6px;border:1px solid #ddd;border-radius:4px;" required />
					<input id="sg-date" type="date" style="padding:6px;border:1px solid #ddd;border-radius:4px;" required />
					<input id="sg-daily" type="number" min="0" max="1000" placeholder="每日目标题量（可选）" style="padding:6px;border:1px solid #ddd;border-radius:4px;" />
					<input id="sg-target" placeholder="目标考试或级别（可选），如 N1 / EJU / CET6" maxlength="40" style="padding:6px;border:1px solid #ddd;border-radius:4px;" />
					<button type="submit" style="padding:6px 12px;background:#0a7;color:#fff;border:0;border-radius:4px;cursor:pointer;">添加目标</button>
				</form>
			</div>`;
		document.body.appendChild(modal);
		studyGoalModal = modal;
		(modal.querySelector('#sg-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#sg-form') as HTMLFormElement).addEventListener('submit', (ev) => {
			ev.preventDefault();
			void submitStudyGoal();
		});
		return modal;
	}

	async function reloadStudyGoals(): Promise<void> {
		const list = (studyGoalModal!.querySelector('#sg-list') as HTMLDivElement);
		list.innerHTML = '<div style="padding:12px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.listStudyGoals !== 'function') {
			list.innerHTML = '<div style="padding:12px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.listStudyGoals()) as { items?: Array<Record<string, unknown>> } | null;
			const items = Array.isArray(data?.items) ? data!.items : [];
			if (items.length === 0) {
				list.innerHTML = '<div style="padding:12px;color:#999;">暂无目标，添加一个开始备考吧。</div>';
				return;
			}
			list.innerHTML = items
				.map((g) => {
					const days = daysUntil(String(g.target_date || ''));
					const tag = days >= 0
						? `<span style="color:#0a7;">剩余 ${days} 天</span>`
						: `<span style="color:#a33;">已过期 ${Math.abs(days)} 天</span>`;
					return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid #f0f0f0;">
						<div>
							<div style="font-weight:600;">${escapeHtmlSafe(String(g.title || ''))}</div>
							<div style="font-size:11px;color:#888;">${escapeHtmlSafe(String(g.target_date || ''))} · ${tag}${
								Number(g.daily_question_target || 0) > 0 ? ` · 每日 ${Number(g.daily_question_target)} 题` : ''
							}${g.exam_target ? ` · ${escapeHtmlSafe(String(g.exam_target))}` : ''}</div>
						</div>
						<button class="pc-btn" data-sg-del="${escapeHtmlSafe(String(g.goal_id || ''))}" style="color:#a33;">删除</button>
					</div>`;
				})
				.join('');
			list.querySelectorAll<HTMLButtonElement>('[data-sg-del]').forEach((btn) => {
				btn.onclick = () => void deleteStudyGoal(btn.dataset.sgDel || '');
			});
		} catch (err) {
			list.innerHTML = `<div style="padding:12px;color:#a33;">${escapeHtmlSafe(readErrorMessage(err, '加载失败'))}</div>`;
		}
	}

	async function submitStudyGoal(): Promise<void> {
		const modal = studyGoalModal!;
		const title = (modal.querySelector('#sg-title') as HTMLInputElement).value.trim();
		const date = (modal.querySelector('#sg-date') as HTMLInputElement).value;
		const daily = Number((modal.querySelector('#sg-daily') as HTMLInputElement).value || 0);
		const target = (modal.querySelector('#sg-target') as HTMLInputElement).value.trim();
		if (!title || !date) {
			showToast('标题与日期必填');
			return;
		}
		const payload: Record<string, unknown> = { title, target_date: date };
		if (daily > 0) payload.daily_question_target = daily;
		if (target) payload.exam_target = target;
		const api = window.APIClient;
		if (!api || typeof api.createStudyGoal !== 'function') return;
		try {
			await api.createStudyGoal(payload);
			(modal.querySelector('#sg-form') as HTMLFormElement).reset();
			showToast('目标已添加');
			await reloadStudyGoals();
			void refreshStudyGoalBanner(getContext());
		} catch (err) {
			showToast(readErrorMessage(err, '添加失败'));
		}
	}

	async function deleteStudyGoal(goalId: string): Promise<void> {
		if (!goalId) return;
		if (!window.confirm('确定删除该目标？')) return;
		const api = window.APIClient;
		if (!api || typeof api.deleteStudyGoal !== 'function') return;
		try {
			await api.deleteStudyGoal(goalId);
			showToast('已删除');
			await reloadStudyGoals();
			void refreshStudyGoalBanner(getContext());
		} catch (err) {
			showToast(readErrorMessage(err, '删除失败'));
		}
	}

	async function openStudyGoalPanel(): Promise<void> {
		const modal = ensureStudyGoalModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadStudyGoals();
	}

	// ---------------------------------------------------------------------
	// 业务功能 19：多端同步面板
	//   - 显示服务端各模块 mtime；可选模块勾选 → 拉取覆盖本地缓存（localStorage）
	//   - localStorage key：sync.snapshot.{userId}.{module} = {modified_at, content}
	// ---------------------------------------------------------------------
	let syncDevicesModal: HTMLDivElement | null = null;

	function syncSnapshotKey(userId: string, moduleName: string): string {
		return `sync.snapshot.${userId}.${moduleName}`;
	}

	function ensureSyncDevicesModal(): HTMLDivElement {
		if (syncDevicesModal) return syncDevicesModal;
		const modal = document.createElement('div');
		modal.id = 'sync-devices-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:760px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">🔄 多端同步</h3>
					<div>
						<button id="sd-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">刷新状态</button>
						<button id="sd-pull" style="margin-right:8px;padding:6px 12px;background:#0a7;color:#fff;border:0;border-radius:4px;cursor:pointer;">拉取选中</button>
						<button id="sd-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div style="font-size:12px;color:#888;margin-bottom:8px;">
					拉取后会以服务端为准覆盖本地缓存（last-write-wins）。本机暂存键：<code>sync.snapshot.&lt;userId&gt;.&lt;module&gt;</code>。
				</div>
				<div id="sd-body" style="min-height:160px;"></div>
				<div id="sd-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
			</div>`;
		document.body.appendChild(modal);
		syncDevicesModal = modal;
		(modal.querySelector('#sd-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#sd-refresh') as HTMLButtonElement).onclick = () => void reloadSyncState();
		(modal.querySelector('#sd-pull') as HTMLButtonElement).onclick = () => void pullSelectedSyncModules();
		return modal;
	}

	async function reloadSyncState(): Promise<void> {
		const modal = syncDevicesModal!;
		const body = modal.querySelector('#sd-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const ctx = getContext();
		const userId = ctx.id || '';
		const api = window.APIClient;
		if (!api || typeof api.getSyncState !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.getSyncState()) as { server_time?: string; modules?: Record<string, { exists?: boolean; modified_at?: string; size?: number }> } | null;
			const mods = (data?.modules || {}) as Record<string, { exists?: boolean; modified_at?: string; size?: number }>;
			const names = Object.keys(mods);
			if (names.length === 0) {
				body.innerHTML = '<div style="padding:24px;color:#999;">无可同步模块</div>';
				return;
			}
			const rows = names.map((name) => {
				const m = mods[name] || {};
				let localCached = '';
				try {
					const raw = localStorage.getItem(syncSnapshotKey(userId, name));
					if (raw) {
						const obj = JSON.parse(raw) as { modified_at?: string };
						localCached = obj?.modified_at || '';
					}
				} catch { /* ignore */ }
				const remote = String(m.modified_at || '');
				const drift = !!remote && !!localCached && remote !== localCached;
				const cellStyle = drift ? 'color:#a33;font-weight:600;' : 'color:#0a7;';
				return `<tr>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">
						<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
							<input type="checkbox" data-sync-mod="${escapeHtmlSafe(name)}" ${drift || !localCached ? 'checked' : ''} />
							${escapeHtmlSafe(name)}
						</label>
					</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">${m.exists ? '是' : '否'}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;${cellStyle}">${escapeHtmlSafe(remote)}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#666;">${escapeHtmlSafe(localCached || '—')}</td>
				</tr>`;
			}).join('');
			body.innerHTML = `
				<div style="font-size:11px;color:#999;margin-bottom:6px;">服务端时间：${escapeHtmlSafe(String(data?.server_time || ''))}</div>
				<table style="border-collapse:collapse;width:100%;font-size:13px;">
					<thead><tr style="background:#fafafa;">
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">模块</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">服务端存在</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">服务端 mtime</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">本机缓存 mtime</th>
					</tr></thead>
					<tbody>${rows}</tbody>
				</table>`;
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function pullSelectedSyncModules(): Promise<void> {
		const modal = syncDevicesModal!;
		const status = modal.querySelector('#sd-status') as HTMLDivElement;
		const ctx = getContext();
		const userId = ctx.id || '';
		const checks = Array.from(modal.querySelectorAll<HTMLInputElement>('input[data-sync-mod]:checked'));
		const mods = checks.map((c) => c.dataset.syncMod || '').filter(Boolean);
		if (mods.length === 0) {
			status.textContent = '未选中任何模块';
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.pullSync !== 'function') return;
		status.textContent = '同步中…';
		try {
			const data = (await api.pullSync(mods)) as { modules?: Record<string, { modified_at?: string; content?: unknown }> } | null;
			const got = (data?.modules || {}) as Record<string, { modified_at?: string; content?: unknown }>;
			let written = 0;
			for (const name of Object.keys(got)) {
				const entry = got[name];
				try {
					localStorage.setItem(syncSnapshotKey(userId, name), JSON.stringify({
						modified_at: entry.modified_at || '',
						content: entry.content
					}));
					written++;
				} catch { /* localStorage 容量限制时忽略 */ }
			}
			status.textContent = `已同步 ${written} 个模块到本地缓存`;
			showToast('同步完成');
			await reloadSyncState();
		} catch (err) {
			status.textContent = readErrorMessage(err, '同步失败');
		}
	}

	async function openSyncDevicesPanel(): Promise<void> {
		const modal = ensureSyncDevicesModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadSyncState();
	}

	// ---------------------------------------------------------------------
	// 业务功能 21：排行榜面板
	//   - 周/月/总榜切换
	//   - 列出连胜、答题量、正确率
	//   - 高亮当前用户行
	// ---------------------------------------------------------------------
	let leaderboardModal: HTMLDivElement | null = null;
	let leaderboardPeriod: 'week' | 'month' | 'all' = 'week';

	function ensureLeaderboardModal(): HTMLDivElement {
		if (leaderboardModal) return leaderboardModal;
		const modal = document.createElement('div');
		modal.id = 'leaderboard-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:780px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">🏆 排行榜</h3>
					<div>
						<button id="lb-week" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本周</button>
						<button id="lb-month" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本月</button>
						<button id="lb-all" style="margin-right:8px;padding:6px 12px;cursor:pointer;">总榜</button>
						<button id="lb-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">强制刷新</button>
						<button id="lb-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="lb-body" style="min-height:240px;"></div>
			</div>`;
		document.body.appendChild(modal);
		leaderboardModal = modal;
		(modal.querySelector('#lb-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		(modal.querySelector('#lb-week') as HTMLButtonElement).onclick = () => { leaderboardPeriod = 'week'; void reloadLeaderboard(false); };
		(modal.querySelector('#lb-month') as HTMLButtonElement).onclick = () => { leaderboardPeriod = 'month'; void reloadLeaderboard(false); };
		(modal.querySelector('#lb-all') as HTMLButtonElement).onclick = () => { leaderboardPeriod = 'all'; void reloadLeaderboard(false); };
		(modal.querySelector('#lb-refresh') as HTMLButtonElement).onclick = () => void reloadLeaderboard(true);
		return modal;
	}

	function renderLeaderboard(data: { items?: Array<Record<string, unknown>>; generated_at?: string; period?: string }, currentUserId: string): string {
		const items = Array.isArray(data?.items) ? data!.items! : [];
		if (items.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">暂无数据</div>';
		}
		const rows = items.map((it) => {
			const isMe = String(it.user_id || '') === currentUserId;
			const acc = (Number(it.accuracy || 0) * 100).toFixed(1);
			const bg = isMe ? 'background:#fffbe6;font-weight:600;' : '';
			const rank = Number(it.rank || 0);
			const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
			return `<tr style="${bg}">
				<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${medal}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtmlSafe(String(it.display_name || it.user_id || ''))}${isMe ? ' <span style="color:#0a7;font-size:11px;">（我）</span>' : ''}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${Number(it.streak || 0)}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${Number(it.questions || 0)}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${acc}%</td>
			</tr>`;
		}).join('');
		return `
			<div style="font-size:11px;color:#999;margin-bottom:6px;">周期：${escapeHtmlSafe(String(data?.period || ''))} · 生成于 ${escapeHtmlSafe(String(data?.generated_at || ''))}</div>
			<table style="border-collapse:collapse;width:100%;font-size:13px;">
				<thead><tr style="background:#fafafa;">
					<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #ddd;width:60px;">名次</th>
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">用户</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">连胜</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">答题量</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确率</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>`;
	}

	async function reloadLeaderboard(force: boolean): Promise<void> {
		const modal = leaderboardModal!;
		const body = modal.querySelector('#lb-body') as HTMLDivElement;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		const api = window.APIClient;
		if (!api || typeof api.getLeaderboard !== 'function') {
			body.innerHTML = '<div style="padding:24px;color:#a33;">客户端 API 未注入</div>';
			return;
		}
		try {
			const data = (await api.getLeaderboard(leaderboardPeriod, 50, force)) as { items?: Array<Record<string, unknown>>; generated_at?: string; period?: string } | null;
			const ctx = getContext();
			body.innerHTML = renderLeaderboard(data || {}, ctx.id || '');
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openLeaderboardPanel(): Promise<void> {
		const modal = ensureLeaderboardModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadLeaderboard(false);
	}

	// ============================================================
	// 个人生词本面板
	// ============================================================
	let vocabModal: HTMLDivElement | null = null;
	let vocabFilter = '';

	function ensureVocabModal(): HTMLDivElement {
		if (vocabModal) return vocabModal;
		const el = document.createElement('div');
		el.id = 'vocab-modal';
		el.className = 'risk-hidden';
		el.innerHTML = `<div class="risk-backdrop" data-vocab-act="close"></div>
			<div class="risk-panel" style="max-width:760px;width:90%;">
				<div class="risk-header"><strong>生词本</strong><button class="risk-close" data-vocab-act="close">×</button></div>
				<div id="vocab-summary" style="padding:8px 16px;font-size:13px;color:#777;"></div>
				<div style="display:flex;gap:8px;align-items:center;padding:0 16px 8px 16px;flex-wrap:wrap;font-size:13px;">
					<input id="vocab-filter" type="search" placeholder="搜索词形 / 假名 / 笔记..." style="flex:1;min-width:200px;padding:4px 8px;" />
					<button id="vocab-reload" class="risk-btn">刷新</button>
				</div>
				<div class="risk-body" id="vocab-body" style="max-height:62vh;overflow:auto;"></div>
				<div class="risk-footer"><button class="risk-btn" data-vocab-act="close">关闭</button></div>
			</div>`;
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.vocabAct === 'close') {
				el.classList.remove('risk-open');
				el.classList.add('risk-hidden');
			}
		});
		document.body.appendChild(el);
		vocabModal = el;
		return el;
	}

	function renderVocabItem(item: Record<string, unknown>): string {
		const id = String(item.id ?? '');
		const word = String(item.word ?? '');
		const reading = String(item.reading ?? '');
		const note = String(item.note ?? '');
		const examId = String(item.exam_id ?? '');
		const questionId = String(item.question_id ?? '');
		const addedAt = String(item.added_at ?? '');
		const sourceLine = examId
			? `<a href="#" data-vocab-act="goto" data-exam="${escapeHtmlSafe(examId)}" data-qid="${escapeHtmlSafe(questionId)}" style="color:#36a;">来自 ${escapeHtmlSafe(examId)}${questionId ? ' · 第 ' + escapeHtmlSafe(questionId) + ' 题' : ''}</a>`
			: '<span style="color:#999;">无来源</span>';
		return `<div class="vocab-item" style="border-top:1px solid #eee;padding:10px 16px;" data-vocab-id="${escapeHtmlSafe(id)}">
			<div style="display:flex;align-items:baseline;gap:10px;">
				<span style="font-size:18px;font-weight:600;">${escapeHtmlSafe(word)}</span>
				${reading && reading !== word ? `<span style="color:#888;font-size:12px;">${escapeHtmlSafe(reading)}</span>` : ''}
				<span style="margin-left:auto;font-size:11px;color:#aaa;">${escapeHtmlSafe(addedAt.slice(0, 10))}</span>
			</div>
			<div style="margin-top:4px;font-size:12px;">${sourceLine}</div>
			<div style="margin-top:4px;">
				<textarea data-vocab-act="note" data-vocab-id="${escapeHtmlSafe(id)}" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;padding:4px 6px;" placeholder="释义 / 笔记">${escapeHtmlSafe(note)}</textarea>
			</div>
			<div style="margin-top:6px;display:flex;gap:8px;">
				<button class="risk-btn" data-vocab-act="save" data-vocab-id="${escapeHtmlSafe(id)}">保存笔记</button>
				<button class="risk-btn" data-vocab-act="remove" data-vocab-id="${escapeHtmlSafe(id)}" style="color:#a33;">删除</button>
				<span class="vocab-item-status" data-vocab-id="${escapeHtmlSafe(id)}" style="font-size:11px;color:#aaa;align-self:center;"></span>
			</div>
		</div>`;
	}

	function filterVocabItems(items: Record<string, unknown>[], filter: string): Record<string, unknown>[] {
		const f = filter.trim().toLowerCase();
		if (!f) return items;
		return items.filter((it) => {
			return ['word', 'reading', 'note'].some((k) => String(it[k] ?? '').toLowerCase().includes(f));
		});
	}

	async function reloadVocabNotebook(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const body = modal.querySelector('#vocab-body') as HTMLDivElement | null;
		const summary = modal.querySelector('#vocab-summary') as HTMLDivElement | null;
		if (!api || typeof api.listVocab !== 'function' || !body) {
			if (body) body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">接口不可用</div>';
			return;
		}
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		try {
			const data = (await api.listVocab()) as { items?: Record<string, unknown>[] };
			const all = data.items ?? [];
			const items = filterVocabItems(all, vocabFilter);
			if (summary) {
				summary.innerHTML = `共 <b>${all.length}</b> 个生词${vocabFilter ? ` · 匹配 <b>${items.length}</b>` : ''}`;
			}
			if (items.length === 0) {
				body.innerHTML = `<div style="padding:24px;text-align:center;color:#999;">${
					all.length === 0 ? '生词本是空的，做题时划选词语点「加入生词本」即可' : '没有匹配的生词'
				}</div>`;
				return;
			}
			body.innerHTML = items.map(renderVocabItem).join('');
		} catch (error) {
			body.innerHTML = `<div style="padding:24px;text-align:center;color:#a33;">加载失败：${escapeHtmlSafe(
				readErrorMessage(error, '未知错误')
			)}</div>`;
		}
	}

	async function openVocabNotebookPanel(): Promise<void> {
		const ctx = getContext();
		if (!ctx.id) {
			showToast('请先登录后查看生词本');
			return;
		}
		const modal = ensureVocabModal();
		modal.classList.remove('risk-hidden');
		modal.classList.add('risk-open');

		const filterInput = modal.querySelector('#vocab-filter') as HTMLInputElement | null;
		if (filterInput) {
			filterInput.value = vocabFilter;
			filterInput.oninput = () => {
				vocabFilter = filterInput.value;
				void reloadVocabNotebook(modal);
			};
		}
		const reloadBtn = modal.querySelector('#vocab-reload') as HTMLButtonElement | null;
		if (reloadBtn) reloadBtn.onclick = () => void reloadVocabNotebook(modal);

		const body = modal.querySelector('#vocab-body') as HTMLDivElement | null;
		if (body) {
			body.onclick = (event: MouseEvent) => {
				const target = (event.target as HTMLElement | null);
				const btn = target?.closest('button[data-vocab-act], a[data-vocab-act]') as HTMLElement | null;
				if (!btn) return;
				const act = btn.dataset.vocabAct || '';
				const id = btn.dataset.vocabId || '';
				const api = window.APIClient;
				if (!api) return;
				const status = body.querySelector(`.vocab-item-status[data-vocab-id="${id}"]`) as HTMLSpanElement | null;
				if (act === 'remove' && id && typeof api.removeVocabWord === 'function') {
					confirmRisk('删除生词', '删除生词', () => {
						api
							.removeVocabWord(id)
							.then(() => reloadVocabNotebook(modal))
							.catch((err: unknown) => showToast(readErrorMessage(err, '删除失败')));
					});
				} else if (act === 'save' && id && typeof api.updateVocabNote === 'function') {
					const ta = body.querySelector(`textarea[data-vocab-act="note"][data-vocab-id="${id}"]`) as HTMLTextAreaElement | null;
					const note = ta?.value ?? '';
					if (status) status.textContent = '保存中...';
					api
						.updateVocabNote(id, note)
						.then(() => {
							if (status) {
								status.textContent = '✓ 已保存';
								setTimeout(() => { if (status) status.textContent = ''; }, 1200);
							}
						})
						.catch((err: unknown) => {
							if (status) status.textContent = '';
							showToast(readErrorMessage(err, '保存失败'));
						});
				} else if (act === 'goto') {
					const examId = (btn as HTMLElement).dataset.exam || '';
					if (examId) {
						event.preventDefault();
						modal.classList.remove('risk-open');
						modal.classList.add('risk-hidden');
						const w = window as unknown as { openExam?: (id: string) => void };
						if (typeof w.openExam === 'function') {
							w.openExam(examId);
						} else {
							window.location.hash = `#exam=${encodeURIComponent(examId)}`;
						}
					}
				}
			};
		}

		await reloadVocabNotebook(modal);
	}

	// ============================================================
	// 功能 #18：章节式学习路径面板
	// ============================================================
	let chapterModal: HTMLDivElement | null = null;
	let chapterFilterFamily = 'jlpt';
	let chapterFilterLevel = '';
	function ensureChapterModal(): HTMLDivElement {
		if (chapterModal) return chapterModal;
		const el = document.createElement('div');
		el.id = 'chapter-modal';
		el.className = 'risk-hidden';
		el.innerHTML = `<div class="risk-backdrop" data-cp-act="close"></div>
			<div class="risk-panel" style="max-width:820px;width:92%;">
				<div class="risk-header"><strong>学习路径（章节）</strong><button class="risk-close" data-cp-act="close">×</button></div>
				<div style="padding:8px 16px;font-size:13px;color:#666;">优先按技能标签聚合；没有技能标签时回退到考试家族内的 section 聚合，适配 JLPT / EJU / CET 等题库。</div>
				<div style="display:flex;gap:8px;align-items:center;padding:0 16px 8px 16px;flex-wrap:wrap;font-size:13px;">
					<label>考试
						<select id="cp-family">
							<option value="jlpt">JLPT</option>
							<option value="eju">EJU</option>
							<option value="cet">CET</option>
						</select>
					</label>
					<label>等级
						<select id="cp-level">
							<option value="">全部</option>
							<option value="N1">N1</option>
							<option value="N2">N2</option>
							<option value="N3">N3</option>
							<option value="N4">N4</option>
							<option value="N5">N5</option>
						</select>
					</label>
					<button id="cp-reload" class="risk-btn">刷新</button>
				</div>
				<div class="risk-body" id="cp-body" style="max-height:62vh;overflow:auto;"></div>
				<div class="risk-footer"><button class="risk-btn" data-cp-act="close">关闭</button></div>
			</div>`;
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.cpAct === 'close') {
				el.classList.remove('risk-open');
				el.classList.add('risk-hidden');
			}
		});
		document.body.appendChild(el);
		chapterModal = el;
		return el;
	}

	function renderChapterRow(item: Record<string, unknown>): string {
		const id = String(item.id ?? '');
		const name = String(item.section_name ?? '');
		const type = String(item.section_type ?? '');
		const family = String(item.family ?? '').toUpperCase();
		const lvl = String(item.level ?? '');
		const total = Number(item.question_count ?? 0);
		const answered = Number(item.answered ?? 0);
		const correct = Number(item.correct ?? 0);
		const skillKey = String(item.skill_key ?? '');
		const progress = total > 0 ? Math.round((answered / total) * 100) : 0;
		const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
		return `<div class="cp-row" style="border-top:1px solid #eee;padding:10px 16px;">
			<div style="display:flex;align-items:center;gap:10px;">
				${family ? `<span style="font-size:11px;padding:2px 6px;background:#f4eefc;border-radius:3px;color:#6a45a3;">${escapeHtmlSafe(family)}</span>` : ''}
				<span style="font-size:11px;padding:2px 6px;background:#eef;border-radius:3px;color:#448;">${escapeHtmlSafe(lvl)}</span>
				<span style="font-size:11px;padding:2px 6px;background:#efe;border-radius:3px;color:#484;">${escapeHtmlSafe(type)}</span>
				<span style="font-weight:600;">${escapeHtmlSafe(name)}</span>
				<span style="margin-left:auto;font-size:11px;color:#888;">${total} 题</span>
			</div>
			${skillKey ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;">技能标签：<code>${escapeHtmlSafe(skillKey)}</code></div>` : ''}
			<div style="margin-top:6px;height:6px;background:#eee;border-radius:3px;overflow:hidden;">
				<div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#36a,#6c9);"></div>
			</div>
			<div style="margin-top:4px;font-size:12px;color:#555;display:flex;gap:12px;">
				<span>进度 <b>${progress}%</b>（${answered}/${total}）</span>
				<span>正确率 <b style="color:${accuracy >= 70 ? '#3a7' : accuracy >= 40 ? '#b80' : '#a33'};">${accuracy}%</b></span>
				<button class="risk-btn" data-cp-act="detail" data-id="${escapeHtmlSafe(id)}" style="margin-left:auto;font-size:11px;padding:2px 8px;">查看题目</button>
			</div>
			<div class="cp-detail" data-id="${escapeHtmlSafe(id)}"></div>
		</div>`;
	}

	function renderChapterDetail(data: { questions?: Array<Record<string, unknown>> }): string {
		const rows = (data.questions || [])
			.map((q) => {
				const status = String(q.status || '');
				const exam = String(q.exam_id || '');
				const id = String(q.question_id || '');
				const stem = String(q.stem || '');
				const color = status === 'correct' ? '#3a7' : status === 'wrong' ? '#a33' : '#999';
				const label = status === 'correct' ? '✓ 对' : status === 'wrong' ? '✗ 错' : status === 'unanswered' ? '— 未答' : '— 未做';
				return `<div style="padding:6px 10px;border-bottom:1px dashed #eee;font-size:12px;display:flex;gap:8px;align-items:center;">
					<span style="min-width:52px;color:${color};">${label}</span>
					<code style="color:#888;">${escapeHtmlSafe(exam)} · ${escapeHtmlSafe(id)}</code>
					<span style="flex:1;color:#444;">${escapeHtmlSafe(stem).slice(0, 60)}</span>
					<a href="#" data-cp-act="goto" data-exam="${escapeHtmlSafe(exam)}" style="color:#36a;">去答题</a>
				</div>`;
			})
			.join('');
		return `<div style="margin-top:8px;border:1px solid #dde;border-radius:4px;background:#fafafd;max-height:360px;overflow:auto;">${rows || '<div style="padding:10px;color:#999;">该章节暂无题目</div>'}</div>`;
	}

	async function reloadChapters(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const body = modal.querySelector('#cp-body') as HTMLDivElement | null;
		if (!api || typeof api.listChapters !== 'function' || !body) {
			if (body) body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">接口不可用</div>';
			return;
		}
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		try {
			const data = (await api.listChapters({ family: chapterFilterFamily || undefined, level: chapterFilterLevel || undefined })) as {
				items?: Array<Record<string, unknown>>;
				count?: number;
			};
			const items = data.items || [];
			if (items.length === 0) {
				body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">暂无章节数据</div>';
				return;
			}
			body.innerHTML = items.map(renderChapterRow).join('');
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;text-align:center;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openChapterPathPanel(): Promise<void> {
		const ctx = getContext();
		if (!ctx.id) {
			showToast('请先登录后查看学习路径');
			return;
		}
		const modal = ensureChapterModal();
		modal.classList.remove('risk-hidden');
		modal.classList.add('risk-open');

		const familySel = modal.querySelector('#cp-family') as HTMLSelectElement | null;
		if (familySel) {
			familySel.value = chapterFilterFamily;
			familySel.onchange = () => {
				chapterFilterFamily = familySel.value;
				void reloadChapters(modal);
			};
		}
		const levelSel = modal.querySelector('#cp-level') as HTMLSelectElement | null;
		if (levelSel) {
			levelSel.value = chapterFilterLevel;
			levelSel.onchange = () => {
				chapterFilterLevel = levelSel.value;
				void reloadChapters(modal);
			};
		}
		const reloadBtn = modal.querySelector('#cp-reload') as HTMLButtonElement | null;
		if (reloadBtn) reloadBtn.onclick = () => void reloadChapters(modal);

		const body = modal.querySelector('#cp-body') as HTMLDivElement | null;
		if (body) {
			body.onclick = (event: MouseEvent) => {
				const el = (event.target as HTMLElement | null)?.closest('[data-cp-act]') as HTMLElement | null;
				if (!el) return;
				const act = el.dataset.cpAct || '';
				if (act === 'detail') {
					const id = el.dataset.id || '';
					if (!id) return;
					const row = el.closest('.cp-row') as HTMLElement | null;
					const holder = row?.querySelector(`.cp-detail[data-id="${id}"]`) as HTMLDivElement | null;
					if (!holder) return;
					if (holder.dataset.loaded === '1') {
						holder.innerHTML = '';
						holder.dataset.loaded = '';
						return;
					}
					holder.innerHTML = '<div style="padding:6px 10px;color:#888;font-size:12px;">加载中…</div>';
					const api = window.APIClient;
					if (!api || typeof api.getChapterDetail !== 'function') return;
					api
						.getChapterDetail(id)
						.then((data: unknown) => {
							holder.innerHTML = renderChapterDetail(data as { questions?: Array<Record<string, unknown>> });
							holder.dataset.loaded = '1';
						})
						.catch((err: unknown) => {
							holder.innerHTML = `<div style="padding:6px 10px;color:#a33;font-size:12px;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
						});
				} else if (act === 'goto') {
					const exam = el.dataset.exam || '';
					if (!exam) return;
					event.preventDefault();
					modal.classList.remove('risk-open');
					modal.classList.add('risk-hidden');
					const w = window as unknown as { openExam?: (id: string) => void };
					if (typeof w.openExam === 'function') w.openExam(exam);
					else window.location.hash = `#exam=${encodeURIComponent(exam)}`;
				}
			};
		}

		await reloadChapters(modal);
	}

	// 业务功能 14：PWA 安装触发
	//   - 浏览器只有在满足启发式后才会派发 beforeinstallprompt（HTTPS、用户交互等）
	async function triggerPwaInstall(): Promise<void> {
		const w = window as unknown as {
			canInstallPwa?: () => boolean;
			installPwa?: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
			isPwaActive?: () => boolean;
		};
		if (!w.installPwa) {
			showToast('当前浏览器不支持 PWA 安装');
			return;
		}
		if (!w.canInstallPwa?.()) {
			const active = w.isPwaActive?.();
			showToast(active ? '已安装或暂不可安装；可在浏览器菜单中手动「添加到主屏幕」' : '安装入口尚未就绪，请稍后重试');
			return;
		}
		try {
			const outcome = await w.installPwa();
			if (outcome === 'accepted') showToast('已开始安装');
			else if (outcome === 'dismissed') showToast('已取消安装');
		} catch (err) {
			showToast(readErrorMessage(err, '安装失败'));
		}
	}

	// 业务功能 12：个人中心入口 → prompt 输入 paperId
	async function openCommunityFromPersonalCenter(): Promise<void> {
		const paperId = window.prompt('请输入试卷 ID（如 N4_2025_12）');
		if (!paperId) return;
		await openCommunityPanel(paperId.trim());
	}

	// 暴露给 ExamViewer：window.openCommunityPanel(paperId)
	(window as unknown as { openCommunityPanel?: (paperId: string) => void }).openCommunityPanel = (paperId: string) => {
		void openCommunityPanel(paperId);
	};

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
