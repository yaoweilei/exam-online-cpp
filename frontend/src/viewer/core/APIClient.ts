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

	static async register(username: string, password: string, email: string | null = null): Promise<unknown> {
		return this.request('/auth/register', {
			method: 'POST',
			body: JSON.stringify({ username, password, email })
		});
	}

	static async logout(token: string): Promise<unknown> {
		return this.request('/auth/logout', {
			method: 'POST',
			body: JSON.stringify({ token })
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

	static async getSubscription(userId: string): Promise<unknown> {
		return this.request(`/subscription/${userId}`);
	}

	static async getMe(token: string): Promise<unknown> {
		return this.request(`/me?token=${encodeURIComponent(token)}`);
	}

	static async getMeContext(token: string): Promise<unknown> {
		return this.request(`/me/context?token=${encodeURIComponent(token)}`);
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
}

window.APIClient = APIClient;
