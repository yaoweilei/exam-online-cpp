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
	FeatureItem, RoleDef, AvatarPreset, AvatarPalette, AvatarSeed, PermissionOverride,
	PermissionTemplateId, ManagedCampus, ManagedLearningGroup, ManagedLearningGroupEnrollment,
	ManagedCoursePackage
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
		{ id: 'admin-hub', title: '管理', gate: (u) => hasAnyRole(u, ['teacher', 'assistant', 'orgAdmin', 'contentAdmin', 'superAdmin']), nav: true }
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
			intent: 'openReviewWorkbench',
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('srs') ?? true)
		},
		{
			id: 'recommendedReview',
			title: '推荐复习',
			icon: 'chart',
			intent: 'openRecommendedReview',
			gate: (u) => !u.guest
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
			gate: (u) => !u.guest && (window.isFeatureEnabled?.('community') ?? true)
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
			id: 'paymentLedger',
			title: '支付流水',
			icon: 'wallet',
			intent: 'openPaymentLedger',
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
		{ id: 'student', name: '学员', desc: '做题 / 作业 / 学习报告', risk: 'low' },
		{ id: 'assistant', name: '教学运营', desc: '助教、班主任、教务、顾问的基础角色', risk: 'medium' },
		{ id: 'teacher', name: '老师', desc: '教学 / 作业 / 批改 / 反馈', risk: 'medium' },
		{ id: 'orgAdmin', name: '机构管理员', desc: '机构成员、学习组、课程包和看板管理', risk: 'medium' },
		{ id: 'contentAdmin', name: '内容管理员', desc: '试卷、音频、答案和解析维护', risk: 'high' },
		{ id: 'superAdmin', name: '平台超级管理员', desc: '平台全部权限和高危系统操作', risk: 'critical' }
	];

	const organizationMemberRoleDefs = roleDefs.filter((role) => ['student', 'assistant', 'teacher', 'orgAdmin'].includes(role.id));
	const organizationPermissionTemplateDefs: Array<{ id: PermissionTemplateId; name: string; role: 'assistant' | 'orgAdmin'; desc: string }> = [
		{ id: 'assistant', name: '助教模板', role: 'assistant', desc: '催交、查看提交、协助老师反馈' },
		{ id: 'homeroom', name: '班主任模板', role: 'assistant', desc: '学员档案、跟进记录、续费风险' },
		{ id: 'teachingOffice', name: '教务模板', role: 'assistant', desc: '排课、约课、课程包、学习组' },
		{ id: 'consultant', name: '课程顾问模板', role: 'assistant', desc: '基础档案、跟进记录、续费风险' },
		{ id: 'campusAdmin', name: '校区管理员模板', role: 'orgAdmin', desc: '限定校区的机构管理能力' }
	];
	const organizationPermissionDefs = [
		{ id: 'assignment.create', name: '布置作业' },
		{ id: 'assignment.review', name: '查看/批改提交' },
		{ id: 'assignment.remind', name: '催交作业' },
		{ id: 'gradebook.view', name: '查看成绩册' },
		{ id: 'student.profile.view', name: '查看学员档案' },
		{ id: 'student.profile.edit', name: '编辑学员档案' },
		{ id: 'student.followup.edit', name: '编辑跟进记录' },
		{ id: 'student.import', name: '批量导入学员' },
		{ id: 'learning_group.manage', name: '学习组管理' },
		{ id: 'lesson.booking.manage', name: '约课管理' },
		{ id: 'course_package.manage', name: '课程包管理' },
		{ id: 'course_package.view', name: '查看课程包' },
		{ id: 'lesson_prep.create', name: '备课组卷' },
		{ id: 'lesson_prep.export', name: '导出讲义' },
		{ id: 'renewal_risk.view', name: '续费风险' },
		{ id: 'organization.dashboard.view', name: '机构看板' },
		{ id: 'organization.member.manage', name: '成员管理' },
		{ id: 'organization.billing.manage', name: '套餐/席位管理' },
		{ id: 'payment.refund', name: '发起退款' },
		{ id: 'audit.view', name: '查看审计日志' }
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

	function permissionTemplateLabel(templateId: string): string {
		return organizationPermissionTemplateDefs.find((item) => item.id === templateId)?.name || templateId;
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
		const roles = ['guest', 'student', 'assistant', 'teacher', 'orgAdmin', 'contentAdmin', 'superAdmin'];
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
		return hasAnyRole(ctx, ['orgAdmin', 'superAdmin']);
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
				permissionTemplates: [],
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
			permissionTemplates: [],
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

	type PersonalPlan = 'free' | 'pro' | 'ultra';

	const personalPlanOptions: Array<{
		id: PersonalPlan;
		name: string;
		price: string;
		desc: string;
		features: string[];
	}> = [
		{
			id: 'free',
			name: 'FREE',
			price: '免费',
			desc: '适合先体验基础刷题。',
			features: ['N5 / N4 访问', '基础做题记录', '基础个人资料']
		},
		{
			id: 'pro',
			name: 'PRO',
			price: '¥19 / 30天起',
			desc: '适合日常自学和系统复盘。',
			features: ['开放 N3 / N2', '错题与弱项复盘', '推荐与收藏能力']
		},
		{
			id: 'ultra',
			name: 'ULTRA',
			price: '¥39 / 30天起',
			desc: '适合冲刺和深度训练。',
			features: ['开放 N1', '专项训练权益', '数据导出与高级能力']
		}
	];

	function normalizePersonalPlan(value: string | undefined): PersonalPlan {
		return value === 'pro' || value === 'ultra' ? value : 'free';
	}

	function addDaysIsoDate(baseDate: Date, days: number): string {
		const next = new Date(baseDate.getTime());
		next.setDate(next.getDate() + days);
		return next.toISOString().slice(0, 10);
	}

	function nextSubscriptionExpiry(ctx: PCContext, days: number): string {
		if (days <= 0) {
			return '';
		}
		const raw = (ctx.subscription?.expiresAt || ctx.planExpiresAt || '').trim();
		const current = raw ? new Date(raw) : null;
		const now = new Date();
		const base = current && !Number.isNaN(current.getTime()) && current.getTime() > now.getTime()
			? current
			: now;
		return addDaysIsoDate(base, days);
	}

	let rechargeModal: HTMLDivElement | null = null;

	function ensureRechargeModal(): HTMLDivElement {
		if (rechargeModal) return rechargeModal;
		const modal = document.createElement('div');
		modal.id = 'pc-recharge-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:760px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">续费 / 升级套餐</h3>
					<button id="recharge-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="recharge-body"></div>
			</div>`;
		document.body.appendChild(modal);
		rechargeModal = modal;
		(modal.querySelector('#recharge-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (event) => {
			if (event.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	function renderRechargePanel(ctx: PCContext): string {
		const currentPlan = normalizePersonalPlan(ctx.subscription?.plan);
		const currentStatus = ctx.subscription?.status || 'active';
		const currentExpiry = ctx.subscription?.expiresAt || ctx.planExpiresAt || '';
		const cards = personalPlanOptions
			.map((plan) => {
				const checked = plan.id === currentPlan ? ' checked' : '';
				const featureList = plan.features.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
				return `<label style="display:block;border:1px solid ${plan.id === currentPlan ? '#1976d2' : '#e0e0e0'};border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;">
					<div style="display:flex;gap:10px;align-items:flex-start;">
						<input type="radio" name="recharge-plan" value="${plan.id}"${checked} style="margin-top:4px;" />
						<div style="flex:1;">
							<div style="display:flex;justify-content:space-between;gap:12px;">
								<strong>${escapeHtml(plan.name)}</strong>
								<span style="color:#1976d2;font-weight:600;">${escapeHtml(plan.price)}</span>
							</div>
							<div style="font-size:12px;color:#666;margin-top:3px;">${escapeHtml(plan.desc)}</div>
							<ul style="margin:8px 0 0 18px;padding:0;font-size:12px;color:#555;line-height:1.7;">${featureList}</ul>
						</div>
					</div>
				</label>`;
			})
			.join('');
		return `<div style="font-size:13px;color:#333;">
			<div style="border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:14px;background:#fafafa;">
				<div>当前套餐：<strong>${escapeHtml(planLabel(currentPlan))}</strong> / ${escapeHtml(currentStatus)}</div>
				<div style="margin-top:4px;color:#666;">到期时间：${escapeHtml(currentExpiry || '长期有效')}</div>
			</div>
			<form id="recharge-form">
				${cards}
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
					<label style="font-size:12px;color:#666;">续费时长
						<select id="recharge-days" style="display:block;width:100%;margin-top:4px;padding:7px;border:1px solid #ddd;border-radius:4px;">
							<option value="30">30 天</option>
							<option value="90">90 天</option>
							<option value="365" selected>365 天</option>
						</select>
					</label>
					<label style="font-size:12px;color:#666;">支付渠道
						<select id="recharge-provider" style="display:block;width:100%;margin-top:4px;padding:7px;border:1px solid #ddd;border-radius:4px;">
							<option value="stripe" selected>Stripe</option>
							<option value="wechat">微信支付</option>
							<option value="alipay">支付宝</option>
						</select>
					</label>
				</div>
				<div id="recharge-preview" style="margin-top:12px;padding:10px;border-radius:6px;background:#f5f9ff;color:#345;font-size:12px;"></div>
				<div style="margin-top:10px;color:#999;font-size:11px;line-height:1.6;">
					付费套餐会先创建支付订单；只有支付渠道回调确认成功后，系统才会发放套餐权益并写入流水。
				</div>
				<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
					<button type="button" id="recharge-cancel" style="padding:7px 12px;border:1px solid #ddd;background:#fff;border-radius:4px;cursor:pointer;">取消</button>
					<button type="submit" id="recharge-submit" style="padding:7px 14px;border:0;background:#1976d2;color:#fff;border-radius:4px;cursor:pointer;">创建支付订单</button>
				</div>
			</form>
		</div>`;
	}

	function updateRechargePreview(modal: HTMLDivElement, ctx: PCContext): void {
		const plan = normalizePersonalPlan((modal.querySelector('input[name="recharge-plan"]:checked') as HTMLInputElement | null)?.value);
		const days = Number((modal.querySelector('#recharge-days') as HTMLSelectElement | null)?.value || 365);
		const preview = modal.querySelector('#recharge-preview') as HTMLDivElement | null;
		if (!preview) return;
		if (plan === 'free') {
			preview.textContent = '将切换为 FREE：套餐长期有效，但高级访问权益会回到基础范围。';
			return;
		}
		const provider = (modal.querySelector('#recharge-provider') as HTMLSelectElement | null)?.value || 'stripe';
		preview.textContent = `将创建 ${planLabel(plan)} ${days} 天支付订单，渠道为 ${provider}。支付成功后到期时间预计为 ${nextSubscriptionExpiry(ctx, days)}，仍有效的套餐会从当前到期日顺延。`;
	}

	async function submitRecharge(modal: HTMLDivElement, ctx: PCContext): Promise<void> {
		const token = activeToken(ctx);
		const userId = ctx.id || '';
		const api = window.APIClient;
		if (!token || !userId) {
			showToast('请先登录后续费');
			return;
		}
		if (!api || typeof api.createPaymentOrder !== 'function') {
			showToast('支付接口暂不可用');
			return;
		}
		const plan = normalizePersonalPlan((modal.querySelector('input[name="recharge-plan"]:checked') as HTMLInputElement | null)?.value);
		const days = Number((modal.querySelector('#recharge-days') as HTMLSelectElement | null)?.value || 365);
		const provider = (modal.querySelector('#recharge-provider') as HTMLSelectElement | null)?.value || 'stripe';
		const submit = modal.querySelector('#recharge-submit') as HTMLButtonElement | null;
		if (submit) {
			submit.disabled = true;
			submit.textContent = '处理中…';
		}
		try {
			if (plan === 'free') {
				if (typeof api.updateUserSubscription !== 'function') {
					showToast('订阅接口暂不可用');
					return;
				}
				const payload = { plan, status: 'active', expires_at: '' };
				const updated = await api.updateUserSubscription(userId, token, payload);
				const subscription = normalizeSubscription(updated) || normalizeSubscription(payload);
				if (subscription) {
					setContext({
						...ctx,
						subscription,
						planExpiresAt: subscription.expiresAt,
						guest: false
					});
				}
				await refreshCurrentContextFromApi();
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
				showToast('已切换为 FREE');
				renderSections();
				renderSectionContent();
				return;
			}
			const order = asRecord(await api.createPaymentOrder(token, {
				plan,
				days,
				provider,
				currency: 'cny'
			})) || {};
			const providerPayload = asRecord(order.provider_payload);
			const paymentUrl = readString(providerPayload?.payment_url);
			if (paymentUrl) {
				window.open(paymentUrl, '_blank', 'noopener');
				showToast('支付订单已创建，请在新窗口完成支付');
			} else {
				showToast(readString(providerPayload?.message) || readString(providerPayload?.error) || '支付订单已创建，渠道尚未返回支付链接');
			}
			const preview = modal.querySelector('#recharge-preview') as HTMLDivElement | null;
			if (preview) {
				preview.textContent = `订单 ${readString(order.id) || ''} 已创建，状态：${readString(order.status) || 'pending'}。支付成功后将通过回调自动发放套餐。`;
			}
		} catch (error) {
			showToast(readErrorMessage(error, '支付订单创建失败'));
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.textContent = '创建支付订单';
			}
		}
	}

	async function openRechargePanel(): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后续费');
			return;
		}
		const modal = ensureRechargeModal();
		const body = modal.querySelector('#recharge-body') as HTMLDivElement | null;
		if (!body) return;
		body.innerHTML = renderRechargePanel(ctx);
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		updateRechargePreview(modal, ctx);
		modal.querySelectorAll('input[name="recharge-plan"], #recharge-days, #recharge-provider').forEach((el) => {
			(el as HTMLInputElement | HTMLSelectElement).onchange = () => updateRechargePreview(modal, ctx);
		});
		const cancel = modal.querySelector('#recharge-cancel') as HTMLButtonElement | null;
		if (cancel) {
			cancel.onclick = () => {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			};
		}
		const form = modal.querySelector('#recharge-form') as HTMLFormElement | null;
		if (form) {
			form.onsubmit = (event) => {
				event.preventDefault();
				void submitRecharge(modal, ctx);
			};
		}
	}

	type WalletCoupon = {
		id: string;
		code: string;
		title: string;
		kind: string;
		description: string;
		status: string;
		redeemedAt: string;
		effectSummary: string;
	};

	type WalletView = {
		balance?: PCBalance;
		subscription?: PCSubscription;
		coupons: WalletCoupon[];
		couponCount: number;
	};

	type PaymentLedgerEntry = {
		id: string;
		orderId: string;
		type: string;
		amountCents: number;
		currency: string;
		summary: string;
		createdAt: string;
	};

	let walletModal: HTMLDivElement | null = null;

	function normalizeWalletCoupon(value: unknown): WalletCoupon | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const id = readString(raw.id) || readString(raw.normalized_code) || readString(raw.code);
		const code = readString(raw.code) || id;
		if (!id && !code) {
			return null;
		}
		const stableCode = code || id || '';
		return {
			id: id || stableCode,
			code: stableCode,
			title: readString(raw.title) || '兑换卡券',
			kind: readString(raw.kind) || 'coupon',
			description: readString(raw.description) || '',
			status: readString(raw.status) || 'used',
			redeemedAt: readString(raw.redeemedAt) || readString(raw.redeemed_at) || '',
			effectSummary: readString(raw.effectSummary) || readString(raw.effect_summary) || ''
		};
	}

	function normalizeWallet(value: unknown): WalletView {
		const raw = asRecord(value) || {};
		const balanceRecord = asRecord(raw.balance);
		const coupons = Array.isArray(raw.coupons)
			? raw.coupons.map(normalizeWalletCoupon).filter((item): item is WalletCoupon => Boolean(item))
			: [];
		return {
			balance: balanceRecord
				? {
						credits: readNumber(balanceRecord.credits) ?? 0,
						updatedAt: readString(balanceRecord.updatedAt) || readString(balanceRecord.updated_at) || ''
				  }
				: undefined,
			subscription: normalizeSubscription(raw.subscription),
			coupons,
			couponCount: readNumber(raw.couponCount) ?? readNumber(raw.coupon_count) ?? coupons.length
		};
	}

	function normalizePaymentLedgerEntry(value: unknown): PaymentLedgerEntry | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const id = readString(raw.id);
		if (!id) {
			return null;
		}
		return {
			id,
			orderId: readString(raw.order_id) || readString(raw.orderId) || '',
			type: readString(raw.type) || '',
			amountCents: readNumber(raw.amount_cents) ?? readNumber(raw.amountCents) ?? 0,
			currency: readString(raw.currency) || 'cny',
			summary: readString(raw.summary) || '',
			createdAt: readString(raw.created_at) || readString(raw.createdAt) || ''
		};
	}

	function formatPaymentAmount(amountCents: number, currency: string): string {
		const symbol = currency.toLowerCase() === 'usd' ? '$' : '¥';
		const sign = amountCents < 0 ? '-' : '';
		return `${sign}${symbol}${(Math.abs(amountCents) / 100).toFixed(2)}`;
	}

	function applyWalletToContext(wallet: WalletView): void {
		const ctx = getContext();
		setContext({
			...ctx,
			balance: wallet.balance || ctx.balance,
			subscription: wallet.subscription || ctx.subscription,
			planExpiresAt: wallet.subscription?.expiresAt || ctx.planExpiresAt,
			couponCount: wallet.couponCount
		});
		void renderIdentity();
		renderSections();
		renderSectionContent({ preserveScroll: true });
	}

	function couponKindLabel(kind: string): string {
		switch (kind) {
			case 'credits':
				return '积分券';
			case 'subscription':
				return '套餐卡';
			default:
				return '卡券';
		}
	}

	function ensureWalletModal(): HTMLDivElement {
		if (walletModal) return walletModal;
		const modal = document.createElement('div');
		modal.id = 'pc-wallet-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:760px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 id="wallet-title" style="margin:0;font-size:16px;"></h3>
					<button id="wallet-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="wallet-body"></div>
			</div>`;
		document.body.appendChild(modal);
		walletModal = modal;
		(modal.querySelector('#wallet-close') as HTMLButtonElement).onclick = () => {
			modal.classList.add('risk-hidden');
			modal.style.display = 'none';
		};
		modal.addEventListener('click', (event) => {
			if (event.target === modal) {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			}
		});
		return modal;
	}

	async function loadWallet(ctx: PCContext): Promise<WalletView> {
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getMyWallet !== 'function') {
			return {
				balance: ctx.balance,
				subscription: ctx.subscription,
				coupons: [],
				couponCount: ctx.couponCount ?? 0
			};
		}
		return normalizeWallet(await api.getMyWallet(token));
	}

	function renderRedeemPanel(ctx: PCContext, wallet: WalletView): string {
		const credits = wallet.balance?.credits ?? ctx.balance?.credits ?? 0;
		const coupons = wallet.couponCount ?? ctx.couponCount ?? 0;
		return `<div style="font-size:13px;color:#333;">
			<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
				<div style="border:1px solid #eee;border-radius:8px;padding:12px;background:#fafafa;">
					<div style="color:#666;font-size:12px;">学习积分</div>
					<strong style="font-size:20px;">${credits}</strong>
				</div>
				<div style="border:1px solid #eee;border-radius:8px;padding:12px;background:#fafafa;">
					<div style="color:#666;font-size:12px;">已兑换卡券</div>
					<strong style="font-size:20px;">${coupons} 张</strong>
				</div>
			</div>
			<form id="wallet-redeem-form">
				<label style="display:block;font-size:12px;color:#666;">兑换码
					<input id="wallet-redeem-code" autocomplete="off" placeholder="例如 WELCOME-100" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:9px;border:1px solid #ddd;border-radius:4px;font-size:14px;text-transform:uppercase;" />
				</label>
				<div id="wallet-redeem-result" style="display:none;margin-top:12px;padding:10px;border-radius:6px;background:#f5f9ff;color:#345;font-size:12px;"></div>
				<div style="margin-top:10px;color:#999;font-size:11px;line-height:1.6;">
					兑换码会记录到当前账号，已使用过的兑换码不能重复兑换。运营兑换码配置在 data/system/redeem_codes.json。
				</div>
				<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
					<button type="button" id="wallet-show-coupons" style="padding:7px 12px;border:1px solid #ddd;background:#fff;border-radius:4px;cursor:pointer;">查看卡券包</button>
					<button type="submit" id="wallet-redeem-submit" style="padding:7px 14px;border:0;background:#1976d2;color:#fff;border-radius:4px;cursor:pointer;">确认兑换</button>
				</div>
			</form>
		</div>`;
	}

	function renderCouponsPanel(wallet: WalletView): string {
		const cards = wallet.coupons.length
			? wallet.coupons
					.slice()
					.sort((a, b) => (b.redeemedAt || '').localeCompare(a.redeemedAt || ''))
					.map((coupon) => `<div style="border:1px solid #e3e8ef;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff;">
						<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
							<div>
								<strong>${escapeHtml(coupon.title)}</strong>
								<div style="font-size:12px;color:#777;margin-top:4px;">${escapeHtml(coupon.code)} · ${escapeHtml(couponKindLabel(coupon.kind))}</div>
							</div>
							<span style="font-size:12px;color:#1976d2;font-weight:600;">${escapeHtml(coupon.status === 'used' ? '已使用' : coupon.status)}</span>
						</div>
						${coupon.description ? `<div style="font-size:12px;color:#555;margin-top:8px;line-height:1.6;">${escapeHtml(coupon.description)}</div>` : ''}
						${coupon.effectSummary ? `<div style="font-size:12px;color:#345;margin-top:8px;padding:8px;border-radius:6px;background:#f5f9ff;">${escapeHtml(coupon.effectSummary)}</div>` : ''}
						<div style="font-size:11px;color:#999;margin-top:8px;">兑换时间：${escapeHtml(formatDateTime(coupon.redeemedAt))}</div>
					</div>`)
					.join('')
			: `<div style="border:1px dashed #d8dee6;border-radius:8px;padding:18px;text-align:center;color:#777;background:#fafafa;">暂无已兑换卡券</div>`;
		return `<div style="font-size:13px;color:#333;">
			<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
				<div>当前共有 <strong>${wallet.couponCount}</strong> 张卡券记录</div>
				<button type="button" id="wallet-open-redeem" style="padding:6px 10px;border:1px solid #1976d2;background:#fff;color:#1976d2;border-radius:4px;cursor:pointer;">兑换新卡券</button>
			</div>
			${cards}
		</div>`;
	}

	async function submitRedeem(modal: HTMLDivElement, ctx: PCContext): Promise<void> {
		const token = activeToken(ctx);
		const api = window.APIClient;
		const input = modal.querySelector('#wallet-redeem-code') as HTMLInputElement | null;
		const submit = modal.querySelector('#wallet-redeem-submit') as HTMLButtonElement | null;
		const result = modal.querySelector('#wallet-redeem-result') as HTMLDivElement | null;
		const code = (input?.value || '').trim();
		if (!token) {
			showToast('请先登录后兑换');
			return;
		}
		if (!code) {
			showToast('请输入兑换码');
			input?.focus();
			return;
		}
		if (!api || typeof api.redeemCode !== 'function') {
			showToast('兑换接口暂不可用');
			return;
		}
		if (submit) {
			submit.disabled = true;
			submit.textContent = '兑换中…';
		}
		try {
			const response = asRecord(await api.redeemCode(token, code)) || {};
			const wallet = normalizeWallet(response.wallet);
			applyWalletToContext(wallet);
			const redemption = normalizeWalletCoupon(response.redemption);
			if (result) {
				result.style.display = 'block';
				result.textContent = redemption?.effectSummary || '兑换成功';
			}
			if (input) input.value = '';
			showToast('兑换成功');
		} catch (error) {
			showToast(readErrorMessage(error, '兑换失败'));
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.textContent = '确认兑换';
			}
		}
	}

	async function openRedeemPanel(): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后兑换');
			return;
		}
		const modal = ensureWalletModal();
		const title = modal.querySelector('#wallet-title') as HTMLElement | null;
		const body = modal.querySelector('#wallet-body') as HTMLDivElement | null;
		if (!body) return;
		if (title) title.textContent = '兑换码';
		body.innerHTML = '<div style="padding:18px;color:#777;">正在加载账户信息…</div>';
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		try {
			const wallet = await loadWallet(ctx);
			applyWalletToContext(wallet);
			body.innerHTML = renderRedeemPanel(getContext(), wallet);
			(modal.querySelector('#wallet-show-coupons') as HTMLButtonElement | null)?.addEventListener('click', () => {
				void openCouponsPanel();
			});
			const form = modal.querySelector('#wallet-redeem-form') as HTMLFormElement | null;
			if (form) {
				form.onsubmit = (event) => {
					event.preventDefault();
					void submitRedeem(modal, getContext());
				};
			}
			(modal.querySelector('#wallet-redeem-code') as HTMLInputElement | null)?.focus();
		} catch (error) {
			body.innerHTML = `<div style="padding:18px;color:#a33;">${escapeHtml(readErrorMessage(error, '账户信息加载失败'))}</div>`;
		}
	}

	async function openCouponsPanel(): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后查看卡券包');
			return;
		}
		const modal = ensureWalletModal();
		const title = modal.querySelector('#wallet-title') as HTMLElement | null;
		const body = modal.querySelector('#wallet-body') as HTMLDivElement | null;
		if (!body) return;
		if (title) title.textContent = '卡券包';
		body.innerHTML = '<div style="padding:18px;color:#777;">正在加载卡券包…</div>';
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		try {
			const wallet = await loadWallet(ctx);
			applyWalletToContext(wallet);
			body.innerHTML = renderCouponsPanel(wallet);
			(modal.querySelector('#wallet-open-redeem') as HTMLButtonElement | null)?.addEventListener('click', () => {
				void openRedeemPanel();
			});
		} catch (error) {
			body.innerHTML = `<div style="padding:18px;color:#a33;">${escapeHtml(readErrorMessage(error, '卡券包加载失败'))}</div>`;
		}
	}

	async function openPaymentLedgerPanel(): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (ctx.guest || !ctx.id || !token) {
			showToast('请先登录后查看支付流水');
			return;
		}
		const modal = ensureWalletModal();
		const title = modal.querySelector('#wallet-title') as HTMLElement | null;
		const body = modal.querySelector('#wallet-body') as HTMLDivElement | null;
		if (!body) return;
		if (title) title.textContent = '支付流水';
		body.innerHTML = '<div style="padding:18px;color:#777;">正在加载支付流水…</div>';
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		try {
			if (!api || typeof api.listPaymentLedger !== 'function') {
				throw new Error('支付流水接口暂不可用');
			}
			const rawRows = await api.listPaymentLedger(token);
			const rows = Array.isArray(rawRows)
				? rawRows.map(normalizePaymentLedgerEntry).filter((item): item is PaymentLedgerEntry => Boolean(item))
				: [];
			body.innerHTML = rows.length
				? rows
						.slice()
						.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
						.map((entry) => `<div style="border:1px solid #e3e8ef;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff;">
							<div style="display:flex;justify-content:space-between;gap:12px;">
								<strong>${escapeHtml(entry.summary || entry.type)}</strong>
								<span style="font-weight:600;color:${entry.amountCents < 0 ? '#a33' : '#1976d2'};">${escapeHtml(formatPaymentAmount(entry.amountCents, entry.currency))}</span>
							</div>
							<div style="font-size:12px;color:#777;margin-top:6px;">${escapeHtml(entry.type)} · ${escapeHtml(entry.orderId)}</div>
							<div style="font-size:11px;color:#999;margin-top:6px;">${escapeHtml(formatDateTime(entry.createdAt))}</div>
						</div>`)
						.join('')
				: '<div style="border:1px dashed #d8dee6;border-radius:8px;padding:18px;text-align:center;color:#777;background:#fafafa;">暂无支付流水</div>';
		} catch (error) {
			body.innerHTML = `<div style="padding:18px;color:#a33;">${escapeHtml(readErrorMessage(error, '支付流水加载失败'))}</div>`;
		}
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
			const data = asRecord(await api.sendEmailVerificationCode(token, normalizedEmail));
			contactVerificationDraft.email = normalizedEmail;
			const remaining = data && typeof data.daily_remaining === 'number' ? `，今日剩余 ${data.daily_remaining} 次` : '';
			showToast(`邮箱验证码已发送${remaining}`);
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
			const data = asRecord(await api.sendPhoneVerificationCode(normalizedPhone));
			contactVerificationDraft.phone = normalizedPhone;
			const remaining = data && typeof data.daily_remaining === 'number' ? `，今日剩余 ${data.daily_remaining} 次` : '';
			showToast(`手机验证码已发送${remaining}`);
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

	function normalizeManagedCampus(value: unknown): ManagedCampus | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const id = readString(raw.campus_id) || readString(raw.id);
		const name = readString(raw.name);
		if (!id || !name) {
			return null;
		}
		return {
			id,
			name,
			address: readString(raw.address),
			status: readString(raw.status) || 'active'
		};
	}

	function normalizeLearningGroupEnrollment(value: unknown): ManagedLearningGroupEnrollment | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const userId = readString(raw.user_id);
		if (!userId) {
			return null;
		}
		const role = readString(raw.role);
		return {
			enrollmentId: readString(raw.enrollment_id) || `${userId}-enrollment`,
			userId,
			role: role === 'teacher' || role === 'assistant' ? role : 'student',
			status: readString(raw.status) || 'active'
		};
	}

	function normalizeManagedLearningGroup(value: unknown): ManagedLearningGroup | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const id = readString(raw.learning_group_id) || readString(raw.group_id) || readString(raw.id);
		const name = readString(raw.name);
		if (!id || !name) {
			return null;
		}
		const type = readString(raw.type);
		return {
			id,
			name,
			type: type === 'booking' ? 'booking' : 'class',
			subject: readString(raw.subject),
			campusId: readString(raw.campus_id),
			coursePackageId: readString(raw.course_package_id),
			startsAt: readString(raw.starts_at),
			endsAt: readString(raw.ends_at),
			status: readString(raw.status) || 'active',
			enrollments: Array.isArray(raw.enrollments)
				? raw.enrollments
						.map((item) => normalizeLearningGroupEnrollment(item))
						.filter((item): item is ManagedLearningGroupEnrollment => Boolean(item))
				: []
		};
	}

	function normalizeManagedCoursePackage(value: unknown): ManagedCoursePackage | null {
		const raw = asRecord(value);
		if (!raw) {
			return null;
		}
		const id = readString(raw.course_package_id) || readString(raw.id);
		const studentId = readString(raw.student_id);
		if (!id || !studentId) {
			return null;
		}
		return {
			id,
			studentId,
			subject: readString(raw.subject),
			title: readString(raw.title),
			totalLessons: readCount(raw.total_lessons) ?? 0,
			usedLessons: readCount(raw.used_lessons) ?? 0,
			remainingLessons: readCount(raw.remaining_lessons) ?? 0,
			expiresAt: readString(raw.expires_at),
			status: readString(raw.status) || 'active'
		};
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
			assistant: 'assistant',
			助教: 'assistant',
			教务: 'assistant',
			班主任: 'assistant',
			顾问: 'assistant',
			课程顾问: 'assistant',
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
		memberNo: string,
		permissionTemplates: PermissionTemplateId[] = [],
		permissionOverrides: PermissionOverride[] = []
	): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationMember !== 'function') {
			throw new Error('成员管理接口暂不可用');
		}
		await api.saveOrganizationMember(organization.id, token, buildOrganizationMemberPayload(organization, userId.trim(), roles, memberNo, permissionTemplates, permissionOverrides));
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

	function normalizePermissionTemplates(value: unknown, roles: string[] = []): PermissionTemplateId[] {
		const items = Array.isArray(value) ? value : [];
		const roleSet = new Set(roles);
		const allowed = new Set(organizationPermissionTemplateDefs.map((item) => item.id));
		return Array.from(
			new Set(
				items
					.map((item) => readString(item))
					.filter((item): item is PermissionTemplateId => {
						if (!allowed.has(item as PermissionTemplateId)) {
							return false;
						}
						if (item === 'campusAdmin') {
							return roleSet.has('orgAdmin');
						}
						return roleSet.has('assistant');
					})
			)
		);
	}

	function renderOrganizationTemplateControls(selectedTemplates: PermissionTemplateId[], selectedRoles: string[], name: string): string {
		const roleSet = new Set(selectedRoles);
		const templateSet = new Set(selectedTemplates);
		return `<div class="pc-org-template-block"><div class="pc-admin-note">权限模板是预设权限组合；助教/班主任/教务/顾问模板需搭配“教学运营”，校区管理员模板需搭配“机构管理员”。</div><div class="pc-role-toggle-group">${organizationPermissionTemplateDefs
			.map(
				(template) => `<label class="pc-role-toggle" title="${escapeHtml(template.desc)}"><input type="checkbox" data-org-template name="${escapeHtml(name)}" value="${escapeHtml(template.id)}"${templateSet.has(template.id) && roleSet.has(template.role) ? ' checked' : ''} /><span>${escapeHtml(template.name)}</span></label>`
			)
			.join('')}</div></div>`;
	}

	function readOrganizationPermissionTemplates(scope: ParentNode, roles: string[]): PermissionTemplateId[] {
		return normalizePermissionTemplates(
			Array.from(scope.querySelectorAll('input[data-org-template]:checked')).map((input) => ((input as HTMLInputElement).value || '').trim()),
			roles
		);
	}

	function normalizeOrganizationPermissionOverrides(value: unknown): PermissionOverride[] {
		const items = Array.isArray(value) ? value : [];
		const allowed = new Set(organizationPermissionDefs.map((item) => item.id));
		return items
			.map((item) => asRecord(item))
			.filter((item): item is Record<string, unknown> => Boolean(item))
			.map((item) => {
				const permission = readString(item.permission);
				if (!permission || !allowed.has(permission)) {
					return null;
				}
				return {
					permission,
					effect: readString(item.effect) === 'deny' ? 'deny' : 'allow',
					scope: normalizePermissionScope(readString(item.scope) || ''),
					scopeId: readString(item.scopeId) || readString(item.scope_id) || '',
					expiresAt: readString(item.expiresAt) || readString(item.expires_at) || ''
				} as PermissionOverride;
			})
			.filter((item): item is PermissionOverride => Boolean(item));
	}

	function normalizePermissionScope(value: string): PermissionOverride['scope'] {
		if (value === 'personal' || value === 'learningGroup' || value === 'campus' || value === 'organization') {
			return value;
		}
		return 'organization';
	}

	function renderOrganizationPermissionControls(overrides: PermissionOverride[], expiresAt = ''): string {
		const allowSet = new Set(overrides.filter((item) => item.effect !== 'deny').map((item) => item.permission));
		const denySet = new Set(overrides.filter((item) => item.effect === 'deny').map((item) => item.permission));
		const scope = overrides.find((item) => item.scope !== 'organization')?.scope || 'organization';
		const scopeId = overrides.find((item) => item.scopeId)?.scopeId || '';
		const expiry = expiresAt || overrides.find((item) => item.expiresAt)?.expiresAt || '';
		const permissionsMarkup = organizationPermissionDefs
			.map((permission) => `<label class="pc-role-toggle pc-permission-toggle"><input type="checkbox" data-org-permission value="${escapeHtml(permission.id)}"${allowSet.has(permission.id) ? ' checked' : ''} /><span>${escapeHtml(permission.name)}</span></label>`)
			.join('');
		const denyMarkup = organizationPermissionDefs
			.filter((permission) => allowSet.has(permission.id) || denySet.has(permission.id))
			.map((permission) => `<label class="pc-role-toggle pc-permission-toggle"><input type="checkbox" data-org-permission-deny value="${escapeHtml(permission.id)}"${denySet.has(permission.id) ? ' checked' : ''} /><span>禁用 ${escapeHtml(permission.name)}</span></label>`)
			.join('');
		const expiringText = expiry ? `有效期到 ${formatDateTime(expiry)}` : '永久有效';
		return `<details class="pc-org-permission-editor"${overrides.length ? ' open' : ''} data-org-permission-editor>
			<summary>额外权限${overrides.length ? `（${escapeHtml(String(overrides.length))}）` : ''} · ${escapeHtml(expiringText)}</summary>
			<div class="pc-admin-note">角色提供默认权限；这里仅处理个别成员的额外授权或禁用。保存后会写入组织操作审计，deny 优先于 allow。</div>
			<div class="pc-org-form-grid pc-org-form-grid-compact">
				<label class="pc-org-field">
					<span>权限范围</span>
					<select class="pc-profile-input pc-org-select" data-org-permission-scope>
						<option value="organization"${scope === 'organization' ? ' selected' : ''}>整个机构</option>
						<option value="campus"${scope === 'campus' ? ' selected' : ''}>指定校区</option>
						<option value="learningGroup"${scope === 'learningGroup' ? ' selected' : ''}>指定学习组</option>
						<option value="personal"${scope === 'personal' ? ' selected' : ''}>个人</option>
					</select>
				</label>
				<label class="pc-org-field">
					<span>范围 ID</span>
					<input class="pc-profile-input" type="text" data-org-permission-scope-id value="${escapeHtml(scopeId)}" placeholder="校区 / 学习组 / 用户 ID，可留空" />
				</label>
				<label class="pc-org-field">
					<span>有效期</span>
					<input class="pc-profile-input" type="date" data-org-permission-expires value="${escapeHtml(expiry.slice(0, 10))}" />
				</label>
			</div>
			<div class="pc-role-toggle-group pc-permission-group">${permissionsMarkup}</div>
			${denyMarkup ? `<div class="pc-role-toggle-group pc-permission-group pc-deny-group">${denyMarkup}</div>` : ''}
		</details>`;
	}

	function readOrganizationPermissionOverrides(scope: ParentNode): PermissionOverride[] {
		const permissionScope = normalizePermissionScope((scope.querySelector('[data-org-permission-scope]') as HTMLSelectElement | null)?.value || 'organization');
		const scopeId = ((scope.querySelector('[data-org-permission-scope-id]') as HTMLInputElement | null)?.value || '').trim();
		const expires = ((scope.querySelector('[data-org-permission-expires]') as HTMLInputElement | null)?.value || '').trim();
		const expiresAt = expires ? `${expires}T23:59:59Z` : '';
		const allowed = Array.from(scope.querySelectorAll('input[data-org-permission]:checked')).map((input) => ((input as HTMLInputElement).value || '').trim());
		const denied = new Set(Array.from(scope.querySelectorAll('input[data-org-permission-deny]:checked')).map((input) => ((input as HTMLInputElement).value || '').trim()));
		const overrides: PermissionOverride[] = [];
		for (const permission of allowed) {
			overrides.push({ permission, effect: denied.has(permission) ? 'deny' : 'allow', scope: permissionScope, scopeId, expiresAt });
		}
		for (const permission of denied) {
			if (!allowed.includes(permission)) {
				overrides.push({ permission, effect: 'deny', scope: permissionScope, scopeId, expiresAt });
			}
		}
		return normalizeOrganizationPermissionOverrides(overrides);
	}

	function buildOrganizationMemberPayload(
		organization: ManagedOrganization,
		userId: string,
		roles: string[],
		memberNo: string,
		permissionTemplates: PermissionTemplateId[],
		permissionOverrides: PermissionOverride[] = []
	): Record<string, unknown> {
		const normalizedMemberNo = memberNo.trim();
		const payload: Record<string, unknown> = {
			user_id: userId,
			roles,
			permission_templates: normalizePermissionTemplates(permissionTemplates, roles),
			permission_overrides: permissionOverrides.map((item) => ({
				permission: item.permission,
				effect: item.effect,
				scope: item.scope,
				scope_id: item.scopeId || '',
				expires_at: item.expiresAt || ''
			}))
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
		permissionTemplates: PermissionTemplateId[],
		permissionOverrides: PermissionOverride[],
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
			await persistOrganizationMembership(organization, userId, roles, memberNo, permissionTemplates, permissionOverrides);
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
		permissionTemplates: PermissionTemplateId[],
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
				permission_templates: normalizePermissionTemplates(permissionTemplates, roles),
				member_no: memberNo.trim(),
				message: message.trim()
			});
			const draft = getOrganizationMemberDraft(organization.id);
			draft.inviteContact = '';
			draft.inviteMemberNo = '';
			draft.permissionTemplates = [];
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

	async function saveOrganizationCampus(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationCampus !== 'function') {
			showToast('校区管理接口暂不可用');
			return;
		}
		const name = ((form.querySelector('[data-org-campus-name]') as HTMLInputElement | null)?.value || '').trim();
		if (!name) {
			showToast('请输入校区名称');
			return;
		}
		try {
			await api.saveOrganizationCampus(organization.id, token, {
				campus_id: ((form.querySelector('[data-org-campus-id]') as HTMLInputElement | null)?.value || '').trim(),
				name,
				address: ((form.querySelector('[data-org-campus-address]') as HTMLInputElement | null)?.value || '').trim(),
				status: (form.querySelector('[data-org-campus-status]') as HTMLSelectElement | null)?.value || 'active'
			});
			await refreshManagedOrganizations();
			showToast('校区已保存');
		} catch (error) {
			log('save organization campus failed', organization.id, error);
			showToast(readErrorMessage(error, '校区保存失败'));
		}
	}

	async function saveOrganizationLearningGroup(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationLearningGroup !== 'function') {
			showToast('学习组管理接口暂不可用');
			return;
		}
		const name = ((form.querySelector('[data-org-learning-group-name]') as HTMLInputElement | null)?.value || '').trim();
		if (!name) {
			showToast('请输入学习组名称');
			return;
		}
		try {
			await api.saveOrganizationLearningGroup(organization.id, token, {
				learning_group_id: ((form.querySelector('[data-org-learning-group-id]') as HTMLInputElement | null)?.value || '').trim(),
				name,
				type: (form.querySelector('[data-org-learning-group-type]') as HTMLSelectElement | null)?.value || 'class',
				subject: ((form.querySelector('[data-org-learning-group-subject]') as HTMLInputElement | null)?.value || '').trim(),
				campus_id: (form.querySelector('[data-org-learning-group-campus]') as HTMLSelectElement | null)?.value || '',
				course_package_id: (form.querySelector('[data-org-learning-group-package]') as HTMLSelectElement | null)?.value || '',
				starts_at: ((form.querySelector('[data-org-learning-group-starts]') as HTMLInputElement | null)?.value || '').trim(),
				ends_at: ((form.querySelector('[data-org-learning-group-ends]') as HTMLInputElement | null)?.value || '').trim(),
				status: (form.querySelector('[data-org-learning-group-status]') as HTMLSelectElement | null)?.value || 'active'
			});
			await refreshManagedOrganizations();
			showToast('学习组已保存');
		} catch (error) {
			log('save organization learning group failed', organization.id, error);
			showToast(readErrorMessage(error, '学习组保存失败'));
		}
	}

	async function saveOrganizationCoursePackage(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationCoursePackage !== 'function') {
			showToast('课程包管理接口暂不可用');
			return;
		}
		const studentId = (form.querySelector('[data-org-course-package-student]') as HTMLSelectElement | null)?.value || '';
		if (!studentId) {
			showToast('请选择学员');
			return;
		}
		const totalLessons = Math.max(0, Math.floor(Number((form.querySelector('[data-org-course-package-total]') as HTMLInputElement | null)?.value || '0')));
		const usedLessons = Math.max(0, Math.floor(Number((form.querySelector('[data-org-course-package-used]') as HTMLInputElement | null)?.value || '0')));
		if (totalLessons <= 0) {
			showToast('课程包总课时必须大于 0');
			return;
		}
		try {
			await api.saveOrganizationCoursePackage(organization.id, token, {
				course_package_id: ((form.querySelector('[data-org-course-package-id]') as HTMLInputElement | null)?.value || '').trim(),
				student_id: studentId,
				subject: ((form.querySelector('[data-org-course-package-subject]') as HTMLInputElement | null)?.value || '').trim(),
				title: ((form.querySelector('[data-org-course-package-title]') as HTMLInputElement | null)?.value || '').trim(),
				total_lessons: totalLessons,
				used_lessons: usedLessons,
				expires_at: ((form.querySelector('[data-org-course-package-expires]') as HTMLInputElement | null)?.value || '').trim(),
				status: (form.querySelector('[data-org-course-package-status]') as HTMLSelectElement | null)?.value || 'active'
			});
			await refreshManagedOrganizations();
			showToast('课程包已保存');
		} catch (error) {
			log('save organization course package failed', organization.id, error);
			showToast(readErrorMessage(error, '课程包保存失败'));
		}
	}

	async function saveOrganizationLearningGroupEnrollment(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveLearningGroupEnrollment !== 'function') {
			showToast('学习组成员接口暂不可用');
			return;
		}
		const learningGroupId = (form.querySelector('[data-org-enrollment-group]') as HTMLSelectElement | null)?.value || '';
		const userId = (form.querySelector('[data-org-enrollment-user]') as HTMLSelectElement | null)?.value || '';
		if (!learningGroupId || !userId) {
			showToast('请选择学习组和成员');
			return;
		}
		try {
			await api.saveLearningGroupEnrollment(organization.id, learningGroupId, token, {
				user_id: userId,
				role: (form.querySelector('[data-org-enrollment-role]') as HTMLSelectElement | null)?.value || 'student',
				status: (form.querySelector('[data-org-enrollment-status]') as HTMLSelectElement | null)?.value || 'active'
			});
			await refreshManagedOrganizations();
			showToast('学习组成员已保存');
		} catch (error) {
			log('save learning group enrollment failed', organization.id, learningGroupId, userId, error);
			showToast(readErrorMessage(error, '学习组成员保存失败'));
		}
	}

	async function completeOrganizationLearningGroup(organization: ManagedOrganization, learningGroup: ManagedLearningGroup): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.completeOrganizationLearningGroup !== 'function') {
			showToast('完成学习组接口暂不可用');
			return;
		}
		const label = learningGroup.type === 'booking' && learningGroup.coursePackageId
			? `确认完成 ${learningGroup.name} 并扣减 1 次课程包课时吗？`
			: `确认将 ${learningGroup.name} 标记为已完成吗？`;
		if (!window.confirm(label)) {
			return;
		}
		try {
			const note = window.prompt('课后备注（可留空）', '') || '';
			await api.completeOrganizationLearningGroup(organization.id, learningGroup.id, token, { note });
			await refreshManagedOrganizations();
			showToast(learningGroup.type === 'booking' && learningGroup.coursePackageId ? '已完成约课并扣减课时' : '学习组已完成');
		} catch (error) {
			log('complete learning group failed', organization.id, learningGroup.id, error);
			showToast(readErrorMessage(error, '学习组完成失败'));
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
				await persistOrganizationMembership(organization, matchedUser.id, roles, memberNoPart.trim(), [], []);
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
					let campuses: ManagedCampus[] = [];
					let learningGroups: ManagedLearningGroup[] = [];
					let coursePackages: ManagedCoursePackage[] = [];
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
									permissionTemplates: normalizePermissionTemplates(invitation.permission_templates || invitation.permissionTemplates, readStringArray(invitation.roles) || ['student']),
									permissionOverrides: normalizeOrganizationPermissionOverrides(invitation.permission_overrides || invitation.permissionOverrides),
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
							permissionTemplates: normalizePermissionTemplates(member.permission_templates || member.permissionTemplates, readStringArray(member.roles) || []),
							permissionOverrides: normalizeOrganizationPermissionOverrides(member.permission_overrides || member.permissionOverrides),
							status: readString(member.status) || 'active'
						}));
						memberCount = memberCount || members.length;
					} catch (error) {
						log('load organization members failed', organizationId, error);
					}
					if (typeof api.getOrganizationCampuses === 'function') {
						try {
							const campusValues = (await api.getOrganizationCampuses(organizationId, token)) as unknown[];
							campuses = Array.isArray(campusValues)
								? campusValues
										.map((item) => normalizeManagedCampus(item))
										.filter((item): item is ManagedCampus => Boolean(item))
								: [];
						} catch (error) {
							log('load organization campuses failed', organizationId, error);
						}
					}
					if (typeof api.getOrganizationLearningGroups === 'function') {
						try {
							const groupValues = (await api.getOrganizationLearningGroups(organizationId, token)) as unknown[];
							learningGroups = Array.isArray(groupValues)
								? groupValues
										.map((item) => normalizeManagedLearningGroup(item))
										.filter((item): item is ManagedLearningGroup => Boolean(item))
								: [];
						} catch (error) {
							log('load organization learning groups failed', organizationId, error);
						}
					}
					if (typeof api.getOrganizationCoursePackages === 'function') {
						try {
							const packageValues = (await api.getOrganizationCoursePackages(organizationId, token)) as unknown[];
							coursePackages = Array.isArray(packageValues)
								? packageValues
										.map((item) => normalizeManagedCoursePackage(item))
										.filter((item): item is ManagedCoursePackage => Boolean(item))
								: [];
						} catch (error) {
							log('load organization course packages failed', organizationId, error);
						}
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
						campuses,
						learningGroups,
						coursePackages,
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

		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>邀请成员</h4><span>${escapeHtml(String(pendingCount))} 个待接受</span></div><div class="pc-admin-note">支持直接填写邮箱或手机号。系统会自动发送邮件或短信，并要求对方验证匹配联系人后才能接受邀请。</div><form class="pc-org-add-form" data-org-invite-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid"><label class="pc-org-field pc-org-field-wide"><span>邮箱或手机号</span><input class="pc-profile-input" type="text" data-org-invite-contact value="${escapeHtml(draft.inviteContact)}" placeholder="name@example.com / 13800138000" /></label><label class="pc-org-field"><span>${escapeHtml(organizationMemberNoLabel(organization.organizationType))}</span><input class="pc-profile-input" type="text" maxlength="32" data-org-invite-member-no value="${escapeHtml(draft.inviteMemberNo)}" placeholder="留空自动生成" /></label></div><div class="pc-role-toggle-group">${renderOrganizationRoleControls(['student'], `org-invite-${organization.id}`)}</div>${renderOrganizationTemplateControls(draft.permissionTemplates, ['student'], `org-invite-template-${organization.id}`)}<label class="pc-org-field"><span>邀请备注</span><textarea class="pc-org-batch-input" data-org-invite-message rows="3" placeholder="例如：欢迎加入第三期日语冲刺班">${escapeHtml(draft.inviteMessage)}</textarea></label><div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit">创建邀请</button></div></form><div class="pc-org-invite-list">${invitationMarkup}</div></div>`;
	}

	function renderOrganizationSubscriptionPanel(organization: ManagedOrganization): string {
		const expiryInput = organization.expiresAt ? organization.expiresAt.slice(0, 10) : '';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>套餐与席位</h4><span>${escapeHtml(subscriptionExpirySummary(organization.expiresAt, organization.status))}</span></div><form class="pc-org-add-form" data-org-subscription-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>套餐</span><select class="pc-profile-input pc-org-select" data-org-plan><option value="free"${organization.plan === 'free' ? ' selected' : ''}>FREE</option><option value="pro"${organization.plan === 'pro' ? ' selected' : ''}>PRO</option><option value="ultra"${organization.plan === 'ultra' ? ' selected' : ''}>ULTRA</option></select></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-status><option value="active"${organization.status === 'active' ? ' selected' : ''}>active</option><option value="trial"${organization.status === 'trial' ? ' selected' : ''}>trial</option><option value="expired"${organization.status === 'expired' ? ' selected' : ''}>expired</option><option value="canceled"${organization.status === 'canceled' ? ' selected' : ''}>canceled</option></select></label><label class="pc-org-field"><span>席位数</span><input class="pc-profile-input" type="number" min="1" step="1" data-org-seats value="${escapeHtml(String(organization.seats || defaultSeatsForPlan(organization.plan)))}" /></label></div><div class="pc-org-form-grid"><label class="pc-org-field"><span>到期日期</span><input class="pc-profile-input" type="date" data-org-expires-at value="${escapeHtml(expiryInput)}" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存套餐</button></div></div><div class="pc-admin-note">当前成员 ${escapeHtml(String(organization.memberCount))} 人，建议席位不低于成员数。切换套餐时会自动写入组织审计日志。</div></form></div>`;
	}

	function organizationMemberLabelById(organization: ManagedOrganization, userId: string): string {
		const member = organization.members.find((item) => item.userId === userId);
		if (member) {
			return organizationMemberDisplayName(member);
		}
		return allUsers.find((user) => user.id === userId)?.displayName || userId;
	}

	function renderOrganizationCampusPanel(organization: ManagedOrganization): string {
		const campusList = organization.campuses.length
			? organization.campuses
					.map((campus) => `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(campus.name)}</strong><span>${escapeHtml(campus.status)} · ${escapeHtml(campus.id)}</span></div></div>${campus.address ? `<div class="pc-admin-note">${escapeHtml(campus.address)}</div>` : ''}</div>`)
					.join('')
			: '<div class="pc-org-empty">还没有校区。小机构可以只建一个“默认校区”，多校区机构可按校区分配权限范围。</div>';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>校区管理</h4><span>${escapeHtml(String(organization.campuses.length))} 个校区</span></div><form class="pc-org-add-form" data-org-campus-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>校区ID（更新时填写）</span><input class="pc-profile-input" data-org-campus-id placeholder="留空新建" /></label><label class="pc-org-field"><span>校区名称</span><input class="pc-profile-input" data-org-campus-name placeholder="东京校区" /></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-campus-status><option value="active">active</option><option value="disabled">disabled</option></select></label></div><div class="pc-org-form-grid"><label class="pc-org-field pc-org-field-wide"><span>地址/备注</span><input class="pc-profile-input" data-org-campus-address placeholder="校区地址或内部备注" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存校区</button></div></div></form><div class="pc-org-invite-list">${campusList}</div></div>`;
	}

	function renderOrganizationCoursePackagePanel(organization: ManagedOrganization): string {
		const studentMembers = organization.members.filter((member) => member.roles.includes('student'));
		const studentOptions = studentMembers.length
			? studentMembers.map((member) => `<option value="${escapeHtml(member.userId)}">${escapeHtml(organizationMemberDisplayName(member))}</option>`).join('')
			: '<option value="">请先添加学员成员</option>';
		const packageList = organization.coursePackages.length
			? organization.coursePackages
					.map((item) => `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(item.title || item.subject || item.id)}</strong><span>${escapeHtml(organizationMemberLabelById(organization, item.studentId))} · ${escapeHtml(item.status)}</span></div><span>${escapeHtml(String(item.remainingLessons))}/${escapeHtml(String(item.totalLessons))} 次</span></div><div class="pc-org-invite-meta"><span>ID：${escapeHtml(item.id)}</span><span>科目：${escapeHtml(item.subject || '-')}</span><span>已用：${escapeHtml(String(item.usedLessons))}</span>${item.expiresAt ? `<span>到期：${escapeHtml(item.expiresAt)}</span>` : ''}</div></div>`)
					.join('')
			: '<div class="pc-org-empty">还没有课程包。课程包只绑定学员和科目，不绑定固定老师。</div>';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>课程包</h4><span>${escapeHtml(String(organization.coursePackages.length))} 个</span></div><form class="pc-org-add-form" data-org-course-package-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>课程包ID（更新时填写）</span><input class="pc-profile-input" data-org-course-package-id placeholder="留空新建" /></label><label class="pc-org-field"><span>学员</span><select class="pc-profile-input pc-org-select" data-org-course-package-student>${studentOptions}</select></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-course-package-status><option value="active">active</option><option value="paused">paused</option><option value="expired">expired</option><option value="finished">finished</option></select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>标题</span><input class="pc-profile-input" data-org-course-package-title placeholder="文综约课 20 次" /></label><label class="pc-org-field"><span>科目</span><input class="pc-profile-input" data-org-course-package-subject placeholder="japanese / sogo / writing" /></label><label class="pc-org-field"><span>到期时间</span><input class="pc-profile-input" type="date" data-org-course-package-expires /></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>总课时</span><input class="pc-profile-input" type="number" min="1" step="1" data-org-course-package-total value="20" /></label><label class="pc-org-field"><span>已用课时</span><input class="pc-profile-input" type="number" min="0" step="1" data-org-course-package-used value="0" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存课程包</button></div></div></form><div class="pc-org-invite-list">${packageList}</div></div>`;
	}

	function renderLearningGroupCompleteButton(organization: ManagedOrganization, group: ManagedLearningGroup): string {
		if (group.status === 'completed') {
			return '<span class="pc-tag muted">已完成</span>';
		}
		return `<button class="pc-inline-btn" type="button" data-org-learning-group-complete data-org-id="${escapeHtml(organization.id)}" data-learning-group-id="${escapeHtml(group.id)}">${group.type === 'booking' && group.coursePackageId ? '完成并扣课时' : '标记完成'}</button>`;
	}

	function renderOrganizationSchedulePanel(organization: ManagedOrganization): string {
		const sortedGroups = [...organization.learningGroups].sort((left, right) => {
			const leftTime = Date.parse(left.startsAt || '');
			const rightTime = Date.parse(right.startsAt || '');
			const safeLeft = Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime;
			const safeRight = Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime;
			if (safeLeft !== safeRight) {
				return safeLeft - safeRight;
			}
			return left.name.localeCompare(right.name, 'zh-CN');
		});
		const scheduleItems = sortedGroups.length
			? sortedGroups
					.slice(0, 12)
					.map((group) => {
						const campus = organization.campuses.find((item) => item.id === group.campusId);
						const teachers = group.enrollments
							.filter((item) => item.role === 'teacher' || item.role === 'assistant')
							.map((item) => organizationMemberLabelById(organization, item.userId));
						const students = group.enrollments
							.filter((item) => item.role === 'student')
							.map((item) => organizationMemberLabelById(organization, item.userId));
						const timeText = group.startsAt
							? `${formatDateTime(group.startsAt)}${group.endsAt ? ` - ${formatDateTime(group.endsAt)}` : ''}`
							: '未排时间';
						const typeText = group.type === 'booking' ? '约课' : '班级';
						return `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(timeText)}</span></div><div class="pc-org-form-actions">${renderLearningGroupCompleteButton(organization, group)}</div></div><div class="pc-org-invite-meta"><span>${escapeHtml(typeText)} · ${escapeHtml(group.status)}</span><span>科目：${escapeHtml(group.subject || '-')}</span><span>校区：${escapeHtml(campus?.name || '未指定')}</span><span>老师：${escapeHtml(teachers.join(' / ') || '未指定')}</span><span>学员：${escapeHtml(students.join(' / ') || '未指定')}</span></div></div>`;
					})
					.join('')
			: '<div class="pc-org-empty">还没有日程。创建学习组时填写开始/结束时间后，会在这里按时间显示。</div>';
		const scheduledCount = organization.learningGroups.filter((group) => Boolean(group.startsAt)).length;
		const bookingCount = organization.learningGroups.filter((group) => group.type === 'booking').length;
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>排课日历</h4><span>${escapeHtml(String(scheduledCount))} 个已排时间 / ${escapeHtml(String(bookingCount))} 个约课</span></div><div class="pc-org-invite-list">${scheduleItems}</div></div>`;
	}

	function renderOrganizationLearningGroupPanel(organization: ManagedOrganization): string {
		const campusOptions = `<option value="">不指定校区</option>${organization.campuses.map((campus) => `<option value="${escapeHtml(campus.id)}">${escapeHtml(campus.name)}</option>`).join('')}`;
		const packageOptions = `<option value="">不绑定课程包</option>${organization.coursePackages.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.subject || item.id)} · ${escapeHtml(organizationMemberLabelById(organization, item.studentId))}</option>`).join('')}`;
		const groupOptions = organization.learningGroups.length
			? organization.learningGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('')
			: '<option value="">请先创建学习组</option>';
		const memberOptions = organization.members.length
			? organization.members.map((member) => `<option value="${escapeHtml(member.userId)}">${escapeHtml(organizationMemberDisplayName(member))}</option>`).join('')
			: '<option value="">请先添加成员</option>';
		const groupList = organization.learningGroups.length
			? organization.learningGroups
					.map((group) => {
						const campus = organization.campuses.find((item) => item.id === group.campusId);
						const enrollments = group.enrollments.length
							? group.enrollments.map((enrollment) => `${organizationMemberLabelById(organization, enrollment.userId)}(${enrollment.role})`).join(' / ')
							: '暂无成员';
						return `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.type === 'booking' ? '约课' : '班级')} · ${escapeHtml(group.status)} · ${escapeHtml(group.id)}</span></div><div class="pc-org-form-actions">${renderLearningGroupCompleteButton(organization, group)}</div></div><div class="pc-org-invite-meta"><span>科目：${escapeHtml(group.subject || '-')}</span><span>校区：${escapeHtml(campus?.name || '未指定')}</span><span>成员：${escapeHtml(enrollments)}</span>${group.coursePackageId ? `<span>课程包：${escapeHtml(group.coursePackageId)}</span>` : ''}${group.startsAt ? `<span>开始：${escapeHtml(group.startsAt)}</span>` : ''}</div></div>`;
					})
					.join('')
			: '<div class="pc-org-empty">还没有学习组。班级、小班课、一对一约课都用学习组表达。</div>';
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>学习组</h4><span>${escapeHtml(String(organization.learningGroups.length))} 个</span></div><form class="pc-org-add-form" data-org-learning-group-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>学习组ID（更新时填写）</span><input class="pc-profile-input" data-org-learning-group-id placeholder="留空新建" /></label><label class="pc-org-field"><span>名称</span><input class="pc-profile-input" data-org-learning-group-name placeholder="EJU 日语基础班 / 文综一对一" /></label><label class="pc-org-field"><span>类型</span><select class="pc-profile-input pc-org-select" data-org-learning-group-type><option value="class">班级 / 小班</option><option value="booking">约课课次</option></select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>科目</span><input class="pc-profile-input" data-org-learning-group-subject placeholder="japanese / sogo / writing" /></label><label class="pc-org-field"><span>校区</span><select class="pc-profile-input pc-org-select" data-org-learning-group-campus>${campusOptions}</select></label><label class="pc-org-field"><span>课程包</span><select class="pc-profile-input pc-org-select" data-org-learning-group-package>${packageOptions}</select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>开始时间</span><input class="pc-profile-input" type="datetime-local" data-org-learning-group-starts /></label><label class="pc-org-field"><span>结束时间</span><input class="pc-profile-input" type="datetime-local" data-org-learning-group-ends /></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-learning-group-status><option value="active">active</option><option value="scheduled">scheduled</option><option value="finished">finished</option><option value="canceled">canceled</option><option value="archived">archived</option></select></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存学习组</button></div></form><form class="pc-org-add-form" data-org-learning-enrollment-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>学习组</span><select class="pc-profile-input pc-org-select" data-org-enrollment-group>${groupOptions}</select></label><label class="pc-org-field"><span>成员</span><select class="pc-profile-input pc-org-select" data-org-enrollment-user>${memberOptions}</select></label><label class="pc-org-field"><span>身份</span><select class="pc-profile-input pc-org-select" data-org-enrollment-role><option value="student">学生</option><option value="teacher">老师</option><option value="assistant">助教/教务</option></select></label></div><div class="pc-org-form-grid"><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-enrollment-status><option value="active">active</option><option value="inactive">inactive</option></select></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存学习组成员</button></div></div></form><div class="pc-org-invite-list">${groupList}</div></div>`;
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
			${renderOrganizationTemplateControls(draft.permissionTemplates, ['student'], `org-add-template-${organization.id}`)}
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
		const overrideCount = member.permissionOverrides.length;
		const templateText = member.permissionTemplates.length
			? member.permissionTemplates.map(permissionTemplateLabel).join(' / ')
			: '未套用模板';
		return `<form class="pc-org-member-editor" data-org-member-form data-org-id="${escapeHtml(organization.id)}" data-user-id="${escapeHtml(member.userId)}">
			<div class="pc-org-member-head">
				<div class="pc-org-member-meta"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(metaParts.join(' · ') || '组织成员')}</span></div>
				<button class="pc-inline-danger" type="button" data-org-member-remove>移除成员</button>
			</div>
			<div class="pc-org-subsection-head"><h4>成员权限</h4><span>${escapeHtml(roleLabels(member.roles).join(' / ') || '未设置角色')} · ${escapeHtml(templateText)} · 额外权限 ${escapeHtml(String(overrideCount))} 项</span></div>
			<div class="pc-admin-note">基础角色决定默认权限；权限模板用于常见教务职责；额外权限可限定到整个机构、校区、学习组或个人，并可设置到期日期。</div>
			<div class="pc-role-toggle-group">${renderOrganizationRoleControls(member.roles, `org-member-${organization.id}-${member.userId}`)}</div>
			${renderOrganizationTemplateControls(member.permissionTemplates, member.roles, `org-member-template-${organization.id}-${member.userId}`)}
			${renderOrganizationPermissionControls(member.permissionOverrides)}
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
		if (window.isFeatureEnabled && !window.isFeatureEnabled('learning_groups')) {
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
					const assignmentId = String(it.assignment_id || '');
					const dueAt = escapeHtmlSafe(String(it.due_at || '不限期'));
					const submitted = !!asRecord(it.own_submission)?.submitted_at;
					return `
						<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed #eee;">
							<div>
								<div style="font-size:13px;">${title}${submitted ? ' · 已交' : ''}</div>
								<div style="font-size:12px;color:#888;">截止：${dueAt} · 试卷 <code>${escapeHtmlSafe(examId)}</code></div>
							</div>
							<button class="risk-btn" data-asg-action="open" data-exam-id="${escapeHtmlSafe(examId)}" data-assignment-id="${escapeHtmlSafe(assignmentId)}">${submitted ? '再做一次' : '去做题'}</button>
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
				const assignmentId = btn.dataset.assignmentId || '';
				if (!examId) return;
				if (assignmentId) {
					localStorage.setItem('exam_v2_active_assignment', JSON.stringify({ assignment_id: assignmentId, exam_id: examId }));
				}
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

	function findQuestionPosition(examData: Record<string, unknown>, questionId: string, preferredSectionIndex?: number): { sectionIndex: number; questionIndex: number } | null {
		const examInfo = (examData.exam_info || {}) as Record<string, unknown>;
		const sections = Array.isArray(examInfo.sections) ? (examInfo.sections as Array<Record<string, unknown>>) : [];
		const sectionIndexes = typeof preferredSectionIndex === 'number' && preferredSectionIndex >= 0
			? [preferredSectionIndex, ...sections.map((_, idx) => idx).filter((idx) => idx !== preferredSectionIndex)]
			: sections.map((_, idx) => idx);
		for (const sectionIndex of sectionIndexes) {
			const section = sections[sectionIndex];
			const questions = Array.isArray(section?.questions) ? (section.questions as Array<Record<string, unknown>>) : [];
			for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
				if (String(questions[questionIndex]?.id ?? '') === questionId) {
					return { sectionIndex, questionIndex };
				}
			}
		}
		return null;
	}

	async function openExamQuestion(examId: string, questionId: string, sectionIndex?: number): Promise<void> {
		const api = window.APIClient;
		const viewer = (window as unknown as {
			examViewer?: {
				loadExamData: (data: unknown) => void;
				jumpToQuestion?: (sectionIndex: number, questionIndex: number) => void;
				_currentExamId?: string | null;
			};
		}).examViewer;
		if (!questionId) {
			await resumeExam(examId, null);
			return;
		}
		if (!api || typeof api.getExam !== 'function' || !viewer) {
			showToast('当前环境无法直接打开题目，请手动打开试卷');
			return;
		}
		try {
			const examData = (await api.getExam(examId)) as Record<string, unknown>;
			viewer._currentExamId = examId;
			viewer.loadExamData(examData);
			const pos = findQuestionPosition(examData, questionId, sectionIndex);
			if (pos && typeof viewer.jumpToQuestion === 'function') {
				viewer.jumpToQuestion(pos.sectionIndex, pos.questionIndex);
				showToast('已跳转到收藏题');
			} else {
				showToast('已打开试卷，但没有定位到该题');
			}
			closePanel();
			document.querySelectorAll<HTMLElement>('.risk-modal').forEach((modal) => {
				modal.classList.add('risk-hidden');
				modal.style.display = 'none';
			});
		} catch (err) {
			showToast(readErrorMessage(err, '打开题目失败'));
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
			<div class="pc-card pc-info-card">
				<div class="pc-service-header">账号安全</div>
				<form class="pc-profile-edit-row" data-password-change-form>
					<label class="pc-profile-edit-label" for="pc-current-password">修改密码</label>
					<div class="pc-profile-edit-inline">
						<input class="pc-profile-input" id="pc-current-password" type="password" autocomplete="current-password" placeholder="当前密码" />
						<input class="pc-profile-input" id="pc-new-password" type="password" autocomplete="new-password" placeholder="新密码：至少8位，含字母和数字" />
						<button class="pc-inline-btn" type="submit">更新密码</button>
					</div>
					<div class="pc-avatar-picker-note">更新后可以继续使用当前登录状态；忘记密码时请在登录弹窗里使用“找回密码”。</div>
				</form>
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
						return `<div class="pc-card pc-info-card"><div class="pc-service-header">${escapeHtml(organization.name)}</div><div class="pc-org-card"><div class="pc-org-head"><div><div class="pc-org-name">${escapeHtml(organization.name)}</div><div class="pc-org-type">${escapeHtml(organizationTypeLabel(organization.organizationType))}组织</div></div><div class="pc-org-seat">${escapeHtml(seatsText)}</div></div><div class="pc-org-meta"><div class="pc-org-metric"><span>套餐</span><strong>${escapeHtml(planLabel(organization.plan))}</strong></div><div class="pc-org-metric"><span>状态</span><strong>${escapeHtml(organization.status)}</strong></div><div class="pc-org-metric"><span>成员数</span><strong>${escapeHtml(String(organization.memberCount))}</strong></div></div><div class="pc-admin-note">这里可以维护成员、席位、校区、学习组和课程包。班级制和约课制都会统一进入学习组模型。</div>${renderOrganizationSubscriptionPanel(organization)}${renderOrganizationCampusPanel(organization)}${renderOrganizationCoursePackagePanel(organization)}${renderOrganizationSchedulePanel(organization)}${renderOrganizationLearningGroupPanel(organization)}${renderOrganizationInvitationPanel(organization)}${renderOrganizationAddForm(organization)}<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>成员管理</h4><span>${escapeHtml(organizationSeatSummary(organization))}</span></div><div class="pc-org-member-list">${members || '<div class="pc-org-empty">当前组织暂无成员数据，可先通过上方表单添加。</div>'}</div></div>${renderOrganizationAuditPanel(organization)}</div></div>`;
					})
					.join('');
			}
		}

		const roleNote = canManage
			? '机构管理员现在会直接看到成员、权限模板、席位和套餐摘要。'
			: '老师、教学运营、内容管理员会看到各自工作台；机构管理员进入组织后，会出现成员管理视图。';

		return `<div class="pc-profile-stack"><div class="pc-card pc-info-card"><div class="pc-service-header">管理面板</div><div class="pc-info-list"><div class="pc-info-row"><span>当前空间</span><strong>${escapeHtml(scopeLabel(ctx))}</strong></div>${organizationRow}<div class="pc-info-row"><span>当前角色</span><strong>${roleText}</strong></div></div><div class="pc-admin-note">${escapeHtml(roleNote)}</div></div>${renderInstitutionWorkbenchShell(ctx)}${organizationPanel}${hasAnyRole(ctx, ['superAdmin']) ? renderSystemFlags() : ''}</div>`;
	}

	function renderInstitutionWorkbenchShell(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['teacher', 'assistant', 'orgAdmin', 'contentAdmin', 'superAdmin'])) {
			return '';
		}
		return `<div class="pc-card pc-info-card" id="pc-institution-workbench">
			<div class="pc-service-header">机构教学工作台</div>
			<div class="pc-admin-note">正在加载学习组、作业、席位、成绩册与学员档案...</div>
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

	async function changeCurrentPassword(currentPassword: string, newPassword: string, form: HTMLFormElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !api || typeof api.changePassword !== 'function') {
			showToast('修改密码接口暂不可用');
			return;
		}
		if (!currentPassword || !newPassword) {
			showToast('请输入当前密码和新密码');
			return;
		}
		if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
			showToast('新密码至少 8 位，并且需要同时包含字母和数字');
			return;
		}
		try {
			await api.changePassword(token, currentPassword, newPassword);
			form.reset();
			showToast('密码已更新');
		} catch (error) {
			log('change password failed', error);
			showToast(readErrorMessage(error, '密码更新失败'));
		}
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
			if (form.hasAttribute('data-password-change-form')) {
				const currentPassword = (form.querySelector('#pc-current-password') as HTMLInputElement | null)?.value || '';
				const newPassword = (form.querySelector('#pc-new-password') as HTMLInputElement | null)?.value || '';
				void changeCurrentPassword(currentPassword, newPassword, form);
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
				activeSection = 'admin-hub';
				renderSections();
				renderSectionContent();
				break;
			case 'openRedeem':
				void openRedeemPanel();
				break;
			case 'openCoupons':
				void openCouponsPanel();
				break;
			case 'openPaymentLedger':
				void openPaymentLedgerPanel();
				break;
			case 'openRecharge':
				void openRechargePanel();
				break;
			case 'openWrongQuestions':
				// 业务功能 1：打开错题本面板
				void openWrongQuestionsPanel();
				break;
			case 'openSrsReview':
				// 业务功能 7：打开 SRS 间隔重复复习面板
				void openSrsReviewPanel();
				break;
			case 'openReviewWorkbench':
				void openReviewWorkbenchPanel();
				break;
			case 'openRecommendedReview':
				void openRecommendedReviewPanel();
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

	function institutionNumber(value: unknown, fallback = 0): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	function renderInstitutionDashboard(data: Record<string, unknown>): string {
		const summary = asRecord(data.summary) || {};
		const seat = asRecord(data.seat_summary) || {};
		const planCatalog = asRecord(data.plan_catalog) || {};
		const activePlan = asRecord(data.active_institution_plan) || {};
		const capabilities = asRecord(data.capabilities) || {};
		const lockedFeatures = Array.isArray(data.locked_features) ? data.locked_features.filter((item): item is string => typeof item === 'string') : [];
		const assignments = Array.isArray(data.assignments) ? data.assignments : [];
		const risks = Array.isArray(data.renewal_risks) ? data.renewal_risks : [];
		const teachers = Array.isArray(data.teacher_effectiveness) ? data.teacher_effectiveness : [];
		const classTrend = Array.isArray(data.class_average_trend) ? data.class_average_trend : [];
		const ranking = Array.isArray(data.student_ranking) ? data.student_ranking : [];
		const skillWeaknesses = Array.isArray(data.skill_weaknesses) ? data.skill_weaknesses : [];
		const learningGroups = Array.isArray(data.learning_groups) ? data.learning_groups : [];
		const assignmentRows = assignments.slice(0, 6).map((item) => {
			const raw = asRecord(item) || {};
			const title = readString(raw.title) || '未命名作业';
			const assignmentId = readString(raw.assignment_id);
			const submitted = institutionNumber(raw.submitted_count);
			const total = institutionNumber(raw.student_count);
			const avg = institutionNumber(raw.average_score, -1);
			return `<div class="pc-info-row"><span>${escapeHtml(title)}</span><strong>${submitted}/${total}${avg >= 0 ? ` · ${avg.toFixed(1)}%` : ''} ${assignmentId ? `<button class="pc-inline-btn" type="button" data-inst-assignment-submissions="${escapeHtml(assignmentId)}">提交</button><button class="pc-inline-btn" type="button" data-inst-assignment-remind="${escapeHtml(assignmentId)}">催交</button>` : ''}</strong></div>`;
		}).join('');
		const riskRows = risks.slice(0, 5).map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			return `<div class="pc-info-row"><span>${escapeHtml(readString(student.display_name) || readString(student.username) || readString(student.id) || '学员')}</span><strong>${escapeHtml(readString(raw.level) || 'low')} · ${escapeHtml(readString(raw.reason) || '')}</strong></div>`;
		}).join('');
		const teacherRows = teachers.slice(0, 5).map((item) => {
			const raw = asRecord(item) || {};
			const teacher = asRecord(raw.teacher) || {};
			return `<div class="pc-info-row"><span>${escapeHtml(readString(teacher.display_name) || readString(teacher.username) || '老师')}</span><strong>${institutionNumber(raw.learning_group_count)} 组 · ${institutionNumber(raw.assignment_count)} 作业</strong></div>`;
		}).join('');
		const trendRows = classTrend.slice(-6).map((item) => {
			const raw = asRecord(item) || {};
			const avg = institutionNumber(raw.average_score, -1);
			return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.learning_group_name) || '')} · ${escapeHtml(readString(raw.assignment_title) || '')}</span><strong>${avg >= 0 ? `${avg.toFixed(1)}%` : '暂无'} · ${institutionNumber(raw.submitted_count)}/${institutionNumber(raw.student_count)}</strong></div>`;
		}).join('');
		const rankingRows = ranking
			.slice()
			.sort((a, b) => institutionNumber(asRecord(b)?.average_score, -1) - institutionNumber(asRecord(a)?.average_score, -1))
			.slice(0, 5)
			.map((item, index) => {
				const raw = asRecord(item) || {};
				const student = asRecord(raw.student) || {};
				const avg = institutionNumber(raw.average_score, -1);
				return `<div class="pc-info-row"><span>${index + 1}. ${escapeHtml(readString(student.display_name) || readString(student.username) || readString(student.id) || '学员')}</span><strong>${avg >= 0 ? `${avg.toFixed(1)}%` : '暂无'} · ${institutionNumber(raw.attempt_count)} 次</strong></div>`;
			}).join('');
		const weaknessRows = skillWeaknesses.slice(0, 6).map((item) => {
			const raw = asRecord(item) || {};
			return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.skill) || '未分类')}</span><strong>${institutionNumber(raw.error_rate).toFixed(1)}% · 错 ${institutionNumber(raw.wrong_count)}/${institutionNumber(raw.total_questions)}</strong></div>`;
		}).join('');
		const learningGroupOptions = learningGroups.map((item) => {
			const raw = asRecord(item) || {};
			const id = readString(raw.learning_group_id) || readString(raw.group_id) || readString(raw.id);
			const organizationId = readString(raw.organization_id) || readString(raw.org_id);
			const name = readString(raw.name) || id;
			return id ? `<option value="${escapeHtml(id)}" data-org-id="${escapeHtml(organizationId)}">${escapeHtml(name)}</option>` : '';
		}).join('');
		const canImport = capabilities.bulk_import === true;
		const canPrep = capabilities.lesson_prep === true;
		return `<div class="pc-admin-note">机构工作台已经接入学习组、作业、成绩册、席位、学员档案和备课工具。</div>
			<div class="pc-info-list">
				<div class="pc-info-row"><span>当前机构套餐</span><strong>${escapeHtml(readString(activePlan.name) || readString(activePlan.id) || '标准版')}</strong></div>
				<div class="pc-info-row"><span>学习组 / 学员 / 作业</span><strong>${institutionNumber(summary.learning_group_count)} / ${institutionNumber(summary.student_count)} / ${institutionNumber(summary.assignment_count)}</strong></div>
				<div class="pc-info-row"><span>席位</span><strong>${institutionNumber(seat.used_seats)} / ${institutionNumber(seat.purchased_seats)} 已用</strong></div>
				<div class="pc-info-row"><span>可用席位</span><strong>${institutionNumber(seat.available_seats)} · 成员 ${institutionNumber(seat.member_count)}</strong></div>
				<div class="pc-info-row"><span>平均作业得分</span><strong>${institutionNumber(summary.average_assignment_score, -1) >= 0 ? `${institutionNumber(summary.average_assignment_score).toFixed(1)}%` : '暂无'}</strong></div>
			</div>
			${renderInstitutionCapabilityPanel(capabilities, lockedFeatures)}
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">
				<div class="pc-card pc-info-card"><div class="pc-service-header">作业完成</div><div class="pc-info-list">${assignmentRows || '<div class="pc-admin-note">暂无作业</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">续费风险</div><div class="pc-info-list">${capabilities.renewal_risk === true ? (riskRows || '<div class="pc-admin-note">暂无风险学员</div>') : '<div class="pc-admin-note">当前套餐未开通续费风险。</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">老师教学概览</div><div class="pc-info-list">${capabilities.teacher_effectiveness === true ? (teacherRows || '<div class="pc-admin-note">暂无老师数据</div>') : '<div class="pc-admin-note">当前套餐未开通老师教学看板。</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">学习组平均分趋势</div><div class="pc-info-list">${trendRows || '<div class="pc-admin-note">暂无趋势数据</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">学员排名</div><div class="pc-info-list">${rankingRows || '<div class="pc-admin-note">暂无排名数据</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">各题型弱项</div><div class="pc-info-list">${weaknessRows || '<div class="pc-admin-note">暂无弱项数据</div>'}</div></div>
			</div>
			${renderInstitutionPlanCatalog(planCatalog)}
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
				<select data-inst-learning-group style="padding:7px;border:1px solid #ddd;border-radius:4px;">${learningGroupOptions || '<option value="">暂无学习组</option>'}</select>
				<button class="pc-inline-btn" type="button" data-inst-create-learning-group>创建学习组</button>
				<button class="pc-inline-btn" type="button" data-inst-add-members>添加学员</button>
				<button class="pc-inline-btn" type="button" data-inst-create-assignment>布置作业</button>
				<button class="pc-inline-btn" type="button" data-inst-gradebook>打开成绩册</button>
				<button class="pc-inline-btn" type="button" data-inst-import ${canImport ? '' : 'disabled'}>批量导入预览</button>
				<button class="pc-inline-btn" type="button" data-inst-prep ${canPrep ? '' : 'disabled'}>备课组卷</button>
			</div>
			<div class="pc-admin-note">自动批改来自学生提交答案后的统计结果；成绩册会自动聚合提交状态、正确率和平均分。</div>
			<div id="pc-institution-detail" style="margin-top:12px;"></div>`;
	}

	function institutionFeatureLabel(key: string): string {
		const labels: Record<string, string> = {
			learning_groups: '学习组管理',
			assignments: '布置作业',
			auto_grading: '自动批改',
			gradebook: '成绩册',
			student_profiles: '学员档案',
			institution_dashboard: '机构看板',
			teacher_effectiveness: '老师教学看板',
			renewal_risk: '续费风险',
			bulk_import: '批量导入',
			lesson_prep: '备课组卷',
			export_handouts: '导出讲义',
			multi_teacher: '多老师协作',
			audit_logs: '审计日志',
			multi_campus: '多校区',
			custom_success_support: '专属成功支持'
		};
		return labels[key] || key;
	}

	function renderInstitutionCapabilityPanel(capabilities: Record<string, unknown>, lockedFeatures: string[]): string {
		const core = ['learning_groups', 'assignments', 'auto_grading', 'gradebook', 'student_profiles'];
		const advanced = ['institution_dashboard', 'teacher_effectiveness', 'renewal_risk', 'bulk_import', 'lesson_prep', 'export_handouts', 'multi_teacher', 'audit_logs', 'multi_campus', 'custom_success_support'];
		const renderList = (items: string[]) => items
			.map((key) => {
				const on = capabilities[key] === true;
				return `<span class="pc-tag${on ? '' : ' muted'}" title="${on ? '已开通' : '当前套餐未开通'}">${escapeHtml(institutionFeatureLabel(key))}${on ? '' : '（未开通）'}</span>`;
			})
			.join('');
		return `<div class="pc-card pc-info-card" style="margin-top:12px;">
			<div class="pc-service-header">当前套餐功能</div>
			<div class="pc-admin-note">核心教学能力默认覆盖；高级管理能力会按当前机构套餐启用。</div>
			<div style="margin-top:8px;"><strong>核心教学</strong><div class="pc-tag-list" style="margin-top:6px;">${renderList(core)}</div></div>
			<div style="margin-top:10px;"><strong>高级管理</strong><div class="pc-tag-list" style="margin-top:6px;">${renderList(advanced)}</div></div>
			${lockedFeatures.length ? `<div class="pc-admin-note">当前锁定：${lockedFeatures.map(institutionFeatureLabel).map(escapeHtml).join('、')}</div>` : ''}
		</div>`;
	}

	function renderInstitutionPlanCatalog(planCatalog: Record<string, unknown>): string {
		const plans = Array.isArray(planCatalog.plans) ? planCatalog.plans : [];
		if (plans.length === 0) {
			return '';
		}
		const cards = plans.map((item) => {
			const raw = asRecord(item) || {};
			const features = asRecord(raw.features) || {};
			const enabled = Object.keys(features).filter((key) => features[key] === true).slice(0, 7);
			const recommended = readBoolean(raw.recommended);
			return `<div style="border:1px solid ${recommended ? '#1976d2' : '#e3e8ef'};border-radius:8px;padding:12px;background:#fff;">
				<div style="display:flex;justify-content:space-between;gap:8px;">
					<strong>${escapeHtml(readString(raw.name) || '')}${recommended ? ' · 推荐' : ''}</strong>
					<span style="color:#1976d2;font-weight:600;">¥${institutionNumber(raw.monthly_price)}/月</span>
				</div>
				<div style="font-size:12px;color:#777;margin-top:4px;">${escapeHtml(readString(raw.target) || '')}</div>
				<div style="font-size:12px;color:#555;margin-top:8px;">${institutionNumber(raw.included_seats)} 席 · 超出 ¥${institutionNumber(raw.extra_seat_price)}/人/月 · 年付 ¥${institutionNumber(raw.yearly_price)}</div>
				<div style="font-size:12px;color:#555;margin-top:8px;line-height:1.6;">${enabled.map(institutionFeatureLabel).map(escapeHtml).join('、')}</div>
			</div>`;
		}).join('');
		return `<div class="pc-card pc-info-card" style="margin-top:12px;">
			<div class="pc-service-header">机构套餐价格</div>
			<div class="pc-admin-note">价格和权益来自 data/system/institution_plans.json，可随时调整。核心教学能力各档都有，高级管理能力随席位规模开放。</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">${cards}</div>
		</div>`;
	}

	function renderInstitutionWorkbenchExtras(data: Record<string, unknown>): string {
		const schedule = Array.isArray(data.schedule) ? data.schedule : [];
		const packages = Array.isArray(data.course_packages) ? data.course_packages : [];
		const relationships = Array.isArray(data.student_relationships) ? data.student_relationships : [];
		const prepPlans = Array.isArray(data.lesson_prep_plans) ? data.lesson_prep_plans : [];
		const scheduleRows = schedule.slice(0, 8).map((item) => {
			const raw = asRecord(item) || {};
			const start = readString(raw.starts_at);
			const end = readString(raw.ends_at);
			const time = start ? `${formatDateTime(start)}${end ? ` - ${formatDateTime(end)}` : ''}` : '未排时间';
			return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.name) || '未命名日程')}</span><strong>${escapeHtml(time)} · ${escapeHtml(readString(raw.subject) || '-')}</strong></div>`;
		}).join('');
		const packageRows = packages.slice(0, 8).map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const name = readString(student.display_name) || readString(student.username) || readString(raw.student_id) || '学员';
			const remaining = institutionNumber(raw.remaining_lessons);
			const total = institutionNumber(raw.total_lessons);
			return `<div class="pc-info-row"><span>${escapeHtml(name)} · ${escapeHtml(readString(raw.title) || readString(raw.subject) || '课程包')}</span><strong>${remaining}/${total} 次 · ${escapeHtml(readString(raw.attention_reason) || '状态正常')}</strong></div>`;
		}).join('');
		const relationshipRows = relationships.slice(0, 8).map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const name = readString(student.display_name) || readString(student.username) || '学员';
			return `<div class="pc-info-row"><span>${escapeHtml(name)}</span><strong>${institutionNumber(raw.relationship_count)} 个学习关系 · ${institutionNumber(raw.course_package_count)} 个课程包</strong></div>`;
		}).join('');
		const prepRows = prepPlans.slice(0, 6).map((item) => {
			const raw = asRecord(item) || {};
			const questionCount = Array.isArray(raw.question_set) ? raw.question_set.length : 0;
			return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.title) || '备课方案')}</span><strong>${escapeHtml(readString(raw.exam_id) || '-')} · ${questionCount} 题</strong></div>`;
		}).join('');
		return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;" data-inst-workbench-extras>
			<div class="pc-card pc-info-card"><div class="pc-service-header">老师/学员日程</div><div class="pc-info-list">${scheduleRows || '<div class="pc-admin-note">暂无日程</div>'}</div></div>
			<div class="pc-card pc-info-card"><div class="pc-service-header">课程包预警</div><div class="pc-info-list">${packageRows || '<div class="pc-admin-note">暂无课程包数据</div>'}</div></div>
			<div class="pc-card pc-info-card"><div class="pc-service-header">学生学习关系</div><div class="pc-info-list">${relationshipRows || '<div class="pc-admin-note">暂无学生关系</div>'}</div></div>
			<div class="pc-card pc-info-card"><div class="pc-service-header">已保存备课方案</div><div class="pc-info-list">${prepRows || '<div class="pc-admin-note">暂无备课方案</div>'}</div></div>
		</div>`;
	}

	async function refreshInstitutionWorkbench(ctx: PCContext): Promise<void> {
		const root = document.getElementById('pc-institution-workbench');
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!root || !token || !api || typeof api.getInstitutionDashboard !== 'function') {
			return;
		}
		try {
			const data = asRecord(await api.getInstitutionDashboard(token, ctx.organizationId)) || {};
			let workbenchData: Record<string, unknown> = {};
			if (typeof api.getInstitutionWorkbench === 'function') {
				workbenchData = asRecord(await api.getInstitutionWorkbench(token, ctx.organizationId)) || {};
			}
			root.innerHTML = `<div class="pc-service-header">机构教学工作台</div>${renderInstitutionDashboard(data)}${renderInstitutionWorkbenchExtras(workbenchData)}`;
		} catch (error) {
			root.innerHTML = `<div class="pc-service-header">机构教学工作台</div><div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '机构工作台加载失败'))}</div>`;
		}
	}

	function readSelectedInstitutionLearningGroup(container: HTMLElement): { organizationId: string; learningGroupId: string } {
		const select = container.querySelector('[data-inst-learning-group]') as HTMLSelectElement | null;
		const option = select?.selectedOptions?.[0] as HTMLOptionElement | undefined;
		return {
			organizationId: option?.dataset.orgId || getContext().organizationId || '',
			learningGroupId: select?.value || ''
		};
	}

	async function openInstitutionGradebook(container: HTMLElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const selected = readSelectedInstitutionLearningGroup(container);
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !selected.organizationId || !selected.learningGroupId || !detail || !api || typeof api.getInstitutionLearningGroupGradebook !== 'function') {
			showToast('请选择学习组');
			return;
		}
		detail.innerHTML = '<div class="pc-admin-note">正在加载成绩册...</div>';
		try {
			const data = asRecord(await api.getInstitutionLearningGroupGradebook(token, selected.organizationId, selected.learningGroupId)) || {};
			const students = Array.isArray(data.students) ? data.students : [];
			const assignments = Array.isArray(data.assignments) ? data.assignments : [];
			const assignmentRows = assignments.map((item) => {
				const raw = asRecord(item) || {};
				const assignmentId = readString(raw.assignment_id);
				const title = readString(raw.title) || '未命名作业';
				const submitted = institutionNumber(raw.submitted_count);
				const total = institutionNumber(raw.student_count);
				const avg = institutionNumber(raw.average_score, -1);
				return `<div class="pc-info-row"><span>${escapeHtml(title)}</span><strong>${submitted}/${total}${avg >= 0 ? ` · ${avg.toFixed(1)}%` : ''} ${assignmentId ? `<button class="pc-inline-btn" type="button" data-inst-assignment-submissions="${escapeHtml(assignmentId)}">提交</button><button class="pc-inline-btn" type="button" data-inst-assignment-remind="${escapeHtml(assignmentId)}">催交</button>` : ''}</strong></div>`;
			}).join('');
			detail.innerHTML = `<div class="pc-card pc-info-card"><div class="pc-service-header">学习组成绩册</div><div class="pc-info-list">${students.map((item) => {
				const raw = asRecord(item) || {};
				const student = asRecord(raw.student) || {};
				const record = asRecord(raw.answers) || {};
				const name = readString(student.display_name) || readString(student.username) || readString(student.id) || '学员';
				const score = institutionNumber(record.average_score, -1);
				const studentId = readString(student.id);
				return `<div class="pc-info-row"><span>${escapeHtml(name)}</span><strong>${score >= 0 ? `${score.toFixed(1)}%` : '暂无'} · ${institutionNumber(record.attempt_count)} 次 <button class="pc-inline-btn" type="button" data-inst-student="${escapeHtml(studentId)}">档案</button></strong></div>`;
			}).join('') || '<div class="pc-admin-note">暂无学员</div>'}</div></div><div class="pc-card pc-info-card"><div class="pc-service-header">学习组作业</div><div class="pc-info-list">${assignmentRows || '<div class="pc-admin-note">暂无作业</div>'}</div></div>`;
		} catch (error) {
			detail.innerHTML = `<div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '成绩册加载失败'))}</div>`;
		}
	}

	async function createInstitutionLearningGroup(container: HTMLElement): Promise<void> {
		const ctx = getContext();
		const api = window.APIClient;
		const token = activeToken(ctx);
		if (!api || typeof api.saveOrganizationLearningGroup !== 'function' || !token || !ctx.organizationId) {
			showToast('学习组接口暂不可用');
			return;
		}
		const name = (window.prompt('学习组名称', 'EJU 日语冲刺班') || '').trim();
		if (!name) return;
		const subject = (window.prompt('科目（可选，例如 japanese / sogo）', 'japanese') || '').trim();
		try {
			const created = asRecord(await api.saveOrganizationLearningGroup(ctx.organizationId, token, {
				name,
				subject,
				type: 'class',
				status: 'active'
			})) || {};
			const createdId = readString(created.learning_group_id) || readString(created.group_id) || readString(created.id);
			showToast('学习组已创建');
			await refreshInstitutionWorkbench(getContext());
			const root = document.getElementById('pc-institution-workbench') || container;
			const select = root.querySelector('[data-inst-learning-group]') as HTMLSelectElement | null;
			if (select && createdId) {
				const existing = Array.from(select.options).some((option) => option.value === createdId);
				if (!existing) {
					const option = document.createElement('option');
					option.value = createdId;
					option.dataset.orgId = ctx.organizationId || '';
					option.textContent = readString(created.name) || name;
					select.appendChild(option);
				}
				select.value = createdId;
			}
		} catch (error) {
			showToast(readErrorMessage(error, '学习组创建失败'));
		}
	}

	async function addInstitutionMembers(container: HTMLElement): Promise<void> {
		const ctx = getContext();
		const api = window.APIClient;
		const token = activeToken(ctx);
		const selected = readSelectedInstitutionLearningGroup(container);
		if (!selected.organizationId || !selected.learningGroupId) {
			showToast('请选择学习组');
			return;
		}
		if (!api || typeof api.saveLearningGroupEnrollment !== 'function' || !token) {
			showToast('学习组成员接口暂不可用');
			return;
		}
		const raw = window.prompt('输入学员 userId，多个用逗号或换行分隔', '') || '';
		const userIds = raw.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
		if (userIds.length === 0) return;
		try {
			for (const userId of userIds) {
				await api.saveLearningGroupEnrollment(selected.organizationId, selected.learningGroupId, token, {
					user_id: userId,
					role: 'student',
					status: 'active'
				});
			}
			showToast(`已添加 ${userIds.length} 名学员`);
			await refreshInstitutionWorkbench(getContext());
		} catch (error) {
			showToast(readErrorMessage(error, '添加学员失败'));
		}
	}

	async function createInstitutionAssignment(container: HTMLElement): Promise<void> {
		const api = window.APIClient;
		const selected = readSelectedInstitutionLearningGroup(container);
		if (!selected.organizationId || !selected.learningGroupId) {
			showToast('请选择学习组');
			return;
		}
		if (!api || typeof api.createLearningGroupAssignment !== 'function') {
			showToast('作业接口暂不可用');
			return;
		}
		const examId = (window.prompt('试卷 ID，例如 eju_2023_02', '') || '').trim();
		if (!examId) return;
		const title = (window.prompt('作业标题', `${examId} 练习`) || '').trim() || `${examId} 练习`;
		const dueAt = (window.prompt('截止时间（可选，例如 2026-07-01）', '') || '').trim();
		const rangeRaw = (window.prompt('题号范围（可选，例如 1-10；留空表示整卷）', '') || '').trim();
		const rangeMatch = rangeRaw.match(/^(\d+)\s*[-~～]\s*(\d+)$/);
		const singleMatch = rangeRaw.match(/^(\d+)$/);
		const payload: Record<string, unknown> = {
			exam_id: examId,
			title,
			description: '系统布置作业',
			due_at: dueAt
		};
		if (rangeMatch) {
			payload.question_start = Number(rangeMatch[1]);
			payload.question_end = Number(rangeMatch[2]);
		} else if (singleMatch) {
			payload.question_start = Number(singleMatch[1]);
			payload.question_end = Number(singleMatch[1]);
		}
		try {
			await api.createLearningGroupAssignment(selected.organizationId, selected.learningGroupId, payload);
			showToast('作业已布置');
			await refreshInstitutionWorkbench(getContext());
		} catch (error) {
			showToast(readErrorMessage(error, '作业布置失败'));
		}
	}

	async function openInstitutionAssignmentSubmissions(container: HTMLElement, assignmentId: string): Promise<void> {
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!assignmentId || !detail || !api || typeof api.getAssignmentSubmissions !== 'function') return;
		detail.innerHTML = '<div class="pc-admin-note">正在加载作业提交情况...</div>';
		try {
			const data = asRecord(await api.getAssignmentSubmissions(assignmentId)) || {};
			const assignment = asRecord(data.assignment) || {};
			const submissions = asRecord(data.submissions) || {};
			const learningGroup = asRecord(data.learning_group) || {};
			const enrollments = Array.isArray(learningGroup.enrollments) ? learningGroup.enrollments : [];
			const studentIds = enrollments
				.map((item) => asRecord(item) || {})
				.filter((item) => readString(item.role) === 'student' && (readString(item.status) || 'active') === 'active')
				.map((item) => readString(item.user_id))
				.filter((item): item is string => Boolean(item));
			const visibleStudentIds = studentIds.length ? studentIds : Object.keys(submissions);
			const rows = visibleStudentIds.map((studentId) => {
				const sub = asRecord(submissions[studentId]) || {};
				const score = asRecord(sub.score) || {};
				const submitted = !!readString(sub.submitted_at);
				return `<div class="pc-info-row">
					<span>${escapeHtml(studentId)}</span>
					<strong>${submitted ? `已交 · ${institutionNumber(score.score, 0).toFixed(1)}% · ${escapeHtml(formatDateTime(readString(sub.submitted_at)))}` : '未交'}</strong>
				</div>`;
			}).join('');
			detail.innerHTML = `<div class="pc-card pc-info-card"><div class="pc-service-header">作业提交：${escapeHtml(readString(assignment.title) || assignmentId)}</div><div class="pc-info-list">${rows || '<div class="pc-admin-note">暂无学员</div>'}</div></div>`;
		} catch (error) {
			detail.innerHTML = `<div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '提交情况加载失败'))}</div>`;
		}
	}

	async function remindInstitutionAssignment(assignmentId: string): Promise<void> {
		const api = window.APIClient;
		if (!assignmentId || !api || typeof api.remindAssignment !== 'function') return;
		const message = (window.prompt('催交内容', '请按时完成作业，有问题可以联系老师。') || '').trim();
		if (!message) return;
		try {
			const data = asRecord(await api.remindAssignment(assignmentId, { message })) || {};
			const targets = Array.isArray(data.target_student_ids) ? data.target_student_ids.length : 0;
			showToast(`已记录催交，目标 ${targets} 人`);
		} catch (error) {
			showToast(readErrorMessage(error, '催交失败'));
		}
	}

	async function openInstitutionStudentProfile(container: HTMLElement, studentId: string): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !studentId || !detail || !api || typeof api.getInstitutionStudentProfile !== 'function') return;
		detail.innerHTML = '<div class="pc-admin-note">正在加载学员档案...</div>';
		try {
			const data = asRecord(await api.getInstitutionStudentProfile(token, studentId)) || {};
			const student = asRecord(data.student) || {};
			const record = asRecord(data.learning_record) || {};
			const weaknesses = Array.isArray(data.weaknesses) ? data.weaknesses : [];
			const wrongTrend = Array.isArray(data.wrong_trend) ? data.wrong_trend : [];
			const writingHistory = Array.isArray(data.writing_history) ? data.writing_history : [];
			const listeningWeak = asRecord(data.listening_weaknesses) || {};
			const teacherNotes = Array.isArray(data.teacher_notes) ? data.teacher_notes : [];
			const recommended = Array.isArray(data.recommended_homework) ? data.recommended_homework : [];
			const weakText = weaknesses.map((w) => escapeHtml(readString(asRecord(w)?.label) || '')).filter(Boolean).join('、') || '暂无';
			const wrongRows = wrongTrend.slice(-6).map((item) => {
				const raw = asRecord(item) || {};
				return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.exam_title) || readString(raw.exam_id) || '')}</span><strong>错 ${institutionNumber(raw.wrong_count)}/${institutionNumber(raw.total_questions)} · ${institutionNumber(raw.score, -1) >= 0 ? `${institutionNumber(raw.score).toFixed(1)}%` : '暂无'}</strong></div>`;
			}).join('');
			const writingRows = writingHistory.slice(-5).map((item) => {
				const raw = asRecord(item) || {};
				return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.exam_title) || readString(raw.exam_id) || '')}</span><strong>${escapeHtml(formatDateTime(readString(raw.saved_at)))} · ${institutionNumber(raw.score, -1) >= 0 ? `${institutionNumber(raw.score).toFixed(1)}%` : '未评分'}</strong></div>`;
			}).join('');
			const listenItems = Array.isArray(listeningWeak.items) ? listeningWeak.items : [];
			const listenRows = listenItems.slice(-5).map((item) => {
				const raw = asRecord(item) || {};
				return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.exam_title) || readString(raw.exam_id) || '')}</span><strong>${institutionNumber(raw.error_rate).toFixed(1)}% · 错 ${institutionNumber(raw.wrong_count)}/${institutionNumber(raw.total_questions)}</strong></div>`;
			}).join('');
			const noteRows = teacherNotes.slice(-5).map((item) => {
				const raw = asRecord(item) || {};
				return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.text) || '')}</span><strong>${escapeHtml(formatDateTime(readString(raw.created_at)))}</strong></div>`;
			}).join('');
			const recommendedRows = recommended.slice(0, 5).map((item) => {
				const raw = asRecord(item) || {};
				return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.title) || '建议作业')}</span><strong>${escapeHtml(readString(raw.reason) || '')}</strong></div>`;
			}).join('');
			detail.innerHTML = `<div class="pc-card pc-info-card">
				<div class="pc-service-header">学员档案：${escapeHtml(readString(student.display_name) || readString(student.username) || studentId)}</div>
				<div class="pc-info-list">
					<div class="pc-info-row"><span>练习次数</span><strong>${institutionNumber(record.attempt_count)}</strong></div>
					<div class="pc-info-row"><span>平均分</span><strong>${institutionNumber(record.average_score, -1) >= 0 ? `${institutionNumber(record.average_score).toFixed(1)}%` : '暂无'}</strong></div>
					<div class="pc-info-row"><span>最近学习</span><strong>${escapeHtml(formatDateTime(readString(record.latest_activity_at)))}</strong></div>
					<div class="pc-info-row"><span>听力弱项</span><strong>${institutionNumber(listeningWeak.error_rate).toFixed(1)}% · 错 ${institutionNumber(listeningWeak.wrong_count)}/${institutionNumber(listeningWeak.total_questions)}</strong></div>
				</div>
				<div class="pc-admin-note">薄弱项：${weakText}</div>
				<div style="margin-top:8px;"><button class="pc-inline-btn" type="button" data-inst-add-note="${escapeHtml(studentId)}">添加老师备注</button></div>
			</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px;">
				<div class="pc-card pc-info-card"><div class="pc-service-header">错题变化</div><div class="pc-info-list">${wrongRows || '<div class="pc-admin-note">暂无错题变化</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">作文历史</div><div class="pc-info-list">${writingRows || '<div class="pc-admin-note">暂无作文记录</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">听力弱项</div><div class="pc-info-list">${listenRows || '<div class="pc-admin-note">暂无听力弱项</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">老师备注</div><div class="pc-info-list">${noteRows || '<div class="pc-admin-note">暂无备注</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">建议作业</div><div class="pc-info-list">${recommendedRows || '<div class="pc-admin-note">暂无建议</div>'}</div></div>
			</div>`;
		} catch (error) {
			detail.innerHTML = `<div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '学员档案加载失败'))}</div>`;
		}
	}

	async function addInstitutionTeacherNote(container: HTMLElement, studentId: string): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !studentId || !api || typeof api.getInstitutionStudentProfile !== 'function' || typeof api.updateProfile !== 'function') return;
		const text = (window.prompt('老师备注', '') || '').trim();
		if (!text) return;
		try {
			const data = asRecord(await api.getInstitutionStudentProfile(token, studentId)) || {};
			const currentNotes = Array.isArray(data.teacher_notes) ? data.teacher_notes : [];
			const notes = currentNotes.concat([{
				text,
				created_at: new Date().toISOString(),
				created_by: getContext().id || ''
			}]);
			await api.updateProfile(studentId, { teacher_notes: notes });
			showToast('老师备注已保存');
			await openInstitutionStudentProfile(container, studentId);
		} catch (error) {
			showToast(readErrorMessage(error, '老师备注保存失败'));
		}
	}

	async function openInstitutionImportPreview(container: HTMLElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !detail || !api || typeof api.previewInstitutionImport !== 'function') return;
		const text = window.prompt('每行一个学员：姓名,邮箱,手机,角色', '张三,student@example.com,13800000000,student') || '';
		if (!text.trim()) return;
		const data = asRecord(await api.previewInstitutionImport(token, { org_id: getContext().organizationId || '', text })) || {};
		const rows = Array.isArray(data.rows) ? data.rows : [];
		detail.innerHTML = `<div class="pc-card pc-info-card"><div class="pc-service-header">批量导入预览</div><div class="pc-info-list">${rows.map((item) => {
			const raw = asRecord(item) || {};
			return `<div class="pc-info-row"><span>${escapeHtml(readString(raw.name) || readString(raw.raw) || '')}</span><strong>${readString(raw.message)}</strong></div>`;
		}).join('')}</div></div>`;
	}

	async function openInstitutionLessonPrep(container: HTMLElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !detail || !api || typeof api.createLessonPrep !== 'function') return;
		const examId = window.prompt('输入试卷 ID 用于组卷/讲义', '2023_02') || '';
		if (!examId.trim()) return;
		const focus = (window.prompt('考点/题型关键词（可空，例如 読解、聴解、writing）', '') || '').trim();
		const selected = readSelectedInstitutionLearningGroup(container);
		const orgId = selected.organizationId || getContext().organizationId || '';
		const requestPayload = {
			org_id: orgId,
			exam_id: examId.trim(),
			limit: 20,
			hide_answers: true,
			mode: 'handout',
			focus_keyword: focus,
			projection_mode: false,
			print_layout: 'A4'
		};
		let data = asRecord(await api.createLessonPrep(token, requestPayload)) || {};
		if (orgId && typeof api.saveLessonPrepPlan === 'function') {
			const saved = asRecord(await api.saveLessonPrepPlan(token, {
				...requestPayload,
				title: `${examId.trim()} ${focus || '课堂备课方案'}`,
				learning_group_id: selected.learningGroupId || ''
			})) || {};
			data = { ...data, ...saved };
		}
		const qs = Array.isArray(data.question_set) ? data.question_set : [];
		const handoutHtml = readString(data.handout_html) || buildLessonPrepHtml(data, false);
		const projectionHtml = buildLessonPrepHtml({ ...data, projection_mode: true, mode: 'projection' }, true);
		const questionIds = qs
			.map((item) => readString(asRecord(item)?.question_id))
			.filter(Boolean);
		const rows = qs.map((item, index) => {
			const raw = asRecord(item) || {};
			return `<div class="pc-info-row">
				<span>${index + 1}. ${escapeHtml(readString(raw.section) || '题目')} · ${escapeHtml(readString(raw.question_number) || readString(raw.question_id) || '')}</span>
				<strong>${escapeHtml(readString(raw.type) || readString(raw.exam_id) || '')}</strong>
			</div>`;
		}).join('');
		detail.innerHTML = `<div class="pc-card pc-info-card">
			<div class="pc-service-header">备课工具</div>
			<div class="pc-admin-note">已按 ${escapeHtml(examId.trim())}${focus ? ` / ${escapeHtml(focus)}` : ''} 生成 ${qs.length} 道题。${readString(data.lesson_prep_id) ? `方案已保存：${escapeHtml(readString(data.lesson_prep_id))}。` : ''}当前讲义隐藏答案，适合课前分发、课堂打印和投屏。</div>
			<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;">
				<button class="pc-inline-btn" type="button" data-prep-download>导出讲义</button>
				<button class="pc-inline-btn" type="button" data-prep-print>打印题目</button>
				<button class="pc-inline-btn" type="button" data-prep-project>课堂投屏模式</button>
				<button class="pc-inline-btn" type="button" data-prep-assignment>布置为作业</button>
			</div>
			<div class="pc-info-list">${rows || '<div class="pc-admin-note">没有匹配题目，请换一个试卷或考点关键词。</div>'}</div>
			<textarea data-prep-handout hidden>${escapeHtml(handoutHtml)}</textarea>
			<textarea data-prep-projection hidden>${escapeHtml(projectionHtml)}</textarea>
			<textarea data-prep-question-ids hidden>${escapeHtml(JSON.stringify(questionIds))}</textarea>
			<input type="hidden" data-prep-exam-id value="${escapeHtml(examId.trim())}" />
		</div>`;
	}

	async function createAssignmentFromLessonPrep(container: HTMLElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const selected = readSelectedInstitutionLearningGroup(container);
		if (!token || !selected.organizationId || !selected.learningGroupId || !api || typeof api.createLearningGroupAssignment !== 'function') {
			showToast('请先选择学习组');
			return;
		}
		const examId = (container.querySelector('[data-prep-exam-id]') as HTMLInputElement | null)?.value || '';
		let questionIds: string[] = [];
		try {
			const raw = (container.querySelector('[data-prep-question-ids]') as HTMLTextAreaElement | null)?.value || '[]';
			const parsed = JSON.parse(raw);
			questionIds = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
		} catch {
			questionIds = [];
		}
		const title = window.prompt('作业标题', `${examId || '备课方案'} 课堂作业`) || '';
		if (!title.trim()) return;
		const dueAt = window.prompt('截止日期（YYYY-MM-DD，可空）', '') || '';
		try {
			await api.createLearningGroupAssignment(selected.organizationId, selected.learningGroupId, {
				token,
				exam_id: examId,
				title: title.trim(),
				description: '由备课方案生成',
				due_at: dueAt.trim(),
				question_ids: questionIds
			});
			showToast('已从备课方案布置作业');
			await openInstitutionGradebook(container);
		} catch (error) {
			showToast(readErrorMessage(error, '布置作业失败'));
		}
	}

	function buildLessonPrepHtml(data: Record<string, unknown>, projection: boolean): string {
		const questions = Array.isArray(data.question_set) ? data.question_set : [];
		const title = projection ? '课堂投屏' : '课堂讲义';
		const fontSize = projection ? '28px' : '16px';
		const bodyPadding = projection ? '48px 64px' : '28px';
		const rows = questions.map((item, index) => {
			const raw = asRecord(item) || {};
			return `<li><strong>${index + 1}.</strong> ${escapeHtmlSafe(readString(raw.exam_id) || '')} / ${escapeHtmlSafe(readString(raw.section) || '')} / ${escapeHtmlSafe(readString(raw.question_number) || readString(raw.question_id) || '')}</li>`;
		}).join('');
		return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
			body{font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.75;padding:${bodyPadding};font-size:${fontSize};color:#111;background:#fff;}
			h1{font-size:${projection ? '42px' : '24px'};margin:0 0 16px;}
			.meta{font-size:${projection ? '18px' : '12px'};color:#666;margin-bottom:18px;}
			li{margin:10px 0;page-break-inside:avoid;}
			@media print{button{display:none;}body{padding:18mm;font-size:14px;}}
		</style></head><body><h1>${title}</h1><div class="meta">隐藏答案：是 / 布局：${projection ? '投屏' : 'A4 打印'}</div><ol>${rows}</ol></body></html>`;
	}

	function openLessonPrepWindow(html: string, printNow: boolean): void {
		const win = window.open('', '_blank');
		if (!win) {
			showToast('浏览器阻止了新窗口，请允许弹窗后重试');
			return;
		}
		win.document.open();
		win.document.write(html);
		win.document.close();
		if (printNow) {
			win.focus();
			setTimeout(() => win.print(), 200);
		}
	}

	function downloadLessonPrepHtml(html: string): void {
		const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `lesson-handout-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function attachAdminHubHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('[data-inst-gradebook]')) {
				void openInstitutionGradebook(container);
				return;
			}
			const studentButton = target?.closest('[data-inst-student]') as HTMLButtonElement | null;
			if (studentButton) {
				void openInstitutionStudentProfile(container, studentButton.dataset.instStudent || '');
				return;
			}
			const noteButton = target?.closest('[data-inst-add-note]') as HTMLButtonElement | null;
			if (noteButton) {
				void addInstitutionTeacherNote(container, noteButton.dataset.instAddNote || '');
				return;
			}
			if (target?.closest('[data-inst-import]')) {
				void openInstitutionImportPreview(container);
				return;
			}
			if (target?.closest('[data-inst-prep]')) {
				void openInstitutionLessonPrep(container);
				return;
			}
			const prepCard = (target?.closest('[data-prep-download], [data-prep-print], [data-prep-project], [data-prep-assignment]') as HTMLElement | null);
			if (prepCard) {
				if (prepCard.hasAttribute('data-prep-assignment')) {
					void createAssignmentFromLessonPrep(container);
					return;
				}
				const handout = (container.querySelector('[data-prep-handout]') as HTMLTextAreaElement | null)?.value || '';
				const projection = (container.querySelector('[data-prep-projection]') as HTMLTextAreaElement | null)?.value || handout;
				if (prepCard.hasAttribute('data-prep-download')) {
					downloadLessonPrepHtml(handout);
				} else if (prepCard.hasAttribute('data-prep-print')) {
					openLessonPrepWindow(handout, true);
				} else {
					openLessonPrepWindow(projection, false);
				}
				return;
			}
			if (handleSystemFlagAction(target)) {
				return;
			}
			if (target?.closest('[data-inst-create-learning-group]')) {
				void createInstitutionLearningGroup(container);
				return;
			}
			if (target?.closest('[data-inst-add-members]')) {
				void addInstitutionMembers(container);
				return;
			}
			if (target?.closest('[data-inst-create-assignment]')) {
				void createInstitutionAssignment(container);
				return;
			}
			const submissionsButton = target?.closest('[data-inst-assignment-submissions]') as HTMLButtonElement | null;
			if (submissionsButton) {
				void openInstitutionAssignmentSubmissions(container, submissionsButton.dataset.instAssignmentSubmissions || '');
				return;
			}
			const remindButton = target?.closest('[data-inst-assignment-remind]') as HTMLButtonElement | null;
			if (remindButton) {
				void remindInstitutionAssignment(remindButton.dataset.instAssignmentRemind || '');
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
			const completeLearningGroupButton = target?.closest('[data-org-learning-group-complete]') as HTMLButtonElement | null;
			if (completeLearningGroupButton) {
				const organization = managedOrganizations.find((item) => item.id === (completeLearningGroupButton.dataset.orgId || ''));
				const learningGroup = organization?.learningGroups.find((item) => item.id === (completeLearningGroupButton.dataset.learningGroupId || ''));
				if (!organization || !learningGroup) {
					showToast('学习组信息已失效，请刷新后重试');
					return;
				}
				void completeOrganizationLearningGroup(organization, learningGroup);
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
				const roles = readOrganizationRoles(form);
				void saveOrganizationMembership(
					organization,
					draft.selectedUserId,
					roles,
					memberNoInput?.value || '',
					readOrganizationPermissionTemplates(form, roles),
					[],
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
				const roles = readOrganizationRoles(form);
				void saveOrganizationInvitation(
					organization,
					contactInput?.value || '',
					roles,
					memberNoInput?.value || '',
					readOrganizationPermissionTemplates(form, roles),
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
			if (form.matches('form[data-org-campus-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				void saveOrganizationCampus(organization, form);
				return;
			}
			if (form.matches('form[data-org-course-package-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				void saveOrganizationCoursePackage(organization, form);
				return;
			}
			if (form.matches('form[data-org-learning-group-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				void saveOrganizationLearningGroup(organization, form);
				return;
			}
			if (form.matches('form[data-org-learning-enrollment-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				void saveOrganizationLearningGroupEnrollment(organization, form);
				return;
			}
			if (form.matches('form[data-org-member-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const memberNoInput = form.querySelector('[data-org-member-no]') as HTMLInputElement | null;
				const roles = readOrganizationRoles(form);
				void saveOrganizationMembership(
					organization,
					form.dataset.userId || '',
					roles,
					memberNoInput?.value || '',
					readOrganizationPermissionTemplates(form, roles),
					readOrganizationPermissionOverrides(form),
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
			case 'admin-hub':
				container.innerHTML = renderAdminHub(ctx);
				if (canManageMembers(ctx)) {
					void ensureManagedOrganizations(ctx);
				}
				attachAdminHubHandlers(container);
				void refreshInstitutionWorkbench(ctx);
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

	// 今日复习工作台：把 SRS 到期、错题复习、每日一练放到同一个入口
	let reviewWorkbenchModal: HTMLDivElement | null = null;

	function ensureReviewWorkbenchModal(): HTMLDivElement {
		if (reviewWorkbenchModal) return reviewWorkbenchModal;
		const modal = document.createElement('div');
		modal.id = 'review-workbench-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:620px;max-width:900px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">今日复习工作台</h3>
					<button id="rw-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="rw-body" style="min-height:240px;"></div>
			</div>`;
		document.body.appendChild(modal);
		reviewWorkbenchModal = modal;
		(modal.querySelector('#rw-close') as HTMLButtonElement).onclick = () => {
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

	function renderReviewWorkbench(data: {
		srs: Array<Record<string, unknown>>;
		wrong: Array<Record<string, unknown>>;
		daily: Array<Record<string, unknown>>;
		completedDaily: string[];
	}): string {
		const srsHtml = data.srs.length === 0
			? '<div style="padding:10px;color:#999;">今天没有到期 SRS 卡片。</div>'
			: data.srs.slice(0, 5).map((card) => {
				const snap = (card.snapshot || {}) as Record<string, unknown>;
				const qid = String(card.question_id || '');
				const examId = String(card.exam_id || '');
				const stem = String(snap.question || snap.stem || '');
				return `<div style="padding:8px;border-top:1px solid #eee;">
					<div style="font-size:12px;color:#888;">试卷 <code>${escapeHtmlSafe(examId)}</code> · 题 <code>${escapeHtmlSafe(qid)}</code></div>
					<div style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlSafe(stem) || '<span style="color:#999;">（无题干快照）</span>'}</div>
				</div>`;
			}).join('');
		const wrongHtml = data.wrong.length === 0
			? '<div style="padding:10px;color:#999;">错题本里没有待复习题。</div>'
			: data.wrong.slice(0, 5).map((item) => {
				const qid = String(item.question_id || '');
				const examId = String(item.exam_id || '');
				const snap = (item.question_snapshot || {}) as Record<string, unknown>;
				const stem = String(snap.question || snap.stem || '');
				return `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px;border-top:1px solid #eee;">
					<div style="min-width:0;flex:1;">
						<div style="font-size:12px;color:#888;">试卷 <code>${escapeHtmlSafe(examId)}</code> · 题 <code>${escapeHtmlSafe(qid)}</code> · 错 ${escapeHtmlSafe(String(item.wrong_count || 0))} 次</div>
						<div style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlSafe(stem) || '<span style="color:#999;">（无题干快照）</span>'}</div>
					</div>
					<button class="risk-btn" data-rw-action="open-question" data-exam-id="${escapeHtmlSafe(examId)}" data-question-id="${escapeHtmlSafe(qid)}">去复习</button>
				</div>`;
			}).join('');
		const dailyDone = new Set(data.completedDaily);
		const dailyHtml = data.daily.length === 0
			? '<div style="padding:10px;color:#999;">每日一练暂无题目。</div>'
			: data.daily.slice(0, 6).map((item, idx) => {
				const qid = String(item.question_id || '');
				const examId = String(item.exam_id || '');
				const source = String(item.source || '');
				const done = dailyDone.has(qid);
				const label = source === 'wrong_question' ? '错题' : source === 'srs_due' ? 'SRS' : source || '练习';
				return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-top:1px solid #eee;">
					<div>
						<div style="font-size:13px;">${done ? '已完成' : '待完成'} · 第 ${idx + 1} 题</div>
						<div style="font-size:12px;color:#888;">${escapeHtmlSafe(label)} · <code>${escapeHtmlSafe(examId)}</code> · <code>${escapeHtmlSafe(qid)}</code></div>
					</div>
					<button class="risk-btn" data-rw-action="open-question" data-exam-id="${escapeHtmlSafe(examId)}" data-question-id="${escapeHtmlSafe(qid)}">去练习</button>
				</div>`;
			}).join('');
		return `<div style="display:grid;grid-template-columns:1fr;gap:12px;">
			<section style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
				<div style="display:flex;justify-content:space-between;align-items:center;">
					<strong>SRS 到期</strong>
					<button class="risk-btn" data-rw-action="open-srs">开始 SRS</button>
				</div>
				${srsHtml}
			</section>
			<section style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
				<div style="display:flex;justify-content:space-between;align-items:center;">
					<strong>错题复习</strong>
					<button class="risk-btn" data-rw-action="open-wrong">打开错题本</button>
				</div>
				${wrongHtml}
			</section>
			<section style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
				<div style="display:flex;justify-content:space-between;align-items:center;">
					<strong>每日一练</strong>
					<button class="risk-btn" data-rw-action="open-daily">打开完整清单</button>
				</div>
				${dailyHtml}
			</section>
		</div>`;
	}

	async function reloadReviewWorkbench(): Promise<void> {
		const modal = reviewWorkbenchModal!;
		const body = modal.querySelector('#rw-body') as HTMLDivElement;
		const ctx = getContext();
		const userId = ctx.id || '';
		const api = window.APIClient;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		if (!api || !userId) {
			body.innerHTML = '<div style="padding:24px;color:#a33;">请先登录后复习</div>';
			return;
		}
		try {
			const [srsData, wrongData, dailyData] = await Promise.all([
				typeof api.listSrsDue === 'function' ? api.listSrsDue(userId, 8) : Promise.resolve(null),
				typeof api.sampleWrongQuestions === 'function' ? api.sampleWrongQuestions(userId, 8) : Promise.resolve(null),
				typeof api.getDailyPractice === 'function' ? api.getDailyPractice(8) : Promise.resolve(null)
			]) as Array<Record<string, unknown> | null>;
			const srs = Array.isArray(srsData?.items) ? (srsData!.items as Array<Record<string, unknown>>) : [];
			const wrong = Array.isArray(wrongData?.items)
				? (wrongData!.items as Array<Record<string, unknown>>)
				: Array.isArray(wrongData)
					? (wrongData as Array<Record<string, unknown>>)
					: [];
			const daily = Array.isArray(dailyData?.items) ? (dailyData!.items as Array<Record<string, unknown>>) : [];
			const completedDaily = Array.isArray(dailyData?.completed_question_ids)
				? (dailyData!.completed_question_ids as unknown[]).map(String)
				: [];
			body.innerHTML = renderReviewWorkbench({ srs, wrong, daily, completedDaily });
			body.onclick = async (e: MouseEvent) => {
				const btn = (e.target as HTMLElement | null)?.closest('button[data-rw-action]') as HTMLButtonElement | null;
				if (!btn) return;
				const action = btn.dataset.rwAction || '';
				if (action === 'open-srs') {
					await openSrsReviewPanel();
				} else if (action === 'open-wrong') {
					await openWrongQuestionsPanel();
				} else if (action === 'open-daily') {
					await openDailyPracticePanel();
				} else if (action === 'open-question') {
					await openExamQuestion(btn.dataset.examId || '', btn.dataset.questionId || '');
				}
			};
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openReviewWorkbenchPanel(): Promise<void> {
		const ctx = getContext();
		if (!ctx.id) {
			showToast('请先登录后开始复习');
			return;
		}
		const modal = ensureReviewWorkbenchModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadReviewWorkbench();
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
			return '<div style="padding:16px;text-align:center;color:#999;">还没有收藏夹，点右上角新建一个。</div>';
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

	function renderQuestionBookmarks(questions: Array<Record<string, unknown>>, folders: Array<Record<string, unknown>>): string {
		if (questions.length === 0) {
			return '<div style="padding:16px;text-align:center;color:#999;">还没有单题收藏。做题时点击题干旁边的“收藏本题”即可加入。</div>';
		}
		const folderNames = new Map(folders.map((f) => [String(f.folder_id || ''), String(f.name || '未命名')]));
		return questions
			.map((item) => {
				const id = String(item.bookmark_id || '');
				const examId = String(item.exam_id || '');
				const qid = String(item.question_id || '');
				const sectionIndex = Number(item.section_index ?? 0);
				const folderId = String(item.folder_id || '');
				const folderName = folderId ? folderNames.get(folderId) || '未命名分类' : '未分类';
				const reason = String(item.reason || '').trim();
				const snap = (item.question_snapshot || {}) as Record<string, unknown>;
				const stem = String(snap.question || snap.stem || '').trim();
				const title = String(snap.section_title || '').trim();
				const createdAt = String(item.created_at || item.updated_at || '');
				return `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:10px;background:#fff;">
					<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
						<div style="min-width:0;flex:1;">
							<div style="font-size:12px;color:#666;">${escapeHtmlSafe(folderName)} · 试卷 <code>${escapeHtmlSafe(examId)}</code> · 题 <code>${escapeHtmlSafe(qid)}</code>${title ? ` · ${escapeHtmlSafe(title)}` : ''}</div>
							<div style="margin-top:6px;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlSafe(stem) || '<span style="color:#999;">（无题干快照）</span>'}</div>
							${reason ? `<div style="margin-top:6px;font-size:12px;color:#6b4f00;background:#fff8e1;border-radius:4px;padding:6px;">${escapeHtmlSafe(reason)}</div>` : ''}
							${createdAt ? `<div style="margin-top:6px;font-size:11px;color:#aaa;">收藏时间：${escapeHtmlSafe(createdAt)}</div>` : ''}
						</div>
						<div style="display:flex;gap:6px;flex-shrink:0;">
							<button data-bf-action="open-question" data-exam-id="${escapeHtmlSafe(examId)}" data-question-id="${escapeHtmlSafe(qid)}" data-section-index="${escapeHtmlSafe(String(sectionIndex))}" style="font-size:12px;padding:4px 10px;cursor:pointer;">去做这题</button>
							<button data-bf-action="remove-question" data-bookmark-id="${escapeHtmlSafe(id)}" style="font-size:12px;padding:4px 10px;cursor:pointer;color:#a33;">删除</button>
						</div>
					</div>
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
			const [folderData, bookmarkData] = await Promise.all([
				api.listBookmarkFolders(userId) as Promise<{ items?: Array<Record<string, unknown>> } | null>,
				typeof api.getBookmarks === 'function'
					? (api.getBookmarks(userId) as Promise<{ questions?: Array<Record<string, unknown>> } | null>)
					: Promise.resolve(null)
			]);
			const folders = Array.isArray(folderData?.items) ? folderData!.items : [];
			const questions = Array.isArray(bookmarkData?.questions) ? bookmarkData!.questions : [];
			body.innerHTML = `<div style="margin-bottom:16px;">
				<h4 style="margin:0 0 8px;font-size:14px;">单题收藏</h4>
				${renderQuestionBookmarks(questions, folders)}
			</div>
			<div>
				<h4 style="margin:0 0 8px;font-size:14px;">收藏夹分类</h4>
				${renderBookmarkFolders(folders)}
			</div>`;
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

		// 列表区域事件委托：重命名/删除/移除试卷/打开单题收藏
		const body = modal.querySelector('#bf-body') as HTMLDivElement;
		body.onclick = async (e: MouseEvent) => {
			const btn = (e.target as HTMLElement | null)?.closest('button[data-bf-action]') as HTMLButtonElement | null;
			if (!btn) return;
			const action = btn.dataset.bfAction || '';
			const fid = btn.dataset.fid || '';
			const api = window.APIClient;
			if (!api) return;
			try {
				if (action === 'open-question') {
					const examId = btn.dataset.examId || '';
					const questionId = btn.dataset.questionId || '';
					const si = Number(btn.dataset.sectionIndex ?? 0);
					await openExamQuestion(examId, questionId, Number.isFinite(si) ? si : undefined);
					return;
				}
				if (action === 'remove-question' && typeof api.removeQuestionBookmark === 'function') {
					const bookmarkId = btn.dataset.bookmarkId || '';
					if (!bookmarkId || !window.confirm('确定删除这个单题收藏吗？')) return;
					await api.removeQuestionBookmark(userId, bookmarkId);
				} else if (!fid) {
					return;
				} else if (action === 'rename' && typeof api.updateBookmarkFolder === 'function') {
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
				<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:14px;">
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;">
						<div style="font-weight:600;margin-bottom:8px;">用户搜索</div>
						<div style="display:flex;gap:6px;">
							<input id="ad-user-query" type="text" placeholder="用户名 / 邮箱 / 学号" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;" />
							<button id="ad-user-search" style="padding:6px 10px;cursor:pointer;">搜索</button>
						</div>
						<div id="ad-user-results" style="margin-top:8px;font-size:12px;color:#666;"></div>
					</div>
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;">
						<div style="font-weight:600;margin-bottom:8px;">角色权限</div>
						<div style="display:flex;gap:6px;">
							<select id="ad-role-select" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;"></select>
							<button id="ad-role-load" style="padding:6px 10px;cursor:pointer;">查看</button>
						</div>
						<div id="ad-role-results" style="margin-top:8px;font-size:12px;color:#666;"></div>
					</div>
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;">
						<div style="font-weight:600;margin-bottom:8px;">功能开关</div>
						<button id="ad-flags-load" style="padding:6px 10px;cursor:pointer;">加载开关</button>
						<div id="ad-flags-results" style="margin-top:8px;font-size:12px;color:#666;"></div>
					</div>
					<div style="border:1px solid #eee;border-radius:6px;padding:12px;">
						<div style="font-weight:600;margin-bottom:8px;">反馈处理</div>
						<div style="display:flex;gap:6px;">
							<select id="ad-feedback-status" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;">
								<option value="">全部</option>
								<option value="open">待处理</option>
								<option value="reviewing">处理中</option>
								<option value="resolved">已解决</option>
							</select>
							<button id="ad-feedback-load" style="padding:6px 10px;cursor:pointer;">加载</button>
						</div>
						<div id="ad-feedback-results" style="margin-top:8px;font-size:12px;color:#666;"></div>
					</div>
				</div>
				<div style="margin-top:12px;font-size:11px;color:#999;">仅 superAdmin 可见；统计、用户、功能开关和反馈均走真实 API。</div>
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

	async function loadAdminRoles(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const select = modal.querySelector('#ad-role-select') as HTMLSelectElement | null;
		if (!api || typeof api.getAllRoles !== 'function' || !select) return;
		try {
			const data = asRecord(await api.getAllRoles()) || {};
			const roles = asRecord(data.roles) || data;
			const roleKeys = Object.keys(roles).filter(Boolean).sort();
			select.innerHTML = roleKeys.map((key) => {
				const row = asRecord(roles[key]) || {};
				const label = readString(row.name) || key;
				return `<option value="${escapeHtmlSafe(key)}">${escapeHtmlSafe(label)} / ${escapeHtmlSafe(key)}</option>`;
			}).join('');
		} catch {
			select.innerHTML = '<option value="">角色加载失败</option>';
		}
	}

	async function searchAdminUsers(modal: HTMLDivElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const input = modal.querySelector('#ad-user-query') as HTMLInputElement | null;
		const box = modal.querySelector('#ad-user-results') as HTMLDivElement | null;
		const query = (input?.value || '').trim();
		if (!token || !api || typeof api.searchUsers !== 'function' || !box || !query) return;
		box.innerHTML = '搜索中...';
		try {
			const rows = await api.searchUsers(token, query, 12);
			const items = Array.isArray(rows) ? rows : [];
			box.innerHTML = items.map((item) => {
				const raw = asRecord(item) || {};
				const roles = Array.isArray(raw.roles) ? raw.roles.map(String).join(', ') : '';
				return `<div style="padding:6px 0;border-bottom:1px solid #eee;"><strong>${escapeHtmlSafe(readString(raw.username) || readString(raw.id) || '')}</strong><div style="color:#888;">${escapeHtmlSafe(readString(raw.id) || '')} · ${escapeHtmlSafe(roles)}</div></div>`;
			}).join('') || '<div style="color:#999;">没有匹配用户</div>';
		} catch (err) {
			box.innerHTML = `<span style="color:#a33;">${escapeHtmlSafe(readErrorMessage(err, '搜索失败'))}</span>`;
		}
	}

	async function loadAdminRoleUsers(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const select = modal.querySelector('#ad-role-select') as HTMLSelectElement | null;
		const box = modal.querySelector('#ad-role-results') as HTMLDivElement | null;
		const roleId = select?.value || '';
		if (!api || typeof api.getUsersByRole !== 'function' || !box || !roleId) return;
		box.innerHTML = '加载中...';
		try {
			const rows = await api.getUsersByRole(roleId);
			const items = Array.isArray(rows) ? rows : [];
			box.innerHTML = `<div style="margin-bottom:4px;">${escapeHtmlSafe(roleId)}：${items.length} 人</div>` + (items.slice(0, 12).map((item) => {
				const raw = asRecord(item) || {};
				return `<div style="padding:4px 0;border-bottom:1px solid #eee;">${escapeHtmlSafe(readString(raw.username) || readString(raw.id) || '')}</div>`;
			}).join('') || '<div style="color:#999;">暂无用户</div>');
		} catch (err) {
			box.innerHTML = `<span style="color:#a33;">${escapeHtmlSafe(readErrorMessage(err, '角色用户加载失败'))}</span>`;
		}
	}

	async function loadAdminFeatureFlags(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const box = modal.querySelector('#ad-flags-results') as HTMLDivElement | null;
		if (!api || typeof api.getFeatureFlagRegistry !== 'function' || typeof api.getMyFeatureFlags !== 'function' || !box) return;
		box.innerHTML = '加载中...';
		try {
			const registryData = asRecord(await api.getFeatureFlagRegistry()) || {};
			const myData = asRecord(await api.getMyFeatureFlags()) || {};
			const registry = Array.isArray(registryData.registry) ? registryData.registry : [];
			const flags = asRecord(myData.flags) || {};
			box.innerHTML = registry.slice(0, 28).map((item) => {
				const raw = asRecord(item) || {};
				const key = readString(raw.key) || '';
				const resolved = asRecord(flags[key]) || {};
				const enabled = resolved.enabled !== undefined ? !!resolved.enabled : !!raw.default_enabled;
				return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #eee;">
					<span><strong>${escapeHtmlSafe(readString(raw.name) || key)}</strong><br><span style="color:#888;">${escapeHtmlSafe(key)} · ${escapeHtmlSafe(readString(resolved.source) || 'default')}</span></span>
					<button type="button" data-admin-flag="${escapeHtmlSafe(key)}" data-enabled="${enabled ? 'true' : 'false'}" style="height:28px;padding:4px 8px;cursor:pointer;">${enabled ? '关闭' : '开启'}</button>
				</div>`;
			}).join('');
		} catch (err) {
			box.innerHTML = `<span style="color:#a33;">${escapeHtmlSafe(readErrorMessage(err, '功能开关加载失败'))}</span>`;
		}
	}

	async function toggleAdminFeatureFlag(modal: HTMLDivElement, key: string, currentlyEnabled: boolean): Promise<void> {
		const api = window.APIClient;
		if (!key || !api || typeof api.updateSystemFeatureFlags !== 'function') return;
		try {
			await api.updateSystemFeatureFlags({ [key]: { enabled: !currentlyEnabled } });
			showToast(`${key} 已${currentlyEnabled ? '关闭' : '开启'}`);
			await loadAdminFeatureFlags(modal);
		} catch (err) {
			showToast(readErrorMessage(err, '功能开关更新失败'));
		}
	}

	async function loadAdminFeedback(modal: HTMLDivElement): Promise<void> {
		const api = window.APIClient;
		const status = (modal.querySelector('#ad-feedback-status') as HTMLSelectElement | null)?.value || '';
		const box = modal.querySelector('#ad-feedback-results') as HTMLDivElement | null;
		if (!api || typeof api.listFeedback !== 'function' || !box) return;
		box.innerHTML = '加载中...';
		try {
			const data = asRecord(await api.listFeedback('', status)) || {};
			const items = Array.isArray(data.items) ? data.items : [];
			box.innerHTML = items.slice(0, 10).map((item) => {
				const raw = asRecord(item) || {};
				const feedbackId = readString(raw.feedback_id) || '';
				const paperId = readString(raw.paper_id) || '';
				return `<div style="padding:6px 0;border-bottom:1px solid #eee;">
					<strong>${escapeHtmlSafe(readString(raw.category) || '反馈')}</strong> <span style="color:#888;">${escapeHtmlSafe(readString(raw.status) || 'open')}</span>
					<div style="color:#666;margin:3px 0;">${escapeHtmlSafe(readString(raw.description) || readString(raw.question_id) || '')}</div>
					<button type="button" data-admin-feedback="${escapeHtmlSafe(feedbackId)}" data-paper-id="${escapeHtmlSafe(paperId)}" data-status="reviewing" style="margin-right:4px;">处理中</button>
					<button type="button" data-admin-feedback="${escapeHtmlSafe(feedbackId)}" data-paper-id="${escapeHtmlSafe(paperId)}" data-status="resolved">已解决</button>
				</div>`;
			}).join('') || '<div style="color:#999;">暂无反馈</div>';
		} catch (err) {
			box.innerHTML = `<span style="color:#a33;">${escapeHtmlSafe(readErrorMessage(err, '反馈加载失败'))}</span>`;
		}
	}

	async function updateAdminFeedbackStatus(modal: HTMLDivElement, feedbackId: string, paperId: string, status: string): Promise<void> {
		const api = window.APIClient;
		if (!feedbackId || !api || typeof api.updateFeedback !== 'function') return;
		try {
			await api.updateFeedback(feedbackId, paperId, { status, admin_note: `运营后台标记为 ${status}` });
			showToast('反馈状态已更新');
			await loadAdminFeedback(modal);
		} catch (err) {
			showToast(readErrorMessage(err, '反馈更新失败'));
		}
	}

	async function openAdminDashboardPanel(): Promise<void> {
		const modal = ensureAdminDashboardModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		(modal.querySelector('#ad-refresh') as HTMLButtonElement).onclick = () => {
			void reloadAdminOverview(modal);
		};
		if (modal.dataset.adminControlsBound !== 'true') {
			modal.dataset.adminControlsBound = 'true';
			(modal.querySelector('#ad-user-search') as HTMLButtonElement).onclick = () => void searchAdminUsers(modal);
			(modal.querySelector('#ad-role-load') as HTMLButtonElement).onclick = () => void loadAdminRoleUsers(modal);
			(modal.querySelector('#ad-flags-load') as HTMLButtonElement).onclick = () => void loadAdminFeatureFlags(modal);
			(modal.querySelector('#ad-feedback-load') as HTMLButtonElement).onclick = () => void loadAdminFeedback(modal);
			modal.addEventListener('click', (e) => {
				const target = e.target as HTMLElement | null;
				const flagButton = target?.closest('[data-admin-flag]') as HTMLButtonElement | null;
				if (flagButton) {
					void toggleAdminFeatureFlag(modal, flagButton.dataset.adminFlag || '', flagButton.dataset.enabled === 'true');
					return;
				}
				const feedbackButton = target?.closest('[data-admin-feedback]') as HTMLButtonElement | null;
				if (feedbackButton) {
					void updateAdminFeedbackStatus(
						modal,
						feedbackButton.dataset.adminFeedback || '',
						feedbackButton.dataset.paperId || '',
						feedbackButton.dataset.status || 'resolved'
					);
				}
			});
		}
		await loadAdminRoles(modal);
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
					await openExamQuestion(examId, qid);
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

	// 推荐复习：推荐原因 -> 去练习 -> 用户反馈
	let recommendedReviewModal: HTMLDivElement | null = null;

	function ensureRecommendedReviewModal(): HTMLDivElement {
		if (recommendedReviewModal) return recommendedReviewModal;
		const modal = document.createElement('div');
		modal.id = 'recommended-review-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:560px;max-width:820px;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 style="margin:0;font-size:16px;">推荐复习</h3>
					<button id="rr-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="rr-body" style="min-height:220px;"></div>
			</div>`;
		document.body.appendChild(modal);
		recommendedReviewModal = modal;
		(modal.querySelector('#rr-close') as HTMLButtonElement).onclick = () => {
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

	function recommendationFeedbackKey(userId: string): string {
		return `exam_v2_recommendation_feedback_${userId}`;
	}

	function readRecommendationFeedback(userId: string): Record<string, string> {
		try {
			return JSON.parse(localStorage.getItem(recommendationFeedbackKey(userId)) || '{}') as Record<string, string>;
		} catch {
			return {};
		}
	}

	function saveRecommendationFeedback(userId: string, examId: string, value: string): void {
		const feedback = readRecommendationFeedback(userId);
		feedback[examId] = value;
		localStorage.setItem(recommendationFeedbackKey(userId), JSON.stringify(feedback));
	}

	function recommendationReasonLabel(reason: string): string {
		if (reason === 'weak_point_boost') return '根据最近错题和弱项，优先安排这份试卷查漏补缺。';
		if (reason === 'latest_exam') return '当前没有明显弱项记录，先推荐较新的试卷保持手感。';
		return reason || '系统根据学习记录推荐。';
	}

	function renderRecommendedReview(items: Array<Record<string, unknown>>, userId: string): string {
		if (items.length === 0) {
			return '<div style="padding:24px;text-align:center;color:#999;">暂无推荐。完成几次练习后，系统会根据错题和弱项生成推荐。</div>';
		}
		const feedback = readRecommendationFeedback(userId);
		return items
			.map((item) => {
				const examId = String(item.exam_id || '');
				const reason = String(item.reason || '');
				const score = Number(item.score ?? 0);
				const state = feedback[examId] || '';
				const stateText = state === 'started' ? '已开始练习' : state === 'useful' ? '已反馈：有用' : state === 'not_useful' ? '已反馈：不适合' : '';
				return `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:10px;background:#fff;">
					<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
						<div style="min-width:0;flex:1;">
							<div style="font-weight:600;">试卷 <code>${escapeHtmlSafe(examId)}</code></div>
							<div style="margin-top:6px;font-size:13px;color:#555;line-height:1.6;">${escapeHtmlSafe(recommendationReasonLabel(reason))}</div>
							<div style="margin-top:6px;font-size:12px;color:#888;">推荐强度：${escapeHtmlSafe(String(Math.round(score * 100)))}%${stateText ? ` · ${escapeHtmlSafe(stateText)}` : ''}</div>
						</div>
						<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
							<button class="risk-btn" data-rr-action="open" data-exam-id="${escapeHtmlSafe(examId)}">去练习</button>
							<button class="risk-btn" data-rr-action="feedback" data-value="useful" data-exam-id="${escapeHtmlSafe(examId)}">有用</button>
							<button class="risk-btn" data-rr-action="feedback" data-value="not_useful" data-exam-id="${escapeHtmlSafe(examId)}">不适合</button>
						</div>
					</div>
				</div>`;
			})
			.join('');
	}

	async function reloadRecommendedReview(): Promise<void> {
		const modal = recommendedReviewModal!;
		const body = modal.querySelector('#rr-body') as HTMLDivElement;
		const ctx = getContext();
		const userId = ctx.id || '';
		const api = window.APIClient;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载中…</div>';
		if (!api || typeof api.getRecommendations !== 'function' || !userId) {
			body.innerHTML = '<div style="padding:24px;color:#a33;">推荐接口不可用或尚未登录</div>';
			return;
		}
		try {
			const data = (await api.getRecommendations(userId, 8)) as Array<Record<string, unknown>>;
			const items = Array.isArray(data) ? data : [];
			body.innerHTML = renderRecommendedReview(items, userId);
			body.onclick = async (e: MouseEvent) => {
				const btn = (e.target as HTMLElement | null)?.closest('button[data-rr-action]') as HTMLButtonElement | null;
				if (!btn) return;
				const examId = btn.dataset.examId || '';
				const action = btn.dataset.rrAction || '';
				if (!examId) return;
				if (action === 'open') {
					saveRecommendationFeedback(userId, examId, 'started');
					await openExamQuestion(examId, '');
				} else if (action === 'feedback') {
					saveRecommendationFeedback(userId, examId, btn.dataset.value || '');
					body.innerHTML = renderRecommendedReview(items, userId);
					showToast('已记录反馈');
				}
			};
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openRecommendedReviewPanel(): Promise<void> {
		const ctx = getContext();
		if (!ctx.id) {
			showToast('请先登录后查看推荐');
			return;
		}
		const modal = ensureRecommendedReviewModal();
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		await reloadRecommendedReview();
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
	//   - 显示服务端各模块 mtime；可选模块勾选 → 拉取/上传本地缓存（localStorage）
	//   - localStorage key：sync.snapshot.{userId}.{module} = {modified_at, content}
	// ---------------------------------------------------------------------
	let syncDevicesModal: HTMLDivElement | null = null;

	function syncSnapshotKey(userId: string, moduleName: string): string {
		return `sync.snapshot.${userId}.${moduleName}`;
	}

	function getSyncDeviceId(): string {
		const key = 'sync.device.id';
		const existing = localStorage.getItem(key);
		if (existing) return existing;
		const next = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		localStorage.setItem(key, next);
		return next;
	}

	function getSyncDeviceName(): string {
		const platform = navigator.platform || 'Browser';
		return `${platform} · ${navigator.userAgent.includes('Edg') ? 'Edge' : navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Web'}`;
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
						<button id="sd-devices" style="margin-right:8px;padding:6px 12px;cursor:pointer;">设备</button>
						<button id="sd-push" style="margin-right:8px;padding:6px 12px;background:#06c;color:#fff;border:0;border-radius:4px;cursor:pointer;">上传选中</button>
						<button id="sd-pull" style="margin-right:8px;padding:6px 12px;background:#0a7;color:#fff;border:0;border-radius:4px;cursor:pointer;">拉取选中</button>
						<button id="sd-close" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div style="font-size:12px;color:#888;margin-bottom:8px;">
					拉取会以服务端覆盖本机缓存；上传会检查服务端 mtime，发现冲突时需要二次确认。本机暂存键：<code>sync.snapshot.&lt;userId&gt;.&lt;module&gt;</code>。
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
		(modal.querySelector('#sd-push') as HTMLButtonElement).onclick = () => void pushSelectedSyncModules(false);
		(modal.querySelector('#sd-devices') as HTMLButtonElement).onclick = () => void reloadSyncDevices();
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
							<input type="hidden" data-sync-remote="${escapeHtmlSafe(name)}" value="${escapeHtmlSafe(remote)}" />
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

	async function pushSelectedSyncModules(force: boolean): Promise<void> {
		const modal = syncDevicesModal!;
		const status = modal.querySelector('#sd-status') as HTMLDivElement;
		const ctx = getContext();
		const userId = ctx.id || '';
		const checks = Array.from(modal.querySelectorAll<HTMLInputElement>('input[data-sync-mod]:checked'));
		const modules: Record<string, unknown> = {};
		for (const check of checks) {
			const name = check.dataset.syncMod || '';
			if (!name) continue;
			try {
				const raw = localStorage.getItem(syncSnapshotKey(userId, name));
				if (!raw) continue;
				const snapshot = JSON.parse(raw) as { modified_at?: string; content?: unknown };
				const remote = modal.querySelector<HTMLInputElement>(`input[data-sync-remote="${CSS.escape(name)}"]`)?.value || '';
				modules[name] = {
					remote_modified_at: remote || snapshot.modified_at || '',
					content: snapshot.content ?? null
				};
			} catch { /* ignore malformed local cache */ }
		}
		const names = Object.keys(modules);
		if (names.length === 0) {
			status.textContent = '没有可上传的本机缓存。请先拉取或在本机产生学习数据。';
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.pushSync !== 'function') return;
		status.textContent = force ? '强制覆盖上传中…' : '上传中…';
		try {
			const data = (await api.pushSync({
				device_id: getSyncDeviceId(),
				device_name: getSyncDeviceName(),
				force,
				modules
			})) as { written?: Record<string, unknown>; conflicts?: Record<string, unknown>; status?: string } | null;
			const conflicts = data?.conflicts || {};
			const conflictNames = Object.keys(conflicts);
			if (conflictNames.length > 0 && !force) {
				status.textContent = `发现冲突：${conflictNames.join('、')}。服务端数据更新过，未覆盖。`;
				if (confirm(`发现 ${conflictNames.length} 个同步冲突。是否用本机缓存覆盖服务端？`)) {
					await pushSelectedSyncModules(true);
					return;
				}
			} else {
				const written = Object.keys(data?.written || {}).length;
				status.textContent = `已上传 ${written} 个模块`;
				showToast('上传完成');
			}
			await reloadSyncState();
		} catch (err) {
			status.textContent = readErrorMessage(err, '上传失败');
		}
	}

	async function reloadSyncDevices(): Promise<void> {
		const modal = syncDevicesModal!;
		const body = modal.querySelector('#sd-body') as HTMLDivElement;
		const status = modal.querySelector('#sd-status') as HTMLDivElement;
		const api = window.APIClient;
		if (!api || typeof api.getSyncDevices !== 'function') return;
		body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;">加载设备中…</div>';
		try {
			const data = (await api.getSyncDevices()) as { items?: Array<Record<string, unknown>>; server_time?: string } | null;
			const items = Array.isArray(data?.items) ? data.items : [];
			if (items.length === 0) {
				body.innerHTML = '<div style="padding:24px;color:#999;">暂无设备上传记录</div>';
				status.textContent = '';
				return;
			}
			body.innerHTML = `
				<div style="font-size:11px;color:#999;margin-bottom:6px;">当前设备：${escapeHtmlSafe(getSyncDeviceName())} / ${escapeHtmlSafe(getSyncDeviceId())}</div>
				<table style="border-collapse:collapse;width:100%;font-size:13px;">
					<thead><tr style="background:#fafafa;">
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">设备</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">首次同步</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">最后同步</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">最近模块</th>
					</tr></thead>
					<tbody>${items.map((item) => {
						const mods = Array.isArray(item.last_push_modules) ? item.last_push_modules.map(String).join('、') : '';
						return `<tr>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtmlSafe(String(item.device_name || item.device_id || 'Unknown'))}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">${escapeHtmlSafe(String(item.created_at || ''))}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">${escapeHtmlSafe(String(item.last_seen_at || ''))}</td>
							<td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtmlSafe(mods || '—')}</td>
						</tr>`;
					}).join('')}</tbody>
				</table>`;
			status.textContent = `共 ${items.length} 台设备`;
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
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
	(window as unknown as { openRechargePanel?: () => void }).openRechargePanel = () => {
		void openRechargePanel();
	};
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
