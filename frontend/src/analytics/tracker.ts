export class Tracker {
	static log(event: string, payload: Record<string, unknown> = {}): void {
		if ((window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__) {
			console.log(`[tracker] ${event}`, payload);
		}
	}
}
