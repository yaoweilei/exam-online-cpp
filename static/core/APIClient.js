/**
 * API 客户端（v2）
 * 统一对接 /api/v2 响应契约：
 * { code, message, data, request_id, ts }
 */
class APIClient {
	static get base() {
		return window.__API_BASE__ || '/api/v2';
	}

	static buildUrl(path) {
		if (path.startsWith('http://') || path.startsWith('https://')) {
			return path;
		}
		if (path.startsWith('/api/')) {
			return path;
		}
		const normalized = path.startsWith('/') ? path : `/${path}`;
		return `${this.base}${normalized}`;
	}

	static async request(path, options = {}) {
		const url = this.buildUrl(path);
		const headers = {
			'Content-Type': 'application/json',
			...options.headers
		};
		const response = await fetch(url, { ...options, headers });
		const payload = await response.json().catch(() => ({}));

		const isEnvelope = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'code');
		const data = isEnvelope ? payload.data : payload;
		const message = isEnvelope ? payload.message : '';
		const code = isEnvelope ? payload.code : '';

		if (!response.ok || (isEnvelope && code !== 'OK')) {
			const err = new Error(message || `HTTP ${response.status}`);
			err.status = response.status;
			err.payload = payload;
			throw err;
		}

		return data;
	}

	// ==================== 认证 ====================
	static async login(username, password) {
		return this.request('/auth/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
	}

	static async register(username, password, email = null) {
		return this.request('/auth/register', {
			method: 'POST',
			body: JSON.stringify({ username, password, email })
		});
	}

	static async logout(token) {
		return this.request('/auth/logout', {
			method: 'POST',
			body: JSON.stringify({ token })
		});
	}

	static async verifyToken(token) {
		return this.request(`/auth/verify?token=${encodeURIComponent(token)}`);
	}

	// ==================== 试卷 ====================
	static async getExams(options = {}) {
		const params = new URLSearchParams();
		if (options.level) params.append('level', options.level);
		if (options.year) params.append('year', options.year);
		if (options.sort) params.append('sort', options.sort);
		const query = params.toString();
		return this.request(`/exams${query ? `?${query}` : ''}`);
	}

	static async getExam(examId) {
		return this.request(`/exams/${examId}`);
	}

	static async createExam(examData) {
		return this.request('/exams', {
			method: 'POST',
			body: JSON.stringify(examData)
		});
	}

	static async deleteExam(examId) {
		return this.request(`/exams/${examId}`, { method: 'DELETE' });
	}

	// ==================== 答题 ====================
	static async submitAnswers(userId, examId, answers) {
		return this.request('/answers/submit', {
			method: 'POST',
			body: JSON.stringify({
				user_id: userId,
				exam_id: examId,
				answers
			})
		});
	}

	static async getAnswers(userId, examId) {
		return this.request(`/answers/${userId}/${examId}`);
	}

	static async getProgress(userId) {
		return this.request(`/progress/${userId}`);
	}

	static async getExamProgress(userId) {
		return this.request(`/progress/${userId}/exams`);
	}

	// ==================== 统计 ====================
	static async getStatistics(userId) {
		return this.request(`/statistics/${userId}`);
	}

	static async getWeakPoints(userId) {
		return this.request(`/statistics/${userId}/weak-points`);
	}

	static async getLearningCurve(userId, days = 30) {
		return this.request(`/statistics/${userId}/learning-curve?days=${days}`);
	}

	static async getRecommendations(userId, limit = 5) {
		return this.request(`/recommendations/${userId}?limit=${limit}`);
	}

	// ==================== 用户 ====================
	static async getUser(userId) {
		return this.request(`/users/${userId}`);
	}

	static async getUsersByRole(roleId) {
		return this.request(`/users/by-role/${roleId}`);
	}

	static async getUserPermissions(userId) {
		return this.request(`/users/${userId}/permissions`);
	}

	static async getAllRoles() {
		return this.request('/roles');
	}

	// ==================== 振假名 ====================
	static async addFurigana(text) {
		return this.request('/furigana/add', {
			method: 'POST',
			body: JSON.stringify({ text })
		});
	}

	static async getReading(word) {
		return this.request(`/furigana/reading/${encodeURIComponent(word)}`);
	}
}

window.APIClient = APIClient;
