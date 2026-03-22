import { ApiClient } from './api/client.js';
import { Tracker } from './analytics/tracker.js';
import { loadExams } from './features/exams.js';
import { bootViewerApp } from './features/viewerBootstrap.js';
import { restoreSession } from './features/session.js';
import { AppStore } from './state/store.js';
async function bootstrap() {
    window.__API_BASE__ =
        '/api/v2';
    window.__WEB_APP_MODE__ = true;
    window.__APP_DEBUG__ = false;
    const api = new ApiClient('/api/v2');
    const store = new AppStore();
    restoreSession(store);
    try {
        await loadExams(api, store);
    }
    catch (error) {
        console.error('[main] loadExams failed, fallback to viewer bootstrap fetch:', error);
    }
    await bootViewerApp();
    Tracker.log('app_ready', { levels: Object.keys(store.getState().examsByLevel).length });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrap();
    });
}
else {
    void bootstrap();
}
//# sourceMappingURL=main.js.map