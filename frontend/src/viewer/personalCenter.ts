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
	ContactVerificationDraft, ContactVerificationKind, SectionDef,
	FeatureItem, RoleDef, PermissionOverride,
	PermissionTemplateId, ManagedCampus, ManagedLearningGroup, ManagedLearningGroupEnrollment,
	ManagedCoursePackage, OrganizationRolePermissionConfig
} from './personalCenter/types.js';
import {
	escapeHtml, asRecord, readString, readBoolean, readNumber, readCount, readStringArray,
	deriveFallbackDisplayName, preferredDisplayName, triggerMonogram
} from './personalCenter/utils.js';
import { buildStyleRegistry, getStyleByKey, parseStyleSchema, buildAvatarUrl, randomizeEditorState, generateRandomSeed } from './personalCenter/avatar.js';
import type { AvatarEditorOptions, StyleInfo, TabDef, ControlDef, EditorState } from './personalCenter/types.js';
import { renderOutlineIcon } from './personalCenter/icons.js';
import { normalizeSubscription, normalizeReferral, normalizePendingInvitation } from './personalCenter/normalize.js';
import { resolveEntitlement } from '../features/entitlements.js';


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
			icon: 'community',
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
			// 业务功能 15：审计日志可视化。内容管理员由后端强制限制为 content.* 日志。
			id: 'auditLog',
			title: '审计日志',
			icon: 'badge',
			intent: 'openAuditLog',
			gate: (u) => hasAnyRole(u, ['superAdmin', 'orgAdmin', 'contentAdmin']) && (window.isFeatureEnabled?.('audit_log_viewer') ?? true)
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
	const organizationRolePermissionRoleDefs = roleDefs.filter((role) => ['student', 'assistant', 'teacher', 'orgAdmin', 'contentAdmin'].includes(role.id));
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
		{ id: 'audit.view', name: '查看审计日志' },
		{ id: 'content.paper.maintain', name: '试卷维护' },
		{ id: 'content.analysis.review', name: '解析审核' },
		{ id: 'content.quality.check', name: '质量检查' }
	];

	let activeSection: SectionDef['id'] = 'dashboard';
	type DashboardSubpage = '' | 'recent' | 'favorites' | 'account' | 'account-core' | 'account-plan' | 'account-coupons' | 'account-feedback' | 'role-content';
	let activeDashboardSubpage: DashboardSubpage = '';
	let activeRoleContent = '';
	type WorkbenchId = 'student' | 'teacher' | 'assistant' | 'orgAdmin' | 'contentAdmin' | 'superAdmin';
	type ManagedOrganizationMode = 'platform' | 'permissions' | 'groups' | 'settings' | 'coursePackages' | 'subscription' | 'members';
	let activeWorkbench: WorkbenchId | '' = '';
	let personalCenterIdentityKey = '';
	let allUsers: PCUser[] = [];
	let localContext: PCContext = { guest: true };
	let riskModal: HTMLDivElement | null = null;
	let wechatTimer: number | null = null;
	let managedOrganizations: ManagedOrganization[] = [];
	let managedOrganizationsCacheKey = '';
	let managedOrganizationsLoading: Promise<void> | null = null;
	let managedOrganizationListPage = { page: 1, pageSize: 20, pages: 0, total: 0, query: '' };
	let managedOrganizationDetailState: Record<string, 'loading' | 'loaded' | 'error'> = {};
	let managedOrganizationToggleHandler: ((event: Event) => void) | null = null;
	let organizationMemberDrafts: Record<string, OrganizationMemberDraft> = {};
	let managedOrganizationOpenState: Record<string, boolean> = {};
	let activeOrganizationRolePermissionRoles: Record<string, string> = {};
	let activeOrganizationMemberRoles: Record<string, string> = {};
	let organizationLearningGroupCampusFilters: Record<string, string> = {};
	type OrganizationListPage<T> = {
		items: T[];
		total: number;
		page: number;
		pages: number;
		pageSize: number;
		query: string;
		sort: string;
		order: 'asc' | 'desc';
		filter: string;
		loaded: boolean;
		loading: boolean;
		error: string;
	};
	let organizationMemberListPages: Record<string, OrganizationListPage<ManagedOrganizationMember>> = {};
	let organizationLearningGroupListPages: Record<string, OrganizationListPage<ManagedLearningGroup>> = {};
	let organizationCampusListPages: Record<string, OrganizationListPage<ManagedCampus>> = {};
	let organizationCoursePackageListPages: Record<string, OrganizationListPage<ManagedCoursePackage>> = {};
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
	type AccountSession = {
		sessionId: string;
		current: boolean;
		createdAt: string;
		lastSeenAt: string;
		expiresAt: string;
		clientIp: string;
		userAgent: string;
	};
	let activeAccountEditor: 'password' | 'phone' | 'wechat' | 'sessions' | 'delete' | '' = '';
	let accountSessions: AccountSession[] = [];
	let accountSessionsLoaded = false;
	let accountSessionsLoading = false;
	let accountSecurityDraft = {
		currentPassword: '',
		newPassword: '',
		confirmPassword: '',
		wechatCode: 'wxdev_001',
		deleteConfirmation: '',
		deletePhoneCode: ''
	};
	let pendingInvitations: PendingOrganizationInvitation[] = [];
	let pendingInvitationsCacheKey = '';
	let pendingInvitationsLoading: Promise<void> | null = null;
	let favoriteBookmarksCacheKey = '';
	let favoriteBookmarksLoading: Promise<void> | null = null;
	let favoriteBookmarkQuestions: Record<string, unknown>[] = [];
	let favoriteBookmarkFolders: Record<string, unknown>[] = [];
	let activeFavoriteFolderId = '';
	const FAVORITE_UNCATEGORIZED_FOLDER_ID = '__uncategorized__';
	let recentLearningCacheKey = '';
	let recentLearningLoading: Promise<void> | null = null;
	let recentLearningItems: Record<string, unknown>[] = [];
	let myAssignmentsCacheKey = '';
	let myAssignmentsLoading: Promise<void> | null = null;
	let myAssignmentItems: Record<string, unknown>[] = [];
	let myAssignmentsError = '';
	let institutionRoleWorkbenchCacheKey = '';
	let institutionRoleWorkbenchLoading: Promise<void> | null = null;
	let institutionRoleWorkbenchData: Record<string, unknown> | null = null;
	let contentPublishExamItems: Record<string, unknown>[] = [];
	let contentWorkflowItems: Record<string, unknown>[] = [];
	let contentWorkflowMessages: Record<string, string> = {};
	let contentWorkflowSelection = new Set<string>();
	let contentWorkflowBatchBusy = false;
	let contentWorkflowBatchMessage = '';
	let platformRoleTemplates: Record<string, unknown>[] = [];
	let platformRoleTemplatesLoaded = false;
	let platformRoleTemplatePreviews: Record<string, Record<string, unknown>> = {};
	let platformRoleTemplatePreviewFingerprints: Record<string, string> = {};
	let platformUserAccessPreview: {
		userId: string;
		roleId: string;
		expiresAt: string;
		payload: Record<string, unknown>;
		preview: Record<string, unknown>;
	} | null = null;
	let platformUserAccessDraft = { userId: '', roleId: 'assistant', expiresAt: '' };

	async function loadPlatformRoleTemplates(force = false): Promise<void> {
		if (platformRoleTemplatesLoaded && !force) return;
		const token = activeToken(getContext()); const api = window.APIClient;
		if (!token || !api || typeof api.listPlatformRoleTemplates !== 'function') return;
		try { const data = await api.listPlatformRoleTemplates(token); platformRoleTemplates = Array.isArray(data) ? data.map(asRecord).filter((v): v is Record<string, unknown> => Boolean(v)) : []; platformRoleTemplatesLoaded = true; }
		catch (error) { showToast(readErrorMessage(error, '角色模板加载失败')); platformRoleTemplatesLoaded = true; }
		if (shouldRefreshRoleContent('platform-roles')) renderSectionContent({ preserveScroll: true });
	}
	let contentPublishQueueLoaded = false;
	let contentPublishQueueLoading: Promise<void> | null = null;
	let organizationMemberSaveDocumentBound = false;

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
			hasPassword: readBoolean(raw.hasPassword) ?? readBoolean(raw.has_password) ?? readBoolean(user?.hasPassword) ?? readBoolean(user?.has_password) ?? (ctx as PCContext).hasPassword,
			wechatBound: readBoolean(raw.wechatBound) ?? readBoolean(raw.wechat_bound) ?? readBoolean(user?.wechatBound) ?? readBoolean(user?.wechat_bound) ?? (ctx as PCContext).wechatBound,
			wechatNickname:
				readString(raw.wechatNickname) ||
				readString(raw.wechat_nickname) ||
				readString(user?.wechatNickname) ||
				readString(user?.wechat_nickname) ||
				(ctx as PCContext).wechatNickname,
			wechatBoundAt:
				readString(raw.wechatBoundAt) ||
				readString(raw.wechat_bound_at) ||
				readString(user?.wechatBoundAt) ||
				readString(user?.wechat_bound_at) ||
				(ctx as PCContext).wechatBoundAt,
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

	function maskPhone(phone: string | undefined): string {
		const raw = (phone || '').trim();
		const digits = raw.replace(/\D/g, '');
		if (digits.length >= 11) {
			return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
		}
		if (raw.length > 6) {
			return `${raw.slice(0, 3)}****${raw.slice(-2)}`;
		}
		return raw || '未绑定手机号';
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

	type LegacyModalFocusOrigin = { element: HTMLElement | null; selector: string };
	const legacyModalFocusOrigins = new WeakMap<HTMLElement, LegacyModalFocusOrigin>();

	function legacyFocusOrigin(element: HTMLElement | null): LegacyModalFocusOrigin {
		if (!element) return { element: null, selector: '' };
		if (element.id) return { element, selector: `#${CSS.escape(element.id)}` };
		for (const attribute of ['data-intent', 'data-dashboard-page', 'data-dashboard-back']) {
			const value = element.getAttribute(attribute);
			if (value !== null) {
				const suffix = value ? `="${CSS.escape(value)}"` : '';
				return { element, selector: `[${attribute}${suffix}]` };
			}
		}
		return { element, selector: '' };
	}

	function prepareLegacyModal(modal: HTMLDivElement, titleId: string, panelSelector = ':scope > :first-child'): void {
		if (modal.dataset.pcModalPrepared === '1') return;
		modal.dataset.pcModalPrepared = '1';
		modal.setAttribute('role', 'presentation');
		const panel = modal.querySelector<HTMLElement>(panelSelector);
		if (panel) {
			panel.classList.add('pc-legacy-modal-panel');
			panel.setAttribute('role', 'dialog');
			panel.setAttribute('aria-modal', 'true');
			panel.setAttribute('aria-labelledby', titleId);
		}
		modal.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !document.querySelector('.pc-confirm-overlay')) {
				event.preventDefault();
				event.stopPropagation();
				hideLegacyModal(modal);
				return;
			}
			if (event.key !== 'Tab' || !panel) return;
			const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
				.filter((element) => element.offsetParent !== null);
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		});
	}

	function showLegacyModal(modal: HTMLDivElement, focusSelector?: string): void {
		if (modal.classList.contains('risk-hidden') || modal.style.display === 'none') {
			legacyModalFocusOrigins.set(modal, legacyFocusOrigin(document.activeElement as HTMLElement | null));
		}
		modal.classList.remove('risk-hidden');
		modal.style.display = 'flex';
		requestAnimationFrame(() => {
			const target = focusSelector ? modal.querySelector<HTMLElement>(focusSelector) : null;
			(target || modal.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))?.focus();
		});
	}

	function hideLegacyModal(modal: HTMLDivElement): void {
		modal.classList.remove('risk-open');
		modal.classList.add('risk-hidden');
		modal.style.display = 'none';
		const previous = legacyModalFocusOrigins.get(modal);
		const target = previous?.element?.isConnected
			? previous.element
			: previous?.selector
				? document.querySelector<HTMLElement>(previous.selector)
				: null;
		target?.focus({ preventScroll: true });
	}

	function eventTargetElement(target: EventTarget | null): HTMLElement | null {
		if (target instanceof HTMLElement) {
			return target;
		}
		return target instanceof Node ? target.parentElement : null;
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
			hasPassword: normalized.hasPassword,
			wechatBound: normalized.wechatBound,
			wechatNickname: normalized.wechatNickname,
			wechatBoundAt: normalized.wechatBoundAt,
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
		const legacyToken = (localStorage.getItem('exam_v2_token') || '').trim();
		if (legacyToken) {
			return legacyToken;
		}
		// Existing API helpers still accept a token argument. This marker carries
		// no credential and tells the backend to fall back to the HttpOnly cookie.
		return ctx.id && ctx.id !== 'guest' ? '__cookie_session__' : '';
	}

	function managedOrganizationsKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function canManageMembers(ctx: PCContext): boolean {
		return hasAnyRole(ctx, ['orgAdmin', 'superAdmin']);
	}

	async function requestHighRiskPassword(actionLabel: string): Promise<string | null> {
		const ctx = getContext();
		if ((ctx.username || '').endsWith('_demo')) return '';
		return requestTextInput(`${actionLabel}\n请输入当前账号密码完成二次验证：`, '', { type: 'password', autocomplete: 'current-password' });
	}

	function requestConfirmation(message: string, confirmText = '确认'): Promise<boolean> {
		return new Promise((resolve) => {
			const previousFocus = document.activeElement as HTMLElement | null;
			const overlay = document.createElement('div');
			overlay.className = 'pc-confirm-overlay';
			overlay.setAttribute('role', 'presentation');
			overlay.innerHTML = '<div class="pc-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pc-confirm-title" aria-describedby="pc-confirm-message"><div id="pc-confirm-title" class="pc-service-header">请确认操作</div><div id="pc-confirm-message" class="pc-confirm-message"></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-pc-confirm-cancel>取消</button><button class="pc-inline-btn" type="button" data-pc-confirm-ok></button></div></div>';
			const messageNode = overlay.querySelector<HTMLElement>('#pc-confirm-message');
			const confirmButton = overlay.querySelector<HTMLButtonElement>('[data-pc-confirm-ok]');
			const cancelButton = overlay.querySelector<HTMLButtonElement>('[data-pc-confirm-cancel]');
			if (messageNode) messageNode.textContent = message;
			if (confirmButton) confirmButton.textContent = confirmText;
			const finish = (accepted: boolean) => { document.removeEventListener('keydown', onKeydown); overlay.remove(); previousFocus?.focus({ preventScroll: true }); resolve(accepted); };
			const onKeydown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') { event.preventDefault(); finish(false); return; }
				if (event.key !== 'Tab' || !confirmButton || !cancelButton) return;
				if (event.shiftKey && document.activeElement === cancelButton) { event.preventDefault(); confirmButton.focus(); }
				else if (!event.shiftKey && document.activeElement === confirmButton) { event.preventDefault(); cancelButton.focus(); }
			};
			confirmButton?.addEventListener('click', () => finish(true), { once: true });
			cancelButton?.addEventListener('click', () => finish(false), { once: true });
			overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
			document.addEventListener('keydown', onKeydown);
			document.body.appendChild(overlay);
			cancelButton?.focus();
		});
	}

	function requestTextInput(
		message: string,
		initialValue = '',
		options: { multiline?: boolean; type?: 'text' | 'password'; autocomplete?: string; confirmText?: string } = {}
	): Promise<string | null> {
		return new Promise((resolve) => {
			const previousFocus = document.activeElement as HTMLElement | null;
			const overlay = document.createElement('div');
			overlay.className = 'pc-confirm-overlay';
			overlay.setAttribute('role', 'presentation');
			overlay.innerHTML = `<form class="pc-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pc-input-title"><div id="pc-input-title" class="pc-service-header">请输入信息</div><label class="pc-org-field"><span data-pc-input-message></span>${options.multiline ? '<textarea class="pc-profile-input pc-confirm-input" rows="6" data-pc-input></textarea>' : '<input class="pc-profile-input pc-confirm-input" data-pc-input />'}</label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-pc-input-cancel>取消</button><button class="pc-inline-btn" type="submit" data-pc-input-ok></button></div></form>`;
			const form = overlay.querySelector<HTMLFormElement>('form');
			const input = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-pc-input]');
			const messageNode = overlay.querySelector<HTMLElement>('[data-pc-input-message]');
			const confirmButton = overlay.querySelector<HTMLButtonElement>('[data-pc-input-ok]');
			const cancelButton = overlay.querySelector<HTMLButtonElement>('[data-pc-input-cancel]');
			if (messageNode) messageNode.textContent = message;
			if (input) input.value = initialValue;
			if (input instanceof HTMLInputElement) { input.type = options.type || 'text'; if (options.autocomplete) input.setAttribute('autocomplete', options.autocomplete); }
			if (confirmButton) confirmButton.textContent = options.confirmText || '确定';
			let finished = false;
			const finish = (value: string | null) => { if (finished) return; finished = true; document.removeEventListener('keydown', onKeydown); overlay.remove(); previousFocus?.focus({ preventScroll: true }); resolve(value); };
			const focusable = [input, cancelButton, confirmButton].filter(Boolean) as HTMLElement[];
			const onKeydown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') { event.preventDefault(); finish(null); return; }
				if (event.key !== 'Tab' || focusable.length < 2) return;
				const index = focusable.indexOf(document.activeElement as HTMLElement);
				if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
				else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
			};
			form?.addEventListener('submit', (event) => { event.preventDefault(); finish(input?.value ?? ''); });
			cancelButton?.addEventListener('click', () => finish(null), { once: true });
			overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
			document.addEventListener('keydown', onKeydown);
			document.body.appendChild(overlay);
			input?.focus();
			if (input instanceof HTMLInputElement) input.select();
		});
	}

	function clearFormFieldErrors(form: HTMLFormElement): void {
		form.querySelectorAll('.pc-field-error').forEach((node) => node.remove());
		form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
	}

	function setFieldError(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, message: string): void {
		if (!field) return;
		field.setAttribute('aria-invalid', 'true');
		const label = field.closest('.pc-org-field') || field.parentElement;
		label?.querySelector('.pc-field-error')?.remove();
		const error = document.createElement('span');
		error.className = 'pc-field-error';
		error.setAttribute('role', 'alert');
		error.textContent = message;
		label?.appendChild(error);
		field.focus();
	}

	function pendingInvitationsKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function favoriteBookmarksKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function recentLearningKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	function invalidateRecentLearning(): void {
		recentLearningItems = [];
		recentLearningCacheKey = '';
		recentLearningLoading = null;
	}

	function invalidateFavoriteBookmarks(): void {
		favoriteBookmarkQuestions = [];
		favoriteBookmarkFolders = [];
		favoriteBookmarksCacheKey = '';
		favoriteBookmarksLoading = null;
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
				// Pending invitations are rendered only on the dashboard landing page.
				// Avoid replacing an account or role subpage that the user opened while
				// this background request was still in flight.
				if (activeSection === 'dashboard' && !activeDashboardSubpage && isOpen()) {
					renderSectionContent();
				}
			}
		})();

		await pendingInvitationsLoading;
	}

	async function ensureFavoriteBookmarks(ctx: PCContext): Promise<void> {
		const cacheKey = favoriteBookmarksKey(ctx);
		if (ctx.guest || !ctx.id) {
			favoriteBookmarkQuestions = [];
			favoriteBookmarkFolders = [];
			favoriteBookmarksCacheKey = cacheKey;
			favoriteBookmarksLoading = null;
			return;
		}
		const userId = ctx.id;

		const api = window.APIClient;
		if (!api || typeof api.getBookmarks !== 'function') {
			favoriteBookmarkQuestions = [];
			favoriteBookmarkFolders = [];
			favoriteBookmarksCacheKey = cacheKey;
			favoriteBookmarksLoading = null;
			return;
		}

		if (favoriteBookmarksCacheKey === cacheKey) {
			if (favoriteBookmarksLoading) {
				await favoriteBookmarksLoading;
			}
			return;
		}

		favoriteBookmarksCacheKey = cacheKey;
		favoriteBookmarksLoading = (async () => {
			try {
				const [bookmarkData, folderData] = await Promise.all([
					api.getBookmarks(userId),
					typeof api.listBookmarkFolders === 'function' ? api.listBookmarkFolders(userId).catch(() => null) : Promise.resolve(null)
				]);
				const bookmarks = asRecord(bookmarkData);
				const folders = asRecord(folderData);
				favoriteBookmarkQuestions = Array.isArray(bookmarks?.questions) ? bookmarks.questions.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
				favoriteBookmarkFolders = Array.isArray(folders?.items) ? folders.items.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
			} catch (error) {
				favoriteBookmarkQuestions = [];
				favoriteBookmarkFolders = [];
				log('load favorite bookmarks failed', error);
			} finally {
				favoriteBookmarksLoading = null;
				if (activeSection === 'dashboard' && activeDashboardSubpage === 'favorites' && isOpen()) {
					renderSectionContent();
				}
			}
		})();

		await favoriteBookmarksLoading;
	}

	async function ensureRecentLearning(ctx: PCContext): Promise<void> {
		const cacheKey = recentLearningKey(ctx);
		if (ctx.guest || !ctx.id) {
			recentLearningItems = [];
			recentLearningCacheKey = cacheKey;
			recentLearningLoading = null;
			return;
		}
		const userId = ctx.id;
		const api = window.APIClient;
		if (!api || typeof api.listRecentLearning !== 'function') {
			recentLearningItems = [];
			recentLearningCacheKey = cacheKey;
			recentLearningLoading = null;
			return;
		}
		if (recentLearningCacheKey === cacheKey) {
			if (recentLearningLoading) {
				await recentLearningLoading;
			}
			return;
		}

		recentLearningCacheKey = cacheKey;
		recentLearningLoading = (async () => {
			try {
				const data = asRecord(await api.listRecentLearning(userId, 3));
				recentLearningItems = Array.isArray(data?.items)
					? data.items.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
					: [];
			} catch (error) {
				recentLearningItems = [];
				log('load recent learning failed', error);
			} finally {
				recentLearningLoading = null;
				if (activeSection === 'dashboard' && activeDashboardSubpage === 'recent' && isOpen()) {
					renderSectionContent();
				}
			}
		})();

		await recentLearningLoading;
	}

	function assignmentCacheKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${activeToken(ctx)}`;
	}

	async function ensureMyAssignments(ctx: PCContext, force = false): Promise<void> {
		const cacheKey = assignmentCacheKey(ctx);
		if (ctx.guest || !ctx.id) {
			myAssignmentsCacheKey = cacheKey;
			myAssignmentItems = [];
			myAssignmentsError = '';
			myAssignmentsLoading = null;
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.listMyAssignments !== 'function') {
			myAssignmentsCacheKey = cacheKey;
			myAssignmentItems = [];
			myAssignmentsError = '作业接口暂不可用';
			return;
		}
		if (!force && myAssignmentsCacheKey === cacheKey) {
			if (myAssignmentsLoading) await myAssignmentsLoading;
			return;
		}
		myAssignmentsCacheKey = cacheKey;
		myAssignmentsError = '';
		myAssignmentsLoading = (async () => {
			try {
				const data = asRecord(await api.listMyAssignments());
				myAssignmentItems = Array.isArray(data?.items)
					? data.items.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
					: [];
				myAssignmentItems.sort((a, b) => {
					const left = readString(a.due_at);
					const right = readString(b.due_at);
					if (!left && !right) return 0;
					if (!left) return 1;
					if (!right) return -1;
					return left.localeCompare(right);
				});
			} catch (error) {
				myAssignmentItems = [];
				myAssignmentsError = readErrorMessage(error, '作业加载失败');
			} finally {
				myAssignmentsLoading = null;
				if (shouldRefreshRoleContent('student-assignments')) renderSectionContent({ preserveScroll: true });
			}
		})();
		await myAssignmentsLoading;
	}

	async function ensureContentPublishQueue(): Promise<void> {
		if (contentPublishQueueLoaded || contentPublishQueueLoading) {
			if (contentPublishQueueLoading) await contentPublishQueueLoading;
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getExams !== 'function') {
			contentPublishQueueLoaded = true;
			return;
		}
		contentPublishQueueLoading = (async () => {
			try {
				const [items, workflow] = await Promise.all([
					api.getExams({ sort: 'date_desc' }),
					typeof api.listContentWorkflow === 'function' && activeToken(getContext()) ? api.listContentWorkflow(activeToken(getContext())) : Promise.resolve([])
				]);
				contentPublishExamItems = Array.isArray(items)
					? items.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
					: [];
				contentWorkflowItems = Array.isArray(workflow) ? workflow.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
			} catch (error) {
				contentPublishExamItems = [];
				log('load content publish queue failed', error);
			} finally {
				contentPublishQueueLoaded = true;
				contentPublishQueueLoading = null;
				if (shouldRefreshRoleContent('content-publish')) renderSectionContent({ preserveScroll: true });
			}
		})();
		await contentPublishQueueLoading;
	}

	function institutionRoleWorkbenchKey(ctx: PCContext): string {
		return `${ctx.id || 'guest'}:${ctx.organizationId || ''}:${activeToken(ctx)}`;
	}

	function isInstitutionRoleContent(key: string): boolean {
		return [
			'teacher-students', 'teacher-groups', 'teacher-schedule', 'teacher-arrange',
			'teacher-review', 'teacher-assign', 'teacher-gradebook', 'teacher-prep',
			'assistant-remind', 'assistant-followup', 'assistant-renewal',
			'assistant-package', 'assistant-arrange', 'assistant-alerts',
			'org-dashboard'
		].includes(key) ||
			key.startsWith('teacher-student:') ||
			key.startsWith('teacher-group:') ||
			key.startsWith('teacher-assignment:') ||
			key.startsWith('teacher-prep:');
	}

	function invalidateInstitutionRoleWorkbench(): void {
		institutionRoleWorkbenchData = null;
		institutionRoleWorkbenchCacheKey = '';
		accountSessions = [];
		accountSessionsLoaded = false;
		accountSessionsLoading = false;
		institutionRoleWorkbenchLoading = null;
	}

	async function ensureInstitutionRoleWorkbench(ctx: PCContext): Promise<void> {
		const cacheKey = institutionRoleWorkbenchKey(ctx);
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (ctx.guest || !ctx.id || !token || !api || typeof api.getInstitutionWorkbench !== 'function') {
			institutionRoleWorkbenchData = null;
			institutionRoleWorkbenchCacheKey = cacheKey;
			institutionRoleWorkbenchLoading = null;
			return;
		}
		if (institutionRoleWorkbenchCacheKey === cacheKey) {
			if (institutionRoleWorkbenchLoading) {
				await institutionRoleWorkbenchLoading;
			}
			return;
		}
		institutionRoleWorkbenchCacheKey = cacheKey;
		institutionRoleWorkbenchLoading = (async () => {
			try {
				const [workbenchResult, dashboardResult] = await Promise.all([
					api.getInstitutionWorkbench(token, ctx.organizationId || undefined),
					typeof api.getInstitutionDashboard === 'function'
						? api.getInstitutionDashboard(token, ctx.organizationId || undefined)
						: Promise.resolve({})
				]);
				const workbench = asRecord(workbenchResult) || {};
				const dashboard = asRecord(dashboardResult) || {};
				institutionRoleWorkbenchData = { ...dashboard, ...workbench };
			} catch (error) {
				institutionRoleWorkbenchData = null;
				log('load institution role workbench failed', error);
			} finally {
				institutionRoleWorkbenchLoading = null;
				if (activeSection === 'dashboard' && activeDashboardSubpage === 'role-content' && isInstitutionRoleContent(activeRoleContent) && isOpen()) {
					renderSectionContent();
				}
			}
		})();
		await institutionRoleWorkbenchLoading;
	}

	function getOrganizationMemberDraft(organizationId: string): OrganizationMemberDraft {
		if (!organizationMemberDrafts[organizationId]) {
			organizationMemberDrafts[organizationId] = {
				searchQuery: '',
				searchResults: [],
				selectedUserId: '',
				memberNo: '',
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
					timeZone: 'Asia/Shanghai',
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false
			  });
	}

	function formatShortDateTime(value: string | undefined): string {
		if (!value) {
			return '';
		}
		const ts = Date.parse(value);
		return Number.isNaN(ts)
			? value
			: new Date(ts).toLocaleString('zh-CN', {
					timeZone: 'Asia/Shanghai',
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

	function organizationExpiryLabel(expiresAt: string | undefined): string {
		if (!expiresAt) {
			return '长期';
		}
		const ts = Date.parse(expiresAt);
		if (Number.isNaN(ts)) {
			return expiresAt;
		}
		return new Date(ts).toLocaleDateString('zh-CN', {
			timeZone: 'Asia/Shanghai',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
	}

	type PersonalPlan = 'free' | 'pro' | 'ultra';
	type PaidPersonalPlan = Exclude<PersonalPlan, 'free'>;
	type PricingScope = 'personal' | 'organization';
	type PaymentPriceMatrix = Record<string, Record<PaidPersonalPlan, Record<string, number>>>;
	type OrganizationPriceTier = {
		minSeats: number;
		maxSeats: number;
		pricesCents: PaymentPriceMatrix;
	};
	type PaymentPricingOffer = {
		id: 'first_purchase' | 'renewal' | 'campaign';
		kind: 'first_purchase' | 'renewal' | 'campaign';
		label: string;
		enabled: boolean;
		discountPercent: number;
		startsAt: string;
		endsAt: string;
	};
	type PaymentQuote = {
		baseUnitPriceCents: number;
		unitPriceCents: number;
		baseAmountCents: number;
		amountCents: number;
		discountCents: number;
		offer: PaymentPricingOffer | null;
	};
	type AutoRenewalNotice = {
		type: string;
		level: string;
		title: string;
		message: string;
		previousAmountCents?: number;
		currentAmountCents?: number;
		daysRemaining?: number;
	};
	type AutoRenewalView = {
		scopeType: PricingScope;
		scopeId: string;
		enabled: boolean;
		status: string;
		chargeReady: boolean;
		plan: PersonalPlan;
		days: number;
		seats: number;
		provider: string;
		currency: string;
		priceSnapshotCents: number;
		consentAt: string;
		nextChargeAt: string;
		daysUntilRenewal?: number;
		gracePeriodDays: number;
		notifyEmail: boolean;
		reminderSchedule: Array<{ daysBefore: number; scheduledFor: string }>;
		notices: AutoRenewalNotice[];
		currentQuote: PaymentQuote | null;
		subscription: {
			plan: PersonalPlan;
			status: string;
			expiresAt: string;
			seats: number;
			isActive: boolean;
		};
	};
		type PaymentNotification = {
		id: string;
		type: string;
		level: string;
		title: string;
		message: string;
		createdAt: string;
			readAt: string;
			emailStatus: string;
			emailAttempts: number;
			emailNextAttemptAt: string;
		};
	type PaymentNotificationInbox = {
		items: PaymentNotification[];
		total: number;
		unreadCount: number;
	};
	type RenewalOperationsView = {
		agreementsTotal: number;
		attemptsTotal: number;
			notificationsTotal: number;
			statusCounts: Record<string, number>;
			emailDeliveryCounts: Record<string, number>;
			lastRun: Record<string, unknown> | null;
		};
	type PaymentPricingConfig = {
		defaultProvider: string;
		renewal: {
			reminderDays: number[];
			priceChangeNoticeDays: number;
			gracePeriodDays: number;
		};
		catalogs: {
			personal: {
				durations: number[];
				pricesCents: PaymentPriceMatrix;
				offers: PaymentPricingOffer[];
			};
			organization: {
				durations: number[];
				pricesCents: PaymentPriceMatrix;
				minimumSeats: Record<PaidPersonalPlan, number>;
				customQuoteMinSeats: number;
				seatTiers: OrganizationPriceTier[];
				offers: PaymentPricingOffer[];
			};
		};
	};

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
			desc: '可长期使用的基础学习版。',
			features: ['基础题库与开放试卷', '近 7 天学习统计', '历史成绩永久保留']
		},
		{
			id: 'pro',
			name: 'PRO',
			price: '¥19 / 30天起',
			desc: '长期备考主套餐，覆盖完整学习闭环。',
			features: ['完整题库与深度解析', '完整趋势与薄弱项', '个性化推荐与标准导出']
		},
		{
			id: 'ultra',
			name: 'ULTRA',
			price: '¥39 / 30天起',
			desc: '适合高频学习、AI 辅助和考前冲刺。',
			features: ['智能组卷与动态计划', '预测和深度诊断', '更高 AI 额度与完整报告']
		}
	];
	const defaultPaymentPricing: PaymentPricingConfig = {
		defaultProvider: 'wechat',
		renewal: {
			reminderDays: [7, 3, 1],
			priceChangeNoticeDays: 7,
			gracePeriodDays: 7
		},
		catalogs: {
			personal: {
				durations: [30, 90, 365],
				offers: [
					{ id: 'first_purchase', kind: 'first_purchase', label: '个人首购优惠', enabled: false, discountPercent: 20, startsAt: '', endsAt: '' },
					{ id: 'renewal', kind: 'renewal', label: '个人续费优惠', enabled: false, discountPercent: 10, startsAt: '', endsAt: '' },
					{ id: 'campaign', kind: 'campaign', label: '个人限时活动', enabled: false, discountPercent: 15, startsAt: '', endsAt: '' }
				],
				pricesCents: {
					cny: {
						pro: { '30': 1900, '90': 4900, '365': 15900 },
						ultra: { '30': 3900, '90': 9900, '365': 29900 }
					},
					usd: {
						pro: { '30': 399, '90': 999, '365': 2999 },
						ultra: { '30': 699, '90': 1799, '365': 4999 }
					}
				}
			},
			organization: {
				durations: [30, 365],
				minimumSeats: { pro: 20, ultra: 30 },
				customQuoteMinSeats: 200,
				offers: [
					{ id: 'first_purchase', kind: 'first_purchase', label: '机构首购优惠', enabled: false, discountPercent: 10, startsAt: '', endsAt: '' },
					{ id: 'renewal', kind: 'renewal', label: '机构续费优惠', enabled: false, discountPercent: 5, startsAt: '', endsAt: '' },
					{ id: 'campaign', kind: 'campaign', label: '机构限时活动', enabled: false, discountPercent: 10, startsAt: '', endsAt: '' }
				],
				pricesCents: {
					cny: {
						pro: { '30': 1500, '365': 11900 },
						ultra: { '30': 2900, '365': 22900 }
					},
					usd: {
						pro: { '30': 299, '365': 1999 },
						ultra: { '30': 499, '365': 3799 }
					}
				},
				seatTiers: [
					{ minSeats: 20, maxSeats: 29, pricesCents: { cny: { pro: { '365': 11900 }, ultra: { '365': 0 } }, usd: { pro: { '365': 1999 }, ultra: { '365': 0 } } } },
					{ minSeats: 30, maxSeats: 49, pricesCents: { cny: { pro: { '365': 11900 }, ultra: { '365': 22900 } }, usd: { pro: { '365': 1999 }, ultra: { '365': 3799 } } } },
					{ minSeats: 50, maxSeats: 99, pricesCents: { cny: { pro: { '365': 10900 }, ultra: { '365': 21900 } }, usd: { pro: { '365': 1799 }, ultra: { '365': 3599 } } } },
					{ minSeats: 100, maxSeats: 199, pricesCents: { cny: { pro: { '365': 9900 }, ultra: { '365': 20900 } }, usd: { pro: { '365': 1599 }, ultra: { '365': 3399 } } } }
				]
			}
		}
	};
	let paymentPricingConfig: PaymentPricingConfig = defaultPaymentPricing;
	let paymentPricingLoaded = false;
	let paymentPricingPromise: Promise<PaymentPricingConfig> | null = null;
	const autoRenewalViews = new Map<string, AutoRenewalView>();
	const autoRenewalLoading = new Set<string>();
	const autoRenewalErrors = new Map<string, string>();
	let paymentNotificationInbox: PaymentNotificationInbox | null = null;
	let paymentNotificationOwnerId = '';
	let paymentNotificationsLoading = false;
	let paymentNotificationsError = '';
	let renewalOperationsView: RenewalOperationsView | null = null;
	let renewalOperationsLoading = false;
	let renewalOperationsError = '';
	let platformUserSearchQuery = '';
	let platformUserSearchResults: PCUser[] = [];
	let platformUserSearchLoading = false;
	let platformUserSearchLoaded = false;
	let platformStatsOverview: Record<string, unknown> | null = null;
	let platformStatsLoading = false;
	let platformStatsLoaded = false;
	type PlatformSystemFlag = {
		key: string;
		name: string;
		description: string;
		enabled: boolean;
		locked: boolean;
		source: 'default' | 'system';
		allowOrgOverride: boolean;
		allowUserOverride: boolean;
	};
	let platformSystemFlags: PlatformSystemFlag[] = [];
	let platformSystemFlagsLoading = false;
	let platformSystemFlagsLoaded = false;
	let platformSystemFlagsError = '';
	const pendingPlatformSystemFlags = new Set<string>();
	let platformFeedbackItems: Record<string, unknown>[] = [];
	let platformFeedbackLoading = false;
	let platformFeedbackLoaded = false;
	let platformFeedbackQuery = '';
	let platformFeedbackPage = 1;
	let platformFeedbackPageSize = 20;
	let platformFeedbackSort = 'created_at';
	let platformFeedbackOrder = 'desc';
	let platformFeedbackTotal = 0;
	let platformFeedbackPages = 0;

	function normalizePaymentPricing(raw: unknown): PaymentPricingConfig {
		const record = asRecord(raw);
		const catalogs = asRecord(record?.catalogs);
		const personalRaw = asRecord(catalogs?.personal) || record;
		const organizationRaw = asRecord(catalogs?.organization);
		const config = JSON.parse(JSON.stringify(defaultPaymentPricing)) as PaymentPricingConfig;
		config.defaultProvider = readString(record?.default_provider) || defaultPaymentPricing.defaultProvider;
		const renewalRaw = asRecord(record?.renewal);
		if (renewalRaw) {
			const reminderDays = Array.isArray(renewalRaw.reminder_days)
				? renewalRaw.reminder_days
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value >= 1 && value <= 30)
				: [];
			if (reminderDays.length) config.renewal.reminderDays = [...new Set(reminderDays)].sort((a, b) => b - a);
			const noticeDays = readCount(renewalRaw.price_change_notice_days);
			const graceDays = readCount(renewalRaw.grace_period_days);
			if (noticeDays && noticeDays <= 30) config.renewal.priceChangeNoticeDays = noticeDays;
			if (typeof graceDays === 'number' && graceDays <= 30) config.renewal.gracePeriodDays = graceDays;
		}
		const normalizeMatrix = (
			target: PaymentPriceMatrix,
			rawMatrix: unknown,
			durations: number[]
		): void => {
			const prices = asRecord(rawMatrix);
			for (const currency of ['cny', 'usd']) {
				const currencyRecord = asRecord(prices?.[currency]);
				for (const plan of ['pro', 'ultra'] as PaidPersonalPlan[]) {
					const planRecord = asRecord(currencyRecord?.[plan]);
					for (const days of durations.map(String)) {
						const amount = Number(planRecord?.[days]);
						if (Number.isFinite(amount) && amount >= 0) {
							target[currency][plan][days] = Math.round(amount);
						}
					}
				}
			}
		};
		const normalizeOffers = (target: PaymentPricingOffer[], rawOffers: unknown): void => {
			if (!Array.isArray(rawOffers)) return;
			for (const offer of target) {
				const source = rawOffers.map(asRecord).find((item) => readString(item?.id) === offer.id);
				if (!source) continue;
				offer.enabled = source.enabled === true;
				const discount = readNumber(source.discount_percent);
				if (typeof discount === 'number' && discount >= 0 && discount <= 90) {
					offer.discountPercent = Math.round(discount);
				}
				offer.startsAt = readString(source.starts_at) || '';
				offer.endsAt = readString(source.ends_at) || '';
			}
		};
		normalizeMatrix(
			config.catalogs.personal.pricesCents,
			personalRaw?.prices_cents,
			config.catalogs.personal.durations
		);
		normalizeOffers(config.catalogs.personal.offers, personalRaw?.offers);
		if (organizationRaw) {
			normalizeMatrix(
				config.catalogs.organization.pricesCents,
				organizationRaw.prices_cents,
				config.catalogs.organization.durations
			);
			const planRules = asRecord(organizationRaw.plans);
			for (const plan of ['pro', 'ultra'] as PaidPersonalPlan[]) {
				const rule = asRecord(planRules?.[plan]);
				const minimum = readCount(rule?.minimum_seats);
				if (minimum && minimum > 0) config.catalogs.organization.minimumSeats[plan] = minimum;
			}
			const customQuote = readCount(organizationRaw.custom_quote_min_seats);
			if (customQuote && customQuote > 1) config.catalogs.organization.customQuoteMinSeats = customQuote;
			if (Array.isArray(organizationRaw.seat_tiers)) {
				organizationRaw.seat_tiers.slice(0, config.catalogs.organization.seatTiers.length).forEach((item, index) => {
					const tierRaw = asRecord(item);
					if (!tierRaw) return;
					const tier = config.catalogs.organization.seatTiers[index];
					normalizeMatrix(tier.pricesCents, tierRaw.prices_cents, [365]);
				});
			}
			normalizeOffers(config.catalogs.organization.offers, organizationRaw.offers);
		}
		return config;
	}

	async function loadPaymentPricing(force = false): Promise<PaymentPricingConfig> {
		if (paymentPricingLoaded && !force) {
			return paymentPricingConfig;
		}
		if (paymentPricingPromise && !force) {
			return paymentPricingPromise;
		}
		const api = window.APIClient;
		if (!api || typeof api.getPaymentPricing !== 'function') {
			paymentPricingLoaded = true;
			return paymentPricingConfig;
		}
		paymentPricingPromise = api.getPaymentPricing()
			.then((payload) => {
				paymentPricingConfig = normalizePaymentPricing(payload);
				paymentPricingLoaded = true;
				return paymentPricingConfig;
			})
			.catch(() => {
				paymentPricingLoaded = true;
				return paymentPricingConfig;
			})
			.finally(() => {
				paymentPricingPromise = null;
			});
		return paymentPricingPromise;
	}

	function pricingAmountCents(
		plan: PersonalPlan,
		days = 30,
		currency = 'cny',
		scope: PricingScope = 'personal',
		seats = 1
	): number {
		if (plan === 'free') return 0;
		const key = String(days);
		const catalog = paymentPricingConfig.catalogs[scope];
		let amount = catalog.pricesCents[currency]?.[plan]?.[key]
			?? defaultPaymentPricing.catalogs[scope].pricesCents.cny[plan][key];
		if (scope === 'organization' && days === 365) {
			const tier = paymentPricingConfig.catalogs.organization.seatTiers
				.find((item) => seats >= item.minSeats && seats <= item.maxSeats);
			const tierAmount = tier?.pricesCents[currency]?.[plan]?.[key];
			if (typeof tierAmount === 'number' && tierAmount > 0) amount = tierAmount;
		}
		return amount;
	}

	function formatAmountCny(cents: number): string {
		if (cents <= 0) return '免费';
		const amount = cents / 100;
		return `¥${amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`;
	}

	function planPriceText(plan: PersonalPlan, days = 30): string {
		if (plan === 'free') return '免费';
		return `${formatAmountCny(pricingAmountCents(plan, days))} / ${days}天起`;
	}

	function personalPlanPriceSummary(plan: PersonalPlan): string {
		if (plan === 'free') return '免费';
		return paymentPricingConfig.catalogs.personal.durations
			.map((days) => `${days}天 ${formatAmountCny(pricingAmountCents(plan, days))}`)
			.join(' · ');
	}

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
	let paymentQuoteRequestSequence = 0;
	let organizationQuoteRequestSequence = 0;

	function paymentProviderLabel(provider: string): string {
		if (provider === 'wechat') return '微信支付';
		if (provider === 'alipay') return '支付宝';
		if (provider === 'stripe') return 'Stripe（海外卡/国际支付）';
		return provider || '微信支付';
	}

	function normalizePaymentQuote(raw: unknown): PaymentQuote | null {
		const record = asRecord(raw);
		if (!record) return null;
		const offerRaw = asRecord(record.offer);
		const offerId = readString(offerRaw?.id);
		const offer: PaymentPricingOffer | null = offerId === 'first_purchase' || offerId === 'renewal' || offerId === 'campaign'
			? {
				id: offerId,
				kind: offerId,
				label: readString(offerRaw?.label) || '订单优惠',
				enabled: true,
				discountPercent: readNumber(offerRaw?.discount_percent) ?? 0,
				startsAt: readString(offerRaw?.starts_at) || '',
				endsAt: readString(offerRaw?.ends_at) || ''
			}
			: null;
		const amountCents = readNumber(record.amount_cents);
		if (typeof amountCents !== 'number' || amountCents <= 0) return null;
		return {
			baseUnitPriceCents: readNumber(record.base_unit_price_cents) ?? amountCents,
			unitPriceCents: readNumber(record.unit_price_cents) ?? amountCents,
			baseAmountCents: readNumber(record.base_amount_cents) ?? amountCents,
			amountCents,
			discountCents: readNumber(record.discount_cents) ?? 0,
			offer
		};
	}

	function autoRenewalKey(scopeType: PricingScope, scopeId: string): string {
		return `${scopeType}:${scopeId}`;
	}

	function normalizeAutoRenewal(raw: unknown): AutoRenewalView | null {
		const record = asRecord(raw);
		if (!record) return null;
		const scopeType: PricingScope = readString(record.scope_type) === 'organization' ? 'organization' : 'personal';
		const subscriptionRaw = asRecord(record.subscription);
		const plan = normalizePersonalPlan(readString(record.plan) || readString(subscriptionRaw?.plan));
		const notices = (Array.isArray(record.notices) ? record.notices : []).flatMap((value) => {
			const notice = asRecord(value);
			if (!notice) return [];
			const previousAmountCents = readNumber(notice.previous_amount_cents);
			const currentAmountCents = readNumber(notice.current_amount_cents);
			const daysRemaining = readNumber(notice.days_remaining);
			return [{
				type: readString(notice.type) || 'renewal_notice',
				level: readString(notice.level) || 'info',
				title: readString(notice.title) || '续费提示',
				message: readString(notice.message) || '',
				...(typeof previousAmountCents === 'number' ? { previousAmountCents } : {}),
				...(typeof currentAmountCents === 'number' ? { currentAmountCents } : {}),
				...(typeof daysRemaining === 'number' ? { daysRemaining } : {})
			}];
		});
		const reminderSchedule = (Array.isArray(record.reminder_schedule) ? record.reminder_schedule : []).flatMap((value) => {
			const schedule = asRecord(value);
			const daysBefore = readNumber(schedule?.days_before);
			if (!schedule || typeof daysBefore !== 'number') return [];
			return [{ daysBefore, scheduledFor: readString(schedule.scheduled_for) || '' }];
		});
		const daysUntilRenewal = readNumber(record.days_until_renewal);
		return {
			scopeType,
			scopeId: readString(record.scope_id) || '',
			enabled: readBoolean(record.enabled) === true,
			status: readString(record.status) || 'disabled',
			chargeReady: readBoolean(record.charge_ready) === true,
			plan,
			days: readCount(record.days) || 365,
			seats: readCount(record.seats) || readCount(subscriptionRaw?.seats) || 1,
			provider: readString(record.provider) || paymentPricingConfig.defaultProvider,
			currency: readString(record.currency) || 'cny',
			priceSnapshotCents: readNumber(record.price_snapshot_cents) || 0,
			consentAt: readString(record.consent_at) || '',
			nextChargeAt: readString(record.next_charge_at) || readString(subscriptionRaw?.expires_at) || '',
			...(typeof daysUntilRenewal === 'number' ? { daysUntilRenewal } : {}),
			gracePeriodDays: readCount(record.grace_period_days) ?? paymentPricingConfig.renewal.gracePeriodDays,
			notifyEmail: readBoolean(record.notify_email) !== false,
			reminderSchedule,
			notices,
			currentQuote: normalizePaymentQuote(record.current_quote),
			subscription: {
				plan: normalizePersonalPlan(readString(subscriptionRaw?.plan)),
				status: readString(subscriptionRaw?.status) || 'active',
				expiresAt: readString(subscriptionRaw?.expires_at) || '',
				seats: readCount(subscriptionRaw?.seats) || 1,
				isActive: readBoolean(subscriptionRaw?.is_active) === true
			}
		};
	}

	async function ensureAutoRenewal(scopeType: PricingScope, scopeId: string, force = false): Promise<void> {
		const key = autoRenewalKey(scopeType, scopeId);
		if (!scopeId || autoRenewalLoading.has(key) || (!force && autoRenewalViews.has(key))) return;
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getAutoRenewal !== 'function') {
			autoRenewalErrors.set(key, '自动续费接口暂不可用');
			return;
		}
		autoRenewalLoading.add(key);
		autoRenewalErrors.delete(key);
		try {
			const normalized = normalizeAutoRenewal(await api.getAutoRenewal(
				token,
				scopeType,
				scopeType === 'organization' ? scopeId : ''
			));
			if (!normalized) throw new Error('自动续费状态格式无效');
			autoRenewalViews.set(key, normalized);
		} catch (error) {
			autoRenewalErrors.set(key, readErrorMessage(error, '自动续费状态加载失败'));
		} finally {
			autoRenewalLoading.delete(key);
			renderSectionContent({ preserveScroll: true });
		}
	}

	function renderAutoRenewalCard(
		scopeType: PricingScope,
		scopeId: string,
		fallback: { plan: string; status: string; expiresAt: string; seats?: number }
	): string {
		const key = autoRenewalKey(scopeType, scopeId);
		const renewal = autoRenewalViews.get(key);
		const error = autoRenewalErrors.get(key);
		if (!renewal && !error) void ensureAutoRenewal(scopeType, scopeId);
		if (!renewal) {
			return `<section class="pc-auto-renew-card" data-auto-renew-card data-renew-scope="${scopeType}" data-renew-id="${escapeHtml(scopeId)}">
				<div class="pc-auto-renew-head"><div><h4>自动续费</h4><p>${error ? escapeHtml(error) : '正在读取授权和提醒设置…'}</p></div><span class="pc-tag muted">${error ? '加载失败' : '加载中'}</span></div>
				${error ? '<div class="pc-org-form-actions"><button class="pc-inline-ghost" type="button" data-auto-renew-retry>重新加载</button></div>' : ''}
			</section>`;
		}
		const currentPlan = renewal.subscription.plan !== 'free'
			? renewal.subscription.plan
			: normalizePersonalPlan(fallback.plan);
		const isActive = renewal.subscription.isActive
			|| (fallback.status === 'active' && currentPlan !== 'free');
		const canEnable = isActive && currentPlan !== 'free';
		const statusLabel = !renewal.enabled
			? '已关闭'
			: renewal.chargeReady
				? '渠道签约完成'
				: '已授权 · 待渠道签约';
		const statusClass = renewal.enabled ? (renewal.chargeReady ? 'is-ready' : 'is-pending') : '';
		const amount = renewal.currentQuote?.amountCents || renewal.priceSnapshotCents;
		const expiry = renewal.nextChargeAt || renewal.subscription.expiresAt || fallback.expiresAt;
		const reminderDays = renewal.reminderSchedule.length
			? renewal.reminderSchedule.map((item) => item.daysBefore)
			: paymentPricingConfig.renewal.reminderDays;
		const notices = renewal.notices.map((notice) => {
			const priceChange = typeof notice.previousAmountCents === 'number' && typeof notice.currentAmountCents === 'number'
				? `<span><s>${formatAmountCny(notice.previousAmountCents)}</s> → <b>${formatAmountCny(notice.currentAmountCents)}</b></span>`
				: '';
			return `<div class="pc-auto-renew-notice${notice.level === 'warning' ? ' is-warning' : ''}">
				<strong>${escapeHtml(notice.title)}</strong>${priceChange}<p>${escapeHtml(notice.message)}</p>
			</div>`;
		}).join('');
		const durationOptions = paymentPricingConfig.catalogs[scopeType].durations
			.map((days) => `<option value="${days}"${renewal.days === days ? ' selected' : ''}>${days === 365 ? '年付（365 天）' : days === 30 ? '月付（30 天）' : `${days} 天`}</option>`)
			.join('');
		return `<section class="pc-auto-renew-card" data-auto-renew-card data-renew-scope="${scopeType}" data-renew-id="${escapeHtml(scopeId)}">
			<div class="pc-auto-renew-head"><div><h4>自动续费</h4><p>单独授权，默认关闭；关闭后当前已付周期仍可继续使用。</p></div><span class="pc-auto-renew-status ${statusClass}">${statusLabel}</span></div>
			${notices ? `<div class="pc-auto-renew-notices">${notices}</div>` : ''}
			<div class="pc-auto-renew-summary">
				<span><small>续费套餐</small><b>${escapeHtml(planLabel(currentPlan))} · ${renewal.days} 天</b></span>
				<span><small>预计金额</small><b>${amount > 0 ? formatAmountCny(amount) : '开启时确认'}</b></span>
				<span><small>下次续费日</small><b>${expiry ? escapeHtml(organizationExpiryLabel(expiry)) : '长期套餐'}</b></span>
				<span><small>提醒安排</small><b>提前 ${escapeHtml(reminderDays.join('、'))} 天</b></span>
			</div>
			${renewal.enabled && !renewal.chargeReady ? '<div class="pc-admin-note">授权已保存，但尚未取得支付渠道签约凭证；在渠道签约完成前不会自动扣款。</div>' : ''}
			<div class="pc-auto-renew-controls">
				<label class="pc-org-field"><span>续费周期</span><select class="pc-profile-input" data-auto-renew-days${renewal.enabled ? ' disabled' : ''}>${durationOptions}</select></label>
				<label class="pc-org-field"><span>支付渠道</span><select class="pc-profile-input" data-auto-renew-provider${renewal.enabled ? ' disabled' : ''}>
					<option value="wechat"${renewal.provider === 'wechat' ? ' selected' : ''}>微信支付</option>
					<option value="alipay"${renewal.provider === 'alipay' ? ' selected' : ''}>支付宝</option>
					<option value="stripe"${renewal.provider === 'stripe' ? ' selected' : ''}>Stripe</option>
				</select></label>
				<label class="pc-auto-renew-check"><input type="checkbox" data-auto-renew-email${renewal.notifyEmail ? ' checked' : ''}${renewal.enabled ? ' disabled' : ''} /><span>同时接收邮件提醒</span></label>
				<button class="${renewal.enabled ? 'pc-inline-ghost' : 'pc-inline-btn'}" type="button" data-auto-renew-toggle data-renew-enabled="${renewal.enabled ? 'true' : 'false'}"${!renewal.enabled && !canEnable ? ' disabled' : ''}>${renewal.enabled ? '关闭自动续费' : canEnable ? '开启自动续费' : '购买付费套餐后可开启'}</button>
			</div>
			<div class="pc-auto-renew-footnote">续费前按当前配置展示下期价格；价格变化不影响本期。扣款失败后保留 ${renewal.gracePeriodDays} 天宽限期。</div>
		</section>`;
	}

	async function toggleAutoRenewal(button: HTMLButtonElement): Promise<void> {
		const card = button.closest<HTMLElement>('[data-auto-renew-card]');
		if (!card) return;
		const scopeType: PricingScope = card.dataset.renewScope === 'organization' ? 'organization' : 'personal';
		const scopeId = card.dataset.renewId || '';
		const enabled = button.dataset.renewEnabled === 'true';
		const nextEnabled = !enabled;
		const confirmationMessage = nextEnabled
			? '确认开启自动续费？系统会保存一份独立授权；只有支付渠道签约完成后才会自动扣款，续费前会按设置发送提醒。'
			: '确认关闭自动续费？关闭只影响下一周期，当前已支付的套餐权益会保留到到期日。';
		if (!await requestConfirmation(confirmationMessage, nextEnabled ? '确认开启' : '确认关闭')) return;
		let reauthPassword = '';
		if (nextEnabled) {
			const password = await requestHighRiskPassword('开启自动续费');
			if (password === null) return;
			reauthPassword = password;
		}
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.updateAutoRenewal !== 'function') {
			showToast('自动续费接口暂不可用');
			return;
		}
		const finishSubmitting = beginOrganizationAction(button, nextEnabled ? '授权中…' : '关闭中…');
		if (!finishSubmitting) return;
		try {
			const days = Number((card.querySelector('[data-auto-renew-days]') as HTMLSelectElement | null)?.value || '365');
			const provider = (card.querySelector('[data-auto-renew-provider]') as HTMLSelectElement | null)?.value || paymentPricingConfig.defaultProvider;
			const notifyEmail = (card.querySelector('[data-auto-renew-email]') as HTMLInputElement | null)?.checked !== false;
			const updated = await api.updateAutoRenewal(token, {
				scope_type: scopeType,
				...(scopeType === 'organization' ? { organization_id: scopeId } : {}),
				enabled: nextEnabled,
				consent: nextEnabled,
				confirmation: nextEnabled ? '确认开启自动续费' : '确认关闭自动续费',
				days,
				provider,
				currency: 'cny',
				notify_email: notifyEmail,
				...(nextEnabled ? { reauth_password: reauthPassword } : {})
			});
			const normalized = normalizeAutoRenewal(updated);
			if (!normalized) throw new Error('自动续费状态格式无效');
			autoRenewalViews.set(autoRenewalKey(scopeType, scopeId), normalized);
			autoRenewalErrors.delete(autoRenewalKey(scopeType, scopeId));
			showToast(nextEnabled ? '自动续费授权已保存，等待支付渠道完成签约' : '自动续费已关闭，当前套餐权益不受影响');
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			showToast(readErrorMessage(error, nextEnabled ? '自动续费授权失败' : '关闭自动续费失败'));
		} finally {
			finishSubmitting();
		}
	}

	function normalizePaymentNotificationInbox(raw: unknown): PaymentNotificationInbox {
		const record = asRecord(raw);
		const items = (Array.isArray(record?.items) ? record.items : []).flatMap((value) => {
			const item = asRecord(value);
			if (!item) return [];
			const delivery = asRecord(item.delivery);
			const email = asRecord(delivery?.email);
			return [{
				id: readString(item.id) || '',
				type: readString(item.type) || 'renewal_notice',
				level: readString(item.level) || 'info',
				title: readString(item.title) || '续费通知',
				message: readString(item.message) || '',
					createdAt: readString(item.created_at) || '',
					readAt: readString(item.read_at) || '',
					emailStatus: readString(email?.status) || 'skipped',
					emailAttempts: readCount(email?.attempts) || 0,
					emailNextAttemptAt: readString(email?.next_attempt_at) || ''
				}];
		});
		return {
			items,
			total: readCount(record?.total) || items.length,
			unreadCount: readCount(record?.unread_count) || 0
		};
	}

	async function ensurePaymentNotifications(force = false): Promise<void> {
		const ctx = getContext();
		const ownerId = ctx.id || '';
		if (!ownerId) return;
		if (paymentNotificationOwnerId !== ownerId) {
			paymentNotificationOwnerId = ownerId;
			paymentNotificationInbox = null;
			paymentNotificationsError = '';
		}
		if (paymentNotificationsLoading || (!force && paymentNotificationInbox)) return;
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getPaymentNotifications !== 'function') {
			paymentNotificationsError = '续费通知接口暂不可用';
			return;
		}
		paymentNotificationsLoading = true;
		paymentNotificationsError = '';
		try {
			paymentNotificationInbox = normalizePaymentNotificationInbox(
				await api.getPaymentNotifications(token, false, 1, 20)
			);
		} catch (error) {
			paymentNotificationsError = readErrorMessage(error, '续费通知加载失败');
		} finally {
			paymentNotificationsLoading = false;
			renderSectionContent({ preserveScroll: true });
		}
	}

	function renderPaymentNotificationInbox(): string {
		if (!paymentNotificationInbox && !paymentNotificationsError) void ensurePaymentNotifications();
		const inbox = paymentNotificationInbox;
		const emailStatusText = (item: PaymentNotification): string => {
			if (item.emailStatus === 'delivered') return '邮件已发送';
			if (item.emailStatus === 'pending') return '邮件待发送';
			if (item.emailStatus === 'retry_scheduled') {
				return item.emailNextAttemptAt
					? `邮件将在 ${formatDateTime(item.emailNextAttemptAt)} 重试`
					: '邮件等待自动重试';
			}
			if (item.emailStatus === 'dead_letter') return '邮件多次发送失败，站内通知仍有效';
			if (item.emailStatus === 'failed') return '邮件发送失败，等待重试';
			return '未启用邮件提醒';
		};
		const rows = inbox?.items.map((item) => `<article class="pc-renewal-notification${item.readAt ? '' : ' is-unread'}">
			<div><div class="pc-renewal-notification-title"><strong>${escapeHtml(item.title)}</strong>${item.readAt ? '' : '<span>未读</span>'}</div>
			<p>${escapeHtml(item.message)}</p><small>${escapeHtml(formatDateTime(item.createdAt))} · ${escapeHtml(emailStatusText(item))}${item.emailAttempts ? ` · 已尝试 ${item.emailAttempts} 次` : ''}</small></div>
			${item.readAt ? '' : `<button class="pc-inline-ghost" type="button" data-payment-notification-read="${escapeHtml(item.id)}">标为已读</button>`}
		</article>`).join('') || '';
		return `<section class="pc-card pc-lite-list-card pc-renewal-inbox" data-payment-notification-inbox>
			<div class="pc-auto-renew-head"><div><h4>续费通知</h4><p>到期、调价、渠道签约和扣款结果会保存在这里。</p></div><span class="pc-auto-renew-status${inbox?.unreadCount ? ' is-pending' : ''}">${inbox?.unreadCount || 0} 条未读</span></div>
			${paymentNotificationsError ? `<div class="pc-admin-note">${escapeHtml(paymentNotificationsError)}</div>` : ''}
			${paymentNotificationsLoading && !inbox ? '<div class="pc-admin-note">正在读取续费通知…</div>' : rows || '<div class="pc-org-empty">暂时没有续费通知。</div>'}
			<div class="pc-org-form-actions pc-org-form-actions-end">
				<button class="pc-inline-ghost" type="button" data-payment-notifications-refresh>刷新</button>
				<button class="pc-inline-btn" type="button" data-payment-notifications-read-all${!inbox?.unreadCount ? ' disabled' : ''}>全部已读</button>
			</div>
		</section>`;
	}

	async function markPaymentNotificationRead(notificationId?: string): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api) return;
		try {
			if (notificationId && typeof api.markPaymentNotificationRead === 'function') {
				await api.markPaymentNotificationRead(token, notificationId);
			} else if (!notificationId && typeof api.markAllPaymentNotificationsRead === 'function') {
				await api.markAllPaymentNotificationsRead(token);
			}
			await ensurePaymentNotifications(true);
		} catch (error) {
			showToast(readErrorMessage(error, '通知状态更新失败'));
		}
	}

	function normalizeRenewalOperations(raw: unknown): RenewalOperationsView {
		const record = asRecord(raw);
		const counts = asRecord(record?.status_counts);
		const statusCounts: Record<string, number> = {};
		for (const [key, value] of Object.entries(counts || {})) {
			const count = readCount(value);
			if (typeof count === 'number') statusCounts[key] = count;
		}
		const emailCounts = asRecord(record?.email_delivery_counts);
		const emailDeliveryCounts: Record<string, number> = {};
		for (const [key, value] of Object.entries(emailCounts || {})) {
			const count = readCount(value);
			if (typeof count === 'number') emailDeliveryCounts[key] = count;
		}
		return {
			agreementsTotal: readCount(record?.agreements_total) || 0,
			attemptsTotal: readCount(record?.attempts_total) || 0,
			notificationsTotal: readCount(record?.notifications_total) || 0,
			statusCounts,
			emailDeliveryCounts,
			lastRun: asRecord(record?.last_run)
		};
	}

	async function ensureRenewalOperations(force = false): Promise<void> {
		if (renewalOperationsLoading || (!force && renewalOperationsView)) return;
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.getRenewalOperations !== 'function') {
			renewalOperationsError = '续费任务状态接口暂不可用';
			return;
		}
		renewalOperationsLoading = true;
		renewalOperationsError = '';
		try {
			renewalOperationsView = normalizeRenewalOperations(await api.getRenewalOperations(token));
		} catch (error) {
			renewalOperationsError = readErrorMessage(error, '续费任务状态加载失败');
		} finally {
			renewalOperationsLoading = false;
			renderSectionContent({ preserveScroll: true });
		}
	}

	function renderRenewalOperationsCard(): string {
		if (!renewalOperationsView && !renewalOperationsError) void ensureRenewalOperations();
		const operations = renewalOperationsView;
		const lastRun = operations?.lastRun;
		const pendingEmailCount = ['pending', 'failed', 'retry_scheduled']
			.reduce((total, status) => total + (operations?.emailDeliveryCounts[status] || 0), 0);
		const deadLetterCount = operations?.emailDeliveryCounts.dead_letter || 0;
		const statusText = operations
			? Object.entries(operations.statusCounts).map(([status, count]) => `${status} ${count}`).join(' · ') || '暂无授权记录'
			: renewalOperationsLoading ? '正在读取运行状态…' : renewalOperationsError || '暂无运行记录';
		return `<div class="pc-card pc-lite-list-card pc-renewal-operations">
			<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">续费任务运行状态</div><p>服务启动时执行一次，之后每 15 分钟扫描提醒、调价、待扣款和宽限期任务。</p></div><span class="pc-tag">${lastRun ? '运行正常' : '等待首次运行'}</span></div>
			<div class="pc-auto-renew-summary">
				<span><small>授权记录</small><b>${operations?.agreementsTotal || 0}</b></span>
				<span><small>扣款尝试</small><b>${operations?.attemptsTotal || 0}</b></span>
				<span><small>通知记录</small><b>${operations?.notificationsTotal || 0}</b></span>
				<span><small>邮件待重试</small><b>${pendingEmailCount}</b></span>
				<span><small>投递异常</small><b>${deadLetterCount}</b></span>
				<span><small>上次运行</small><b>${lastRun ? escapeHtml(formatDateTime(readString(lastRun.run_at))) : '尚未运行'}</b></span>
			</div>
			<div class="pc-admin-note">${escapeHtml(statusText)}</div>
			<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-renewal-operations-refresh>刷新</button><button class="pc-inline-btn" type="button" data-renewal-job-run>立即扫描</button></div>
		</div>`;
	}

	async function runRenewalJob(button: HTMLButtonElement): Promise<void> {
		if (!await requestConfirmation('确认立即扫描自动续费任务？系统会创建到期提醒、调价通知及符合条件的渠道扣款请求。', '确认执行')) return;
		const password = await requestHighRiskPassword('执行自动续费任务');
		if (password === null) return;
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.runRenewalJob !== 'function') {
			showToast('续费任务接口暂不可用');
			return;
		}
		const finishSubmitting = beginOrganizationAction(button, '扫描中…');
		if (!finishSubmitting) return;
		try {
			const result = asRecord(await api.runRenewalJob(token, {
				confirmation: '确认执行续费任务',
				reauth_password: password
			}));
				const delivery = asRecord(result?.notification_delivery);
				showToast(`续费扫描完成：${readCount(result?.scanned) || 0} 条授权，${readCount(result?.reminders_enqueued) || 0} 条提醒，邮件成功 ${readCount(delivery?.delivered) || 0} 条`);
			await ensureRenewalOperations(true);
		} catch (error) {
			showToast(readErrorMessage(error, '续费任务执行失败'));
		} finally {
			finishSubmitting();
		}
	}

	function paymentQuoteMarkup(quote: PaymentQuote, unitSuffix = ''): string {
		const price = `<b>${formatAmountCny(quote.amountCents)}${unitSuffix}</b>`;
		if (!quote.offer || quote.discountCents <= 0) {
			return `${price}<span>当前按基础价格结算。</span>`;
		}
		const windowText = quote.offer.endsAt
			? ` · 有效至 ${new Date(quote.offer.endsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
			: '';
		return `<strong>${escapeHtml(quote.offer.label)} · ${quote.offer.discountPercent}% 优惠</strong>
			<span><s>${formatAmountCny(quote.baseAmountCents)}</s> ${price} · 已优惠 ${formatAmountCny(quote.discountCents)}${escapeHtml(windowText)}</span>`;
	}

	function ensureRechargeModal(): HTMLDivElement {
		if (rechargeModal) return rechargeModal;
		const modal = document.createElement('div');
		modal.id = 'pc-recharge-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:16px;box-sizing:border-box;overflow:auto;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;width:min(760px, calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);box-sizing:border-box;">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 id="recharge-title" style="margin:0;font-size:16px;">续费 / 升级套餐</h3>
					<button type="button" id="recharge-close" aria-label="关闭续费面板" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="recharge-body"></div>
			</div>`;
		document.body.appendChild(modal);
		rechargeModal = modal;
		prepareLegacyModal(modal, 'recharge-title');
		(modal.querySelector('#recharge-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (event) => {
			if (event.target === modal) hideLegacyModal(modal);
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
				return `<label style="display:block;width:100%;box-sizing:border-box;border:1px solid ${plan.id === currentPlan ? '#1976d2' : '#e0e0e0'};border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;">
					<div style="display:flex;gap:10px;align-items:flex-start;">
						<input type="radio" name="recharge-plan" value="${plan.id}"${checked} style="margin-top:4px;" />
						<div style="flex:1;">
							<div style="display:flex;justify-content:space-between;gap:12px;">
								<strong>${escapeHtml(plan.name)}</strong>
								<span style="color:#1976d2;font-weight:600;text-align:right;">${escapeHtml(personalPlanPriceSummary(plan.id))}</span>
							</div>
							<div style="font-size:12px;color:#666;margin-top:3px;">${escapeHtml(plan.desc)}</div>
							<ul style="margin:8px 0 0 18px;padding:0;font-size:12px;color:#555;line-height:1.7;">${featureList}</ul>
						</div>
					</div>
				</label>`;
			})
			.join('');
		return `<div style="font-size:13px;color:#333;width:100%;box-sizing:border-box;">
			<div style="border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:14px;background:#fafafa;box-sizing:border-box;">
				<div>当前套餐：<strong>${escapeHtml(planLabel(currentPlan))}</strong> / ${escapeHtml(currentStatus)}</div>
				<div style="margin-top:4px;color:#666;">到期时间：${escapeHtml(currentExpiry || '长期有效')}</div>
			</div>
			<form id="recharge-form">
				${cards}
				<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px;">
					<label style="font-size:12px;color:#666;">续费时长
						<select id="recharge-days" style="display:block;width:100%;height:38px;margin-top:4px;padding:7px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;background:#fff;">
							${paymentPricingConfig.catalogs.personal.durations.map((days) => `<option value="${days}"${days === 365 ? ' selected' : ''}>${days} 天${days === 365 ? ' · 推荐' : ''}</option>`).join('')}
						</select>
					</label>
					<label style="font-size:12px;color:#666;">支付渠道
						<select id="recharge-provider" style="display:block;width:100%;height:38px;margin-top:4px;padding:7px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;background:#fff;">
							<option value="wechat"${paymentPricingConfig.defaultProvider === 'wechat' ? ' selected' : ''}>微信支付</option>
							<option value="alipay"${paymentPricingConfig.defaultProvider === 'alipay' ? ' selected' : ''}>支付宝</option>
							<option value="stripe"${paymentPricingConfig.defaultProvider === 'stripe' ? ' selected' : ''}>Stripe（海外卡/国际支付）</option>
						</select>
					</label>
				</div>
				<div id="recharge-preview" class="pc-pricing-order-preview" style="margin-top:12px;"></div>
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

	async function updateRechargePreview(modal: HTMLDivElement, ctx: PCContext): Promise<void> {
		const plan = normalizePersonalPlan((modal.querySelector('input[name="recharge-plan"]:checked') as HTMLInputElement | null)?.value);
		const days = Number((modal.querySelector('#recharge-days') as HTMLSelectElement | null)?.value || 365);
		const preview = modal.querySelector('#recharge-preview') as HTMLDivElement | null;
		if (!preview) return;
		if (plan === 'free') {
			preview.textContent = '将切换为 FREE：套餐长期有效，但高级访问权益会回到基础范围。';
			return;
		}
		const provider = (modal.querySelector('#recharge-provider') as HTMLSelectElement | null)?.value || 'wechat';
		const baseAmount = pricingAmountCents(plan, days);
		preview.innerHTML = `<strong>${planLabel(plan)} · ${days} 天</strong><span>${formatAmountCny(baseAmount)} · ${escapeHtml(paymentProviderLabel(provider))} · 正在确认可用优惠…</span>`;
		const api = window.APIClient;
		const token = activeToken(ctx);
		const sequence = ++paymentQuoteRequestSequence;
		if (!token || !api || typeof api.getPaymentQuote !== 'function') return;
		try {
			const quote = normalizePaymentQuote(await api.getPaymentQuote(token, {
				scope_type: 'personal',
				plan,
				days,
				currency: 'cny'
			}));
			if (sequence !== paymentQuoteRequestSequence || !quote || !preview.isConnected) return;
			preview.innerHTML = `${paymentQuoteMarkup(quote)}
				<span>渠道：${escapeHtml(paymentProviderLabel(provider))} · 支付成功后预计到期 ${escapeHtml(nextSubscriptionExpiry(ctx, days))}</span>`;
		} catch (error) {
			if (sequence !== paymentQuoteRequestSequence || !preview.isConnected) return;
			preview.innerHTML = `<strong>${planLabel(plan)} · ${days} 天 · ${formatAmountCny(baseAmount)}</strong>
				<span>暂未取得优惠报价，将由后端在创建订单时按有效规则重新计算。</span>`;
		}
	}

	async function submitRecharge(modal: HTMLDivElement, ctx: PCContext): Promise<void> {
		const form = modal.querySelector('#recharge-form') as HTMLFormElement | null;
		if (form) clearFormFieldErrors(form);
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
		const days = Number((modal.querySelector('#recharge-days') as HTMLSelectElement | null)?.value || 30);
		const provider = (modal.querySelector('#recharge-provider') as HTMLSelectElement | null)?.value || 'wechat';
		const submit = modal.querySelector('#recharge-submit') as HTMLButtonElement | null;
		if (submit?.disabled) return;
		if (submit) {
			submit.disabled = true;
			submit.setAttribute('aria-busy', 'true');
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
				hideLegacyModal(modal);
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
				const orderOffer = asRecord(order.offer);
				const offerLabel = readString(orderOffer?.label);
				const orderAmount = readNumber(order.amount_cents) ?? 0;
				preview.textContent = `订单 ${readString(order.id) || ''} 已创建，金额 ${formatAmountCny(orderAmount)}${offerLabel ? `，已使用“${offerLabel}”` : ''}，状态：${readString(order.status) || 'pending'}。`;
			}
		} catch (error) {
			const message = readErrorMessage(error, '支付订单创建失败');
			setFieldError(modal.querySelector('#recharge-provider') as HTMLSelectElement | null, message);
			showToast(message);
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.removeAttribute('aria-busy');
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
		await loadPaymentPricing();
		const modal = ensureRechargeModal();
		const body = modal.querySelector('#recharge-body') as HTMLDivElement | null;
		if (!body) return;
		body.innerHTML = renderRechargePanel(ctx);
		showLegacyModal(modal, '#recharge-close');
		void updateRechargePreview(modal, ctx);
		modal.querySelectorAll('input[name="recharge-plan"], #recharge-days, #recharge-provider').forEach((el) => {
			(el as HTMLInputElement | HTMLSelectElement).onchange = () => { void updateRechargePreview(modal, ctx); };
		});
		const cancel = modal.querySelector('#recharge-cancel') as HTMLButtonElement | null;
		if (cancel) {
			cancel.onclick = () => hideLegacyModal(modal);
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

	type PlatformPaymentState = {
		orders: Record<string, unknown>[];
		refunds: Record<string, unknown>[];
		ledger: Record<string, unknown>[];
		anomalies: Record<string, unknown>[];
		totalOrders: number;
		totalRefunds: number;
		totalLedger: number;
		pages: number;
	};

	let platformPaymentState: PlatformPaymentState = { orders: [], refunds: [], ledger: [], anomalies: [], totalOrders: 0, totalRefunds: 0, totalLedger: 0, pages: 0 };
	let platformPaymentsLoaded = false;
	let platformPaymentsLoading = false;
	let platformPaymentQuery = '';
	let platformPaymentPage = 1;
	let platformPaymentPageSize = 20;
	let platformPaymentSort = 'created_at';
	let platformPaymentOrder = 'desc';

	function pagedItems(value: unknown): Record<string, unknown>[] {
		const record = asRecord(value);
		return Array.isArray(record?.items) ? record.items.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
	}

	function pagedNumber(value: unknown, key: string): number {
		return readCount(asRecord(value)?.[key]) ?? 0;
	}

	async function loadPlatformPayments(force = false): Promise<void> {
		if ((platformPaymentsLoaded && !force) || platformPaymentsLoading) return;
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.listAdminPaymentOrders !== 'function') return;
		platformPaymentsLoading = true;
		try {
			const filters: Record<string, string | number> = { page: platformPaymentPage, page_size: platformPaymentPageSize, sort: platformPaymentSort, order: platformPaymentOrder };
			if (platformPaymentQuery) filters.q = platformPaymentQuery;
			const [orders, refunds, ledger, reconciliation] = await Promise.all([
				api.listAdminPaymentOrders(token, filters),
				api.listAdminPaymentRefunds(token, filters),
				api.listAdminPaymentLedger(token, filters),
				api.getAdminPaymentReconciliation(token)
			]);
			platformPaymentState = {
				orders: pagedItems(orders),
				refunds: pagedItems(refunds),
				ledger: pagedItems(ledger),
				anomalies: pagedItems(reconciliation),
				totalOrders: pagedNumber(orders, 'total'),
				totalRefunds: pagedNumber(refunds, 'total'),
				totalLedger: pagedNumber(ledger, 'total'),
				pages: Math.max(pagedNumber(orders, 'pages'), pagedNumber(refunds, 'pages'), pagedNumber(ledger, 'pages'))
			};
			platformPaymentsLoaded = true;
		} catch (error) {
			platformPaymentsLoaded = true;
			showToast(readErrorMessage(error, '支付管理数据加载失败'));
		} finally {
			platformPaymentsLoading = false;
			if (shouldRefreshRoleContent('platform-payments') || activeRoleContent.startsWith('platform-payment-order:') || activeRoleContent.startsWith('platform-payment-refund:')) {
				renderSectionContent({ preserveScroll: true });
			}
		}
	}

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

	function looksLikeOrganizationInviteContact(value: string): boolean {
		const normalized = value.trim();
		if (!normalized) {
			return false;
		}
		return normalized.includes('@') || /^[+\d][\d\s-]{5,}$/.test(normalized);
	}

	function normalizeUserRecord(value: unknown): PCUser | null {
		const record = asRecord(value);
		if (!record) {
			return null;
		}
		const normalized = normalizeContext({ ...record, guest: false });
		if (!normalized.id) {
			return null;
		}
		return toPCUser(normalized);
	}

	function shouldRefreshRoleContent(...keys: string[]): boolean {
		return activeSection === 'dashboard' && activeDashboardSubpage === 'role-content' && keys.includes(activeRoleContent) && isOpen();
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
					<button type="button" id="wallet-close" aria-label="关闭账户钱包" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="wallet-body"></div>
			</div>`;
		document.body.appendChild(modal);
		walletModal = modal;
		prepareLegacyModal(modal, 'wallet-title');
		(modal.querySelector('#wallet-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (event) => {
			if (event.target === modal) hideLegacyModal(modal);
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
		const form = modal.querySelector('#wallet-redeem-form') as HTMLFormElement | null;
		const input = modal.querySelector('#wallet-redeem-code') as HTMLInputElement | null;
		const submit = modal.querySelector('#wallet-redeem-submit') as HTMLButtonElement | null;
		const result = modal.querySelector('#wallet-redeem-result') as HTMLDivElement | null;
		const code = (input?.value || '').trim();
		if (form) clearFormFieldErrors(form);
		if (!token) {
			showToast('请先登录后兑换');
			return;
		}
		if (!code) {
			setFieldError(input, '请输入兑换码');
			return;
		}
		if (!api || typeof api.redeemCode !== 'function') {
			showToast('兑换接口暂不可用');
			return;
		}
		if (submit?.disabled) return;
		if (submit) {
			submit.disabled = true;
			submit.setAttribute('aria-busy', 'true');
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
			const message = readErrorMessage(error, '兑换失败');
			setFieldError(input, message);
			showToast(message);
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.removeAttribute('aria-busy');
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
		showLegacyModal(modal, '#wallet-close');
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
		showLegacyModal(modal, '#wallet-close');
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
		showLegacyModal(modal, '#wallet-close');
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

	async function sendEmailVerificationCode(email: string, form?: HTMLFormElement, button?: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedEmail = email.trim();
		if (form) clearFormFieldErrors(form);
		const emailInput = form?.querySelector('[data-verify-email]') as HTMLInputElement | null;
		if (!token || !api || typeof api.sendEmailVerificationCode !== 'function') {
			showToast('邮箱验证接口暂不可用');
			return;
		}
		if (!normalizedEmail) {
			setFieldError(emailInput, '请先输入邮箱');
			return;
		}
		if (emailInput && !emailInput.validity.valid) {
			setFieldError(emailInput, '请输入有效的邮箱地址');
			return;
		}
		const finishSubmitting = beginOrganizationAction(button, '发送中…');
		if (!finishSubmitting) return;
		try {
			const data = asRecord(await api.sendEmailVerificationCode(token, normalizedEmail));
			contactVerificationDraft.email = normalizedEmail;
			const remaining = data && typeof data.daily_remaining === 'number' ? `，今日剩余 ${data.daily_remaining} 次` : '';
			showToast(`邮箱验证码已发送${remaining}`);
		} catch (error) {
			log('send email verification failed', error);
			const message = readErrorMessage(error, '邮箱验证码发送失败');
			setFieldError(emailInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
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

	async function verifyEmailAddress(email: string, code: string, form?: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedEmail = email.trim();
		const normalizedCode = code.trim();
		if (form) clearFormFieldErrors(form);
		const emailInput = form?.querySelector('[data-verify-email]') as HTMLInputElement | null;
		const codeInput = form?.querySelector('[data-verify-email-code]') as HTMLInputElement | null;
		if (!token || !api || typeof api.verifyEmail !== 'function') {
			showToast('邮箱验证接口暂不可用');
			return;
		}
		if (!normalizedEmail) { setFieldError(emailInput, '请输入邮箱'); return; }
		if (emailInput && !emailInput.validity.valid) { setFieldError(emailInput, '请输入有效的邮箱地址'); return; }
		if (!normalizedCode) { setFieldError(codeInput, '请输入邮箱验证码'); return; }
		const finishSubmitting = beginOrganizationAction(form?.querySelector('button[type="submit"]') as HTMLButtonElement | undefined, '验证中…');
		if (!finishSubmitting) return;
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
			const message = readErrorMessage(error, '邮箱验证失败');
			setFieldError(codeInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
	}

	async function sendPhoneVerificationCode(phone: string, form?: HTMLFormElement, button?: HTMLButtonElement): Promise<void> {
		const api = window.APIClient;
		const normalizedPhone = phone.trim();
		if (form) clearFormFieldErrors(form);
		const phoneInput = form?.querySelector('[data-verify-phone]') as HTMLInputElement | null;
		if (!api || typeof api.sendPhoneVerificationCode !== 'function') {
			showToast('手机号验证接口暂不可用');
			return;
		}
		if (!normalizedPhone) {
			setFieldError(phoneInput, '请先输入手机号');
			return;
		}
		const finishSubmitting = beginOrganizationAction(button, '发送中…');
		if (!finishSubmitting) return;
		try {
			const data = asRecord(await api.sendPhoneVerificationCode(normalizedPhone));
			contactVerificationDraft.phone = normalizedPhone;
			const remaining = data && typeof data.daily_remaining === 'number' ? `，今日剩余 ${data.daily_remaining} 次` : '';
			showToast(`手机验证码已发送${remaining}`);
		} catch (error) {
			log('send phone verification failed', error);
			const message = readErrorMessage(error, '手机验证码发送失败');
			setFieldError(phoneInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
	}

	async function verifyPhoneNumber(phone: string, code: string, form?: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const normalizedPhone = phone.trim();
		const normalizedCode = code.trim();
		if (form) clearFormFieldErrors(form);
		const phoneInput = form?.querySelector('[data-verify-phone]') as HTMLInputElement | null;
		const codeInput = form?.querySelector('[data-verify-phone-code]') as HTMLInputElement | null;
		if (!token || !api || typeof api.verifyPhone !== 'function') {
			showToast('手机号验证接口暂不可用');
			return;
		}
		if (!normalizedPhone) { setFieldError(phoneInput, '请输入手机号'); return; }
		if (!normalizedCode) { setFieldError(codeInput, '请输入短信验证码'); return; }
		const finishSubmitting = beginOrganizationAction(form?.querySelector('button[type="submit"]') as HTMLButtonElement | undefined, '验证中…');
		if (!finishSubmitting) return;
		try {
			const result = asRecord(await api.verifyPhone(token, normalizedPhone, normalizedCode, {
				changeChallengeChannel: contactVerificationDraft.changeChallengeChannel || undefined,
				changeChallengeCode: contactVerificationDraft.changeChallengeCode.trim() || undefined
			})) || {};
			const switchedToken = readString(result.token);
			if (switchedToken) {
				localStorage.setItem('exam_v2_token', switchedToken);
				setContext({ ...getContext(), token: switchedToken });
			}
			contactVerificationDraft.phone = normalizedPhone;
			contactVerificationDraft.phoneCode = '';
			contactVerificationDraft.changeChallengeChannel = '';
			contactVerificationDraft.changeChallengeCode = '';
			activeContactVerificationEditor = '';
			if (activeAccountEditor === 'phone') {
				activeAccountEditor = '';
			}
			invalidatePendingInvitations();
			await refreshCurrentContextFromApi();
			await ensurePendingInvitations(getContext());
			renderSectionContent();
			showToast('手机号已验证');
		} catch (error) {
			log('verify phone failed', error);
			const message = readErrorMessage(error, '手机号验证失败');
			setFieldError(codeInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
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

	function normalizeOrganizationAddRoles(roles: string[], mode: 'member' | 'manager'): string[] {
		const allowed = mode === 'manager' ? new Set(['assistant', 'orgAdmin']) : new Set(organizationMemberRoleDefs.map((role) => role.id));
		const fallback = mode === 'manager' ? ['orgAdmin'] : ['student'];
		const normalized = roles.filter((role) => allowed.has(role));
		return normalized.length ? normalized : fallback;
	}

	function userSearchKeys(user: PCUser): string[] {
		return [user.id, user.username || '', user.displayName || '', user.email || '', user.phone || '', user.memberNo || '']
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean);
	}

	function isAlreadyInOrganization(user: PCUser, organization: ManagedOrganization, memberIds: Set<string>): boolean {
		return memberIds.has(user.id) || (!!user.organizationId && user.organizationId === organization.id);
	}

	function userMatchesOrganizationAddMode(user: PCUser, organization: ManagedOrganization, mode: 'member' | 'manager'): boolean {
		const roleSet = new Set(user.roleIds || []);
		if (mode === 'manager') {
			return roleSet.has('assistant') || roleSet.has('orgAdmin');
		}
		const activeRoleId = activeOrganizationMemberRoleId(organization);
		return roleSet.has(activeRoleId);
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
		managedOrganizationOpenState = {};
		managedOrganizationDetailState = {};
		managedOrganizationListPage = { page: 1, pageSize: 20, pages: 0, total: 0, query: '' };
		organizationMemberListPages = {};
		organizationLearningGroupListPages = {};
		organizationCampusListPages = {};
		organizationCoursePackageListPages = {};
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

	async function searchOrganizationCandidates(organization: ManagedOrganization, query: string, mode: 'member' | 'manager' = 'member'): Promise<void> {
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
			renderSectionContent({ preserveScroll: true, focusSelector: '[data-org-search-query]' });
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
						.filter((user) => user.id && !isAlreadyInOrganization(user, organization, memberIds))
						.filter((user) => userMatchesOrganizationAddMode(user, organization, mode))
						.map((user) => [user.id, user] as const)
				).values()
			);
			draft.searchResults = candidates;
			draft.selectedUserId = pickSearchCandidate(candidates, trimmedQuery)?.id || '';
			renderSectionContent({ preserveScroll: true, focusSelector: '[data-org-search-query]' });
			showToast(candidates.length > 0 ? `找到 ${candidates.length} 个可添加账号` : '没有找到可添加账号；如果对方还没有账号，可输入邮箱或手机号创建邀请');
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
		const reauthPassword = await requestHighRiskPassword('修改机构成员');
		if (reauthPassword === null) throw new Error('已取消二次验证');
		await api.saveOrganizationMember(organization.id, token, buildOrganizationMemberPayload(organization, userId.trim(), roles, memberNo, permissionTemplates, permissionOverrides), reauthPassword);
	}

	async function refreshManagedOrganizations(): Promise<void> {
		const ctx = getContext();
		// The list endpoint intentionally returns summaries only. Preserve which
		// organizations already had details loaded, then hydrate those records
		// again after refreshing the summaries. Otherwise a successful campus,
		// group or course-package mutation makes the UI fall back to empty arrays.
		const loadedOrganizationIds = Object.entries(managedOrganizationDetailState)
			.filter(([, state]) => state === 'loaded')
			.map(([organizationId]) => organizationId);
		invalidateManagedOrganizations();
		await ensureManagedOrganizations(ctx);
		for (const organizationId of loadedOrganizationIds) {
			if (managedOrganizations.some((organization) => organization.id === organizationId)) {
				await loadManagedOrganizationDetails(organizationId);
			}
		}
		renderSectionContent();
	}

	function renderOrganizationRoleControls(selectedRoles: string[], name: string, allowedRoleIds?: string[]): string {
		const roleSet = new Set(selectedRoles.length > 0 ? selectedRoles : ['student']);
		const allowed = allowedRoleIds?.length ? new Set(allowedRoleIds) : null;
		return organizationMemberRoleDefs
			.filter((role) => !allowed || allowed.has(role.id))
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

	function normalizeOrganizationRolePermissions(value: unknown): Record<string, OrganizationRolePermissionConfig> {
		const record = asRecord(value);
		const allowedPermissions = new Set(organizationPermissionDefs.map((item) => item.id));
		const result: Record<string, OrganizationRolePermissionConfig> = {};
		const validRoles = new Set(['student', 'assistant', 'teacher', 'orgAdmin', 'contentAdmin']);
		if (!record) {
			return result;
		}
		for (const roleId of Object.keys(record)) {
			if (!validRoles.has(roleId)) {
				continue;
			}
			const config = asRecord(record[roleId]);
			const allow = readStringArray(config?.allow)?.filter((permission) => allowedPermissions.has(permission)) || [];
			const deny = readStringArray(config?.deny)?.filter((permission) => allowedPermissions.has(permission)) || [];
			result[roleId] = {
				allow: Array.from(new Set(allow.filter((permission) => !deny.includes(permission)))),
				deny: Array.from(new Set(deny))
			};
		}
		return result;
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

	function organizationRoleDefaultPermissions(roleId: string): string[] {
		if (roleId === 'student') {
			return ['student.profile.view'];
		}
		if (roleId === 'contentAdmin') {
			return ['content.paper.maintain', 'content.analysis.review', 'content.quality.check'];
		}
		if (roleId === 'teacher') {
			return ['assignment.create', 'assignment.review', 'gradebook.view', 'student.profile.view', 'lesson_prep.create', 'lesson_prep.export'];
		}
		if (roleId === 'assistant') {
			return ['assignment.review', 'assignment.remind', 'gradebook.view', 'student.profile.view', 'student.followup.edit'];
		}
		if (roleId === 'orgAdmin') {
			return [
				'organization.dashboard.view',
				'organization.member.manage',
				'learning_group.manage',
				'lesson.booking.manage',
				'course_package.manage',
				'course_package.view',
				'audit.view'
			];
		}
		return [];
	}

	function organizationTemplateDefaultPermissions(templateId: PermissionTemplateId): string[] {
		switch (templateId) {
			case 'assistant':
				return ['assignment.review', 'assignment.remind'];
			case 'homeroom':
				return ['student.profile.view', 'student.followup.edit', 'renewal_risk.view'];
			case 'teachingOffice':
				return ['learning_group.manage', 'lesson.booking.manage', 'course_package.manage', 'course_package.view'];
			case 'consultant':
				return ['student.profile.view', 'student.followup.edit', 'renewal_risk.view'];
			case 'campusAdmin':
				return ['organization.dashboard.view', 'organization.member.manage', 'learning_group.manage', 'course_package.view', 'audit.view'];
			default:
				return [];
		}
	}

	function permissionNames(permissionIds: string[]): string {
		return permissionIds
			.map((permissionId) => organizationPermissionDefs.find((item) => item.id === permissionId)?.name || permissionId)
			.join('、');
	}

	function rolePermissionConfigFor(organization: ManagedOrganization, roleId: string): OrganizationRolePermissionConfig {
		return organization.rolePermissions[roleId] || { allow: [], deny: [] };
	}

	function effectiveOrganizationRolePermissions(organization: ManagedOrganization, roleId: string): string[] {
		const defaults = organizationRoleDefaultPermissions(roleId);
		const config = rolePermissionConfigFor(organization, roleId);
		const denySet = new Set(config.deny);
		return Array.from(new Set([...defaults, ...config.allow])).filter((permission) => !denySet.has(permission));
	}

	function renderRolePermissionTags(permissions: string[], options: { empty: string; removable?: boolean; effect?: 'allow' | 'deny'; organizationId?: string; roleId?: string; tone?: string }): string {
		if (!permissions.length) {
			return `<div class="pc-role-permission-empty">${escapeHtml(options.empty)}</div>`;
		}
		return `<div class="pc-role-permission-tags">${permissions
			.map((permission) => {
				const label = organizationPermissionDefs.find((item) => item.id === permission)?.name || permission;
				const removeButton = options.removable && options.effect && options.organizationId && options.roleId
					? `<button type="button" title="删除" data-org-role-permission-remove data-org-id="${escapeHtml(options.organizationId)}" data-role-id="${escapeHtml(options.roleId)}" data-permission="${escapeHtml(permission)}" data-effect="${escapeHtml(options.effect)}">×</button>`
					: '';
				return `<span class="${escapeHtml(options.tone || '')}">${escapeHtml(label)}${removeButton}</span>`;
			})
			.join('')}</div>`;
	}

	function renderRolePermissionSelect(name: string, excluded: string[]): string {
		const excludedSet = new Set(excluded);
		const options = organizationPermissionDefs
			.filter((permission) => !excludedSet.has(permission.id))
			.map((permission) => `<option value="${escapeHtml(permission.id)}">${escapeHtml(permission.name)}</option>`)
			.join('');
		return `<select class="pc-profile-input pc-org-select" name="${escapeHtml(name)}" ${options ? '' : 'disabled'}>${options || '<option value="">暂无可选权限</option>'}</select>`;
	}

	function organizationRolePermissionDisplayName(role: RoleDef | undefined, fallback: string): string {
		if (role?.id === 'orgAdmin') {
			return '机构管理';
		}
		if (role?.id === 'contentAdmin') {
			return '内容管理';
		}
		return role?.name || fallback;
	}

	function renderRolePermissionOverview(defaults: string[], config: OrganizationRolePermissionConfig, organizationId: string, roleId: string): string {
		const defaultSet = new Set(defaults);
		const denySet = new Set(config.deny);
		const rows = [
			...defaults.map((permission) => ({ permission, tone: denySet.has(permission) ? 'is-deny' : 'is-default', effect: denySet.has(permission) ? 'deny' as const : undefined })),
			...config.allow.filter((permission) => !defaultSet.has(permission)).map((permission) => ({ permission, tone: 'is-allow', effect: 'allow' as const })),
			...config.deny.filter((permission) => !defaultSet.has(permission)).map((permission) => ({ permission, tone: 'is-deny', effect: 'deny' as const }))
		];
		if (!rows.length) {
			return '<div class="pc-role-permission-empty">该角色暂无权限</div>';
		}
		return `<div class="pc-role-permission-tags">${rows
			.map((row) => {
				const label = organizationPermissionDefs.find((item) => item.id === row.permission)?.name || row.permission;
				const removeButton = row.effect
					? `<button type="button" title="取消这个机构调整" data-org-role-permission-remove data-org-id="${escapeHtml(organizationId)}" data-role-id="${escapeHtml(roleId)}" data-permission="${escapeHtml(row.permission)}" data-effect="${escapeHtml(row.effect)}">×</button>`
					: '';
				return `<span class="${escapeHtml(row.tone)}">${escapeHtml(label)}${removeButton}</span>`;
			})
			.join('')}</div>`;
	}

	function renderOrganizationRoleDefaultsPanel(organization: ManagedOrganization): string {
		const activeRoleId = activeOrganizationRolePermissionRoles[organization.id] && organizationRolePermissionRoleDefs.some((role) => role.id === activeOrganizationRolePermissionRoles[organization.id])
			? activeOrganizationRolePermissionRoles[organization.id]
			: organizationRolePermissionRoleDefs[0]?.id || 'student';
		const activeRole = organizationRolePermissionRoleDefs.find((role) => role.id === activeRoleId) || organizationRolePermissionRoleDefs[0];
		const config = rolePermissionConfigFor(organization, activeRoleId);
		const defaults = organizationRoleDefaultPermissions(activeRoleId);
		const effective = effectiveOrganizationRolePermissions(organization, activeRoleId);
		const hasOrganizationChanges = config.allow.length > 0 || config.deny.length > 0;
		const roleTabs = organizationRolePermissionRoleDefs
			.map((role) => {
				const roleConfig = rolePermissionConfigFor(organization, role.id);
				const changeCount = roleConfig.allow.length + roleConfig.deny.length;
				const roleName = organizationRolePermissionDisplayName(role, role.id);
				return `<button class="pc-role-permission-tab${role.id === activeRoleId ? ' is-active' : ''}" type="button" title="${escapeHtml(role.name)}${changeCount ? `：本机构已调整 ${changeCount} 项权限` : ''}" data-org-role-permission-role data-org-id="${escapeHtml(organization.id)}" data-role-id="${escapeHtml(role.id)}"><strong>${escapeHtml(roleName)}</strong>${changeCount ? `<em>${escapeHtml(String(changeCount))}</em>` : ''}</button>`;
			})
			.join('');
		return `<div class="pc-org-subsection pc-role-default-section">
			<div class="pc-org-subsection-head"><h4>机构角色权限</h4><span>${escapeHtml(organization.name)}</span></div>
			<div class="pc-role-permission-layout">
				<div class="pc-role-permission-sidebar">${roleTabs}</div>
				<div class="pc-role-permission-detail">
					<div class="pc-role-permission-title"><div><strong>${escapeHtml(organizationRolePermissionDisplayName(activeRole, activeRoleId))}</strong><span>${escapeHtml(activeRole?.desc || '')}</span></div><em>有效 ${escapeHtml(String(effective.length))} 项</em></div>
					<div class="pc-role-permission-block"><h5>角色权限</h5>${renderRolePermissionOverview(defaults, config, organization.id, activeRoleId)}</div>
					<div class="pc-role-permission-block">
						<h5>本机构调整${hasOrganizationChanges ? '' : '（暂无）'}</h5>
						<div class="pc-role-permission-adjust-grid">
							<form class="pc-role-permission-editor" data-org-role-permission-form data-org-id="${escapeHtml(organization.id)}" data-role-id="${escapeHtml(activeRoleId)}" data-effect="allow">
								${renderRolePermissionSelect('permission', effective)}
								<button class="pc-inline-btn" type="submit">添加权限</button>
							</form>
							<form class="pc-role-permission-editor" data-org-role-permission-form data-org-id="${escapeHtml(organization.id)}" data-role-id="${escapeHtml(activeRoleId)}" data-effect="deny">
								${renderRolePermissionSelect('permission', organizationPermissionDefs.map((permission) => permission.id).filter((permission) => !effective.includes(permission)))}
								<button class="pc-inline-ghost" type="submit">移除权限</button>
							</form>
						</div>
					</div>
				</div>
			</div>
		</div>`;
	}

	function organizationMemberPageState(organizationId: string, roleId: string): OrganizationListPage<ManagedOrganizationMember> {
		const key = `${organizationId}:${roleId}`;
		return organizationMemberListPages[key] || (organizationMemberListPages[key] = {
			items: [], total: 0, page: 1, pages: 0, pageSize: 20, query: '', sort: 'username', order: 'asc', filter: roleId,
			loaded: false, loading: false, error: ''
		});
	}

	function hasActiveRoleContentFormEdit(): boolean {
		const rolePage = document.querySelector('[data-dashboard-subpage="role-content"]');
		if (!rolePage) return false;
		if (rolePage.querySelector('form[data-pc-dirty="true"]')) return true;
		return Boolean((document.activeElement as HTMLElement | null)?.closest('[data-dashboard-subpage="role-content"] form'));
	}

	function organizationLearningGroupPageState(organizationId: string): OrganizationListPage<ManagedLearningGroup> {
		return organizationLearningGroupListPages[organizationId] || (organizationLearningGroupListPages[organizationId] = {
			items: [], total: 0, page: 1, pages: 0, pageSize: 20, query: '', sort: 'starts_at', order: 'asc', filter: '',
			loaded: false, loading: false, error: ''
		});
	}

	function normalizeManagedOrganizationMember(rawValue: unknown): ManagedOrganizationMember | null {
		const member = asRecord(rawValue);
		if (!member) return null;
		const userId = readString(member.user_id);
		if (!userId) return null;
		const roles = readStringArray(member.roles) || [];
		return {
			userId,
			username: readString(member.username) || userId,
			memberNo: readString(member.member_no) || readString(member.student_no) || readString(member.employee_no),
			roles,
			permissionTemplates: normalizePermissionTemplates(member.permission_templates || member.permissionTemplates, roles),
			permissionOverrides: normalizeOrganizationPermissionOverrides(member.permission_overrides || member.permissionOverrides),
			status: readString(member.status) || 'active'
		};
	}

	async function loadOrganizationMemberPage(organizationId: string, roleId: string): Promise<void> {
		const state = organizationMemberPageState(organizationId, roleId);
		if (state.loading) return;
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !api || typeof api.getOrganizationMembers !== 'function') return;
		state.loading = true;
		state.error = '';
		try {
			const payload = asRecord(await api.getOrganizationMembers(organizationId, token, {
				page: state.page, page_size: state.pageSize, role: roleId, q: state.query,
				sort: state.sort, order: state.order
			})) || {};
			state.items = (Array.isArray(payload.items) ? payload.items : [])
				.map(normalizeManagedOrganizationMember)
				.filter((item): item is ManagedOrganizationMember => Boolean(item));
			state.total = readCount(payload.total) ?? state.items.length;
			state.pages = readCount(payload.pages) ?? 0;
			state.loaded = true;
		} catch (error) {
			state.error = readErrorMessage(error, '成员列表加载失败');
		} finally {
			state.loading = false;
			if (activeSection === 'admin-hub' && activeDashboardSubpage === 'role-content' && isOpen() && !hasActiveRoleContentFormEdit()) renderSectionContent({ preserveScroll: true });
		}
	}

	async function loadOrganizationLearningGroupPage(organizationId: string): Promise<void> {
		const state = organizationLearningGroupPageState(organizationId);
		if (state.loading) return;
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !api || typeof api.getOrganizationLearningGroups !== 'function') return;
		state.loading = true;
		state.error = '';
		try {
			const payload = asRecord(await api.getOrganizationLearningGroups(organizationId, token, {
				page: state.page, page_size: state.pageSize, q: state.query, campus_id: state.filter,
				sort: state.sort, order: state.order
			})) || {};
			state.items = (Array.isArray(payload.items) ? payload.items : [])
				.map(normalizeManagedLearningGroup)
				.filter((item): item is ManagedLearningGroup => Boolean(item));
			state.total = readCount(payload.total) ?? state.items.length;
			state.pages = readCount(payload.pages) ?? 0;
			state.loaded = true;
		} catch (error) {
			state.error = readErrorMessage(error, '学习组列表加载失败');
		} finally {
			state.loading = false;
			if (activeSection === 'admin-hub' && activeDashboardSubpage === 'role-content' && isOpen() && !hasActiveRoleContentFormEdit()) renderSectionContent({ preserveScroll: true });
		}
	}

	function organizationCampusPageState(organizationId: string): OrganizationListPage<ManagedCampus> {
		return organizationCampusListPages[organizationId] || (organizationCampusListPages[organizationId] = {
			items: [], total: 0, page: 1, pages: 0, pageSize: 20, query: '', sort: 'name', order: 'asc', filter: '', loaded: false, loading: false, error: ''
		});
	}

	function organizationCoursePackagePageState(organizationId: string): OrganizationListPage<ManagedCoursePackage> {
		return organizationCoursePackageListPages[organizationId] || (organizationCoursePackageListPages[organizationId] = {
			items: [], total: 0, page: 1, pages: 0, pageSize: 20, query: '', sort: 'expires_at', order: 'asc', filter: '', loaded: false, loading: false, error: ''
		});
	}

	async function loadOrganizationCampusPage(organizationId: string): Promise<void> {
		const state = organizationCampusPageState(organizationId);
		if (state.loading) return;
		const token = activeToken(getContext()), api = window.APIClient;
		if (!token || !api || typeof api.getOrganizationCampuses !== 'function') return;
		state.loading = true; state.error = '';
		try {
			const payload = asRecord(await api.getOrganizationCampuses(organizationId, token, { page: state.page, page_size: state.pageSize, q: state.query, sort: state.sort, order: state.order })) || {};
			state.items = (Array.isArray(payload.items) ? payload.items : []).map(normalizeManagedCampus).filter((item): item is ManagedCampus => Boolean(item));
			state.total = readCount(payload.total) ?? state.items.length; state.pages = readCount(payload.pages) ?? 0; state.loaded = true;
		} catch (error) { state.error = readErrorMessage(error, '校区列表加载失败'); }
		finally { state.loading = false; if (activeSection === 'admin-hub' && activeDashboardSubpage === 'role-content' && isOpen() && !hasActiveRoleContentFormEdit()) renderSectionContent({ preserveScroll: true }); }
	}

	async function loadOrganizationCoursePackagePage(organizationId: string): Promise<void> {
		const state = organizationCoursePackagePageState(organizationId);
		if (state.loading) return;
		const token = activeToken(getContext()), api = window.APIClient;
		if (!token || !api || typeof api.getOrganizationCoursePackages !== 'function') return;
		state.loading = true; state.error = '';
		try {
			const payload = asRecord(await api.getOrganizationCoursePackages(organizationId, token, { page: state.page, page_size: state.pageSize, q: state.query, sort: state.sort, order: state.order })) || {};
			state.items = (Array.isArray(payload.items) ? payload.items : []).map(normalizeManagedCoursePackage).filter((item): item is ManagedCoursePackage => Boolean(item));
			state.total = readCount(payload.total) ?? state.items.length; state.pages = readCount(payload.pages) ?? 0; state.loaded = true;
		} catch (error) { state.error = readErrorMessage(error, '课程包列表加载失败'); }
		finally { state.loading = false; if (activeSection === 'admin-hub' && activeDashboardSubpage === 'role-content' && isOpen() && !hasActiveRoleContentFormEdit()) renderSectionContent({ preserveScroll: true }); }
	}

	function activeOrganizationMemberRoleId(organization: ManagedOrganization): string {
		const current = activeOrganizationMemberRoles[organization.id];
		return current && organizationMemberRoleDefs.some((role) => role.id === current)
			? current
			: organizationMemberRoleDefs[0]?.id || 'student';
	}

	function organizationRoleMemberCount(organization: ManagedOrganization, roleId: string): number {
		return organization.members.filter((member) => member.roles.includes(roleId)).length;
	}

	function organizationRolePendingInvitationCount(organization: ManagedOrganization, roleId: string): number {
		return organization.invitations.filter((invitation) => invitation.status === 'pending' && invitation.roles.includes(roleId)).length;
	}

	function renderOrganizationInvitationRow(organization: ManagedOrganization, invitation: ManagedOrganizationInvitation): string {
		const rolesText = roleLabels(invitation.roles).join(' / ') || invitation.roles.join(' / ') || '成员';
		const deliveryText = invitation.channel === 'email' ? '邮箱邀请' : '手机号邀请';
		const canCancel = invitation.status === 'pending';
		return `<div class="pc-org-invite-item pc-org-member-pending">
			<div class="pc-org-invite-head">
				<div><strong>${escapeHtml(invitation.contact)}</strong><span>${escapeHtml(rolesText)} · ${escapeHtml(deliveryText)}</span></div>
				<div class="pc-org-member-status"><span>${escapeHtml(invitationStatusLabel(invitation.status))}</span>${canCancel ? `<button class="pc-inline-danger" type="button" data-org-invitation-cancel data-org-id="${escapeHtml(organization.id)}" data-invitation-id="${escapeHtml(invitation.invitationId)}" data-invitation-contact="${escapeHtml(invitation.contact)}">取消</button>` : ''}</div>
			</div>
			<div class="pc-org-invite-meta"><span>到期：${escapeHtml(formatDateTime(invitation.expiresAt))}</span>${invitation.memberNo ? `<span>${escapeHtml(organizationMemberNoLabel(organization.organizationType))}：${escapeHtml(invitation.memberNo)}</span>` : ''}</div>
			${invitation.message ? `<div class="pc-admin-note">备注：${escapeHtml(invitation.message)}</div>` : ''}
		</div>`;
	}

	function renderOrganizationMembersByRolePanel(organization: ManagedOrganization): string {
		const activeRoleId = activeOrganizationMemberRoleId(organization);
		const activeRole = organizationMemberRoleDefs.find((role) => role.id === activeRoleId) || organizationMemberRoleDefs[0];
		const usePagedList = activeDashboardSubpage === 'role-content';
		const pageState = organizationMemberPageState(organization.id, activeRoleId);
		if (usePagedList && !pageState.loaded && !pageState.loading) void loadOrganizationMemberPage(organization.id, activeRoleId);
		const fallbackMembers = organization.members.filter((member) => member.roles.includes(activeRoleId));
		const filteredMembers = usePagedList && pageState.loaded ? pageState.items : fallbackMembers;
		const filteredInvitations = organization.invitations.filter((invitation) => invitation.status === 'pending' && invitation.roles.includes(activeRoleId));
		const roleTabs = organizationMemberRoleDefs
			.map((role) => {
				const count = organizationRoleMemberCount(organization, role.id) + organizationRolePendingInvitationCount(organization, role.id);
				return `<button class="pc-role-permission-tab${role.id === activeRoleId ? ' is-active' : ''}" type="button" title="${escapeHtml(role.desc)}" data-org-member-role data-org-id="${escapeHtml(organization.id)}" data-role-id="${escapeHtml(role.id)}"><strong>${escapeHtml(role.name)}</strong><em>${escapeHtml(String(count))}</em></button>`;
			})
			.join('');
		const visibleInvitations = !usePagedList || pageState.page === 1 ? filteredInvitations : [];
		const memberRows = [
			...filteredMembers.map((member) => renderOrganizationMemberEditor(organization, member)),
			...visibleInvitations.map((invitation) => renderOrganizationInvitationRow(organization, invitation))
		];
		const memberList = memberRows.length
			? memberRows.join('')
			: `<div class="pc-org-empty">${usePagedList && pageState.error ? escapeHtml(pageState.error) : `当前没有${escapeHtml(activeRole?.name || '该角色')}成员或待处理邀请。可以在当前标签页内搜索账号并添加，找不到账号时直接创建邀请。`}${usePagedList && pageState.error ? '<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-member-list-retry>重新加载</button></div>' : ''}</div>`;
		const totalMembers = usePagedList && pageState.loaded ? pageState.total : fallbackMembers.length;
		const listControls = `<form class="pc-org-add-form" data-org-member-list-form data-org-id="${escapeHtml(organization.id)}" data-role-id="${escapeHtml(activeRoleId)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>搜索当前角色</span><input class="pc-profile-input" data-org-member-list-query value="${escapeHtml(pageState.query)}" placeholder="姓名、账号或成员编号" /></label><label class="pc-org-field"><span>排序</span><select class="pc-profile-input pc-org-select" data-org-member-list-sort><option value="username"${pageState.sort === 'username' ? ' selected' : ''}>姓名/账号</option><option value="member_no"${pageState.sort === 'member_no' ? ' selected' : ''}>成员编号</option><option value="status"${pageState.sort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序 / 每页</span><span><select class="pc-profile-input pc-org-select" data-org-member-list-order><option value="asc"${pageState.order === 'asc' ? ' selected' : ''}>升序</option><option value="desc"${pageState.order === 'desc' ? ' selected' : ''}>降序</option></select><select class="pc-profile-input pc-org-select" data-org-member-list-page-size><option value="10"${pageState.pageSize === 10 ? ' selected' : ''}>10 条</option><option value="20"${pageState.pageSize === 20 ? ' selected' : ''}>20 条</option><option value="50"${pageState.pageSize === 50 ? ' selected' : ''}>50 条</option></select></span></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button><button class="pc-inline-ghost" type="button" data-org-member-list-page="prev"${pageState.page <= 1 || pageState.loading ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">${pageState.loading ? '加载中' : `第 ${pageState.page} / ${Math.max(1, pageState.pages)} 页`}</span><button class="pc-inline-ghost" type="button" data-org-member-list-page="next"${pageState.page >= pageState.pages || pageState.loading ? ' disabled' : ''}>下一页</button></div></form>`;
		return `<div class="pc-org-subsection pc-member-role-section">
			<div class="pc-org-subsection-head"><h4>成员管理</h4><span>${escapeHtml(activeRole?.name || activeRoleId)} · ${escapeHtml(String(totalMembers))} 人 · ${escapeHtml(String(filteredInvitations.length))} 个待邀请</span></div>
			<div class="pc-admin-note">上方选择角色标签页；下方搜索已有账号或创建邀请，并在同一列表展示该角色下已加入成员和待邀请对象。成员可同时拥有多个角色，因此同一个人可能出现在多个角色列表里。</div>
			<div class="pc-member-role-tabs">${roleTabs}</div>
			<div class="pc-member-role-current">
				<div><strong>${escapeHtml(activeRole?.name || activeRoleId)}</strong><span>${escapeHtml(activeRole?.desc || '按角色添加、邀请和维护成员')}</span></div>
				<em>${escapeHtml(String(filteredMembers.length + filteredInvitations.length))} 条</em>
			</div>
			${renderOrganizationAddForm(organization, 'member', { embedded: true })}
			${usePagedList ? listControls : ''}
			<div class="pc-org-member-list pc-org-unified-member-list">${memberList}</div>
		</div>`;
	}

	function renderOrganizationRoleDefaultsAdvancedPanel(organization: ManagedOrganization): string {
		return `<details class="pc-org-subsection pc-role-default-advanced">
			<summary class="pc-org-advanced-summary">
				<div><strong>高级：角色默认权限</strong><span>调整某个角色进入机构后的默认权限</span></div>
				<em>按需展开</em>
			</summary>
			${renderOrganizationRoleDefaultsPanel(organization)}
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
		successMessage: string,
		form?: HTMLFormElement
	): Promise<void> {
		if (form) clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationMember !== 'function') {
			showToast('成员管理接口暂不可用');
			return;
		}
		if (!userId.trim()) {
			setFieldError(form?.querySelector('[data-org-search-query]') as HTMLInputElement | null, '请先搜索并选择成员');
			showToast('请先选择成员');
			return;
		}
		if (roles.length === 0) {
			setFieldError(form?.querySelector('[data-org-role]') as HTMLInputElement | null, '至少选择一个成员角色');
			showToast('至少选择一个成员角色');
			return;
		}
		if (isOrganizationSeatFull(organization) && !organization.members.some((member) => member.userId === userId.trim())) {
			setFieldError(form?.querySelector('[data-org-search-query]') as HTMLInputElement | null, '当前机构席位已满');
			showToast('当前组织席位已满，请先释放席位');
			return;
		}
		const finishSubmitting = form ? beginOrganizationFormSubmission(form, '保存中...') : () => {};
		if (!finishSubmitting) return;
		try {
			await persistOrganizationMembership(organization, userId, roles, memberNo, permissionTemplates, permissionOverrides);
			resetOrganizationMemberDraft(organization.id);
			await refreshManagedOrganizations();
			showToast(successMessage);
		} catch (error) {
			log('save organization member failed', organization.id, userId, error);
			setFieldError(form?.querySelector('[data-org-member-no],[data-org-search-query]') as HTMLInputElement | null, readErrorMessage(error, '成员保存失败'));
			showToast(readErrorMessage(error, '成员保存失败'));
		} finally { finishSubmitting(); }
	}

	function beginOrganizationAction(button: HTMLButtonElement | undefined, label: string): (() => void) | null {
		if (!button) return () => {};
		if (button.disabled) return null;
		const original = button.textContent || '';
		const actionIdentity = Object.entries(button.dataset)
			.filter(([key, value]) => Boolean(value) && (key === 'orgId' || key.endsWith('Id') || key.endsWith('Action')));
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		button.textContent = label;
		return () => {
			button.disabled = false;
			button.removeAttribute('aria-busy');
			button.textContent = original;
			const focusTarget = button.isConnected
				? button
				: Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
					actionIdentity.length > 0 && actionIdentity.every(([key, value]) => candidate.dataset[key] === value));
			focusTarget?.focus();
		};
	}

	async function removeOrganizationMembership(organization: ManagedOrganization, member: ManagedOrganizationMember, button?: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.removeOrganizationMember !== 'function') {
			showToast('成员移除接口暂不可用');
			return;
		}
		const finishAction = beginOrganizationAction(button, '处理中...');
		if (!finishAction) return;
		const memberLabel = organizationMemberDisplayName(member);
		if (!await requestConfirmation(`确认将 ${memberLabel} 移出 ${organization.name} 吗？`)) {
			finishAction();
			return;
		}
		const reauthPassword = await requestHighRiskPassword('移除机构成员');
		if (reauthPassword === null) { finishAction(); return; }
		try {
			await api.removeOrganizationMember(organization.id, member.userId, token, reauthPassword);
			await refreshManagedOrganizations();
			showToast('成员已移除');
		} catch (error) {
			log('remove organization member failed', organization.id, member.userId, error);
			showToast(readErrorMessage(error, '成员移除失败'));
		} finally { finishAction(); }
	}

	function saveOrganizationMemberForm(form: HTMLFormElement): void {
		const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
		if (!organization) {
			showToast('组织信息已失效，请刷新后重试');
			return;
		}
		const roles = readOrganizationRoles(form);
		const memberNoInput = form.querySelector('[data-org-member-no]') as HTMLInputElement | null;
		void saveOrganizationMembership(
			organization,
			form.dataset.userId || '',
			roles,
			memberNoInput?.value || '',
			readOrganizationPermissionTemplates(form, roles),
			readOrganizationPermissionOverrides(form),
			'成员已更新',
			form
		);
	}

	function organizationMemberFormForButton(button: HTMLElement): HTMLFormElement | null {
		return (
			button.closest('form[data-org-member-form]') ||
			button.closest('.pc-org-member-editor')?.querySelector('form[data-org-member-form]') ||
			null
		) as HTMLFormElement | null;
	}

	function bindOrganizationMemberForms(scope: ParentNode): void {
		scope.querySelectorAll<HTMLFormElement>('form[data-org-member-form]').forEach((form) => {
			if (form.dataset.orgMemberBound === '1') {
				return;
			}
			form.dataset.orgMemberBound = '1';
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				saveOrganizationMemberForm(form);
			});
		});
		scope.querySelectorAll<HTMLButtonElement>('[data-org-member-save]').forEach((button) => {
			if (button.dataset.orgMemberSaveBound === '1') {
				return;
			}
			button.dataset.orgMemberSaveBound = '1';
			button.addEventListener('click', (event) => {
				event.preventDefault();
				const form = organizationMemberFormForButton(button);
				if (!form) {
					showToast('成员表单已失效，请刷新后重试');
					return;
				}
				saveOrganizationMemberForm(form);
			});
		});
	}

	function bindOrganizationMemberSaveDocumentHandler(): void {
		if (organizationMemberSaveDocumentBound) {
			return;
		}
		organizationMemberSaveDocumentBound = true;
		const handleSave = (event: Event): void => {
			const target = eventTargetElement(event.target);
			const button = target?.closest('[data-org-member-save]') as HTMLButtonElement | null;
			if (!button) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (button.dataset.orgMemberSavePending === '1') {
				return;
			}
			button.dataset.orgMemberSavePending = '1';
			window.setTimeout(() => {
				delete button.dataset.orgMemberSavePending;
			}, 1200);
			const form = organizationMemberFormForButton(button);
			if (!form) {
				showToast('成员表单已失效，请刷新后重试');
				return;
			}
			saveOrganizationMemberForm(form);
		};
		document.addEventListener('pointerdown', handleSave, true);
		document.addEventListener('click', handleSave, true);
	}

	async function saveOrganizationInvitation(
		organization: ManagedOrganization,
		contact: string,
		roles: string[],
		memberNo: string,
		permissionTemplates: PermissionTemplateId[],
		message: string,
		form?: HTMLFormElement
	): Promise<void> {
		if (form) clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationInvitation !== 'function') {
			showToast('邀请接口暂不可用');
			return;
		}
		const normalizedContact = contact.trim();
		const contactInput = form?.querySelector('[data-org-invite-contact],[data-org-search-query]') as HTMLInputElement | null;
		if (!normalizedContact) {
			setFieldError(contactInput, '请输入邮箱或手机号');
			showToast('请输入邮箱或手机号');
			return;
		}
		if (!looksLikeOrganizationInviteContact(normalizedContact)) {
			setFieldError(contactInput, '请输入完整、有效的邮箱或手机号');
			return;
		}
		if (roles.length === 0) {
			setFieldError(form?.querySelector('[data-org-role]') as HTMLInputElement | null, '至少选择一个邀请角色');
			showToast('至少选择一个邀请角色');
			return;
		}
		const finishSubmitting = form ? beginOrganizationFormSubmission(form, '创建中...') : () => {};
		if (!finishSubmitting) return;
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
			draft.searchQuery = '';
			draft.searchResults = [];
			draft.selectedUserId = '';
			draft.memberNo = '';
			draft.inviteContact = '';
			draft.inviteMemberNo = '';
			draft.inviteMessage = '';
			await refreshManagedOrganizations();
			showToast('邀请已创建，系统会自动投递到目标邮箱或手机号');
		} catch (error) {
			log('save organization invitation failed', organization.id, error);
			setFieldError(contactInput, readErrorMessage(error, '邀请创建失败'));
			showToast(readErrorMessage(error, '邀请创建失败'));
		} finally { finishSubmitting(); }
	}

	async function saveOrganizationRolePermissions(organization: ManagedOrganization, roleId: string, allow: string[], deny: string[], form?: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationRolePermissions !== 'function') {
			showToast('角色权限接口不可用');
			return;
		}
		const finishSubmitting = form ? beginOrganizationFormSubmission(form, '保存中...') : () => {};
		if (!finishSubmitting) return;
		const reauthPassword = await requestHighRiskPassword('修改角色权限');
		if (reauthPassword === null) { finishSubmitting(); return; }
		try {
			await api.saveOrganizationRolePermissions(organization.id, roleId, token, { allow, deny }, reauthPassword);
			await refreshManagedOrganizations();
			showToast('角色权限已保存');
		} catch (error) {
			log('save organization role permissions failed', organization.id, roleId, error);
			showToast(readErrorMessage(error, '角色权限保存失败'));
		} finally { finishSubmitting(); }
	}

	async function cancelOrganizationInvitation(organization: ManagedOrganization, invitation: ManagedOrganizationInvitation, button?: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.cancelOrganizationInvitation !== 'function') {
			showToast('取消邀请接口暂不可用');
			return;
		}
		const finishAction = beginOrganizationAction(button, '取消中...');
		if (!finishAction) return;
		if (!await requestConfirmation(`确认取消发往 ${invitation.contact} 的邀请吗？`)) {
			finishAction();
			return;
		}
		try {
			await api.cancelOrganizationInvitation(organization.id, invitation.invitationId, token);
			await refreshManagedOrganizations();
			showToast('邀请已取消');
		} catch (error) {
			log('cancel organization invitation failed', organization.id, invitation.invitationId, error);
			showToast(readErrorMessage(error, '取消邀请失败'));
		} finally { finishAction(); }
	}

	async function saveOrganizationSubscription(
		organization: ManagedOrganization,
		plan: string,
		status: string,
		seatsValue: string,
		expiresAtValue: string,
		form?: HTMLFormElement
	): Promise<void> {
		if (form) clearFormFieldErrors(form);
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
		const seatsInput = form?.querySelector('[data-org-seats]') as HTMLInputElement | null;
		if (!Number.isInteger(parsedSeats) || parsedSeats < 1) { setFieldError(seatsInput, '席位数必须是大于 0 的整数'); return; }
		const seats = parsedSeats;
		if (seats < organization.memberCount) {
			setFieldError(seatsInput, `不能少于当前成员数 ${organization.memberCount}`);
			showToast(`席位数不能少于当前成员数 ${organization.memberCount}`);
			return;
		}
		const expiresAt = expiresAtValue.trim()
			? new Date(`${expiresAtValue.trim()}T23:59:59Z`).toISOString()
			: '';
		if (!await requestConfirmation('确认修改该机构的套餐、状态、到期时间或席位吗？修改后相关成员会话将失效。', '确认修改')) return;
		const reauthPassword = await requestHighRiskPassword('修改机构订阅');
		if (reauthPassword === null) return;
		const finishSubmitting = form ? beginOrganizationFormSubmission(form, '保存中...') : () => {};
		if (!finishSubmitting) return;
		try {
			await api.updateOrganizationSubscription(organization.id, token, {
				plan: normalizedPlan,
				status: normalizedStatus,
				seats,
				expires_at: expiresAt,
				confirmation: '确认修改机构订阅',
				reauth_password: reauthPassword
			});
			await refreshManagedOrganizations();
			showToast('组织套餐与席位已更新');
		} catch (error) {
			log('save organization subscription failed', organization.id, error);
			setFieldError(seatsInput, readErrorMessage(error, '组织套餐更新失败'));
			showToast(readErrorMessage(error, '组织套餐更新失败'));
		} finally { finishSubmitting(); }
	}

	function beginOrganizationFormSubmission(form: HTMLFormElement, pendingLabel = '保存中...'): (() => void) | null {
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (!submit || submit.disabled) return null;
		const originalLabel = submit.textContent || '保存';
		const previousBusy = form.getAttribute('aria-busy');
		submit.disabled = true;
		submit.textContent = pendingLabel;
		form.setAttribute('aria-busy', 'true');
		return () => {
			submit.disabled = false;
			submit.textContent = originalLabel;
			if (previousBusy === null) form.removeAttribute('aria-busy');
			else form.setAttribute('aria-busy', previousBusy);
		};
	}

	async function saveOrganizationCampus(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationCampus !== 'function') {
			showToast('校区管理接口暂不可用');
			return;
		}
		const nameInput = form.querySelector('[data-org-campus-name]') as HTMLInputElement | null;
		const name = (nameInput?.value || '').trim();
		if (!name) {
			setFieldError(nameInput, '请输入校区名称');
			return;
		}
		const finishSubmitting = beginOrganizationFormSubmission(form);
		if (!finishSubmitting) return;
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
			setFieldError(nameInput, readErrorMessage(error, '校区保存失败'));
			log('save organization campus failed', organization.id, error);
			showToast(readErrorMessage(error, '校区保存失败'));
		} finally { finishSubmitting(); }
	}

	async function saveOrganizationLearningGroup(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationLearningGroup !== 'function') {
			showToast('学习组管理接口暂不可用');
			return;
		}
		const nameInput = form.querySelector('[data-org-learning-group-name]') as HTMLInputElement | null;
		const startsInput = form.querySelector('[data-org-learning-group-starts]') as HTMLInputElement | null;
		const endsInput = form.querySelector('[data-org-learning-group-ends]') as HTMLInputElement | null;
		const name = (nameInput?.value || '').trim();
		if (!name) {
			setFieldError(nameInput, '请输入学习组名称');
			return;
		}
		if (startsInput?.value && endsInput?.value && Date.parse(endsInput.value) <= Date.parse(startsInput.value)) { setFieldError(endsInput, '结束时间必须晚于开始时间'); return; }
		const finishSubmitting = beginOrganizationFormSubmission(form);
		if (!finishSubmitting) return;
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
			setFieldError(nameInput, readErrorMessage(error, '学习组保存失败'));
			log('save organization learning group failed', organization.id, error);
			showToast(readErrorMessage(error, '学习组保存失败'));
		} finally { finishSubmitting(); }
	}

	async function saveOrganizationCoursePackage(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveOrganizationCoursePackage !== 'function') {
			showToast('课程包管理接口暂不可用');
			return;
		}
		const studentInput = form.querySelector('[data-org-course-package-student]') as HTMLSelectElement | null;
		const totalInput = form.querySelector('[data-org-course-package-total]') as HTMLInputElement | null;
		const usedInput = form.querySelector('[data-org-course-package-used]') as HTMLInputElement | null;
		const studentId = studentInput?.value || '';
		if (!studentId) {
			setFieldError(studentInput, '请选择学员');
			return;
		}
		const totalLessons = Math.max(0, Math.floor(Number(totalInput?.value || '0')));
		const usedLessons = Math.max(0, Math.floor(Number(usedInput?.value || '0')));
		if (totalLessons <= 0) {
			setFieldError(totalInput, '课程包总课时必须大于 0');
			return;
		}
		if (usedLessons > totalLessons) { setFieldError(usedInput, '已用课时不能大于总课时'); return; }
		const finishSubmitting = beginOrganizationFormSubmission(form);
		if (!finishSubmitting) return;
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
			setFieldError(studentInput, readErrorMessage(error, '课程包保存失败'));
			log('save organization course package failed', organization.id, error);
			showToast(readErrorMessage(error, '课程包保存失败'));
		} finally { finishSubmitting(); }
	}

	async function saveOrganizationLearningGroupEnrollment(organization: ManagedOrganization, form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.saveLearningGroupEnrollment !== 'function') {
			showToast('学习组成员接口暂不可用');
			return;
		}
		const groupInput = form.querySelector('[data-org-enrollment-group]') as HTMLSelectElement | null;
		const userInput = form.querySelector('[data-org-enrollment-user]') as HTMLSelectElement | null;
		const learningGroupId = groupInput?.value || '';
		const userId = userInput?.value || '';
		if (!learningGroupId || !userId) {
			setFieldError(!learningGroupId ? groupInput : userInput, !learningGroupId ? '请选择学习组' : '请选择成员');
			return;
		}
		const finishSubmitting = beginOrganizationFormSubmission(form);
		if (!finishSubmitting) return;
		try {
			await api.saveLearningGroupEnrollment(organization.id, learningGroupId, token, {
				user_id: userId,
				role: (form.querySelector('[data-org-enrollment-role]') as HTMLSelectElement | null)?.value || 'student',
				status: (form.querySelector('[data-org-enrollment-status]') as HTMLSelectElement | null)?.value || 'active'
			});
			await refreshManagedOrganizations();
			showToast('学习组成员已保存');
		} catch (error) {
			setFieldError(userInput, readErrorMessage(error, '学习组成员保存失败'));
			log('save learning group enrollment failed', organization.id, learningGroupId, userId, error);
			showToast(readErrorMessage(error, '学习组成员保存失败'));
		} finally { finishSubmitting(); }
	}

	async function completeOrganizationLearningGroup(organization: ManagedOrganization, learningGroup: ManagedLearningGroup, button?: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.completeOrganizationLearningGroup !== 'function') {
			showToast('完成学习组接口暂不可用');
			return;
		}
		const finishAction = beginOrganizationAction(button, '处理中...');
		if (!finishAction) return;
		const label = learningGroup.type === 'booking' && learningGroup.coursePackageId
			? `确认完成 ${learningGroup.name} 并扣减 1 次课程包课时吗？`
			: `确认将 ${learningGroup.name} 标记为已完成吗？`;
		if (!await requestConfirmation(label)) {
			finishAction();
			return;
		}
		try {
			const note = await requestTextInput('课后备注（可留空）', '', { multiline: true });
			if (note === null) return;
			await api.completeOrganizationLearningGroup(organization.id, learningGroup.id, token, { note });
			await refreshManagedOrganizations();
			showToast(learningGroup.type === 'booking' && learningGroup.coursePackageId ? '已完成约课并扣减课时' : '学习组已完成');
		} catch (error) {
			log('complete learning group failed', organization.id, learningGroup.id, error);
			showToast(readErrorMessage(error, '学习组完成失败'));
		} finally { finishAction(); }
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

	async function claimReferralCode(referralCode: string, form?: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (form) clearFormFieldErrors(form);
		const input = form?.querySelector('[data-referral-code]') as HTMLInputElement | null;
		if (!token || !api || typeof api.claimReferralCode !== 'function') {
			showToast('推荐码绑定接口暂不可用');
			return;
		}
		const normalizedCode = referralCode.trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
		if (!normalizedCode) {
			setFieldError(input, '请输入推荐码');
			return;
		}
		const finishSubmitting = beginOrganizationAction(form?.querySelector('button[type="submit"]') as HTMLButtonElement | undefined, '绑定中…');
		if (!finishSubmitting) return;
		try {
			await api.claimReferralCode(token, normalizedCode);
			referralCodeDraft = '';
			await refreshCurrentContextFromApi();
			renderSectionContent();
			showToast('推荐码已绑定');
		} catch (error) {
			log('claim referral code failed', error);
			const message = readErrorMessage(error, '推荐码绑定失败');
			setFieldError(input, message);
			showToast(message);
		} finally { finishSubmitting(); }
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

		if (managedOrganizationsCacheKey === cacheKey) {
			if (managedOrganizationsLoading) {
				await managedOrganizationsLoading;
			}
			return;
		}

		managedOrganizationsCacheKey = cacheKey;
		managedOrganizationsLoading = (async () => {
			try {
				const response = asRecord(await api.getOrganizations(token, {
					summary: 1,
					page: managedOrganizationListPage.page,
					page_size: managedOrganizationListPage.pageSize,
					q: managedOrganizationListPage.query
				})) || {};
				const organizationValues = Array.isArray(response.items) ? response.items : [];
				managedOrganizationListPage.total = readCount(response.total) ?? organizationValues.length;
				managedOrganizationListPage.pages = readCount(response.pages) ?? (organizationValues.length ? 1 : 0);
				managedOrganizationListPage.page = readCount(response.page) ?? managedOrganizationListPage.page;
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
						auditLogs,
						rolePermissions: normalizeOrganizationRolePermissions(organization.role_permissions || organization.rolePermissions)
					});
				}
				managedOrganizations = nextOrganizations;
			} catch (error) {
				managedOrganizations = [];
				log('load managed organizations failed', error);
			} finally {
				managedOrganizationsLoading = null;
				const institutionWorkbenchBusy = document.querySelector(
					'#pc-institution-workbench[data-inst-user-interacted="true"]'
				);
				const roleContentFormBusy = hasActiveRoleContentFormEdit();
				if (activeSection === 'admin-hub' && isOpen() && !institutionWorkbenchBusy && !roleContentFormBusy) {
					renderSectionContent();
				}
				if (!roleContentFormBusy && shouldRefreshRoleContent('platform-orgs', 'platform-roles', 'org-members', 'org-permissions', 'org-groups', 'org-settings', 'org-course-packages', 'org-seats', 'org-plan', 'org-invites', 'org-audit')) {
					renderSectionContent({ preserveScroll: true });
				}
			}
		})();

		await managedOrganizationsLoading;
	}

	async function loadManagedOrganizationDetails(organizationId: string): Promise<void> {
		if (managedOrganizationDetailState[organizationId] === 'loading') return;
		if (managedOrganizationDetailState[organizationId] === 'loaded') {
			// The collapsed summary deliberately omits detail DOM. Re-render when
			// reopening cached data so the selected management panel is inserted.
			renderSectionContent({ preserveScroll: true });
			return;
		}
		const organization = managedOrganizations.find((item) => item.id === organizationId);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!organization || !token || !api) return;
		managedOrganizationDetailState[organizationId] = 'loading';
		renderSectionContent({ preserveScroll: true });
		try {
			const [rawDetail, rawMembers, rawCampuses, rawGroups, rawPackages] = await Promise.all([
				api.getOrganization(organizationId, token),
				api.getOrganizationMembers(organizationId, token),
				api.getOrganizationCampuses(organizationId, token),
				api.getOrganizationLearningGroups(organizationId, token),
				api.getOrganizationCoursePackages(organizationId, token)
			]);
			const detail = asRecord(rawDetail) || {};
			const subscription = normalizeSubscription(detail.subscription);
			organization.name = readString(detail.name) || organization.name;
			organization.organizationType = readString(detail.organization_type) || organization.organizationType;
			organization.seats = readCount(detail.seats) ?? subscription?.seats ?? organization.seats;
			organization.plan = readString(detail.plan) || subscription?.plan || organization.plan;
			organization.status = readString(detail.status) || subscription?.status || organization.status;
			organization.expiresAt = readString(detail.expires_at) || subscription?.expiresAt || organization.expiresAt;
			organization.members = (Array.isArray(rawMembers) ? rawMembers : []).flatMap((value) => {
				const member = asRecord(value);
				if (!member) return [];
				const roles = readStringArray(member.roles) || [];
				return [{
					userId: readString(member.user_id) || '', username: readString(member.username) || readString(member.user_id) || '未命名成员',
					memberNo: readString(member.member_no) || readString(member.student_no) || readString(member.employee_no), roles,
					permissionTemplates: normalizePermissionTemplates(member.permission_templates || member.permissionTemplates, roles),
					permissionOverrides: normalizeOrganizationPermissionOverrides(member.permission_overrides || member.permissionOverrides),
					status: readString(member.status) || 'active'
				}];
			});
			organization.memberCount = organization.memberCount || organization.members.length;
			organization.campuses = (Array.isArray(rawCampuses) ? rawCampuses : []).map(normalizeManagedCampus).filter((item): item is ManagedCampus => Boolean(item));
			organization.learningGroups = (Array.isArray(rawGroups) ? rawGroups : []).map(normalizeManagedLearningGroup).filter((item): item is ManagedLearningGroup => Boolean(item));
			organization.coursePackages = (Array.isArray(rawPackages) ? rawPackages : []).map(normalizeManagedCoursePackage).filter((item): item is ManagedCoursePackage => Boolean(item));
			organization.invitations = (Array.isArray(detail.invitations) ? detail.invitations : []).flatMap((value) => {
				const invitation = asRecord(value); if (!invitation) return [];
				const roles = readStringArray(invitation.roles) || ['student'];
				return [{ invitationId: readString(invitation.invitation_id) || '', inviteToken: readString(invitation.invite_token) || readString(invitation.invite_code) || '',
					channel: (readString(invitation.channel) || 'email') as 'email' | 'phone', contact: readString(invitation.contact) || readString(invitation.email) || readString(invitation.phone) || '-',
					status: readString(invitation.status) || 'pending', roles, permissionTemplates: normalizePermissionTemplates(invitation.permission_templates || invitation.permissionTemplates, roles),
					permissionOverrides: normalizeOrganizationPermissionOverrides(invitation.permission_overrides || invitation.permissionOverrides), memberNo: readString(invitation.member_no),
					message: readString(invitation.message) || '', deliveryStatus: readString(invitation.delivery_status), deliveryProvider: readString(invitation.delivery_provider),
					deliveryMessageId: readString(invitation.delivery_message_id), deliveryError: readString(invitation.delivery_error), deliveredAt: readString(invitation.delivered_at),
					createdAt: readString(invitation.created_at) || '', expiresAt: readString(invitation.expires_at) || '' }];
			});
			organization.auditLogs = (Array.isArray(detail.audit_logs) ? detail.audit_logs : []).flatMap((value) => {
				const audit = asRecord(value); if (!audit) return [];
				return [{ auditId: readString(audit.audit_id) || '', action: readString(audit.action) || '', summary: readString(audit.summary) || '组织操作',
					actorUsername: readString(audit.actor_username) || readString(audit.actor_user_id) || '系统', createdAt: readString(audit.created_at) || '', detailText: auditDetailSummary(audit.details) }];
			});
			organization.rolePermissions = normalizeOrganizationRolePermissions(detail.role_permissions || detail.rolePermissions);
			managedOrganizationDetailState[organizationId] = 'loaded';
		} catch (error) {
			managedOrganizationDetailState[organizationId] = 'error';
			log('load organization details failed', organizationId, error);
			showToast(readErrorMessage(error, '机构详情加载失败'));
		} finally {
			renderSectionContent({ preserveScroll: true });
		}
	}

	async function reloadManagedOrganizationList(): Promise<void> {
		managedOrganizations = [];
		managedOrganizationsCacheKey = '';
		managedOrganizationsLoading = null;
		managedOrganizationOpenState = {};
		managedOrganizationDetailState = {};
		renderSectionContent({ preserveScroll: true });
		await ensureManagedOrganizations(getContext());
	}

	function renderOrganizationSubscriptionPanel(organization: ManagedOrganization): string {
		const expiryInput = organization.expiresAt ? organization.expiresAt.slice(0, 10) : '';
		const upgradeNote = hasAnyRole(getContext(), ['superAdmin'])
			? '升级或扩席应优先从平台支付管理创建机构订单；直接修改会写入审计日志。'
			: '升级、续期或扩席必须通过支付订单完成；此处仅允许降级、停用或减少未使用席位。';
		const subscriptionEditor = `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>套餐与席位</h4><span>${escapeHtml(subscriptionExpirySummary(organization.expiresAt, organization.status))}</span></div><form class="pc-org-add-form" data-org-subscription-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>套餐</span><select class="pc-profile-input pc-org-select" data-org-plan><option value="free"${organization.plan === 'free' ? ' selected' : ''}>FREE</option><option value="pro"${organization.plan === 'pro' ? ' selected' : ''}>PRO</option><option value="ultra"${organization.plan === 'ultra' ? ' selected' : ''}>ULTRA</option></select></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-status><option value="active"${organization.status === 'active' ? ' selected' : ''}>active</option><option value="trial"${organization.status === 'trial' ? ' selected' : ''}>trial</option><option value="expired"${organization.status === 'expired' ? ' selected' : ''}>expired</option><option value="canceled"${organization.status === 'canceled' ? ' selected' : ''}>canceled</option></select></label><label class="pc-org-field"><span>席位数</span><input class="pc-profile-input" type="number" min="1" step="1" data-org-seats value="${escapeHtml(String(organization.seats || defaultSeatsForPlan(organization.plan)))}" /></label></div><div class="pc-org-form-grid"><label class="pc-org-field"><span>到期日期</span><input class="pc-profile-input" type="date" data-org-expires-at value="${escapeHtml(expiryInput)}" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存套餐</button></div></div><div class="pc-admin-note">当前成员 ${escapeHtml(String(organization.memberCount))} 人，建议席位不低于成员数。${escapeHtml(upgradeNote)}</div></form></div>`;
		return `${subscriptionEditor}${renderAutoRenewalCard('organization', organization.id, {
			plan: organization.plan,
			status: organization.status,
			expiresAt: organization.expiresAt || '',
			seats: organization.seats
		})}`;
	}

	function organizationMemberLabelById(organization: ManagedOrganization, userId: string): string {
		const member = organization.members.find((item) => item.userId === userId);
		if (member) {
			return organizationMemberDisplayName(member);
		}
		return allUsers.find((user) => user.id === userId)?.displayName || userId;
	}

	function renderOrganizationCampusPanel(organization: ManagedOrganization): string {
		const usePagedList = activeDashboardSubpage === 'role-content';
		const pageState = organizationCampusPageState(organization.id);
		if (usePagedList && !pageState.loaded && !pageState.loading) void loadOrganizationCampusPage(organization.id);
		const visibleCampuses = usePagedList && pageState.loaded ? pageState.items : organization.campuses;
		const campusList = visibleCampuses.length
			? visibleCampuses
					.map((campus) => `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(campus.name)}</strong><span>${escapeHtml(campus.status)} · ${escapeHtml(campus.id)}</span></div></div>${campus.address ? `<div class="pc-admin-note">${escapeHtml(campus.address)}</div>` : ''}</div>`)
					.join('')
			: '<div class="pc-org-empty">还没有校区。小机构可以只建一个“默认校区”，多校区机构可按校区分配权限范围。<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-empty-focus="campus">填写第一个校区</button></div></div>';
		const controls = `<form class="pc-org-add-form" data-org-campus-list-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>搜索校区</span><input class="pc-profile-input" data-org-campus-list-query value="${escapeHtml(pageState.query)}" placeholder="名称、地址或校区 ID" /></label><label class="pc-org-field"><span>排序</span><select class="pc-profile-input pc-org-select" data-org-campus-list-sort><option value="name"${pageState.sort === 'name' ? ' selected' : ''}>名称</option><option value="status"${pageState.sort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序 / 每页</span><span><select class="pc-profile-input pc-org-select" data-org-campus-list-order><option value="asc"${pageState.order === 'asc' ? ' selected' : ''}>升序</option><option value="desc"${pageState.order === 'desc' ? ' selected' : ''}>降序</option></select><select class="pc-profile-input pc-org-select" data-org-campus-list-page-size><option value="10"${pageState.pageSize === 10 ? ' selected' : ''}>10 条</option><option value="20"${pageState.pageSize === 20 ? ' selected' : ''}>20 条</option><option value="50"${pageState.pageSize === 50 ? ' selected' : ''}>50 条</option></select></span></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button><button class="pc-inline-ghost" type="button" data-org-campus-list-page="prev"${pageState.page <= 1 || pageState.loading ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">${pageState.loading ? '加载中' : `第 ${pageState.page} / ${Math.max(1, pageState.pages)} 页`}</span><button class="pc-inline-ghost" type="button" data-org-campus-list-page="next"${pageState.page >= pageState.pages || pageState.loading ? ' disabled' : ''}>下一页</button></div></form>`;
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>校区管理</h4><span>${escapeHtml(String(usePagedList && pageState.loaded ? pageState.total : organization.campuses.length))} 个校区</span></div><form class="pc-org-add-form" data-org-campus-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>校区ID（更新时填写）</span><input class="pc-profile-input" data-org-campus-id placeholder="留空新建" /></label><label class="pc-org-field"><span>校区名称</span><input class="pc-profile-input" data-org-campus-name placeholder="东京校区" /></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-campus-status><option value="active">active</option><option value="disabled">disabled</option></select></label></div><div class="pc-org-form-grid"><label class="pc-org-field pc-org-field-wide"><span>地址/备注</span><input class="pc-profile-input" data-org-campus-address placeholder="校区地址或内部备注" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存校区</button></div></div></form>${usePagedList ? controls : ''}<div class="pc-org-invite-list">${campusList}</div></div>`;
	}

	function renderOrganizationCoursePackagePanel(organization: ManagedOrganization): string {
		const usePagedList = activeDashboardSubpage === 'role-content';
		const pageState = organizationCoursePackagePageState(organization.id);
		if (usePagedList && !pageState.loaded && !pageState.loading) void loadOrganizationCoursePackagePage(organization.id);
		const studentMembers = organization.members.filter((member) => member.roles.includes('student'));
		const studentOptions = studentMembers.length
			? studentMembers.map((member) => `<option value="${escapeHtml(member.userId)}">${escapeHtml(organizationMemberDisplayName(member))}</option>`).join('')
			: '<option value="">请先添加学员成员</option>';
		const visiblePackages = usePagedList && pageState.loaded ? pageState.items : organization.coursePackages;
		const packageList = visiblePackages.length
			? visiblePackages
					.map((item) => `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(item.title || item.subject || item.id)}</strong><span>${escapeHtml(organizationMemberLabelById(organization, item.studentId))} · ${escapeHtml(item.status)}</span></div><span>${escapeHtml(String(item.remainingLessons))}/${escapeHtml(String(item.totalLessons))} 次</span></div><div class="pc-org-invite-meta"><span>ID：${escapeHtml(item.id)}</span><span>科目：${escapeHtml(item.subject || '-')}</span><span>已用：${escapeHtml(String(item.usedLessons))}</span>${item.expiresAt ? `<span>到期：${escapeHtml(item.expiresAt)}</span>` : ''}</div></div>`)
					.join('')
			: `<div class="pc-org-empty">还没有课程包。课程包只绑定学员和科目，不绑定固定老师。<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-empty-focus="course-package"${studentMembers.length ? '' : ' disabled'}>${studentMembers.length ? '创建第一个课程包' : '请先添加学员'}</button></div></div>`;
		const controls = `<form class="pc-org-add-form" data-org-package-list-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>搜索课程包</span><input class="pc-profile-input" data-org-package-list-query value="${escapeHtml(pageState.query)}" placeholder="标题、科目、学员或 ID" /></label><label class="pc-org-field"><span>排序</span><select class="pc-profile-input pc-org-select" data-org-package-list-sort><option value="expires_at"${pageState.sort === 'expires_at' ? ' selected' : ''}>到期时间</option><option value="remaining_lessons"${pageState.sort === 'remaining_lessons' ? ' selected' : ''}>剩余课时</option><option value="title"${pageState.sort === 'title' ? ' selected' : ''}>标题</option><option value="status"${pageState.sort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序 / 每页</span><span><select class="pc-profile-input pc-org-select" data-org-package-list-order><option value="asc"${pageState.order === 'asc' ? ' selected' : ''}>升序</option><option value="desc"${pageState.order === 'desc' ? ' selected' : ''}>降序</option></select><select class="pc-profile-input pc-org-select" data-org-package-list-page-size><option value="10"${pageState.pageSize === 10 ? ' selected' : ''}>10 条</option><option value="20"${pageState.pageSize === 20 ? ' selected' : ''}>20 条</option><option value="50"${pageState.pageSize === 50 ? ' selected' : ''}>50 条</option></select></span></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button><button class="pc-inline-ghost" type="button" data-org-package-list-page="prev"${pageState.page <= 1 || pageState.loading ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">${pageState.loading ? '加载中' : `第 ${pageState.page} / ${Math.max(1, pageState.pages)} 页`}</span><button class="pc-inline-ghost" type="button" data-org-package-list-page="next"${pageState.page >= pageState.pages || pageState.loading ? ' disabled' : ''}>下一页</button></div></form>`;
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>课程包</h4><span>${escapeHtml(String(usePagedList && pageState.loaded ? pageState.total : organization.coursePackages.length))} 个</span></div><form class="pc-org-add-form" data-org-course-package-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>课程包ID（更新时填写）</span><input class="pc-profile-input" data-org-course-package-id placeholder="留空新建" /></label><label class="pc-org-field"><span>学员</span><select class="pc-profile-input pc-org-select" data-org-course-package-student>${studentOptions}</select></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-course-package-status><option value="active">active</option><option value="paused">paused</option><option value="expired">expired</option><option value="finished">finished</option></select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>标题</span><input class="pc-profile-input" data-org-course-package-title placeholder="文综约课 20 次" /></label><label class="pc-org-field"><span>科目</span><input class="pc-profile-input" data-org-course-package-subject placeholder="japanese / sogo / writing" /></label><label class="pc-org-field"><span>到期时间</span><input class="pc-profile-input" type="date" data-org-course-package-expires /></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>总课时</span><input class="pc-profile-input" type="number" min="1" step="1" data-org-course-package-total value="20" /></label><label class="pc-org-field"><span>已用课时</span><input class="pc-profile-input" type="number" min="0" step="1" data-org-course-package-used value="0" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存课程包</button></div></div></form>${usePagedList ? controls : ''}<div class="pc-org-invite-list">${packageList}</div></div>`;
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
		const packageOptions = `<option value="">不绑定课程包</option>${organization.coursePackages.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.subject || item.id)} · ${escapeHtml(organizationMemberLabelById(organization, item.studentId))}</option>`).join('')}`;
		const campusIds = new Set(organization.campuses.map((campus) => campus.id));
		const selectedCampusFilter = (() => {
			const value = organizationLearningGroupCampusFilters[organization.id] || '';
			if (value === '__none__' || !value || campusIds.has(value)) {
				return value;
			}
			organizationLearningGroupCampusFilters[organization.id] = '';
			return '';
		})();
		const campusFilterOptions = [
			`<option value=""${selectedCampusFilter ? '' : ' selected'}>全部校区（${escapeHtml(String(organization.learningGroups.length))}）</option>`,
			`<option value="__none__"${selectedCampusFilter === '__none__' ? ' selected' : ''}>未指定校区（${escapeHtml(String(organization.learningGroups.filter((group) => !group.campusId).length))}）</option>`,
			...organization.campuses.map((campus) => {
				const count = organization.learningGroups.filter((group) => group.campusId === campus.id).length;
				return `<option value="${escapeHtml(campus.id)}"${selectedCampusFilter === campus.id ? ' selected' : ''}>${escapeHtml(campus.name)}（${escapeHtml(String(count))}）</option>`;
			})
		].join('');
		const allFilteredGroups = selectedCampusFilter === '__none__'
			? organization.learningGroups.filter((group) => !group.campusId)
			: selectedCampusFilter
				? organization.learningGroups.filter((group) => group.campusId === selectedCampusFilter)
				: organization.learningGroups;
		const usePagedList = activeDashboardSubpage === 'role-content';
		const pageState = organizationLearningGroupPageState(organization.id);
		if (usePagedList && pageState.filter !== selectedCampusFilter) {
			pageState.filter = selectedCampusFilter;
			pageState.page = 1;
			pageState.loaded = false;
		}
		if (usePagedList && !pageState.loaded && !pageState.loading) void loadOrganizationLearningGroupPage(organization.id);
		const filteredGroups = usePagedList && pageState.loaded ? pageState.items : allFilteredGroups;
		const filterLabel = selectedCampusFilter === '__none__'
			? '未指定校区'
			: selectedCampusFilter
				? organization.campuses.find((campus) => campus.id === selectedCampusFilter)?.name || '所选校区'
				: '全部校区';
		const campusOptions = `<option value=""${selectedCampusFilter === '__none__' || !selectedCampusFilter ? ' selected' : ''}>不指定校区</option>${organization.campuses.map((campus) => `<option value="${escapeHtml(campus.id)}"${selectedCampusFilter === campus.id ? ' selected' : ''}>${escapeHtml(campus.name)}</option>`).join('')}`;
		const groupOptions = allFilteredGroups.length
			? allFilteredGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('')
			: organization.learningGroups.length
				? '<option value="">当前校区暂无学习组</option>'
				: '<option value="">请先创建学习组</option>';
		const memberOptions = organization.members.length
			? organization.members.map((member) => `<option value="${escapeHtml(member.userId)}">${escapeHtml(organizationMemberDisplayName(member))}</option>`).join('')
			: '<option value="">请先添加成员</option>';
		const groupList = filteredGroups.length
			? filteredGroups
					.map((group) => {
						const campus = organization.campuses.find((item) => item.id === group.campusId);
						const enrollments = group.enrollments.length
							? group.enrollments.map((enrollment) => `${organizationMemberLabelById(organization, enrollment.userId)}(${enrollment.role})`).join(' / ')
							: '暂无成员';
						return `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.type === 'booking' ? '约课' : '班级')} · ${escapeHtml(group.status)} · ${escapeHtml(group.id)}</span></div><div class="pc-org-form-actions">${renderLearningGroupCompleteButton(organization, group)}</div></div><div class="pc-org-invite-meta"><span>科目：${escapeHtml(group.subject || '-')}</span><span>校区：${escapeHtml(campus?.name || '未指定')}</span><span>成员：${escapeHtml(enrollments)}</span>${group.coursePackageId ? `<span>课程包：${escapeHtml(group.coursePackageId)}</span>` : ''}${group.startsAt ? `<span>开始：${escapeHtml(group.startsAt)}</span>` : ''}</div></div>`;
					})
					.join('')
			: usePagedList && pageState.error
				? `<div class="pc-org-empty">${escapeHtml(pageState.error)}<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-learning-list-retry>重新加载</button></div></div>`
				: organization.learningGroups.length
				? `<div class="pc-org-empty">当前筛选下没有学习组。可以切换校区，或新建学习组时选择 ${escapeHtml(filterLabel)}。<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-empty-focus="learning-group">在当前校区新建</button></div></div>`
				: '<div class="pc-org-empty">还没有学习组。先用上方表单创建学习组并选择校区；有学习组后，这里的校区过滤会只显示对应校区的班级、小班或一对一约课。<div class="pc-org-form-actions"><button class="pc-inline-btn" type="button" data-org-empty-focus="learning-group">创建第一个学习组</button></div></div>';
		const listControls = `<form class="pc-org-add-form" data-org-learning-list-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>搜索学习组</span><input class="pc-profile-input" data-org-learning-list-query value="${escapeHtml(pageState.query)}" placeholder="名称、科目或学习组 ID" /></label><label class="pc-org-field"><span>排序</span><select class="pc-profile-input pc-org-select" data-org-learning-list-sort><option value="starts_at"${pageState.sort === 'starts_at' ? ' selected' : ''}>开始时间</option><option value="name"${pageState.sort === 'name' ? ' selected' : ''}>名称</option><option value="status"${pageState.sort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序 / 每页</span><span><select class="pc-profile-input pc-org-select" data-org-learning-list-order><option value="asc"${pageState.order === 'asc' ? ' selected' : ''}>升序</option><option value="desc"${pageState.order === 'desc' ? ' selected' : ''}>降序</option></select><select class="pc-profile-input pc-org-select" data-org-learning-list-page-size><option value="10"${pageState.pageSize === 10 ? ' selected' : ''}>10 条</option><option value="20"${pageState.pageSize === 20 ? ' selected' : ''}>20 条</option><option value="50"${pageState.pageSize === 50 ? ' selected' : ''}>50 条</option></select></span></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button><button class="pc-inline-ghost" type="button" data-org-learning-list-page="prev"${pageState.page <= 1 || pageState.loading ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">${pageState.loading ? '加载中' : `第 ${pageState.page} / ${Math.max(1, pageState.pages)} 页`}</span><button class="pc-inline-ghost" type="button" data-org-learning-list-page="next"${pageState.page >= pageState.pages || pageState.loading ? ' disabled' : ''}>下一页</button></div></form>`;
		return `<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>学习组</h4><span>${escapeHtml(filterLabel)} · ${escapeHtml(String(usePagedList && pageState.loaded ? pageState.total : allFilteredGroups.length))}/${escapeHtml(String(organization.learningGroups.length))} 个</span></div><div class="pc-org-filter-bar"><label class="pc-org-field"><span>按校区查看</span><select class="pc-profile-input pc-org-select" data-org-learning-campus-filter data-org-id="${escapeHtml(organization.id)}">${campusFilterOptions}</select></label><div class="pc-admin-note">列表和“学习组成员”下拉会跟随校区过滤，校区多、学习组多时先选校区再管理。</div></div><form class="pc-org-add-form" data-org-learning-group-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>学习组ID（更新时填写）</span><input class="pc-profile-input" data-org-learning-group-id placeholder="留空新建" /></label><label class="pc-org-field"><span>名称</span><input class="pc-profile-input" data-org-learning-group-name placeholder="EJU 日语基础班 / 文综一对一" /></label><label class="pc-org-field"><span>类型</span><select class="pc-profile-input pc-org-select" data-org-learning-group-type><option value="class">班级 / 小班</option><option value="booking">约课课次</option></select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>科目</span><input class="pc-profile-input" data-org-learning-group-subject placeholder="japanese / sogo / writing" /></label><label class="pc-org-field"><span>校区</span><select class="pc-profile-input pc-org-select" data-org-learning-group-campus>${campusOptions}</select></label><label class="pc-org-field"><span>课程包</span><select class="pc-profile-input pc-org-select" data-org-learning-group-package>${packageOptions}</select></label></div><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>开始时间</span><input class="pc-profile-input" type="datetime-local" data-org-learning-group-starts /></label><label class="pc-org-field"><span>结束时间</span><input class="pc-profile-input" type="datetime-local" data-org-learning-group-ends /></label><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-learning-group-status><option value="active">active</option><option value="scheduled">scheduled</option><option value="finished">finished</option><option value="canceled">canceled</option><option value="archived">archived</option></select></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存学习组</button></div></form><form class="pc-org-add-form" data-org-learning-enrollment-form data-org-id="${escapeHtml(organization.id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>学习组</span><select class="pc-profile-input pc-org-select" data-org-enrollment-group>${groupOptions}</select></label><label class="pc-org-field"><span>成员</span><select class="pc-profile-input pc-org-select" data-org-enrollment-user>${memberOptions}</select></label><label class="pc-org-field"><span>身份</span><select class="pc-profile-input pc-org-select" data-org-enrollment-role><option value="student">学生</option><option value="teacher">老师</option><option value="assistant">助教/教务</option></select></label></div><div class="pc-org-form-grid"><label class="pc-org-field"><span>状态</span><select class="pc-profile-input pc-org-select" data-org-enrollment-status><option value="active">active</option><option value="inactive">inactive</option></select></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit"${allFilteredGroups.length ? '' : ' disabled'}>保存学习组成员</button></div></div></form>${usePagedList ? listControls : ''}<div class="pc-org-invite-list">${groupList}</div></div>`;
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

	function renderOrganizationManagerPanel(organization: ManagedOrganization): string {
		const draft = getOrganizationMemberDraft(organization.id);
		const seatFull = isOrganizationSeatFull(organization);
		const selectedUser = draft.searchResults.find((user) => user.id === draft.selectedUserId);
		const defaultRoles = ['orgAdmin'];
		const allowedRoleIds = ['assistant', 'orgAdmin'];
		const managerInvitations = organization.invitations.filter((item) => (item.roles.includes('orgAdmin') || item.roles.includes('assistant')) && item.status === 'pending');
		const pendingCount = managerInvitations.length;
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
		const invitationMarkup = managerInvitations.length
			? managerInvitations
					.slice(0, 6)
					.map((invitation) => {
						const rolesText = roleLabels(invitation.roles).join(' / ') || invitation.roles.join(' / ') || '管理人员';
						const canCancel = invitation.status === 'pending';
						const deliveryStatus = invitation.deliveryStatus || 'queued';
						const deliverySummary =
							deliveryStatus === 'sent' || deliveryStatus === 'delivered'
								? `投递成功${invitation.deliveryProvider ? ` · ${invitation.deliveryProvider}` : ''}${invitation.deliveredAt ? ` · ${formatDateTime(invitation.deliveredAt)}` : ''}`
								: deliveryStatus === 'failed'
									? `投递失败${invitation.deliveryError ? ` · ${invitation.deliveryError}` : ''}`
									: `投递中${invitation.deliveryProvider ? ` · ${invitation.deliveryProvider}` : ''}`;
						return `<div class="pc-org-invite-item"><div class="pc-org-invite-head"><div><strong>${escapeHtml(invitation.contact)}</strong><span>${escapeHtml(invitationStatusLabel(invitation.status))} · ${escapeHtml(invitation.channel === 'email' ? '邮箱邀请' : '手机号邀请')}</span></div>${canCancel ? `<button class="pc-inline-danger" type="button" data-org-invitation-cancel data-org-id="${escapeHtml(organization.id)}" data-invitation-id="${escapeHtml(invitation.invitationId)}" data-invitation-contact="${escapeHtml(invitation.contact)}">取消</button>` : ''}</div><div class="pc-org-invite-meta"><span>角色：${escapeHtml(rolesText)}</span><span>到期：${escapeHtml(formatDateTime(invitation.expiresAt))}</span></div><div class="pc-admin-note">${escapeHtml(deliverySummary)}</div>${invitation.message ? `<div class="pc-admin-note">备注：${escapeHtml(invitation.message)}</div>` : ''}</div>`;
					})
					.join('')
			: '<div class="pc-org-empty">暂无待处理的管理人员邀请。</div>';
		const selectedText = selectedUser
			? `已选择 ${escapeHtml(selectedUser.displayName)}，提交后会加入当前组织。`
			: '先搜索并选择一个账号，再点击添加。';
		return `<div class="pc-org-subsection pc-org-manager-config-section">
			<div class="pc-org-subsection-head"><h4>管理人员配置</h4><span>${escapeHtml(organizationSeatSummary(organization))} · ${escapeHtml(String(pendingCount))} 个邀请待接受</span></div>
			<div class="pc-admin-note">先查找平台账号，找到后直接添加为机构管理员或教学运营。只有查不到账号时，再发送邀请。</div>
			${seatFull ? `<div class="pc-org-capacity is-full">${escapeHtml(organizationSeatSummary(organization))} 请先移除成员或升级席位。</div>` : ''}
			<form class="pc-org-add-form pc-org-manager-flow" data-org-add-form data-org-id="${escapeHtml(organization.id)}" data-org-add-mode="manager">
				<div class="pc-org-manager-step">
					<div class="pc-org-manager-step-head"><span>1</span><strong>查找账号</strong></div>
					<label class="pc-org-field pc-org-field-wide">
						<span>账号 / 昵称 / 邮箱</span>
						<div class="pc-org-search-row"><input class="pc-profile-input" type="text" data-org-search-query value="${escapeHtml(draft.searchQuery)}" placeholder="输入账号 / 昵称 / 邮箱" /><button class="pc-inline-ghost" type="button" data-org-search>搜索</button></div>
					</label>
					${resultsMarkup}
				</div>
				<div class="pc-org-manager-step">
					<div class="pc-org-manager-step-head"><span>2</span><strong>设置角色</strong></div>
					<div class="pc-org-manager-action-row">
						<div class="pc-role-toggle-group">${renderOrganizationRoleControls(defaultRoles, `org-manager-add-${organization.id}`, allowedRoleIds)}</div>
						<div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit"${seatFull || !selectedUser ? ' disabled' : ''}>添加</button></div>
					</div>
					<div class="pc-admin-note">${selectedText}</div>
				</div>
			</form>
			<details class="pc-org-manager-invite-drawer">
				<summary><span>找不到账号？发送邀请</span><em>对方接受并验证后自动加入机构</em></summary>
				<form class="pc-org-add-form pc-org-manager-add-form" data-org-invite-form data-org-id="${escapeHtml(organization.id)}" data-org-add-mode="manager">
					<div class="pc-org-form-grid pc-org-form-grid-manager">
						<label class="pc-org-field pc-org-field-wide"><span>邮箱或手机号</span><input class="pc-profile-input" type="text" data-org-invite-contact value="${escapeHtml(draft.inviteContact)}" placeholder="name@example.com / 13800138000" /></label>
					</div>
					<div class="pc-org-manager-action-row">
						<div class="pc-role-toggle-group">${renderOrganizationRoleControls(defaultRoles, `org-manager-invite-${organization.id}`, allowedRoleIds)}</div>
						<div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit"${seatFull ? ' disabled' : ''}>创建邀请</button></div>
					</div>
				</form>
			</details>
			<details class="pc-org-manager-invite-drawer"${managerInvitations.length ? ' open' : ''}>
				<summary><span>待处理邀请</span><em>${escapeHtml(String(managerInvitations.length))} 条记录</em></summary>
				<div class="pc-org-invite-list">${invitationMarkup}</div>
			</details>
		</div>`;
	}

	function renderOrganizationAddForm(organization: ManagedOrganization, mode: 'member' | 'manager' = 'member', options: { embedded?: boolean } = {}): string {
		const draft = getOrganizationMemberDraft(organization.id);
		const seatFull = isOrganizationSeatFull(organization);
		const selectedUser = draft.searchResults.find((user) => user.id === draft.selectedUserId);
		const inviteContact = draft.searchQuery.trim();
		const canInviteFromInput = looksLikeOrganizationInviteContact(inviteContact);
		const isManagerMode = mode === 'manager';
		const activeMemberRole = activeOrganizationMemberRoleId(organization);
		const activeMemberRoleName = roleLabels([activeMemberRole])[0] || '成员';
		const defaultRoles = isManagerMode ? ['orgAdmin'] : [activeMemberRole];
		const allowedRoleIds = isManagerMode ? ['assistant', 'orgAdmin'] : undefined;
		const heading = isManagerMode ? '添加管理人员' : `添加 / 邀请${activeMemberRoleName}`;
		const selectedText = selectedUser
			? `已选择 ${escapeHtml(selectedUser.displayName)}`
			: canInviteFromInput
				? `将向 ${escapeHtml(inviteContact)} 发送邀请`
				: draft.searchQuery.trim()
					? '未找到账号，请输入完整手机号或邮箱创建邀请'
					: '搜索已有账号，或输入完整手机号/邮箱邀请新用户';
		const submitText = '添加/邀请';
		const memberInvitations = organization.invitations.filter((item) => item.status === 'pending' && (item.roles.includes('orgAdmin') || item.roles.includes('assistant')));
		const invitationMarkup = isManagerMode && memberInvitations.length
			? `<details class="pc-org-manager-invite-drawer" open><summary><span>待处理邀请</span><em>${escapeHtml(String(memberInvitations.length))} 条记录</em></summary><div class="pc-org-invite-list">${memberInvitations.slice(0, 8).map((invitation) => renderOrganizationInvitationRow(organization, invitation)).join('')}</div></details>`
			: '';
		const resultsMarkup = draft.searchResults.length
			? `<div class="pc-org-candidate-list">${draft.searchResults
					.map((user) => {
						const meta = [user.username && user.username !== user.displayName ? user.username : '', user.email || '', user.memberNo || '']
							.filter(Boolean)
							.join(' · ');
						return `<button class="pc-org-candidate${draft.selectedUserId === user.id ? ' selected' : ''}" type="button" data-org-pick-user data-org-id="${escapeHtml(organization.id)}" data-user-id="${escapeHtml(user.id)}"><strong>${escapeHtml(user.displayName)}</strong><span>${escapeHtml(meta || user.id)}</span></button>`;
					})
					.join('')}</div>`
			: `<div class="pc-admin-note">${draft.searchQuery.trim() ? (canInviteFromInput ? '没有搜索到已有账号，将按当前手机号/邮箱创建邀请。' : '没有搜索到已有账号。若要邀请新用户，请输入完整手机号或邮箱。') : '可按登录账号、昵称、邮箱、手机号进行搜索。'}</div>`;
		const formMarkup = `<form class="pc-org-add-form${isManagerMode ? ' pc-org-manager-add-form' : ''}" data-org-add-form data-org-id="${escapeHtml(organization.id)}" data-org-add-mode="${escapeHtml(mode)}">
			<div class="pc-org-form-grid pc-org-form-grid-search-only${isManagerMode ? ' pc-org-form-grid-manager' : ''}">
				<label class="pc-org-field pc-org-field-wide">
					<div class="pc-org-search-row"><input class="pc-profile-input" type="text" data-org-search-query value="${escapeHtml(draft.searchQuery)}" placeholder="输入账号 / 昵称 / 邮箱 / 手机号" /><button class="pc-inline-ghost" type="button" data-org-search>搜索</button></div>
				</label>
			</div>
			${isManagerMode ? `<div class="pc-role-toggle-group">${renderOrganizationRoleControls(defaultRoles, `org-add-${organization.id}`, allowedRoleIds)}</div>` : defaultRoles.map((role) => `<input type="checkbox" data-org-role name="org-add-${escapeHtml(organization.id)}" value="${escapeHtml(role)}" checked hidden />`).join('')}
			${resultsMarkup}
			<div class="pc-admin-note">${selectedText}</div>
			${isManagerMode ? '' : `<label class="pc-org-field"><span>邀请备注（可选）</span><textarea class="pc-org-note-input" data-org-invite-message rows="2" placeholder="例如：欢迎加入第三期日语冲刺班">${escapeHtml(draft.inviteMessage)}</textarea></label>`}
			<div class="pc-org-form-actions"><button class="pc-inline-btn" type="submit"${seatFull ? ' disabled' : ''}>${escapeHtml(submitText)}</button></div>
		</form>`;
		if (options.embedded) {
			return `<div class="pc-org-inline-add">
				<div class="pc-org-subsection-head"><h4>${escapeHtml(heading)}</h4><span>${escapeHtml(organizationSeatSummary(organization))}</span></div>
				${seatFull ? `<div class="pc-org-capacity is-full">${escapeHtml(organizationSeatSummary(organization))} 请先移除成员或升级席位。</div>` : ''}
				${formMarkup}
			</div>`;
		}
		return `<div class="pc-org-subsection pc-org-add-member-section">
		<div class="pc-org-subsection-head"><h4>${escapeHtml(heading)}</h4><span>${escapeHtml(organizationSeatSummary(organization))}${memberInvitations.length ? ` · ${escapeHtml(String(memberInvitations.length))} 个待接受` : ''}</span></div>
		${!isManagerMode || seatFull ? `<div class="pc-org-capacity${seatFull ? ' is-full' : ''}">${escapeHtml(organizationSeatSummary(organization))}${seatFull ? ' 请先移除成员或升级席位。' : ''}</div>` : ''}
		${formMarkup}
		${invitationMarkup}
		</div>`;
	}

	function renderOrganizationMemberEditor(organization: ManagedOrganization, member: ManagedOrganizationMember): string {
		const displayName = organizationMemberDisplayName(member);
		const metaParts = [member.username !== displayName ? member.username : '', member.memberNo || ''].filter(Boolean);
		const overrideCount = member.permissionOverrides.length;
		const templateText = member.permissionTemplates.length
			? member.permissionTemplates.map(permissionTemplateLabel).join(' / ')
			: '未套用模板';
		return `<details class="pc-org-member-editor">
			<summary class="pc-org-member-summary">
				<div class="pc-org-member-meta"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(metaParts.join(' · ') || '组织成员')}</span></div>
				<div class="pc-org-member-role-summary"><span>${escapeHtml(roleLabels(member.roles).join(' / ') || '未设置角色')}</span><em>${escapeHtml(templateText)}</em></div>
			</summary>
			<form data-org-member-form data-org-id="${escapeHtml(organization.id)}" data-user-id="${escapeHtml(member.userId)}">
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
				<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit" data-org-member-save onpointerdown="window.__pcSaveOrganizationMember?.(this); return false;" onclick="return false;">保存变更</button></div>
			</div>
			</form>
		</details>`;
	}

	function openLoginModal(): void {
		window.__openLoginModal?.();
	}

	function ensureRoot(): HTMLDivElement {
		bindOrganizationMemberSaveDocumentHandler();
		let root = document.getElementById('personal-center') as HTMLDivElement | null;
		if (root) {
			return root;
		}
		root = document.createElement('div');
		root.id = 'personal-center';
		root.className = 'pc-hidden';
		root.innerHTML = DEFAULT_TEMPLATE;
		(window as unknown as { __pcSaveOrganizationMember?: (button: HTMLElement) => void }).__pcSaveOrganizationMember = (button: HTMLElement) => {
			if (button.dataset.orgMemberSavePending === '1') {
				return;
			}
			button.dataset.orgMemberSavePending = '1';
			window.setTimeout(() => {
				delete button.dataset.orgMemberSavePending;
			}, 1200);
			const form = organizationMemberFormForButton(button);
			if (!form) {
				showToast('成员表单已失效，请刷新后重试');
				return;
			}
			saveOrganizationMemberForm(form);
		};
		root.addEventListener('click', (e) => {
			const t = eventTargetElement(e.target);
			const saveMemberButton = t?.closest('[data-org-member-save]') as HTMLButtonElement | null;
			if (saveMemberButton) {
				e.preventDefault();
				e.stopPropagation();
				const form = organizationMemberFormForButton(saveMemberButton);
				if (!form) {
					showToast('成员表单已失效，请刷新后重试');
					return;
				}
				saveOrganizationMemberForm(form);
				return;
			}
			if (t?.dataset.action === 'pc-close') {
				closePanel();
				return;
			}
			if (t?.dataset.action === 'pc-back-home') {
				if (activeSection === 'dashboard' && activeDashboardSubpage) {
					activeDashboardSubpage = dashboardParentSubpage(activeDashboardSubpage);
				} else {
					activeSection = 'dashboard';
					activeDashboardSubpage = '';
				}
				renderSections();
				renderSectionContent();
				return;
			}
			if (t?.dataset.action === 'pc-logout') {
				window.logoutUser?.();
			}
		});
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && isOpen() && !document.querySelector('.pc-confirm-overlay')) {
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

	function contextIdentityKey(ctx: PCContext): string {
		if (ctx.guest) return 'guest';
		return `${ctx.id || ctx.username || 'anonymous'}|${[...(ctx.roles || [])].sort().join(',')}`;
	}

	function resetPersonalCenterNavigationState(): void {
		activeSection = 'dashboard';
		activeDashboardSubpage = '';
		activeRoleContent = '';
		activeWorkbench = '';
		activeFavoriteFolderId = '';
		activeAccountEditor = '';
		activeContactVerificationEditor = '';
		managedOrganizationOpenState = {};
		const content = document.getElementById('pc-content');
		if (content) content.scrollTop = 0;
	}

	function resetPersonalCenterIdentityState(): void {
		resetPersonalCenterNavigationState();
		organizationMemberDrafts = {};
		activeOrganizationRolePermissionRoles = {};
		activeOrganizationMemberRoles = {};
		organizationLearningGroupCampusFilters = {};
		managedOrganizations = [];
		managedOrganizationsCacheKey = '';
		managedOrganizationListPage = { page: 1, pageSize: 20, pages: 0, total: 0, query: '' };
		managedOrganizationDetailState = {};
		organizationMemberListPages = {};
		organizationLearningGroupListPages = {};
		organizationCampusListPages = {};
		organizationCoursePackageListPages = {};
		pendingInvitations = [];
		pendingInvitationsCacheKey = '';
		favoriteBookmarkQuestions = [];
		favoriteBookmarkFolders = [];
		favoriteBookmarksCacheKey = '';
		recentLearningItems = [];
		recentLearningCacheKey = '';
		institutionRoleWorkbenchData = null;
		institutionRoleWorkbenchCacheKey = '';
		referralCodeDraft = '';
		contactVerificationDraft = {
			email: '',
			emailCode: '',
			phone: '',
			phoneCode: '',
			changeChallengeChannel: '',
			changeChallengeCode: ''
		};
		accountSecurityDraft = {
			currentPassword: '',
			newPassword: '',
			confirmPassword: '',
			wechatCode: 'wxdev_001',
			deleteConfirmation: '',
			deletePhoneCode: ''
		};
		auditLogModal?.remove();
		auditDetailModal?.remove();
		auditLogModal = null;
		auditDetailModal = null;
		auditLogState.offset = 0;
		auditLogState.lastTotal = 0;
		auditLogState.lastItems = [];
		auditLogState.actions = [];
		auditLogState.actionLabels = {};
	}

	function openPanel(): void {
		const root = ensureRoot();
		resetPersonalCenterNavigationState();
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
		let trigger = document.getElementById('user-menu-trigger') as HTMLButtonElement | null;
		const triggerHost = document.getElementById('exam-library-panel') || document.getElementById('exam-workarea') || document.body;
		if (!trigger) {
			trigger = document.createElement('button');
			trigger.type = 'button';
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
		const panel = document.querySelector('#personal-center .pc-panel');
		const isSupportPage = activeRoleContent.startsWith('support-');
		// 简单列表不需要占用完整管理工作区；复杂表格和配置页才使用宽面板。
		const needsMediumWorkspace = activeSection === 'dashboard'
			&& activeDashboardSubpage === 'role-content'
			&& activeRoleContent === 'platform-users';
		const needsWideWorkspace = activeSection === 'admin-hub'
			|| (activeSection === 'dashboard'
				&& activeDashboardSubpage === 'role-content'
				&& !isSupportPage
				&& !needsMediumWorkspace);
		panel?.classList.toggle('pc-panel-medium', needsMediumWorkspace);
		panel?.classList.toggle('pc-panel-wide', needsWideWorkspace);
		if (!backBtn) {
			return;
		}
		const currentSection = sections.find((section) => section.id === activeSection);
		backBtn.style.display = currentSection?.nav === false || (activeSection === 'dashboard' && activeDashboardSubpage) ? 'inline-flex' : 'none';
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
			if (activeSection !== 'dashboard') {
				activeDashboardSubpage = '';
			}
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
		void refreshMedalSummary(ctx);
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
		const points = ctx.xp ?? 0;
		const todayMinutes = 0;
		return `<div class="pc-lite-stats" aria-label="学习概览">
			<div class="pc-lite-stat" id="pc-points-stat">
				<strong>${points}</strong>
				<span>学分</span>
			</div>
			<div class="pc-lite-stat" id="pc-today-learning-stat">
				<strong>${todayMinutes}<em>分钟</em></strong>
				<span>今日学习</span>
			</div>
			<div class="pc-lite-stat" id="pc-medal-stat">
				<strong>0</strong>
				<span>勋章</span>
			</div>
			<div class="pc-lite-stat" id="pc-certificate-stat">
				<strong>0</strong>
				<span>证书</span>
			</div>
		</div>`;
	}

	async function refreshMedalSummary(ctx: PCContext): Promise<void> {
		if (ctx.guest || !ctx.id) {
			return;
		}
		const medalEl = document.getElementById('pc-medal-stat');
		const certificateEl = document.getElementById('pc-certificate-stat');
		if (!medalEl && !certificateEl) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getStatistics !== 'function') {
			return;
		}
		try {
			const data = (await api.getStatistics(ctx.id)) as {
				xp?: number;
				today_learning_minutes?: number;
				total_exams?: number;
				certificates_count?: number;
				certificate_count?: number;
			} | null;
			const points = Number(data?.xp ?? ctx.xp ?? 0);
			const todayMinutes = Number(data?.today_learning_minutes ?? 0);
			const medalCount = Number(data?.total_exams ?? 0);
			const certificateCount = Number(data?.certificates_count ?? data?.certificate_count ?? 0);
			const pointsStrong = document.getElementById('pc-points-stat')?.querySelector('strong');
			if (pointsStrong) {
				pointsStrong.textContent = String(Number.isFinite(points) && points > 0 ? points : 0);
			}
			const todayStrong = document.getElementById('pc-today-learning-stat')?.querySelector('strong');
			if (todayStrong) {
				todayStrong.innerHTML = `${Number.isFinite(todayMinutes) && todayMinutes > 0 ? Math.floor(todayMinutes) : 0}<em>分钟</em>`;
			}
			const medalStrong = medalEl?.querySelector('strong');
			if (medalStrong) {
				medalStrong.textContent = String(Number.isFinite(medalCount) && medalCount > 0 ? medalCount : 0);
			}
			const certificateStrong = certificateEl?.querySelector('strong');
			if (certificateStrong) {
				certificateStrong.textContent = String(
					Number.isFinite(certificateCount) && certificateCount > 0 ? certificateCount : 0
				);
			}
		} catch (error) {
			console.warn('[personalCenter] failed to refresh medal summary', error);
		}
	}

	// 业务功能 2：异步拉取连续天数与今日目标，填充顶部摘要中的两个占位卡片
	async function refreshStreakSummary(ctx: PCContext): Promise<void> {
		if (ctx.guest || !ctx.id) {
			return;
		}
		if (!document.getElementById('pc-streak-stat') && !document.getElementById('pc-goal-stat')) {
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
			const updatedAt = formatShortDateTime(String(data.updated_at ?? ''));
			banner.hidden = false;
			banner.innerHTML = `
				<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;">
					<div>
						<div style="font-weight:600;">上次未完成的考试</div>
						<div style="font-size:13px;color:#666;margin-top:2px;">
							<code>${escapeHtmlSafe(examId)}</code> · ${answered}${total > 0 ? `/${total}` : ''} 题${updatedAt ? ` · ${escapeHtmlSafe(updatedAt)}` : ''}
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
		try {
			await ensureMyAssignments(ctx);
			const items = myAssignmentItems.slice();
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
					const ownSubmission = asRecord(it.own_submission) || {};
					const submitted = !!readString(ownSubmission.submitted_at);
					const returned = readString(ownSubmission.review_status) === 'returned' || readString(ownSubmission.status) === 'returned';
					const teacherComment = readString(ownSubmission.teacher_comment);
					const ownReminders = Array.isArray(it.own_reminders)
						? it.own_reminders.map((item) => asRecord(item) || {})
						: [];
					const latestReminder = ownReminders
						.slice()
						.sort((a, b) => (readString(b.created_at) || '').localeCompare(readString(a.created_at) || ''))[0];
					const reminderMessage = !submitted ? readString(latestReminder?.message) : '';
					return `
						<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed #eee;">
							<div>
								<div style="font-size:13px;">${title}${returned ? ' · 已退回重做' : submitted ? ' · 已交' : ''}</div>
								<div style="font-size:12px;color:#888;">截止：${dueAt} · 试卷 <code>${escapeHtmlSafe(examId)}</code>${returned && teacherComment ? ` · 评语：${escapeHtmlSafe(teacherComment)}` : ''}</div>
								${reminderMessage ? `<div class="pc-assignment-reminder-message">催交提醒：${escapeHtmlSafe(reminderMessage)}</div>` : ''}
							</div>
							<button class="risk-btn" data-asg-action="open" data-exam-id="${escapeHtmlSafe(examId)}" data-assignment-id="${escapeHtmlSafe(assignmentId)}">${returned ? '重新提交' : submitted ? '再做一次' : '去做题'}</button>
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
			viewer._currentExamId = examId;
			viewer.loadExamData(examData);
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
			: '新用户注册后会自动继承 ?ref=... 的归因；完成首次有效学习或付费后结算奖励。';
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
		return '';
	}

	interface WorkbenchAction {
		title: string;
		desc?: string;
		icon: string;
		intent: string;
		gate?: (ctx: PCContext) => boolean;
	}

	interface StudentContentEntry extends WorkbenchAction {
		dashboardPage?: DashboardSubpage;
		entitlement?: string;
	}

	interface StudentContentGroup {
		id: string;
		title: string;
		items: StudentContentEntry[];
	}

	interface WorkbenchDef {
		id: WorkbenchId;
		label: string;
		title: string;
		subtitle: string;
		actions: WorkbenchAction[];
		more: WorkbenchAction[];
	}

	function featureById(id: string): FeatureItem | undefined {
		return featureItems.find((item) => item.id === id);
	}

	function actionFromFeature(id: string, fallback: WorkbenchAction): WorkbenchAction {
		const feature = featureById(id);
		return {
			title: fallback.title || feature?.title || id,
			desc: fallback.desc,
			icon: fallback.icon || feature?.icon || 'book',
			intent: fallback.intent || feature?.intent || '',
			gate: fallback.gate || feature?.gate
		};
	}

	function visibleAction(ctx: PCContext, action: WorkbenchAction): boolean {
		return action.gate ? action.gate(ctx) : true;
	}

	function studentFeatureEntry(id: string, desc: string, entitlement?: string): StudentContentEntry {
		const feature = featureById(id);
		return {
			title: feature?.title || id,
			desc,
			icon: feature?.icon || 'book',
			intent: feature?.intent || '',
			gate: feature?.gate,
			entitlement
		};
	}

	function studentContentGroups(): StudentContentGroup[] {
		return [
			{
				id: 'today',
				title: '今日学习',
				items: [
					{ title: '最近学习', desc: '继续上次进度', icon: 'clock', intent: '', dashboardPage: 'recent' },
					studentFeatureEntry('dailyPractice', '今日推荐练习'),
					studentFeatureEntry('srsReview', '按计划巩固'),
					{ title: '我的作业', desc: '老师布置任务', icon: 'folder', intent: 'openAssignments' }
				]
			},
			{
				id: 'review',
				title: '巩固整理',
				items: [
					studentFeatureEntry('wrongQuestions', '订正与掌握'),
					{
						...studentFeatureEntry('bookmarkFolders', '收藏题与清单'),
						title: '收藏',
						icon: 'heart',
						dashboardPage: 'favorites'
					},
					studentFeatureEntry('vocabNotebook', '生词与复习'),
					studentFeatureEntry('recommendedReview', '智能推荐题目', 'recommendation.personalized')
				]
			},
			{
				id: 'progress',
				title: '学习规划',
				items: [
					studentFeatureEntry('chapterPath', '按章节学习'),
					studentFeatureEntry('learningReport', '趋势与薄弱项'),
					studentFeatureEntry('studyGoal', '目标与倒计时'),
					studentFeatureEntry('community', '参与试卷讨论')
				]
			}
		];
	}

	function entitlementUpgradeIntent(entitlementKey: string, requiredPlan?: string): string {
		return `openEntitlementUpgrade:${encodeURIComponent(entitlementKey)}:${encodeURIComponent(requiredPlan || '')}`;
	}

	function renderStudentContentEntry(ctx: PCContext, entry: StudentContentEntry): string {
		const decision = entry.entitlement
			? resolveEntitlement(ctx.subscription, entry.entitlement)
			: { granted: true, known: false };
		const locked = decision.known && !decision.granted;
		const action = entry.dashboardPage
			? ` data-dashboard-page="${escapeHtml(entry.dashboardPage)}"`
			: ` data-intent="${escapeHtml(locked && entry.entitlement
				? entitlementUpgradeIntent(entry.entitlement, decision.requiredPlan)
				: entry.intent)}"`;
		const lockAttributes = locked
			? ` data-entitlement-locked="true" aria-label="${escapeHtml(`${entry.title}，${(decision.requiredPlan || '更高').toUpperCase()} 套餐解锁`)}"`
			: '';
		return `<button type="button" class="service-item pc-my-content-item${locked ? ' is-entitlement-locked' : ''}"${action}${lockAttributes}>
			<div class="pc-my-content-icon">${renderOutlineIcon(entry.icon, 'pc-service-icon')}</div>
			<div>
				<strong>${escapeHtml(entry.title)}</strong>
				<span>${escapeHtml(entry.desc || '')}</span>
				${locked ? `<b class="pc-entitlement-badge">${escapeHtml((decision.requiredPlan || '升级').toUpperCase())}</b>` : ''}
			</div>
		</button>`;
	}

	function renderStudentContentGroups(ctx: PCContext): string {
		const groups = studentContentGroups()
			.map((group) => ({ ...group, items: group.items.filter((item) => visibleAction(ctx, item)) }))
			.filter((group) => group.items.length > 0);
		return `<div class="pc-student-content-groups">
			${groups.map((group) => `<section class="pc-student-content-group" data-student-content-group="${escapeHtml(group.id)}">
				<h3 class="pc-student-content-title">${escapeHtml(group.title)}</h3>
				<div class="pc-my-content-grid">${group.items.map((item) => renderStudentContentEntry(ctx, item)).join('')}</div>
			</section>`).join('')}
		</div>`;
	}

	function availableWorkbenches(ctx: PCContext): WorkbenchDef[] {
		const roles = new Set(ctx.roles || []);
		const defs = workbenchDefs();
		const ids: WorkbenchId[] = [];
		if (roles.has('student') || roles.size === 0) ids.push('student');
		if (roles.has('teacher')) ids.push('teacher');
		if (roles.has('assistant')) ids.push('assistant');
		if (roles.has('orgAdmin')) ids.push('orgAdmin');
		if (roles.has('contentAdmin')) ids.push('contentAdmin');
		if (roles.has('superAdmin')) ids.push('superAdmin');
		if (ids.length === 0) ids.push('student');
		return ids.map((id) => defs[id]).filter(Boolean);
	}

	function activeWorkbenchDef(ctx: PCContext): WorkbenchDef {
		const available = availableWorkbenches(ctx);
		if (!activeWorkbench || !available.some((item) => item.id === activeWorkbench)) {
			activeWorkbench = available[0]?.id || 'student';
		}
		return available.find((item) => item.id === activeWorkbench) || available[0] || workbenchDefs().student;
	}

	function workbenchDefs(): Record<WorkbenchId, WorkbenchDef> {
		return {
			student: {
				id: 'student',
				label: '学员',
				title: '学习工作台',
				subtitle: '今天先完成复习、作业和错题订正。',
				actions: [
					actionFromFeature('srsReview', { title: '今日复习', icon: 'book', intent: 'openReviewWorkbench' }),
					{ title: '我的作业', desc: '老师布置的任务', icon: 'folder', intent: 'openAssignments' },
					actionFromFeature('wrongQuestions', { title: '错题本', icon: 'book', intent: 'openWrongQuestions' }),
					actionFromFeature('learningReport', { title: '学习报告', icon: 'chart', intent: 'openLearningReport' })
				],
				more: [
					actionFromFeature('bookmarkFolders', { title: '收藏题', icon: 'book', intent: 'openBookmarkFolders' }),
					actionFromFeature('vocabNotebook', { title: '生词本', icon: 'book', intent: 'openVocabNotebook' }),
					actionFromFeature('dailyPractice', { title: '每日一练', icon: 'chart', intent: 'openDailyPractice' }),
					actionFromFeature('studyGoal', { title: '备考目标', icon: 'badge', intent: 'openStudyGoal' }),
					actionFromFeature('recommendedReview', { title: '推荐复习', icon: 'chart', intent: 'openRecommendedReview' })
				]
			},
			teacher: {
				id: 'teacher',
				label: '老师',
				title: '教学工作台',
				subtitle: '处理待批改、学员状态和备课。',
				actions: [
					{ title: '我的学生', desc: '学员档案与备注', icon: 'profileMark', intent: 'openRoleContent:teacher-students' },
					{ title: '学习组', desc: '班级与约课组', icon: 'folder', intent: 'openRoleContent:teacher-groups' },
					{ title: '课程表', desc: '课程与预约', icon: 'clock', intent: 'openRoleContent:teacher-schedule' },
					{ title: '安排课程', desc: '排课与确认', icon: 'clock', intent: 'openRoleContent:teacher-arrange' }
				],
				more: [
					{ title: '待批改', icon: 'book', intent: 'openRoleContent:teacher-review' },
					{ title: '布置作业', icon: 'book', intent: 'openRoleContent:teacher-assign' },
					{ title: '成绩册', icon: 'chart', intent: 'openRoleContent:teacher-gradebook' },
					{ title: '备课', icon: 'folder', intent: 'openRoleContent:teacher-prep' }
				]
			},
			assistant: {
				id: 'assistant',
				label: '教学运营',
				title: '运营工作台',
				subtitle: '催交、跟进、约课和课程包。',
				actions: [
					{ title: '催交作业', desc: '未提交与逾期', icon: 'book', intent: 'openRoleContent:assistant-remind' },
					{ title: '学员跟进', desc: '联系记录与备注', icon: 'profileMark', intent: 'openRoleContent:assistant-followup' },
					{ title: '续费风险', desc: '课时与流失风险', icon: 'chart', intent: 'openRoleContent:assistant-renewal' },
					{ title: '异常提醒', desc: '逾期与学习中断', icon: 'badge', intent: 'openRoleContent:assistant-alerts' }
				],
				more: [
					{ title: '学习组', icon: 'folder', intent: 'openRoleContent:teacher-groups' },
					{ title: '课程表', icon: 'clock', intent: 'openRoleContent:teacher-schedule' },
					{ title: '课程包', icon: 'ticket', intent: 'openRoleContent:assistant-package' },
					{ title: '安排课程', icon: 'clock', intent: 'openRoleContent:assistant-arrange' }
				]
			},
			orgAdmin: {
				id: 'orgAdmin',
				label: '机构管理',
				title: '机构工作台',
				subtitle: '管理成员、学习组、席位和机构数据。',
				actions: [
					{ title: '成员管理', desc: '成员、邀请和导入', icon: 'profileMark', intent: 'openRoleContent:org-members' },
					{ title: '权限管理', desc: '角色和额外授权', icon: 'settings', intent: 'openRoleContent:org-permissions' },
					{ title: '机构设置', desc: '套餐、校区和审计', icon: 'wallet', intent: 'openRoleContent:org-settings' },
					{ title: '学习组', desc: '班级与约课组', icon: 'folder', intent: 'openRoleContent:org-groups' },
					{ title: '课程包', desc: '扣课与到期', icon: 'ticket', intent: 'openRoleContent:org-course-packages' },
					{ title: '机构看板', desc: '趋势和风险', icon: 'chart', intent: 'openRoleContent:org-dashboard' }
				],
				more: []
			},
			contentAdmin: {
				id: 'contentAdmin',
				label: '内容管理',
				title: '内容工作台',
				subtitle: '处理内容反馈，并完成质检、复核、发布和回滚。',
				actions: [
					{ title: '内容反馈', desc: '题目、答案、图片和音频问题', icon: 'community', intent: 'openRoleContent:content-feedback' },
					{ title: '发布工作流', desc: '质检、双人复核与发布', icon: 'badge', intent: 'openRoleContent:content-publish' },
					{ title: '内容日志', desc: '发布、回滚与审核记录', icon: 'settings', intent: 'openAuditLog' }
				],
				more: []
			},
			superAdmin: {
				id: 'superAdmin',
				label: '平台管理',
				title: '平台工作台',
				subtitle: '处理全站用户、机构、权限和系统配置。',
				actions: [
					{ title: '用户搜索', desc: '账号状态', icon: 'profileMark', intent: 'openRoleContent:platform-users' },
					{ title: '机构管理', desc: '机构和席位', icon: 'folder', intent: 'openRoleContent:platform-orgs' },
					{ title: '角色权限', desc: '默认权限', icon: 'settings', intent: 'openRoleContent:platform-roles' },
					{ title: '功能开关', icon: 'settings', intent: 'openRoleContent:platform-flags' }
				],
				more: [
					{ title: '全站统计', icon: 'chart', intent: 'openRoleContent:platform-stats' },
					{ title: '支付退款', icon: 'wallet', intent: 'openRoleContent:platform-payments' },
					{ title: '反馈处理', icon: 'community', intent: 'openRoleContent:platform-feedback' },
					{ title: '审计日志', icon: 'settings', intent: 'openAuditLog' }
				]
			}
		};
	}

	function renderWorkbenchSwitcher(ctx: PCContext, active: WorkbenchDef): string {
		const workbenches = availableWorkbenches(ctx);
		if (workbenches.length <= 1) {
			return '';
		}
		return `<div class="pc-workbench-switcher" aria-label="身份切换">
			${workbenches.map((item) => `<button type="button" class="${item.id === active.id ? 'active' : ''}" data-workbench="${item.id}">${escapeHtml(item.label)}</button>`).join('')}
		</div>`;
	}

	function renderActionGrid(ctx: PCContext, actions: WorkbenchAction[], className = 'pc-workbench-grid', limit = 4): string {
		const visible = actions.filter((action) => visibleAction(ctx, action)).slice(0, limit);
		return `<div class="${className}">
			${visible.map((action) => `<button class="service-item pc-workbench-action" data-intent="${escapeHtml(action.intent)}" title="${escapeHtml(action.title)}">
				<div class="svc-icon">${renderOutlineIcon(action.icon, 'pc-service-icon')}</div>
				<div><div class="svc-title">${escapeHtml(action.title)}</div>${action.desc ? `<div class="pc-workbench-action-desc">${escapeHtml(action.desc)}</div>` : ''}</div>
			</button>`).join('')}
		</div>`;
	}

	function renderRoleWorkbenchCard(ctx: PCContext, workbench: WorkbenchDef): string {
		const contentActions = [...workbench.actions, ...workbench.more];
		return `<div class="pc-card pc-role-workbench-card">
			${renderWorkbenchSwitcher(ctx, workbench)}
			<div class="pc-role-workbench-section">
				<div class="pc-role-section-title">我的内容</div>
				${renderActionGrid(ctx, contentActions, 'pc-role-action-grid', 8)}
			</div>
		</div>`;
	}

	function dashboardParentSubpage(page: DashboardSubpage): DashboardSubpage {
		if (page === 'role-content') {
			activeRoleContent = '';
		}
		return '';
	}

	function renderDashboardSubpage(title: string, body: string, subtitle = ''): string {
		return `<div class="pc-dashboard pc-dashboard-simple pc-subpage" data-dashboard-subpage="${escapeHtml(activeDashboardSubpage)}">
			<div class="pc-card pc-subpage-head">
				<button class="pc-inline-ghost pc-subpage-back" type="button" data-dashboard-back>返回</button>
				<div>
					<div class="pc-subpage-title">${escapeHtml(title)}</div>
					${subtitle ? `<div class="pc-subpage-subtitle">${escapeHtml(subtitle)}</div>` : ''}
				</div>
			</div>
			${body}
		</div>`;
	}

	type RoleContentRow = { title: string; desc: string; meta?: string; intent?: string };
	type RoleContentPage = { title: string; subtitle: string; rows: RoleContentRow[] };

	function clearLegacyPersonalCenterStorage(): void {
		try {
			localStorage.removeItem('pc_demo_assignments_v1');
			localStorage.removeItem('pc_demo_courses_v1');
			localStorage.removeItem('pc_demo_action_state_v1');
		} catch (error) {
			log('clear legacy personal center storage failed', error);
		}
	}

	clearLegacyPersonalCenterStorage();

	function openRoleContentIntent(key: string): string {
		return `openRoleContent:${key}`;
	}

	function openExamQuestionIntent(examId: string, questionId: string, sectionIndex: number): string {
		return `openExamQuestion:${examId}:${questionId}:${sectionIndex}`;
	}

	function renderRoleListCard(title: string, rows: RoleContentRow[]): string {
		return `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">${escapeHtml(title)}</div>
			<div class="pc-lite-list">
				${rows.map((row) => row.intent ? `<button class="pc-lite-row service-item" type="button" data-intent="${escapeHtml(row.intent)}">
					<span><strong>${escapeHtml(row.title)}</strong><em>${escapeHtml(row.desc)}</em></span>
					${row.meta ? `<b>${escapeHtml(row.meta)}</b>` : '<b>›</b>'}
				</button>` : `<div class="pc-lite-row pc-lite-row-static">
					<span><strong>${escapeHtml(row.title)}</strong><em>${escapeHtml(row.desc)}</em></span>
					${row.meta ? `<b>${escapeHtml(row.meta)}</b>` : ''}
				</div>`).join('')}
			</div>
		</div>`;
	}

	function renderRecentLearningPage(): string {
		if (recentLearningLoading) {
			return renderDashboardSubpage('最近学习', `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">学习记录</div><div class="pc-admin-note">正在读取真实学习进度...</div></div>`, '保留最近打开的试卷、题目和学习任务。');
		}
		const rows = recentLearningItems.slice(0, 3).map((item) => {
			const examId = readString(item.exam_id) || readString(item.paper_id) || '-';
			const examTitle = readString(item.exam_title) || readString(item.paper_title) || examId;
			const total = readNumber(item.total_questions) ?? 0;
			const answered = readNumber(item.answered_count) ?? 0;
			const status = readString(item.status) || 'draft';
			const sectionIndex = readNumber(item.last_section_index) ?? 0;
			const questionIndex = readNumber(item.last_question_index) ?? 0;
			const updatedAt = formatShortDateTime(readString(item.updated_at));
			return {
				title: examTitle,
				desc: `${status === 'submitted' ? '已提交' : '未完成'} · ${answered}${total > 0 ? `/${total}` : ''} 题${updatedAt ? ` · ${updatedAt}` : ''}`,
				meta: status === 'submitted' ? '查看' : '继续',
				intent: openExamQuestionIntent(examId, String(Math.max(1, questionIndex + 1)), sectionIndex)
			};
		});
		if (rows.length === 0) {
			return renderDashboardSubpage('最近学习', `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">学习记录</div><div class="pc-admin-note">还没有真实学习进度。完成答题或提交答案后，这里会显示对应试卷进度。</div></div>`, '保留最近打开的试卷、题目和学习任务。');
		}
		return renderDashboardSubpage('最近学习', renderRoleListCard('学习记录', rows), '保留最近打开的试卷、题目和学习任务。');
	}

	function favoriteFolderMap(): Map<string, Record<string, unknown>> {
		const folders = new Map<string, Record<string, unknown>>();
		for (const folder of favoriteBookmarkFolders) {
			const folderId = readString(folder.folder_id) || '';
			if (folderId) folders.set(folderId, folder);
		}
		return folders;
	}

	function favoriteFolderCounts(): Map<string, number> {
		const knownFolders = favoriteFolderMap();
		const counts = new Map<string, number>();
		for (const item of favoriteBookmarkQuestions) {
			const rawFolderId = readString(item.folder_id) || '';
			const folderId = rawFolderId && knownFolders.has(rawFolderId) ? rawFolderId : '';
			counts.set(folderId, (counts.get(folderId) || 0) + 1);
		}
		return counts;
	}

	function favoriteQuestionFolderId(item: Record<string, unknown>): string {
		const rawFolderId = readString(item.folder_id) || '';
		return rawFolderId && favoriteFolderMap().has(rawFolderId) ? rawFolderId : '';
	}

	function renderFavoriteQuestionRows(questions: Array<Record<string, unknown>>, showFolderName: boolean): string {
		if (questions.length === 0) {
			return '<div class="pc-admin-note">这个清单里还没有题目。做题时点击“收藏本题”，选择这个清单即可加入。</div>';
		}
		const folders = favoriteFolderMap();
		return questions
			.slice()
			.reverse()
			.map((item) => {
				const snapshot = asRecord(item.question_snapshot);
				const bookmarkId = readString(item.bookmark_id);
				const examId = readString(item.exam_id) || '-';
				const questionId = readString(item.question_id) || readString(item.question_no) || '';
				const questionNo = readString(item.question_no) || questionId || '?';
				const sectionIndex = Number(item.section_index);
				const folderId = favoriteQuestionFolderId(item);
				const folderName = folderId ? readString(folders.get(folderId)?.name) || '未命名清单' : '未分类';
				const reason = readString(item.reason);
				const stem = readString(snapshot?.question) || readString(snapshot?.stem);
				const desc = reason || stem || '未填写复习备注';
				return `<div class="pc-favorite-question">
					<button type="button" class="pc-favorite-question-main" data-favorite-question-open data-exam-id="${escapeHtml(examId)}" data-question-id="${escapeHtml(questionId)}" data-section-index="${escapeHtml(String(Number.isFinite(sectionIndex) ? sectionIndex : 0))}">
						<strong>${showFolderName ? `收藏题：${escapeHtml(folderName)} · ` : ''}第 ${escapeHtml(questionNo)} 题</strong>
						<em>${escapeHtml(examId)} 第 ${escapeHtml(questionNo)} 题，${escapeHtml(desc)}</em>
					</button>
					<div class="pc-favorite-actions">
						<button type="button" class="pc-inline-ghost" data-favorite-question-open data-exam-id="${escapeHtml(examId)}" data-question-id="${escapeHtml(questionId)}" data-section-index="${escapeHtml(String(Number.isFinite(sectionIndex) ? sectionIndex : 0))}">去做题</button>
						${bookmarkId ? `<button type="button" class="pc-inline-danger" data-favorite-question-delete="${escapeHtml(bookmarkId)}">删除</button>` : ''}
					</div>
				</div>`;
			})
			.join('');
	}

	function renderFavoritesHomePage(): string {
		const counts = favoriteFolderCounts();
		const folderRows = favoriteBookmarkFolders
			.map((folder) => {
				const folderId = readString(folder.folder_id) || '';
				const name = readString(folder.name) || '未命名清单';
				const count = counts.get(folderId) || 0;
				return `<button type="button" class="pc-lite-row pc-favorite-folder-row" data-favorite-folder="${escapeHtml(folderId)}">
					<span><strong>清单：${escapeHtml(name)}</strong><em>${count > 0 ? `${count} 道收藏题，点击进入整理` : '暂无题目，可在收藏题时选择这个清单'}</em></span>
					<b>${count > 0 ? `${count}题` : '空清单'}</b>
				</button>`;
			})
			.join('');
		const uncategorizedCount = counts.get('') || 0;
		const uncategorizedRow = uncategorizedCount > 0
			? `<button type="button" class="pc-lite-row pc-favorite-folder-row" data-favorite-folder="${FAVORITE_UNCATEGORIZED_FOLDER_ID}">
				<span><strong>未分类</strong><em>${uncategorizedCount} 道未归入清单的收藏题</em></span>
				<b>${uncategorizedCount}题</b>
			</button>`
			: '';
		const questionRows = renderFavoriteQuestionRows(favoriteBookmarkQuestions, true);
		return `<div class="pc-card pc-lite-list-card pc-favorite-card">
			<div class="pc-my-content-head">
				<span>收藏清单</span>
				<button type="button" class="pc-inline-btn" data-favorite-create-folder>新建清单</button>
			</div>
			<div class="pc-lite-list">${folderRows || '<div class="pc-admin-note">还没有清单。可以先新建一个，用来归纳收藏题。</div>'}${uncategorizedRow}</div>
			<div class="pc-favorite-section-title">全部收藏题</div>
			<div class="pc-favorite-question-list">${questionRows}</div>
		</div>`;
	}

	function renderFavoriteFolderPage(folderId: string): string {
		const folders = favoriteFolderMap();
		const isUncategorized = folderId === FAVORITE_UNCATEGORIZED_FOLDER_ID;
		const actualFolderId = isUncategorized ? '' : folderId;
		const folder = actualFolderId ? folders.get(actualFolderId) : null;
		const title = actualFolderId ? readString(folder?.name) || '未命名清单' : '未分类';
		const questions = favoriteBookmarkQuestions.filter((item) => favoriteQuestionFolderId(item) === actualFolderId);
		return `<div class="pc-card pc-lite-list-card pc-favorite-card">
			<div class="pc-favorite-detail-head">
				<button type="button" class="pc-inline-ghost" data-favorite-back>返回收藏</button>
				<div>
					<div class="pc-my-content-head">${actualFolderId ? `清单：${escapeHtml(title)}` : '未分类'}</div>
					<div class="pc-subpage-subtitle">${questions.length} 道收藏题</div>
				</div>
				${actualFolderId ? `<div class="pc-favorite-actions">
					<button type="button" class="pc-inline-ghost" data-favorite-folder-rename="${escapeHtml(actualFolderId)}">重命名</button>
					<button type="button" class="pc-inline-danger" data-favorite-folder-delete="${escapeHtml(actualFolderId)}">删除</button>
				</div>` : ''}
			</div>
			<div class="pc-favorite-question-list">${renderFavoriteQuestionRows(questions, false)}</div>
		</div>`;
	}

	function renderFavoritesPage(): string {
		if (favoriteBookmarksLoading) {
			return renderDashboardSubpage('收藏', `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">收藏清单</div><div class="pc-admin-note">正在读取收藏题和收藏清单...</div></div>`, '收藏题和收藏清单都可以直接跳回对应学习内容。');
		}
		const folders = favoriteFolderMap();
		if (activeFavoriteFolderId && activeFavoriteFolderId !== FAVORITE_UNCATEGORIZED_FOLDER_ID && !folders.has(activeFavoriteFolderId)) {
			activeFavoriteFolderId = '';
		}
		if (favoriteBookmarkQuestions.length === 0 && favoriteBookmarkFolders.length === 0) {
			return renderDashboardSubpage('收藏', `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">收藏清单</div><div class="pc-admin-note">还没有收藏题或清单。做题时点击“收藏本题”，可以选择或新建清单归纳。</div><button type="button" class="pc-inline-btn" data-favorite-create-folder>新建清单</button></div>`, '收藏题和收藏清单都可以直接跳回对应学习内容。');
		}
		return renderDashboardSubpage('收藏', activeFavoriteFolderId ? renderFavoriteFolderPage(activeFavoriteFolderId) : renderFavoritesHomePage(), '收藏题和收藏清单都可以直接跳回对应学习内容。');
	}

	async function refreshFavoritesPage(): Promise<void> {
		invalidateFavoriteBookmarks();
		await ensureFavoriteBookmarks(getContext());
		renderSections();
		renderSectionContent();
	}

	async function createFavoriteFolderFromPage(): Promise<void> {
		const name = await requestTextInput('请输入清单名称（最多 50 字）');
		if (!name?.trim()) return;
		const api = window.APIClient;
		if (!api || typeof api.createBookmarkFolder !== 'function') {
			showToast('客户端 API 未注入');
			return;
		}
		try {
			const created = asRecord(await api.createBookmarkFolder(getContext().id || '', name.trim()));
			activeFavoriteFolderId = readString(created?.folder_id) || '';
			await refreshFavoritesPage();
		} catch (error) {
			showToast(readErrorMessage(error, '创建失败'));
		}
	}

	async function renameFavoriteFolderFromPage(folderId: string): Promise<void> {
		const current = readString(favoriteFolderMap().get(folderId)?.name);
		const name = await requestTextInput('新的清单名称', current || '');
		if (!name?.trim()) return;
		const api = window.APIClient;
		if (!api || typeof api.updateBookmarkFolder !== 'function') {
			showToast('客户端 API 未注入');
			return;
		}
		try {
			await api.updateBookmarkFolder(getContext().id || '', folderId, { name: name.trim() });
			await refreshFavoritesPage();
		} catch (error) {
			showToast(readErrorMessage(error, '重命名失败'));
		}
	}

	async function deleteFavoriteFolderFromPage(folderId: string): Promise<void> {
		if (!await requestConfirmation('确定要删除这个清单吗？清单里的题目收藏会保留，并移到未分类。')) return;
		const api = window.APIClient;
		if (!api || typeof api.removeBookmarkFolder !== 'function') {
			showToast('客户端 API 未注入');
			return;
		}
		try {
			await api.removeBookmarkFolder(getContext().id || '', folderId);
			if (activeFavoriteFolderId === folderId) activeFavoriteFolderId = '';
			await refreshFavoritesPage();
		} catch (error) {
			showToast(readErrorMessage(error, '删除失败'));
		}
	}

	async function deleteFavoriteQuestionFromPage(bookmarkId: string): Promise<void> {
		if (!bookmarkId || !await requestConfirmation('确定删除这个单题收藏吗？')) return;
		const api = window.APIClient;
		if (!api || typeof api.removeQuestionBookmark !== 'function') {
			showToast('客户端 API 未注入');
			return;
		}
		try {
			await api.removeQuestionBookmark(getContext().id || '', bookmarkId);
			await refreshFavoritesPage();
		} catch (error) {
			showToast(readErrorMessage(error, '删除失败'));
		}
	}

	function renderMyAccountPage(ctx: PCContext): string {
		const items = [
			{ page: 'account-core', title: '账户', desc: '手机密码', icon: 'profileMark' },
			{ page: 'account-plan', title: '套餐', desc: `${planLabel(ctx.subscription?.plan)} · ${remainingDaysLabel(ctx)}`, icon: 'wallet' },
			{ page: 'account-coupons', title: '卡券', desc: `${ctx.couponCount ?? 0} 张卡券`, icon: 'ticket' },
			{ page: 'account-feedback', title: '反馈', desc: '客服协议', icon: 'community' }
		] as const;
		return `<div class="pc-card pc-my-content-card pc-my-account-card">
			<div class="pc-my-content-head">我的账户</div>
			<div class="pc-account-entry-grid">
				${items.map((item) => `<button type="button" class="service-item pc-account-entry" data-dashboard-page="${item.page}">
					<div class="pc-my-content-icon">${renderOutlineIcon(item.icon, 'pc-service-icon')}</div>
					<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.desc)}</span></div>
				</button>`).join('')}
			</div>
		</div>`;
	}

	function renderAccountCorePage(ctx: PCContext): string {
		const exportDecision = resolveEntitlement(ctx.subscription, 'export.standard');
		const exportLocked = exportDecision.known && !exportDecision.granted;
		const accountDataRows: RoleContentRow[] = [
			{ title: '个人资料与联系人', desc: '维护头像、邮箱、手机号和推荐关系', meta: '管理', intent: 'gotoProfile' },
			{
				title: '数据导出',
				desc: exportLocked ? '完整导出个人资料、学习记录和收藏数据' : '导出个人资料、学习记录和收藏数据',
				meta: exportLocked ? `${(exportDecision.requiredPlan || '升级').toUpperCase()} 解锁` : '导出',
				intent: exportLocked
					? entitlementUpgradeIntent('export.standard', exportDecision.requiredPlan)
					: 'openDataExport'
			},
			{ title: 'Google 绑定', desc: '当前未绑定 Google 账号', meta: '未绑定' }
		];
		const syncFeature = featureItems.find((feature) => feature.id === 'syncDevices');
		if (!syncFeature?.gate || syncFeature.gate(ctx)) {
			accountDataRows.splice(2, 0, { title: '多端同步', desc: '查看设备并同步学习进度、收藏和设置', meta: '管理', intent: 'openSyncDevices' });
		}
		const exportCard = renderRoleListCard('账户数据', accountDataRows);
		return renderDashboardSubpage('账户', `${renderAccountManagementCard(ctx)}${exportCard}`, '管理手机号、密码、第三方绑定和注销账号。');
	}

	function renderAccountPlanPage(ctx: PCContext): string {
		const subscription = ctx.subscription;
		const body = `${renderRoleListCard('套餐记录', [
			{ title: '当前套餐', desc: `${planLabel(subscription?.plan)} · ${subscription?.status || 'active'} · ${subscription?.expiresAt || '长期'}`, meta: '当前' },
			{ title: '续费 / 升级', desc: '选择个人套餐并创建支付订单', meta: '进入', intent: 'openRecharge' },
			{ title: '支付流水', desc: '查看真实订单、支付成功、退款申请和权益发放记录', meta: '流水', intent: 'openPaymentLedger' }
		])}${renderAutoRenewalCard('personal', ctx.id || '', {
			plan: subscription?.plan || 'free',
			status: subscription?.status || 'active',
			expiresAt: subscription?.expiresAt || ctx.planExpiresAt || '',
			seats: 1
		})}${renderPaymentNotificationInbox()}`;
		return renderDashboardSubpage('套餐', body, '查看当前套餐、自动续费授权、到期提醒、订单和退款记录。');
	}

	function renderAccountCouponsPage(ctx: PCContext): string {
		const body = `${renderRoleListCard('卡券', [
			{ title: '兑换码', desc: '输入兑换码兑换套餐、卡券或学习权益', meta: '兑换', intent: 'openRedeem' },
			{ title: '卡券包', desc: `当前卡券 ${ctx.couponCount ?? 0} 张，列表来自钱包接口`, meta: '查看', intent: 'openCoupons' }
		])}`;
		return renderDashboardSubpage('卡券', body, '兑换码、优惠券、卡券包和邀请奖励统一放在这里。');
	}

	function renderAccountFeedbackPage(): string {
		const body = `${renderRoleListCard('反馈帮助', [
			{ title: '问题反馈', desc: '反馈题目、解析、支付或账号问题，提交后写入反馈接口', meta: '提交', intent: openRoleContentIntent('support-feedback') },
			{ title: '客服', desc: '工作日 10:00-19:00', meta: '联系', intent: openRoleContentIntent('support-customer-service') },
			{ title: '用户协议', desc: '查看账号、内容和付费使用规则', meta: '查看', intent: openRoleContentIntent('support-user-agreement') },
			{ title: '隐私政策', desc: '查看个人数据收集、使用和导出说明', meta: '查看', intent: openRoleContentIntent('support-privacy-policy') }
		])}`;
		return renderDashboardSubpage('反馈', body, '帮助、客服、协议和隐私政策集中展示。');
	}

	function institutionStudentRows(data: Record<string, unknown>): RoleContentRow[] {
		const relationships = Array.isArray(data.student_relationships) ? data.student_relationships : [];
		return relationships.map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const groups = Array.isArray(raw.learning_groups) ? raw.learning_groups : [];
			const packages = Array.isArray(raw.course_packages) ? raw.course_packages : [];
			const groupNames = groups
				.map((group) => readString(asRecord(group)?.name))
				.filter(Boolean)
				.join(' / ');
			const name = readString(student.display_name) || readString(student.username) || readString(student.id) || '学员';
			const studentId = readString(student.id) || readString(student.user_id);
			return {
				title: name,
				desc: `${groupNames || '暂无学习组'} · ${institutionNumber(raw.relationship_count)} 个学习关系 · ${institutionNumber(raw.course_package_count)} 个课程包`,
				meta: packages.length ? `${packages.length}包` : '档案',
				intent: studentId ? openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`) : undefined
			};
		});
	}

	function institutionGroupRows(data: Record<string, unknown>): RoleContentRow[] {
		const groups = Array.isArray(data.learning_groups) ? data.learning_groups : [];
		return groups.map((item) => {
			const raw = asRecord(item) || {};
			const enrollments = Array.isArray(raw.enrollments) ? raw.enrollments.map((enrollment) => asRecord(enrollment) || {}) : [];
			const students = enrollments.filter((enrollment) => readString(enrollment.role) === 'student' && (readString(enrollment.status) || 'active') === 'active').length;
			const teachers = enrollments.filter((enrollment) => {
				const role = readString(enrollment.role) || '';
				return ['teacher', 'assistant'].includes(role) && (readString(enrollment.status) || 'active') === 'active';
			}).length;
			const start = readString(raw.starts_at);
			const organizationId = readString(raw.organization_id) || readString(raw.org_id);
			const groupId = readString(raw.learning_group_id) || readString(raw.group_id) || readString(raw.id);
			return {
				title: readString(raw.name) || readString(raw.learning_group_id) || '未命名学习组',
				desc: `${readString(raw.subject) || '未设置科目'} · 学员 ${students} 人 · 老师/助教 ${teachers} 人${start ? ` · ${formatShortDateTime(start)}` : ''}`,
				meta: readString(raw.status) || 'active',
				intent: organizationId && groupId
					? openRoleContentIntent(`teacher-group:${encodeURIComponent(organizationId)}:${encodeURIComponent(groupId)}`)
					: undefined
			};
		});
	}

	function institutionScheduleRows(data: Record<string, unknown>): RoleContentRow[] {
		const schedule = Array.isArray(data.schedule) ? data.schedule : [];
		return schedule.map((item) => {
			const raw = asRecord(item) || {};
			const start = readString(raw.starts_at);
			const end = readString(raw.ends_at);
			const studentIds = Array.isArray(raw.student_ids) ? raw.student_ids.length : 0;
			const time = start ? `${formatShortDateTime(start)}${end ? `-${formatShortDateTime(end)}` : ''}` : '未排时间';
			const organizationId = readString(raw.organization_id) || readString(raw.org_id);
			const groupId = readString(raw.learning_group_id) || readString(raw.group_id) || readString(raw.id);
			return {
				title: `${time} ${readString(raw.name) || '未命名课程'}`,
				desc: `${readString(raw.subject) || '未设置科目'} · ${studentIds} 名学员 · ${readString(raw.type) === 'booking' ? '约课' : '班级'}`,
				meta: readString(raw.status) || 'active',
				intent: organizationId && groupId ? openRoleContentIntent(`teacher-group:${encodeURIComponent(organizationId)}:${encodeURIComponent(groupId)}`) : undefined
			};
		});
	}

	function institutionAssignmentRows(data: Record<string, unknown>, incompleteOnly = false, reviewOnly = false): RoleContentRow[] {
		const assignments = Array.isArray(data.assignments) ? data.assignments : [];
		return assignments
			.map((item) => asRecord(item) || {})
			.filter((item) => (!incompleteOnly || institutionNumber(item.submitted_count) < institutionNumber(item.student_count)) && (!reviewOnly || institutionNumber(item.pending_review_count) > 0))
			.map((item) => {
				const submitted = institutionNumber(item.submitted_count);
				const total = institutionNumber(item.student_count);
				const average = institutionNumber(item.average_score, -1);
				const dueAt = readString(item.due_at);
				const overdue = !!dueAt && Date.parse(dueAt) < Date.now() && total > submitted;
				const pendingReview = institutionNumber(item.pending_review_count);
				const assignmentId = readString(item.assignment_id);
				return {
					title: readString(item.title) || readString(item.assignment_title) || readString(item.assignment_id) || '未命名作业',
					desc: `${submitted}/${total} 已提交${average >= 0 ? ` · 平均 ${average.toFixed(1)}%` : ''}${dueAt ? ` · 截止 ${formatShortDateTime(dueAt)}` : ''}`,
					meta: reviewOnly ? `${pendingReview} 待批改` : total > submitted ? `${overdue ? '逾期 · ' : ''}${total - submitted} 未交` : '已完成',
					intent: assignmentId ? openRoleContentIntent(`teacher-assignment:${encodeURIComponent(assignmentId)}`) : undefined
				};
			});
	}

	function institutionRankingRows(data: Record<string, unknown>): RoleContentRow[] {
		const ranking = Array.isArray(data.student_ranking) ? data.student_ranking : [];
		return ranking.map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const studentId = readString(student.id) || readString(student.user_id);
			const average = institutionNumber(raw.average_score, -1);
			return {
				title: readString(student.display_name) || readString(student.username) || studentId || '学员',
				desc: `${average >= 0 ? `平均 ${average.toFixed(1)}%` : '暂无成绩'} · ${institutionNumber(raw.attempt_count)} 次作答`,
				meta: '档案',
				intent: studentId ? openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`) : undefined
			};
		});
	}

	function institutionRenewalRiskRows(data: Record<string, unknown>): RoleContentRow[] {
		const risks = Array.isArray(data.renewal_risks) ? data.renewal_risks : [];
		return risks.map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const studentId = readString(student.id) || readString(student.user_id);
			const expiresAt = readString(raw.plan_expires_at);
			return {
				title: readString(student.display_name) || readString(student.username) || studentId || '学员',
				desc: `${readString(raw.reason) || '需要跟进'}${institutionNumber(raw.inactive_days) > 0 ? ` · ${institutionNumber(raw.inactive_days)} 天未学习` : ''}${expiresAt ? ` · 到期 ${formatShortDateTime(expiresAt)}` : ''}`,
				meta: readString(raw.level) || '关注',
				intent: studentId ? openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`) : undefined
			};
		});
	}

	function institutionCoursePackageRoleRows(data: Record<string, unknown>): RoleContentRow[] {
		const packages = Array.isArray(data.course_packages) ? data.course_packages : [];
		return packages.map((item) => {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			const studentId = readString(student.id) || readString(raw.student_id);
			return {
				title: `${readString(student.display_name) || readString(student.username) || studentId || '学员'} · ${readString(raw.title) || readString(raw.subject) || '课程包'}`,
				desc: `剩余 ${institutionNumber(raw.remaining_lessons)}/${institutionNumber(raw.total_lessons)} 次${readString(raw.expires_at) ? ` · 到期 ${formatShortDateTime(readString(raw.expires_at))}` : ''}`,
				meta: readString(raw.attention_reason) || readString(raw.status) || '正常',
				intent: studentId ? openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`) : undefined
			};
		});
	}

	function institutionLessonPrepRows(data: Record<string, unknown>): RoleContentRow[] {
		const plans = Array.isArray(data.lesson_prep_plans) ? data.lesson_prep_plans : [];
		return plans.map((item) => {
			const raw = asRecord(item) || {};
			const planId = readString(raw.lesson_prep_id) || readString(raw.id);
			return {
				title: readString(raw.title) || '未命名备课方案',
				desc: `${readString(raw.exam_id) || '未关联试卷'} · ${Array.isArray(raw.question_set) ? raw.question_set.length : 0} 题`,
				meta: readString(raw.updated_at) ? formatShortDateTime(readString(raw.updated_at)) : '已保存',
				intent: planId ? openRoleContentIntent(`teacher-prep:${encodeURIComponent(planId)}`) : undefined
			};
		});
	}

	function decodeRoleContentPart(value: string): string {
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	function institutionMemberName(userId: string, data: Record<string, unknown>): string {
		if (!userId) return '';
		const relationships = Array.isArray(data.student_relationships) ? data.student_relationships : [];
		for (const item of relationships) {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			if ((readString(student.id) || readString(student.user_id)) === userId) {
				return readString(student.display_name) || readString(student.username) || userId;
			}
		}
		return userId;
	}

	function findInstitutionStudentRelationship(data: Record<string, unknown>, studentId: string): Record<string, unknown> | null {
		const relationships = Array.isArray(data.student_relationships) ? data.student_relationships : [];
		for (const item of relationships) {
			const raw = asRecord(item) || {};
			const student = asRecord(raw.student) || {};
			if ((readString(student.id) || readString(student.user_id)) === studentId) {
				return raw;
			}
		}
		return null;
	}

	function findInstitutionGroup(data: Record<string, unknown>, groupId: string): Record<string, unknown> | null {
		const groups = Array.isArray(data.learning_groups) ? data.learning_groups : [];
		for (const item of groups) {
			const raw = asRecord(item) || {};
			const currentId = readString(raw.learning_group_id) || readString(raw.group_id) || readString(raw.id);
			if (currentId === groupId) {
				return raw;
			}
		}
		return null;
	}

	function institutionGroupStudentIds(group: Record<string, unknown>): string[] {
		const enrollments = Array.isArray(group.enrollments) ? group.enrollments : [];
		return enrollments
			.map((item) => asRecord(item) || {})
			.filter((item) => readString(item.role) === 'student' && (readString(item.status) || 'active') === 'active')
			.map((item) => readString(item.user_id))
			.filter((item): item is string => Boolean(item));
	}

	function institutionGroupCoursePackages(data: Record<string, unknown>, group: Record<string, unknown>): Record<string, unknown>[] {
		const groupPackageId = readString(group.course_package_id);
		const studentIds = new Set(institutionGroupStudentIds(group));
		const packages = Array.isArray(data.course_packages) ? data.course_packages : [];
		return packages
			.map((item) => asRecord(item) || {})
			.filter((item) => {
				const packageId = readString(item.course_package_id) || readString(item.id);
				const studentId = readString(item.student_id);
				return (!!groupPackageId && packageId === groupPackageId) || (!!studentId && studentIds.has(studentId));
			});
	}

	function renderInstitutionCoursePackageRows(packages: Record<string, unknown>[]): string {
		return packages.map((item) => {
			const student = asRecord(item.student) || {};
			const studentName = readString(student.display_name) || readString(student.username) || readString(item.student_id) || '学员';
			const title = readString(item.title) || readString(item.subject) || '课程包';
			const used = institutionNumber(item.used_lessons);
			const total = institutionNumber(item.total_lessons);
			const remaining = institutionNumber(item.remaining_lessons);
			const status = readString(item.attention_reason) || readString(item.status) || '';
			return `<div class="pc-info-row"><span>${escapeHtml(studentName)} · ${escapeHtml(title)}</span><strong>已上 ${used}/${total} 次 · 剩 ${remaining} 次${status ? ` · ${escapeHtml(status)}` : ''}</strong></div>`;
		}).join('');
	}

	function renderInstitutionStudentDetailPage(ctx: PCContext, studentId: string): string {
		void ensureInstitutionRoleWorkbench(ctx);
		if (institutionRoleWorkbenchLoading) {
			return renderDashboardSubpage('学生档案', `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取学员关系...</div></div>`, '学员档案来自机构学习组和真实学习记录。');
		}
		const data = institutionRoleWorkbenchData || {};
		const relationship = findInstitutionStudentRelationship(data, studentId);
		const student = asRecord(relationship?.student) || {};
		const name = readString(student.display_name) || readString(student.username) || studentId;
		const groups = Array.isArray(relationship?.learning_groups) ? relationship.learning_groups.map((item) => asRecord(item) || {}) : [];
		const packages = Array.isArray(relationship?.course_packages) ? relationship.course_packages.map((item) => asRecord(item) || {}) : [];
		const groupRows = groups.map((group) => {
			const groupId = readString(group.learning_group_id) || readString(group.group_id) || readString(group.id);
			const organizationId = readString(group.organization_id) || ctx.organizationId || '';
			const intent = groupId && organizationId ? openRoleContentIntent(`teacher-group:${encodeURIComponent(organizationId)}:${encodeURIComponent(groupId)}`) : '';
			return `<button class="pc-info-row pc-info-row-button service-item" type="button" data-intent="${escapeHtml(intent)}"><span>${escapeHtml(readString(group.name) || groupId || '学习组')}</span><strong>${escapeHtml(readString(group.subject) || '')} · ${escapeHtml(readString(group.type) === 'booking' ? '一对一/约课' : '班课')}</strong></button>`;
		}).join('');
		const body = `<div class="pc-card pc-info-card pc-institution-detail-card">
			<div class="pc-service-header">${escapeHtml(name)}</div>
			<div class="pc-info-list">
				<div class="pc-info-row"><span>账号</span><strong>${escapeHtml(readString(student.username) || studentId)}</strong></div>
				<div class="pc-info-row"><span>手机</span><strong>${escapeHtml(readString(student.phone) || '未绑定')}</strong></div>
				<div class="pc-info-row"><span>成员编号</span><strong>${escapeHtml(readString(student.member_no) || '-')}</strong></div>
				<div class="pc-info-row"><span>学习关系</span><strong>${institutionNumber(relationship?.relationship_count)} 个学习组 · ${institutionNumber(relationship?.course_package_count)} 个课程包</strong></div>
			</div>
		</div>
		<div class="pc-card pc-info-card pc-institution-detail-card"><div class="pc-service-header">所属学习组</div><div class="pc-info-list">${groupRows || '<div class="pc-admin-note">暂无学习组</div>'}</div></div>
		<div class="pc-card pc-info-card pc-institution-detail-card"><div class="pc-service-header">课程包</div><div class="pc-info-list">${renderInstitutionCoursePackageRows(packages) || '<div class="pc-admin-note">暂无课程包</div>'}</div></div>
		<div id="pc-institution-detail" class="pc-institution-async-detail"><div class="pc-card pc-info-card"><div class="pc-service-header">学习档案</div><div class="pc-admin-note">正在加载学习记录、错题、作文和老师备注...</div></div></div>`;
		return renderDashboardSubpage('学生档案', body, '学习时间、作业、成绩和跟进状态都可以在这里继续查看。');
	}

	function renderInstitutionGroupDetailPage(ctx: PCContext, organizationId: string, groupId: string): string {
		void ensureInstitutionRoleWorkbench(ctx);
		if (institutionRoleWorkbenchLoading) {
			return renderDashboardSubpage('学习组详情', `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取学习组...</div></div>`, '学习组详情来自机构排课和课程包数据。');
		}
		const data = institutionRoleWorkbenchData || {};
		const group = findInstitutionGroup(data, groupId);
		if (!group) {
			return renderDashboardSubpage('学习组详情', `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">未找到该学习组，可能已被删除或当前老师无权查看。</div></div>`, '学习组详情来自机构排课和课程包数据。');
		}
		const name = readString(group.name) || groupId;
		const startsAt = readString(group.starts_at);
		const endsAt = readString(group.ends_at);
		const studentIds = institutionGroupStudentIds(group);
		const packages = institutionGroupCoursePackages(data, group);
		const time = startsAt ? `${formatDateTime(startsAt)}${endsAt ? ` - ${formatDateTime(endsAt)}` : ''}` : '未排时间';
		const courseIntro = readString(group.description) ||
			`${readString(group.subject) || '综合课程'}，${readString(group.type) === 'booking' ? '一对一/约课形式' : '班课形式'}，当前 ${studentIds.length} 名学员。`;
		const scheduleStatus = readString(group.status) || 'scheduled';
		const scheduleStatuses = [
			['scheduled', '已排课'], ['rescheduled', '已改期'], ['active', '进行中'],
			['completed', '已完成'], ['cancelled', '已取消'], ['no_show', '缺席']
		].map(([value, label]) => `<option value="${value}"${scheduleStatus === value ? ' selected' : ''}>${label}</option>`).join('');
		const studentRows = studentIds.map((studentId) => {
			const studentName = institutionMemberName(studentId, data);
			const intent = openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`);
			return `<button class="pc-info-row pc-info-row-button service-item" type="button" data-intent="${escapeHtml(intent)}"><span>${escapeHtml(studentName)}</span><strong>查看档案</strong></button>`;
		}).join('');
		const body = `<div class="pc-card pc-info-card pc-institution-detail-card">
			<div class="pc-service-header">${escapeHtml(name)}</div>
			<div class="pc-info-list">
				<div class="pc-info-row"><span>课程内容</span><strong>${escapeHtml(readString(group.subject) || '-')}</strong></div>
				<div class="pc-info-row"><span>上课形式</span><strong>${escapeHtml(readString(group.type) === 'booking' ? '一对一/约课' : '班课')}</strong></div>
				<div class="pc-info-row"><span>上课时间</span><strong>${escapeHtml(time)}</strong></div>
				<div class="pc-info-row"><span>状态</span><strong>${escapeHtml(readString(group.status) || 'active')}</strong></div>
			</div>
			<div class="pc-admin-note">课程介绍：${escapeHtml(courseIntro)}</div>
		</div>
		<div class="pc-card pc-info-card pc-institution-detail-card"><div class="pc-service-header">学员</div><div class="pc-info-list">${studentRows || '<div class="pc-admin-note">暂无学员</div>'}</div></div>
		<div class="pc-card pc-info-card pc-institution-detail-card"><div class="pc-service-header">课程包</div><div class="pc-info-list">${renderInstitutionCoursePackageRows(packages) || '<div class="pc-admin-note">这个学习组暂未关联课程包</div>'}</div></div>
		<div class="pc-card pc-info-card pc-institution-detail-card" data-role-schedule-card data-org-id="${escapeHtml(organizationId)}" data-group-id="${escapeHtml(groupId)}">
			<div class="pc-service-header">排课状态</div>
			<div class="pc-org-form-grid pc-org-form-grid-3">
				<label class="pc-org-field"><span>开始时间</span><input class="pc-profile-input" type="datetime-local" data-role-schedule-start value="${escapeHtml(startsAt ? startsAt.slice(0, 16) : '')}" /></label>
				<label class="pc-org-field"><span>结束时间</span><input class="pc-profile-input" type="datetime-local" data-role-schedule-end value="${escapeHtml(endsAt ? endsAt.slice(0, 16) : '')}" /></label>
				<label class="pc-org-field"><span>状态</span><select class="pc-profile-input" data-role-schedule-status>${scheduleStatuses}</select></label>
			</div>
			<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="button" data-role-schedule-save>保存排课</button></div>
		</div>
		<div id="pc-institution-detail" class="pc-institution-async-detail" data-inst-org-id="${escapeHtml(organizationId)}" data-inst-group-id="${escapeHtml(groupId)}">
			<div class="pc-card pc-info-card"><div class="pc-service-header">成绩册和作业</div><div class="pc-admin-note">正在加载学习组成绩册...</div></div>
		</div>`;
		return renderDashboardSubpage('学习组详情', body, '查看这个学习组上什么课、有哪些学生、课程包和作业成绩。');
	}

	function renderInstitutionAssignmentDetailPage(ctx: PCContext, assignmentId: string): string {
		void ensureInstitutionRoleWorkbench(ctx);
		const body = `<div id="pc-institution-detail" data-inst-assignment-detail="${escapeHtml(assignmentId)}">
			<div class="pc-card pc-info-card"><div class="pc-service-header">作业提交详情</div><div class="pc-admin-note">正在读取学员提交、成绩和错题分布...</div></div>
		</div>`;
		return renderDashboardSubpage('作业批改', body, '查看真实提交，并保存评语、人工成绩或退回重做。');
	}

	function renderInstitutionLessonPrepDetailPage(ctx: PCContext, planId: string): string {
		void ensureInstitutionRoleWorkbench(ctx);
		if (institutionRoleWorkbenchLoading) {
			return renderDashboardSubpage('备课方案', '<div class="pc-card pc-info-card"><div class="pc-admin-note">正在读取备课方案...</div></div>', '从已保存方案生成真实作业。');
		}
		const data = institutionRoleWorkbenchData || {};
		const plans = Array.isArray(data.lesson_prep_plans) ? data.lesson_prep_plans.map((item) => asRecord(item) || {}) : [];
		const plan = plans.find((item) => (readString(item.lesson_prep_id) || readString(item.id)) === planId);
		if (!plan) {
			return renderDashboardSubpage('备课方案', '<div class="pc-card pc-info-card"><div class="pc-admin-note">未找到该备课方案，可能已删除或当前账号无权查看。</div></div>', '从已保存方案生成真实作业。');
		}
		const groups = Array.isArray(data.learning_groups) ? data.learning_groups.map((item) => asRecord(item) || {}) : [];
		const orgId = readString(plan.organization_id) || readString(plan.org_id) || ctx.organizationId || '';
		const preferredGroupId = readString(plan.learning_group_id);
		const groupOptions = groups
			.filter((group) => !orgId || (readString(group.organization_id) || readString(group.org_id)) === orgId)
			.map((group) => {
				const groupId = readString(group.learning_group_id) || readString(group.group_id) || readString(group.id);
				return groupId ? `<option value="${escapeHtml(groupId)}"${groupId === preferredGroupId ? ' selected' : ''}>${escapeHtml(readString(group.name) || groupId)}</option>` : '';
			}).join('');
		const questions = Array.isArray(plan.question_set) ? plan.question_set : [];
		const body = `<div class="pc-card pc-info-card" data-role-prep-plan="${escapeHtml(planId)}" data-role-prep-org="${escapeHtml(orgId)}">
			<div class="pc-service-header">${escapeHtml(readString(plan.title) || '备课方案')}</div>
			<div class="pc-info-list">
				<div class="pc-info-row"><span>试卷</span><strong>${escapeHtml(readString(plan.exam_id) || '-')}</strong></div>
				<div class="pc-info-row"><span>题目</span><strong>${questions.length} 题</strong></div>
				<div class="pc-info-row"><span>考点</span><strong>${escapeHtml(readString(plan.focus_keyword) || '未限定')}</strong></div>
			</div>
			<label class="pc-org-field"><span>布置到学习组</span><select class="pc-profile-input" data-role-prep-group>${groupOptions || '<option value="">暂无可用学习组</option>'}</select></label>
			<label class="pc-org-field"><span>作业标题</span><input class="pc-profile-input" data-role-prep-title value="${escapeHtml(`${readString(plan.title) || '备课方案'} 作业`)}" /></label>
			<label class="pc-org-field"><span>截止时间</span><input class="pc-profile-input" type="datetime-local" data-role-prep-due /></label>
			<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="button" data-role-prep-create-assignment="${escapeHtml(planId)}"${groupOptions ? '' : ' disabled'}>生成作业</button></div>
		</div>`;
		return renderDashboardSubpage('备课方案', body, '作业会保留方案中的试卷和题目范围。');
	}

	function renderInstitutionRoleContentPage(ctx: PCContext, key: string): string {
		if (key.startsWith('teacher-assignment:')) {
			return renderInstitutionAssignmentDetailPage(ctx, decodeRoleContentPart(key.slice('teacher-assignment:'.length)));
		}
		if (key.startsWith('teacher-prep:')) {
			return renderInstitutionLessonPrepDetailPage(ctx, decodeRoleContentPart(key.slice('teacher-prep:'.length)));
		}
		if (key.startsWith('teacher-student:')) {
			return renderInstitutionStudentDetailPage(ctx, decodeRoleContentPart(key.slice('teacher-student:'.length)));
		}
		if (key.startsWith('teacher-group:')) {
			const [, organizationId = '', groupId = ''] = key.split(':').map(decodeRoleContentPart);
			return renderInstitutionGroupDetailPage(ctx, organizationId || ctx.organizationId || '', groupId);
		}
		void ensureInstitutionRoleWorkbench(ctx);
		if (institutionRoleWorkbenchLoading) {
			return renderDashboardSubpage('机构教学', `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取学习组和排课数据...</div></div>`, '教师端内容来自机构学习组和排课数据。');
		}
		const data = institutionRoleWorkbenchData || {};
		let page: RoleContentPage;
		if (key === 'teacher-students') {
			page = { title: '我的学生', subtitle: '来自分配给当前老师的学习组。', rows: institutionStudentRows(data) };
		} else if (key === 'teacher-groups') {
			page = { title: '学习组', subtitle: '当前老师参与的班级、小班和一对一学习关系。', rows: institutionGroupRows(data) };
		} else if (key === 'teacher-schedule') {
			page = { title: '课程表', subtitle: '已排时间的班课、约课和待确认课次。', rows: institutionScheduleRows(data) };
		} else if (key === 'teacher-arrange' || key === 'assistant-arrange') {
			page = { title: '安排课程', subtitle: '选择学习组进入排课详情，可设置开始时间、结束时间和课程状态。', rows: institutionGroupRows(data) };
		} else if (key === 'teacher-review') {
			page = { title: '待批改', subtitle: '数据来自机构成绩接口，只显示已有真实提交且尚未完成批改的作业。', rows: institutionAssignmentRows(data, false, true) };
		} else if (key === 'teacher-assign') {
			page = { title: '布置作业', subtitle: '选择真实学习组后进入机构教学工具创建作业。', rows: institutionGroupRows(data) };
		} else if (key === 'teacher-gradebook') {
			page = { title: '成绩册', subtitle: '按真实作答记录汇总学员平均分和作答次数。', rows: institutionRankingRows(data) };
		} else if (key === 'teacher-prep') {
			page = { title: '备课', subtitle: '这里仅展示已通过机构备课接口保存的方案。', rows: institutionLessonPrepRows(data) };
		} else if (key === 'assistant-remind') {
			page = { title: '催交作业', subtitle: '只列出真实作业中尚有学员未提交的项目。', rows: institutionAssignmentRows(data, true) };
		} else if (key === 'assistant-package') {
			page = { title: '课程包', subtitle: '课次余额和到期状态来自机构课程包接口。', rows: institutionCoursePackageRoleRows(data) };
		} else if (key === 'assistant-renewal') {
			page = {
				title: '续费风险',
				subtitle: '名单由真实套餐到期时间和学习活跃度计算。',
				rows: institutionRenewalRiskRows(data)
			};
		} else if (key === 'assistant-followup') {
			page = { title: '学员跟进', subtitle: '打开真实学员档案，查看学习中断风险并新增跟进记录。', rows: institutionStudentRows(data) };
		} else {
			page = { title: '异常提醒', subtitle: '由真实未交作业和续费风险合并生成。', rows: [...institutionAssignmentRows(data, true), ...institutionRenewalRiskRows(data)] };
		}
		if (page.rows.length === 0) {
			page.rows = [{ title: '暂无真实数据', desc: '接口当前没有返回可显示记录；请联系机构管理员添加成员、学习组、作业或课程包。', meta: '' }];
		}
		return renderDashboardSubpage(page.title, renderRoleListCard(page.title, page.rows), page.subtitle);
	}

	function roleContentRows(key: string): RoleContentPage {
		const emptyRows = (title: string, subtitle: string, desc = '当前没有真实创建的数据。创建记录后，这里会展示接口返回的数据。', intent?: string): RoleContentPage => ({
			title,
			subtitle,
			rows: [{ title: '暂无真实数据', desc, meta: intent ? '去处理' : '', intent }]
		});
		if (key.startsWith('user:')) {
			const userId = key.slice('user:'.length);
			const user = [...platformUserSearchResults, ...allUsers].find((item) => item.id === userId);
			if (user) return {
				title: user.displayName || user.username || user.id,
				subtitle: '用户详情：账号状态、角色、机构和联系方式。',
				rows: [
					{ title: '账号状态', desc: `${user.status || 'active'} · ${user.username || user.id}`, meta: '账号' },
					{ title: '角色', desc: roleLabels(user.roleIds).join(' / ') || '未设置角色', meta: '权限' },
					{ title: '手机号', desc: user.phone ? user.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') : '未绑定手机号', meta: user.phoneVerified ? '已验证' : '未验证' },
					{ title: '邮箱', desc: user.email || '未绑定邮箱', meta: user.emailVerified ? '已验证' : '未验证' },
					{ title: '机构', desc: user.organizationName || '个人用户', meta: user.organizationType || user.scopeType || '个人' },
					{ title: '最近登录', desc: user.lastLoginAt || '暂无记录', meta: '登录' }
				]
			};
			return emptyRows('用户详情', '用户信息来自真实账号接口。', '没有找到该用户，可能已停用或当前账号无权查看。');
		}
		if (key.startsWith('student:') || key.startsWith('assignment:') || key.startsWith('course:') || key.startsWith('package:') || key.startsWith('group:')) {
			return emptyRows('详情', '该明细入口只接受真实业务记录。', '没有找到对应记录；旧的静态学员、作业、课程和课程包数据已彻底移除。');
		}
		const pages: Record<string, RoleContentPage> = {
			'teacher-review': emptyRows('待批改', '作业与提交数据来自机构成绩接口。', '当前没有待批改的真实作业。'),
			'teacher-assign': emptyRows('布置作业', '作业通过真实学习组接口创建。', '请先进入学习组，再创建真实作业。', openRoleContentIntent('org-groups')),
			'teacher-gradebook': emptyRows('成绩册', '成绩册只汇总真实作答和作业提交。', '当前没有可汇总的成绩数据。'),
			'teacher-prep': emptyRows('备课', '备课方案来自机构备课接口。', '当前没有已保存的备课方案。'),
			'assistant-remind': emptyRows('催交作业', '只展示真实作业的未交和逾期情况。', '当前没有需要催交的作业。'),
			'assistant-followup': emptyRows('学员跟进', '学员状态来自真实学习记录和课程包。', '当前没有需要跟进的学员。'),
			'assistant-renewal': emptyRows('续费风险', '续费风险来自套餐到期时间和真实学习活跃度。', '当前没有续费风险记录。'),
			'assistant-package': emptyRows('课程包', '课程包余额来自机构课程包接口。', '当前没有可查看的课程包。', openRoleContentIntent('org-course-packages')),
			'assistant-alerts': emptyRows('异常提醒', '异常由真实作业逾期、学习中断和套餐状态计算。', '当前没有异常提醒。'),
			'content-publish': emptyRows('发布队列', '发布候选来自真实试卷索引。', '当前没有待发布的真实试卷。'),
			'content-log': emptyRows('内容日志', '内容变更记录来自审计日志。', '打开审计日志查看真实内容操作记录。', 'openAuditLog'),
			'platform-audit': emptyRows('审计日志', '审计日志只展示真实高危操作和后台记录。', '打开审计日志查看记录。', 'openAuditLog'),
			'support-feedback': emptyRows('问题反馈', '提交内容会写入真实反馈接口。', '请从反馈表单提交题目、解析、支付或账号问题。'),
			'support-customer-service': { title: '客服', subtitle: '客服联系方式和服务时间。', rows: [
				{ title: '在线客服', desc: '工作日 10:00-19:00；可先提交问题反馈，由客服统一处理', meta: '可用', intent: openRoleContentIntent('support-feedback') },
				{ title: '账号与支付问题', desc: '换绑、注销、订单和退款问题可通过反馈入口提交', meta: '反馈', intent: openRoleContentIntent('support-feedback') }
			] },
			'support-user-agreement': { title: '用户协议', subtitle: '账号、学习内容和付费权益的使用规则。', rows: [
				{ title: '账号规则', desc: '禁止共享、出租或售卖账号。', meta: '账号' },
				{ title: '内容规则', desc: '题目、解析、音频和图片仅限授权范围内使用。', meta: '内容' },
				{ title: '付费规则', desc: '套餐、席位、兑换码和卡券按页面标注的有效期生效。', meta: '付费' }
			] },
			'support-privacy-policy': { title: '隐私政策', subtitle: '个人数据收集、使用、导出和注销说明。', rows: [
				{ title: '收集范围', desc: '账号信息、学习记录、作答记录、收藏、错题和支付权益状态。', meta: '数据' },
				{ title: '使用目的', desc: '用于登录识别、学习同步、统计报告和权益判断。', meta: '使用' },
				{ title: '数据导出', desc: '可以在账户页导出个人资料和学习记录。', meta: '导出', intent: 'openDataExport' }
			] }
		};
		return pages[key] || emptyRows('我的内容', '当前入口只展示真实业务数据。', '当前没有可显示的真实记录。');
	}


	function renderUserSearchResultRows(users: PCUser[]): RoleContentRow[] {
		return users.map((user) => ({
			title: user.displayName || user.username || user.id,
			desc: [
				user.username && user.username !== user.displayName ? user.username : '',
				roleLabels(user.roleIds).join(' / ') || '未设置角色',
				user.phone ? user.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') : '',
				user.organizationName || ''
			].filter(Boolean).join(' · '),
			meta: user.status || '查看',
			intent: openRoleContentIntent(`user:${user.id}`)
		}));
	}

	function renderPlatformUserSearchPage(ctx: PCContext): string {
		if (!platformUserSearchLoaded && !platformUserSearchLoading && !platformUserSearchQuery) {
			platformUserSearchLoading = true;
			void loadUsers().then(() => {
				platformUserSearchLoaded = true;
				platformUserSearchLoading = false;
				if (shouldRefreshRoleContent('platform-users')) {
					renderSectionContent({ preserveScroll: true });
				}
			}).catch(() => {
				platformUserSearchLoaded = true;
				platformUserSearchLoading = false;
			});
		}
		const users = platformUserSearchQuery ? platformUserSearchResults : allUsers.slice(0, 30);
		const resultRows = users.length
			? renderUserSearchResultRows(users)
			: [{ title: platformUserSearchLoading ? '搜索中' : '没有结果', desc: platformUserSearchQuery ? '请换一个账号、手机号、邮箱或姓名关键字。' : '输入关键字后搜索全站账号。', meta: '' }];
		const body = `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">用户搜索</div>
			<form class="pc-platform-user-search-form" data-platform-user-search-form>
				<div class="pc-platform-user-search-row">
					<label class="pc-platform-user-search-field">
						<input class="pc-profile-input" type="search" data-platform-user-search-input value="${escapeHtml(platformUserSearchQuery)}" placeholder="账号 / 姓名 / 手机号 / 邮箱" />
					</label>
					<button class="pc-inline-btn" type="submit">搜索</button>
				</div>
			</form>
		</div>${renderRoleListCard(platformUserSearchQuery ? '搜索结果' : '最近用户', resultRows)}`;
		return renderDashboardSubpage('用户搜索', body, '全站用户、账号状态和登录问题。');
	}

	async function performPlatformUserSearch(form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const input = form.querySelector('[data-platform-user-search-input]') as HTMLInputElement | null;
		const query = (input?.value || '').trim();
		platformUserSearchQuery = query;
		if (!token || !api || typeof api.searchUsers !== 'function') {
			showToast('用户搜索接口不可用');
			return;
		}
		platformUserSearchLoading = true;
		renderSectionContent({ preserveScroll: true });
		try {
			const rawUsers = await api.searchUsers(token, query, 30);
			platformUserSearchResults = Array.isArray(rawUsers)
				? rawUsers.map((item) => normalizeUserRecord(item)).filter((item): item is PCUser => Boolean(item))
				: [];
			platformUserSearchLoaded = true;
		} catch (error) {
			platformUserSearchResults = [];
			showToast(readErrorMessage(error, '用户搜索失败'));
		} finally {
			platformUserSearchLoading = false;
			renderSectionContent({ preserveScroll: true, focusSelector: '[data-platform-user-search-input]' });
		}
	}

	function renderOrganizationCreatePanel(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) {
			return '';
		}
		return `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">新建机构</div>
			<form class="pc-org-add-form pc-platform-org-create-form" data-platform-org-create-form>
				<div class="pc-org-form-grid pc-org-form-grid-3">
					<label class="pc-org-field"><span>机构名称</span><input class="pc-profile-input" data-platform-org-name placeholder="例如：东京日语学院" /></label>
					<label class="pc-org-field"><span>机构类型</span><select class="pc-profile-input pc-org-select" data-platform-org-type><option value="school">培训机构</option><option value="business">企业</option></select></label>
					<label class="pc-org-field"><span>席位数</span><input class="pc-profile-input" type="number" min="1" step="1" data-platform-org-seats value="20" /></label>
				</div>
				<div class="pc-org-form-grid">
					<label class="pc-org-field"><span>套餐</span><select class="pc-profile-input pc-org-select" data-platform-org-plan><option value="free">FREE</option><option value="pro">PRO</option><option value="ultra">ULTRA</option></select></label>
					<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">创建机构</button></div>
				</div>
				<div class="pc-admin-note">创建后会出现在下方机构列表；建议立即添加 2-3 名管理人员，例如机构管理员、校区管理员和教务运营。学生、老师和学习组由机构管理员进入机构后维护。</div>
			</form>
		</div>`;
	}

	function managedOrganizationModeLabel(mode: ManagedOrganizationMode): string {
		if (mode === 'permissions') return '权限管理';
		if (mode === 'groups') return '课程与学习组';
		if (mode === 'settings') return '机构设置';
		if (mode === 'coursePackages') return '课程包';
		if (mode === 'subscription') return '套餐与席位';
		if (mode === 'members') return '成员管理';
		return '完整管理';
	}

	function renderManagedOrganizationOverview(organization: ManagedOrganization, mode: ManagedOrganizationMode): string {
		const memberCount = organization.members.length || organization.memberCount;
		const metrics = (() => {
			if (mode === 'platform') {
				return [
					{ label: '套餐', value: planLabel(organization.plan) },
					{ label: '状态', value: organization.status || 'active' },
					{ label: '到期', value: organizationExpiryLabel(organization.expiresAt) },
					{ label: '成员', value: `${memberCount}/${organization.seats || defaultSeatsForPlan(organization.plan)}` }
				];
			}
			if (mode === 'groups') {
				return [
					{ label: '学习组', value: String(organization.learningGroups.length) },
					{ label: '校区', value: String(organization.campuses.length) },
					{ label: '课程包', value: String(organization.coursePackages.length) },
					{ label: '成员', value: String(memberCount) }
				];
			}
			if (mode === 'subscription') {
				return [
					{ label: '套餐', value: planLabel(organization.plan) },
					{ label: '状态', value: organization.status || 'active' },
					{ label: '到期', value: organizationExpiryLabel(organization.expiresAt) },
					{ label: '席位', value: `${memberCount}/${organization.seats || defaultSeatsForPlan(organization.plan)}` }
				];
			}
			if (mode === 'settings') {
				return [
					{ label: '套餐', value: planLabel(organization.plan) },
					{ label: '校区', value: String(organization.campuses.length) },
					{ label: '席位', value: `${memberCount}/${organization.seats || defaultSeatsForPlan(organization.plan)}` },
					{ label: '审计', value: `${Math.min(organization.auditLogs.length, 8)}条` }
				];
			}
			if (mode === 'coursePackages') {
				return [
					{ label: '课程包', value: String(organization.coursePackages.length) },
					{ label: '学习组', value: String(organization.learningGroups.length) },
					{ label: '成员', value: String(memberCount) },
					{ label: '状态', value: organization.status || 'active' }
				];
			}
			return [
				{ label: '套餐', value: planLabel(organization.plan) },
				{ label: '状态', value: organization.status || 'active' },
				{ label: '成员', value: String(memberCount) },
				{ label: '席位', value: String(organization.seats || defaultSeatsForPlan(organization.plan)) }
			];
		})();
		return `<div class="pc-org-overview">
			<div>
				<div class="pc-org-name">${escapeHtml(organization.name)}</div>
			</div>
			<div class="pc-org-seat">${escapeHtml(organizationSeatSummary(organization))}</div>
		</div>
		<div class="pc-org-meta">
			${metrics.map((item) => `<div class="pc-org-metric"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}
		</div>`;
	}

	function renderManagedOrganizationSection(organization: ManagedOrganization, mode: ManagedOrganizationMode, open = true): string {
		const detailState = managedOrganizationDetailState[organization.id];
		if (!open || detailState !== 'loaded') {
			const status = detailState === 'error'
				? '<div class="pc-admin-note">详情加载失败，请收起后重新展开。</div>'
				: '<div class="pc-admin-note">正在按需读取机构详情...</div>';
			return `<details class="pc-card pc-lite-list-card pc-managed-org-card" data-managed-org-id="${escapeHtml(organization.id)}" data-managed-org-mode="${escapeHtml(mode)}"${open ? ' open' : ''}>
				<summary class="pc-managed-org-summary">${renderManagedOrganizationOverview(organization, mode)}</summary>
				${open ? `<div class="pc-managed-org-body">${status}</div>` : ''}
			</details>`;
		}
		const managerMembers = organization.members.filter((member) => member.roles.includes('orgAdmin') || member.roles.includes('assistant'));
		const managerEditors = managerMembers.length
			? managerMembers.map((member) => renderOrganizationMemberEditor(organization, member)).join('')
			: '<div class="pc-org-empty">当前还没有额外管理人员。建议至少添加一名机构管理员和一名教务运营。</div>';
		const panels: string[] = [];
		if (mode === 'platform') {
			panels.push(renderOrganizationSubscriptionPanel(organization));
			panels.push(renderOrganizationManagerPanel(organization));
			panels.push(`<div class="pc-org-subsection"><div class="pc-org-subsection-head"><h4>现有管理人员</h4><span>${escapeHtml(String(managerMembers.length))} 人</span></div>${managerEditors}</div>`);
			panels.push(renderOrganizationAuditPanel(organization));
		} else if (mode === 'permissions') {
			if (activeRoleContent === 'platform-roles') {
				panels.push(renderOrganizationRoleDefaultsPanel(organization));
			} else {
				panels.push(renderOrganizationMembersByRolePanel(organization));
				panels.push(renderOrganizationRoleDefaultsAdvancedPanel(organization));
				panels.push(renderOrganizationAuditPanel(organization));
			}
		} else if (mode === 'groups') {
			panels.push(renderOrganizationLearningGroupPanel(organization));
			panels.push(renderOrganizationSchedulePanel(organization));
			panels.push(renderOrganizationCoursePackagePanel(organization));
		} else if (mode === 'settings') {
			panels.push(renderOrganizationSubscriptionPanel(organization));
			panels.push(renderOrganizationCampusPanel(organization));
			panels.push(renderOrganizationAuditPanel(organization));
		} else if (mode === 'coursePackages') {
			panels.push(renderOrganizationCoursePackagePanel(organization));
			panels.push(renderOrganizationSchedulePanel(organization));
		} else if (mode === 'subscription') {
			panels.push(renderOrganizationSubscriptionPanel(organization));
			panels.push(renderOrganizationCoursePackagePanel(organization));
		} else {
			panels.push(renderOrganizationMembersByRolePanel(organization));
			panels.push(renderOrganizationAuditPanel(organization));
		}
		return `<details class="pc-card pc-lite-list-card pc-managed-org-card" data-managed-org-id="${escapeHtml(organization.id)}" data-managed-org-mode="${escapeHtml(mode)}"${open ? ' open' : ''}>
			<summary class="pc-managed-org-summary">
				${renderManagedOrganizationOverview(organization, mode)}
			</summary>
			<div class="pc-managed-org-body">${panels.join('')}</div>
		</details>`;
	}

	function renderManagedOrganizationPage(ctx: PCContext, mode: ManagedOrganizationMode): string {
		if (!canManageMembers(ctx)) {
			return renderDashboardSubpage('机构管理', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要机构管理员或超级管理员权限。</div></div>', '机构、成员和课程管理。');
		}
		if (managedOrganizationsCacheKey !== managedOrganizationsKey(ctx) && !managedOrganizationsLoading) {
			void ensureManagedOrganizations(ctx);
		}
		const titleMap = {
			platform: '机构管理',
			permissions: activeRoleContent === 'platform-roles' ? '角色权限' : '权限管理',
			groups: '学习组',
			settings: '机构设置',
			coursePackages: '课程包',
			subscription: activeRoleContent === 'org-plan' ? '机构套餐' : '席位',
			members: activeRoleContent === 'org-audit' ? '审计日志' : activeRoleContent === 'org-invites' ? '邀请码' : '成员管理'
		};
		const subtitleMap = {
			platform: '超级管理员创建机构；机构管理员维护自己机构的成员、课程和席位。',
			permissions: activeRoleContent === 'platform-roles' ? '查看角色默认能力、权限模板和授权规则。' : '维护当前机构的角色权限差异，再按成员设置学生/老师/教学运营/机构管理员角色。',
			groups: '班级、小班、一对一约课和课程包扣课。',
			settings: '机构资料、套餐席位、校区信息和操作审计。',
			coursePackages: '课程包购买、剩余课时、扣课、到期和续费风险。',
			subscription: '机构套餐、席位、课程包和续费风险。',
			members: '账号已存在时直接添加；账号未创建时先发邀请。'
		};
		const createPanel = mode === 'platform' ? renderOrganizationCreatePanel(ctx) : '';
		const listControls = `<div class="pc-card pc-managed-org-toolbar"><form data-managed-org-list-form>
			<div class="pc-managed-org-search"><label class="pc-org-field"><span>搜索机构</span><span class="pc-managed-org-search-controls"><input class="pc-profile-input" data-managed-org-query value="${escapeHtml(managedOrganizationListPage.query)}" placeholder="机构名称或 ID" /><button class="pc-inline-btn" type="submit">搜索</button></span></label></div>
			<div class="pc-managed-org-pagination"><button class="pc-inline-ghost" type="button" data-managed-org-page="prev"${managedOrganizationListPage.page <= 1 || managedOrganizationsLoading ? ' disabled' : ''}>上一页</button><span class="pc-managed-org-page-status">共 ${managedOrganizationListPage.total} 个 · 第 ${managedOrganizationListPage.page}/${Math.max(1, managedOrganizationListPage.pages)} 页</span><button class="pc-inline-ghost" type="button" data-managed-org-page="next"${managedOrganizationListPage.page >= managedOrganizationListPage.pages || managedOrganizationsLoading ? ' disabled' : ''}>下一页</button></div>
		</form></div>`;
		const body = `${createPanel}${listControls}${
			managedOrganizationsLoading
				? '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取机构数据...</div></div>'
				: managedOrganizations.length
					? managedOrganizations.map((organization) => {
							const stateKey = `${mode}:${organization.id}`;
							const openState = managedOrganizationOpenState[stateKey];
							return renderManagedOrganizationSection(organization, mode, openState === true);
					  }).join('')
					: '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">还没有可管理机构。超级管理员可以先创建机构。</div></div>'
		}`;
		return renderDashboardSubpage(titleMap[mode], body, subtitleMap[mode]);
	}

	async function createPlatformOrganization(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const nameInput = form.querySelector('[data-platform-org-name]') as HTMLInputElement | null;
		const seatsInput = form.querySelector('[data-platform-org-seats]') as HTMLInputElement | null;
		const name = (nameInput?.value || '').trim();
		if (!name) {
			setFieldError(nameInput, '请填写机构名称');
			return;
		}
		const seats = Number(seatsInput?.value || '0');
		if (!Number.isInteger(seats) || seats < 1) { setFieldError(seatsInput, '席位数必须是大于 0 的整数'); return; }
		if (!token || !api || typeof api.createOrganization !== 'function') {
			showToast('机构创建接口不可用');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit) {
			submit.disabled = true;
			submit.textContent = '创建中...';
		}
		try {
			await api.createOrganization(token, {
				name,
				organization_type: (form.querySelector('[data-platform-org-type]') as HTMLSelectElement | null)?.value || 'school',
				seats,
				plan: (form.querySelector('[data-platform-org-plan]') as HTMLSelectElement | null)?.value || 'free',
				owner_roles: ['orgAdmin']
			});
			invalidateManagedOrganizations();
			showToast('机构已创建');
			await ensureManagedOrganizations(getContext());
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			setFieldError(nameInput, readErrorMessage(error, '机构创建失败'));
			showToast(readErrorMessage(error, '机构创建失败'));
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.textContent = '创建机构';
			}
		}
	}

	async function loadPlatformStats(): Promise<void> {
		if (platformStatsLoading || platformStatsLoaded) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.getAdminStatisticsOverview !== 'function') {
			platformStatsLoaded = true;
			return;
		}
		platformStatsLoading = true;
		try {
			platformStatsOverview = asRecord(await api.getAdminStatisticsOverview());
			platformStatsLoaded = true;
		} catch (error) {
			log('load platform stats failed', error);
		} finally {
			platformStatsLoading = false;
			if (shouldRefreshRoleContent('platform-stats')) {
				renderSectionContent({ preserveScroll: true });
			}
		}
	}

	async function loadPlatformSystemFlags(force = false): Promise<void> {
		if (platformSystemFlagsLoading || (platformSystemFlagsLoaded && !force)) return;
		const api = window.APIClient;
		if (!api || typeof api.getSystemFeatureFlags !== 'function') {
			platformSystemFlagsError = '当前客户端不支持读取系统开关';
			platformSystemFlagsLoaded = true;
			return;
		}
		platformSystemFlagsLoading = true;
		platformSystemFlagsError = '';
		try {
			const payload = asRecord(await api.getSystemFeatureFlags()) || {};
			const flags = asRecord(payload.flags) || {};
			platformSystemFlags = Object.values(flags)
				.map((item): PlatformSystemFlag | null => {
					const raw = asRecord(item);
					const key = readString(raw?.key);
					if (!raw || !key) return null;
					return {
						key,
						name: readString(raw.name) || key,
						description: readString(raw.description) || '',
						enabled: readBoolean(raw.enabled) ?? false,
						locked: readBoolean(raw.locked) ?? false,
						source: readString(raw.source) === 'system' ? 'system' : 'default',
						allowOrgOverride: readBoolean(raw.allow_org_override) ?? false,
						allowUserOverride: readBoolean(raw.allow_user_override) ?? false
					};
				})
				.filter((item): item is PlatformSystemFlag => Boolean(item));
			platformSystemFlagsLoaded = true;
		} catch (error) {
			platformSystemFlagsError = readErrorMessage(error, '系统开关读取失败');
			platformSystemFlagsLoaded = true;
		} finally {
			platformSystemFlagsLoading = false;
			if (shouldRefreshRoleContent('platform-flags')) {
				renderSectionContent({ preserveScroll: true });
			}
		}
	}

	function renderPlatformSystemFlagsPage(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) {
			return renderDashboardSubpage('功能开关', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要超级管理员权限。</div></div>', '系统级开关只允许超级管理员维护。');
		}
		if (!platformSystemFlagsLoaded && !platformSystemFlagsLoading) void loadPlatformSystemFlags();
		const rows = platformSystemFlags.map((flag) => {
			const pending = pendingPlatformSystemFlags.has(flag.key);
			const overrideText = flag.locked
				? '已锁定：机构和个人不能覆盖'
				: `允许覆盖：${[flag.allowOrgOverride ? '机构' : '', flag.allowUserOverride ? '个人' : ''].filter(Boolean).join('、') || '无'}`;
			return `<div class="pc-lite-row pc-lite-row-static" data-platform-system-flag-row="${escapeHtml(flag.key)}">
				<span><strong>${escapeHtml(flag.name)}</strong><em>${escapeHtml(flag.key)} · ${escapeHtml(flag.description || '暂无说明')} · ${escapeHtml(overrideText)}</em></span>
				<div class="pc-feedback-actions">
					<span class="pc-tag ${flag.enabled ? '' : 'muted'}">${flag.enabled ? 'ON' : 'OFF'}</span>
					<span class="pc-tag muted">${flag.source === 'system' ? '系统设置' : '默认值'}</span>
					<button class="pc-inline-btn" type="button" data-platform-system-flag="${escapeHtml(flag.key)}" data-platform-system-flag-action="enabled" ${pending ? 'disabled' : ''}>${pending ? '提交中...' : flag.enabled ? '关闭' : '开启'}</button>
					<button class="pc-inline-ghost" type="button" data-platform-system-flag="${escapeHtml(flag.key)}" data-platform-system-flag-action="locked" ${pending ? 'disabled' : ''}>${flag.locked ? '解除锁定' : '锁定下层'}</button>
					${flag.source === 'system' ? `<button class="pc-inline-ghost" type="button" data-platform-system-flag="${escapeHtml(flag.key)}" data-platform-system-flag-action="default" ${pending ? 'disabled' : ''}>恢复默认</button>` : ''}
				</div>
			</div>`;
		}).join('');
		const content = platformSystemFlagsError
			? `<div class="pc-admin-note">${escapeHtml(platformSystemFlagsError)} <button class="pc-inline-btn" type="button" data-platform-system-flags-retry>重试</button></div>`
			: platformSystemFlagsLoading
				? '<div class="pc-admin-note">正在读取真实系统开关...</div>'
				: rows || '<div class="pc-admin-note">后端没有返回可管理的系统开关。</div>';
		const body = `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">系统功能开关</div><div class="pc-admin-note">状态直接来自系统层。锁定后，机构和个人层不能覆盖该开关；每次修改都需要输入开关键确认。</div><div class="pc-lite-list">${content}</div></div>`;
		return renderDashboardSubpage('功能开关', body, '真实系统层状态、默认来源和下层覆盖规则。');
	}

	async function updatePlatformSystemFlag(key: string, action: 'enabled' | 'locked' | 'default'): Promise<void> {
		const api = window.APIClient;
		const flag = platformSystemFlags.find((item) => item.key === key);
		if (!flag || pendingPlatformSystemFlags.has(key) || !api || typeof api.updateSystemFeatureFlags !== 'function') return;
		pendingPlatformSystemFlags.add(key);
		renderSectionContent({ preserveScroll: true });
		try {
			const reauthPassword = await requestHighRiskPassword('修改系统功能开关');
			if (reauthPassword === null) return;
			await api.updateSystemFeatureFlags(action === 'default' ? { [key]: null } : {
				[key]: {
					enabled: action === 'enabled' ? !flag.enabled : flag.enabled,
					lock: action === 'locked' ? !flag.locked : flag.locked
				}
			}, reauthPassword);
			platformSystemFlagsLoaded = false;
			await loadPlatformSystemFlags(true);
			showToast(`${flag.name}已${action === 'default' ? '恢复默认' : action === 'enabled' ? (flag.enabled ? '关闭' : '开启') : (flag.locked ? '解除锁定' : '锁定下层覆盖')}`);
		} catch (error) {
			showToast(readErrorMessage(error, '系统开关更新失败'));
		} finally {
			pendingPlatformSystemFlags.delete(key);
			if (shouldRefreshRoleContent('platform-flags')) renderSectionContent({ preserveScroll: true });
		}
	}

	function renderPlatformStatsPage(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) {
			return renderDashboardSubpage('全站统计', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要超级管理员权限。</div></div>', '注册、活跃、学习和机构数据。');
		}
		if (!platformStatsLoaded && !platformStatsLoading) {
			void loadPlatformStats();
		}
		const users = asRecord(platformStatsOverview?.users);
		const orgs = asRecord(platformStatsOverview?.organizations);
		const content = asRecord(platformStatsOverview?.content);
		const activity = asRecord(platformStatsOverview?.activity);
		const byRole = asRecord(users?.by_role);
		const rows: RoleContentRow[] = platformStatsOverview ? [
			{ title: '用户总数', desc: `平台账号 ${readCount(users?.total) ?? 0} 个`, meta: '真实统计' },
			{ title: '角色分布', desc: ['student', 'teacher', 'assistant', 'orgAdmin', 'contentAdmin', 'superAdmin'].map((role) => `${role}:${readCount(byRole?.[role]) ?? 0}`).join(' · '), meta: '角色' },
			{ title: '机构总数', desc: `${readCount(orgs?.total) ?? 0} 个机构`, meta: '机构' },
			{ title: '内容文件', desc: `${readCount(content?.exam_files) ?? 0} 个试卷/内容 JSON`, meta: '内容' },
			{ title: '学习活跃', desc: `答题用户 ${readCount(activity?.answer_users) ?? 0} · 答题快照 ${readCount(activity?.answer_papers) ?? 0}`, meta: '学习' },
			{ title: '反馈数据', desc: `反馈试卷 ${readCount(activity?.feedback_papers) ?? 0} · 反馈条目 ${readCount(activity?.feedback_items) ?? 0}`, meta: '反馈' }
		] : [{ title: platformStatsLoading ? '读取中' : '暂无统计', desc: '统计接口会扫描 data/user 与 data/paper 目录生成聚合数据。', meta: '' }];
		return renderDashboardSubpage('全站统计', renderRoleListCard('全站统计', rows), '这些数据来自后端统计接口，不再使用页面写死的数字。');
	}

	async function loadFeedbackQueue(force = false): Promise<void> {
		if (platformFeedbackLoading || (platformFeedbackLoaded && !force)) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.listFeedback !== 'function') {
			platformFeedbackLoaded = true;
			return;
		}
		platformFeedbackLoading = true;
		try {
			const payload = asRecord(await api.listFeedback('', '', { page: platformFeedbackPage, page_size: platformFeedbackPageSize, q: platformFeedbackQuery, sort: platformFeedbackSort, order: platformFeedbackOrder })) || {};
			const items = Array.isArray(payload.items) ? payload.items : [];
			platformFeedbackItems = items.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
			platformFeedbackTotal = readCount(payload.total) ?? platformFeedbackItems.length;
			platformFeedbackPages = readCount(payload.pages) ?? 0;
			platformFeedbackLoaded = true;
		} catch (error) {
			log('load feedback queue failed', error);
			platformFeedbackItems = [];
			platformFeedbackLoaded = true;
		} finally {
			platformFeedbackLoading = false;
			if (shouldRefreshRoleContent('platform-feedback', 'content-feedback')) {
				renderSectionContent({ preserveScroll: true });
			}
		}
	}

	function feedbackIdOf(item: Record<string, unknown>): string {
		return readString(item.feedback_id) || readString(item.id) || '';
	}

	function feedbackPaperIdOf(item: Record<string, unknown>): string {
		return readString(item.paper_id) || readString(item.paperId) || readString(item.exam_id) || '';
	}

	function feedbackQuestionIdOf(item: Record<string, unknown>): string {
		return readString(item.question_id) || readString(item.questionId) || '';
	}

	type FeedbackQueueKind = 'all' | 'paper' | 'analysis' | 'quality';

	function feedbackQueueKindOf(item: Record<string, unknown>): Exclude<FeedbackQueueKind, 'all'> {
		const category = (readString(item.category) || '').toLowerCase();
		const description = `${readString(item.description)} ${readString(item.content)} ${readString(item.title)}`.toLowerCase();
		if (/typo|paper|content|题干|选项|图片|音频|题号|错字|错别字|排版/.test(`${category} ${description}`)) {
			return 'paper';
		}
		if (/answer|analysis|解析|答案|翻译|假名|说明/.test(`${category} ${description}`)) {
			return 'analysis';
		}
		if (/quality|missing|invalid|wrong|复核|质量|缺失|错误|错位|闭环|playwright|e2e/.test(`${category} ${description}`)) {
			return 'quality';
		}
		return category === 'question' ? 'paper' : 'quality';
	}

	function feedbackQueueKindLabel(kind: FeedbackQueueKind): string {
		if (kind === 'paper') return '试卷维护';
		if (kind === 'analysis') return '解析审核';
		if (kind === 'quality') return '质量检查';
		return '全部反馈';
	}

	function feedbackStatusLabel(status: string): string {
		if (status === 'reviewing') return '处理中';
		if (status === 'resolved' || status === 'closed') return '已关闭';
		if (status === 'rejected') return '已驳回';
		return '待处理';
	}

	function renderFeedbackQueuePage(ctx: PCContext, title: string, subtitle: string, queueKind: FeedbackQueueKind): string {
		if (!hasAnyRole(ctx, ['superAdmin', 'contentAdmin'])) {
			return renderDashboardSubpage(title, '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要内容管理员或超级管理员权限。</div></div>', subtitle);
		}
		if (!platformFeedbackLoaded && !platformFeedbackLoading) {
			void loadFeedbackQueue();
		}
		const counts = platformFeedbackItems.reduce<Record<Exclude<FeedbackQueueKind, 'all'>, number>>((acc, item) => {
			acc[feedbackQueueKindOf(item)] += 1;
			return acc;
		}, { paper: 0, analysis: 0, quality: 0 });
		const items = queueKind === 'all'
			? platformFeedbackItems
			: platformFeedbackItems.filter((item) => feedbackQueueKindOf(item) === queueKind);
		const emptyText = queueKind === 'all'
			? '当前没有反馈。学生提交题目反馈后，会在这里进入受理和关闭流程。'
			: `当前没有${feedbackQueueKindLabel(queueKind)}反馈。学生提交题目反馈后，会按内容自动分到对应队列。`;
		const listMarkup = items.length
			? items.map((item) => {
				const id = feedbackIdOf(item);
				const paperId = feedbackPaperIdOf(item);
				const status = readString(item.status) || 'open';
				const titleText = readString(item.category) || '用户反馈';
				const description = readString(item.description) || readString(item.content) || '未填写详细说明';
				const questionId = feedbackQuestionIdOf(item);
				const kind = feedbackQueueKindOf(item);
				const canOpen = Boolean(paperId);
				return `<div class="pc-lite-row pc-lite-row-static pc-feedback-row">
					<span><strong>${escapeHtml(feedbackQueueKindLabel(kind))} · ${escapeHtml(titleText)}${questionId ? ` · ${escapeHtml(questionId)}` : ''}</strong><em>${escapeHtml(paperId || '未关联试卷')} · ${escapeHtml(description)}</em></span>
					<div class="pc-feedback-actions">
						<span class="pc-tag muted">${escapeHtml(feedbackStatusLabel(status))}</span>
						${canOpen ? `<button class="pc-inline-ghost" type="button" data-feedback-open-question data-feedback-paper-id="${escapeHtml(paperId)}" data-feedback-question-id="${escapeHtml(questionId)}">${questionId ? '查看题目' : '查看试卷'}</button>` : ''}
						${id ? `<button class="pc-inline-ghost" type="button" data-feedback-update data-feedback-id="${escapeHtml(id)}" data-feedback-paper-id="${escapeHtml(paperId)}" data-feedback-status="reviewing">受理</button><button class="pc-inline-btn" type="button" data-feedback-update data-feedback-id="${escapeHtml(id)}" data-feedback-paper-id="${escapeHtml(paperId)}" data-feedback-status="resolved">关闭</button>` : ''}
					</div>
				</div>`;
			}).join('')
			: `<div class="pc-admin-note">${platformFeedbackLoading ? '正在读取反馈列表...' : emptyText}${platformFeedbackLoading ? '' : ' <button class="pc-inline-btn" type="button" data-platform-feedback-refresh>重新加载</button>'}</div>`;
		const controls = `<form class="pc-org-add-form" data-platform-feedback-search-form><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>搜索反馈</span><input class="pc-profile-input" data-platform-feedback-query value="${escapeHtml(platformFeedbackQuery)}" placeholder="试卷、题号、用户或描述" /></label><label class="pc-org-field"><span>排序</span><select class="pc-profile-input" data-platform-feedback-sort><option value="created_at"${platformFeedbackSort === 'created_at' ? ' selected' : ''}>时间</option><option value="status"${platformFeedbackSort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序 / 每页</span><span><select class="pc-profile-input" data-platform-feedback-order><option value="desc"${platformFeedbackOrder === 'desc' ? ' selected' : ''}>降序</option><option value="asc"${platformFeedbackOrder === 'asc' ? ' selected' : ''}>升序</option></select><select class="pc-profile-input" data-platform-feedback-page-size><option value="10"${platformFeedbackPageSize === 10 ? ' selected' : ''}>10 条</option><option value="20"${platformFeedbackPageSize === 20 ? ' selected' : ''}>20 条</option><option value="50"${platformFeedbackPageSize === 50 ? ' selected' : ''}>50 条</option></select></span></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button><button class="pc-inline-ghost" type="button" data-platform-feedback-page="prev"${platformFeedbackPage <= 1 ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">第 ${platformFeedbackPage} / ${Math.max(1, platformFeedbackPages)} 页</span><button class="pc-inline-ghost" type="button" data-platform-feedback-page="next"${platformFeedbackPage >= platformFeedbackPages ? ' disabled' : ''}>下一页</button></div></form>`;
		const body = `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">${escapeHtml(title)}</div>
			<div class="pc-admin-note">列表来自反馈接口；试卷维护处理题干/选项/图片/音频，解析审核处理答案/解析/翻译，质量检查处理缺失、错位和复核类问题。“查看题目”会打开对应试卷并定位到题号。</div>
			${controls}<div class="pc-feedback-summary"><span>全部 ${escapeHtml(String(platformFeedbackTotal))}</span><span>本页试卷维护 ${escapeHtml(String(counts.paper))}</span><span>解析审核 ${escapeHtml(String(counts.analysis))}</span><span>质量检查 ${escapeHtml(String(counts.quality))}</span></div>
			<div class="pc-lite-list">${listMarkup}</div>
		</div>`;
		return renderDashboardSubpage(title, body, subtitle);
	}

	function renderPlatformPaymentsPage(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) {
			return renderDashboardSubpage('支付退款', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要超级管理员权限。</div></div>', '订单、流水、退款和对账状态。');
		}
		if (!platformPaymentsLoaded && !platformPaymentsLoading) void loadPlatformPayments();
		const { orders, refunds, ledger, anomalies, totalOrders, totalRefunds, totalLedger, pages } = platformPaymentState;
		const paymentLink = (label: string, intent: string) => `<button class="pc-inline-ghost" type="button" data-intent="${escapeHtml(intent)}">${escapeHtml(label)}</button>`;
		const orderRows = orders.length ? orders.map((order) => {
			const id = readString(order.id) || '';
			const scope = readString(order.scope_type) || 'user';
			const scopeId = readString(order.scope_id) || readString(order.organization_id) || readString(order.user_id);
			return `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(id)} · ${scope === 'organization' ? '机构扩席' : '个人订阅'}</strong><em>${escapeHtml(readString(order.description) || `${(readString(order.plan) || '').toUpperCase()} 套餐`)} · ${escapeHtml(formatPaymentAmount(readNumber(order.amount_cents) ?? 0, readString(order.currency) || 'cny'))} · ${escapeHtml(readString(order.provider) || '')}</em></span><div class="pc-feedback-actions"><span class="pc-tag muted">${escapeHtml(readString(order.status) || 'pending')}</span>${paymentLink('详情', openRoleContentIntent(`platform-payment-order:${encodeURIComponent(id)}`))}${scope === 'user' && scopeId ? paymentLink('用户', openRoleContentIntent(`user:${encodeURIComponent(scopeId)}`)) : ''}</div></div>`;
		}).join('') : `<div class="pc-admin-note">${platformPaymentsLoading ? '正在读取真实订单...' : '暂无支付订单。订单创建后会显示在这里。'}</div>`;
		const refundRows = refunds.length ? refunds.map((refund) => {
			const id = readString(refund.id) || '';
			const orderId = readString(refund.order_id) || '';
			const final = ['succeeded', 'rejected', 'cancelled'].includes(readString(refund.status) || '');
			return `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(id)} · ${escapeHtml(formatPaymentAmount(-(readNumber(refund.amount_cents) ?? 0), readString(refund.currency) || 'cny'))}</strong><em>订单 ${escapeHtml(orderId)} · ${escapeHtml(readString(refund.reason) || 'user_requested')} · ${escapeHtml(readString(refund.provider))}</em></span><div class="pc-feedback-actions"><span class="pc-tag muted">${escapeHtml(readString(refund.status) || 'requested')}</span>${paymentLink('详情', openRoleContentIntent(`platform-payment-refund:${encodeURIComponent(id)}`))}${paymentLink('订单', openRoleContentIntent(`platform-payment-order:${encodeURIComponent(orderId)}`))}</div></div>${final ? '' : `<form class="pc-org-add-form" data-platform-refund-status-form data-refund-id="${escapeHtml(id)}"><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>流转状态</span><select class="pc-profile-input" data-refund-next-status><option value="processing">处理中</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="rejected">驳回</option><option value="cancelled">取消</option></select></label><label class="pc-org-field"><span>处理备注</span><input class="pc-profile-input" data-refund-status-note /></label><label class="pc-org-field"><span>当前密码</span><input class="pc-profile-input" type="password" data-refund-status-password autocomplete="current-password" /></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">更新退款状态</button></div></form>`}`;
		}).join('') : `<div class="pc-admin-note">${platformPaymentsLoading ? '正在读取退款申请...' : '暂无退款申请。'}</div>`;
		const ledgerRows = ledger.length ? ledger.map((entry) => {
			const orderId = readString(entry.order_id);
			return `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(readString(entry.type))} · ${escapeHtml(formatPaymentAmount(readNumber(entry.amount_cents) ?? 0, readString(entry.currency) || 'cny'))}</strong><em>${escapeHtml(readString(entry.summary))} · ${escapeHtml(readString(entry.created_at))}</em></span>${orderId ? paymentLink(orderId, openRoleContentIntent(`platform-payment-order:${encodeURIComponent(orderId)}`)) : ''}</div>`;
		}).join('') : `<div class="pc-admin-note">${platformPaymentsLoading ? '正在读取支付流水...' : '暂无支付流水。'}</div>`;
		const anomalyRows = anomalies.length ? anomalies.map((item) => `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(readString(item.summary) || readString(item.type))}</strong><em>${escapeHtml(readString(item.type))} · 订单 ${escapeHtml(readString(item.order_id) || '—')} · 退款 ${escapeHtml(readString(item.refund_id) || '—')}</em></span><span class="pc-tag muted">${escapeHtml(readString(item.severity) || 'medium')}</span></div>`).join('') : `<div class="pc-admin-note">${platformPaymentsLoading ? '正在执行对账检查...' : '当前未发现对账异常。'}</div>`;
		const refundForm = `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">发起退款</div>
			<form class="pc-org-add-form" data-platform-refund-form>
				<div class="pc-org-form-grid pc-org-form-grid-3">
					<label class="pc-org-field"><span>订单号</span><input class="pc-profile-input" data-platform-refund-order-id placeholder="pay_..." /></label>
					<label class="pc-org-field"><span>退款金额（元，可留空全额）</span><input class="pc-profile-input" type="number" min="0" step="0.01" data-platform-refund-amount /></label>
					<label class="pc-org-field"><span>原因</span><input class="pc-profile-input" data-platform-refund-reason value="user_requested" /></label>
				</div>
				<label class="pc-org-field"><span>当前密码（二次验证）</span><input class="pc-profile-input" type="password" autocomplete="current-password" data-platform-refund-password placeholder="无密码账号可留空" /></label>
				<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">提交退款申请</button></div>
				<div class="pc-admin-note">退款接口只接受已支付订单；微信/支付宝/Stripe 商户参数齐全时会尝试调用渠道退款，否则进入人工/渠道后台处理状态。</div>
			</form>
		</div>`;
		const organizationOrderForm = `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">创建机构套餐订单</div><form class="pc-org-add-form" data-organization-payment-order-form><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>机构 ID</span><input class="pc-profile-input" data-org-payment-organization-id required /></label><label class="pc-org-field"><span>套餐</span><select class="pc-profile-input" data-org-payment-plan><option value="pro">机构 PRO</option><option value="ultra">机构 ULTRA</option></select></label><label class="pc-org-field"><span>有效成员席位</span><input class="pc-profile-input" type="number" min="${paymentPricingConfig.catalogs.organization.minimumSeats.pro}" max="${paymentPricingConfig.catalogs.organization.customQuoteMinSeats - 1}" value="${paymentPricingConfig.catalogs.organization.minimumSeats.pro}" data-org-payment-seats /></label><label class="pc-org-field"><span>计费周期</span><select class="pc-profile-input" data-org-payment-days><option value="30">月付 · 30 天</option><option value="365" selected>年付 · 365 天（推荐）</option></select></label><label class="pc-org-field"><span>渠道</span><select class="pc-profile-input" data-org-payment-provider><option value="wechat"${paymentPricingConfig.defaultProvider === 'wechat' ? ' selected' : ''}>微信</option><option value="alipay"${paymentPricingConfig.defaultProvider === 'alipay' ? ' selected' : ''}>支付宝</option><option value="stripe"${paymentPricingConfig.defaultProvider === 'stripe' ? ' selected' : ''}>Stripe</option></select></label><label class="pc-org-field"><span>当前密码</span><input class="pc-profile-input" type="password" autocomplete="current-password" data-org-payment-password /></label></div><div class="pc-pricing-order-preview" data-org-payment-preview>${organizationPaymentPreviewText('pro', 365, paymentPricingConfig.catalogs.organization.minimumSeats.pro)}</div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">创建机构订单</button></div><div class="pc-admin-note">教师与管理员不占付费席位；${paymentPricingConfig.catalogs.organization.customQuoteMinSeats} 席及以上转企业销售定制报价。</div></form></div>`;
		const shortcuts = renderRoleListCard('支付配置', [
			{ title: '套餐价格', desc: '维护 PRO / ULTRA 的 30、90、365 天真实价格', meta: '设置', intent: openRoleContentIntent('platform-pricing') },
			{ title: '我的支付流水', desc: '从用户视角核对当前管理员账号的支付流水', meta: '查看', intent: 'openPaymentLedger' }
		]);
		const search = `<form class="pc-org-add-form" data-platform-payment-search-form><div class="pc-org-form-grid"><label class="pc-org-field"><span>查询订单 / 退款 / 用户 / 流水</span><input class="pc-profile-input" data-platform-payment-query value="${escapeHtml(platformPaymentQuery)}" placeholder="输入订单号、退款号、用户 ID 或渠道" /></label><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">查询</button>${platformPaymentQuery ? '<button class="pc-inline-ghost" type="button" data-platform-payment-clear>清除</button>' : ''}</div></div></form>`;
		const paging = `<div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>排序字段</span><select class="pc-profile-input" data-platform-payment-sort><option value="created_at"${platformPaymentSort === 'created_at' ? ' selected' : ''}>时间</option><option value="amount"${platformPaymentSort === 'amount' ? ' selected' : ''}>金额</option><option value="status"${platformPaymentSort === 'status' ? ' selected' : ''}>状态</option></select></label><label class="pc-org-field"><span>顺序</span><select class="pc-profile-input" data-platform-payment-order><option value="desc"${platformPaymentOrder === 'desc' ? ' selected' : ''}>降序</option><option value="asc"${platformPaymentOrder === 'asc' ? ' selected' : ''}>升序</option></select></label><label class="pc-org-field"><span>每页</span><select class="pc-profile-input" data-platform-payment-page-size><option value="10"${platformPaymentPageSize === 10 ? ' selected' : ''}>10</option><option value="20"${platformPaymentPageSize === 20 ? ' selected' : ''}>20</option><option value="50"${platformPaymentPageSize === 50 ? ' selected' : ''}>50</option></select></label></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-platform-payment-page="prev"${platformPaymentPage <= 1 ? ' disabled' : ''}>上一页</button><span class="pc-tag muted">第 ${platformPaymentPage} / ${Math.max(1, pages)} 页</span><button class="pc-inline-ghost" type="button" data-platform-payment-page="next"${platformPaymentPage >= pages ? ' disabled' : ''}>下一页</button></div>`;
		const body = `${shortcuts}<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">支付链路总览</div>${search}${paging}<div class="pc-feedback-summary"><span>订单 ${totalOrders}</span><span>退款 ${totalRefunds}</span><span>流水 ${totalLedger}</span><span>异常 ${anomalies.length}</span></div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-platform-payments-refresh>刷新</button>${paymentLink('价格配置', openRoleContentIntent('platform-pricing'))}</div></div><div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">1. 订单 → 支付 → 权益</div><div class="pc-lite-list">${orderRows}</div></div><div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">2. 退款申请与状态流转</div><div class="pc-lite-list">${refundRows}</div></div><div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">3. 支付与权益流水</div><div class="pc-lite-list">${ledgerRows}</div></div><div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">4. 对账异常</div><div class="pc-lite-list">${anomalyRows}</div></div>${organizationOrderForm}${refundForm}`;
		return renderDashboardSubpage('支付退款 · 平台支付管理', body, '订单 → 支付 → 权益 → 退款 → 流水的真实闭环。');
	}

	function renderPlatformPaymentDetailPage(ctx: PCContext, kind: 'order' | 'refund', id: string): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) return renderDashboardSubpage('支付详情', '<div class="pc-admin-note">需要超级管理员权限。</div>', '');
		if (!platformPaymentsLoaded && !platformPaymentsLoading) void loadPlatformPayments();
		const item = (kind === 'order' ? platformPaymentState.orders : platformPaymentState.refunds).find((row) => readString(row.id) === id);
		if (!item) return renderDashboardSubpage(kind === 'order' ? '订单详情' : '退款详情', `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">${platformPaymentsLoading ? '正在读取详情...' : '记录不存在或不在当前查询范围。'}</div></div>`, '');
		const orderId = kind === 'order' ? id : (readString(item.order_id) || '');
		const relatedRefunds = platformPaymentState.refunds.filter((row) => readString(row.order_id) === orderId);
		const relatedLedger = platformPaymentState.ledger.filter((row) => readString(row.order_id) === orderId);
		const fields = Object.entries(item).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => `<div class="pc-info-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');
		const userId = readString(item.user_id) || '';
		const links = `<div class="pc-org-form-actions"><button class="pc-inline-ghost" type="button" data-intent="${escapeHtml(openRoleContentIntent('platform-payments'))}">返回支付管理</button>${userId ? `<button class="pc-inline-ghost" type="button" data-intent="${escapeHtml(openRoleContentIntent(`user:${encodeURIComponent(userId)}`))}">查看用户</button>` : ''}${kind === 'refund' ? `<button class="pc-inline-ghost" type="button" data-intent="${escapeHtml(openRoleContentIntent(`platform-payment-order:${encodeURIComponent(orderId)}`))}">查看订单</button>` : ''}</div>`;
		const relations = `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">关联退款（${relatedRefunds.length}）</div>${relatedRefunds.map((row) => `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(readString(row.id))}</strong><em>${escapeHtml(readString(row.status))} · ${escapeHtml(formatPaymentAmount(-(readNumber(row.amount_cents) ?? 0), readString(row.currency) || 'cny'))}</em></span></div>`).join('') || '<div class="pc-admin-note">无关联退款</div>'}</div><div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">关联流水（${relatedLedger.length}）</div>${relatedLedger.map((row) => `<div class="pc-lite-row pc-lite-row-static"><span><strong>${escapeHtml(readString(row.type))}</strong><em>${escapeHtml(readString(row.summary))} · ${escapeHtml(readString(row.created_at))}</em></span></div>`).join('') || '<div class="pc-admin-note">无关联流水</div>'}</div>`;
		return renderDashboardSubpage(kind === 'order' ? `订单 ${id}` : `退款 ${id}`, `${links}<div class="pc-card pc-info-card">${fields}</div>${relations}`, '订单、用户、退款和流水的关联详情。');
	}

	async function submitPlatformRefund(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const orderInput = form.querySelector('[data-platform-refund-order-id]') as HTMLInputElement | null;
		const amountInput = form.querySelector('[data-platform-refund-amount]') as HTMLInputElement | null;
		const orderId = (orderInput?.value || '').trim();
		if (!orderId) {
			setFieldError(orderInput, '请填写订单号');
			return;
		}
		if (!token || !api || typeof api.requestPaymentRefund !== 'function') {
			showToast('退款接口不可用');
			return;
		}
		const amountYuan = Number(amountInput?.value || '0');
		if (!Number.isFinite(amountYuan) || amountYuan < 0) {
			setFieldError(amountInput, '退款金额必须是大于或等于 0 的数字');
			return;
		}
		const payload: Record<string, unknown> = {
			order_id: orderId,
			reason: ((form.querySelector('[data-platform-refund-reason]') as HTMLInputElement | null)?.value || 'user_requested').trim() || 'user_requested',
			reauth_password: (form.querySelector('[data-platform-refund-password]') as HTMLInputElement | null)?.value || ''
		};
		if (Number.isFinite(amountYuan) && amountYuan > 0) {
			payload.amount_cents = Math.round(amountYuan * 100);
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit?.disabled) return;
		const amountText = Number.isFinite(amountYuan) && amountYuan > 0 ? `${amountYuan.toFixed(2)} 元` : '全额';
		if (!await requestConfirmation(`确认对订单 ${orderId} 发起${amountText}退款？提交后可能直接调用支付渠道。`)) return;
		payload.confirmation = '确认退款';
		payload.idempotency_key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? `refund-${crypto.randomUUID()}`
			: `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		if (submit) {
			submit.disabled = true;
			submit.textContent = '提交中...';
		}
		try {
			const result = asRecord(await api.requestPaymentRefund(token, payload));
			platformPaymentsLoaded = false;
			showToast(`退款申请已提交：${readString(result?.status) || 'requested'}`);
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			setFieldError(orderInput, readErrorMessage(error, '退款申请失败'));
			showToast(readErrorMessage(error, '退款申请失败'));
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.textContent = '提交退款申请';
			}
		}
	}

	function organizationPaymentPreviewText(plan: PaidPersonalPlan, days: number, seats: number): string {
		const catalog = paymentPricingConfig.catalogs.organization;
		if (seats >= catalog.customQuoteMinSeats) {
			return `<strong>定制报价</strong><span>${seats} 席已达到企业销售门槛，请转销售合同流程。</span>`;
		}
		const minimumSeats = catalog.minimumSeats[plan];
		if (seats < minimumSeats) {
			return `<strong>最低 ${minimumSeats} 席</strong><span>${plan.toUpperCase()} 当前席位数不足，无法创建自助订单。</span>`;
		}
		const unitCents = pricingAmountCents(plan, days, 'cny', 'organization', seats);
		const totalCents = unitCents * seats;
		const monthlyEquivalent = days === 365 ? totalCents / 12 : totalCents;
		return `<strong>${plan.toUpperCase()} · ${seats} 席 · ${days === 365 ? '年付' : '月付'}</strong>
			<span>单价 ${formatAmountCny(unitCents)}/席/${days === 365 ? '年' : '月'} · 合计 ${formatAmountCny(totalCents)}${days === 365 ? ` · 折合 ${formatAmountCny(Math.round(monthlyEquivalent))}/月` : '/月'}</span>`;
	}

	async function updateOrganizationPaymentPreview(form: HTMLFormElement, enforceMinimum = false): Promise<void> {
		const plan = ((form.querySelector('[data-org-payment-plan]') as HTMLSelectElement | null)?.value === 'ultra'
			? 'ultra'
			: 'pro') as PaidPersonalPlan;
		const days = Number((form.querySelector('[data-org-payment-days]') as HTMLSelectElement | null)?.value || '365');
		const seatsInput = form.querySelector('[data-org-payment-seats]') as HTMLInputElement | null;
		const minimumSeats = paymentPricingConfig.catalogs.organization.minimumSeats[plan];
		if (seatsInput) {
			seatsInput.min = String(minimumSeats);
			if (enforceMinimum && Number(seatsInput.value) < minimumSeats) seatsInput.value = String(minimumSeats);
		}
		const seats = Number(seatsInput?.value || minimumSeats);
		const preview = form.querySelector('[data-org-payment-preview]') as HTMLElement | null;
		if (!preview) return;
		preview.innerHTML = organizationPaymentPreviewText(plan, days, seats);
		if (seats < minimumSeats || seats >= paymentPricingConfig.catalogs.organization.customQuoteMinSeats) return;
		const organizationId = ((form.querySelector('[data-org-payment-organization-id]') as HTMLInputElement | null)?.value || '').trim();
		const api = window.APIClient;
		const token = activeToken(getContext());
		const sequence = ++organizationQuoteRequestSequence;
		if (!organizationId || !token || !api || typeof api.getPaymentQuote !== 'function') return;
		preview.insertAdjacentHTML('beforeend', '<span>正在确认该机构可用的首购、续费或活动优惠…</span>');
		try {
			const quote = normalizePaymentQuote(await api.getPaymentQuote(token, {
				scope_type: 'organization',
				organization_id: organizationId,
				plan,
				days,
				seats,
				currency: 'cny'
			}));
			if (sequence !== organizationQuoteRequestSequence || !quote || !preview.isConnected) return;
			preview.innerHTML = `${paymentQuoteMarkup(quote)}
				<span>优惠后单价 ${formatAmountCny(quote.unitPriceCents)}/席/${days === 365 ? '年' : '月'} · ${plan.toUpperCase()} · ${seats} 席</span>`;
		} catch (error) {
			if (sequence !== organizationQuoteRequestSequence || !preview.isConnected) return;
			preview.innerHTML = organizationPaymentPreviewText(plan, days, seats);
			preview.insertAdjacentHTML('beforeend', '<span>填写有效机构 ID 后可确认该机构的专属优惠。</span>');
		}
	}

	async function submitOrganizationPaymentOrder(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const token = activeToken(getContext());
		const api = window.APIClient;
		const organizationInput = form.querySelector('[data-org-payment-organization-id]') as HTMLInputElement | null;
		const seatsInput = form.querySelector('[data-org-payment-seats]') as HTMLInputElement | null;
		const organizationId = (organizationInput?.value || '').trim();
		if (!organizationId || !token || !api || typeof api.createOrganizationPaymentOrder !== 'function') {
			if (!organizationId) setFieldError(organizationInput, '请填写机构 ID');
			else showToast('机构扩席订单接口不可用');
			return;
		}
		const plan = ((form.querySelector('[data-org-payment-plan]') as HTMLSelectElement | null)?.value === 'ultra'
			? 'ultra'
			: 'pro') as PaidPersonalPlan;
		const seats = Number(seatsInput?.value || '0');
		const minimumSeats = paymentPricingConfig.catalogs.organization.minimumSeats[plan];
		if (!Number.isInteger(seats) || seats < minimumSeats) { setFieldError(seatsInput, `${plan.toUpperCase()} 最低购买 ${minimumSeats} 席`); return; }
		if (seats >= paymentPricingConfig.catalogs.organization.customQuoteMinSeats) {
			setFieldError(seatsInput, `${paymentPricingConfig.catalogs.organization.customQuoteMinSeats} 席及以上需要企业定制报价`);
			return;
		}
		if (!await requestConfirmation(`确认创建机构 ${organizationId} 的扩席支付订单？`)) return;
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit?.disabled) return;
		if (submit) { submit.disabled = true; submit.textContent = '创建中...'; }
		try {
			const order = asRecord(await api.createOrganizationPaymentOrder(token, {
				organization_id: organizationId,
				plan,
				seats,
				days: Number((form.querySelector('[data-org-payment-days]') as HTMLSelectElement | null)?.value || '30'),
				provider: (form.querySelector('[data-org-payment-provider]') as HTMLSelectElement | null)?.value || 'wechat',
				reauth_password: (form.querySelector('[data-org-payment-password]') as HTMLInputElement | null)?.value || '',
				confirmation: '确认创建扩席订单'
			}));
			platformPaymentsLoaded = false;
			showToast(`扩席订单已创建：${readString(order?.id)}`);
			await loadPlatformPayments(true);
		} catch (error) {
			setFieldError(organizationInput, readErrorMessage(error, '扩席订单创建失败'));
			showToast(readErrorMessage(error, '扩席订单创建失败'));
		} finally {
			if (submit) { submit.disabled = false; submit.textContent = '创建扩席订单'; }
		}
	}

	async function submitRefundStatus(form: HTMLFormElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const refundId = form.dataset.refundId || '';
		const status = (form.querySelector('[data-refund-next-status]') as HTMLSelectElement | null)?.value || 'processing';
		if (!refundId || !token || !api || typeof api.updatePaymentRefundStatus !== 'function') {
			showToast('退款状态接口不可用');
			return;
		}
		if (!await requestConfirmation(`确认将退款 ${refundId} 更新为 ${status}？`)) return;
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit?.disabled) return;
		if (submit) { submit.disabled = true; submit.textContent = '更新中...'; }
		try {
			await api.updatePaymentRefundStatus(token, refundId, {
				status,
				note: (form.querySelector('[data-refund-status-note]') as HTMLInputElement | null)?.value || '',
				reauth_password: (form.querySelector('[data-refund-status-password]') as HTMLInputElement | null)?.value || '',
				confirmation: '确认更新退款'
			});
			platformPaymentsLoaded = false;
			showToast('退款状态已更新');
			await loadPlatformPayments(true);
		} catch (error) {
			showToast(readErrorMessage(error, '退款状态更新失败'));
		} finally {
			if (submit) { submit.disabled = false; submit.textContent = '更新退款状态'; }
		}
	}

	function renderSupportFeedbackSubmitPage(ctx: PCContext): string {
		const body = `<div class="pc-card pc-lite-list-card">
			<div class="pc-my-content-head">问题反馈</div>
			<form class="pc-org-add-form" data-support-feedback-form>
				<div class="pc-org-form-grid pc-org-form-grid-3">
					<label class="pc-org-field"><span>类型</span><select class="pc-profile-input pc-org-select" data-support-feedback-category><option value="question">题目内容</option><option value="answer">答案解析</option><option value="payment">支付订单</option><option value="account">账号登录</option></select></label>
					<label class="pc-org-field"><span>试卷 ID</span><input class="pc-profile-input" data-support-feedback-paper-id value="2023_02" /></label>
					<label class="pc-org-field"><span>题号</span><input class="pc-profile-input" data-support-feedback-question-id value="29" /></label>
				</div>
				<label class="pc-org-field"><span>说明</span><textarea class="pc-org-batch-input" rows="4" data-support-feedback-description placeholder="请描述题目、解析、支付或账号问题">解析表达不够清楚，希望内容管理员复核。</textarea></label>
				<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">提交反馈</button></div>
				<div class="pc-admin-note">提交后写入反馈接口；管理员和内容管理员会在“反馈处理/解析审核”中看到。</div>
			</form>
		</div>`;
		return renderDashboardSubpage('问题反馈', body, ctx.guest ? '请先登录后提交反馈。' : '提交题目、解析、支付或账号问题。');
	}

	async function submitSupportFeedback(form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.submitFeedback !== 'function') {
			showToast('请先登录后提交反馈');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		if (submit) {
			submit.disabled = true;
			submit.textContent = '提交中...';
		}
		try {
			await api.submitFeedback({
				token,
				category: (form.querySelector('[data-support-feedback-category]') as HTMLSelectElement | null)?.value || 'question',
				paper_id: ((form.querySelector('[data-support-feedback-paper-id]') as HTMLInputElement | null)?.value || '2023_02').trim(),
				exam_id: ((form.querySelector('[data-support-feedback-paper-id]') as HTMLInputElement | null)?.value || '2023_02').trim(),
				question_id: ((form.querySelector('[data-support-feedback-question-id]') as HTMLInputElement | null)?.value || '').trim(),
				description: ((form.querySelector('[data-support-feedback-description]') as HTMLTextAreaElement | null)?.value || '').trim()
			});
			platformFeedbackLoaded = false;
			showToast('反馈已提交');
		} catch (error) {
			showToast(readErrorMessage(error, '反馈提交失败'));
		} finally {
			if (submit) {
				submit.disabled = false;
				submit.textContent = '提交反馈';
			}
		}
	}

	async function updateFeedbackStatus(button: HTMLButtonElement): Promise<void> {
		const api = window.APIClient;
		if (!api || typeof api.updateFeedback !== 'function') {
			showToast('反馈更新接口不可用');
			return;
		}
		const feedbackId = button.dataset.feedbackId || '';
		const paperId = button.dataset.feedbackPaperId || '';
		const status = button.dataset.feedbackStatus || 'open';
		if (!feedbackId) {
			showToast('反馈 ID 缺失');
			return;
		}
		button.disabled = true;
		try {
			await api.updateFeedback(feedbackId, paperId, {
				status,
				admin_note: status === 'resolved' ? '已处理并关闭' : '已受理，等待内容核查'
			});
			showToast(status === 'resolved' ? '反馈已关闭' : '反馈已受理，状态已改为处理中');
			platformFeedbackLoaded = false;
			await loadFeedbackQueue(true);
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			showToast(readErrorMessage(error, '反馈更新失败'));
		} finally {
			button.disabled = false;
		}
	}

	function renderPricingAdminPage(ctx: PCContext): string {
		if (!paymentPricingLoaded) {
			void loadPaymentPricing().then(() => {
				if (activeSection === 'dashboard' && activeDashboardSubpage === 'role-content' && activeRoleContent === 'platform-pricing') {
					renderSectionContent();
				}
			});
		}
		if (!hasAnyRole(ctx, ['superAdmin'])) {
			return renderDashboardSubpage('套餐价格', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">需要超级管理员权限。</div></div>', '维护平台套餐价格。');
		}
		const renderPriceInput = (scope: PricingScope, plan: PaidPersonalPlan, days: number) => {
			const yuan = pricingAmountCents(plan, days, 'cny', scope) / 100;
			return `<input class="pc-profile-input pc-pricing-input" aria-label="${scope === 'personal' ? '个人' : '机构'} ${plan.toUpperCase()} ${days} 天价格"
				type="number" min="0.01" step="0.01" data-price-scope="${scope}" data-price-plan="${plan}" data-price-days="${days}" value="${escapeHtml(String(yuan))}" />`;
		};
		const organization = paymentPricingConfig.catalogs.organization;
		const personalRows = (['pro', 'ultra'] as PaidPersonalPlan[]).map((plan) => `<tr>
			<th scope="row">${plan.toUpperCase()}${plan === 'pro' ? '<small>主推长期订阅</small>' : '<small>AI 与冲刺能力</small>'}</th>
			${paymentPricingConfig.catalogs.personal.durations.map((days) => `<td>${renderPriceInput('personal', plan, days)}</td>`).join('')}
		</tr>`).join('');
		const organizationRows = (['pro', 'ultra'] as PaidPersonalPlan[]).map((plan) => `<tr>
			<th scope="row">${plan.toUpperCase()}${plan === 'pro' ? '<small>单校区 / 小型机构</small>' : '<small>多校区 / 深度分析</small>'}</th>
			<td>${renderPriceInput('organization', plan, 30)}</td>
			<td>${renderPriceInput('organization', plan, 365)}</td>
			<td><input class="pc-profile-input pc-pricing-input" aria-label="机构 ${plan.toUpperCase()} 最低席位" type="number" min="1" step="1" data-price-min-seats="${plan}" value="${organization.minimumSeats[plan]}" /></td>
		</tr>`).join('');
		const tierRows = organization.seatTiers.map((tier, index) => `<tr>
			<th scope="row">${tier.minSeats}～${tier.maxSeats} 席</th>
			<td><input class="pc-profile-input pc-pricing-input" aria-label="${tier.minSeats} 到 ${tier.maxSeats} 席 PRO 年单价" type="number" min="0.01" step="0.01" data-price-tier="${index}" data-price-plan="pro" value="${tier.pricesCents.cny.pro['365'] / 100}" /></td>
			<td>${tier.pricesCents.cny.ultra['365'] > 0
				? `<input class="pc-profile-input pc-pricing-input" aria-label="${tier.minSeats} 到 ${tier.maxSeats} 席 ULTRA 年单价" type="number" min="0.01" step="0.01" data-price-tier="${index}" data-price-plan="ultra" value="${tier.pricesCents.cny.ultra['365'] / 100}" />`
				: '<span class="pc-pricing-na">不适用</span>'}</td>
		</tr>`).join('');
		const offerDateValue = (value: string): string => {
			if (!value) return '';
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return '';
			return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
		};
		const offerDescription: Record<PaymentPricingOffer['id'], string> = {
			first_purchase: '仅从未产生过成功付费订单的客户',
			renewal: '仅当前仍有有效付费套餐的客户',
			campaign: '时间范围内的所有新订单'
		};
		const renderOfferCards = (scope: PricingScope): string => paymentPricingConfig.catalogs[scope].offers.map((offer) => `
			<div class="pc-pricing-offer-card" data-price-offer-card data-offer-scope="${scope}" data-offer-id="${offer.id}">
				<div class="pc-pricing-offer-head">
					<div><strong>${escapeHtml(offer.label)}</strong><small>${escapeHtml(offerDescription[offer.id])}</small></div>
					<label class="pc-pricing-switch"><input type="checkbox" data-offer-enabled${offer.enabled ? ' checked' : ''} /><span>启用</span></label>
				</div>
				<div class="pc-pricing-offer-fields">
					<label class="pc-org-field"><span>优惠比例</span><div class="pc-pricing-suffix-field"><input class="pc-profile-input" type="number" min="0" max="90" step="1" data-offer-discount value="${offer.discountPercent}" /><b>%</b></div></label>
					<label class="pc-org-field"><span>开始时间（可留空）</span><input class="pc-profile-input" type="datetime-local" data-offer-start value="${escapeHtml(offerDateValue(offer.startsAt))}" /></label>
					<label class="pc-org-field"><span>结束时间（可留空）</span><input class="pc-profile-input" type="datetime-local" data-offer-end value="${escapeHtml(offerDateValue(offer.endsAt))}" /></label>
				</div>
			</div>`).join('');
		const body = `<form data-pricing-form class="pc-pricing-form">
			<div class="pc-card pc-lite-list-card pc-pricing-overview">
				<div class="pc-my-content-head">价格商品目录</div>
				<div class="pc-admin-note">统一维护个人订阅与机构席位商品。所有金额单位为人民币元；保存后，购买页展示价和后端订单金额同时生效。</div>
				<div class="pc-pricing-summary">
					<span><b>个人</b> 30 / 90 / 365 天</span>
					<span><b>机构</b> 30 / 365 天 · 按有效席位</span>
					<span><b>优惠</b> 首购 / 续费 / 限时活动</span>
					<span><b>提醒</b> 提前 ${paymentPricingConfig.renewal.reminderDays.join(' / ')} 天</span>
					<span><b>大客户</b> ${organization.customQuoteMinSeats} 席起转定制报价</span>
				</div>
			</div>
			${renderRenewalOperationsCard()}
			<div class="pc-card pc-lite-list-card">
				<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">个人套餐</div><p>PRO 是长期订阅主档；ULTRA 的差异集中在 AI、自动化和高级分析。</p></div><span class="pc-tag">按周期定价</span></div>
				<div class="pc-responsive-table-region" role="region" aria-label="个人套餐价格" tabindex="0">
					<table class="pc-pricing-table"><thead><tr><th>套餐</th><th>30 天</th><th>90 天</th><th>365 天</th></tr></thead><tbody>${personalRows}</tbody></table>
				</div>
			</div>
			<div class="pc-card pc-lite-list-card">
				<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">运营优惠规则</div><p>优惠不叠加；同一订单满足多项条件时自动使用折扣最高的一项。留空时间表示不限制该边界。</p></div><span class="pc-tag">自动择优</span></div>
				<div class="pc-pricing-offer-scope"><h4>个人订阅</h4><div class="pc-pricing-offer-grid">${renderOfferCards('personal')}</div></div>
				<div class="pc-pricing-offer-scope"><h4>机构 / 企业订阅</h4><div class="pc-pricing-offer-grid">${renderOfferCards('organization')}</div></div>
			</div>
			<div class="pc-card pc-lite-list-card">
				<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">续费与通知</div><p>统一控制个人和机构订阅的到期提醒、价格变更告知及扣款失败宽限期。</p></div><span class="pc-tag">默认不自动续费</span></div>
				<div class="pc-pricing-controls pc-pricing-renewal-controls">
					<label class="pc-org-field"><span>到期提醒（提前天数）</span><input class="pc-profile-input" type="text" inputmode="numeric" data-renewal-reminder-days value="${escapeHtml(paymentPricingConfig.renewal.reminderDays.join(', '))}" placeholder="7, 3, 1" /><small>使用英文逗号分隔，范围 1～30 天。</small></label>
					<label class="pc-org-field"><span>价格变更至少提前</span><div class="pc-pricing-suffix-field"><input class="pc-profile-input" type="number" min="1" max="30" step="1" data-renewal-price-notice-days value="${paymentPricingConfig.renewal.priceChangeNoticeDays}" /><b>天</b></div></label>
					<label class="pc-org-field"><span>扣款失败宽限期</span><div class="pc-pricing-suffix-field"><input class="pc-profile-input" type="number" min="0" max="30" step="1" data-renewal-grace-days value="${paymentPricingConfig.renewal.gracePeriodDays}" /><b>天</b></div></label>
				</div>
				<div class="pc-admin-note">自动续费必须由客户单独授权；关闭只影响下一周期。价格调整不改变当前周期，系统会保留授权时价格快照并展示下期差额。</div>
			</div>
			<div class="pc-card pc-lite-list-card">
				<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">机构 / 企业套餐</div><p>教师和管理员不占席位；PRO、ULTRA 分别设置月付、年付及最低购买席位。</p></div><span class="pc-tag">有效席位计费</span></div>
				<div class="pc-responsive-table-region" role="region" aria-label="机构套餐价格" tabindex="0">
					<table class="pc-pricing-table"><thead><tr><th>套餐</th><th>30 天 / 席</th><th>365 天 / 席</th><th>最低席位</th></tr></thead><tbody>${organizationRows}</tbody></table>
				</div>
			</div>
			<div class="pc-card pc-lite-list-card">
				<div class="pc-pricing-section-head"><div><div class="pc-my-content-head">机构年付阶梯价</div><p>订单按席位数量自动选择年单价；达到定制门槛后不再创建自助订单。</p></div><span class="pc-tag">自动套用</span></div>
				<div class="pc-responsive-table-region" role="region" aria-label="机构年付阶梯价格" tabindex="0">
					<table class="pc-pricing-table"><thead><tr><th>有效席位</th><th>PRO 年单价</th><th>ULTRA 年单价</th></tr></thead><tbody>${tierRows}</tbody></table>
				</div>
				<div class="pc-pricing-controls">
					<label class="pc-org-field"><span>转定制报价席位数</span><input class="pc-profile-input" type="number" min="2" step="1" data-price-custom-quote value="${organization.customQuoteMinSeats}" /></label>
					<label class="pc-org-field"><span>默认支付渠道</span><select class="pc-profile-input" data-pricing-default-provider>
						<option value="wechat"${paymentPricingConfig.defaultProvider === 'wechat' ? ' selected' : ''}>微信支付</option>
						<option value="alipay"${paymentPricingConfig.defaultProvider === 'alipay' ? ' selected' : ''}>支付宝</option>
						<option value="stripe"${paymentPricingConfig.defaultProvider === 'stripe' ? ' selected' : ''}>Stripe（海外卡/国际支付）</option>
					</select></label>
				</div>
				<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">保存全部价格</button></div>
			</div>
		</form>`;
		return renderDashboardSubpage('套餐价格', body, '超级管理员统一维护个人与机构套餐价格、运营优惠、最低席位和年付阶梯。');
	}

	async function savePaymentPricingForm(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		if (!token || !api || typeof api.updatePaymentPricing !== 'function') {
			showToast('价格配置接口暂不可用');
			return;
		}
		const payload = {
			default_provider: (form.querySelector('[data-pricing-default-provider]') as HTMLSelectElement | null)?.value || 'wechat',
			renewal: {
				reminder_days: [...paymentPricingConfig.renewal.reminderDays],
				price_change_notice_days: paymentPricingConfig.renewal.priceChangeNoticeDays,
				grace_period_days: paymentPricingConfig.renewal.gracePeriodDays
			},
			catalogs: {
				personal: {
					durations: [...paymentPricingConfig.catalogs.personal.durations],
					prices_cents: JSON.parse(JSON.stringify(paymentPricingConfig.catalogs.personal.pricesCents)) as PaymentPriceMatrix,
					offers: paymentPricingConfig.catalogs.personal.offers.map((offer) => ({
						id: offer.id,
						kind: offer.kind,
						label: offer.label,
						enabled: offer.enabled,
						discount_percent: offer.discountPercent,
						starts_at: offer.startsAt,
						ends_at: offer.endsAt
					}))
				},
				organization: {
					durations: [...paymentPricingConfig.catalogs.organization.durations],
					prices_cents: JSON.parse(JSON.stringify(paymentPricingConfig.catalogs.organization.pricesCents)) as PaymentPriceMatrix,
					plans: {
						pro: { minimum_seats: paymentPricingConfig.catalogs.organization.minimumSeats.pro },
						ultra: { minimum_seats: paymentPricingConfig.catalogs.organization.minimumSeats.ultra }
					},
					custom_quote_min_seats: paymentPricingConfig.catalogs.organization.customQuoteMinSeats,
					offers: paymentPricingConfig.catalogs.organization.offers.map((offer) => ({
						id: offer.id,
						kind: offer.kind,
						label: offer.label,
						enabled: offer.enabled,
						discount_percent: offer.discountPercent,
						starts_at: offer.startsAt,
						ends_at: offer.endsAt
					})),
					seat_tiers: paymentPricingConfig.catalogs.organization.seatTiers.map((tier) => ({
						min_seats: tier.minSeats,
						max_seats: tier.maxSeats,
						prices_cents: JSON.parse(JSON.stringify(tier.pricesCents)) as PaymentPriceMatrix
					}))
				}
			}
		};
		let invalidPriceInput: HTMLInputElement | null = null;
		form.querySelectorAll<HTMLInputElement>('[data-price-scope][data-price-plan][data-price-days]').forEach((input) => {
			const scope = input.dataset.priceScope as PricingScope;
			const plan = input.dataset.pricePlan as PaidPersonalPlan;
			const days = input.dataset.priceDays || '30';
			const yuan = Number(input.value);
			if ((scope === 'personal' || scope === 'organization') && (plan === 'pro' || plan === 'ultra') && Number.isFinite(yuan) && yuan > 0) {
				payload.catalogs[scope].prices_cents.cny[plan][days] = Math.round(yuan * 100);
			} else if (!invalidPriceInput) invalidPriceInput = input;
		});
		form.querySelectorAll<HTMLInputElement>('[data-price-min-seats]').forEach((input) => {
			const plan = input.dataset.priceMinSeats as PaidPersonalPlan;
			const value = Number(input.value);
			if ((plan === 'pro' || plan === 'ultra') && Number.isInteger(value) && value > 0) {
				payload.catalogs.organization.plans[plan].minimum_seats = value;
			} else if (!invalidPriceInput) invalidPriceInput = input;
		});
		form.querySelectorAll<HTMLInputElement>('[data-price-tier][data-price-plan]').forEach((input) => {
			const index = Number(input.dataset.priceTier);
			const plan = input.dataset.pricePlan as PaidPersonalPlan;
			const yuan = Number(input.value);
			if (Number.isInteger(index) && payload.catalogs.organization.seat_tiers[index] && (plan === 'pro' || plan === 'ultra') && Number.isFinite(yuan) && yuan > 0) {
				payload.catalogs.organization.seat_tiers[index].prices_cents.cny[plan]['365'] = Math.round(yuan * 100);
			} else if (!invalidPriceInput) invalidPriceInput = input;
		});
		const customQuoteInput = form.querySelector('[data-price-custom-quote]') as HTMLInputElement | null;
		const customQuote = Number(customQuoteInput?.value || '0');
		if (Number.isInteger(customQuote) && customQuote > 1) {
			payload.catalogs.organization.custom_quote_min_seats = customQuote;
		} else if (!invalidPriceInput) invalidPriceInput = customQuoteInput;
		const reminderInput = form.querySelector('[data-renewal-reminder-days]') as HTMLInputElement | null;
		const reminderDays = (reminderInput?.value || '')
			.split(/[,，\s]+/)
			.filter(Boolean)
			.map(Number);
		const priceNoticeInput = form.querySelector('[data-renewal-price-notice-days]') as HTMLInputElement | null;
		const graceInput = form.querySelector('[data-renewal-grace-days]') as HTMLInputElement | null;
		const priceNoticeDays = Number(priceNoticeInput?.value || '0');
		const graceDays = Number(graceInput?.value || '-1');
		if (reminderDays.length && reminderDays.every((value) => Number.isInteger(value) && value >= 1 && value <= 30)) {
			payload.renewal.reminder_days = [...new Set(reminderDays)].sort((left, right) => right - left);
		} else if (!invalidPriceInput) invalidPriceInput = reminderInput;
		if (Number.isInteger(priceNoticeDays) && priceNoticeDays >= 1 && priceNoticeDays <= 30) {
			payload.renewal.price_change_notice_days = priceNoticeDays;
		} else if (!invalidPriceInput) invalidPriceInput = priceNoticeInput;
		if (Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= 30) {
			payload.renewal.grace_period_days = graceDays;
		} else if (!invalidPriceInput) invalidPriceInput = graceInput;
		form.querySelectorAll<HTMLElement>('[data-price-offer-card]').forEach((card) => {
			const scope = card.dataset.offerScope as PricingScope;
			const id = card.dataset.offerId as PaymentPricingOffer['id'];
			const offers = scope === 'personal'
				? payload.catalogs.personal.offers
				: payload.catalogs.organization.offers;
			const offer = offers.find((item) => item.id === id);
			const discountInput = card.querySelector('[data-offer-discount]') as HTMLInputElement | null;
			const startInput = card.querySelector('[data-offer-start]') as HTMLInputElement | null;
			const endInput = card.querySelector('[data-offer-end]') as HTMLInputElement | null;
			const discount = Number(discountInput?.value || '0');
			const toIso = (value: string): string => value ? new Date(value).toISOString() : '';
			if (!offer || !Number.isInteger(discount) || discount < 0 || discount > 90) {
				if (!invalidPriceInput) invalidPriceInput = discountInput;
				return;
			}
			let startsAt = '';
			let endsAt = '';
			try {
				startsAt = toIso(startInput?.value || '');
				endsAt = toIso(endInput?.value || '');
			} catch {
				if (!invalidPriceInput) invalidPriceInput = startInput || endInput;
				return;
			}
			if (startsAt && endsAt && startsAt >= endsAt) {
				if (!invalidPriceInput) invalidPriceInput = endInput;
				return;
			}
			offer.enabled = (card.querySelector('[data-offer-enabled]') as HTMLInputElement | null)?.checked === true;
			offer.discount_percent = discount;
			offer.starts_at = startsAt;
			offer.ends_at = endsAt;
		});
		if (invalidPriceInput) { setFieldError(invalidPriceInput, '请检查价格、席位、提醒天数、优惠比例或生效时间'); return; }
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]') || undefined;
		const finishSubmitting = beginOrganizationAction(submit, '等待确认…');
		if (!finishSubmitting) return;
		try {
			if (!await requestConfirmation('确认修改个人、机构套餐价格、续费提醒及运营优惠？保存后新创建的报价和订单会立即使用新配置。', '确认修改')) return;
			const reauthPassword = await requestHighRiskPassword('修改套餐价格');
			if (reauthPassword === null) return;
			if (submit) submit.textContent = '保存中…';
			const updated = await api.updatePaymentPricing(token, { ...payload, confirmation: '确认修改套餐价格', reauth_password: reauthPassword });
			paymentPricingConfig = normalizePaymentPricing(updated);
			paymentPricingLoaded = true;
			showToast('套餐价格、续费提醒与优惠规则已保存');
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			const message = readErrorMessage(error, '套餐价格保存失败');
			setFieldError(form.querySelector('[data-pricing-default-provider]') as HTMLSelectElement | null, message);
			showToast(message);
		} finally { finishSubmitting(); }
	}

	function renderContentPublishQueuePage(): string {
		void ensureContentPublishQueue();
		if (contentPublishQueueLoading && !contentPublishQueueLoaded) {
			return renderDashboardSubpage('发布队列', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取真实试卷索引...</div></div>', '根据试卷接口返回的题量和校验状态展示发布就绪情况。');
		}
		const availableExamIds = contentPublishExamItems.map((item) => readString(item.id) || '').filter(Boolean);
		contentWorkflowSelection = new Set([...contentWorkflowSelection].filter((examId) => availableExamIds.includes(examId)));
		const allSelectableIds = availableExamIds.slice(0, 100);
		const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((examId) => contentWorkflowSelection.has(examId));
		const rows = contentPublishExamItems.map((item) => {
			const examId = readString(item.id) || '';
			const selected = contentWorkflowSelection.has(examId);
			const workflow = contentWorkflowItems.find((entry) => readString(entry.exam_id) === examId);
			const inspection = asRecord(workflow?.inspection);
			const reviews = asRecord(workflow?.reviews);
			const analysis = asRecord(reviews?.analysis);
			const secondary = asRecord(reviews?.secondary);
			const errorCount = Array.isArray(inspection?.errors) ? inspection.errors.length : 0;
			const qualityPassed = readBoolean(inspection?.passed) === true;
			const analysisApproved = readString(analysis?.status) === 'approved';
			const secondaryApproved = readString(secondary?.status) === 'approved';
			const publishReady = qualityPassed && analysisApproved && secondaryApproved;
			const workflowMessage = contentWorkflowMessages[examId] || '';
			const versions = Array.isArray(workflow?.versions) ? workflow.versions.map(asRecord).filter((version): version is Record<string, unknown> => Boolean(version)) : [];
			const versionRows = versions.slice().reverse().slice(0, 5).map((version) => {
				const versionId = readString(version.id) || '';
				return `<span class="pc-tag muted">${escapeHtml(readString(version.kind) || '版本')} · ${escapeHtml(readString(version.created_at) || '')}<button class="pc-inline-ghost" type="button" data-content-workflow-action="rollback" data-exam-id="${escapeHtml(examId)}" data-version-id="${escapeHtml(versionId)}" aria-label="回滚到版本 ${escapeHtml(versionId)}">回滚</button></span>`;
			}).join('') || '<span class="pc-admin-note">暂无版本记录</span>';
			return `<div class="pc-lite-row pc-lite-row-static" data-content-workflow-row data-exam-id="${escapeHtml(examId)}"><label class="pc-content-workflow-select"><input type="checkbox" data-content-workflow-select="${escapeHtml(examId)}" aria-label="选择试卷 ${escapeHtml(readString(item.title) || examId)}"${selected ? ' checked' : ''}${contentWorkflowBatchBusy ? ' disabled' : ''}></label><span><strong>${escapeHtml(readString(item.title) || readString(item.display) || examId)}</strong><em>${escapeHtml(examId)} · ${escapeHtml(readString(workflow?.status) || '未进入工作流')} · 错误 ${errorCount} · 解析审核 ${escapeHtml(readString(analysis?.status) || '待审核')} · 复核 ${escapeHtml(readString(secondary?.status) || '待复核')}</em><span class="pc-feedback-actions" aria-label="最近版本">${versionRows}</span><span class="pc-admin-note" data-content-workflow-message role="alert"${workflowMessage ? '' : ' hidden'}>${escapeHtml(workflowMessage)}</span></span><div class="pc-feedback-actions"><button class="pc-inline-ghost" type="button" data-content-workflow-action="open" data-exam-id="${escapeHtml(examId)}">查看试卷</button><button class="pc-inline-ghost" type="button" data-content-workflow-action="inspect" data-exam-id="${escapeHtml(examId)}">质量检查</button><button class="pc-inline-ghost" type="button" data-content-workflow-action="analysis" data-exam-id="${escapeHtml(examId)}"${qualityPassed ? '' : ' disabled title="请先通过质量检查"'}>解析通过</button><button class="pc-inline-ghost" type="button" data-content-workflow-action="secondary" data-exam-id="${escapeHtml(examId)}"${analysisApproved ? '' : ' disabled title="请先通过解析审核"'}>复核通过</button><button class="pc-inline-btn" type="button" data-content-workflow-action="publish" data-exam-id="${escapeHtml(examId)}"${publishReady ? '' : ' disabled title="质检和两次审核均通过后才能发布"'}>发布</button></div></div>`;
		}).join('') || '<div class="pc-admin-note">暂无真实试卷；请先通过受保护的试卷导入接口创建草稿。</div>';
		return renderDashboardSubpage(
			'发布队列',
			`<div class="pc-card pc-lite-list-card"><div class="pc-content-workflow-toolbar"><div><div class="pc-my-content-head">内容生产工作流</div><div class="pc-admin-note">质量检查同时检查题干、解析、图片和音频关联；解析审核和二次复核都通过后才能发布并生成版本。</div></div><div class="pc-feedback-actions"><label class="pc-content-workflow-select-all"><input type="checkbox" data-content-workflow-select-all${allSelected ? ' checked' : ''}${!allSelectableIds.length || contentWorkflowBatchBusy ? ' disabled' : ''}> 选择前 ${Math.min(100, allSelectableIds.length)} 份</label><button class="pc-inline-btn" type="button" data-content-workflow-batch-inspect${!contentWorkflowSelection.size || contentWorkflowBatchBusy ? ' disabled' : ''}>${contentWorkflowBatchBusy ? '批量检查中…' : `批量质检（${contentWorkflowSelection.size}）`}</button></div></div>${contentWorkflowBatchMessage ? `<div class="pc-admin-note" data-content-workflow-batch-message role="status">${escapeHtml(contentWorkflowBatchMessage)}</div>` : ''}<div class="pc-lite-list">${rows}</div></div>`,
			'题目导入 → 质量检查 → 解析审核 → 复核 → 发布版本。'
		);
	}

	function renderMyAssignmentsPage(ctx: PCContext): string {
		void ensureMyAssignments(ctx);
		if (myAssignmentsLoading) {
			return renderDashboardSubpage('我的作业', '<div class="pc-card pc-lite-list-card"><div class="pc-admin-note">正在读取老师布置的作业...</div></div>', '按截止时间排列，可查看提交、退回和催交状态。');
		}
		const rows = myAssignmentItems.map((item) => {
			const assignmentId = readString(item.assignment_id) || '';
			const examId = readString(item.exam_id) || '';
			const submission = asRecord(item.own_submission) || {};
			const submittedAt = readString(submission.submitted_at) || '';
			const returned = readString(submission.review_status) === 'returned' || readString(submission.status) === 'returned';
			const teacherComment = readString(submission.teacher_comment) || '';
			const dueAt = readString(item.due_at) || '';
			const overdue = !submittedAt && Boolean(dueAt) && Date.parse(dueAt) < Date.now();
			const reminders = Array.isArray(item.own_reminders)
				? item.own_reminders.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
				: [];
			const latestReminder = reminders.slice().sort((a, b) => (readString(b.created_at) || '').localeCompare(readString(a.created_at) || ''))[0];
			const status = returned ? '已退回' : submittedAt ? '已提交' : overdue ? '已逾期' : '待完成';
			const details = [
				`截止：${dueAt ? formatDateTime(dueAt) : '不限期'}`,
				examId ? `试卷：${examId}` : '未关联试卷',
				submittedAt ? `提交：${formatDateTime(submittedAt)}` : '',
				teacherComment ? `老师评语：${teacherComment}` : '',
				!submittedAt && latestReminder ? `催交：${readString(latestReminder.message) || '老师提醒尽快完成'}` : ''
			].filter(Boolean).join(' · ');
			const intent = examId ? `openAssignmentExam:${encodeURIComponent(assignmentId)}:${encodeURIComponent(examId)}` : '';
			return {
				title: readString(item.title) || '未命名作业',
				desc: details,
				meta: status,
				intent
			};
		});
		const body = myAssignmentsError
			? `<div class="pc-card pc-lite-list-card"><div class="pc-admin-note" role="alert">${escapeHtml(myAssignmentsError)}</div><div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-ghost" type="button" data-intent="refreshAssignments">重试</button></div></div>`
			: renderRoleListCard('作业列表', rows.length ? rows : [{ title: '暂无作业', desc: '老师布置作业后会显示在这里；无需反复刷新首页。', meta: '' }]);
		return renderDashboardSubpage('我的作业', body, '按截止时间排列，可查看提交、退回、评语和催交状态。');
	}

	async function runContentWorkflowBatchInspection(button: HTMLButtonElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const examIds = [...contentWorkflowSelection];
		if (!token || !api || typeof api.inspectContentWorkflowBatch !== 'function') { showToast('批量质检接口不可用'); return; }
		if (!examIds.length) { showToast('请至少选择一份试卷'); return; }
		if (examIds.length > 100) { showToast('单次最多检查 100 份试卷'); return; }
		const finishSubmitting = beginOrganizationAction(button, '批量检查中…');
		if (!finishSubmitting) return;
		contentWorkflowBatchBusy = true;
		contentWorkflowBatchMessage = '';
		renderSectionContent({ preserveScroll: true });
		try {
			const result = asRecord(await api.inspectContentWorkflowBatch(token, examIds));
			const processed = readCount(result?.processed_count);
			const passed = readCount(result?.passed_count);
			const failed = readCount(result?.failed_count);
			const unavailable = readCount(result?.unavailable_count);
			contentWorkflowBatchMessage = `已检查 ${processed} 份：通过 ${passed}，发现阻断问题 ${failed}${unavailable ? `，无法读取 ${unavailable}` : ''}。`;
			contentWorkflowSelection.clear();
			contentPublishQueueLoaded = false;
			await ensureContentPublishQueue();
			showToast('批量质量检查已完成');
		} catch (error) {
			contentWorkflowBatchMessage = readErrorMessage(error, '批量质量检查失败');
			showToast(contentWorkflowBatchMessage);
		} finally {
			contentWorkflowBatchBusy = false;
			finishSubmitting();
			renderSectionContent({ preserveScroll: true });
		}
	}

	async function runContentWorkflowAction(button: HTMLButtonElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const examId = button.dataset.examId || '';
		const action = button.dataset.contentWorkflowAction || '';
		const versionId = button.dataset.versionId || '';
		if (action === 'open' && examId) {
			void resumeExam(examId, null);
			return;
		}
		if (!token || !api || !examId) { showToast('内容工作流接口不可用'); return; }
		const row = button.closest('[data-content-workflow-row]');
		if (row instanceof HTMLElement && row.dataset.contentWorkflowBusy === 'true') return;
		const messageNode = row?.querySelector('[data-content-workflow-message]') as HTMLElement | null;
		delete contentWorkflowMessages[examId];
		if (messageNode) { messageNode.hidden = true; messageNode.textContent = ''; }
		const actionLabels: Record<string, string> = { inspect: '检查中…', analysis: '审核中…', secondary: '复核中…', publish: '发布中…', rollback: '回滚中…' };
		const finishSubmitting = beginOrganizationAction(button, action === 'publish' || action === 'rollback' ? '等待确认…' : actionLabels[action] || '处理中…');
		if (!finishSubmitting) return;
		const rowButtons = Array.from(row?.querySelectorAll<HTMLButtonElement>('[data-content-workflow-action]') || []);
		const originalDisabled = new Map(rowButtons.map((candidate) => [candidate, candidate.disabled]));
		if (row instanceof HTMLElement) row.dataset.contentWorkflowBusy = 'true';
		rowButtons.forEach((candidate) => { if (candidate !== button) candidate.disabled = true; });
		try {
			let reauthPassword = '';
			if (action === 'analysis' || action === 'secondary') {
				const stageLabel = action === 'analysis' ? '解析审核' : '二次复核';
				if (!await requestConfirmation(`确认将试卷 ${examId} 的${stageLabel}标记为通过？`, '确认通过')) return;
				button.textContent = actionLabels[action];
			}
			if (action === 'publish' || action === 'rollback') {
				const accepted = await requestConfirmation(
					action === 'publish'
						? `确认发布试卷 ${examId}？发布后会生成正式版本并进入发布流水。`
						: `确认将试卷 ${examId} 回滚到版本 ${versionId}？当前内容会被历史快照覆盖。`,
					action === 'publish' ? '确认发布' : '确认回滚'
				);
				if (!accepted) return;
				const password = await requestHighRiskPassword(action === 'publish' ? '发布内容版本' : '回滚内容版本');
				if (password === null) return;
				reauthPassword = password;
				button.textContent = actionLabels[action];
			}
			if (action === 'inspect') await api.inspectContentWorkflow(token, examId);
			else if (action === 'analysis' || action === 'secondary') await api.reviewContentWorkflow(token, examId, action, { status: 'approved', note: '页面审核通过' });
			else if (action === 'publish') await api.publishContentWorkflow(token, examId, { confirmation: '确认发布', reauth_password: reauthPassword });
			else if (action === 'rollback' && versionId) await api.rollbackContentVersion(token, examId, versionId, { confirmation: '确认回滚', reauth_password: reauthPassword });
			delete contentWorkflowMessages[examId];
			showToast(action === 'publish' ? '内容已发布并生成版本' : action === 'rollback' ? '已回滚并生成新的版本记录' : '内容工作流状态已更新');
			contentPublishQueueLoaded = false;
			await ensureContentPublishQueue();
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			const message = readErrorMessage(error, '内容工作流操作失败');
			contentWorkflowMessages[examId] = message;
			if (messageNode) { messageNode.textContent = message; messageNode.hidden = false; }
			showToast(message);
		} finally {
			if (row instanceof HTMLElement && row.isConnected) delete row.dataset.contentWorkflowBusy;
			rowButtons.forEach((candidate) => { if (candidate.isConnected && candidate !== button) candidate.disabled = originalDisabled.get(candidate) || false; });
			finishSubmitting();
		}
	}

	function renderInstitutionDashboardRolePage(ctx: PCContext): string {
		void ensureInstitutionRoleWorkbench(ctx);
		if (institutionRoleWorkbenchLoading) {
			return renderDashboardSubpage(
				'机构看板',
				'<div class="pc-card pc-info-card"><div class="pc-service-header">机构教学工作台</div><div class="pc-admin-note">正在读取真实学习组、作业、成绩、席位和风险数据...</div></div>',
				'看板由机构 dashboard 和 workbench 接口实时汇总。'
			);
		}
		const data = institutionRoleWorkbenchData || {};
		return renderDashboardSubpage(
			'机构看板',
			`<div class="pc-card pc-info-card"><div class="pc-service-header">机构教学工作台</div>${renderInstitutionDashboard(data)}${renderInstitutionWorkbenchExtras(data)}</div>`,
			'看板由机构 dashboard 和 workbench 接口实时汇总。'
		);
	}

	function renderPlatformRolesPage(ctx: PCContext): string {
		if (!hasAnyRole(ctx, ['superAdmin'])) return renderDashboardSubpage('平台角色权限', '<div class="pc-admin-note">需要超级管理员权限。</div>', '');
		if (!platformRoleTemplatesLoaded) void loadPlatformRoleTemplates();
		const cards = platformRoleTemplates.map((role) => {
			const id = readString(role.id) || '';
			const permissions = Array.isArray(role.default_permissions) ? role.default_permissions.map(String) : [];
			const preview = platformRoleTemplatePreviews[id];
			const added = Array.isArray(preview?.added) ? preview.added.map(String).join('、') || '无' : '';
			const removed = Array.isArray(preview?.removed) ? preview.removed.map(String).join('、') || '无' : '';
			const conflicts = Array.isArray(preview?.conflicts) ? preview.conflicts.map(String).join('；') : '';
			return `<form class="pc-card pc-lite-list-card" data-platform-role-template-form data-role-id="${escapeHtml(id)}"><div class="pc-my-content-head">${escapeHtml(readString(role.name) || id)} · ${escapeHtml(id)}</div><div class="pc-admin-note">${escapeHtml(readString(role.description) || '')}</div><label class="pc-org-field"><span>默认权限清单（每行一项）</span><textarea class="pc-org-batch-input" rows="6" data-role-permissions${readBoolean(role.protected) ? ' readonly' : ''}>${escapeHtml(permissions.join('\n'))}</textarea></label><label class="pc-org-field"><span><input type="checkbox" data-role-org-override${readBoolean(role.allow_organization_override) ? ' checked' : ''}${readBoolean(role.protected) ? ' disabled' : ''}/> 允许机构覆盖</span></label>${preview ? `<div class="pc-admin-note" data-role-diff role="status">新增：${escapeHtml(added)}<br/>移除：${escapeHtml(removed)}${conflicts ? `<br/>冲突：${escapeHtml(conflicts)}` : ''}</div>` : ''}<div class="pc-org-form-actions pc-org-form-actions-end">${readBoolean(role.protected) ? '<span class="pc-tag muted">受保护模板</span>' : `<button class="pc-inline-btn" type="submit" data-role-id="${escapeHtml(id)}">${preview ? '确认应用差异' : '预览修改差异'}</button>`}</div></form>`;
		}).join('') || '<div class="pc-card"><div class="pc-admin-note">正在读取全局角色模板...</div></div>';
		const accessPreview = platformUserAccessPreview;
		const previewBefore = asRecord(accessPreview?.preview.before);
		const previewAfter = asRecord(accessPreview?.preview.after);
		const accessDiff = accessPreview
			? `<div class="pc-admin-note" data-platform-access-diff role="status">用户：${escapeHtml(accessPreview.userId)}<br/>变更前临时授权：${escapeHtml(String(Array.isArray(previewBefore?.temporary_grants) ? previewBefore.temporary_grants.length : 0))} 项<br/>变更后临时授权：${escapeHtml(String(Array.isArray(previewAfter?.temporary_grants) ? previewAfter.temporary_grants.length : 0))} 项<br/>确认后会撤销该用户现有登录会话。</div>`
			: '';
		const accessDraft = accessPreview || platformUserAccessDraft;
		const access = `<div class="pc-card pc-lite-list-card"><div class="pc-my-content-head">成员临时授权</div><form class="pc-org-add-form" data-platform-user-access-form><div class="pc-org-form-grid pc-org-form-grid-3"><label class="pc-org-field"><span>用户 ID</span><input class="pc-profile-input" required data-platform-access-user-id value="${escapeHtml(accessDraft.userId)}" /></label><label class="pc-org-field"><span>临时角色</span><select class="pc-profile-input" data-platform-access-role><option value="contentAdmin"${accessDraft.roleId === 'contentAdmin' ? ' selected' : ''}>内容管理员</option><option value="orgAdmin"${accessDraft.roleId === 'orgAdmin' ? ' selected' : ''}>机构管理员</option><option value="teacher"${accessDraft.roleId === 'teacher' ? ' selected' : ''}>老师</option><option value="assistant"${accessDraft.roleId === 'assistant' ? ' selected' : ''}>教学运营</option></select></label><label class="pc-org-field"><span>有效期</span><input class="pc-profile-input" type="datetime-local" required data-platform-access-expiry value="${escapeHtml(accessDraft.expiresAt)}" /></label></div>${accessDiff}<div class="pc-org-form-actions pc-org-form-actions-end"><button class="pc-inline-btn" type="submit">${accessPreview ? '确认授予并失效会话' : '预览授权差异'}</button></div><div class="pc-admin-note">后端会输出冲突和修改前后差异；禁止修改自己的超级管理员身份，并保护最后一名超级管理员。</div></form></div>`;
		return renderDashboardSubpage('平台角色权限', `<div class="pc-admin-note">角色默认能力来自全局模板；机构可在允许范围内覆盖，成员临时授权按有效期自动失效。</div>${cards}${access}`, '全局模板、机构覆盖、临时授权、差异、冲突和审计。');
	}

	async function submitPlatformRoleTemplate(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const token = activeToken(getContext());
		const api = window.APIClient;
		const roleId = form.dataset.roleId || '';
		const permissionsInput = form.querySelector('[data-role-permissions]') as HTMLTextAreaElement | null;
		if (!token || !api || !roleId) return;
		const permissions = (permissionsInput?.value || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
		if (!permissions.length) { setFieldError(permissionsInput, '默认权限清单不能为空'); return; }
		const payload = {
			permissions: Array.from(new Set(permissions)),
			allow_organization_override: Boolean((form.querySelector('[data-role-org-override]') as HTMLInputElement | null)?.checked)
		};
		const fingerprint = JSON.stringify(payload);
		const hasCurrentPreview = Boolean(platformRoleTemplatePreviews[roleId]) && platformRoleTemplatePreviewFingerprints[roleId] === fingerprint;
		const button = form.querySelector<HTMLButtonElement>('button[type="submit"]') || undefined;
		const finishSubmitting = beginOrganizationAction(button, hasCurrentPreview ? '应用中…' : '生成中…');
		if (!finishSubmitting) return;
		try {
			if (!hasCurrentPreview) {
				platformRoleTemplatePreviews[roleId] = asRecord(await api.previewPlatformRoleTemplate(token, roleId, payload)) || {};
				platformRoleTemplatePreviewFingerprints[roleId] = fingerprint;
				showToast('差异预览已生成，请确认后再次提交');
			} else {
				await api.updatePlatformRoleTemplate(token, roleId, { ...payload, confirmation: '确认修改角色模板', reauth_password: '' });
				delete platformRoleTemplatePreviews[roleId];
				delete platformRoleTemplatePreviewFingerprints[roleId];
				platformRoleTemplatesLoaded = false;
				await loadPlatformRoleTemplates(true);
				showToast('全局角色模板已更新并写入审计');
			}
			renderSectionContent({ preserveScroll: true, focusSelector: `[data-role-id="${escapeHtml(roleId)}"]` });
		} catch (error) {
			const message = readErrorMessage(error, '角色模板更新失败');
			setFieldError(permissionsInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
	}

	async function submitPlatformUserAccess(form: HTMLFormElement): Promise<void> {
		clearFormFieldErrors(form);
		const userInput = form.querySelector('[data-platform-access-user-id]') as HTMLInputElement | null;
		const expiryInput = form.querySelector('[data-platform-access-expiry]') as HTMLInputElement | null;
		const token = activeToken(getContext());
		const api = window.APIClient;
		const userId = (userInput?.value || '').trim();
		if (!token || !api) return;
		if (!userId) { setFieldError(userInput, '请填写用户 ID'); return; }
		const roleId = (form.querySelector('[data-platform-access-role]') as HTMLSelectElement | null)?.value || 'assistant';
		const expiresAt = expiryInput?.value || '';
		platformUserAccessDraft = { userId, roleId, expiresAt };
		if (!expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
			setFieldError(expiryInput, '有效期必须晚于当前时间');
			return;
		}
		const matchesPreview = platformUserAccessPreview?.userId === userId
			&& platformUserAccessPreview.roleId === roleId
			&& platformUserAccessPreview.expiresAt === expiresAt;
		const button = form.querySelector<HTMLButtonElement>('button[type="submit"]') || undefined;
		const finishSubmitting = beginOrganizationAction(button, matchesPreview ? '授权中…' : '预览中…');
		if (!finishSubmitting) return;
		try {
			if (!matchesPreview) {
				const current = asRecord(await api.getPlatformUserAccess(token, userId));
				const existing = Array.isArray(current?.temporary_grants) ? current.temporary_grants : [];
				const payload = { temporary_grants: [...existing, { role_id: roleId, effect: 'allow', permissions: [], expires_at: expiresAt }] };
				const preview = asRecord(await api.previewPlatformUserAccess(token, userId, payload)) || {};
				const conflicts = asRecord(preview.after)?.conflicts;
				if (Array.isArray(conflicts) && conflicts.length) throw new Error(`权限冲突：${conflicts.join('；')}`);
				platformUserAccessPreview = { userId, roleId, expiresAt, payload, preview };
				renderSectionContent({ preserveScroll: true, focusSelector: '[data-platform-user-access-form] button[type="submit"]' });
				showToast('授权差异已生成，请确认后再次提交');
			} else {
				await api.updatePlatformUserAccess(token, userId, { ...platformUserAccessPreview!.payload, confirmation: '确认修改平台权限', reauth_password: '' });
				platformUserAccessPreview = null;
				platformUserAccessDraft = { userId: '', roleId: 'assistant', expiresAt: '' };
				renderSectionContent({ preserveScroll: true, focusSelector: '[data-platform-access-user-id]' });
				showToast('临时授权已生效，原登录会话已失效');
			}
		} catch (error) {
			const message = readErrorMessage(error, '临时授权失败');
			setFieldError(userInput, message);
			showToast(message);
		} finally { finishSubmitting(); }
	}

	function renderRoleContentPage(ctx: PCContext): string {
		if (activeRoleContent === 'student-assignments') {
			return renderMyAssignmentsPage(ctx);
		}
		if (activeRoleContent.startsWith('platform-payment-order:')) {
			return renderPlatformPaymentDetailPage(ctx, 'order', decodeRoleContentPart(activeRoleContent.slice('platform-payment-order:'.length)));
		}
		if (activeRoleContent.startsWith('platform-payment-refund:')) {
			return renderPlatformPaymentDetailPage(ctx, 'refund', decodeRoleContentPart(activeRoleContent.slice('platform-payment-refund:'.length)));
		}
		if (activeRoleContent === 'platform-pricing') {
			return renderPricingAdminPage(ctx);
		}
		if (activeRoleContent === 'platform-users') {
			return renderPlatformUserSearchPage(ctx);
		}
		if (activeRoleContent === 'platform-orgs') {
			return renderManagedOrganizationPage(ctx, 'platform');
		}
		if (activeRoleContent === 'platform-roles') {
			return renderPlatformRolesPage(ctx);
		}
		if (activeRoleContent === 'org-permissions') {
			return renderManagedOrganizationPage(ctx, 'permissions');
		}
		if (activeRoleContent === 'org-members') {
			return renderManagedOrganizationPage(ctx, 'members');
		}
		if (activeRoleContent === 'org-groups') {
			return renderManagedOrganizationPage(ctx, 'groups');
		}
		if (activeRoleContent === 'org-settings') {
			return renderManagedOrganizationPage(ctx, 'settings');
		}
		if (activeRoleContent === 'org-course-packages') {
			return renderManagedOrganizationPage(ctx, 'coursePackages');
		}
		if (activeRoleContent === 'org-seats' || activeRoleContent === 'org-plan') {
			return renderManagedOrganizationPage(ctx, 'subscription');
		}
		if (activeRoleContent === 'org-invites' || activeRoleContent === 'org-audit') {
			return renderManagedOrganizationPage(ctx, 'members');
		}
		if (activeRoleContent === 'platform-stats') {
			return renderPlatformStatsPage(ctx);
		}
		if (activeRoleContent === 'platform-flags') {
			return renderPlatformSystemFlagsPage(ctx);
		}
		if (activeRoleContent === 'platform-payments') {
			return renderPlatformPaymentsPage(ctx);
		}
		if (activeRoleContent === 'platform-feedback') {
			return renderFeedbackQueuePage(ctx, '反馈处理', '用户反馈、支付问题和内容问题。', 'all');
		}
		if (activeRoleContent === 'content-feedback') {
			return renderFeedbackQueuePage(ctx, '内容反馈', '统一处理题目、答案、解析、图片和音频问题。', 'all');
		}
		if (activeRoleContent === 'support-feedback') {
			return renderSupportFeedbackSubmitPage(ctx);
		}
		if (activeRoleContent === 'org-dashboard') {
			return renderInstitutionDashboardRolePage(ctx);
		}
		if (activeRoleContent === 'content-publish') {
			return renderContentPublishQueuePage();
		}
		if (activeRoleContent === 'content-log' || activeRoleContent === 'platform-audit') {
			return renderDashboardSubpage('审计日志', renderRoleListCard('审计日志', [{ title: '查看真实审计日志', desc: '内容修改、授权、退款和系统变更统一记录在审计日志。', meta: '打开', intent: 'openAuditLog' }]), '日志从后台审计接口读取。');
		}
		if (isInstitutionRoleContent(activeRoleContent)) {
			return renderInstitutionRoleContentPage(ctx, activeRoleContent);
		}
		const page = roleContentRows(activeRoleContent);
		const body = renderRoleListCard(page.title, page.rows);
		return renderDashboardSubpage(page.title, body, page.subtitle);
	}

	function renderDashboardSubpageContent(ctx: PCContext): string {
		switch (activeDashboardSubpage) {
			case 'role-content':
				return renderRoleContentPage(ctx);
			case 'recent':
				return renderRecentLearningPage();
			case 'favorites':
				return renderFavoritesPage();
			case 'account-core':
				return renderAccountCorePage(ctx);
			case 'account-plan':
				return renderAccountPlanPage(ctx);
			case 'account-coupons':
				return renderAccountCouponsPage(ctx);
			case 'account-feedback':
				return renderAccountFeedbackPage();
			default:
				return '';
		}
	}

	function renderStudentDashboard(ctx: PCContext): string {
		if (activeDashboardSubpage) {
			return renderDashboardSubpageContent(ctx);
		}
		organizationInviteTokenDraft = organizationInviteTokenDraft || inviteTokenFromUrl();
		return `<div class="pc-dashboard pc-dashboard-simple">
			<div class="pc-dashboard-banners">
				<div class="pc-card" id="pc-resume-banner" data-resume-banner hidden></div>
				<div class="pc-card" id="pc-assignments-banner" data-assignments-banner hidden></div>
				<div class="pc-card" id="pc-daily-banner" data-daily-banner hidden></div>
				<div class="pc-card" id="pc-goal-banner" data-goal-banner hidden></div>
			</div>
			<div class="pc-card pc-my-content-card">
				<div class="pc-my-content-head">我的内容</div>
				${renderStudentContentGroups(ctx)}
			</div>
			${renderMyAccountPage(ctx)}
			${renderPendingInvitationPanel(ctx)}
			${renderInviteEntryCard(organizationInviteTokenDraft)}
		</div>`;
	}

	function renderDashboard(ctx: PCContext): string {
		if (activeDashboardSubpage) {
			return renderDashboardSubpageContent(ctx);
		}
		const workbench = activeWorkbenchDef(ctx);
		if (workbench.id === 'student') {
			return renderStudentDashboard(ctx);
		}
		organizationInviteTokenDraft = organizationInviteTokenDraft || inviteTokenFromUrl();
		return `<div class="pc-dashboard pc-dashboard-simple pc-role-dashboard">
			${renderRoleWorkbenchCard(ctx, workbench)}
			${renderMyAccountPage(ctx)}
		</div>`;
	}

	function accountSessionDeviceLabel(userAgent: string): string {
		const browser = /Edg\//.test(userAgent)
			? 'Edge'
			: /Firefox\//.test(userAgent)
				? 'Firefox'
				: /Chrome\//.test(userAgent)
					? 'Chrome'
					: /Safari\//.test(userAgent)
						? 'Safari'
						: '浏览器';
		const system = /Windows/i.test(userAgent)
			? 'Windows'
			: /Android/i.test(userAgent)
				? 'Android'
				: /iPhone|iPad/i.test(userAgent)
					? 'iOS'
					: /Mac OS/i.test(userAgent)
						? 'macOS'
						: /Linux/i.test(userAgent)
							? 'Linux'
							: '未知设备';
		return `${system} · ${browser}`;
	}

	function renderAccountSessionEditor(): string {
		if (accountSessionsLoading) {
			return '<div class="pc-account-editor"><div class="pc-admin-note">正在读取登录设备...</div></div>';
		}
		if (!accountSessionsLoaded) {
			return '<div class="pc-account-editor"><div class="pc-admin-note">展开后会显示当前账号最近仍有效的登录设备。</div></div>';
		}
		const otherSessionCount = accountSessions.filter((session) => !session.current).length;
		const visibleSessions = accountSessions.slice(0, 10);
		const hiddenSessionCount = Math.max(0, accountSessions.length - visibleSessions.length);
		const rows = visibleSessions.map((session) => `<div class="pc-account-session-row">
			<div class="pc-account-session-main">
				<strong>${escapeHtml(accountSessionDeviceLabel(session.userAgent))}${session.current ? ' <span class="pc-tag">当前设备</span>' : ''}</strong>
				<span>最近使用 ${escapeHtml(formatDateTime(session.lastSeenAt || session.createdAt))}${session.clientIp ? ` · IP ${escapeHtml(session.clientIp)}` : ''}</span>
				<em>有效期至 ${escapeHtml(formatDateTime(session.expiresAt))}</em>
			</div>
			${session.current
				? ''
				: `<button class="pc-inline-ghost" type="button" data-account-revoke-session="${escapeHtml(session.sessionId)}">退出</button>`}
		</div>`).join('');
		return `<div class="pc-account-editor">
			<div class="pc-account-session-list">${rows || '<div class="pc-admin-note">没有可用会话，请重新登录。</div>'}</div>
			${hiddenSessionCount ? `<div class="pc-admin-note">另有 ${hiddenSessionCount} 个历史会话未展开；可以使用“退出其他设备”一次清理。</div>` : ''}
			<div class="pc-account-actions">
				<button class="pc-inline-ghost" type="button" data-account-refresh-sessions>刷新</button>
				<button class="pc-inline-btn" type="button" data-account-revoke-other-sessions${otherSessionCount ? '' : ' disabled'}>退出其他设备${otherSessionCount ? `（${otherSessionCount}）` : ''}</button>
			</div>
		</div>`;
	}

	function renderAccountManagementCard(ctx: PCContext): string {
		const phoneText = maskPhone(ctx.phone);
		const phoneStatus = ctx.phoneVerified ? '已验证' : '未验证';
		const passwordStatus = ctx.hasPassword ? '可使用密码登录' : '短信登录后可先设置密码';
		const wechatStatus = ctx.wechatBound ? `已绑定${ctx.wechatNickname ? ` · ${ctx.wechatNickname}` : ''}` : '尚未绑定';
		const passwordEditor =
			activeAccountEditor === 'password'
				? `<form class="pc-account-editor" data-account-password-form>
					<div class="pc-admin-note">${ctx.hasPassword ? '请输入当前密码后设置新密码。' : '当前账号还没有密码，直接设置新密码后，下次就可以使用手机号/账号 + 密码登录。'}</div>
					${ctx.hasPassword ? `<input class="pc-profile-input" type="password" data-account-current-password autocomplete="current-password" value="${escapeHtml(accountSecurityDraft.currentPassword)}" placeholder="当前密码" />` : ''}
					<input class="pc-profile-input" type="password" data-account-new-password autocomplete="new-password" value="${escapeHtml(accountSecurityDraft.newPassword)}" placeholder="请输入新密码：至少8位，含字母和数字" />
					<input class="pc-profile-input" type="password" data-account-confirm-password autocomplete="new-password" value="${escapeHtml(accountSecurityDraft.confirmPassword)}" placeholder="请再次输入新密码" />
					<div class="pc-account-actions"><button class="pc-inline-btn" type="submit">${ctx.hasPassword ? '完成修改' : '设置密码'}</button><button class="pc-inline-ghost" type="button" data-account-action="">取消</button></div>
				</form>`
				: '';
		const phoneEditor =
			activeAccountEditor === 'phone'
				? `<div class="pc-account-editor">${renderContactVerificationMethod(ctx, { kind: 'phone', value: ctx.phone || '', verified: Boolean(ctx.phoneVerified), draftValue: contactVerificationDraft.phone || ctx.phone || '', draftCode: contactVerificationDraft.phoneCode })}</div>`
				: '';
		const wechatEditor =
			activeAccountEditor === 'wechat'
				? `<form class="pc-account-editor" data-account-wechat-form>
					<div class="pc-admin-note">${ctx.wechatBound ? '当前账号已经绑定微信。重新绑定会覆盖原有微信账号。' : '绑定后可以使用微信快捷登录当前账号。'}</div>
					<input class="pc-profile-input" type="text" data-account-wechat-code value="${escapeHtml(accountSecurityDraft.wechatCode)}" placeholder="微信授权 ID，例如 wxdev_001" />
					<div class="pc-account-actions"><button class="pc-inline-btn" type="submit">绑定微信</button><button class="pc-inline-ghost" type="button" data-account-action="">取消</button></div>
				</form>`
				: '';
		const sessionEditor = activeAccountEditor === 'sessions' ? renderAccountSessionEditor() : '';
		const deleteEditor =
			activeAccountEditor === 'delete'
				? `<form class="pc-account-editor pc-account-danger-zone" data-account-delete-form>
					<div class="pc-admin-note">账号注销后将无法继续登录，学习记录、订单、权益和绑定关系会停止使用。为了避免误触，需要先验证当前手机号，再输入“注销账号”后提交。</div>
					<div class="pc-admin-note">当前手机号：${escapeHtml(phoneText)}${ctx.phoneVerified && ctx.phone ? '' : '。请先绑定并验证手机号后再注销。'}</div>
					<div class="pc-verify-input-row">
						<input class="pc-profile-input" type="text" inputmode="numeric" data-account-delete-phone-code value="${escapeHtml(accountSecurityDraft.deletePhoneCode)}" placeholder="请输入短信验证码" />
						<button class="pc-inline-ghost" type="button" data-account-delete-send-phone-code ${ctx.phoneVerified && ctx.phone ? '' : 'disabled'}>发送验证码</button>
					</div>
					<input class="pc-profile-input" type="text" data-account-delete-confirm value="${escapeHtml(accountSecurityDraft.deleteConfirmation)}" placeholder="请输入：注销账号" />
					<div class="pc-account-actions"><button class="pc-inline-danger" type="submit">申请注销</button><button class="pc-inline-ghost" type="button" data-account-action="">再想想</button></div>
				</form>`
				: '';
		const row = (icon: string, title: string, desc: string, status: string, action: typeof activeAccountEditor, danger = false) =>
			`<button class="pc-account-row${danger ? ' is-danger' : ''}" type="button" data-account-action="${action}">
				<span class="pc-account-icon">${icon}</span>
				<span class="pc-account-main"><strong>${escapeHtml(title)}</strong><em>${escapeHtml(desc)}</em></span>
				<span class="pc-account-status">${escapeHtml(status)} ›</span>
			</button>`;
		return `<div class="pc-card pc-info-card pc-account-card">
			<div class="pc-account-phone">${escapeHtml(phoneText)}</div>
			<div class="pc-account-list">
				${row('🔒', '修改密码', passwordStatus, activeAccountEditor === 'password' ? '收起' : '去设置', 'password')}
				${passwordEditor}
				${row('📱', '更换手机号', phoneStatus, activeAccountEditor === 'phone' ? '收起' : '去更换', 'phone')}
				${phoneEditor}
				${row('💬', '微信登录', '绑定后可使用微信快捷登录本账号', activeAccountEditor === 'wechat' ? '收起' : wechatStatus, 'wechat')}
				${wechatEditor}
				${row('🖥️', '登录设备', '查看有效会话并退出其他设备', activeAccountEditor === 'sessions' ? '收起' : (accountSessionsLoaded ? `${accountSessions.length} 个` : '管理'), 'sessions')}
				${sessionEditor}
				${row('⌫', '注销账号', '停用账号并退出当前登录', activeAccountEditor === 'delete' ? '收起' : '谨慎操作', 'delete', true)}
				${deleteEditor}
			</div>
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
			${renderAccountManagementCard(ctx)}
			${renderContactVerificationCard(ctx)}
			${renderReferralCard(ctx)}
			<div class="pc-card pc-info-card pc-avatar-picker-card">
				<div class="pc-service-header">头像选择 <span class="pc-avatar-picker-credit-inline">头像由 DiceBear 生成 &mdash; <a href="https://www.dicebear.com" target="_blank" rel="noopener">dicebear.com</a></span></div>
				<div class="pc-avatar-style-grid">
					<div class="pc-avatar-preview-chip" id="pc-avatar-preview-chip" title="当前预览">
						${ctx.avatar ? `<img src="${escapeHtml(ctx.avatar)}" alt="" class="pc-avatar-preview-chip-img" />` : `<span class="pc-avatar-preview-chip-label">当前</span>`}
					</div>
					${getStyleRegistry().map((s) => `<button type="button" class="pc-avatar-style-chip" data-style-key="${s.key}" title="${escapeHtml(s.displayName)}">
						<img src="${s.thumbnail}" alt="${escapeHtml(s.displayName)}" class="pc-avatar-style-chip-img" />
						<span class="pc-avatar-style-chip-name">${escapeHtml(s.displayName)}</span>
					</button>`).join('')}
				</div>
				<div class="pc-avatar-picker-actions">
					<button type="button" class="pc-avatar-picker-action" data-action="random-avatar"><span class="pc-action-icon">🎲</span> 随机</button>
					<button type="button" class="pc-avatar-picker-action" data-action="customize-avatar"><span class="pc-action-icon">✏️</span> 定制</button>
					<button type="button" class="pc-avatar-picker-action" data-action="apply-avatar" id="pc-avatar-apply"><span class="pc-action-icon">💾</span> 应用</button>
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
						const seatsText = organization.seats > 0 ? `${organization.memberCount}/${organization.seats} 席` : `${organization.memberCount} 人`;
						return `<div class="pc-card pc-info-card"><div class="pc-service-header">${escapeHtml(organization.name)}</div><div class="pc-org-card"><div class="pc-org-head"><div><div class="pc-org-name">${escapeHtml(organization.name)}</div><div class="pc-org-type">${escapeHtml(organizationTypeLabel(organization.organizationType))}组织</div></div><div class="pc-org-seat">${escapeHtml(seatsText)}</div></div><div class="pc-org-meta"><div class="pc-org-metric"><span>套餐</span><strong>${escapeHtml(planLabel(organization.plan))}</strong></div><div class="pc-org-metric"><span>状态</span><strong>${escapeHtml(organization.status)}</strong></div><div class="pc-org-metric"><span>成员数</span><strong>${escapeHtml(String(organization.memberCount))}</strong></div></div><div class="pc-admin-note">这里可以维护成员、席位、校区、学习组和课程包。班级制和约课制都会统一进入学习组模型。</div>${renderOrganizationSubscriptionPanel(organization)}${renderOrganizationCampusPanel(organization)}${renderOrganizationCoursePackagePanel(organization)}${renderOrganizationSchedulePanel(organization)}${renderOrganizationLearningGroupPanel(organization)}${renderOrganizationMembersByRolePanel(organization)}${renderOrganizationAuditPanel(organization)}</div></div>`;
					})
					.join('');
			}
		}

		const roleNote = canManage
			? '机构管理员现在会直接看到成员、权限模板、席位和套餐摘要。'
			: '老师、教学运营、内容管理员会看到各自工作台；机构管理员进入组织后，会出现成员管理视图。';

		return `<div class="pc-profile-stack"><div class="pc-card pc-info-card"><div class="pc-service-header">管理面板</div><div class="pc-info-list"><div class="pc-info-row"><span>当前空间</span><strong>${escapeHtml(scopeLabel(ctx))}</strong></div>${organizationRow}<div class="pc-info-row"><span>当前角色</span><strong>${roleText}</strong></div></div><div class="pc-admin-note">${escapeHtml(roleNote)}</div></div>${renderInstitutionWorkbenchShell(ctx)}${organizationPanel}</div>`;
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
			pendingAvatarUrl = null;
			showToast(avatarUrl ? '头像已更新' : '已恢复默认头像');
		} catch (error) {
			log('save avatar failed', error);
			showToast('头像保存失败');
		}
	}

	/* ---- Pending avatar helpers ---- */

	function showAvatarPreview(): void {
		const chip = document.getElementById('pc-avatar-preview-chip');
		if (!chip) return;
		if (pendingAvatarUrl === null || pendingAvatarUrl === undefined) {
			return;
		}
		if (pendingAvatarUrl === '') {
			chip.innerHTML = '<span class="pc-avatar-preview-chip-label">当前</span>';
		} else {
			chip.innerHTML = `<img src="${escapeHtml(pendingAvatarUrl)}" alt="" class="pc-avatar-preview-chip-img" />`;
		}
	}

	function updateStyleChips(selectedKey: string): void {
		document.querySelectorAll('.pc-avatar-style-chip').forEach((el) => {
			const key = (el as HTMLButtonElement).dataset.styleKey || '';
			el.classList.toggle('active', key === selectedKey);
		});
	}

	/* ---- Avatar editor modal (multi-style, like dicebear.com) ---- */

	let editorModal: HTMLDivElement | null = null;
	let editorStyles: StyleInfo[] | null = null;
	let editorTabs: TabDef[] = [];
	let activeTabId = '';
	let editorState: EditorState = { styleKey: 'lorelei', seed: generateRandomSeed(), options: {} };
	let pendingAvatarUrl: string | null = null;

	function getStyleRegistry(): StyleInfo[] {
		if (!editorStyles) editorStyles = buildStyleRegistry();
		return editorStyles;
	}

	function ensureEditorModal(): HTMLDivElement {
		if (editorModal) return editorModal;
		const modal = document.createElement('div');
		modal.id = 'pc-avatar-editor-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;box-sizing:border-box;overflow:auto;';
		modal.innerHTML = `
			<div class="pc-avatar-editor-panel">
				<div class="pc-avatar-editor-header">
					<h3 id="pc-avatar-editor-title">定制头像</h3>
					<button type="button" class="pc-avatar-editor-close" id="pc-avatar-editor-close" aria-label="关闭">&times;</button>
				</div>
				<div class="pc-avatar-editor-styles" id="pc-editor-styles"></div>
				<div class="pc-avatar-editor-body">
					<div class="pc-avatar-editor-preview-area">
						<div class="pc-avatar-editor-preview" id="pc-editor-preview"></div>
					</div>
					<div class="pc-avatar-editor-controls">
						<div class="pc-avatar-editor-toolbar">
							<button type="button" class="pc-avatar-editor-btn pc-avatar-editor-btn-secondary" id="pc-editor-random">🎲 随机全部</button>
						</div>
						<div class="pc-avatar-editor-tabs" id="pc-editor-tabs"></div>
						<div class="pc-avatar-editor-tab-content" id="pc-editor-tab-content"></div>
					</div>
				</div>
				<div class="pc-avatar-editor-footer">
					<button type="button" class="pc-avatar-editor-btn pc-avatar-editor-btn-primary" id="pc-editor-save">保存</button>
				</div>
			</div>`;
		document.body.appendChild(modal);
		editorModal = modal;
		prepareLegacyModal(modal, 'pc-avatar-editor-title', '.pc-avatar-editor-panel');

		const closeBtn = modal.querySelector('#pc-avatar-editor-close') as HTMLButtonElement;
		closeBtn.onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
		});
		return modal;
	}

	function renderStylePicker(modal: HTMLDivElement): void {
		const container = modal.querySelector('#pc-editor-styles') as HTMLDivElement;
		if (!container) return;
		const styles = getStyleRegistry();
		container.innerHTML = `<span class="pc-avatar-editor-styles-label">风格</span>
			<div class="pc-avatar-editor-styles-scroll">${styles.map((s) =>
				`<button type="button" class="pc-avatar-style-chip${s.key === editorState.styleKey ? ' active' : ''}" data-style-key="${s.key}" title="${escapeHtml(s.displayName)}">
					<img src="${s.thumbnail}" alt="${escapeHtml(s.displayName)}" class="pc-avatar-style-chip-img" />
					<span class="pc-avatar-style-chip-name">${escapeHtml(s.displayName)}</span>
				</button>`
			).join('')}</div>`;
		// Click to switch style
		container.querySelectorAll('[data-style-key]').forEach((el) => {
			el.addEventListener('click', () => {
				const key = (el as HTMLButtonElement).dataset.styleKey || 'lorelei';
				switchStyle(modal, key);
			});
		});
	}

	function switchStyle(modal: HTMLDivElement, styleKey: string): void {
		editorState.styleKey = styleKey;
		editorState.seed = generateRandomSeed();
		const style = getStyleByKey(styleKey);
		if (style) {
			editorTabs = parseStyleSchema(style);
		} else {
			editorTabs = [];
		}
		// Reset options for new style
		editorState.options = {};
		activeTabId = editorTabs.length > 0 ? editorTabs[0].id : '';

		// Update style chips
		modal.querySelectorAll('.pc-avatar-style-chip').forEach((el) => {
			el.classList.toggle('active', (el as HTMLButtonElement).dataset.styleKey === styleKey);
		});

		renderTabs(modal);
		renderTabContent(modal);
		updatePreview(modal);
	}

	function renderTabs(modal: HTMLDivElement): void {
		const tabBar = modal.querySelector('#pc-editor-tabs') as HTMLDivElement;
		if (!tabBar) return;
		if (editorTabs.length === 0) {
			tabBar.innerHTML = '<span class="pc-avatar-editor-no-controls">此风格无需额外设置</span>';
			return;
		}
		tabBar.innerHTML = editorTabs.map((t) =>
			`<button type="button" class="pc-avatar-editor-tab-btn${t.id === activeTabId ? ' active' : ''}" data-tab-id="${t.id}">${escapeHtml(t.label)}</button>`
		).join('');
		tabBar.querySelectorAll('[data-tab-id]').forEach((el) => {
			el.addEventListener('click', () => {
				activeTabId = (el as HTMLButtonElement).dataset.tabId || editorTabs[0]?.id || '';
				modal.querySelectorAll('.pc-avatar-editor-tab-btn').forEach((b) => b.classList.remove('active'));
				el.classList.add('active');
				renderTabContent(modal);
			});
		});
	}

	function renderTabContent(modal: HTMLDivElement): void {
		const content = modal.querySelector('#pc-editor-tab-content') as HTMLDivElement;
		if (!content) return;
		const tab = editorTabs.find((t) => t.id === activeTabId);
		if (!tab) { content.innerHTML = ''; return; }

		content.innerHTML = tab.controls.map((ctrl) => renderControl(ctrl)).join('');

		// Wire up event listeners
		content.querySelectorAll('select[data-editor-ctrl]').forEach((el) => {
			(el as HTMLSelectElement).onchange = () => {
				const key = (el as HTMLSelectElement).dataset.editorCtrl || '';
				const val = (el as HTMLSelectElement).value || null;
				editorState.options[key] = val;
				updatePreview(modal);
			};
		});
		content.querySelectorAll('input[data-editor-ctrl][type="checkbox"]').forEach((el) => {
			(el as HTMLInputElement).onchange = () => {
				const key = (el as HTMLInputElement).dataset.editorCtrl || '';
				editorState.options[key] = (el as HTMLInputElement).checked;
				// Enable/disable linked select
				const parentKey = ctrlParentKey(key);
				const linkedSel = content.querySelector<HTMLSelectElement>(`select[data-editor-ctrl="${parentKey}"]`);
				if (linkedSel) linkedSel.disabled = !(el as HTMLInputElement).checked;
				updatePreview(modal);
			};
		});
		content.querySelectorAll('.pc-avatar-editor-swatch').forEach((el) => {
			el.addEventListener('click', () => {
				const swatch = el as HTMLButtonElement;
				const parent = swatch.closest('.pc-avatar-editor-swatches') as HTMLDivElement | null;
				if (!parent) return;
				parent.querySelectorAll('.pc-avatar-editor-swatch').forEach((s) => s.classList.remove('active'));
				swatch.classList.add('active');
				const key = parent.dataset.editorCtrl || '';
				editorState.options[key] = swatch.dataset.color || '';
				updatePreview(modal);
			});
		});
	}

	function ctrlParentKey(probKey: string): string {
		return probKey.replace(/Probability$/, '');
	}

	function renderControl(ctrl: ControlDef): string {
		const currentVal = editorState.options[ctrl.key] ?? ctrl.defaultValue ?? null;
		if (ctrl.type === 'select') {
			const opts = ctrl.options || [];
			return `<div class="pc-avatar-editor-field">
				<label class="pc-avatar-editor-label">${escapeHtml(ctrl.label)}</label>
				<select data-editor-ctrl="${ctrl.key}">
					<option value="">随机</option>
					${opts.map((o) => `<option value="${o}"${currentVal === o ? ' selected' : ''}>${escapeHtml(variantLabelSimple(o))}</option>`).join('')}
				</select>
			</div>`;
		}
		if (ctrl.type === 'toggle') {
			const checked = currentVal === true || currentVal === 'true';
			const parentKey = ctrl.parentKey || ctrl.key.replace(/Probability$/, '');
			return `<div class="pc-avatar-editor-field pc-avatar-editor-field-toggle">
				<label class="pc-avatar-editor-label">${escapeHtml(ctrl.label)}</label>
				<label class="pc-avatar-editor-switch">
					<input type="checkbox" data-editor-ctrl="${ctrl.key}"${checked ? ' checked' : ''} />
					<span class="pc-avatar-editor-slider"></span>
				</label>
			</div>`;
		}
		if (ctrl.type === 'color') {
			const colors = guessColorPalette(ctrl.key);
			return `<div class="pc-avatar-editor-field">
				<label class="pc-avatar-editor-label">${escapeHtml(ctrl.label)}</label>
				<div class="pc-avatar-editor-swatches" data-editor-ctrl="${ctrl.key}">
					${colors.map((c) =>
						`<button type="button" class="pc-avatar-editor-swatch${currentVal === c ? ' active' : ''}" data-color="${c}" style="background:#${c};" title="#${c}"></button>`
					).join('')}
				</div>
			</div>`;
		}
		return '';
	}

	function variantLabelSimple(v: string): string {
		if (v.startsWith('happy')) return `😊 ${v.replace('happy', '')}`;
		if (v.startsWith('sad'))   return `😢 ${v.replace('sad', '')}`;
		if (v.startsWith('variant') || /^\d+$/.test(v.replace(/^\D+/, ''))) {
			return `#${v.replace(/^\D+/, '')}`;
		}
		return v.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^[a-z]/, (c) => c.toUpperCase());
	}

	function guessColorPalette(key: string): string[] {
		if (key.includes('Skin') || key.includes('skin')) {
			return ['f8d5c0', 'fce8d2', 'f0c8a0', 'e0ac80', 'd4a574', 'c68e62', 'b57d52', 'a06b42', '8a5a35', '6a4526', '4a2c1a'];
		}
		if (key.includes('Hair') || key.includes('hair')) {
			return ['000000', '2d1c0a', '4a2c1a', '6c4545', '8b4513', 'a55742', 'c46b3f', 'd99b5a', 'e8c48a', 'f4e3c6', '1a1a2e', 'e05a5a', '2980b9', '27ae60', 'c0392b', '8e44ad'];
		}
		return ['000000', '333333', '666666', '999999', 'cccccc', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00'];
	}

	function updatePreview(modal: HTMLDivElement): void {
		const preview = modal.querySelector('#pc-editor-preview') as HTMLDivElement | null;
		if (!preview) return;
		const url = buildAvatarUrl(editorState);
		preview.innerHTML = `<img src="${escapeHtml(url)}" alt="preview" class="pc-avatar-editor-preview-img" />`;
	}

	async function openAvatarEditor(): Promise<void> {
		const ctx = getContext();
		if (ctx.guest || !ctx.id) {
			showToast('请先登录后定制头像');
			return;
		}
		const modal = ensureEditorModal();
		const styles = getStyleRegistry();

		// Reset state
		editorState = { styleKey: 'lorelei', seed: generateRandomSeed(), options: {} };
		activeTabId = '';

		// Render style picker
		renderStylePicker(modal);

		// Initialize with lorelei
		const loreleiStyle = getStyleByKey('lorelei');
		if (loreleiStyle) {
			editorTabs = parseStyleSchema(loreleiStyle);
			activeTabId = editorTabs.length > 0 ? editorTabs[0].id : '';
		}

		renderTabs(modal);
		renderTabContent(modal);
		updatePreview(modal);

		// Random button
		const randomBtn = modal.querySelector('#pc-editor-random') as HTMLButtonElement | null;
		if (randomBtn) {
			randomBtn.onclick = () => {
				editorState = randomizeEditorState(editorState.styleKey);
				editorTabs = parseStyleSchema(getStyleByKey(editorState.styleKey) || {});
				activeTabId = editorTabs.length > 0 ? editorTabs[0].id : '';
				renderTabs(modal);
				renderTabContent(modal);
				updatePreview(modal);
			};
		}

		// Save button
		const saveBtn = modal.querySelector('#pc-editor-save') as HTMLButtonElement | null;
		if (saveBtn) {
			saveBtn.onclick = () => {
				const url = buildAvatarUrl(editorState);
				void saveSelectedAvatar(url);
				hideLegacyModal(modal);
			};
		}

		showLegacyModal(modal, '#pc-avatar-editor-close');
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
			const form = emailSendButton.closest('form') as HTMLFormElement | null;
			const input = form?.querySelector('[data-verify-email]') as HTMLInputElement | null;
			void sendEmailVerificationCode(input?.value || contactVerificationDraft.email, form || undefined, emailSendButton);
			return true;
		}
		const phoneSendButton = target?.closest('[data-phone-send-code]') as HTMLButtonElement | null;
		if (phoneSendButton) {
			const form = phoneSendButton.closest('form') as HTMLFormElement | null;
			const input = form?.querySelector('[data-verify-phone]') as HTMLInputElement | null;
			void sendPhoneVerificationCode(input?.value || contactVerificationDraft.phone, form || undefined, phoneSendButton);
			return true;
		}
		return false;
	}

	function handleContactVerificationSubmit(form: HTMLFormElement): boolean {
		if (form.matches('form[data-email-verify-form]')) {
			const emailInput = form.querySelector('[data-verify-email]') as HTMLInputElement | null;
			const codeInput = form.querySelector('[data-verify-email-code]') as HTMLInputElement | null;
			void verifyEmailAddress(emailInput?.value || '', codeInput?.value || '', form);
			return true;
		}
		if (form.matches('form[data-phone-verify-form]')) {
			const phoneInput = form.querySelector('[data-verify-phone]') as HTMLInputElement | null;
			const codeInput = form.querySelector('[data-verify-phone-code]') as HTMLInputElement | null;
			void verifyPhoneNumber(phoneInput?.value || '', codeInput?.value || '', form);
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

	async function loadAccountSessions(force = false): Promise<void> {
		if (accountSessionsLoading || (accountSessionsLoaded && !force)) return;
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !api || typeof api.getAuthSessions !== 'function') {
			showToast('登录设备接口暂不可用');
			return;
		}
		accountSessionsLoading = true;
		renderSectionContent({ preserveScroll: true });
		try {
			const raw = await api.getAuthSessions(token);
			accountSessions = (Array.isArray(raw) ? raw : []).flatMap((value) => {
				const session = asRecord(value);
				const sessionId = readString(session?.session_id);
				if (!session || !sessionId) return [];
				return [{
					sessionId,
					current: session.current === true,
					createdAt: readString(session.created_at) || '',
					lastSeenAt: readString(session.last_seen_at) || '',
					expiresAt: readString(session.expires_at) || '',
					clientIp: readString(session.client_ip) || '',
					userAgent: readString(session.user_agent) || ''
				}];
			}).sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
			accountSessionsLoaded = true;
		} catch (error) {
			showToast(readErrorMessage(error, '登录设备加载失败'));
		} finally {
			accountSessionsLoading = false;
			renderSectionContent({ preserveScroll: true });
		}
	}

	async function revokeAccountSession(sessionId: string, button?: HTMLButtonElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !sessionId || !api || typeof api.revokeAuthSession !== 'function') {
			showToast('登录设备接口暂不可用');
			return;
		}
		if (!await requestConfirmation('确认退出这台设备吗？该设备需要重新登录。', '确认退出')) return;
		const finishAction = beginOrganizationAction(button, '退出中…');
		if (button && !finishAction) return;
		try {
			await api.revokeAuthSession(token, sessionId);
			accountSessionsLoaded = false;
			await loadAccountSessions(true);
			showToast('该设备已退出');
		} catch (error) {
			showToast(readErrorMessage(error, '设备退出失败'));
		} finally {
			finishAction?.();
		}
	}

	async function revokeOtherAccountSessions(button?: HTMLButtonElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !api || typeof api.revokeOtherAuthSessions !== 'function') {
			showToast('登录设备接口暂不可用');
			return;
		}
		if (!await requestConfirmation('确认退出除当前设备以外的全部登录吗？', '全部退出')) return;
		const finishAction = beginOrganizationAction(button, '退出中…');
		if (button && !finishAction) return;
		try {
			const result = asRecord(await api.revokeOtherAuthSessions(token)) || {};
			accountSessionsLoaded = false;
			await loadAccountSessions(true);
			showToast(`已退出 ${readCount(result.revoked_sessions) ?? 0} 个其他设备`);
		} catch (error) {
			showToast(readErrorMessage(error, '其他设备退出失败'));
		} finally {
			finishAction?.();
		}
	}

	async function changeCurrentPassword(currentPassword: string, newPassword: string, confirmPassword: string, form: HTMLFormElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		clearFormFieldErrors(form);
		const currentInput = form.querySelector<HTMLInputElement>('[data-account-current-password], #pc-current-password');
		const newInput = form.querySelector<HTMLInputElement>('[data-account-new-password], #pc-new-password');
		const confirmInput = form.querySelector<HTMLInputElement>('[data-account-confirm-password]');
		if (!token || !api || typeof api.changePassword !== 'function') {
			showToast('修改密码接口暂不可用');
			return;
		}
		if (!newPassword || !confirmPassword) {
			setFieldError(!newPassword ? newInput : confirmInput || newInput, '请输入新密码并再次确认');
			return;
		}
		if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
			setFieldError(newInput, '新密码至少 8 位，并且需要同时包含字母和数字');
			return;
		}
		if (newPassword !== confirmPassword) {
			setFieldError(confirmInput || newInput, '两次输入的新密码不一致');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		const finishAction = submit ? beginOrganizationAction(submit, '保存中…') : null;
		if (submit && !finishAction) return;
		try {
			const result = asRecord(await api.changePassword(token, currentPassword, newPassword)) || {};
			form.reset();
			accountSecurityDraft.currentPassword = '';
			accountSecurityDraft.newPassword = '';
			accountSecurityDraft.confirmPassword = '';
			accountSessionsLoaded = false;
			activeAccountEditor = '';
			await refreshCurrentContextFromApi();
			renderSectionContent({ preserveScroll: true });
			const revoked = readCount(result.revoked_sessions) ?? 0;
			showToast(revoked > 0 ? `密码已更新，并退出 ${revoked} 个其他设备` : '密码已更新');
		} catch (error) {
			log('change password failed', error);
			const message = readErrorMessage(error, '密码更新失败');
			setFieldError(currentInput || newInput, message);
			showToast(message);
		} finally {
			finishAction?.();
		}
	}

	async function bindWechatAccount(code: string, form: HTMLFormElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		clearFormFieldErrors(form);
		const codeInput = form.querySelector<HTMLInputElement>('[data-account-wechat-code]');
		if (!token || !api || typeof api.bindWechat !== 'function') {
			showToast('微信绑定接口暂不可用');
			return;
		}
		const normalizedCode = code.trim();
		if (!normalizedCode) {
			setFieldError(codeInput, '请先完成微信授权');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		const finishAction = submit ? beginOrganizationAction(submit, '绑定中…') : null;
		if (submit && !finishAction) return;
		try {
			await api.bindWechat(token, normalizedCode);
			form.reset();
			accountSecurityDraft.wechatCode = normalizedCode;
			activeAccountEditor = '';
			await refreshCurrentContextFromApi();
			renderSectionContent({ preserveScroll: true });
			showToast('微信已绑定');
		} catch (error) {
			log('bind wechat failed', error);
			const message = readErrorMessage(error, '微信绑定失败');
			setFieldError(codeInput, message);
			showToast(message);
		} finally {
			finishAction?.();
		}
	}

	async function sendAccountDeletePhoneCode(button?: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const api = window.APIClient;
		const phone = (ctx.phone || '').trim();
		if (!ctx.phoneVerified || !phone) {
			showToast('请先绑定并验证手机号');
			return;
		}
		if (!api || typeof api.sendPhoneVerificationCode !== 'function') {
			showToast('手机验证码接口暂不可用');
			return;
		}
		const finishAction = button ? beginOrganizationAction(button, '发送中…') : null;
		if (button && !finishAction) return;
		try {
			const data = asRecord(await api.sendPhoneVerificationCode(phone));
			const remainingValue = data?.daily_remaining;
			const remaining = typeof remainingValue === 'number' ? String(remainingValue) : readString(remainingValue) || '';
			showToast(`注销验证码已发送${remaining ? `，今日剩余 ${remaining} 次` : ''}`);
		} catch (error) {
			log('send account delete phone code failed', error);
			showToast(readErrorMessage(error, '注销验证码发送失败'));
		} finally {
			finishAction?.();
		}
	}

	async function deleteCurrentAccount(confirmation: string, phoneCode: string, form: HTMLFormElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		clearFormFieldErrors(form);
		const codeInput = form.querySelector<HTMLInputElement>('[data-account-delete-phone-code]');
		const confirmationInput = form.querySelector<HTMLInputElement>('[data-account-delete-confirm]');
		if (!token || !api || typeof api.deleteAccount !== 'function') {
			showToast('注销账号接口暂不可用');
			return;
		}
		const phone = (ctx.phone || '').trim();
		if (!ctx.phoneVerified || !phone) {
			showToast('请先绑定并验证手机号');
			return;
		}
		if (!phoneCode.trim()) {
			setFieldError(codeInput, '请输入当前手机号收到的验证码');
			return;
		}
		if (confirmation.trim() !== '注销账号') {
			setFieldError(confirmationInput, '请先输入“注销账号”确认操作');
			return;
		}
		const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
		const finishAction = submit ? beginOrganizationAction(submit, '确认中…') : null;
		if (submit && !finishAction) return;
		if (!await requestConfirmation('确认注销当前账号？注销后将退出登录。')) {
			finishAction?.();
			return;
		}
		try {
			await api.deleteAccount(token, confirmation.trim(), phone, phoneCode.trim(), 'user_requested');
			localStorage.removeItem('exam_v2_token');
			localStorage.removeItem('exam_v2_user');
			setContext({ guest: true });
			activeAccountEditor = '';
			accountSecurityDraft.deleteConfirmation = '';
			accountSecurityDraft.deletePhoneCode = '';
			closePanel();
			showToast('账号已注销并退出登录');
		} catch (error) {
			log('delete account failed', error);
			const message = readErrorMessage(error, '账号注销失败');
			setFieldError(codeInput || confirmationInput, message);
			showToast(message);
		} finally {
			finishAction?.();
		}
	}

	function handleAccountSessionClick(target: HTMLElement | null): boolean {
		const refreshButton = target?.closest('[data-account-refresh-sessions]') as HTMLButtonElement | null;
		if (refreshButton) {
			void loadAccountSessions(true);
			return true;
		}
		const revokeOthersButton = target?.closest('[data-account-revoke-other-sessions]') as HTMLButtonElement | null;
		if (revokeOthersButton) {
			void revokeOtherAccountSessions(revokeOthersButton);
			return true;
		}
		const revokeButton = target?.closest('[data-account-revoke-session]') as HTMLButtonElement | null;
		if (revokeButton) {
			void revokeAccountSession(revokeButton.dataset.accountRevokeSession || '', revokeButton);
			return true;
		}
		return false;
	}

	function attachProfileHandlers(container: HTMLElement): void {
		container.onclick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (handleAccountSessionClick(target)) {
				return;
			}
			if (handleContactVerificationClick(target, container)) {
				return;
			}
			const deletePhoneCodeButton = target?.closest('[data-account-delete-send-phone-code]') as HTMLButtonElement | null;
			if (deletePhoneCodeButton) {
				void sendAccountDeletePhoneCode(deletePhoneCodeButton);
				return;
			}
			const saveBtn = target?.closest('[data-save-display-name]') as HTMLButtonElement | null;
			if (saveBtn) {
				const input = container.querySelector('#pc-display-name-input') as HTMLInputElement | null;
				void saveDisplayName(input?.value || '');
				return;
			}
			const accountAction = target?.closest('[data-account-action]') as HTMLElement | null;
			if (accountAction) {
				const action = (accountAction.dataset.accountAction || '') as typeof activeAccountEditor;
				activeAccountEditor = activeAccountEditor === action ? '' : action;
				if (activeAccountEditor === 'phone') {
					activeContactVerificationEditor = 'phone';
					seedContactVerificationDraft(getContext());
				}
				renderSectionContent({ preserveScroll: true });
				if (activeAccountEditor === 'sessions') void loadAccountSessions();
				return;
			}
			const actionBtn = target?.closest('[data-action]') as HTMLElement | null;
			if (actionBtn) {
				const action = actionBtn.dataset.action;
				if (action === 'random-avatar') {
					const styles = getStyleRegistry();
					const randStyle = styles[Math.floor(Math.random() * styles.length)];
					const state = randomizeEditorState(randStyle.key);
					pendingAvatarUrl = buildAvatarUrl(state);
					showAvatarPreview();
					updateStyleChips(randStyle.key);
					return;
				} else if (action === 'customize-avatar') {
					void openAvatarEditor();
					return;
				}
			}
			const saveApply = target?.closest('#pc-avatar-apply') as HTMLButtonElement | null;
			if (saveApply) {
				if (pendingAvatarUrl !== null) {
					void saveSelectedAvatar(pendingAvatarUrl);
				}
				return;
			}
			const styleBtn = target?.closest('button[data-style-key]') as HTMLButtonElement | null;
			if (styleBtn) {
				const key = styleBtn.dataset.styleKey || '';
				if (!key) {
					pendingAvatarUrl = '';
				} else {
					const state = randomizeEditorState(key);
					pendingAvatarUrl = buildAvatarUrl(state);
				}
				showAvatarPreview();
				updateStyleChips(key);
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
				void changeCurrentPassword(currentPassword, newPassword, newPassword, form);
				return;
			}
			if (form.hasAttribute('data-account-password-form')) {
				const currentPassword = (form.querySelector('[data-account-current-password]') as HTMLInputElement | null)?.value || '';
				const newPassword = (form.querySelector('[data-account-new-password]') as HTMLInputElement | null)?.value || '';
				const confirmPassword = (form.querySelector('[data-account-confirm-password]') as HTMLInputElement | null)?.value || '';
				void changeCurrentPassword(currentPassword, newPassword, confirmPassword, form);
				return;
			}
			if (form.hasAttribute('data-account-wechat-form')) {
				const code = (form.querySelector('[data-account-wechat-code]') as HTMLInputElement | null)?.value || '';
				void bindWechatAccount(code, form);
				return;
			}
			if (form.hasAttribute('data-account-delete-form')) {
				const confirmation = (form.querySelector('[data-account-delete-confirm]') as HTMLInputElement | null)?.value || '';
				const phoneCode = (form.querySelector('[data-account-delete-phone-code]') as HTMLInputElement | null)?.value || '';
				void deleteCurrentAccount(confirmation, phoneCode, form);
				return;
			}
			if (form.matches('form[data-referral-claim-form]')) {
				const input = form.querySelector('[data-referral-code]') as HTMLInputElement | null;
				void claimReferralCode(input?.value || referralCodeDraft, form);
				return;
			}
			handleContactVerificationSubmit(form);
		};
		container.oninput = (event: Event) => {
			const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
			if (!target) {
				return;
			}
			const editedForm = target.closest('form');
			if (editedForm) editedForm.dataset.pcDirty = 'true';
			if (target.hasAttribute('data-account-current-password')) {
				accountSecurityDraft.currentPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-new-password')) {
				accountSecurityDraft.newPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-confirm-password')) {
				accountSecurityDraft.confirmPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-wechat-code')) {
				accountSecurityDraft.wechatCode = target.value;
				return;
			}
			if (target.hasAttribute('data-account-delete-confirm')) {
				accountSecurityDraft.deleteConfirmation = target.value;
				return;
			}
			if (target.hasAttribute('data-account-delete-phone-code')) {
				accountSecurityDraft.deletePhoneCode = target.value;
				return;
			}
			if (target.hasAttribute('data-referral-code')) {
				referralCodeDraft = target.value;
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

	function handleFeatureIntent(intent: string): void {
		if (intent.startsWith('openEntitlementUpgrade:')) {
			const [, entitlementKey = '', requiredPlan = ''] = intent.split(':');
			const planLabel = decodeURIComponent(requiredPlan || '').toUpperCase() || '更高';
			showToast(`该功能需要 ${planLabel} 套餐`);
			void openRechargePanel();
			return;
		}
		if (intent.startsWith('openRoleContent:')) {
			activeSection = 'dashboard';
			activeDashboardSubpage = 'role-content';
			activeRoleContent = intent.slice('openRoleContent:'.length);
			renderSections();
			renderSectionContent();
			return;
		}
		if (intent.startsWith('openExamQuestion:')) {
			const [, examId = '', questionId = '', sectionIndexRaw = ''] = intent.split(':');
			const sectionIndex = Number(sectionIndexRaw);
			void openExamQuestion(examId, questionId, Number.isFinite(sectionIndex) ? sectionIndex : undefined);
			return;
		}
		if (intent.startsWith('openAssignmentExam:')) {
			const [, assignmentId = '', examId = ''] = intent.split(':');
			const decodedAssignmentId = decodeURIComponent(assignmentId);
			const decodedExamId = decodeURIComponent(examId);
			if (!decodedExamId) {
				showToast('该作业未关联可作答试卷');
				return;
			}
			if (decodedAssignmentId) {
				localStorage.setItem('exam_v2_active_assignment', JSON.stringify({ assignment_id: decodedAssignmentId, exam_id: decodedExamId }));
			}
			void resumeExam(decodedExamId, null);
			return;
		}
		switch (intent) {
			case 'gotoProfile':
				activeSection = 'profile';
				activeDashboardSubpage = '';
				renderSections();
				renderSectionContent();
				break;
			case 'openSystemFlags':
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'platform-flags';
				renderSections();
				renderSectionContent();
				break;
			case 'gotoAdminHub':
				activeSection = 'admin-hub';
				activeDashboardSubpage = '';
				renderSections();
				renderSectionContent();
				break;
			case 'openTodayLearning':
				void openReviewWorkbenchPanel();
				break;
			case 'openAssignments': {
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'student-assignments';
				renderSections();
				renderSectionContent();
				break;
			}
			case 'refreshAssignments': {
				void ensureMyAssignments(getContext(), true).then(() => renderSectionContent({ preserveScroll: true }));
				break;
			}
			case 'openRecentLearning': {
				const banner = document.getElementById('pc-resume-banner') as HTMLElement | null;
				if (banner && !banner.hidden && banner.textContent?.trim()) {
					banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
				} else {
					showToast('暂无最近学习记录');
				}
				break;
			}
			case 'openIssueFeedback':
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'support-feedback';
				renderSections();
				renderSectionContent();
				break;
			case 'openCustomerService':
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'support-customer-service';
				renderSections();
				renderSectionContent();
				break;
			case 'openUserAgreement':
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'support-user-agreement';
				renderSections();
				renderSectionContent();
				break;
			case 'openPrivacyPolicy':
				activeSection = 'dashboard';
				activeDashboardSubpage = 'role-content';
				activeRoleContent = 'support-privacy-policy';
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
				// 业务功能 8：进入收藏清单页面，移动端不再依赖宽弹窗管理
				activeSection = 'dashboard';
				activeDashboardSubpage = 'favorites';
				activeFavoriteFolderId = '';
				invalidateFavoriteBookmarks();
				renderSections();
				renderSectionContent();
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

	function handleDashboardOrganizationClick(target: HTMLElement | null): boolean {
		const organizationSummary = target?.closest('summary.pc-managed-org-summary') as HTMLElement | null;
		if (organizationSummary) {
			const details = organizationSummary.closest<HTMLDetailsElement>('details[data-managed-org-id][data-managed-org-mode]');
			const organizationId = details?.dataset.managedOrgId || '';
			const mode = details?.dataset.managedOrgMode || '';
			if (organizationId && mode) {
				const open = !details?.open;
				if (details) details.open = open;
				managedOrganizationOpenState[`${mode}:${organizationId}`] = open;
				if (open) void loadManagedOrganizationDetails(organizationId);
				else renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const organizationPageButton = target?.closest('[data-managed-org-page]') as HTMLButtonElement | null;
		if (organizationPageButton) {
			managedOrganizationListPage.page = Math.max(1, managedOrganizationListPage.page + (organizationPageButton.dataset.managedOrgPage === 'next' ? 1 : -1));
			void reloadManagedOrganizationList();
			return true;
		}
		const campusPageButton = target?.closest('[data-org-campus-list-page]') as HTMLButtonElement | null;
		if (campusPageButton) {
			const organizationId = (campusPageButton.closest('[data-managed-org-id]') as HTMLElement | null)?.dataset.managedOrgId || '';
			if (organizationId) { const state = organizationCampusPageState(organizationId); state.page = Math.max(1, state.page + (campusPageButton.dataset.orgCampusListPage === 'next' ? 1 : -1)); state.loaded = false; void loadOrganizationCampusPage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		const packagePageButton = target?.closest('[data-org-package-list-page]') as HTMLButtonElement | null;
		if (packagePageButton) {
			const organizationId = (packagePageButton.closest('[data-managed-org-id]') as HTMLElement | null)?.dataset.managedOrgId || '';
			if (organizationId) { const state = organizationCoursePackagePageState(organizationId); state.page = Math.max(1, state.page + (packagePageButton.dataset.orgPackageListPage === 'next' ? 1 : -1)); state.loaded = false; void loadOrganizationCoursePackagePage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		const memberPageButton = target?.closest('[data-org-member-list-page]') as HTMLButtonElement | null;
		const memberRetryButton = target?.closest('[data-org-member-list-retry]') as HTMLButtonElement | null;
		if (memberPageButton || memberRetryButton) {
			const card = (memberPageButton || memberRetryButton)?.closest('[data-managed-org-id]') as HTMLElement | null;
			const organizationId = card?.dataset.managedOrgId || '';
			const organization = managedOrganizations.find((item) => item.id === organizationId);
			if (organization) {
				const roleId = activeOrganizationMemberRoleId(organization);
				const state = organizationMemberPageState(organizationId, roleId);
				if (memberPageButton) state.page = Math.max(1, state.page + (memberPageButton.dataset.orgMemberListPage === 'next' ? 1 : -1));
				state.loaded = false;
				void loadOrganizationMemberPage(organizationId, roleId);
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const learningPageButton = target?.closest('[data-org-learning-list-page]') as HTMLButtonElement | null;
		const learningRetryButton = target?.closest('[data-org-learning-list-retry]') as HTMLButtonElement | null;
		if (learningPageButton || learningRetryButton) {
			const card = (learningPageButton || learningRetryButton)?.closest('[data-managed-org-id]') as HTMLElement | null;
			const organizationId = card?.dataset.managedOrgId || '';
			if (organizationId) {
				const state = organizationLearningGroupPageState(organizationId);
				if (learningPageButton) state.page = Math.max(1, state.page + (learningPageButton.dataset.orgLearningListPage === 'next' ? 1 : -1));
				state.loaded = false;
				void loadOrganizationLearningGroupPage(organizationId);
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const emptyStateButton = target?.closest('[data-org-empty-focus]') as HTMLButtonElement | null;
		if (emptyStateButton) {
			const selectors: Record<string, string> = {
				campus: '[data-org-campus-name]',
				'course-package': '[data-org-course-package-student]',
				'learning-group': '[data-org-learning-group-name]'
			};
			const selector = selectors[emptyStateButton.dataset.orgEmptyFocus || ''];
			const field = selector
				? emptyStateButton.closest('.pc-org-subsection')?.querySelector<HTMLElement>(selector)
				: null;
			field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			field?.focus();
			return true;
		}
		const workflowButton = target?.closest('[data-content-workflow-action]') as HTMLButtonElement | null;
		if (workflowButton) {
			void runContentWorkflowAction(workflowButton);
			return true;
		}
		const workflowBatchButton = target?.closest('[data-content-workflow-batch-inspect]') as HTMLButtonElement | null;
		if (workflowBatchButton) {
			void runContentWorkflowBatchInspection(workflowBatchButton);
			return true;
		}
		const paymentRefresh = target?.closest('[data-platform-payments-refresh]') as HTMLButtonElement | null;
		if (paymentRefresh) {
			paymentRefresh.disabled = true;
			platformPaymentsLoaded = false;
			void loadPlatformPayments(true);
			return true;
		}
		const paymentClear = target?.closest('[data-platform-payment-clear]') as HTMLButtonElement | null;
		if (paymentClear) {
			platformPaymentQuery = '';
			platformPaymentPage = 1;
			platformPaymentsLoaded = false;
			void loadPlatformPayments(true);
			return true;
		}
		const paymentPageButton = target?.closest('[data-platform-payment-page]') as HTMLButtonElement | null;
		if (paymentPageButton) {
			const direction = paymentPageButton.dataset.platformPaymentPage;
			platformPaymentPage = Math.max(1, platformPaymentPage + (direction === 'next' ? 1 : -1));
			platformPaymentsLoaded = false;
			void loadPlatformPayments(true);
			return true;
		}
		const feedbackRefresh = target?.closest('[data-platform-feedback-refresh]') as HTMLButtonElement | null;
		if (feedbackRefresh) { platformFeedbackLoaded = false; void loadFeedbackQueue(true); return true; }
		const feedbackPageButton = target?.closest('[data-platform-feedback-page]') as HTMLButtonElement | null;
		if (feedbackPageButton) {
			platformFeedbackPage = Math.max(1, platformFeedbackPage + (feedbackPageButton.dataset.platformFeedbackPage === 'next' ? 1 : -1));
			platformFeedbackLoaded = false; void loadFeedbackQueue(true); return true;
		}
		const featureFlagRetry = target?.closest('[data-platform-system-flags-retry]');
		if (featureFlagRetry) {
			platformSystemFlagsLoaded = false;
			void loadPlatformSystemFlags(true);
			return true;
		}
		const featureFlagButton = target?.closest('[data-platform-system-flag]') as HTMLButtonElement | null;
		if (featureFlagButton) {
			const key = featureFlagButton.dataset.platformSystemFlag || '';
			const rawAction = featureFlagButton.dataset.platformSystemFlagAction;
			const action = rawAction === 'locked' ? 'locked' : rawAction === 'default' ? 'default' : 'enabled';
			const flag = platformSystemFlags.find((item) => item.key === key);
			if (!flag) {
				showToast('系统开关信息已失效，请刷新后重试');
				return true;
			}
			confirmRisk(`${action === 'default' ? '恢复默认' : action === 'enabled' ? '切换' : '修改锁定状态'}：${flag.name}`, key.toUpperCase(), () => {
				void updatePlatformSystemFlag(key, action);
			});
			return true;
		}
		const feedbackOpenButton = target?.closest('[data-feedback-open-question]') as HTMLButtonElement | null;
		if (feedbackOpenButton) {
			const paperId = feedbackOpenButton.dataset.feedbackPaperId || '';
			const questionId = feedbackOpenButton.dataset.feedbackQuestionId || '';
			void openExamQuestion(paperId, questionId);
			return true;
		}
		const feedbackButton = target?.closest('[data-feedback-update]') as HTMLButtonElement | null;
		if (feedbackButton) {
			void updateFeedbackStatus(feedbackButton);
			return true;
		}
		const invitationCancelButton = target?.closest('[data-org-invitation-cancel]') as HTMLButtonElement | null;
		if (invitationCancelButton) {
			const organization = managedOrganizations.find((item) => item.id === (invitationCancelButton.dataset.orgId || ''));
			const invitationId = invitationCancelButton.dataset.invitationId || '';
			const invitationContact = invitationCancelButton.dataset.invitationContact || '';
			const invitation = organization?.invitations.find(
				(item) => item.invitationId === invitationId || (invitationContact && item.contact === invitationContact)
			);
			if (!organization || !invitation) {
				showToast('邀请信息已失效，请刷新后重试');
				return true;
			}
			void cancelOrganizationInvitation(organization, invitation, invitationCancelButton);
			return true;
		}
		const searchButton = target?.closest('[data-org-search]') as HTMLButtonElement | null;
		if (searchButton) {
			const form = searchButton.closest('form[data-org-add-form]') as HTMLFormElement | null;
			const organization = managedOrganizations.find((item) => item.id === (form?.dataset.orgId || ''));
			const input = form?.querySelector('[data-org-search-query]') as HTMLInputElement | null;
			if (!organization || !input) {
				showToast('搜索条件已失效，请刷新后重试');
				return true;
			}
			const mode = form?.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
			void searchOrganizationCandidates(organization, input.value || '', mode);
			return true;
		}
		const pickButton = target?.closest('[data-org-pick-user]') as HTMLButtonElement | null;
		if (pickButton) {
			const organizationId = pickButton.dataset.orgId || '';
			const draft = getOrganizationMemberDraft(organizationId);
			draft.selectedUserId = pickButton.dataset.userId || '';
			renderSectionContent({ preserveScroll: true });
			return true;
		}
		const memberRoleButton = target?.closest('[data-org-member-role]') as HTMLButtonElement | null;
		if (memberRoleButton) {
			const organizationId = memberRoleButton.dataset.orgId || '';
			const roleId = memberRoleButton.dataset.roleId || '';
			if (organizationId && roleId) {
				activeOrganizationMemberRoles[organizationId] = roleId;
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const rolePermissionRoleButton = target?.closest('[data-org-role-permission-role]') as HTMLButtonElement | null;
		if (rolePermissionRoleButton) {
			const organizationId = rolePermissionRoleButton.dataset.orgId || '';
			const roleId = rolePermissionRoleButton.dataset.roleId || '';
			if (organizationId && roleId) {
				activeOrganizationRolePermissionRoles[organizationId] = roleId;
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const rolePermissionRemoveButton = target?.closest('[data-org-role-permission-remove]') as HTMLButtonElement | null;
		if (rolePermissionRemoveButton) {
			const organization = managedOrganizations.find((item) => item.id === (rolePermissionRemoveButton.dataset.orgId || ''));
			const roleId = rolePermissionRemoveButton.dataset.roleId || '';
			const permission = rolePermissionRemoveButton.dataset.permission || '';
			const effect = rolePermissionRemoveButton.dataset.effect === 'deny' ? 'deny' : 'allow';
			if (!organization || !roleId || !permission) {
				showToast('角色权限信息已失效，请刷新后重试');
				return true;
			}
			const config = rolePermissionConfigFor(organization, roleId);
			const allow = effect === 'allow' ? config.allow.filter((item) => item !== permission) : config.allow;
			const deny = effect === 'deny' ? config.deny.filter((item) => item !== permission) : config.deny;
			rolePermissionRemoveButton.disabled = true;
			void saveOrganizationRolePermissions(organization, roleId, allow, deny).finally(() => { rolePermissionRemoveButton.disabled = false; });
			return true;
		}
		const completeLearningGroupButton = target?.closest('[data-org-learning-group-complete]') as HTMLButtonElement | null;
		if (completeLearningGroupButton) {
			const organization = managedOrganizations.find((item) => item.id === (completeLearningGroupButton.dataset.orgId || ''));
			const learningGroup = organization?.learningGroups.find((item) => item.id === (completeLearningGroupButton.dataset.learningGroupId || ''));
			if (!organization || !learningGroup) {
				showToast('学习组信息已失效，请刷新后重试');
				return true;
			}
			void completeOrganizationLearningGroup(organization, learningGroup, completeLearningGroupButton);
			return true;
		}
		const removeButton = target?.closest('[data-org-member-remove]') as HTMLButtonElement | null;
		if (removeButton) {
			const form = removeButton.closest('form[data-org-member-form]') as HTMLFormElement | null;
			const organizationId = form?.dataset.orgId || '';
			const userId = form?.dataset.userId || '';
			const organization = managedOrganizations.find((item) => item.id === organizationId);
			const member = organization?.members.find((item) => item.userId === userId);
			if (!organization || !member) {
				showToast('成员信息已失效，请刷新后重试');
				return true;
			}
			void removeOrganizationMembership(organization, member, removeButton);
			return true;
		}
		const saveMemberButton = target?.closest('[data-org-member-save]') as HTMLButtonElement | null;
		if (saveMemberButton) {
			const form = organizationMemberFormForButton(saveMemberButton);
			if (!form) {
				showToast('成员表单已失效，请刷新后重试');
				return true;
			}
			saveOrganizationMemberForm(form);
			return true;
		}
		return false;
	}

	function handleDashboardOrganizationSubmit(form: HTMLFormElement): boolean {
		if (form.matches('form[data-managed-org-list-form]')) {
			managedOrganizationListPage.query = (form.querySelector('[data-managed-org-query]') as HTMLInputElement | null)?.value.trim() || '';
			managedOrganizationListPage.page = 1;
			void reloadManagedOrganizationList();
			return true;
		}
		if (form.matches('form[data-org-campus-list-form]')) {
			const organizationId = form.dataset.orgId || '';
			if (organizationId) { const state = organizationCampusPageState(organizationId); state.query = (form.querySelector('[data-org-campus-list-query]') as HTMLInputElement | null)?.value.trim() || ''; state.page = 1; state.loaded = false; void loadOrganizationCampusPage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		if (form.matches('form[data-org-package-list-form]')) {
			const organizationId = form.dataset.orgId || '';
			if (organizationId) { const state = organizationCoursePackagePageState(organizationId); state.query = (form.querySelector('[data-org-package-list-query]') as HTMLInputElement | null)?.value.trim() || ''; state.page = 1; state.loaded = false; void loadOrganizationCoursePackagePage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		if (form.matches('form[data-org-member-list-form]')) {
			const organizationId = form.dataset.orgId || '';
			const roleId = form.dataset.roleId || '';
			if (organizationId && roleId) {
				const state = organizationMemberPageState(organizationId, roleId);
				state.query = (form.querySelector('[data-org-member-list-query]') as HTMLInputElement | null)?.value.trim() || '';
				state.page = 1; state.loaded = false;
				void loadOrganizationMemberPage(organizationId, roleId);
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		if (form.matches('form[data-org-learning-list-form]')) {
			const organizationId = form.dataset.orgId || '';
			if (organizationId) {
				const state = organizationLearningGroupPageState(organizationId);
				state.query = (form.querySelector('[data-org-learning-list-query]') as HTMLInputElement | null)?.value.trim() || '';
				state.page = 1; state.loaded = false;
				void loadOrganizationLearningGroupPage(organizationId);
				renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		if (form.matches('form[data-platform-role-template-form]')) { void submitPlatformRoleTemplate(form); return true; }
		if (form.matches('form[data-platform-user-access-form]')) { void submitPlatformUserAccess(form); return true; }
		if (form.matches('form[data-platform-user-search-form]')) {
			void performPlatformUserSearch(form);
			return true;
		}
		if (form.matches('form[data-platform-org-create-form]')) {
			void createPlatformOrganization(form);
			return true;
		}
		if (form.matches('form[data-platform-refund-form]')) {
			void submitPlatformRefund(form);
			return true;
		}
		if (form.matches('form[data-platform-payment-search-form]')) {
			platformPaymentQuery = ((form.querySelector('[data-platform-payment-query]') as HTMLInputElement | null)?.value || '').trim();
			platformPaymentPage = 1;
			platformPaymentsLoaded = false;
			void loadPlatformPayments(true);
			return true;
		}
		if (form.matches('form[data-organization-payment-order-form]')) {
			void submitOrganizationPaymentOrder(form);
			return true;
		}
		if (form.matches('form[data-platform-refund-status-form]')) {
			void submitRefundStatus(form);
			return true;
		}
		if (form.matches('form[data-support-feedback-form]')) {
			void submitSupportFeedback(form);
			return true;
		}
		if (form.matches('form[data-platform-feedback-search-form]')) {
			platformFeedbackQuery = ((form.querySelector('[data-platform-feedback-query]') as HTMLInputElement | null)?.value || '').trim();
			platformFeedbackPage = 1; platformFeedbackLoaded = false; void loadFeedbackQueue(true); return true;
		}
		if (form.matches('form[data-org-add-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			const draft = getOrganizationMemberDraft(organization.id);
			const queryInput = form.querySelector('[data-org-search-query]') as HTMLInputElement | null;
			const contactValue = (queryInput?.value || draft.searchQuery || '').trim();
			draft.searchQuery = contactValue;
			const messageInput = form.querySelector('[data-org-invite-message]') as HTMLTextAreaElement | null;
			const mode = form.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
			const roles = normalizeOrganizationAddRoles(readOrganizationRoles(form), mode);
			if (draft.selectedUserId) {
				void saveOrganizationMembership(organization, draft.selectedUserId, roles, '', [], [], mode === 'manager' ? '管理人员已添加' : '成员已添加', form);
			} else if (looksLikeOrganizationInviteContact(contactValue)) {
				void saveOrganizationInvitation(organization, contactValue, roles, '', [], messageInput?.value || '', form);
			} else {
				setFieldError(queryInput, '请先选择已有账号，或输入完整邮箱/手机号');
				showToast('请先选择已有账号，或输入完整邮箱/手机号后再添加邀请');
			}
			return true;
		}
		if (form.matches('form[data-org-invite-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			const contactInput = form.querySelector('[data-org-invite-contact]') as HTMLInputElement | null;
			const memberNoInput = form.querySelector('[data-org-invite-member-no]') as HTMLInputElement | null;
			const messageInput = form.querySelector('[data-org-invite-message]') as HTMLTextAreaElement | null;
			const mode = form.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
			const roles = normalizeOrganizationAddRoles(readOrganizationRoles(form), mode);
			void saveOrganizationInvitation(organization, contactInput?.value || '', roles, memberNoInput?.value || '', [], messageInput?.value || '', form);
			return true;
		}
		if (form.matches('form[data-org-role-permission-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			const roleId = form.dataset.roleId || '';
			const permission = ((form.querySelector('select[name="permission"]') as HTMLSelectElement | null)?.value || '').trim();
			const effect = form.dataset.effect === 'deny' ? 'deny' : 'allow';
			if (!organization || !roleId || !permission) {
				showToast('请选择要调整的权限');
				return true;
			}
			const config = rolePermissionConfigFor(organization, roleId);
			const allowSet = new Set(config.allow);
			const denySet = new Set(config.deny);
			if (effect === 'allow') {
				allowSet.add(permission);
				denySet.delete(permission);
			} else {
				denySet.add(permission);
				allowSet.delete(permission);
			}
			void saveOrganizationRolePermissions(organization, roleId, Array.from(allowSet), Array.from(denySet), form);
			return true;
		}
		if (form.matches('form[data-org-subscription-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			const planInput = form.querySelector('[data-org-plan]') as HTMLSelectElement | null;
			const statusInput = form.querySelector('[data-org-status]') as HTMLSelectElement | null;
			const seatsInput = form.querySelector('[data-org-seats]') as HTMLInputElement | null;
			const expiresAtInput = form.querySelector('[data-org-expires-at]') as HTMLInputElement | null;
			void saveOrganizationSubscription(organization, planInput?.value || organization.plan, statusInput?.value || organization.status, seatsInput?.value || String(organization.seats), expiresAtInput?.value || '', form);
			return true;
		}
		if (form.matches('form[data-org-campus-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			void saveOrganizationCampus(organization, form);
			return true;
		}
		if (form.matches('form[data-org-course-package-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			void saveOrganizationCoursePackage(organization, form);
			return true;
		}
		if (form.matches('form[data-org-learning-group-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			void saveOrganizationLearningGroup(organization, form);
			return true;
		}
		if (form.matches('form[data-org-learning-enrollment-form]')) {
			const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
			if (!organization) {
				showToast('组织信息已失效，请刷新后重试');
				return true;
			}
			void saveOrganizationLearningGroupEnrollment(organization, form);
			return true;
		}
		if (form.matches('form[data-org-member-form]')) {
			saveOrganizationMemberForm(form);
			return true;
		}
		return false;
	}

	function handleDashboardOrganizationInput(target: HTMLInputElement | HTMLTextAreaElement): boolean {
		if (target.hasAttribute('data-platform-access-user-id')) {
			platformUserAccessDraft.userId = target.value;
			platformUserAccessPreview = null;
			return true;
		}
		if (target.hasAttribute('data-platform-access-expiry')) {
			platformUserAccessDraft.expiresAt = target.value;
			platformUserAccessPreview = null;
			return true;
		}
		if (target.hasAttribute('data-platform-user-search-input')) {
			platformUserSearchQuery = target.value;
			return true;
		}
		const form = target.closest('form[data-org-id]') as HTMLFormElement | null;
		const organizationId = form?.dataset.orgId || '';
		if (!organizationId) {
			return false;
		}
		const draft = getOrganizationMemberDraft(organizationId);
		if (target.hasAttribute('data-org-search-query')) {
			draft.searchQuery = target.value;
			return true;
		}
		if (target.hasAttribute('data-org-invite-contact')) {
			draft.inviteContact = target.value;
			return true;
		}
		if (target.hasAttribute('data-org-invite-member-no')) {
			draft.inviteMemberNo = target.value;
			return true;
		}
		if (target.hasAttribute('data-org-invite-message')) {
			draft.inviteMessage = target.value;
			return true;
		}
		return false;
	}

	function handleDashboardOrganizationChange(target: HTMLElement | null): boolean {
		const platformAccessRole = target?.closest('[data-platform-access-role]') as HTMLSelectElement | null;
		if (platformAccessRole) {
			platformUserAccessDraft.roleId = platformAccessRole.value || 'assistant';
			platformUserAccessPreview = null;
			return true;
		}
		const campusControl = target?.closest('[data-org-campus-list-sort],[data-org-campus-list-order],[data-org-campus-list-page-size]') as HTMLSelectElement | null;
		if (campusControl) {
			const organizationId = (campusControl.closest('form[data-org-campus-list-form]') as HTMLFormElement | null)?.dataset.orgId || '';
			if (organizationId) { const state = organizationCampusPageState(organizationId); if (campusControl.hasAttribute('data-org-campus-list-sort')) state.sort = campusControl.value || 'name'; if (campusControl.hasAttribute('data-org-campus-list-order')) state.order = campusControl.value === 'desc' ? 'desc' : 'asc'; if (campusControl.hasAttribute('data-org-campus-list-page-size')) state.pageSize = Math.max(10, Number(campusControl.value) || 20); state.page = 1; state.loaded = false; void loadOrganizationCampusPage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		const packageControl = target?.closest('[data-org-package-list-sort],[data-org-package-list-order],[data-org-package-list-page-size]') as HTMLSelectElement | null;
		if (packageControl) {
			const organizationId = (packageControl.closest('form[data-org-package-list-form]') as HTMLFormElement | null)?.dataset.orgId || '';
			if (organizationId) { const state = organizationCoursePackagePageState(organizationId); if (packageControl.hasAttribute('data-org-package-list-sort')) state.sort = packageControl.value || 'expires_at'; if (packageControl.hasAttribute('data-org-package-list-order')) state.order = packageControl.value === 'desc' ? 'desc' : 'asc'; if (packageControl.hasAttribute('data-org-package-list-page-size')) state.pageSize = Math.max(10, Number(packageControl.value) || 20); state.page = 1; state.loaded = false; void loadOrganizationCoursePackagePage(organizationId); renderSectionContent({ preserveScroll: true }); }
			return true;
		}
		const memberControl = target?.closest('[data-org-member-list-sort],[data-org-member-list-order],[data-org-member-list-page-size]') as HTMLSelectElement | null;
		if (memberControl) {
			const form = memberControl.closest('form[data-org-member-list-form]') as HTMLFormElement | null;
			const organizationId = form?.dataset.orgId || '', roleId = form?.dataset.roleId || '';
			if (organizationId && roleId) {
				const state = organizationMemberPageState(organizationId, roleId);
				if (memberControl.hasAttribute('data-org-member-list-sort')) state.sort = memberControl.value || 'username';
				if (memberControl.hasAttribute('data-org-member-list-order')) state.order = memberControl.value === 'desc' ? 'desc' : 'asc';
				if (memberControl.hasAttribute('data-org-member-list-page-size')) state.pageSize = Math.max(10, Number(memberControl.value) || 20);
				state.page = 1; state.loaded = false; void loadOrganizationMemberPage(organizationId, roleId); renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const learningControl = target?.closest('[data-org-learning-list-sort],[data-org-learning-list-order],[data-org-learning-list-page-size]') as HTMLSelectElement | null;
		if (learningControl) {
			const form = learningControl.closest('form[data-org-learning-list-form]') as HTMLFormElement | null;
			const organizationId = form?.dataset.orgId || '';
			if (organizationId) {
				const state = organizationLearningGroupPageState(organizationId);
				if (learningControl.hasAttribute('data-org-learning-list-sort')) state.sort = learningControl.value || 'starts_at';
				if (learningControl.hasAttribute('data-org-learning-list-order')) state.order = learningControl.value === 'desc' ? 'desc' : 'asc';
				if (learningControl.hasAttribute('data-org-learning-list-page-size')) state.pageSize = Math.max(10, Number(learningControl.value) || 20);
				state.page = 1; state.loaded = false; void loadOrganizationLearningGroupPage(organizationId); renderSectionContent({ preserveScroll: true });
			}
			return true;
		}
		const feedbackControl = target?.closest('[data-platform-feedback-sort],[data-platform-feedback-order],[data-platform-feedback-page-size]') as HTMLSelectElement | null;
		if (feedbackControl) {
			if (feedbackControl.hasAttribute('data-platform-feedback-sort')) platformFeedbackSort = feedbackControl.value || 'created_at';
			if (feedbackControl.hasAttribute('data-platform-feedback-order')) platformFeedbackOrder = feedbackControl.value === 'asc' ? 'asc' : 'desc';
			if (feedbackControl.hasAttribute('data-platform-feedback-page-size')) platformFeedbackPageSize = Math.max(10, Number(feedbackControl.value) || 20);
			platformFeedbackPage = 1; platformFeedbackLoaded = false; void loadFeedbackQueue(true); return true;
		}
		const paymentControl = target?.closest('[data-platform-payment-sort],[data-platform-payment-order],[data-platform-payment-page-size]') as HTMLSelectElement | null;
		if (paymentControl) {
			if (paymentControl.hasAttribute('data-platform-payment-sort')) platformPaymentSort = paymentControl.value || 'created_at';
			if (paymentControl.hasAttribute('data-platform-payment-order')) platformPaymentOrder = paymentControl.value === 'asc' ? 'asc' : 'desc';
			if (paymentControl.hasAttribute('data-platform-payment-page-size')) platformPaymentPageSize = Math.max(10, Number(paymentControl.value) || 20);
			platformPaymentPage = 1;
			platformPaymentsLoaded = false;
			void loadPlatformPayments(true);
			return true;
		}
		const campusFilter = target?.closest('[data-org-learning-campus-filter]') as HTMLSelectElement | null;
		if (!campusFilter) {
			return false;
		}
		const organizationId = campusFilter.dataset.orgId || '';
		if (!organizationId) {
			return false;
		}
		organizationLearningGroupCampusFilters[organizationId] = campusFilter.value || '';
		renderSectionContent({ preserveScroll: true });
		return true;
	}

	function handleDashboardOrganizationKeydown(event: KeyboardEvent): boolean {
		const target = event.target as HTMLElement | null;
		if (event.key === 'Enter' && target?.hasAttribute('data-platform-user-search-input')) {
			event.preventDefault();
			const form = target.closest('form[data-platform-user-search-form]') as HTMLFormElement | null;
			if (form) {
				void performPlatformUserSearch(form);
			}
			return true;
		}
		if (event.key !== 'Enter' || !target?.hasAttribute('data-org-search-query')) {
			return false;
		}
		event.preventDefault();
		const form = target.closest('form[data-org-add-form]') as HTMLFormElement | null;
		const organization = managedOrganizations.find((item) => item.id === (form?.dataset.orgId || ''));
		if (!organization) {
			showToast('组织信息已失效，请刷新后重试');
			return true;
		}
		const mode = form?.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
		void searchOrganizationCandidates(organization, (target as HTMLInputElement).value || '', mode);
		return true;
	}

	function attachDashboardHandlers(container: HTMLElement): void {
		bindOrganizationMemberForms(container);
		container.querySelectorAll<HTMLFormElement>('form[data-org-subscription-form], form[data-org-course-package-form]').forEach((form) => { form.noValidate = true; });
		container.onclick = (event: MouseEvent) => {
			const target = eventTargetElement(event.target);
			if (handleAccountSessionClick(target)) {
				return;
			}
			const autoRenewRetry = target?.closest('[data-auto-renew-retry]') as HTMLButtonElement | null;
			if (autoRenewRetry) {
				const card = autoRenewRetry.closest<HTMLElement>('[data-auto-renew-card]');
				if (card) {
					void ensureAutoRenewal(
						card.dataset.renewScope === 'organization' ? 'organization' : 'personal',
						card.dataset.renewId || '',
						true
					);
					renderSectionContent({ preserveScroll: true });
				}
				return;
			}
			const autoRenewToggle = target?.closest('[data-auto-renew-toggle]') as HTMLButtonElement | null;
			if (autoRenewToggle) {
				void toggleAutoRenewal(autoRenewToggle);
				return;
			}
			const notificationRead = target?.closest('[data-payment-notification-read]') as HTMLButtonElement | null;
			if (notificationRead) {
				void markPaymentNotificationRead(notificationRead.dataset.paymentNotificationRead || '');
				return;
			}
			if (target?.closest('[data-payment-notifications-read-all]')) {
				void markPaymentNotificationRead();
				return;
			}
			if (target?.closest('[data-payment-notifications-refresh]')) {
				void ensurePaymentNotifications(true);
				return;
			}
			if (target?.closest('[data-renewal-operations-refresh]')) {
				void ensureRenewalOperations(true);
				return;
			}
			const runRenewalJobButton = target?.closest('[data-renewal-job-run]') as HTMLButtonElement | null;
			if (runRenewalJobButton) {
				void runRenewalJob(runRenewalJobButton);
				return;
			}
			if (handleContactVerificationClick(target, container)) {
				return;
			}
			if (target?.closest('summary.pc-managed-org-summary')) {
				event.preventDefault();
			}
			if (handleDashboardOrganizationClick(target)) {
				return;
			}
			const deletePhoneCodeButton = target?.closest('[data-account-delete-send-phone-code]') as HTMLButtonElement | null;
			if (deletePhoneCodeButton) {
				void sendAccountDeletePhoneCode(deletePhoneCodeButton);
				return;
			}
			const favoriteBackButton = target?.closest('[data-favorite-back]') as HTMLButtonElement | null;
			if (favoriteBackButton) {
				activeFavoriteFolderId = '';
				renderSectionContent({ preserveScroll: true });
				return;
			}
			const favoriteCreateButton = target?.closest('[data-favorite-create-folder]') as HTMLButtonElement | null;
			if (favoriteCreateButton) {
				void createFavoriteFolderFromPage();
				return;
			}
			const favoriteFolderButton = target?.closest('[data-favorite-folder]') as HTMLButtonElement | null;
			if (favoriteFolderButton) {
				activeFavoriteFolderId = favoriteFolderButton.dataset.favoriteFolder || '';
				renderSectionContent({ preserveScroll: true });
				return;
			}
			const favoriteFolderRenameButton = target?.closest('[data-favorite-folder-rename]') as HTMLButtonElement | null;
			if (favoriteFolderRenameButton) {
				void renameFavoriteFolderFromPage(favoriteFolderRenameButton.dataset.favoriteFolderRename || '');
				return;
			}
			const favoriteFolderDeleteButton = target?.closest('[data-favorite-folder-delete]') as HTMLButtonElement | null;
			if (favoriteFolderDeleteButton) {
				void deleteFavoriteFolderFromPage(favoriteFolderDeleteButton.dataset.favoriteFolderDelete || '');
				return;
			}
			const favoriteQuestionDeleteButton = target?.closest('[data-favorite-question-delete]') as HTMLButtonElement | null;
			if (favoriteQuestionDeleteButton) {
				void deleteFavoriteQuestionFromPage(favoriteQuestionDeleteButton.dataset.favoriteQuestionDelete || '');
				return;
			}
			const favoriteQuestionOpenButton = target?.closest('[data-favorite-question-open]') as HTMLButtonElement | null;
			if (favoriteQuestionOpenButton) {
				const examId = favoriteQuestionOpenButton.dataset.examId || '';
				const questionId = favoriteQuestionOpenButton.dataset.questionId || '';
				const sectionIndex = Number(favoriteQuestionOpenButton.dataset.sectionIndex ?? 0);
				void openExamQuestion(examId, questionId, Number.isFinite(sectionIndex) ? sectionIndex : 0);
				return;
			}
			const submissionReviewButton = target?.closest('[data-inst-submission-review]') as HTMLButtonElement | null;
			if (submissionReviewButton) {
				void reviewInstitutionSubmission(container, submissionReviewButton);
				return;
			}
			const scheduleSaveButton = target?.closest('[data-role-schedule-save]') as HTMLButtonElement | null;
			if (scheduleSaveButton) {
				void saveInstitutionSchedule(container, scheduleSaveButton);
				return;
			}
			const assignmentRemindButton = target?.closest('[data-inst-assignment-remind]') as HTMLButtonElement | null;
			if (assignmentRemindButton) {
				void remindInstitutionAssignment(container, assignmentRemindButton.dataset.instAssignmentRemind || '', assignmentRemindButton);
				return;
			}
			const assignmentAutoSaveButton = target?.closest('[data-inst-assignment-auto-save]') as HTMLButtonElement | null;
			if (assignmentAutoSaveButton) {
				void saveInstitutionAutomaticReminder(container, assignmentAutoSaveButton);
				return;
			}
			const rolePrepAssignmentButton = target?.closest('[data-role-prep-create-assignment]') as HTMLButtonElement | null;
			if (rolePrepAssignmentButton) {
				void createRoleAssignmentFromLessonPrep(container, rolePrepAssignmentButton);
				return;
			}
			const noteButton = target?.closest('[data-inst-add-note]') as HTMLButtonElement | null;
			if (noteButton) {
				void addInstitutionTeacherNote(container, noteButton.dataset.instAddNote || '');
				return;
			}
			const dashboardBack = target?.closest('[data-dashboard-back]') as HTMLButtonElement | null;
			if (dashboardBack) {
				if (activeDashboardSubpage === 'favorites' && activeFavoriteFolderId) {
					activeFavoriteFolderId = '';
					renderSectionContent({ preserveScroll: true });
					return;
				}
				if (activeDashboardSubpage === 'role-content' && activeRoleContent.startsWith('teacher-student:')) {
					activeRoleContent = 'teacher-students';
					renderSectionContent();
					return;
				}
				if (activeDashboardSubpage === 'role-content' && activeRoleContent.startsWith('teacher-group:')) {
					activeRoleContent = 'teacher-groups';
					renderSectionContent();
					return;
				}
				if (activeDashboardSubpage === 'role-content' && activeRoleContent.startsWith('teacher-assignment:')) {
					activeRoleContent = 'teacher-review';
					renderSectionContent();
					return;
				}
				if (activeDashboardSubpage === 'role-content' && activeRoleContent.startsWith('teacher-prep:')) {
					activeRoleContent = 'teacher-prep';
					renderSectionContent();
					return;
				}
				activeDashboardSubpage = dashboardParentSubpage(activeDashboardSubpage);
				renderSections();
				renderSectionContent();
				return;
			}
			const dashboardPageButton = target?.closest('[data-dashboard-page]') as HTMLButtonElement | null;
			if (dashboardPageButton) {
				activeDashboardSubpage = (dashboardPageButton.dataset.dashboardPage || '') as DashboardSubpage;
				if (activeDashboardSubpage === 'recent') {
					invalidateRecentLearning();
				}
				if (activeDashboardSubpage === 'favorites') {
					activeFavoriteFolderId = '';
					invalidateFavoriteBookmarks();
				}
				renderSections();
				renderSectionContent();
				return;
			}
			const accountAction = target?.closest('[data-account-action]') as HTMLButtonElement | null;
			if (accountAction) {
				const action = (accountAction.dataset.accountAction || '') as typeof activeAccountEditor;
				activeAccountEditor = activeAccountEditor === action ? '' : action;
				if (activeAccountEditor === 'phone') {
					activeContactVerificationEditor = 'phone';
					seedContactVerificationDraft(getContext());
				}
				renderSectionContent({ preserveScroll: true });
				if (activeAccountEditor === 'sessions') void loadAccountSessions();
				return;
			}
			const workbenchButton = target?.closest('[data-workbench]') as HTMLButtonElement | null;
			if (workbenchButton) {
				activeWorkbench = (workbenchButton.dataset.workbench || '') as WorkbenchId;
				renderSectionContent({ preserveScroll: true });
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
			if (handleDashboardOrganizationSubmit(form)) {
				return;
			}
			if (form.hasAttribute('data-account-password-form')) {
				const currentPassword = (form.querySelector('[data-account-current-password]') as HTMLInputElement | null)?.value || '';
				const newPassword = (form.querySelector('[data-account-new-password]') as HTMLInputElement | null)?.value || '';
				const confirmPassword = (form.querySelector('[data-account-confirm-password]') as HTMLInputElement | null)?.value || '';
				void changeCurrentPassword(currentPassword, newPassword, confirmPassword, form);
				return;
			}
			if (form.hasAttribute('data-account-wechat-form')) {
				const code = (form.querySelector('[data-account-wechat-code]') as HTMLInputElement | null)?.value || '';
				void bindWechatAccount(code, form);
				return;
			}
			if (form.hasAttribute('data-account-delete-form')) {
				const confirmation = (form.querySelector('[data-account-delete-confirm]') as HTMLInputElement | null)?.value || '';
				const phoneCode = (form.querySelector('[data-account-delete-phone-code]') as HTMLInputElement | null)?.value || '';
				void deleteCurrentAccount(confirmation, phoneCode, form);
				return;
			}
			if (form.hasAttribute('data-pricing-form')) {
				void savePaymentPricingForm(form);
				return;
			}
			if (form.matches('form[data-referral-claim-form]')) {
				const input = form.querySelector('[data-referral-code]') as HTMLInputElement | null;
				void claimReferralCode(input?.value || referralCodeDraft, form);
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
			const paymentForm = target.closest('form[data-organization-payment-order-form]') as HTMLFormElement | null;
			if (paymentForm && target.matches('[data-org-payment-seats]')) {
				void updateOrganizationPaymentPreview(paymentForm);
				return;
			}
			if (handleContactVerificationInput(target)) {
				return;
			}
			if (handleDashboardOrganizationInput(target)) {
				return;
			}
			if (target.hasAttribute('data-account-current-password')) {
				accountSecurityDraft.currentPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-new-password')) {
				accountSecurityDraft.newPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-confirm-password')) {
				accountSecurityDraft.confirmPassword = target.value;
				return;
			}
			if (target.hasAttribute('data-account-wechat-code')) {
				accountSecurityDraft.wechatCode = target.value;
				return;
			}
			if (target.hasAttribute('data-account-delete-confirm')) {
				accountSecurityDraft.deleteConfirmation = target.value;
				return;
			}
			if (target.hasAttribute('data-account-delete-phone-code')) {
				accountSecurityDraft.deletePhoneCode = target.value;
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
		container.onchange = (event: Event) => {
			const target = event.target as HTMLElement | null;
			const workflowSelection = target?.closest('[data-content-workflow-select]') as HTMLInputElement | null;
			if (workflowSelection) {
				const examId = workflowSelection.dataset.contentWorkflowSelect || '';
				if (examId) {
					if (workflowSelection.checked) contentWorkflowSelection.add(examId);
					else contentWorkflowSelection.delete(examId);
					renderSectionContent({ preserveScroll: true });
				}
				return;
			}
			const workflowSelectAll = target?.closest('[data-content-workflow-select-all]') as HTMLInputElement | null;
			if (workflowSelectAll) {
				contentWorkflowSelection.clear();
				if (workflowSelectAll.checked) {
					contentPublishExamItems.slice(0, 100).forEach((item) => {
						const examId = readString(item.id) || '';
						if (examId) contentWorkflowSelection.add(examId);
					});
				}
				renderSectionContent({ preserveScroll: true });
				return;
			}
			const editedForm = target?.closest('form');
			if (editedForm) editedForm.dataset.pcDirty = 'true';
			const paymentForm = target?.closest('form[data-organization-payment-order-form]') as HTMLFormElement | null;
			if (paymentForm && target?.matches('[data-org-payment-plan], [data-org-payment-days], [data-org-payment-organization-id]')) {
				void updateOrganizationPaymentPreview(paymentForm, target.matches('[data-org-payment-plan]'));
				return;
			}
			if (handleDashboardOrganizationChange(target)) {
				return;
			}
		};
		container.onkeydown = (event: KeyboardEvent) => {
			if (handleDashboardOrganizationKeydown(event)) {
				return;
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

	function renderInstitutionPlanCatalog(_planCatalog: Record<string, unknown>): string {
		if (!paymentPricingLoaded) {
			void loadPaymentPricing().then(() => {
				if (activeSection === 'dashboard' && activeDashboardSubpage === 'role-content') {
					renderSectionContent({ preserveScroll: true });
				}
			});
		}
		const catalog = paymentPricingConfig.catalogs.organization;
		const definitions: Record<PaidPersonalPlan, { target: string; features: string[] }> = {
			pro: {
				target: '单校区、小型培训机构和小型团队',
				features: ['完整教学闭环', '1 个校区', '3 个机构管理员', '基础统计与标准导出']
			},
			ultra: {
				target: '多校区、中型机构及深度分析需求',
				features: ['跨校区分析', '风险预警与自动报告', '5 个校区', '10 个机构管理员']
			}
		};
		const cards = (['pro', 'ultra'] as PaidPersonalPlan[]).map((plan) => {
			const monthly = pricingAmountCents(plan, 30, 'cny', 'organization', catalog.minimumSeats[plan]);
			const yearly = pricingAmountCents(plan, 365, 'cny', 'organization', catalog.minimumSeats[plan]);
			const monthlyEquivalent = Math.round(yearly / 12);
			return `<div class="pc-pricing-plan-card${plan === 'ultra' ? ' is-recommended' : ''}">
				<div class="pc-pricing-plan-head"><strong>机构 ${plan.toUpperCase()}${plan === 'ultra' ? ' · 推荐' : ''}</strong><span>${formatAmountCny(monthly)}/席/月</span></div>
				<div class="pc-pricing-plan-target">${escapeHtml(definitions[plan].target)}</div>
				<div class="pc-pricing-plan-year">年付 ${formatAmountCny(yearly)}/席 · 折合 ${formatAmountCny(monthlyEquivalent)}/席/月</div>
				<div class="pc-pricing-plan-meta">最低 ${catalog.minimumSeats[plan]} 席 · ${definitions[plan].features.map(escapeHtml).join(' · ')}</div>
			</div>`;
		}).join('');
		return `<div class="pc-card pc-info-card" style="margin-top:12px;">
			<div class="pc-service-header">机构套餐价格</div>
			<div class="pc-admin-note">价格来自统一支付商品目录。教师和管理员不占席位；${catalog.customQuoteMinSeats} 席及以上进入企业定制报价。</div>
			<div class="pc-pricing-plan-grid">${cards}</div>
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
			if (!root.isConnected || root.dataset.instUserInteracted === 'true') return;
			root.innerHTML = `<div class="pc-service-header">机构教学工作台</div>${renderInstitutionDashboard(data)}${renderInstitutionWorkbenchExtras(workbenchData)}`;
		} catch (error) {
			if (!root.isConnected || root.dataset.instUserInteracted === 'true') return;
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

	async function openInstitutionGroupGradebookDetail(container: HTMLElement, organizationId: string, learningGroupId: string): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !organizationId || !learningGroupId || !detail || !api || typeof api.getInstitutionLearningGroupGradebook !== 'function') {
			return;
		}
		detail.innerHTML = '<div class="pc-card pc-info-card"><div class="pc-service-header">成绩册和作业</div><div class="pc-admin-note">正在加载学习组成绩册...</div></div>';
		try {
			const data = asRecord(await api.getInstitutionLearningGroupGradebook(token, organizationId, learningGroupId)) || {};
			const students = Array.isArray(data.students) ? data.students : [];
			const assignments = Array.isArray(data.assignments) ? data.assignments : [];
			const studentRows = students.map((item) => {
				const raw = asRecord(item) || {};
				const student = asRecord(raw.student) || {};
				const record = asRecord(raw.answers) || {};
				const studentId = readString(student.id) || readString(student.user_id);
				const name = readString(student.display_name) || readString(student.username) || studentId || '学员';
				const score = institutionNumber(record.average_score, -1);
				const intent = studentId ? openRoleContentIntent(`teacher-student:${encodeURIComponent(studentId)}`) : '';
				return `<button class="pc-info-row pc-info-row-button service-item" type="button" data-intent="${escapeHtml(intent)}">
					<span>${escapeHtml(name)}</span>
					<strong>${score >= 0 ? `${score.toFixed(1)}%` : '暂无成绩'} · ${institutionNumber(record.attempt_count)} 次练习</strong>
				</button>`;
			}).join('');
			const assignmentRows = assignments.map((item) => {
				const raw = asRecord(item) || {};
				const title = readString(raw.title) || readString(raw.assignment_id) || '未命名作业';
				const submitted = institutionNumber(raw.submitted_count);
				const total = institutionNumber(raw.student_count);
				const avg = institutionNumber(raw.average_score, -1);
				return `<div class="pc-info-row"><span>${escapeHtml(title)}</span><strong>${submitted}/${total} 已交${avg >= 0 ? ` · 平均 ${avg.toFixed(1)}%` : ''}</strong></div>`;
			}).join('');
			detail.innerHTML = `<div class="pc-card pc-info-card pc-institution-detail-card">
				<div class="pc-service-header">学生成绩</div>
				<div class="pc-info-list">${studentRows || '<div class="pc-admin-note">暂无学员成绩</div>'}</div>
			</div>
			<div class="pc-card pc-info-card pc-institution-detail-card">
				<div class="pc-service-header">作业</div>
				<div class="pc-info-list">${assignmentRows || '<div class="pc-admin-note">暂无作业</div>'}</div>
			</div>`;
		} catch (error) {
			detail.innerHTML = `<div class="pc-card pc-info-card"><div class="pc-service-header">成绩册和作业</div><div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '学习组详情加载失败'))}</div></div>`;
		}
	}

	function hydrateInstitutionRoleDetail(container: HTMLElement): void {
		if (activeSection !== 'dashboard' || activeDashboardSubpage !== 'role-content') {
			return;
		}
		if (activeRoleContent.startsWith('teacher-student:')) {
			void openInstitutionStudentProfile(container, decodeRoleContentPart(activeRoleContent.slice('teacher-student:'.length)));
			return;
		}
		if (activeRoleContent.startsWith('teacher-assignment:')) {
			void openInstitutionAssignmentSubmissions(container, decodeRoleContentPart(activeRoleContent.slice('teacher-assignment:'.length)));
			return;
		}
		if (activeRoleContent.startsWith('teacher-group:')) {
			const [, organizationId = '', groupId = ''] = activeRoleContent.split(':').map(decodeRoleContentPart);
			void openInstitutionGroupGradebookDetail(container, organizationId || getContext().organizationId || '', groupId);
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
		const name = (await requestTextInput('学习组名称', 'EJU 日语冲刺班') || '').trim();
		if (!name) return;
		const subject = (await requestTextInput('科目（可选，例如 japanese / sogo）', 'japanese') || '').trim();
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
		const raw = await requestTextInput('输入学员 userId，多个用逗号或换行分隔', '', { multiline: true }) || '';
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
		const examId = (await requestTextInput('试卷 ID，例如 eju_2023_02', '') || '').trim();
		if (!examId) return;
		const title = (await requestTextInput('作业标题', `${examId} 练习`) || '').trim() || `${examId} 练习`;
		const dueAt = (await requestTextInput('截止时间（可选，例如 2026-07-01）', '') || '').trim();
		const rangeRaw = (await requestTextInput('题号范围（可选，例如 1-10；留空表示整卷）', '') || '').trim();
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
			const dueAt = readString(assignment.due_at);
			const overdue = !!dueAt && Date.parse(dueAt) < Date.now();
			const reminders = Array.isArray(assignment.reminders)
				? assignment.reminders.map((item) => asRecord(item) || {})
				: [];
			const reminderHours = Array.isArray(assignment.auto_reminder_hours_before)
				? assignment.auto_reminder_hours_before.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
				: [24];
			const automaticReminderEnabled = dueAt
				? (typeof assignment.auto_reminder_enabled === 'boolean' ? assignment.auto_reminder_enabled : true)
				: false;
			const selectedReminderHours = reminderHours[0] || 24;
			const latestReminder = reminders
				.slice()
				.sort((a, b) => (readString(b.created_at) || '').localeCompare(readString(a.created_at) || ''))[0];
			const reminderTargetCount = reminders.reduce(
				(sum, reminder) => sum + (Array.isArray(reminder.target_student_ids) ? reminder.target_student_ids.length : 0),
				0
			);
			const rows = visibleStudentIds.map((studentId) => {
				const sub = asRecord(submissions[studentId]) || {};
				const score = asRecord(sub.score) || {};
				const submitted = !!readString(sub.submitted_at);
				const reviewStatus = readString(sub.review_status) || readString(sub.status) || (submitted ? 'submitted' : 'missing');
				const reviewStatusLabel: Record<string, string> = { submitted: '已提交', reviewed: '已批改', returned: '已退回重做', missing: '未提交' };
				const automaticScore = institutionNumber(score.score, -1);
				const manualScore = institutionNumber(sub.manual_score, -1);
				const studentName = institutionMemberName(studentId, institutionRoleWorkbenchData || {});
				const distribution = `${institutionNumber(score.correct_count)} 对 / ${institutionNumber(score.wrong_count)} 错 / ${institutionNumber(score.unanswered_count)} 未答`;
				if (!submitted) {
					return `<div class="pc-card pc-info-card pc-assignment-submission" data-assignment-student="${escapeHtml(studentId)}">
						<div class="pc-service-header">${escapeHtml(studentName || studentId)}</div>
						<div class="pc-admin-note">${overdue ? '已逾期未提交' : '尚未提交'}</div>
					</div>`;
				}
				return `<div class="pc-card pc-info-card pc-assignment-submission" data-assignment-student="${escapeHtml(studentId)}">
					<div class="pc-service-header">${escapeHtml(studentName || studentId)}</div>
					<div class="pc-info-list">
						<div class="pc-info-row"><span>提交状态</span><strong>${escapeHtml(reviewStatusLabel[reviewStatus] || reviewStatus)} · 第 ${institutionNumber(sub.attempt_no, 1)} 次</strong></div>
						<div class="pc-info-row"><span>成绩</span><strong>${manualScore >= 0 ? `人工 ${manualScore.toFixed(1)}% · ` : ''}${automaticScore >= 0 ? `自动 ${automaticScore.toFixed(1)}%` : '未自动评分'}</strong></div>
						<div class="pc-info-row"><span>错题分布</span><strong>${distribution}</strong></div>
						<div class="pc-info-row"><span>提交时间</span><strong>${escapeHtml(formatDateTime(readString(sub.submitted_at)))}</strong></div>
					</div>
					<label class="pc-org-field"><span>评语</span><textarea class="pc-org-batch-input" rows="2" data-submission-comment>${escapeHtml(readString(sub.teacher_comment) || '')}</textarea></label>
					<label class="pc-org-field"><span>人工成绩（0-100，可留空）</span><input class="pc-profile-input" type="number" min="0" max="100" step="0.1" data-submission-score value="${manualScore >= 0 ? escapeHtml(String(manualScore)) : ''}" /></label>
					<div class="pc-org-form-actions pc-org-form-actions-end">
						<button class="pc-inline-ghost" type="button" data-inst-submission-review="${escapeHtml(assignmentId)}" data-student-id="${escapeHtml(studentId)}" data-review-action="returned">退回重做</button>
						<button class="pc-inline-btn" type="button" data-inst-submission-review="${escapeHtml(assignmentId)}" data-student-id="${escapeHtml(studentId)}" data-review-action="reviewed">保存批改</button>
					</div>
				</div>`;
			}).join('');
			const reminderOptions = [
				{ value: 'off', label: '关闭' },
				{ value: '6', label: '截止前 6 小时' },
				{ value: '12', label: '截止前 12 小时' },
				{ value: '24', label: '截止前 24 小时' },
				{ value: '48', label: '截止前 48 小时' }
			].map((option) => `<option value="${option.value}" ${automaticReminderEnabled && String(selectedReminderHours) === option.value || !automaticReminderEnabled && option.value === 'off' ? 'selected' : ''}>${option.label}</option>`).join('');
			detail.innerHTML = `<div class="pc-card pc-info-card">
				<div class="pc-service-header">作业提交：${escapeHtml(readString(assignment.title) || assignmentId)}</div>
				<div class="pc-admin-note">${escapeHtml(readString(assignment.description) || '')}${dueAt ? ` · 截止 ${escapeHtml(formatDateTime(dueAt))}` : ' · 未设置截止时间'}</div>
				<div class="pc-info-list pc-assignment-reminder-status">
					<div class="pc-info-row"><span>自动催交</span><strong>${automaticReminderEnabled ? `已开启 · 截止前 ${selectedReminderHours} 小时` : '已关闭'}</strong></div>
					<div class="pc-info-row"><span>催交记录</span><strong>${reminders.length} 次 · 累计 ${reminderTargetCount} 人${latestReminder ? ` · 最近 ${escapeHtml(formatDateTime(readString(latestReminder.created_at)))}` : ''}</strong></div>
				</div>
				<div class="pc-assignment-reminder-config" data-assignment-reminder-config="${escapeHtml(assignmentId)}">
					<label class="pc-org-field"><span>提醒规则</span><select class="pc-profile-input" data-assignment-reminder-hours ${dueAt ? '' : 'disabled'}>${reminderOptions}</select></label>
					<div class="pc-org-form-actions pc-org-form-actions-end">
						<button class="pc-inline-ghost" type="button" data-inst-assignment-auto-save="${escapeHtml(assignmentId)}" ${dueAt ? '' : 'disabled'}>保存自动催交</button>
						<button class="pc-inline-btn" type="button" data-inst-assignment-remind="${escapeHtml(assignmentId)}">立即催交未提交学员</button>
					</div>
				</div>
			</div><div class="pc-assignment-submission-list">${rows || '<div class="pc-admin-note">暂无学员</div>'}</div>`;
			detail.querySelectorAll<HTMLButtonElement>('[data-inst-submission-review]').forEach((reviewButton) => {
				reviewButton.onclick = (event) => {
					event.stopPropagation();
					void reviewInstitutionSubmission(container, reviewButton);
				};
			});
		} catch (error) {
			detail.innerHTML = `<div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '提交情况加载失败'))}</div>`;
		}
	}

	const pendingSubmissionReviews = new Set<string>();

	async function reviewInstitutionSubmission(container: HTMLElement, button: HTMLButtonElement): Promise<void> {
		const api = window.APIClient;
		const assignmentId = button.dataset.instSubmissionReview || '';
		const studentId = button.dataset.studentId || '';
		const action = button.dataset.reviewAction === 'returned' ? 'returned' : 'reviewed';
		const key = `${assignmentId}:${studentId}`;
		const card = button.closest('[data-assignment-student]') as HTMLElement | null;
		const comment = ((card?.querySelector('[data-submission-comment]') as HTMLTextAreaElement | null)?.value || '').trim();
		const scoreRaw = ((card?.querySelector('[data-submission-score]') as HTMLInputElement | null)?.value || '').trim();
		if (!assignmentId || !studentId || !api || typeof api.reviewAssignmentSubmission !== 'function' || pendingSubmissionReviews.has(key)) return;
		if (action === 'returned' && !comment) {
			showToast('退回重做前请填写评语');
			return;
		}
		const payload: Record<string, unknown> = { action, comment };
		if (scoreRaw) {
			const score = Number(scoreRaw);
			if (!Number.isFinite(score) || score < 0 || score > 100) {
				showToast('人工成绩必须在 0 到 100 之间');
				return;
			}
			payload.manual_score = score;
		}
		pendingSubmissionReviews.add(key);
		card?.querySelectorAll<HTMLButtonElement>('[data-inst-submission-review]').forEach((item) => { item.disabled = true; });
		try {
			await api.reviewAssignmentSubmission(assignmentId, studentId, payload);
			showToast(action === 'returned' ? '已退回重做' : '批改已保存');
			await openInstitutionAssignmentSubmissions(container, assignmentId);
		} catch (error) {
			showToast(readErrorMessage(error, action === 'returned' ? '退回失败' : '批改保存失败'));
		} finally {
			pendingSubmissionReviews.delete(key);
		}
	}

	const pendingScheduleUpdates = new Set<string>();

	async function saveInstitutionSchedule(container: HTMLElement, button: HTMLButtonElement): Promise<void> {
		const ctx = getContext();
		const token = activeToken(ctx);
		const api = window.APIClient;
		const card = button.closest('[data-role-schedule-card]') as HTMLElement | null;
		const organizationId = card?.dataset.orgId || '';
		const learningGroupId = card?.dataset.groupId || '';
		const key = `${organizationId}:${learningGroupId}`;
		if (!token || !organizationId || !learningGroupId || !api || typeof api.updateInstitutionSchedule !== 'function' || pendingScheduleUpdates.has(key)) return;
		const startsAt = (card?.querySelector('[data-role-schedule-start]') as HTMLInputElement | null)?.value || '';
		const endsAt = (card?.querySelector('[data-role-schedule-end]') as HTMLInputElement | null)?.value || '';
		const status = (card?.querySelector('[data-role-schedule-status]') as HTMLSelectElement | null)?.value || 'scheduled';
		if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
			showToast('结束时间必须晚于开始时间');
			return;
		}
		pendingScheduleUpdates.add(key);
		button.disabled = true;
		try {
			await api.updateInstitutionSchedule(token, organizationId, learningGroupId, {
				starts_at: startsAt,
				ends_at: endsAt,
				status
			});
			invalidateInstitutionRoleWorkbench();
			showToast(status === 'cancelled' ? '课程已取消' : status === 'no_show' ? '缺席状态已记录' : status === 'rescheduled' ? '课程已改期' : '排课已保存');
			await ensureInstitutionRoleWorkbench(ctx);
			renderSectionContent({ preserveScroll: true });
		} catch (error) {
			showToast(readErrorMessage(error, '排课保存失败'));
		} finally {
			pendingScheduleUpdates.delete(key);
			button.disabled = false;
		}
	}

	const pendingAssignmentReminders = new Set<string>();

	async function remindInstitutionAssignment(container: HTMLElement, assignmentId: string, button?: HTMLButtonElement): Promise<void> {
		const api = window.APIClient;
		if (!assignmentId || pendingAssignmentReminders.has(assignmentId) || !api || typeof api.remindAssignment !== 'function') return;
		const message = (await requestTextInput('催交内容', '请按时完成作业，有问题可以联系老师。', { multiline: true }) || '').trim();
		if (!message) return;
		if (!await requestConfirmation('确定发送这条催交通知吗？')) return;
		const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? `reminder-${crypto.randomUUID()}`
			: `reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		pendingAssignmentReminders.add(assignmentId);
		if (button) button.disabled = true;
		try {
			const data = asRecord(await api.remindAssignment(assignmentId, { message, idempotency_key: idempotencyKey })) || {};
			const targets = Array.isArray(data.target_student_ids) ? data.target_student_ids.length : 0;
			showToast(`已记录催交，目标 ${targets} 人`);
			if (button?.closest('[data-assignment-reminder-config]')) {
				await openInstitutionAssignmentSubmissions(container, assignmentId);
			}
		} catch (error) {
			showToast(readErrorMessage(error, '催交失败'));
		} finally {
			pendingAssignmentReminders.delete(assignmentId);
			if (button) button.disabled = false;
		}
	}

	const pendingAutomaticReminderUpdates = new Set<string>();

	async function saveInstitutionAutomaticReminder(container: HTMLElement, button: HTMLButtonElement): Promise<void> {
		const assignmentId = button.dataset.instAssignmentAutoSave || '';
		const api = window.APIClient;
		const config = button.closest('[data-assignment-reminder-config]') as HTMLElement | null;
		const select = config?.querySelector('[data-assignment-reminder-hours]') as HTMLSelectElement | null;
		const value = select?.value || 'off';
		if (!assignmentId || !api || typeof api.updateAssignment !== 'function' || pendingAutomaticReminderUpdates.has(assignmentId)) return;
		const enabled = value !== 'off';
		pendingAutomaticReminderUpdates.add(assignmentId);
		button.disabled = true;
		try {
			await api.updateAssignment(assignmentId, {
				auto_reminder_enabled: enabled,
				auto_reminder_hours_before: [enabled ? Number(value) : 24]
			});
			showToast(enabled ? `已开启截止前 ${value} 小时自动催交` : '已关闭自动催交');
			await openInstitutionAssignmentSubmissions(container, assignmentId);
		} catch (error) {
			showToast(readErrorMessage(error, '自动催交设置保存失败'));
		} finally {
			pendingAutomaticReminderUpdates.delete(assignmentId);
			button.disabled = false;
		}
	}

	async function openInstitutionStudentProfile(container: HTMLElement, studentId: string): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const resolveDetail = (): HTMLElement | null => {
			const liveContainer = container.isConnected ? container : document.getElementById('pc-content');
			return liveContainer?.querySelector('#pc-institution-detail') as HTMLElement | null;
		};
		let detail = resolveDetail();
		if (!token || !studentId || !detail || !api || typeof api.getInstitutionStudentProfile !== 'function') return;
		detail.innerHTML = '<div class="pc-admin-note">正在加载学员档案...</div>';
		try {
			const data = asRecord(await api.getInstitutionStudentProfile(token, studentId)) || {};
			detail = resolveDetail() || detail;
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
				<div style="margin-top:8px;"><button class="pc-inline-btn" type="button" data-inst-add-note="${escapeHtml(studentId)}">添加跟进记录</button></div>
			</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px;">
				<div class="pc-card pc-info-card"><div class="pc-service-header">错题变化</div><div class="pc-info-list">${wrongRows || '<div class="pc-admin-note">暂无错题变化</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">作文历史</div><div class="pc-info-list">${writingRows || '<div class="pc-admin-note">暂无作文记录</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">听力弱项</div><div class="pc-info-list">${listenRows || '<div class="pc-admin-note">暂无听力弱项</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">跟进记录</div><div class="pc-info-list">${noteRows || '<div class="pc-admin-note">暂无跟进记录</div>'}</div></div>
				<div class="pc-card pc-info-card"><div class="pc-service-header">建议作业</div><div class="pc-info-list">${recommendedRows || '<div class="pc-admin-note">暂无建议</div>'}</div></div>
			</div>`;
		} catch (error) {
			detail = resolveDetail() || detail;
			detail.innerHTML = `<div class="pc-admin-note">${escapeHtml(readErrorMessage(error, '学员档案加载失败'))}</div>`;
		}
	}

	const institutionTeacherNotesInFlight = new Set<string>();

	async function addInstitutionTeacherNote(container: HTMLElement, studentId: string): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		if (!token || !studentId || institutionTeacherNotesInFlight.has(studentId) || !api || typeof api.addInstitutionTeacherNote !== 'function') return;
		const text = (await requestTextInput('跟进记录', '', { multiline: true }) || '').trim();
		if (!text) return;
		institutionTeacherNotesInFlight.add(studentId);
		const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(`[data-inst-add-note="${CSS.escape(studentId)}"]`));
		buttons.forEach((button) => {
			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
		});
		try {
			await api.addInstitutionTeacherNote(token, studentId, text);
			showToast('跟进记录已保存');
			await openInstitutionStudentProfile(container, studentId);
		} catch (error) {
			showToast(readErrorMessage(error, '跟进记录保存失败'));
		} finally {
			institutionTeacherNotesInFlight.delete(studentId);
			buttons.forEach((button) => {
				button.disabled = false;
				button.removeAttribute('aria-busy');
			});
		}
	}

	async function openInstitutionImportPreview(container: HTMLElement): Promise<void> {
		const token = activeToken(getContext());
		const api = window.APIClient;
		const detail = container.querySelector('#pc-institution-detail') as HTMLElement | null;
		if (!token || !detail || !api || typeof api.previewInstitutionImport !== 'function') return;
		const text = await requestTextInput('每行一个学员：姓名,邮箱,手机,角色', '张三,student@example.com,13800000000,student', { multiline: true }) || '';
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
		const examId = await requestTextInput('输入试卷 ID 用于组卷/讲义', '2023_02') || '';
		if (!examId.trim()) return;
		const focus = (await requestTextInput('考点/题型关键词（可空，例如 読解、聴解、writing）', '') || '').trim();
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
		const title = await requestTextInput('作业标题', `${examId || '备课方案'} 课堂作业`) || '';
		if (!title.trim()) return;
		const dueAt = await requestTextInput('截止日期（YYYY-MM-DD，可空）', '') || '';
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

	const pendingRolePrepAssignments = new Set<string>();

	async function createRoleAssignmentFromLessonPrep(container: HTMLElement, button: HTMLButtonElement): Promise<void> {
		const api = window.APIClient;
		const planId = button.dataset.rolePrepCreateAssignment || '';
		const card = button.closest('[data-role-prep-plan]') as HTMLElement | null;
		const organizationId = card?.dataset.rolePrepOrg || '';
		const learningGroupId = (card?.querySelector('[data-role-prep-group]') as HTMLSelectElement | null)?.value || '';
		const title = ((card?.querySelector('[data-role-prep-title]') as HTMLInputElement | null)?.value || '').trim();
		const dueAt = (card?.querySelector('[data-role-prep-due]') as HTMLInputElement | null)?.value || '';
		const data = institutionRoleWorkbenchData || {};
		const plans = Array.isArray(data.lesson_prep_plans) ? data.lesson_prep_plans.map((item) => asRecord(item) || {}) : [];
		const plan = plans.find((item) => (readString(item.lesson_prep_id) || readString(item.id)) === planId);
		if (!plan || !organizationId || !learningGroupId || !title || !api || typeof api.createLearningGroupAssignment !== 'function' || pendingRolePrepAssignments.has(planId)) {
			showToast('请选择学习组并填写作业标题');
			return;
		}
		const questionIds = (Array.isArray(plan.question_set) ? plan.question_set : [])
			.map((item) => readString(asRecord(item)?.question_id))
			.filter((item): item is string => Boolean(item));
		pendingRolePrepAssignments.add(planId);
		button.disabled = true;
		try {
			const created = asRecord(await api.createLearningGroupAssignment(organizationId, learningGroupId, {
				exam_id: readString(plan.exam_id),
				title,
				description: `由备课方案 ${planId} 生成`,
				due_at: dueAt,
				question_ids: questionIds,
				lesson_prep_id: planId
			})) || {};
			invalidateInstitutionRoleWorkbench();
			showToast('已从备课方案生成作业');
			const assignmentId = readString(created.assignment_id);
			activeRoleContent = assignmentId ? `teacher-assignment:${assignmentId}` : 'teacher-review';
			renderSectionContent();
		} catch (error) {
			showToast(readErrorMessage(error, '从备课方案生成作业失败'));
		} finally {
			pendingRolePrepAssignments.delete(planId);
			button.disabled = false;
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
		container.querySelectorAll<HTMLFormElement>('form[data-org-subscription-form], form[data-org-course-package-form]').forEach((form) => { form.noValidate = true; });
		bindOrganizationMemberForms(container);
		if (managedOrganizationToggleHandler) container.removeEventListener('toggle', managedOrganizationToggleHandler, true);
		managedOrganizationToggleHandler = (event: Event) => {
			const details = event.target as HTMLDetailsElement | null;
			if (!details?.matches('details[data-managed-org-id][data-managed-org-mode]')) return;
			const organizationId = details.dataset.managedOrgId || '';
			const mode = details.dataset.managedOrgMode || '';
			if (!organizationId || !mode) return;
			managedOrganizationOpenState[`${mode}:${organizationId}`] = details.open;
			if (details.open) void loadManagedOrganizationDetails(organizationId);
		};
		container.addEventListener('toggle', managedOrganizationToggleHandler, true);
		container.onclick = (event: MouseEvent) => {
			const target = eventTargetElement(event.target);
			const organizationSummary = target?.closest('summary.pc-managed-org-summary') as HTMLElement | null;
			if (organizationSummary) {
				event.preventDefault();
				const details = organizationSummary.closest<HTMLDetailsElement>('details[data-managed-org-id][data-managed-org-mode]');
				const organizationId = details?.dataset.managedOrgId || '';
				const mode = details?.dataset.managedOrgMode || '';
				if (organizationId && mode) {
					const open = !details?.open;
					if (details) details.open = open;
					managedOrganizationOpenState[`${mode}:${organizationId}`] = open;
					if (open) void loadManagedOrganizationDetails(organizationId);
					else renderSectionContent({ preserveScroll: true });
				}
				return;
			}
			const organizationPageButton = target?.closest('[data-managed-org-page]') as HTMLButtonElement | null;
			if (organizationPageButton) {
				managedOrganizationListPage.page = Math.max(1, managedOrganizationListPage.page + (organizationPageButton.dataset.managedOrgPage === 'next' ? 1 : -1));
				void reloadManagedOrganizationList();
				return;
			}
			const workbenchRoot = target?.closest('#pc-institution-workbench') as HTMLElement | null;
			if (workbenchRoot) workbenchRoot.dataset.instUserInteracted = 'true';
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
				void remindInstitutionAssignment(container, remindButton.dataset.instAssignmentRemind || '', remindButton);
				return;
			}
			const autoReminderSaveButton = target?.closest('[data-inst-assignment-auto-save]') as HTMLButtonElement | null;
			if (autoReminderSaveButton) {
				void saveInstitutionAutomaticReminder(container, autoReminderSaveButton);
				return;
			}
			const invitationCancelButton = target?.closest('[data-org-invitation-cancel]') as HTMLButtonElement | null;
			if (invitationCancelButton) {
				const organization = managedOrganizations.find((item) => item.id === (invitationCancelButton.dataset.orgId || ''));
				const invitationId = invitationCancelButton.dataset.invitationId || '';
				const invitationContact = invitationCancelButton.dataset.invitationContact || '';
				const invitation = organization?.invitations.find(
					(item) => item.invitationId === invitationId || (invitationContact && item.contact === invitationContact)
				);
				if (!organization || !invitation) {
					showToast('邀请信息已失效，请刷新后重试');
					return;
				}
				void cancelOrganizationInvitation(organization, invitation, invitationCancelButton);
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
				const mode = form?.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
				void searchOrganizationCandidates(organization, input.value || '', mode);
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
			const memberRoleButton = target?.closest('[data-org-member-role]') as HTMLButtonElement | null;
			if (memberRoleButton) {
				const organizationId = memberRoleButton.dataset.orgId || '';
				const roleId = memberRoleButton.dataset.roleId || '';
				if (organizationId && roleId) {
					activeOrganizationMemberRoles[organizationId] = roleId;
					renderSectionContent({ preserveScroll: true });
				}
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
				void completeOrganizationLearningGroup(organization, learningGroup, completeLearningGroupButton);
				return;
			}
			const removeButton = target?.closest('[data-org-member-remove]') as HTMLButtonElement | null;
			if (!removeButton) {
				const saveMemberButton = target?.closest('[data-org-member-save]') as HTMLButtonElement | null;
				if (!saveMemberButton) {
					return;
				}
				const form = organizationMemberFormForButton(saveMemberButton);
				if (!form) {
					showToast('成员表单已失效，请刷新后重试');
					return;
				}
				saveOrganizationMemberForm(form);
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
			void removeOrganizationMembership(organization, member, removeButton);
		};

		container.onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			const form = event.target as HTMLFormElement | null;
			if (!form) {
				return;
			}
			if (form.matches('form[data-managed-org-list-form]')) {
				managedOrganizationListPage.query = (form.querySelector('[data-managed-org-query]') as HTMLInputElement | null)?.value.trim() || '';
				managedOrganizationListPage.page = 1;
				void reloadManagedOrganizationList();
				return;
			}
			if (form.matches('form[data-org-add-form]')) {
				const organization = managedOrganizations.find((item) => item.id === (form.dataset.orgId || ''));
				if (!organization) {
					showToast('组织信息已失效，请刷新后重试');
					return;
				}
				const draft = getOrganizationMemberDraft(organization.id);
				const queryInput = form.querySelector('[data-org-search-query]') as HTMLInputElement | null;
				const contactValue = (queryInput?.value || draft.searchQuery || '').trim();
				draft.searchQuery = contactValue;
				const messageInput = form.querySelector('[data-org-invite-message]') as HTMLTextAreaElement | null;
				const mode = form.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
				const roles = normalizeOrganizationAddRoles(readOrganizationRoles(form), mode);
				if (draft.selectedUserId) {
					void saveOrganizationMembership(
						organization,
						draft.selectedUserId,
						roles,
						'',
						[],
						[],
						mode === 'manager' ? '管理人员已添加' : '成员已添加',
						form
					);
				} else if (looksLikeOrganizationInviteContact(contactValue)) {
					void saveOrganizationInvitation(
						organization,
						contactValue,
						roles,
						'',
						[],
						messageInput?.value || '',
						form
					);
				} else {
					setFieldError(queryInput, '请先选择已有账号，或输入完整邮箱/手机号');
					showToast('请先选择已有账号，或输入完整邮箱/手机号后再添加邀请');
				}
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
					[],
					messageInput?.value || '',
					form
				);
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
					expiresAtInput?.value || '',
					form
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
				saveOrganizationMemberForm(form);
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
			const mode = form?.dataset.orgAddMode === 'manager' ? 'manager' : 'member';
			void searchOrganizationCandidates(organization, (target as HTMLInputElement).value || '', mode);
		};
	}

	function captureManagedOrganizationOpenState(container: HTMLElement): void {
		container.querySelectorAll<HTMLDetailsElement>('details[data-managed-org-id][data-managed-org-mode]').forEach((details) => {
			const organizationId = details.dataset.managedOrgId || '';
			const mode = details.dataset.managedOrgMode || '';
			if (organizationId && mode) {
				managedOrganizationOpenState[`${mode}:${organizationId}`] = details.open;
			}
		});
	}

	type DirtyFormSnapshot = {
		marker: string;
		identity: Record<string, string>;
		controls: Array<{ value: string; checked?: boolean }>;
	};

	function captureDirtyForms(container: HTMLElement): DirtyFormSnapshot[] {
		return Array.from(container.querySelectorAll<HTMLFormElement>('form[data-pc-dirty="true"]')).flatMap((form) => {
			const marker = Array.from(form.attributes).find((attribute) => attribute.name.startsWith('data-') && attribute.name.endsWith('-form'))?.name;
			if (!marker) return [];
			const identity: Record<string, string> = {};
			for (const name of ['data-org-id', 'data-user-id', 'data-role-id', 'data-effect', 'data-org-add-mode']) {
				if (form.hasAttribute(name)) identity[name] = form.getAttribute(name) || '';
			}
			const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')).map((control) => ({
				value: control.value,
				...('checked' in control ? { checked: control.checked } : {})
			}));
			return [{ marker, identity, controls }];
		});
	}

	function restoreDirtyForms(container: HTMLElement, snapshots: DirtyFormSnapshot[]): void {
		for (const snapshot of snapshots) {
			const form = Array.from(container.querySelectorAll<HTMLFormElement>(`form[${snapshot.marker}]`)).find((candidate) =>
				Object.entries(snapshot.identity).every(([name, value]) => (candidate.getAttribute(name) || '') === value)
			);
			if (!form) continue;
			form.dataset.pcDirty = 'true';
			const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'));
			snapshot.controls.forEach((saved, index) => {
				const control = controls[index];
				if (!control) return;
				control.value = saved.value;
				if ('checked' in control && typeof saved.checked === 'boolean') control.checked = saved.checked;
			});
		}
	}

	function renderSectionContent(options: { preserveScroll?: boolean; focusSelector?: string } = {}): void {
		const container = document.getElementById('pc-content');
		if (!container) {
			return;
		}
		const previousScrollTop = container.scrollTop;
		const dirtyForms = captureDirtyForms(container);
		captureManagedOrganizationOpenState(container);
		syncHeaderActions();
		const ctx = getContext();
		container.onclick = null;
		container.onsubmit = null;
		container.oninput = null;
		container.onkeydown = null;
		switch (activeSection) {
			case 'dashboard':
				void ensurePendingInvitations(ctx);
				if (activeDashboardSubpage === 'recent') {
					void ensureRecentLearning(ctx);
				}
				if (activeDashboardSubpage === 'favorites') {
					void ensureFavoriteBookmarks(ctx);
				}
				container.innerHTML = renderDashboard(ctx);
				attachDashboardHandlers(container);
				hydrateInstitutionRoleDetail(container);
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
		restoreDirtyForms(container, dirtyForms);
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
				<div class="risk-header"><strong id="risk-title"></strong><button type="button" id="risk-close" class="risk-close" data-rm-act="close" aria-label="关闭高风险确认">×</button></div>
				<div class="risk-body" id="risk-body"></div>
				<div class="risk-footer" id="risk-footer"></div>
			</div>`;
		prepareLegacyModal(riskModal, 'risk-title', '.risk-panel');
		riskModal.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.rmAct === 'close' || target?.dataset.rmAct === 'cancel') {
				if (riskModal) hideLegacyModal(riskModal);
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
		footerEl.innerHTML = `<button type="button" class="risk-btn" data-rm-act="cancel">取消</button><button type="button" class="risk-btn primary" id="risk-ok" disabled>确认</button>`;
		showLegacyModal(modal, '#risk-input');
		const input = modal.querySelector('#risk-input') as HTMLInputElement | null;
		const ok = modal.querySelector('#risk-ok') as HTMLButtonElement | null;
		if (!input || !ok) {
			return;
		}
		input.oninput = () => {
			ok.disabled = input.value.trim() !== word;
		};
		ok.onclick = () => {
			hideLegacyModal(modal);
			onConfirm();
		};
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
		el.className = 'risk-modal risk-hidden';
		el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:9999;';
		el.innerHTML = `<div class="risk-backdrop" data-wq-act="close"></div>
			<div class="risk-panel" style="position:relative;background:#fff;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);max-width:720px;width:90%;max-height:88vh;overflow:auto;">
				<div class="risk-header"><strong id="wq-title">错题本</strong><button type="button" id="wq-close" class="risk-close" data-wq-act="close" aria-label="关闭错题本">×</button></div>
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
					<button type="button" id="wq-reload" class="risk-btn">刷新</button>
					<button type="button" id="wq-reset" class="risk-btn" style="margin-left:auto;color:#a33;">清空错题本</button>
				</div>
				<div class="risk-body" id="wq-body" style="max-height:60vh;overflow:auto;"></div>
				<div class="risk-footer"><button type="button" class="risk-btn" data-wq-act="close">关闭</button></div>
			</div>`;
		prepareLegacyModal(el, 'wq-title', '.risk-panel');
		// 关闭按钮（背景或 × 或底部"关闭"按钮）
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.wqAct === 'close') {
				hideLegacyModal(el);
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
		const relatedDecision = resolveEntitlement(getContext().subscription, 'answer.deep_analysis');
		const relatedLocked = relatedDecision.known && !relatedDecision.granted;
		const relatedButton = `<button class="risk-btn${relatedLocked ? ' is-entitlement-locked' : ''}"
			data-wq-action="related"
			data-qid="${escapeHtmlSafe(qid)}"
			data-exam="${escapeHtmlSafe(examId)}"
			${relatedLocked ? `data-entitlement-locked="true" data-required-plan="${escapeHtmlSafe(relatedDecision.requiredPlan || '')}"` : ''}>
			📚 同考点串题${relatedLocked ? ` · ${escapeHtmlSafe((relatedDecision.requiredPlan || '升级').toUpperCase())}` : ''}
		</button>`;
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
				${relatedButton}
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
		showLegacyModal(modal, '.risk-close');

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
						.resetWrongQuestions(userId, '清空错题本')
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
					if (btn.dataset.entitlementLocked === 'true') {
						handleFeatureIntent(entitlementUpgradeIntent(
							'answer.deep_analysis',
							btn.dataset.requiredPlan || ''
						));
						return;
					}
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
					hideLegacyModal(modal);
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
					<h3 id="srs-title" style="margin:0;font-size:16px;">📚 今日复习（间隔重复）</h3>
					<button type="button" id="srs-close" aria-label="关闭今日复习" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
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
		prepareLegacyModal(modal, 'srs-title');
		(modal.querySelector('#srs-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		showLegacyModal(modal, '#srs-close');

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
			const gradeButtons = Array.from(footer.querySelectorAll<HTMLButtonElement>('button.srs-grade'));
			const originalLabel = btn.textContent || '';
			gradeButtons.forEach((button) => (button.disabled = true));
			btn.setAttribute('aria-busy', 'true');
			btn.textContent = '提交中…';
			try {
				await api.reviewSrsCard(userId, cardId, grade);
				await loadAndRenderSrsCard(modal, userId);
			} catch (err) {
				showToast(readErrorMessage(err, '评分失败'));
			} finally {
				gradeButtons.forEach((button) => (button.disabled = false));
				btn.removeAttribute('aria-busy');
				btn.textContent = originalLabel;
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
					<h3 id="rw-title" style="margin:0;font-size:16px;">今日复习工作台</h3>
					<button type="button" id="rw-close" aria-label="关闭复习工作台" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="rw-body" style="min-height:240px;"></div>
			</div>`;
		document.body.appendChild(modal);
		reviewWorkbenchModal = modal;
		prepareLegacyModal(modal, 'rw-title');
		(modal.querySelector('#rw-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		showLegacyModal(modal, '#rw-close');
		await reloadReviewWorkbench();
	}

	// 业务功能 10：数据导出 —— 拉取 JSON 快照并触发浏览器下载
	async function openDataExportPanel(): Promise<void> {
		const ctx = getContext();
		const userId = ctx.id || '';
		if (!userId) {
			showToast('请先登录后导出数据');
			return;
		}
		const exportDecision = resolveEntitlement(ctx.subscription, 'export.standard');
		if (exportDecision.known && !exportDecision.granted) {
			handleFeatureIntent(entitlementUpgradeIntent('export.standard', exportDecision.requiredPlan));
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
					<h3 id="ad-title" style="margin:0;font-size:16px;">📊 运营仪表盘</h3>
					<div>
						<button type="button" id="ad-refresh" style="margin-right:8px;padding:6px 12px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">刷新</button>
						<button type="button" id="ad-close" aria-label="关闭运营仪表盘" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
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
		prepareLegacyModal(modal, 'ad-title');
		(modal.querySelector('#ad-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
			<div class="pc-responsive-table-region" role="region" aria-label="用户角色分布" tabindex="0">
				<div style="font-weight:600;margin-bottom:6px;">用户角色分布</div>
				<table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
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
		const reauthPassword = await requestHighRiskPassword('修改系统功能开关');
		if (reauthPassword === null) return;
		try {
			await api.updateSystemFeatureFlags({ [key]: { enabled: !currentlyEnabled } }, reauthPassword);
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
		showLegacyModal(modal, '#ad-close');
		(modal.querySelector('#ad-refresh') as HTMLButtonElement).onclick = async (event) => {
			const button = event.currentTarget as HTMLButtonElement;
			const finishAction = beginOrganizationAction(button, '刷新中…');
			if (!finishAction) return;
			try { await reloadAdminOverview(modal); } finally { finishAction(); }
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
					<h3 id="cm-title" style="margin:0;font-size:16px;">💬 社区讨论 <span id="cm-paper" style="color:#999;font-size:12px;font-weight:normal;"></span></h3>
					<div>
						<button type="button" id="cm-new" style="margin-right:8px;padding:6px 12px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">+ 发帖</button>
						<button type="button" id="cm-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">刷新</button>
						<button type="button" id="cm-close" aria-label="关闭社区讨论" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="cm-body" style="min-height:160px;"></div>
			</div>`;
		document.body.appendChild(modal);
		communityModal = modal;
		prepareLegacyModal(modal, 'cm-title');
		(modal.querySelector('#cm-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		showLegacyModal(modal, '#cm-close');

		// 发帖
		(modal.querySelector('#cm-new') as HTMLButtonElement).onclick = async () => {
			const title = await requestTextInput('帖子标题（≤80）');
			if (!title) return;
			const body = await requestTextInput('帖子内容（≤2000）', '', { multiline: true });
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
					if (!await requestConfirmation('确定要删除这条帖子吗？')) return;
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
	let auditDetailModal: HTMLDivElement | null = null;
	const auditLogState: {
		offset: number;
		limit: number;
		lastTotal: number;
		lastItems: Array<Record<string, unknown>>;
		actions: string[];
		actionLabels: Record<string, string>;
	} = { offset: 0, limit: 50, lastTotal: 0, lastItems: [], actions: [], actionLabels: {} };

	function auditActionLabel(action: string, fallback?: unknown): string {
		return String(fallback || auditLogState.actionLabels[action] || action || '未知操作');
	}

	function ensureAuditDetailModal(): HTMLDivElement {
		if (auditDetailModal) return auditDetailModal;
		const modal = document.createElement('div');
		modal.id = 'audit-detail-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.48);display:flex;align-items:center;justify-content:center;z-index:10000;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;width:min(720px,calc(100vw - 40px));max-height:84vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,0.24);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
					<h3 id="ald-title" style="margin:0;font-size:16px;">审计记录详情</h3>
					<button type="button" id="ald-close" aria-label="关闭详情" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="ald-body"></div>
			</div>`;
		document.body.appendChild(modal);
		auditDetailModal = modal;
		prepareLegacyModal(modal, 'ald-title');
		const close = (): void => hideLegacyModal(modal);
		(modal.querySelector('#ald-close') as HTMLButtonElement).onclick = close;
		modal.addEventListener('click', (event) => {
			if (event.target === modal) close();
		});
		return modal;
	}

	function openAuditDetail(index: number): void {
		const item = auditLogState.lastItems[index];
		if (!item) return;
		const modal = ensureAuditDetailModal();
		const action = String(item.action || '');
		const details = item.details && typeof item.details === 'object' ? item.details : {};
		let detailsText = '';
		try {
			detailsText = JSON.stringify(details, null, 2);
		} catch {
			detailsText = String(details);
		}
		const fields: Array<[string, string]> = [
			['记录 ID', String(item.audit_id || '—')],
			['时间', String(item.created_at || '—')],
			['操作', `${auditActionLabel(action, item.action_label)} (${action || '—'})`],
			['操作者', String(item.actor_username || item.actor_user_id || '—')],
			['用户 ID', String(item.actor_user_id || '—')],
			['范围', String(item.org_id || (item.scope === 'platform' ? '平台' : '—'))],
			['摘要', String(item.summary || '—')]
		];
		(modal.querySelector('#ald-body') as HTMLDivElement).innerHTML = `
			<dl style="display:grid;grid-template-columns:100px minmax(0,1fr);gap:9px 12px;margin:0;">
				${fields.map(([label, value]) => `<dt style="color:#777;font-size:12px;">${escapeHtmlSafe(label)}</dt><dd style="margin:0;word-break:break-word;">${escapeHtmlSafe(value)}</dd>`).join('')}
			</dl>
			<div style="margin-top:16px;font-size:12px;color:#777;">结构化详情</div>
			<pre style="white-space:pre-wrap;word-break:break-all;background:#f7f7f7;padding:10px;border-radius:6px;font-size:12px;line-height:1.55;margin:6px 0 0;">${escapeHtmlSafe(detailsText || '{}')}</pre>`;
		showLegacyModal(modal, '#ald-close');
	}

	function ensureAuditLogModal(): HTMLDivElement {
		if (auditLogModal) return auditLogModal;
		const isSuper = hasAnyRole(getContext(), ['superAdmin']);
		const isContentAdmin = hasAnyRole(getContext(), ['contentAdmin']) && !hasAnyRole(getContext(), ['superAdmin', 'orgAdmin']);
		const modalTitle = isContentAdmin ? '内容变更日志' : '审计日志';
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
					<h3 id="al-title" style="margin:0;font-size:16px;">📜 ${modalTitle}</h3>
					<div>
						<button id="al-export" style="margin-right:8px;padding:6px 12px;cursor:pointer;">导出 CSV</button>
						<button type="button" id="al-close" aria-label="关闭审计日志" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
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
		prepareLegacyModal(modal, 'al-title');
		(modal.querySelector('#al-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
			return '<div style="padding:24px;text-align:center;color:#777;">没有匹配的日志<div style="margin-top:12px;"><button type="button" data-audit-reset-empty style="padding:6px 12px;cursor:pointer;">清除筛选并重新加载</button></div></div>';
		}
		const rows = items
			.map((it, index) => {
				const t = escapeHtmlSafe(String(it.created_at || ''));
				const actor = escapeHtmlSafe(String(it.actor_username || it.actor_user_id || ''));
				const org = escapeHtmlSafe(String(it.org_id || (it.scope === 'platform' ? '平台' : '')));
				const actionCode = String(it.action || '');
				const action = escapeHtmlSafe(auditActionLabel(actionCode, it.action_label));
				const escapedActionCode = escapeHtmlSafe(actionCode);
				const summary = escapeHtmlSafe(String(it.summary || ''));
				const detailsCell = `<button type="button" data-audit-detail="${index}" style="padding:3px 9px;border:1px solid #b9cef0;background:#f4f8ff;color:#165da8;border-radius:4px;cursor:pointer;">查看详情</button>`;
				return `<tr>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;white-space:nowrap;">${t}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">${actor}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888;font-size:11px;">${org}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;"><span title="${escapedActionCode}" style="background:#f0f4ff;padding:2px 6px;border-radius:3px;font-size:12px;">${action}</span></td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;">${summary}</td>
					<td style="padding:6px 8px;border-bottom:1px solid #eee;max-width:240px;">${detailsCell}</td>
				</tr>`;
			})
			.join('');
		return `<div class="pc-responsive-table-region" role="region" aria-label="审计日志" tabindex="0"><table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
			<thead><tr style="background:#fafafa;">
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">时间</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">操作者</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">组织</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">操作</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">摘要</th>
				<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">详情</th>
			</tr></thead>
			<tbody>${rows}</tbody>
		</table></div>`;
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
			body.onclick = (event: MouseEvent) => {
				const resetButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-audit-reset-empty]');
				if (resetButton) {
					(auditLogModal?.querySelector('#al-reset') as HTMLButtonElement | null)?.click();
					return;
				}
				const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-audit-detail]');
				if (!button) return;
				openAuditDetail(Number(button.dataset.auditDetail));
			};
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
			const options = Array.isArray(data?.action_options)
				? (data!.action_options as Array<Record<string, unknown>>)
				: [];
			auditLogState.actionLabels = Object.fromEntries(
				options.map((option) => [String(option.value || ''), String(option.label || option.value || '')])
			);
			auditLogState.actions = arr;
			const sel = auditLogModal.querySelector('#al-action') as HTMLSelectElement;
			const cur = sel.value;
			sel.innerHTML = '<option value="">全部</option>' +
				arr.map((a) => `<option value="${escapeHtmlSafe(a)}">${escapeHtmlSafe(auditActionLabel(a))}</option>`).join('');
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
		const headers = ['created_at', 'actor_user_id', 'actor_username', 'org_id', 'action', 'action_label', 'summary', 'details'];
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
		showLegacyModal(modal, '#al-close');
		await reloadAuditActions();
		await reloadAuditLogs();
	}

	// ---------------------------------------------------------------------
	// 业务功能 16：每日一练面板
	//   - 列表显示今日 N 道题（来自错题本 + SRS 到期），点击「去做题」按 examId 加载试卷
	//   - 完成单题后调用 markComplete；底部「换一批」可强制重新生成
	// ---------------------------------------------------------------------
	let dailyModal: HTMLDivElement | null = null;
	let dailyPracticeRegenerating = false;

	function ensureDailyModal(): HTMLDivElement {
		if (dailyModal) return dailyModal;
		const modal = document.createElement('div');
		modal.id = 'daily-practice-modal';
		modal.className = 'risk-modal risk-hidden';
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div style="background:#fff;border-radius:8px;padding:20px;min-width:520px;max-width:760px;max-height:85vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 id="dp-title" style="margin:0;font-size:16px;">🎯 每日一练 <span id="dp-date" style="color:#999;font-size:12px;font-weight:normal;"></span></h3>
					<div>
						<button type="button" id="dp-regen" style="margin-right:8px;padding:6px 12px;cursor:pointer;">换一批</button>
						<button type="button" id="dp-close" aria-label="关闭每日一练" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="dp-body" style="min-height:200px;"></div>
				<div style="margin-top:12px;font-size:11px;color:#999;">每日同一份清单将在 24 小时内保持稳定；可点击「换一批」强制刷新。</div>
			</div>`;
		document.body.appendChild(modal);
		dailyModal = modal;
		prepareLegacyModal(modal, 'dp-title');
		(modal.querySelector('#dp-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		showLegacyModal(modal, '#dp-close');
		await reloadDailyPractice();
	}

	async function regenerateDailyPractice(reloadModal: boolean = false): Promise<void> {
		const api = window.APIClient;
		if (dailyPracticeRegenerating || !api || typeof api.regenerateDailyPractice !== 'function') return;
		dailyPracticeRegenerating = true;
		const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-daily-action="regenerate"], #dp-regen'));
		const labels = buttons.map((button) => button.textContent || '');
		buttons.forEach((button) => {
			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.textContent = '生成中…';
		});
		try {
			await api.regenerateDailyPractice();
			void refreshDailyPracticeBanner(getContext());
			if (reloadModal && dailyModal) await reloadDailyPractice();
			showToast('已重新生成');
		} catch (err) {
			showToast(readErrorMessage(err, '重新生成失败'));
		} finally {
			dailyPracticeRegenerating = false;
			buttons.forEach((button, index) => {
				button.disabled = false;
				button.removeAttribute('aria-busy');
				button.textContent = labels[index];
			});
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
					<h3 id="rr-title" style="margin:0;font-size:16px;">推荐复习</h3>
					<button type="button" id="rr-close" aria-label="关闭推荐复习" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
				</div>
				<div id="rr-body" style="min-height:220px;"></div>
			</div>`;
		document.body.appendChild(modal);
		recommendedReviewModal = modal;
		prepareLegacyModal(modal, 'rr-title');
		(modal.querySelector('#rr-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		const recommendationDecision = resolveEntitlement(ctx.subscription, 'recommendation.personalized');
		if (recommendationDecision.known && !recommendationDecision.granted) {
			handleFeatureIntent(entitlementUpgradeIntent(
				'recommendation.personalized',
				recommendationDecision.requiredPlan
			));
			return;
		}
		const modal = ensureRecommendedReviewModal();
		showLegacyModal(modal, '#rr-close');
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
					<h3 id="lr-title" style="margin:0;font-size:16px;">📈 学习报告</h3>
					<div>
						<button id="lr-week" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本周</button>
						<button id="lr-month" style="margin-right:8px;padding:6px 12px;cursor:pointer;">本月</button>
						<button type="button" id="lr-close" aria-label="关闭学习报告" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="lr-body" style="min-height:200px;"></div>
			</div>`;
		document.body.appendChild(modal);
		learningReportModal = modal;
		prepareLegacyModal(modal, 'lr-title');
		(modal.querySelector('#lr-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
		});
		const loadPeriod = async (button: HTMLButtonElement, period: 'week' | 'month'): Promise<void> => {
			const finishAction = beginOrganizationAction(button, '加载中…');
			if (!finishAction) return;
			learningReportPeriod = period;
			try { await reloadLearningReport(); } finally { finishAction(); }
		};
		const weekButton = modal.querySelector('#lr-week') as HTMLButtonElement;
		const monthButton = modal.querySelector('#lr-month') as HTMLButtonElement;
		weekButton.onclick = () => void loadPeriod(weekButton, 'week');
		monthButton.onclick = () => {
			const decision = resolveEntitlement(getContext().subscription, 'analytics.full');
			if (decision.known && !decision.granted) {
				handleFeatureIntent(entitlementUpgradeIntent('analytics.full', decision.requiredPlan));
				return;
			}
			void loadPeriod(monthButton, 'month');
		};
		return modal;
	}

	function configureLearningReportEntitlements(modal: HTMLDivElement): void {
		const monthButton = modal.querySelector('#lr-month') as HTMLButtonElement | null;
		if (!monthButton) return;
		const decision = resolveEntitlement(getContext().subscription, 'analytics.full');
		const locked = decision.known && !decision.granted;
		monthButton.textContent = locked
			? `本月 · ${(decision.requiredPlan || '升级').toUpperCase()}`
			: '本月';
		monthButton.classList.toggle('is-entitlement-locked', locked);
		if (locked) {
			monthButton.dataset.entitlementLocked = 'true';
			monthButton.title = `${(decision.requiredPlan || '更高').toUpperCase()} 套餐解锁完整月度分析`;
		} else {
			delete monthButton.dataset.entitlementLocked;
			monthButton.removeAttribute('title');
		}
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
			<div class="pc-responsive-table-region" role="region" aria-label="最近答题" tabindex="0"><table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
				<thead><tr style="background:#fafafa;">
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">试卷</th>
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">提交时间</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确/总题</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确率</th>
				</tr></thead>
				<tbody>${paperRows}</tbody>
			</table></div>`;
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
		learningReportPeriod = 'week';
		configureLearningReportEntitlements(modal);
		showLegacyModal(modal, '#lr-close');
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
					<h3 id="sg-modal-title" style="margin:0;font-size:16px;">🎯 备考目标管理</h3>
					<button type="button" id="sg-close" aria-label="关闭备考目标" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
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
		prepareLegacyModal(modal, 'sg-modal-title');
		(modal.querySelector('#sg-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
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
		const submit = modal.querySelector<HTMLButtonElement>('#sg-form button[type="submit"]');
		const finishAction = submit ? beginOrganizationAction(submit, '添加中…') : null;
		if (submit && !finishAction) return;
		try {
			await api.createStudyGoal(payload);
			(modal.querySelector('#sg-form') as HTMLFormElement).reset();
			showToast('目标已添加');
			await reloadStudyGoals();
			void refreshStudyGoalBanner(getContext());
		} catch (err) {
			showToast(readErrorMessage(err, '添加失败'));
		} finally {
			finishAction?.();
		}
	}

	const pendingStudyGoalDeletes = new Set<string>();

	async function deleteStudyGoal(goalId: string): Promise<void> {
		if (!goalId || pendingStudyGoalDeletes.has(goalId)) return;
		if (!await requestConfirmation('确定删除该目标？')) return;
		const api = window.APIClient;
		if (!api || typeof api.deleteStudyGoal !== 'function') return;
		pendingStudyGoalDeletes.add(goalId);
		try {
			await api.deleteStudyGoal(goalId);
			showToast('已删除');
			await reloadStudyGoals();
			void refreshStudyGoalBanner(getContext());
		} catch (err) {
			showToast(readErrorMessage(err, '删除失败'));
		} finally {
			pendingStudyGoalDeletes.delete(goalId);
		}
	}

	async function openStudyGoalPanel(): Promise<void> {
		const modal = ensureStudyGoalModal();
		showLegacyModal(modal, '#sg-close');
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
		modal.setAttribute('role', 'presentation');
		modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		modal.innerHTML = `
			<div role="dialog" aria-modal="true" aria-labelledby="sd-title" style="background:#fff;border-radius:8px;padding:20px;width:min(760px,94vw);box-sizing:border-box;max-height:88vh;overflow:auto;box-shadow:0 6px 24px rgba(0,0,0,0.2);">
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
					<h3 id="sd-title" style="margin:0;font-size:16px;">🔄 多端同步</h3>
					<div class="pc-sync-actions">
						<button type="button" id="sd-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">刷新状态</button>
						<button type="button" id="sd-devices" style="margin-right:8px;padding:6px 12px;cursor:pointer;">设备</button>
						<button type="button" id="sd-push" style="margin-right:8px;padding:6px 12px;background:#06c;color:#fff;border:0;border-radius:4px;cursor:pointer;">上传选中</button>
						<button type="button" id="sd-pull" style="margin-right:8px;padding:6px 12px;background:#0a7;color:#fff;border:0;border-radius:4px;cursor:pointer;">拉取选中</button>
						<button type="button" id="sd-close" aria-label="关闭多端同步" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
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
		prepareLegacyModal(modal, 'sd-title');
		const closeModal = () => hideLegacyModal(modal);
		(modal.querySelector('#sd-close') as HTMLButtonElement).onclick = closeModal;
		modal.addEventListener('click', (e) => {
			if (e.target === modal) closeModal();
		});
		const runSyncAction = async (button: HTMLButtonElement, busyLabel: string, action: () => Promise<void>): Promise<void> => {
			const finishAction = beginOrganizationAction(button, busyLabel);
			if (!finishAction) return;
			try { await action(); } finally { finishAction(); }
		};
		const refreshButton = modal.querySelector('#sd-refresh') as HTMLButtonElement;
		const pullButton = modal.querySelector('#sd-pull') as HTMLButtonElement;
		const pushButton = modal.querySelector('#sd-push') as HTMLButtonElement;
		const devicesButton = modal.querySelector('#sd-devices') as HTMLButtonElement;
		refreshButton.onclick = () => void runSyncAction(refreshButton, '刷新中…', reloadSyncState);
		pullButton.onclick = () => void runSyncAction(pullButton, '拉取中…', pullSelectedSyncModules);
		pushButton.onclick = () => void runSyncAction(pushButton, '上传中…', () => pushSelectedSyncModules(false));
		devicesButton.onclick = () => void runSyncAction(devicesButton, '加载中…', reloadSyncDevices);
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
				<div class="pc-responsive-table-region" role="region" aria-label="同步模块状态" tabindex="0"><table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
					<thead><tr style="background:#fafafa;">
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">模块</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">服务端存在</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">服务端 mtime</th>
						<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">本机缓存 mtime</th>
					</tr></thead>
					<tbody>${rows}</tbody>
				</table></div>`;
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
				if (await requestConfirmation(`发现 ${conflictNames.length} 个同步冲突。是否用本机缓存覆盖服务端？`, '确认覆盖')) {
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
				<div class="pc-responsive-table-region" role="region" aria-label="同步设备列表" tabindex="0"><table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
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
				</table></div>`;
			status.textContent = `共 ${items.length} 台设备`;
		} catch (err) {
			body.innerHTML = `<div style="padding:24px;color:#a33;">加载失败：${escapeHtmlSafe(readErrorMessage(err, '未知错误'))}</div>`;
		}
	}

	async function openSyncDevicesPanel(): Promise<void> {
		const modal = ensureSyncDevicesModal();
		showLegacyModal(modal, '#sd-close');
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
					<h3 id="lb-title" style="margin:0;font-size:16px;">🏆 排行榜</h3>
					<div>
						<button id="lb-week" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本周</button>
						<button id="lb-month" style="margin-right:4px;padding:6px 12px;cursor:pointer;">本月</button>
						<button id="lb-all" style="margin-right:8px;padding:6px 12px;cursor:pointer;">总榜</button>
						<button id="lb-refresh" style="margin-right:8px;padding:6px 12px;cursor:pointer;">强制刷新</button>
						<button type="button" id="lb-close" aria-label="关闭排行榜" style="background:none;border:0;font-size:18px;cursor:pointer;">×</button>
					</div>
				</div>
				<div id="lb-body" style="min-height:240px;"></div>
			</div>`;
		document.body.appendChild(modal);
		leaderboardModal = modal;
		prepareLegacyModal(modal, 'lb-title');
		(modal.querySelector('#lb-close') as HTMLButtonElement).onclick = () => hideLegacyModal(modal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) hideLegacyModal(modal);
		});
		const loadLeaderboard = async (button: HTMLButtonElement, period: 'week' | 'month' | 'all', force: boolean): Promise<void> => {
			const finishAction = beginOrganizationAction(button, '加载中…');
			if (!finishAction) return;
			leaderboardPeriod = period;
			try { await reloadLeaderboard(force); } finally { finishAction(); }
		};
		(modal.querySelector('#lb-week') as HTMLButtonElement).onclick = (event) => void loadLeaderboard(event.currentTarget as HTMLButtonElement, 'week', false);
		(modal.querySelector('#lb-month') as HTMLButtonElement).onclick = (event) => void loadLeaderboard(event.currentTarget as HTMLButtonElement, 'month', false);
		(modal.querySelector('#lb-all') as HTMLButtonElement).onclick = (event) => void loadLeaderboard(event.currentTarget as HTMLButtonElement, 'all', false);
		(modal.querySelector('#lb-refresh') as HTMLButtonElement).onclick = (event) => void loadLeaderboard(event.currentTarget as HTMLButtonElement, leaderboardPeriod, true);
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
			<div class="pc-responsive-table-region" role="region" aria-label="学习排行榜" tabindex="0"><table class="pc-responsive-table" style="border-collapse:collapse;width:100%;font-size:13px;">
				<thead><tr style="background:#fafafa;">
					<th style="padding:6px 8px;text-align:center;border-bottom:2px solid #ddd;width:60px;">名次</th>
					<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;">用户</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">连胜</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">答题量</th>
					<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #ddd;">正确率</th>
				</tr></thead>
				<tbody>${rows}</tbody>
				</table></div>`;
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
		showLegacyModal(modal, '#lb-close');
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
		el.className = 'risk-modal risk-hidden';
		el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:9999;';
		el.innerHTML = `<div class="risk-backdrop" data-vocab-act="close"></div>
			<div class="risk-panel" style="position:relative;background:#fff;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);max-width:760px;width:90%;max-height:88vh;overflow:auto;">
				<div class="risk-header"><strong id="vocab-title">生词本</strong><button type="button" id="vocab-close" class="risk-close" data-vocab-act="close" aria-label="关闭生词本">×</button></div>
				<div id="vocab-summary" style="padding:8px 16px;font-size:13px;color:#777;"></div>
				<div style="display:flex;gap:8px;align-items:center;padding:0 16px 8px 16px;flex-wrap:wrap;font-size:13px;">
					<input id="vocab-filter" type="search" placeholder="搜索词形 / 假名 / 笔记..." style="flex:1;min-width:200px;padding:4px 8px;" />
					<button type="button" id="vocab-reload" class="risk-btn">刷新</button>
				</div>
				<div class="risk-body" id="vocab-body" style="max-height:62vh;overflow:auto;"></div>
				<div class="risk-footer"><button type="button" class="risk-btn" data-vocab-act="close">关闭</button></div>
			</div>`;
		prepareLegacyModal(el, 'vocab-title', '.risk-panel');
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.vocabAct === 'close') {
				hideLegacyModal(el);
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
		showLegacyModal(modal, '#vocab-close');

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
						hideLegacyModal(modal);
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
		el.className = 'risk-modal risk-hidden';
		el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:9999;';
		el.innerHTML = `<div class="risk-backdrop" data-cp-act="close"></div>
			<div class="risk-panel" style="position:relative;background:#fff;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.2);max-width:820px;width:92%;max-height:88vh;overflow:auto;">
				<div class="risk-header"><strong id="cp-title">学习路径（章节）</strong><button type="button" id="cp-close" class="risk-close" data-cp-act="close" aria-label="关闭学习路径">×</button></div>
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
					<button type="button" id="cp-reload" class="risk-btn">刷新</button>
				</div>
				<div class="risk-body" id="cp-body" style="max-height:62vh;overflow:auto;"></div>
				<div class="risk-footer"><button type="button" class="risk-btn" data-cp-act="close">关闭</button></div>
			</div>`;
		prepareLegacyModal(el, 'cp-title', '.risk-panel');
		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.dataset.cpAct === 'close') {
				hideLegacyModal(el);
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
		showLegacyModal(modal, '#cp-close');

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
					hideLegacyModal(modal);
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
		const paperId = await requestTextInput('请输入试卷 ID（如 N4_2025_12）');
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
		const nextIdentityKey = contextIdentityKey(next);
		if (personalCenterIdentityKey !== nextIdentityKey) {
			resetPersonalCenterIdentityState();
			personalCenterIdentityKey = nextIdentityKey;
		}
		setContext({ ...next, guest: next.guest === true ? true : false });
		void buildTrigger();
		if (isOpen()) {
			void renderIdentity();
			renderSections();
			renderSectionContent();
		}
	};

	window.logoutUser = () => {
		resetPersonalCenterIdentityState();
		personalCenterIdentityKey = 'guest';
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
