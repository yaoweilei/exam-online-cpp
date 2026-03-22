import { ApiClient } from './api/client.js';
import { Tracker } from './analytics/tracker.js';
import { loadExams } from './features/exams.js';
import { bootViewerApp } from './features/viewerBootstrap.js';
import { restoreSession } from './features/session.js';
import { AppStore } from './state/store.js';

async function bootstrap(): Promise<void> {
	(window as Window & { __API_BASE__?: string; __WEB_APP_MODE__?: boolean; __APP_DEBUG__?: boolean }).__API_BASE__ =
		'/api/v2';
	(window as Window & { __WEB_APP_MODE__?: boolean }).__WEB_APP_MODE__ = true;
	(window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__ = false;

	const api = new ApiClient('/api/v2');
	const store = new AppStore();
	restoreSession(store);

	try {
		await loadExams(api, store);
	} catch (error) {
		console.error('[main] loadExams failed, fallback to viewer bootstrap fetch:', error);
	}
	await bootViewerApp();
	Tracker.log('app_ready', { levels: Object.keys(store.getState().examsByLevel).length });
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		void bootstrap();
	});
} else {
	void bootstrap();
}
