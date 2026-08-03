import { requestApi, readStoredToken, readStoredUserId, buildApiUrl } from '../../api/runtime.js';

/**
 * API 客户端（v2）
 * 统一对接 /api/v1 响应契约：
 * { code, message, data, request_id, ts }
 */
class APIClient {
	static get base(): string {
		return window.__API_BASE__ || '/api/v1';
	}

	static readStoredUserId(): string {
		return readStoredUserId();
	}

	static readStoredToken(): string {
		return readStoredToken();
	}

	static buildUrl(path: string): string {
		return buildApiUrl(path, this.base);
	}

	static async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
		return requestApi<T>(path, options, this.base);
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

	static async changePassword(token: string, currentPassword: string, newPassword: string): Promise<unknown> {
		return this.request('/auth/password/change', {
			method: 'POST',
			body: JSON.stringify({
				token,
				current_password: currentPassword,
				new_password: newPassword
			})
		});
	}

	static async getAuthSessions(token: string): Promise<unknown> {
		const params = new URLSearchParams({ token });
		return this.request(`/auth/sessions?${params.toString()}`);
	}

	static async revokeOtherAuthSessions(token: string): Promise<unknown> {
		return this.request('/auth/sessions/revoke-others', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
	}

	static async revokeAuthSession(token: string, sessionId: string): Promise<unknown> {
		return this.request(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
			method: 'DELETE',
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
	static async getExams(options: { family?: string; level?: string; year?: string; sort?: string } = {}): Promise<unknown[]> {
		const params = new URLSearchParams();
		if (options.family) params.append('family', options.family);
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

	static async updateExam(examId: string, examData: unknown): Promise<unknown> {
		return this.request(`/exams/${encodeURIComponent(examId)}`, {
			method: 'PUT',
			body: JSON.stringify(examData)
		});
	}

	static async deleteExam(examId: string): Promise<unknown> {
		return this.request(`/exams/${examId}`, { method: 'DELETE' });
	}

	// ==================== 答题 ====================
	static async submitAnswers(userId: string, examId: string, answers: Record<string, unknown>, submissionId = '', attemptId = '', examMode = 'practice'): Promise<unknown> {
		return this.request('/answers/submit', {
			method: 'POST',
			body: JSON.stringify({
				user_id: userId,
				exam_id: examId,
				answers,
				submission_id: submissionId,
				attempt_id: attemptId,
				exam_mode: examMode
			})
		});
	}

	static async getAnswerAttempts(userId: string, examId: string, limit = 20): Promise<unknown> {
		return this.request(`/answers/${encodeURIComponent(userId)}/${encodeURIComponent(examId)}/attempts?limit=${limit}`);
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

	static async listRecentLearning(userId: string, limit = 3): Promise<unknown> {
		return this.request(`/recent-learning/${encodeURIComponent(userId)}?limit=${encodeURIComponent(String(limit))}`);
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
	static async listPlatformRoleTemplates(token: string): Promise<unknown> { return this.request(`/admin/role-templates?token=${encodeURIComponent(token)}`); }
	static async previewPlatformRoleTemplate(token: string, roleId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/role-templates/${encodeURIComponent(roleId)}/preview`, { method: 'POST', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async updatePlatformRoleTemplate(token: string, roleId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/role-templates/${encodeURIComponent(roleId)}`, { method: 'PUT', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async getPlatformUserAccess(token: string, userId: string): Promise<unknown> { return this.request(`/admin/users/${encodeURIComponent(userId)}/platform-access?token=${encodeURIComponent(token)}`); }
	static async previewPlatformUserAccess(token: string, userId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/users/${encodeURIComponent(userId)}/platform-access/preview`, { method: 'POST', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async updatePlatformUserAccess(token: string, userId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/users/${encodeURIComponent(userId)}/platform-access`, { method: 'PUT', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async listContentWorkflow(token: string): Promise<unknown> { return this.request(`/admin/content/workflow?token=${encodeURIComponent(token)}`); }
	static async inspectContentWorkflow(token: string, examId: string): Promise<unknown> { return this.request(`/admin/content/workflow/${encodeURIComponent(examId)}/inspect`, { method: 'POST', body: JSON.stringify({ token }) }); }
	static async inspectContentWorkflowBatch(token: string, examIds: string[]): Promise<unknown> { return this.request('/admin/content/workflow/inspect-batch', { method: 'POST', body: JSON.stringify({ token, exam_ids: examIds }) }); }
	static async reviewContentWorkflow(token: string, examId: string, stage: string, payload: unknown): Promise<unknown> { return this.request(`/admin/content/workflow/${encodeURIComponent(examId)}/reviews/${encodeURIComponent(stage)}`, { method: 'PUT', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async publishContentWorkflow(token: string, examId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/content/workflow/${encodeURIComponent(examId)}/publish`, { method: 'POST', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }
	static async listContentVersions(token: string, examId: string): Promise<unknown> { return this.request(`/admin/content/workflow/${encodeURIComponent(examId)}/versions?token=${encodeURIComponent(token)}`); }
	static async rollbackContentVersion(token: string, examId: string, versionId: string, payload: unknown): Promise<unknown> { return this.request(`/admin/content/workflow/${encodeURIComponent(examId)}/versions/${encodeURIComponent(versionId)}/rollback`, { method: 'POST', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) }); }

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

	static async bindWechat(token: string, code: string): Promise<unknown> {
		return this.request('/auth/wechat/bind', {
			method: 'POST',
			body: JSON.stringify({ token, code })
		});
	}

	static async deleteAccount(token: string, confirmation: string, phone: string, phoneCode: string, reason = 'user_requested'): Promise<unknown> {
		return this.request('/auth/account/delete', {
			method: 'POST',
			body: JSON.stringify({ token, confirmation, phone, phone_code: phoneCode, reason })
		});
	}

	static async claimReferralCode(token: string, referralCode: string): Promise<unknown> {
		return this.request('/me/referral/claim', {
			method: 'POST',
			body: JSON.stringify({ token, referral_code: referralCode })
		});
	}

	static async getMyWallet(token: string): Promise<unknown> {
		return this.request(`/me/wallet?token=${encodeURIComponent(token)}`);
	}

	static async redeemCode(token: string, code: string): Promise<unknown> {
		return this.request('/me/redeem', {
			method: 'POST',
			body: JSON.stringify({ token, code })
		});
	}

	static async getMyPendingOrganizationInvitations(token: string): Promise<unknown[]> {
		return this.request(`/me/invitations?token=${encodeURIComponent(token)}`);
	}

	static async searchUsers(token: string, query: string, limit = 12): Promise<unknown[]> {
		const params = new URLSearchParams({ token, q: query, limit: String(limit) });
		return this.request(`/users/search?${params.toString()}`);
	}

	static async getOrganizations(token: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const params = new URLSearchParams({ token });
		Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
		return this.request(`/organizations?${params.toString()}`);
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

	static async getOrganizationMembers(organizationId: string, token: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const params = new URLSearchParams({ token });
		Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
		return this.request(`/organizations/${organizationId}/members?${params.toString()}`);
	}

	static async saveOrganizationMember(organizationId: string, token: string, payload: unknown, reauthPassword: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, confirmation: '确认修改机构成员', reauth_password: reauthPassword })
		});
	}

	static async removeOrganizationMember(organizationId: string, userId: string, token: string, reauthPassword: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/members/${userId}`, {
			method: 'DELETE',
			body: JSON.stringify({ token, confirmation: '确认移除机构成员', reauth_password: reauthPassword })
		});
	}

	static async saveOrganizationRolePermissions(organizationId: string, roleId: string, token: string, payload: unknown, reauthPassword: string): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/role-permissions/${encodeURIComponent(roleId)}`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, confirmation: '确认修改角色权限', reauth_password: reauthPassword })
		});
	}

	static async getOrganizationCampuses(organizationId: string, token: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const params = new URLSearchParams({ token });
		Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
		return this.request(`/organizations/${organizationId}/campuses?${params.toString()}`);
	}

	static async saveOrganizationCampus(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/campuses`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getOrganizationLearningGroups(organizationId: string, token: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const params = new URLSearchParams({ token });
		Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
		return this.request(`/organizations/${organizationId}/learning-groups?${params.toString()}`);
	}

	static async saveOrganizationLearningGroup(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getOrganizationCoursePackages(organizationId: string, token: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const params = new URLSearchParams({ token });
		Object.entries(options).forEach(([key, value]) => params.set(key, String(value)));
		return this.request(`/organizations/${organizationId}/course-packages?${params.toString()}`);
	}

	static async saveOrganizationCoursePackage(organizationId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/course-packages`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async saveLearningGroupEnrollment(organizationId: string, learningGroupId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups/${learningGroupId}/enrollments`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async completeOrganizationLearningGroup(organizationId: string, learningGroupId: string, token: string, payload: unknown = {}): Promise<unknown> {
		return this.request(`/organizations/${organizationId}/learning-groups/${learningGroupId}/complete`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
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

	static async updateUserSubscription(userId: string, token: string, payload: unknown): Promise<unknown> {
		return this.request(`/subscription/${userId}/grant`, {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token, scope_type: 'personal' })
		});
	}

	static async createPaymentOrder(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/orders', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getPaymentQuote(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/quote', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getAutoRenewal(token: string, scopeType: 'personal' | 'organization' = 'personal', organizationId = ''): Promise<unknown> {
		const query = new URLSearchParams({ token, scope_type: scopeType });
		if (organizationId) query.set('organization_id', organizationId);
		return this.request(`/payments/auto-renewal?${query.toString()}`);
	}

	static async updateAutoRenewal(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/auto-renewal', {
			method: 'PUT',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getPaymentNotifications(token: string, unreadOnly = false, page = 1, pageSize = 20): Promise<unknown> {
		const query = new URLSearchParams({
			token,
			unread_only: unreadOnly ? 'true' : 'false',
			page: String(page),
			page_size: String(pageSize)
		});
		return this.request(`/payments/notifications?${query.toString()}`);
	}

	static async markPaymentNotificationRead(token: string, notificationId: string): Promise<unknown> {
		return this.request(`/payments/notifications/${encodeURIComponent(notificationId)}/read`, {
			method: 'PATCH',
			body: JSON.stringify({ token })
		});
	}

	static async markAllPaymentNotificationsRead(token: string): Promise<unknown> {
		return this.request('/payments/notifications/read-all', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
	}

	static async getRenewalOperations(token: string): Promise<unknown> {
		return this.request(`/admin/payments/renewal-operations?token=${encodeURIComponent(token)}`);
	}

	static async runRenewalJob(token: string, payload: unknown): Promise<unknown> {
		return this.request('/admin/payments/renewal-jobs/run', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getPaymentPricing(): Promise<unknown> {
		return this.request('/payments/pricing');
	}

	static async updatePaymentPricing(token: string, payload: unknown): Promise<unknown> {
		return this.request('/admin/payments/pricing', {
			method: 'PUT',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async getPaymentOrder(token: string, orderId: string): Promise<unknown> {
		return this.request(`/payments/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`);
	}

	static async listPaymentLedger(token: string, userId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (userId) query.set('user_id', userId);
		return this.request(`/payments/ledger?${query.toString()}`);
	}

	static async requestPaymentRefund(token: string, payload: unknown): Promise<unknown> {
		return this.request('/payments/refunds', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async listAdminPaymentOrders(token: string, filters: Record<string, string | number> = {}): Promise<unknown> {
		const query = new URLSearchParams({ token });
		Object.entries(filters).forEach(([key, value]) => query.set(key, String(value)));
		return this.request(`/admin/payments/orders?${query.toString()}`);
	}

	static async listAdminPaymentRefunds(token: string, filters: Record<string, string | number> = {}): Promise<unknown> {
		const query = new URLSearchParams({ token });
		Object.entries(filters).forEach(([key, value]) => query.set(key, String(value)));
		return this.request(`/admin/payments/refunds?${query.toString()}`);
	}

	static async listAdminPaymentLedger(token: string, filters: Record<string, string | number> = {}): Promise<unknown> {
		const query = new URLSearchParams({ token });
		Object.entries(filters).forEach(([key, value]) => query.set(key, String(value)));
		return this.request(`/admin/payments/ledger?${query.toString()}`);
	}

	static async getAdminPaymentReconciliation(token: string): Promise<unknown> {
		return this.request(`/admin/payments/reconciliation?token=${encodeURIComponent(token)}`);
	}

	static async createOrganizationPaymentOrder(token: string, payload: unknown): Promise<unknown> {
		return this.request('/admin/payments/organization-orders', { method: 'POST', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) });
	}

	static async updatePaymentRefundStatus(token: string, refundId: string, payload: unknown): Promise<unknown> {
		return this.request(`/admin/payments/refunds/${encodeURIComponent(refundId)}/status`, { method: 'PATCH', body: JSON.stringify({ ...(payload as Record<string, unknown>), token }) });
	}

	static async getInstitutionDashboard(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/dashboard?${query.toString()}`);
	}

	static async getInstitutionWorkbench(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/workbench?${query.toString()}`);
	}

	static async getInstitutionPlans(): Promise<unknown> {
		return this.request('/institution/plans');
	}

	static async getInstitutionLearningGroupGradebook(token: string, organizationId: string, learningGroupId: string): Promise<unknown> {
		return this.request(`/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/gradebook?token=${encodeURIComponent(token)}`);
	}

	static async updateInstitutionSchedule(token: string, organizationId: string, learningGroupId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/institution/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/schedule`, {
			method: 'PATCH',
			body: JSON.stringify({ ...payload, token })
		});
	}

	static async getInstitutionStudentProfile(token: string, studentId: string): Promise<unknown> {
		return this.request(`/institution/students/${encodeURIComponent(studentId)}?token=${encodeURIComponent(token)}`);
	}

	static async addInstitutionTeacherNote(token: string, studentId: string, text: string): Promise<unknown> {
		return this.request(`/institution/students/${encodeURIComponent(studentId)}/teacher-notes`, {
			method: 'POST',
			body: JSON.stringify({ token, text })
		});
	}

	static async createLessonPrep(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/lesson-prep', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async listLessonPrepPlans(token: string, orgId?: string): Promise<unknown> {
		const query = new URLSearchParams({ token });
		if (orgId) query.set('org_id', orgId);
		return this.request(`/institution/lesson-prep/plans?${query.toString()}`);
	}

	static async saveLessonPrepPlan(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/lesson-prep/plans', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
	}

	static async previewInstitutionImport(token: string, payload: unknown): Promise<unknown> {
		return this.request('/institution/import-preview', {
			method: 'POST',
			body: JSON.stringify({ ...(payload as Record<string, unknown>), token })
		});
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
	static async resetWrongQuestions(userId: string, confirmation: string): Promise<unknown> {
		return this.request(`/wrong-questions/${encodeURIComponent(userId)}/reset`, {
			method: 'POST',
			body: JSON.stringify({ confirmation })
		});
	}

	// 错因归因标签（功能 #16）：预设标签注册表 + 覆盖式设置某题的标签
	static async getWrongQuestionTagRegistry(): Promise<unknown> {
		return this.request('/wrong-questions/tag-registry');
	}

	static async setWrongQuestionTags(userId: string, questionId: string, tags: string[]): Promise<unknown> {
		return this.request(
			`/wrong-questions/${encodeURIComponent(userId)}/${encodeURIComponent(questionId)}/tags`,
			{
				method: 'PUT',
				body: JSON.stringify({ tags })
			}
		);
	}

	// ==================== 同考点串题（功能 #17） ====================

	static async getRelatedQuestions(examId: string, questionId: string, limit = 10): Promise<unknown> {
		const params = new URLSearchParams();
		params.append('exam_id', examId);
		params.append('question_id', questionId);
		params.append('limit', String(limit));
		return this.request(`/related-questions?${params.toString()}`);
	}

	// ==================== 章节式学习路径（功能 #18） ====================

	static async listChapters(opts: { family?: string; level?: string; userId?: string } = {}): Promise<unknown> {
		const params = new URLSearchParams();
		if (opts.family) params.append('family', opts.family);
		if (opts.level) params.append('level', opts.level);
		const uid = opts.userId ?? this.readStoredUserId();
		if (uid) params.append('user_id', uid);
		const q = params.toString();
		return this.request(`/chapters${q ? `?${q}` : ''}`);
	}

	static async getChapterDetail(chapterId: string, userId?: string): Promise<unknown> {
		const params = new URLSearchParams();
		const uid = userId ?? this.readStoredUserId();
		if (uid) params.append('user_id', uid);
		const q = params.toString();
		return this.request(`/chapters/${encodeURIComponent(chapterId)}${q ? `?${q}` : ''}`);
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

	static async getSystemFeatureFlags(): Promise<unknown> {
		return this.request('/admin/feature-flags/system');
	}

	static async updateMyFeatureFlags(patch: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/feature-flags', {
			method: 'PUT',
			body: JSON.stringify(patch)
		});
	}

	static async updateSystemFeatureFlags(patch: Record<string, unknown>, reauthPassword: string): Promise<unknown> {
		return this.request('/admin/feature-flags/system', {
			method: 'PUT',
			body: JSON.stringify({ ...patch, confirmation: '确认修改系统开关', reauth_password: reauthPassword })
		});
	}

	static async updateOrgFeatureFlags(orgId: string, patch: Record<string, unknown>, reauthPassword: string): Promise<unknown> {
		return this.request(`/admin/feature-flags/orgs/${encodeURIComponent(orgId)}`, {
			method: 'PUT',
			body: JSON.stringify({ ...patch, confirmation: '确认修改机构开关', reauth_password: reauthPassword })
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

	static async listFeedback(paperId?: string, status?: string, options: Record<string, string | number> = {}): Promise<unknown> {
		const qs = new URLSearchParams();
		if (paperId) qs.append('paper_id', paperId);
		if (status) qs.append('status', status);
		Object.entries(options).forEach(([key, value]) => qs.set(key, String(value)));
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
	// 学习组作业 API（业务功能 6）
	// ---------------------------------------------------------------------

	static async createLearningGroupAssignment(organizationId: string, learningGroupId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async listLearningGroupAssignments(organizationId: string, learningGroupId: string): Promise<unknown> {
		return this.request(`/organizations/${encodeURIComponent(organizationId)}/learning-groups/${encodeURIComponent(learningGroupId)}/assignments`);
	}

	static async listMyAssignments(): Promise<unknown> {
		return this.request('/me/assignments');
	}

	static async getAssignment(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}`);
	}

	static async submitAssignment(assignmentId: string, answers: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/submit`, {
			method: 'POST',
			body: JSON.stringify({ answers })
		});
	}

	static async getAssignmentSubmissions(assignmentId: string): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/submissions`);
	}

	static async reviewAssignmentSubmission(assignmentId: string, studentId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(studentId)}/review`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async remindAssignment(assignmentId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/assignments/${encodeURIComponent(assignmentId)}/reminders`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
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

	static async getBookmarks(userId: string): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}`);
	}

	static async addQuestionBookmark(userId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}/questions`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async removeQuestionBookmark(userId: string, bookmarkId: string): Promise<unknown> {
		return this.request(`/bookmarks/${encodeURIComponent(userId)}/questions/${encodeURIComponent(bookmarkId)}`, {
			method: 'DELETE'
		});
	}

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

	// ---------------------------------------------------------------------
	// 每日一练（业务功能 16）
	// ---------------------------------------------------------------------

	static async getDailyPractice(count?: number): Promise<unknown> {
		const suffix = count ? `?count=${count}` : '';
		return this.request(`/me/daily-practice${suffix}`);
	}

	static async regenerateDailyPractice(count?: number): Promise<unknown> {
		return this.request('/me/daily-practice/regenerate', {
			method: 'POST',
			body: JSON.stringify(count ? { count } : {})
		});
	}

	static async completeDailyPracticeItem(questionId: string): Promise<unknown> {
		return this.request('/me/daily-practice/complete', {
			method: 'POST',
			body: JSON.stringify({ question_id: questionId })
		});
	}

	// ---------------------------------------------------------------------
	// 学习报告（业务功能 17）
	// ---------------------------------------------------------------------

	static async getLearningReport(period: 'week' | 'month' = 'week'): Promise<unknown> {
		return this.request(`/me/learning-report?period=${encodeURIComponent(period)}`);
	}

	// ---------------------------------------------------------------------
	// 备考目标 / 倒计时（业务功能 18）
	// ---------------------------------------------------------------------

	static async listStudyGoals(): Promise<unknown> {
		return this.request('/me/study-goals');
	}

	static async createStudyGoal(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/study-goals', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async updateStudyGoal(goalId: string, payload: Record<string, unknown>): Promise<unknown> {
		return this.request(`/me/study-goals/${encodeURIComponent(goalId)}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
	}

	static async deleteStudyGoal(goalId: string): Promise<unknown> {
		return this.request(`/me/study-goals/${encodeURIComponent(goalId)}`, {
			method: 'DELETE'
		});
	}

	// ---------------------------------------------------------------------
	// 多端同步（业务功能 19）
	// ---------------------------------------------------------------------

	static async getSyncState(): Promise<unknown> {
		return this.request('/me/sync/state');
	}

	static async pullSync(modules?: string[]): Promise<unknown> {
		const qs = modules && modules.length > 0 ? `?modules=${encodeURIComponent(modules.join(','))}` : '';
		return this.request(`/me/sync/pull${qs}`);
	}

	static async pushSync(payload: Record<string, unknown>): Promise<unknown> {
		return this.request('/me/sync/push', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	static async getSyncDevices(): Promise<unknown> {
		return this.request('/me/sync/devices');
	}

	// ---------------------------------------------------------------------
	// 排行榜（业务功能 21）
	// ---------------------------------------------------------------------

	static async getLeaderboard(period: 'week' | 'month' | 'all' = 'week', limit: number = 20, force: boolean = false): Promise<unknown> {
		const qs = `?period=${encodeURIComponent(period)}&limit=${limit}${force ? '&force=1' : ''}`;
		return this.request(`/leaderboard${qs}`);
	}

	// ---------------------------------------------------------------------
	// 个人生词本（自学者点词查词）
	// ---------------------------------------------------------------------

	static async listVocab(userId?: string): Promise<unknown> {
		const uid = userId ?? this.readStoredUserId();
		if (!uid) {
			throw new Error('未登录');
		}
		return this.request(`/vocab-notebook/${encodeURIComponent(uid)}`);
	}

	static async addVocabWord(payload: {
		word: string;
		reading?: string;
		note?: string;
		examId?: string;
		questionId?: string;
		userId?: string;
	}): Promise<unknown> {
		const uid = payload.userId ?? this.readStoredUserId();
		if (!uid) {
			throw new Error('未登录');
		}
		return this.request(`/vocab-notebook/${encodeURIComponent(uid)}/words`, {
			method: 'POST',
			body: JSON.stringify({
				word: payload.word,
				reading: payload.reading ?? '',
				note: payload.note ?? '',
				exam_id: payload.examId ?? '',
				question_id: payload.questionId ?? ''
			})
		});
	}

	static async removeVocabWord(wordId: string, userId?: string): Promise<unknown> {
		const uid = userId ?? this.readStoredUserId();
		if (!uid) {
			throw new Error('未登录');
		}
		return this.request(`/vocab-notebook/${encodeURIComponent(uid)}/words/${encodeURIComponent(wordId)}`, {
			method: 'DELETE'
		});
	}

	static async updateVocabNote(wordId: string, note: string, userId?: string): Promise<unknown> {
		const uid = userId ?? this.readStoredUserId();
		if (!uid) {
			throw new Error('未登录');
		}
		return this.request(`/vocab-notebook/${encodeURIComponent(uid)}/words/${encodeURIComponent(wordId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ note })
		});
	}

	// ---------------------------------------------------------------------
	// 阅读分句译文（B2 众包式双语对照）
	// ---------------------------------------------------------------------

	static async getTranslations(examId: string): Promise<unknown> {
		return this.request(`/translations/${encodeURIComponent(examId)}`);
	}

	static async upsertTranslationSentence(
		examId: string,
		passageKey: string,
		paragraph: number,
		sentence: number,
		text: string
	): Promise<unknown> {
		return this.request(`/translations/${encodeURIComponent(examId)}/sentences`, {
			method: 'PUT',
			body: JSON.stringify({
				passage_key: passageKey,
				paragraph,
				sentence,
				text
			})
		});
	}
}

window.APIClient = APIClient;
