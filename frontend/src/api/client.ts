import { requestApi, readStoredUserId } from './runtime.js';

export class ApiClient {
	constructor(private readonly baseUrl: string = '/api/v1') {}

	async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		return requestApi<T>(path, options, this.baseUrl);
	}

	getExams(options: { family?: string; level?: string; year?: string; sort?: string } = {}): Promise<unknown[]> {
		const params = new URLSearchParams();
		if (options.family) params.append('family', options.family);
		if (options.level) params.append('level', options.level);
		if (options.year) params.append('year', options.year);
		if (options.sort) params.append('sort', options.sort);
		const query = params.toString();
		return this.request(`/exams${query ? `?${query}` : ''}`);
	}

	getExam(examId: string, userId?: string): Promise<unknown> {
		const effectiveUserId = userId ?? readStoredUserId();
		const query = effectiveUserId ? `?user_id=${encodeURIComponent(effectiveUserId)}` : '';
		return this.request(`/exams/${examId}${query}`);
	}

	getUser(userId: string): Promise<unknown> {
		return this.request(`/users/${userId}`);
	}

	searchUsers(token: string, query: string, limit = 12): Promise<unknown[]> {
		const params = new URLSearchParams({ token, q: query, limit: String(limit) });
		return this.request(`/users/search?${params.toString()}`);
	}

	getUsersByRole(roleId: string): Promise<unknown[]> {
		return this.request(`/users/by-role/${roleId}`);
	}

	getUserPermissions(userId: string): Promise<unknown> {
		return this.request(`/users/${userId}/permissions`);
	}

	getAllRoles(): Promise<unknown> {
		return this.request('/roles');
	}

	getProfile(userId: string): Promise<unknown> {
		return this.request(`/profile/${userId}`);
	}

	updateProfile(userId: string, patch: unknown): Promise<unknown> {
		return this.request(`/profile/${userId}`, {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	logout(token: string): Promise<unknown> {
		return this.request('/auth/logout', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
	}

	changePassword(token: string, currentPassword: string, newPassword: string): Promise<unknown> {
		return this.request('/auth/password/change', {
			method: 'POST',
			body: JSON.stringify({
				token,
				current_password: currentPassword,
				new_password: newPassword
			})
		});
	}

	sendContactChangeChallenge(token: string, channel: 'email' | 'phone'): Promise<unknown> {
		return this.request('/auth/contact-change/send-code', {
			method: 'POST',
			body: JSON.stringify({ token, channel })
		});
	}

	sendPhoneVerificationCode(phone: string): Promise<unknown> {
		return this.request('/auth/phone/send-code', {
			method: 'POST',
			body: JSON.stringify({ phone })
		});
	}

	verifyPhone(
		token: string,
		phone: string,
		code: string,
		options: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string } = {}
	): Promise<unknown> {
		return this.request('/auth/phone/verify', {
			method: 'POST',
			body: JSON.stringify({
				token,
				phone,
				code,
				change_challenge_channel: options.changeChallengeChannel || '',
				change_challenge_code: options.changeChallengeCode || ''
			})
		});
	}

	sendEmailVerificationCode(token: string, email: string): Promise<unknown> {
		return this.request('/auth/email/send-code', {
			method: 'POST',
			body: JSON.stringify({ token, email })
		});
	}

	verifyEmail(
		token: string,
		email: string,
		code: string,
		options: { changeChallengeChannel?: 'email' | 'phone'; changeChallengeCode?: string } = {}
	): Promise<unknown> {
		return this.request('/auth/email/verify', {
			method: 'POST',
			body: JSON.stringify({
				token,
				email,
				code,
				change_challenge_channel: options.changeChallengeChannel || '',
				change_challenge_code: options.changeChallengeCode || ''
			})
		});
	}

	getSubscription(scopeId: string, options: { scopeType?: 'personal' | 'organization' } = {}): Promise<unknown> {
		const params = new URLSearchParams();
		if (options.scopeType) {
			params.append('scope_type', options.scopeType);
		}
		const query = params.toString();
		return this.request(`/subscription/${scopeId}${query ? `?${query}` : ''}`);
	}

	getMe(token: string): Promise<unknown> {
		return this.request(`/me?token=${encodeURIComponent(token)}`);
	}

	getMeContext(token: string): Promise<unknown> {
		return this.request(`/me/context?token=${encodeURIComponent(token)}`);
	}

	claimReferralCode(token: string, referralCode: string): Promise<unknown> {
		return this.request('/me/referral/claim', {
			method: 'POST',
			body: JSON.stringify({ token, referral_code: referralCode })
		});
	}

	getMyWallet(token: string): Promise<unknown> {
		return this.request(`/me/wallet?token=${encodeURIComponent(token)}`);
	}

	redeemCode(token: string, code: string): Promise<unknown> {
		return this.request('/me/redeem', {
			method: 'POST',
			body: JSON.stringify({ token, code })
		});
	}

	getMyPendingOrganizationInvitations(token: string): Promise<unknown[]> {
		return this.request(`/me/invitations?token=${encodeURIComponent(token)}`);
	}

	getOrganizations(token: string): Promise<unknown[]> {
		return this.request(`/organizations?token=${encodeURIComponent(token)}`);
	}

	getOrganization(organizationId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}?token=${encodeURIComponent(token)}`);
	}

	createOrganization(token: string, payload: unknown): Promise<unknown> {
		return this.request('/organizations', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	getOrganizationMembers(organizationId: string, token: string): Promise<unknown[]> {
		return this.request(`/organizations/${organizationId}/members?token=${encodeURIComponent(token)}`);
	}

	saveOrganizationMember(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	removeOrganizationMember(organizationId: string, userId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members/${userId}?token=${encodeURIComponent(token)}`, {
			method: 'DELETE'
		});
	}

	getOrganizationCampuses(organizationId: string, token: string): Promise<unknown[]> {
		return this.request(`/organizations/${organizationId}/campuses?token=${encodeURIComponent(token)}`);
	}

	saveOrganizationCampus(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/campuses`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	getOrganizationLearningGroups(organizationId: string, token: string): Promise<unknown[]> {
		return this.request(`/organizations/${organizationId}/learning-groups?token=${encodeURIComponent(token)}`);
	}

	saveOrganizationLearningGroup(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	getOrganizationCoursePackages(organizationId: string, token: string): Promise<unknown[]> {
		return this.request(`/organizations/${organizationId}/course-packages?token=${encodeURIComponent(token)}`);
	}

	saveOrganizationCoursePackage(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/course-packages`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	saveLearningGroupEnrollment(organizationId: string, learningGroupId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups/${learningGroupId}/enrollments`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	completeOrganizationLearningGroup(organizationId: string, learningGroupId: string, token: string, payload: unknown = {}): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups/${learningGroupId}/complete`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	saveOrganizationInvitation(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/invitations`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	cancelOrganizationInvitation(organizationId: string, invitationId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/invitations/${invitationId}?token=${encodeURIComponent(token)}`, {
			method: 'DELETE'
		});
	}

	acceptOrganizationInvitation(token: string, inviteToken: string): Promise<unknown> {
		return this.request('/organizations/invitations/accept', {
			method: 'POST',
			body: JSON.stringify({ token, invite_token: inviteToken })
		});
	}

	updateOrganizationSubscription(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/subscription/${organizationId}/grant`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, scope_type: 'organization' })
		});
	}

	updateUserSubscription(userId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/subscription/${userId}/grant`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, scope_type: 'personal' })
		});
	}

	createPaymentOrder(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/orders', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	getPaymentOrder(token: string, orderId: string): Promise<unknown> {
		return this.request(`/payments/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`);
	}

	listPaymentLedger(token: string, userId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (userId) query.set('user_id', userId);
		return this.request(`/payments/ledger?${query.toString()}`);
	}

	requestPaymentRefund(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/refunds', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	getInstitutionDashboard(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/dashboard?${query.toString()}`);
	}

	getInstitutionWorkbench(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/workbench?${query.toString()}`);
	}

	getInstitutionPlans(): Promise<unknown> {
		return this.request('/institution/plans');
	}

	getInstitutionLearningGroupGradebook(token: string, organizationId: string, learningGroupId: string): Promise<unknown> {
		return this.request(`/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/gradebook?token=${encodeURIComponent(token)}`);
	}

	getInstitutionStudentProfile(token: string, studentId: string): Promise<unknown> {
		return this.request(`/institution/students/${encodeURIComponent(studentId)}?token=${encodeURIComponent(token)}`);
	}

	createLessonPrep(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/lesson-prep', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	listLessonPrepPlans(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/lesson-prep/plans?${query.toString()}`);
	}

	saveLessonPrepPlan(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/lesson-prep/plans', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	previewInstitutionImport(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/import-preview', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	// ---------------------------------------------------------------------
	// 错题本 API（业务功能 1）
	// ---------------------------------------------------------------------

	// 拉取错题列表（支持筛选）
	getWrongQuestions(
		userId: string,
		options: {
			examId?: string;
			type?: string;
			status?: 'all' | 'active' | 'mastered';
			sort?: 'recent' | 'wrong_count';
			minWrong?: number;
			page?: number;
			pageSize?: number;
		} = {}
	): Promise<unknown> {
		const params = new URLSearchParams();
		if (options.examId) params.append('exam_id', options.examId);
		if (options.type) params.append('type', options.type);
		if (options.status) params.append('status', options.status);
		if (options.sort) params.append('sort', options.sort);
		if (typeof options.minWrong === 'number') params.append('min_wrong', String(options.minWrong));
		if (typeof options.page === 'number') params.append('page', String(options.page));
		if (typeof options.pageSize === 'number') params.append('page_size', String(options.pageSize));
		const query = params.toString();
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}${query ? `?${query}` : ''}`);
	}

	// 仅取统计摘要（个人中心徽标）
	getWrongQuestionSummary(userId: string): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/summary`);
	}

	// 随机抽取若干道错题用于复习
	sampleWrongQuestions(userId: string, count = 10): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/sample`, {
			method: 'POST',
			body: JSON.stringify({ count })
		});
	}

	// 删除单题
	removeWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}`,
			{ method: 'DELETE' }
		);
	}

	// 标记已掌握
	masterWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}/master`,
			{ method: 'POST', body: '{}' }
		);
	}

	// 取消已掌握
	unmasterWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}/unmaster`,
			{ method: 'POST', body: '{}' }
		);
	}

	// 清空错题本
	resetWrongQuestions(userId: string): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/reset`, {
			method: 'POST',
			body: '{}'
		});
	}

	// ---------------------------------------------------------------------
	// 学习连续天数 / 每日目标 API（业务功能 2）
	// ---------------------------------------------------------------------

	getStreakSummary(userId: string): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/summary`);
	}

	getStreakHeatmap(userId: string, days = 90): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/heatmap?days=${days}`);
	}

	updateStreakDailyGoal(userId: string, dailyQuestions: number): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/goal`, {
			method: 'PUT',
			body: JSON.stringify({ daily_questions: dailyQuestions })
		});
	}

	// ---------------------------------------------------------------------
	// 续考草稿 API（业务功能 4）
	// ---------------------------------------------------------------------

	getDraft(userId: string): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`);
	}

	saveDraft(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	clearDraft(userId: string): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`, { method: 'DELETE' });
	}

	// ---------------------------------------------------------------------
	// 答题计时 API（业务功能 3：答题计时与分段限时）
	// ---------------------------------------------------------------------

	getExamTimer(userId: string): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}`);
	}

	startExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/start`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	tickExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/tick`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	finishExamTimer(userId: string): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/finish`, { method: 'POST' });
	}

	// ---------------------------------------------------------------------
	// 功能开关 API（横切基础设施）
	// ---------------------------------------------------------------------

	getFeatureFlagRegistry(): Promise<unknown> {
		return this.request('/feature-flags/registry');
	}

	getMyFeatureFlags(): Promise<unknown> {
		return this.request('/me/feature-flags');
	}

	updateMyFeatureFlags(patch: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/feature-flags', {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	updateSystemFeatureFlags(patch: Record<string, unknown>): Promise<unknown> {
		return this.request('/admin/feature-flags/system', {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	updateOrgFeatureFlags(orgId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/admin/feature-flags/orgs/${encodeURIComponent(orgId)}`, {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	// ---------------------------------------------------------------------
	// 题目反馈/纠错 API（业务功能 5）
	// ---------------------------------------------------------------------

	submitFeedback(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/feedback', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	listFeedback(paperId?: string, status?: string): Promise<unknown> {
		const qs = new URLSearchParams();
		if (paperId) qs.append('paper_id', paperId);
		if (status) qs.append('status', status);
		const suffix = qs.toString() ? `?${qs.toString()}` : '';
		return this.request(`/feedback${suffix}`);
	}

	updateFeedback(feedbackId: string, paperId: string, patch: Record<string, unknown>): Promise<unknown> {
		const qs = paperId ? `?paper_id=${encodeURIComponent(paperId)}` : '';
		return this.request(`/feedback/${encodeURIComponent(feedbackId)}${qs}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	// ---------------------------------------------------------------------
	// 学习组作业 API（业务功能 6）
	// ---------------------------------------------------------------------

	createLearningGroupAssignment(organizationId: string, learningGroupId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	listLearningGroupAssignments(organizationId: string, learningGroupId: string): Promise<unknown> {
		return this.request(`/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`);
	}

	listMyAssignments(): Promise<unknown> {
		return this.request('/me/assignments');
	}

	getAssignment(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`);
	}

	submitAssignment(assignmentId: string, answers: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/submit`, {
			method: 'POST',
			body: JSON.stringify({ answers })
		});
	}

	getAssignmentSubmissions(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/submissions`);
	}

	remindAssignment(assignmentId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	updateAssignment(assignmentId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	removeAssignment(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
	}

	// ---------------------------------------------------------------------
	// SRS 间隔重复 API（业务功能 7）
	// ---------------------------------------------------------------------

	listSrsDue(userId: string, limit = 20): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/due?limit=${limit}`);
	}

	listSrsCards(userId: string): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards`);
	}

	reviewSrsCard(userId: string, cardId: string, grade: number): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/review`, {
			method: 'POST',
			body: JSON.stringify({ card_id: cardId, grade })
		});
	}

	addSrsCard(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	removeSrsCard(userId: string, cardId: string): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards/${encodeURIComponent(cardId)}`, {
			method: 'DELETE'
		});
	}

	// ---------------------------------------------------------------------
	// 收藏夹/分类 API（业务功能 8）
	// ---------------------------------------------------------------------

	getBookmarks(userId: string): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}`);
	}

	addQuestionBookmark(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}/questions`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	removeQuestionBookmark(userId: string, bookmarkId: string): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}/questions/${encodeURIComponent(bookmarkId)}`, {
			method: 'DELETE'
		});
	}

	listBookmarkFolders(userId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}`);
	}

	createBookmarkFolder(userId: string, name: string, color?: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}`, {
			method: 'POST',
			body: JSON.stringify({ name, color: color || '' })
		});
	}

	updateBookmarkFolder(userId: string, folderId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	removeBookmarkFolder(userId: string, folderId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}`, {
			method: 'DELETE'
		});
	}

	addExamToBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}/exams`, {
			method: 'POST',
			body: JSON.stringify({ exam_id: examId })
		});
	}

	removeExamFromBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown> {
		return this.request(
			`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}/exams/${encodeURIComponent(examId)}`,
			{ method: 'DELETE' }
		);
	}

	// ---------------------------------------------------------------------
	// 数据导出（业务功能 10）
	// ---------------------------------------------------------------------

	exportUserData(userId: string): Promise<unknown> {
		return this.request(`/data-export/${encodeURIComponent(userId)}`);
	}

	// ---------------------------------------------------------------------
	// 管理员统计（业务功能 11）
	// ---------------------------------------------------------------------

	getAdminStatisticsOverview(): Promise<unknown> {
		return this.request('/admin/statistics/overview');
	}

	// ---------------------------------------------------------------------
	// 社区讨论（业务功能 12）
	// ---------------------------------------------------------------------

	listCommunityPosts(paperId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}`);
	}

	createCommunityPost(paperId: string, title: string, body: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts`, {
			method: 'POST',
			body: JSON.stringify({ title, body })
		});
	}

	deleteCommunityPost(paperId: string, postId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}`, {
			method: 'DELETE'
		});
	}

	addCommunityComment(paperId: string, postId: string, body: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body })
		});
	}

	toggleCommunityLike(paperId: string, postId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}/like`, {
			method: 'POST'
		});
	}

	// ---------------------------------------------------------------------
	// 审计日志可视化（业务功能 15）
	// ---------------------------------------------------------------------

	queryAuditLogs(params: {
		orgId?: string;
		actorId?: string;
		action?: string;
		since?: string;
		until?: string;
		limit?: number;
		offset?: number;
	} = {}): Promise<unknown> {
		const qs = new URLSearchParams();
		if (params.orgId) qs.set('org_id', params.orgId);
		if (params.actorId) qs.set('actor_id', params.actorId);
		if (params.action) qs.set('action', params.action);
		if (params.since) qs.set('since', params.since);
		if (params.until) qs.set('until', params.until);
		if (params.limit != null) qs.set('limit', String(params.limit));
		if (params.offset != null) qs.set('offset', String(params.offset));
		const suffix = qs.toString() ? `?${qs.toString()}` : '';
		return this.request(`/admin/audit-logs${suffix}`);
	}

	listAuditLogActions(orgId?: string): Promise<unknown> {
		const suffix = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
		return this.request(`/admin/audit-logs/actions${suffix}`);
	}

	// ---------------------------------------------------------------------
	// 每日一练（业务功能 16）
	// ---------------------------------------------------------------------

	getDailyPractice(count?: number): Promise<unknown> {
		const suffix = count ? `?count=${count}` : '';
		return this.request(`/me/daily-practice${suffix}`);
	}

	regenerateDailyPractice(count?: number): Promise<unknown> {
		return this.request('/me/daily-practice/regenerate', {
			method: 'POST',
			body: JSON.stringify(count ? { count } : {})
		});
	}

	completeDailyPracticeItem(questionId: string): Promise<unknown> {
		return this.request('/me/daily-practice/complete', {
			method: 'POST',
			body: JSON.stringify({ question_id: questionId })
		});
	}

	// ---------------------------------------------------------------------
	// 学习报告（业务功能 17）
	// ---------------------------------------------------------------------

	getLearningReport(period: 'week' | 'month' = 'week'): Promise<unknown> {
		return this.request(`/me/learning-report?period=${encodeURIComponent(period)}`);
	}

	// ---------------------------------------------------------------------
	// 备考目标 / 倒计时（业务功能 18）
	// ---------------------------------------------------------------------

	listStudyGoals(): Promise<unknown> {
		return this.request('/me/study-goals');
	}

	createStudyGoal(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/study-goals', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	updateStudyGoal(goalId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/me/study-goals/${encodeURIComponent(goalId)}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
	}

	deleteStudyGoal(goalId: string): Promise<unknown> {
		return this.request(`/me/study-goals/${encodeURIComponent(goalId)}`, {
			method: 'DELETE'
		});
	}

	// ---------------------------------------------------------------------
	// 多端同步（业务功能 19）
	// ---------------------------------------------------------------------

	getSyncState(): Promise<unknown> {
		return this.request('/me/sync/state');
	}

	pullSync(modules?: string[]): Promise<unknown> {
		const qs = modules && modules.length > 0 ? `?modules=${encodeURIComponent(modules.join(','))}` : '';
		return this.request(`/me/sync/pull${qs}`);
	}

	pushSync(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/sync/push', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	getSyncDevices(): Promise<unknown> {
		return this.request('/me/sync/devices');
	}

	// ---------------------------------------------------------------------
	// 排行榜（业务功能 21）
	// ---------------------------------------------------------------------

	getLeaderboard(period: 'week' | 'month' | 'all' = 'week', limit: number = 20, force: boolean = false): Promise<unknown> {
		const qs = `?period=${encodeURIComponent(period)}&limit=${limit}${force ? '&force=1' : ''}`;
		return this.request(`/leaderboard${qs}`);
	}
}
