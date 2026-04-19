export interface ApiEnvelope<T> {
	code: string;
	message: string;
	data: T;
	request_id: string;
	ts: string;
}

export class ApiClient {
	constructor(private readonly baseUrl: string = '/api/v2') {}

	private readStoredUserId(): string {
		try {
			const raw = localStorage.getItem('exam_v2_user');
			if (!raw) return '';
			const parsed = JSON.parse(raw) as { user_id?: string; id?: string };
			return parsed.user_id ?? parsed.id ?? '';
		} catch {
			return '';
		}
	}

	private buildUrl(path: string): string {
		if (path.startsWith('http://') || path.startsWith('https://')) return path;
		return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
	}

	async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(this.buildUrl(path), {
			headers: {
				'Content-Type': 'application/json',
				...(options.headers ?? {})
			},
			...options
		});

		const payload = (await response.json().catch(() => ({}))) as Partial<ApiEnvelope<T>> & T;
		const isEnvelope = Object.prototype.hasOwnProperty.call(payload, 'code');
		const data = isEnvelope ? (payload as ApiEnvelope<T>).data : (payload as T);
		const code = isEnvelope ? (payload as ApiEnvelope<T>).code : 'OK';
		const message = isEnvelope ? (payload as ApiEnvelope<T>).message : '';

		if (!response.ok || code !== 'OK') {
			throw new Error(message || `HTTP ${response.status}`);
		}

		return data;
	}

	getExams(options: { level?: string; year?: string; sort?: string } = {}): Promise<unknown[]> {
		const params = new URLSearchParams();
		if (options.level) params.append('level', options.level);
		if (options.year) params.append('year', options.year);
		if (options.sort) params.append('sort', options.sort);
		const query = params.toString();
		return this.request(`/exams${query ? `?${query}` : ''}`);
	}

	getExam(examId: string, userId?: string): Promise<unknown> {
		const effectiveUserId = userId ?? this.readStoredUserId();
		const query = effectiveUserId ? `?user_id=${encodeURIComponent(effectiveUserId)}` : '';
		return this.request(`/exams/${examId}${query}`);
	}

	getUser(userId: string): Promise<unknown> {
		return this.request(`/users/${userId}`);
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
}
