export interface ExamSummary {
	id: string;
	title: string;
	questionCount: number;
	family?: string;
	subject?: string;
	paper_type?: string;
	level: string;
	year: string;
	session: string;
	display: string;
	checked?: boolean;
	access_level?: string;
}

export interface ExamDetail {
	exam_info: Record<string, unknown>;
	[key: string]: unknown;
}

export interface SubmitAnswerRequest {
	user_id: string;
	exam_id: string;
	answers: Record<string, string>;
}

export interface ScoreResult {
	exam_id: string;
	total_questions: number;
	correct_count: number;
	wrong_count: number;
	unanswered_count: number;
	score: number;
	accuracy: number;
	completion: number;
	results: Record<string, unknown>;
	timestamp: string;
}

export interface UserStatistics {
	user_id: string;
	total_exams: number;
	total_questions: number;
	correct_answers: number;
	wrong_answers: number;
	overall_accuracy: number;
	average_score: number;
	exams: Array<Record<string, unknown>>;
}

export interface WeakPoint {
	section: string;
	total_questions: number;
	wrong_count: number;
	error_rate: number;
}

export interface LearningCurvePoint {
	date: string;
	exams_count: number;
	questions_count: number;
	correct_count: number;
	average_score: number;
}

export interface RecommendationItem {
	exam_id: string;
	reason: string;
	score: number;
}

export type RoleId =
	| 'guest'
	| 'student'
	| 'teacher'
	| 'assistant'
	| 'orgAdmin'
	| 'contentAdmin'
	| 'superAdmin';

export type PlanId = 'free' | 'pro' | 'ultra';

export type PlanStatus = 'active' | 'trial' | 'expired' | 'canceled';

export type ScopeType = 'personal' | 'learningGroup' | 'campus' | 'organization' | 'platform';

export type OrganizationType = '' | 'business' | 'school';

export interface AuthSession {
	user_id: string;
	username: string;
	roles: RoleId[];
	token?: string;
	expires_at?: string;
}

export interface ProfileView {
	user_id: string;
	display_name: string;
	avatar_url: string;
	locale: string;
	goal_level: string;
	goal_date: string;
	daily_target: number;
	streak_days: number;
	longest_streak: number;
	last_active_at: string;
	xp: number;
	credits: number;
	scope_type: ScopeType;
	scope_id: string;
	organization_type: OrganizationType;
	plan: PlanId;
	plan_status: PlanStatus;
	plan_expires_at: string;
	notification_enabled: boolean;
}

export interface SubscriptionView {
	scope_type: ScopeType;
	scope_id: string;
	organization_type: OrganizationType;
	plan: PlanId;
	status: PlanStatus;
	expires_at: string;
	seats?: number;
	entitlements: string[];
	entitlement_access: Record<string, {
		granted: boolean;
		required_plan: PlanId;
	}>;
	accessible_levels: string[];
	is_active: boolean;
	effective_plan: PlanId;
	user_id?: string;
}

export interface MembershipView {
	membership_id?: string;
	user_id: string;
	scope_type: ScopeType;
	scope_id: string;
	organization_type: OrganizationType;
	roles: RoleId[];
	permission_templates?: PermissionTemplateId[];
	permissionTemplates?: PermissionTemplateId[];
	permission_overrides?: PermissionOverrideView[];
	permissionOverrides?: PermissionOverrideView[];
	member_no?: string;
	memberNo?: string;
	student_no?: string;
	studentNo?: string;
	employee_no?: string;
	employeeNo?: string;
	joined_at?: string;
	organization_id?: string;
	organization_name?: string;
	username?: string;
	status?: string;
}

export type PermissionTemplateId = 'assistant' | 'homeroom' | 'teachingOffice' | 'consultant' | 'campusAdmin';

export interface PermissionOverrideView {
	permission: string;
	effect: 'allow' | 'deny';
	scope: Exclude<ScopeType, 'platform'>;
	scope_id?: string;
	scopeId?: string;
	expires_at?: string;
	expiresAt?: string;
}

export interface OrganizationInvitationView {
	invitation_id: string;
	invite_code: string;
	organization_id: string;
	organization_name?: string;
	channel: 'email' | 'phone';
	contact: string;
	email?: string;
	phone?: string;
	target_user_id?: string;
	status: 'pending' | 'accepted' | 'cancelled';
	roles: RoleId[];
	permission_templates?: PermissionTemplateId[];
	permission_overrides?: PermissionOverrideView[];
	member_no?: string;
	student_no?: string;
	employee_no?: string;
	message?: string;
	created_by: string;
	created_at: string;
	expires_at: string;
	accepted_by?: string;
	accepted_at?: string;
	cancelled_by?: string;
	cancelled_at?: string;
	delivery_status?: 'pending' | 'sent' | 'failed';
	delivery_provider?: string;
	delivery_message_id?: string;
	delivery_error?: string;
	delivered_at?: string;
}

export interface OrganizationAuditLogView {
	audit_id: string;
	action: string;
	summary: string;
	actor_user_id: string;
	actor_username?: string;
	created_at: string;
	details?: Record<string, unknown>;
}

export interface PendingOrganizationInvitationView extends OrganizationInvitationView {
	organization_type?: string;
	created_by_username?: string;
	contact_matches: boolean;
	contact_verified: boolean;
	can_accept: boolean;
	is_expired: boolean;
	accept_block_code?: string;
	accept_block_message?: string;
	accept_url?: string;
}

export interface OrganizationView {
	organization_id: string;
	scope_type: 'organization';
	scope_id: string;
	name: string;
	organization_type: Exclude<OrganizationType, ''>;
	created_by: string;
	created_at: string;
	updated_at: string;
	member_count: number;
	seats: number;
	subscription: SubscriptionView;
	invitations?: OrganizationInvitationView[];
	audit_logs?: OrganizationAuditLogView[];
}

export interface PermissionItem {
	id: string;
	title: string;
	icon?: string;
}

export interface PermissionSection {
	id: string;
	title: string;
}

export interface PermissionView {
	user_id: string;
	roles: RoleId[];
	permission_overrides?: PermissionOverrideView[];
	subscription: SubscriptionView;
	features: PermissionItem[];
	sections: PermissionSection[];
}

export interface UserBalance {
	credits: number;
	updated_at: string;
	updatedAt: string;
}

export interface ReferralView {
	code: string;
	referral_code: string;
	referred_by_user_id?: string;
	referredByUserId?: string;
	referred_by_code?: string;
	referredByCode?: string;
	bound_at?: string;
	boundAt?: string;
	reward_status: 'none' | 'pending' | 'granted' | 'rejected';
	rewardStatus?: 'none' | 'pending' | 'granted' | 'rejected';
	reward_granted_at?: string;
	rewardGrantedAt?: string;
	reward_trigger?: string;
	rewardTrigger?: string;
	reward_credit_amount?: number;
	rewardCreditAmount?: number;
	reward_credit_recipient_user_id?: string;
	rewardCreditRecipientUserId?: string;
	has_referrer: boolean;
	hasReferrer?: boolean;
}

export interface UserView {
	id: string;
	user_id: string;
	username: string;
	member_no?: string;
	memberNo?: string;
	student_no?: string;
	studentNo?: string;
	employee_no?: string;
	employeeNo?: string;
	dev_login_id?: string;
	email: string;
	email_verified: boolean;
	phone: string;
	phone_verified: boolean;
	has_password?: boolean;
	hasPassword?: boolean;
	wechat_bound?: boolean;
	wechatBound?: boolean;
	wechat_nickname?: string;
	wechat_bound_at?: string;
	status: string;
	created_at: string;
	roles: RoleId[];
	role_ids: RoleId[];
	roleIds: RoleId[];
	display_name: string;
	displayName: string;
	avatar_url: string;
	avatar: string;
	locale: string;
	goal_level: string;
	goal_date: string;
	daily_target: number;
	last_active_at: string;
	lastLoginAt: string;
	scope_type: ScopeType;
	scope_id: string;
	organization_type: OrganizationType;
	subscription: SubscriptionView;
	plan: PlanId;
	plan_status: PlanStatus;
	plan_expires_at: string;
	entitlements: string[];
	accessible_levels: string[];
	accessibleLevels: string[];
	balance: UserBalance;
	referral: ReferralView;
}

export interface MeContext {
	user: UserView;
	profile: ProfileView;
	membership: MembershipView;
	subscription: SubscriptionView;
	permissions: PermissionView;
	session: AuthSession;
	memberships?: MembershipView[];
	organizations?: OrganizationView[];
}

export interface CurrentUser extends UserView {
	guest: boolean;
	token: string;
	profile: ProfileView;
	membership: MembershipView;
	permissions: PermissionView;
	session_expires_at: string;
}
