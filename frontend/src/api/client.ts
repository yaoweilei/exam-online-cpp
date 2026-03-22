export interface ApiEnvelope<T> {
	code: string;
	message: string;
	data: T;
	request_id: string;
	ts: string;
}

export class ApiClient {
	constructor(private readonly baseUrl: string = '/api/v2') {}

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
}
