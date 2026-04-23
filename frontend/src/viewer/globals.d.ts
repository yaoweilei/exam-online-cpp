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
	// 错题本（业务功能 1）
	getWrongQuestions(
		userId: string,
		options?: {
			examId?: string;
			type?: string;
			status?: 'all' | 'active' | 'mastered';
			sort?: 'recent' | 'wrong_count';
			minWrong?: number;
			page?: number;
			pageSize?: number;
		}
	): Promise<unknown>;
	getWrongQuestionSummary(userId: string): Promise<unknown>;
	sampleWrongQuestions(userId: string, count?: number): Promise<unknown>;
	removeWrongQuestion(userId: string, questionId: string): Promise<unknown>;
	masterWrongQuestion(userId: string, questionId: string): Promise<unknown>;
	unmasterWrongQuestion(userId: string, questionId: string): Promise<unknown>;
	resetWrongQuestions(userId: string): Promise<unknown>;
	// 学习连续天数 / 每日目标（业务功能 2）
	getStreakSummary(userId: string): Promise<unknown>;
	getStreakHeatmap(userId: string, days?: number): Promise<unknown>;
	updateStreakDailyGoal(userId: string, dailyQuestions: number): Promise<unknown>;
	// 续考草稿（业务功能 4）
	getDraft(userId: string): Promise<unknown>;
	saveDraft(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	clearDraft(userId: string): Promise<unknown>;
	// 答题计时（业务功能 3）
	getExamTimer(userId: string): Promise<unknown>;
	startExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	tickExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	finishExamTimer(userId: string): Promise<unknown>;
	// 功能开关（横切基础设施）
	getFeatureFlagRegistry(): Promise<unknown>;
	getMyFeatureFlags(): Promise<unknown>;
	updateMyFeatureFlags(patch: Record<string, unknown>): Promise<unknown>;
	updateSystemFeatureFlags(patch: Record<string, unknown>): Promise<unknown>;
	updateOrgFeatureFlags(orgId: string, patch: Record<string, unknown>): Promise<unknown>;
	// 题目反馈/纠错（业务功能 5）
	submitFeedback(payload: Record<string, unknown>): Promise<unknown>;
	listFeedback(paperId?: string, status?: string): Promise<unknown>;
	updateFeedback(feedbackId: string, paperId: string, patch: Record<string, unknown>): Promise<unknown>;
	// 班级与作业（业务功能 6）
	createClassroom(payload: Record<string, unknown>): Promise<unknown>;
	listMyClassrooms(): Promise<unknown>;
	getClassroom(classId: string): Promise<unknown>;
	updateClassroom(classId: string, patch: Record<string, unknown>): Promise<unknown>;
	removeClassroom(classId: string): Promise<unknown>;
	addClassroomMembers(classId: string, userIds: string[]): Promise<unknown>;
	removeClassroomMember(classId: string, userId: string): Promise<unknown>;
	createAssignment(classId: string, payload: Record<string, unknown>): Promise<unknown>;
	listClassroomAssignments(classId: string): Promise<unknown>;
	listMyAssignments(): Promise<unknown>;
	updateAssignment(assignmentId: string, patch: Record<string, unknown>): Promise<unknown>;
	removeAssignment(assignmentId: string): Promise<unknown>;
	// SRS 间隔重复（业务功能 7）
	listSrsDue(userId: string, limit?: number): Promise<unknown>;
	listSrsCards(userId: string): Promise<unknown>;
	reviewSrsCard(userId: string, cardId: string, grade: number): Promise<unknown>;
	addSrsCard(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	removeSrsCard(userId: string, cardId: string): Promise<unknown>;
	// 收藏夹/分类（业务功能 8）
	listBookmarkFolders(userId: string): Promise<unknown>;
	createBookmarkFolder(userId: string, name: string, color?: string): Promise<unknown>;
	updateBookmarkFolder(userId: string, folderId: string, patch: Record<string, unknown>): Promise<unknown>;
	removeBookmarkFolder(userId: string, folderId: string): Promise<unknown>;
	addExamToBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown>;
	removeExamFromBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown>;
	// 数据导出（业务功能 10）
	exportUserData(userId: string): Promise<unknown>;
	// 管理员统计（业务功能 11）
	getAdminStatisticsOverview(): Promise<unknown>;
	// 社区讨论（业务功能 12）
	listCommunityPosts(paperId: string): Promise<unknown>;
	createCommunityPost(paperId: string, title: string, body: string): Promise<unknown>;
	deleteCommunityPost(paperId: string, postId: string): Promise<unknown>;
	addCommunityComment(paperId: string, postId: string, body: string): Promise<unknown>;
	toggleCommunityLike(paperId: string, postId: string): Promise<unknown>;
	// 审计日志可视化（业务功能 15）
	queryAuditLogs(params?: {
		orgId?: string;
		actorId?: string;
		action?: string;
		since?: string;
		until?: string;
		limit?: number;
		offset?: number;
	}): Promise<unknown>;
	listAuditLogActions(orgId?: string): Promise<unknown>;
	// 每日一练（业务功能 16）
	getDailyPractice(count?: number): Promise<unknown>;
	regenerateDailyPractice(count?: number): Promise<unknown>;
	completeDailyPracticeItem(questionId: string): Promise<unknown>;
	// 学习报告（业务功能 17）
	getLearningReport(period?: 'week' | 'month'): Promise<unknown>;
	// 备考目标 / 倒计时（业务功能 18）
	listStudyGoals(): Promise<unknown>;
	createStudyGoal(payload: Record<string, unknown>): Promise<unknown>;
	updateStudyGoal(goalId: string, payload: Record<string, unknown>): Promise<unknown>;
	deleteStudyGoal(goalId: string): Promise<unknown>;
	// 多端同步（业务功能 19）
	getSyncState(): Promise<unknown>;
	pullSync(modules?: string[]): Promise<unknown>;
	// 题目讲解附件（业务功能 20）
	listExplanationsForExam(examId: string): Promise<unknown>;
	listExplanationsForQuestion(examId: string, questionId: string): Promise<unknown>;
	addExplanation(examId: string, questionId: string, payload: Record<string, unknown>): Promise<unknown>;
	deleteExplanation(examId: string, questionId: string, explanationId: string): Promise<unknown>;
	// 排行榜（业务功能 21）
	getLeaderboard(period?: 'week' | 'month' | 'all', limit?: number, force?: boolean): Promise<unknown>;
	// 个人生词本
	listVocab(userId?: string): Promise<unknown>;
	addVocabWord(payload: { word: string; reading?: string; note?: string; examId?: string; questionId?: string; userId?: string }): Promise<unknown>;
	removeVocabWord(wordId: string, userId?: string): Promise<unknown>;
	updateVocabNote(wordId: string, note: string, userId?: string): Promise<unknown>;
	// 错因归因标签（功能 #16）
	getWrongQuestionTagRegistry(): Promise<unknown>;
	setWrongQuestionTags(userId: string, questionId: string, tags: string[]): Promise<unknown>;
	// 同考点串题（功能 #17）
	getRelatedQuestions(examId: string, questionId: string, limit?: number): Promise<unknown>;
	// 章节式学习路径（功能 #18）
	listChapters(opts?: { level?: string; userId?: string }): Promise<unknown>;
	getChapterDetail(chapterId: string, userId?: string): Promise<unknown>;
}

// 功能开关解析后的状态（与后端 FeatureFlagService::resolveOne 保持一致）
interface FeatureFlagState {
	key: string;
	enabled: boolean;
	source: 'default' | 'system' | 'org' | 'user';
	locked?: boolean;
	locked_by?: 'system' | 'org';
	allow_org_override?: boolean;
	allow_user_override?: boolean;
	organization_id?: string;
}

interface Window {
	__API_BASE__?: string;
	__WEB_APP_MODE__?: boolean;
	__LOG_LEVEL__?: string;
	__FURIGANA_DICT_URL__?: string;
	// 功能开关：登录后由 FeatureFlagsClient 写入；未登录时为 undefined
	__FEATURE_FLAGS__?: Record<string, FeatureFlagState>;
	// 全局帮助函数（在 features/featureFlags.ts 中注册）
	isFeatureEnabled?: (key: string, defaultIfMissing?: boolean) => boolean;
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
