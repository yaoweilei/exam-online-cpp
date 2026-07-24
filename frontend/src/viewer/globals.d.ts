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
	changePassword(token: string, currentPassword: string, newPassword: string): Promise<unknown>;
	sendContactChangeChallenge(token: string, channel: 'email' | 'phone'): Promise<unknown>;
	sendPhoneVerificationCode(phone: string): Promise<unknown>;
	verifyPhone(token: string, phone: string, code: string, options?: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string }): Promise<unknown>;
	sendEmailVerificationCode(token: string, email: string): Promise<unknown>;
	verifyEmail(token: string, email: string, code: string, options?: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string }): Promise<unknown>;
	verifyToken(token: string): Promise<unknown>;
	getExams(options?: { family?: string; level?: string; year?: string; sort?: string }): Promise<unknown[]>;
	getExam(examId: string, userId?: string): Promise<unknown>;
	createExam(examData: unknown): Promise<unknown>;
	updateExam(examId: string, examData: unknown): Promise<unknown>;
	deleteExam(examId: string): Promise<unknown>;
	submitAnswers(userId: string, examId: string, answers: Record<string, unknown>, submissionId?: string, attemptId?: string, examMode?: string): Promise<unknown>;
	getAnswerAttempts(userId: string, examId: string, limit?: number): Promise<unknown>;
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
	listPlatformRoleTemplates(token: string): Promise<unknown>;
	previewPlatformRoleTemplate(token: string, roleId: string, payload: unknown): Promise<unknown>;
	updatePlatformRoleTemplate(token: string, roleId: string, payload: unknown): Promise<unknown>;
	getPlatformUserAccess(token: string, userId: string): Promise<unknown>;
	previewPlatformUserAccess(token: string, userId: string, payload: unknown): Promise<unknown>;
	updatePlatformUserAccess(token: string, userId: string, payload: unknown): Promise<unknown>;
	listContentWorkflow(token: string): Promise<unknown>;
	inspectContentWorkflow(token: string, examId: string): Promise<unknown>;
	reviewContentWorkflow(token: string, examId: string, stage: string, payload: unknown): Promise<unknown>;
	publishContentWorkflow(token: string, examId: string, payload: unknown): Promise<unknown>;
	listContentVersions(token: string, examId: string): Promise<unknown>;
	rollbackContentVersion(token: string, examId: string, versionId: string, payload: unknown): Promise<unknown>;
	getProfile(userId: string): Promise<unknown>;
	updateProfile(userId: string, patch: unknown): Promise<unknown>;
	listRecentLearning(userId: string, limit?: number): Promise<unknown>;
	getSubscription(scopeId: string, options?: { scopeType?: 'personal' | 'organization' }): Promise<unknown>;
	getMe(token: string): Promise<unknown>;
	getMeContext(token: string): Promise<unknown>;
	bindWechat(token: string, code: string): Promise<unknown>;
	deleteAccount(token: string, confirmation: string, phone: string, phoneCode: string, reason?: string): Promise<unknown>;
	claimReferralCode(token: string, referralCode: string): Promise<unknown>;
	getMyWallet(token: string): Promise<unknown>;
	redeemCode(token: string, code: string): Promise<unknown>;
	getMyPendingOrganizationInvitations(token: string): Promise<unknown[]>;
	getOrganizations(token: string, options?: Record<string, string | number>): Promise<unknown>;
	getOrganization(organizationId: string, token: string): Promise<unknown>;
	createOrganization(token: string, payload: unknown): Promise<unknown>;
	getOrganizationMembers(organizationId: string, token: string, options?: Record<string, string | number>): Promise<unknown>;
	saveOrganizationMember(organizationId: string, token: string, payload: unknown, reauthPassword: string): Promise<unknown>;
	removeOrganizationMember(organizationId: string, userId: string, token: string, reauthPassword: string): Promise<unknown>;
	saveOrganizationRolePermissions(organizationId: string, roleId: string, token: string, payload: unknown, reauthPassword: string): Promise<unknown>;
	getOrganizationCampuses(organizationId: string, token: string, options?: Record<string, string | number>): Promise<unknown>;
	saveOrganizationCampus(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	getOrganizationLearningGroups(organizationId: string, token: string, options?: Record<string, string | number>): Promise<unknown>;
	saveOrganizationLearningGroup(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	getOrganizationCoursePackages(organizationId: string, token: string, options?: Record<string, string | number>): Promise<unknown>;
	saveOrganizationCoursePackage(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	saveLearningGroupEnrollment(organizationId: string, learningGroupId: string, token: string, payload: unknown): Promise<unknown>;
	completeOrganizationLearningGroup(organizationId: string, learningGroupId: string, token: string, payload?: unknown): Promise<unknown>;
	saveOrganizationInvitation(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	cancelOrganizationInvitation(organizationId: string, invitationId: string, token: string): Promise<unknown>;
	acceptOrganizationInvitation(token: string, inviteToken: string): Promise<unknown>;
	updateOrganizationSubscription(organizationId: string, token: string, payload: unknown): Promise<unknown>;
	updateUserSubscription(userId: string, token: string, payload: unknown): Promise<unknown>;
	createPaymentOrder(token: string, payload: unknown): Promise<unknown>;
	getPaymentPricing(): Promise<unknown>;
	updatePaymentPricing(token: string, payload: unknown): Promise<unknown>;
	getPaymentOrder(token: string, orderId: string): Promise<unknown>;
	listPaymentLedger(token: string, userId?: string): Promise<unknown>;
	requestPaymentRefund(token: string, payload: unknown): Promise<unknown>;
	listAdminPaymentOrders(token: string, filters?: Record<string, string | number>): Promise<unknown>;
	listAdminPaymentRefunds(token: string, filters?: Record<string, string | number>): Promise<unknown>;
	listAdminPaymentLedger(token: string, filters?: Record<string, string | number>): Promise<unknown>;
	getAdminPaymentReconciliation(token: string): Promise<unknown>;
	createOrganizationPaymentOrder(token: string, payload: unknown): Promise<unknown>;
	updatePaymentRefundStatus(token: string, refundId: string, payload: unknown): Promise<unknown>;
	getInstitutionDashboard(token: string, orgId?: string): Promise<unknown>;
	getInstitutionWorkbench(token: string, orgId?: string): Promise<unknown>;
	getInstitutionPlans(): Promise<unknown>;
	getInstitutionLearningGroupGradebook(token: string, organizationId: string, learningGroupId: string): Promise<unknown>;
	updateInstitutionSchedule(token: string, organizationId: string, learningGroupId: string, payload: Record<string, unknown>): Promise<unknown>;
	getInstitutionStudentProfile(token: string, studentId: string): Promise<unknown>;
	addInstitutionTeacherNote(token: string, studentId: string, text: string): Promise<unknown>;
	createLessonPrep(token: string, payload: unknown): Promise<unknown>;
	listLessonPrepPlans(token: string, orgId?: string): Promise<unknown>;
	saveLessonPrepPlan(token: string, payload: unknown): Promise<unknown>;
	previewInstitutionImport(token: string, payload: unknown): Promise<unknown>;
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
	resetWrongQuestions(userId: string, confirmation: string): Promise<unknown>;
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
	getSystemFeatureFlags(): Promise<unknown>;
	updateMyFeatureFlags(patch: Record<string, unknown>): Promise<unknown>;
	updateSystemFeatureFlags(patch: Record<string, unknown>, reauthPassword: string): Promise<unknown>;
	updateOrgFeatureFlags(orgId: string, patch: Record<string, unknown>, reauthPassword: string): Promise<unknown>;
	// 题目反馈/纠错（业务功能 5）
	submitFeedback(payload: Record<string, unknown>): Promise<unknown>;
	listFeedback(paperId?: string, status?: string, options?: Record<string, string | number>): Promise<unknown>;
	updateFeedback(feedbackId: string, paperId: string, patch: Record<string, unknown>): Promise<unknown>;
	// 学习组作业（业务功能 6）
	createLearningGroupAssignment(organizationId: string, learningGroupId: string, payload: Record<string, unknown>): Promise<unknown>;
	listLearningGroupAssignments(organizationId: string, learningGroupId: string): Promise<unknown>;
	listMyAssignments(): Promise<unknown>;
	getAssignment(assignmentId: string): Promise<unknown>;
	submitAssignment(assignmentId: string, answers: Record<string, unknown>): Promise<unknown>;
	getAssignmentSubmissions(assignmentId: string): Promise<unknown>;
	reviewAssignmentSubmission(assignmentId: string, studentId: string, payload: Record<string, unknown>): Promise<unknown>;
	remindAssignment(assignmentId: string, payload: Record<string, unknown>): Promise<unknown>;
	updateAssignment(assignmentId: string, patch: Record<string, unknown>): Promise<unknown>;
	removeAssignment(assignmentId: string): Promise<unknown>;
	// SRS 间隔重复（业务功能 7）
	listSrsDue(userId: string, limit?: number): Promise<unknown>;
	listSrsCards(userId: string): Promise<unknown>;
	reviewSrsCard(userId: string, cardId: string, grade: number): Promise<unknown>;
	addSrsCard(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	removeSrsCard(userId: string, cardId: string): Promise<unknown>;
	// 收藏夹/分类（业务功能 8）
	getBookmarks(userId: string): Promise<unknown>;
	addQuestionBookmark(userId: string, payload: Record<string, unknown>): Promise<unknown>;
	removeQuestionBookmark(userId: string, bookmarkId: string): Promise<unknown>;
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
	pushSync(payload: Record<string, unknown>): Promise<unknown>;
	getSyncDevices(): Promise<unknown>;
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
	listChapters(opts?: { family?: string; level?: string; userId?: string }): Promise<unknown>;
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
	__ENABLED_EXAM_FAMILIES__?: string[] | string;
	// 功能开关：登录后由 FeatureFlagsClient 写入；未登录时为 undefined
	__FEATURE_FLAGS__?: Record<string, FeatureFlagState>;
	// 全局帮助函数（在 features/featureFlags.ts 中注册）
	isFeatureEnabled?: (key: string, defaultIfMissing?: boolean) => boolean;
	__EXAMS_BY_LEVEL__?: Record<
		string,
		Array<{
			id: string;
			family?: string;
			display: string;
			checked?: boolean;
			[key: string]: unknown;
		}>
	>;
	__EXAMS_BY_FAMILY__?: Record<
		string,
		Record<
			string,
			Array<{
				id: string;
				family?: string;
				display: string;
				checked?: boolean;
				[key: string]: unknown;
			}>
		>
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
	NavigationManager?: unknown;
	ExamTimerManager?: unknown;
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
	openRechargePanel?: () => void;
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
