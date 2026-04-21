type JsonLike = Record<string, unknown>;

interface ApiEnvelope<T> {
	code: string;
	message: string;
	data: T;
	request_id: string;
	ts: string;
}

interface LegacyApiClientShape {
	request<T = unknown>(path: string, options?: RequestInit): Promise<T>;
	login(username: string, password: string): Promise<unknown>;
	register(username: string, password: string, email?: string | null, referralCode?: string): Promise<unknown>;
	logout(token: string): Promise<unknown>;
	sendContactChangeChallenge(token: string, channel: 'email' | 'phone'): Promise<unknown>;
	sendPhoneVerificationCode(phone: string): Promise<unknown>;
	verifyPhone(token: string, phone: string, code: string, options?: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string }): Promise<unknown>;
	sendEmailVerificationCode(token: string, email: string): Promise<unknown>;
	verifyEmail(token: string, email: string, code: string, options?: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string }): Promise<unknown>;
	verifyToken(token: string): Promise<unknown>;
	getExams(options?: { level?: string; year?: string; sort?: string }): Promise<unknown[]>;
	getExam(examId: string, userId?: string): Promise<unknown>;
	createExam(examData: unknown): Promise<unknown>;
	deleteExam(examId: string): Promise<unknown>;
	submitAnswers(userId: string, examId: string, answers: Record<string, unknown>): Promise<unknown>;
	getAnswers(userId: string, examId: string): Promise<unknown>;
	getProgress(userId: string): Promise<unknown>;
	getExamProgress(userId: string): Promise<Record<string, number>>;
	getStatistics(userId: string): Promise<unknown>;
	getWeakPoints(userId: string): Promise<unknown>;
	getLearningCurve(userId: string, days?: number): Promise<unknown>;
	getRecommendations(userId: string, limit?: number): Promise<unknown>;
	getUser(userId: string): Promise<unknown>;
	searchUsers(token: string, query: string, limit?: number): Promise<unknown[]>;
	getUsersByRole(roleId: string): Promise<unknown[]>;
	getUserPermissions(userId: string): Promise<unknown>;
	getAllRoles(): Promise<unknown>;
	getProfile(userId: string): Promise<unknown>;
	updateProfile(userId: string, patch: unknown): Promise<unknown>;
	getSubscription(scopeId: string, options?: { scopeType?: 'personal' | 'organization' }): Promise<unknown>;
	getMe(token: string): Promise<unknown>;
	getMeContext(token: string): Promise<unknown>;
	claimReferralCode(token: string, referralCode: string): Promise<unknown>;
	getMyPendingOrganizationInvitations(token: string): Promise<unknown[]>;
	getOrganizations(token: string): Promise<unknown[]>;
	getOrganization(organizationId: string, token: string): Promise<unknown>;
	createOrganization(token: string, payload: unknown): Promise<unknown>;
	getOrganizationMembers(organizationId: string, token: string): Promise<unknown[]>;
	saveOrganizationMember(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	removeOrganizationMember(organizationId: string, userId: string, token: string): Promise<unknown>;
	saveOrganizationInvitation(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	cancelOrganizationInvitation(organizationId: string, invitationId: string, token: string): Promise<unknown>;
	acceptOrganizationInvitation(token: string, inviteToken: string): Promise<unknown>;
	updateOrganizationSubscription(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	addFurigana(text: string): Promise<unknown>;
	getReading(word: string): Promise<unknown>;
}

interface Window {
	__API_BASE__?: string;
	__WEB_APP_MODE__?: boolean;
	__LOG_LEVEL__?: string;
	__FURIGANA_DICT_URL__?: string;
	__EXAMS_BY_LEVEL__?: Record<
		string,
		Array<{
			id: string;
			display: string;
			checked?: boolean;
			[key: string]: unknown;
		}>
	>;
	APIClient?: LegacyApiClientShape;
	ExamLoader?: unknown;
	ExamDataLoader?: unknown;
	ExamAPILoader?: unknown;
	UserContextManager?: unknown;
	DOMUtils?: unknown;
	DOMHelpers?: unknown;
	ErrorHandler?: unknown;
	Logger?: unknown;
	StateManager?: unknown;
	AnswerManager?: unknown;
	AudioManager?: unknown;
	FuriganaManager?: unknown;
	NavigationManager?: unknown;
	QuestionMapManager?: unknown;
	CategoryNavigationManager?: unknown;
	QuestionRenderer?: unknown;
	ExamViewer?: unknown;
	EventManager?: unknown;
	RenderManager?: unknown;
	__VIEWER_BOOTED__?: boolean;
	examViewer?: {
		loadExamData: (examData: unknown) => void;
		[key: string]: unknown;
	};
	refreshPaperSelectIcons?: () => Promise<void>;
	setUserContext?: (ctx: Record<string, unknown>) => void;
	logoutUser?: () => void;
	openPersonalCenter?: () => void;
	refreshPersonalCenterTrigger?: () => Promise<void> | void;
	getUserContext?: () => Record<string, unknown>;
	_pcDebug?: Record<string, unknown>;
	__openLoginModal?: () => void;
}

interface Document {
	__exam_category_click_registered?: boolean;
}

interface HTMLElement {
	_cleanup?: () => void;
	_dragBound?: boolean;
}

declare const module: { exports?: unknown } | undefined;
declare const vscode:
	| {
			postMessage: (payload: unknown) => void;
	  }
	| undefined;
