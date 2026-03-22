export class ApiClient {
    baseUrl;
    constructor(baseUrl = '/api/v2') {
        this.baseUrl = baseUrl;
    }
    buildUrl(path) {
        if (path.startsWith('http://') || path.startsWith('https://'))
            return path;
        return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }
    async request(path, options = {}) {
        const response = await fetch(this.buildUrl(path), {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers ?? {})
            },
            ...options
        });
        const payload = (await response.json().catch(() => ({})));
        const isEnvelope = Object.prototype.hasOwnProperty.call(payload, 'code');
        const data = isEnvelope ? payload.data : payload;
        const code = isEnvelope ? payload.code : 'OK';
        const message = isEnvelope ? payload.message : '';
        if (!response.ok || code !== 'OK') {
            throw new Error(message || `HTTP ${response.status}`);
        }
        return data;
    }
}
//# sourceMappingURL=client.js.map