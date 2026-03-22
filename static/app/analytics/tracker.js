export class Tracker {
    static log(event, payload = {}) {
        if (window.__APP_DEBUG__) {
            console.log(`[tracker] ${event}`, payload);
        }
    }
}
//# sourceMappingURL=tracker.js.map