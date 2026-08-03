export interface ApiEnvelope<T> {
	code: string;
	message: string;
	data: T;
	request_id: string;
	ts: string;
}

export function readStoredUserId(): string {
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

export function readStoredToken(): string {
	try {
		// Legacy migration only. New sessions are carried by an HttpOnly cookie.
		return localStorage.getItem('exam_v2_token') || '';
	} catch {
		return '';
	}
}

export function buildApiUrl(path: string, baseUrl: string = '/api/v1'): string {
	if (path.startsWith('http://') || path.startsWith('https://')) {
		return path;
	}
	if (path.startsWith('/api/')) {
		return path;
	}
	return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function requestApi<T>(path: string, options: RequestInit = {}, baseUrl: string = '/api/v1'): Promise<T> {
	const token = readStoredToken();
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), 30000);
	const forwardAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', forwardAbort, { once: true });
	let response: Response;
	try {
		response = await fetch(buildApiUrl(path, baseUrl), {
			...options,
			signal: controller.signal,
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(options.headers ?? {})
			}
		});
	} catch (error) {
		if (controller.signal.aborted && !options.signal?.aborted) throw new Error('请求超时，请稍后重试');
		throw error;
	} finally {
		window.clearTimeout(timeout);
		options.signal?.removeEventListener('abort', forwardAbort);
	}

	const payload: unknown = await response.json().catch(() => ({}));
	const isEnvelope =
		typeof payload === 'object' &&
		payload !== null &&
		Object.prototype.hasOwnProperty.call(payload, 'code');
	const envelope = isEnvelope ? (payload as Partial<ApiEnvelope<T>>) : null;
	const data = isEnvelope ? (envelope?.data as T) : (payload as T);
	const code = envelope?.code || 'OK';
	const message = envelope?.message || '';

	if (!response.ok || code !== 'OK') {
		const error = new Error(message || `HTTP ${response.status}`) as Error & {
			status?: number;
			payload?: unknown;
		};
		error.status = response.status;
		error.payload = payload;
		throw error;
	}

	return data;
}
