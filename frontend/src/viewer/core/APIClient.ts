/**
 * API 客户端（v2）
 * 统一对接 /api/v2 响应契约：
 * { code, message, data, request_id, ts }
 */
class APIClient {
	static get base(): string {
		return window.__API_BASE__ || '/api/v2';
	}

	static readStoredUserId(): string {
		try {
			const raw = localStorage.getItem('exam_v2_user');
			if (!raw) {
				return '';
			}
			const parsed = JSON.parse(raw) as { user_id?: string; id?: string };
			return parsed.user_id ?? parsed.id ?? '';
		} catch {
			return '';
		}
	}

	static buildUrl(path: string): string {
		if (path.startsWith('http://') || path.startsWith('https://')) {
			return path;
		}
		if (path.startsWith('/api/')) {
			return path;
		}
		const normalized = path.startsWith('/') ? path : `/${path}`;
		return `${this.base}${normalized}`;
	}

	static async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
		const url = this.buildUrl(path);
		const headers: HeadersInit = {
			'Content-Type': 'application/json',
			...(options.headers || {})
		};
		const response = await fetch(url, { ...options, headers });
		const payload: unknown = await response.json().catch(() => ({}));

		const isEnvelope =
			typeof payload === 'object' &&
			payload !== null &&
			Object.prototype.hasOwnProperty.call(payload, 'code');

		const envelope = isEnvelope ? (payload as Partial<ApiEnvelope<T>>) : null;
		const data = isEnvelope ? (envelope?.data as T) : (payload as T);
		const message = envelope?.message || '';
		const code = envelope?.code || '';

		if (!response.ok || (isEnvelope && code !== 'OK')) {
			const err = new Error(message || `HTTP ${response.status}`) as Error & {
				status?: number;
				payload?: unknown;
			};
			err.status = response.status;
			err.payload = payload;
			throw err;
		}

		return data;
	}

	// ==================== 认证 ====================
	static async login(username: string, password: string): Promise<unknown> {
		return this.request('/auth/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
	}

	static async register(username: string, password: string, email: string | null = null, referralCode = ''): Promise<unknown> {
		return this.request('/auth/register', {
			method: 'POST',
			body: JSON.stringify({ username, password, email, referral_code: referralCode })
		});
	}

	static async logout(token: string): Promise<unknown> {
		return this.request('/auth/logout', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
	}

	static async sendContactChangeChallenge(token: string, channel: 'email' | 'phone'): Promise<unknown> {
		return this.request('/auth/contact-change/send-code', {
			method: 'POST',
			body: JSON.stringify({ token, channel })
		});
	}

	static async sendPhoneVerificationCode(phone: string): Promise<unknown> {
		return this.request('/auth/phone/send-code', {
			method: 'POST',
			body: JSON.stringify({ phone })
		});
	}

	static async verifyPhone(
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

	static async sendEmailVerificationCode(token: string, email: string): Promise<unknown> {
		return this.request('/auth/email/send-code', {
			method: 'POST',
			body: JSON.stringify({ token, email })
		});
	}

	static async verifyEmail(
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

	static async verifyToken(token: string): Promise<unknown> {
		return this.request(`/auth/verify?token=${encodeURIComponent(token)}`);
	}

	// ==================== 试卷 ====================
	static async getExams(options: { level?: string; year?: string; sort?: string } = {}): Promise<unknown[]> {
		const params = new URLSearchParams();
		if (options.level) params.append('level', options.level);
		if (options.year) params.append('year', options.year);
		if (options.sort) params.append('sort', options.sort);
		const query = params.toString();
		return this.request(`/exams${query ? `?${query}` : ''}`);
	}

	static async getExam(examId: string, userId?: string): Promise<unknown> {
		const effectiveUserId = userId ?? this.readStoredUserId();
		const query = effectiveUserId ? `?user_id=${encodeURIComponent(effectiveUserId)}` : '';
		return this.request(`/exams/${examId}${query}`);
	}

	static async createExam(examData: unknown): Promise<unknown> {
		return this.request('/exams', {
			method: 'POST',
			body: JSON.stringify(examData)
		});
	}

	static async deleteExam(examId: string): Promise<unknown> {
		return this.request(`/exams/${examId}`, { method: 'DELETE' });
	}

	// ==================== 答题 ====================
	static async submitAnswers(userId: string, examId: string, answers: Record<string, unknown>): Promise<unknown> {
		return this.request('/answers/submit', {
			method: 'POST',
			body: JSON.stringify({
				user_id: userId,
				exam_id: examId,
				answers
			})
		});
	}

	static async getAnswers(userId: string, examId: string): Promise<unknown> {
		return this.request(`/answers/${userId}/${examId}`);
	}

	static async getProgress(userId: string): Promise<unknown> {
		return this.request(`/progress/${userId}`);
	}

	static async getExamProgress(userId: string): Promise<Record<string, number>> {
		return this.request(`/progress/${userId}/exams`);
	}

	// ==================== 统计 ====================
	static async getStatistics(userId: string): Promise<unknown> {
		return this.request(`/statistics/${userId}`);
	}

	static async getWeakPoints(userId: string): Promise<unknown> {
		return this.request(`/statistics/${userId}/weak-points`);
	}

	static async getLearningCurve(userId: string, days = 30): Promise<unknown> {
		return this.request(`/statistics/${userId}/learning-curve?days=${days}`);
	}

	static async getRecommendations(userId: string, limit = 5): Promise<unknown> {
		return this.request(`/recommendations/${userId}?limit=${limit}`);
	}

	// ==================== 用户 ====================
	static async getUser(userId: string): Promise<unknown> {
		return this.request(`/users/${userId}`);
	}

	static async getUsersByRole(roleId: string): Promise<unknown[]> {
		return this.request(`/users/by-role/${roleId}`);
	}

	static async getUserPermissions(userId: string): Promise<unknown> {
		return this.request(`/users/${userId}/permissions`);
	}

	static async getAllRoles(): Promise<unknown> {
		return this.request('/roles');
	}

	static async getProfile(userId: string): Promise<unknown> {
		return this.request(`/profile/${userId}`);
	}

	static async updateProfile(userId: string, patch: unknown): Promise<unknown> {
		return this.request(`/profile/${userId}`, {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	static async getSubscription(scopeId: string, options: { scopeType?: 'personal' | 'organization' } = {}): Promise<unknown> {
		const params = new URLSearchParams();
		if (options.scopeType) params.append('scope_type', options.scopeType);
		const query = params.toString();
		return this.request(`/subscription/${scopeId}${query ? `?${query}` : ''}`);
	}

	static async getMe(token: string): Promise<unknown> {
		return this.request(`/me?token=${encodeURIComponent(token)}`);
	}

	static async getMeContext(token: string): Promise<unknown> {
		return this.request(`/me/context?token=${encodeURIComponent(token)}`);
	}

	static async claimReferralCode(token: string, referralCode: string): Promise<unknown> {
		return this.request('/me/referral/claim', {
			method: 'POST',
			body: JSON.stringify({ token, referral_code: referralCode })
		});
	}

	static async getMyPendingOrganizationInvitations(token: string): Promise<unknown[]> {
		return this.request(`/me/invitations?token=${encodeURIComponent(token)}`);
	}

	static async searchUsers(token: string, query: string, limit = 12): Promise<unknown[]> {
		const params = new URLSearchParams({ token, q: query, limit: String(limit) });
		return this.request(`/users/search?${params.toString()}`);
	}

	static async getOrganizations(token: string): Promise<unknown[]> {
		return this.request(`/organizations?token=${encodeURIComponent(token)}`);
	}

	static async getOrganization(organizationId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}?token=${encodeURIComponent(token)}`);
	}

	static async createOrganization(token: string, payload: unknown): Promise<unknown> {
		return this.request('/organizations', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getOrganizationMembers(organizationId: string, token: string): Promise<unknown[]> {
		return this.request(`/organizations/${organizationId}/members?token=${encodeURIComponent(token)}`);
	}

	static async saveOrganizationMember(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async removeOrganizationMember(organizationId: string, userId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members/${userId}?token=${encodeURIComponent(token)}`, {
			method: 'DELETE'
		});
	}

	static async saveOrganizationInvitation(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/invitations`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async cancelOrganizationInvitation(organizationId: string, invitationId: string, token: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/invitations/${invitationId}?token=${encodeURIComponent(token)}`, {
			method: 'DELETE'
		});
	}

	static async acceptOrganizationInvitation(token: string, inviteToken: string): Promise<unknown> {
		return this.request('/organizations/invitations/accept', {
			method: 'POST',
			body: JSON.stringify({ token, invite_token: inviteToken })
		});
	}

	static async updateOrganizationSubscription(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/subscription/${organizationId}/grant`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, scope_type: 'organization' })
		});
	}

	// ==================== 振假名 ====================
	static async addFurigana(text: string): Promise<unknown> {
		return this.request('/furigana/add', {
			method: 'POST',
			body: JSON.stringify({ text })
		});
	}

	static async getReading(word: string): Promise<unknown> {
		return this.request(`/furigana/reading/${encodeURIComponent(word)}`);
	}

	// ==================== 错题本（业务功能 1） ====================

	// 拉取错题列表
	static async getWrongQuestions(
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

	// 仅取统计摘要
	static async getWrongQuestionSummary(userId: string): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/summary`);
	}

	// 随机抽取错题用于复习
	static async sampleWrongQuestions(userId: string, count = 10): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/sample`, {
			method: 'POST',
			body: JSON.stringify({ count })
		});
	}

	// 删除单题
	static async removeWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}`,
			{ method: 'DELETE' }
		);
	}

	// 标记已掌握
	static async masterWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}/master`,
			{ method: 'POST', body: '{}' }
		);
	}

	// 取消已掌握
	static async unmasterWrongQuestion(userId: string, questionId: string): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}/unmaster`,
			{ method: 'POST', body: '{}' }
		);
	}

	// 清空错题本
	static async resetWrongQuestions(userId: string): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/reset`, {
			method: 'POST',
			body: '{}'
		});
	}

	// ==================== 学习连续天数 / 每日目标（业务功能 2） ====================

	static async getStreakSummary(userId: string): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/summary`);
	}

	static async getStreakHeatmap(userId: string, days = 90): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/heatmap?days=${days}`);
	}

	static async updateStreakDailyGoal(userId: string, dailyQuestions: number): Promise<unknown> {
		return this.request(`/streaks/${encodeURIComponent(userId)}/goal`, {
			method: 'PUT',
			body: JSON.stringify({ daily_questions: dailyQuestions })
		});
	}

	// ==================== 续考草稿（业务功能 4） ====================

	static async getDraft(userId: string): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`);
	}

	static async saveDraft(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async clearDraft(userId: string): Promise<unknown> {
		return this.request(`/drafts/${encodeURIComponent(userId)}`, { method: 'DELETE' });
	}

	// ==================== 答题计时（业务功能 3：分段限时） ====================

	static async getExamTimer(userId: string): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}`);
	}

	static async startExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/start`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async tickExamTimer(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/tick`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async finishExamTimer(userId: string): Promise<unknown> {
		return this.request(`/timers/${encodeURIComponent(userId)}/finish`, { method: 'POST' });
	}

	// ==================== 功能开关（横切基础设施） ====================

	static async getFeatureFlagRegistry(): Promise<unknown> {
		return this.request('/feature-flags/registry');
	}

	static async getMyFeatureFlags(): Promise<unknown> {
		return this.request('/me/feature-flags');
	}

	static async updateMyFeatureFlags(patch: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/feature-flags', {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	static async updateSystemFeatureFlags(patch: Record<string, unknown>): Promise<unknown> {
		return this.request('/admin/feature-flags/system', {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	static async updateOrgFeatureFlags(orgId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/admin/feature-flags/orgs/${encodeURIComponent(orgId)}`, {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	// ---------------------------------------------------------------------
	// 题目反馈/纠错 API（业务功能 5）
	// ---------------------------------------------------------------------

	static async submitFeedback(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/feedback', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async listFeedback(paperId?: string, status?: string): Promise<unknown> {
		const qs = new URLSearchParams();
		if (paperId) qs.append('paper_id', paperId);
		if (status) qs.append('status', status);
		const suffix = qs.toString() ? `?${qs.toString()}` : '';
		return this.request(`/feedback${suffix}`);
	}

	static async updateFeedback(feedbackId: string, paperId: string, patch: Record<string, unknown>): Promise<unknown> {
		const qs = paperId ? `?paper_id=${encodeURIComponent(paperId)}` : '';
		return this.request(`/feedback/${encodeURIComponent(feedbackId)}${qs}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	// ---------------------------------------------------------------------
	// 班级与作业 API（业务功能 6）
	// ---------------------------------------------------------------------

	static async createClassroom(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/classrooms', { method: 'POST', body: JSON.stringify(payload) });
	}

	static async listMyClassrooms(): Promise<unknown> {
		return this.request('/me/classrooms');
	}

	static async getClassroom(classId: string): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}`);
	}

	static async updateClassroom(classId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	static async removeClassroom(classId: string): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}`, { method: 'DELETE' });
	}

	static async addClassroomMembers(classId: string, userIds: string[]): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}/members`, {
			method: 'POST',
			body: JSON.stringify({ user_ids: userIds })
		});
	}

	static async removeClassroomMember(classId: string, userId: string): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}/members/${encodeURIComponent(userId)}`, {
			method: 'DELETE'
		});
	}

	static async createAssignment(classId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}/assignments`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async listClassroomAssignments(classId: string): Promise<unknown> {
		return this.request(`/classrooms/${encodeURIComponent(classId)}/assignments`);
	}

	static async listMyAssignments(): Promise<unknown> {
		return this.request('/me/assignments');
	}

	static async updateAssignment(assignmentId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	static async removeAssignment(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
	}

	// ---------------------------------------------------------------------
	// SRS 间隔重复 API（业务功能 7）
	// ---------------------------------------------------------------------

	static async listSrsDue(userId: string, limit = 20): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/due?limit=${limit}`);
	}

	static async listSrsCards(userId: string): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards`);
	}

	static async reviewSrsCard(userId: string, cardId: string, grade: number): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/review`, {
			method: 'POST',
			body: JSON.stringify({ card_id: cardId, grade })
		});
	}

	static async addSrsCard(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async removeSrsCard(userId: string, cardId: string): Promise<unknown> {
		return this.request(`/srs/${encodeURIComponent(userId)}/cards/${encodeURIComponent(cardId)}`, {
			method: 'DELETE'
		});
	}

	// ---------------------------------------------------------------------
	// 收藏夹/分类 API（业务功能 8）
	// ---------------------------------------------------------------------

	static async listBookmarkFolders(userId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}`);
	}

	static async createBookmarkFolder(userId: string, name: string, color?: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}`, {
			method: 'POST',
			body: JSON.stringify({ name, color: color || '' })
		});
	}

	static async updateBookmarkFolder(userId: string, folderId: string, patch: Record<string, unknown>): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
	}

	static async removeBookmarkFolder(userId: string, folderId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}`, {
			method: 'DELETE'
		});
	}

	static async addExamToBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown> {
		return this.request(`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}/exams`, {
			method: 'POST',
			body: JSON.stringify({ exam_id: examId })
		});
	}

	static async removeExamFromBookmarkFolder(userId: string, folderId: string, examId: string): Promise<unknown> {
		return this.request(
			`/bookmark-folders/${encodeURIComponent(userId)}/${encodeURIComponent(folderId)}/exams/${encodeURIComponent(examId)}`,
			{ method: 'DELETE' }
		);
	}

	// ---------------------------------------------------------------------
	// 数据导出（业务功能 10）
	// ---------------------------------------------------------------------

	static async exportUserData(userId: string): Promise<unknown> {
		return this.request(`/data-export/${encodeURIComponent(userId)}`);
	}

	// ---------------------------------------------------------------------
	// 管理员统计（业务功能 11）
	// ---------------------------------------------------------------------

	static async getAdminStatisticsOverview(): Promise<unknown> {
		return this.request('/admin/statistics/overview');
	}

	// ---------------------------------------------------------------------
	// 社区讨论（业务功能 12）
	// ---------------------------------------------------------------------

	static async listCommunityPosts(paperId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}`);
	}

	static async createCommunityPost(paperId: string, title: string, body: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts`, {
			method: 'POST',
			body: JSON.stringify({ title, body })
		});
	}

	static async deleteCommunityPost(paperId: string, postId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}`, {
			method: 'DELETE'
		});
	}

	static async addCommunityComment(paperId: string, postId: string, body: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body })
		});
	}

	static async toggleCommunityLike(paperId: string, postId: string): Promise<unknown> {
		return this.request(`/community/${encodeURIComponent(paperId)}/posts/${encodeURIComponent(postId)}/like`, {
			method: 'POST'
		});
	}

	// ---------------------------------------------------------------------
	// 审计日志可视化（业务功能 15）
	// ---------------------------------------------------------------------

	static async queryAuditLogs(params: {
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

	static async listAuditLogActions(orgId?: string): Promise<unknown> {
		const suffix = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
		return this.request(`/admin/audit-logs/actions${suffix}`);
	}
}

window.APIClient = APIClient;
