export interface ExamSummary {
	id: string;
	title: string;
	questionCount: number;
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
	| 'reviewer'
	| 'orgAdmin'
	| 'systemAdmin'
	| 'superAdmin';

export type PlanId = 'free' | 'pro' | 'ultra';

export type PlanStatus = 'active' | 'trial' | 'expired' | 'canceled';

export type ScopeType = 'personal' | 'organization';

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
	entitlements: string[];
	accessible_levels: string[];
	is_active: boolean;
	user_id?: string;
}

export interface MembershipView {
	user_id: string;
	scope_type: ScopeType;
	scope_id: string;
	organization_type: OrganizationType;
	roles: RoleId[];
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
	subscription: SubscriptionView;
	features: PermissionItem[];
	sections: PermissionSection[];
}

export interface UserBalance {
	credits: number;
	updated_at: string;
	updatedAt: string;
}

export interface UserView {
	id: string;
	user_id: string;
	username: string;
	email: string;
	phone: string;
	phone_verified: boolean;
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
}

export interface MeContext {
	user: UserView;
	profile: ProfileView;
	membership: MembershipView;
	subscription: SubscriptionView;
	permissions: PermissionView;
	session: AuthSession;
}

export interface CurrentUser extends UserView {
	guest: boolean;
	token: string;
	profile: ProfileView;
	membership: MembershipView;
	permissions: PermissionView;
	session_expires_at: string;
}
