import { ApiClient } from './api/client.js';
import { loadExams } from './features/exams.js';
import { bootViewerApp } from './features/viewerBootstrap.js';
import { restoreSession, clearSession } from './features/session.js';
import { AppStore } from './state/store.js';
import { LoginModal } from './features/login.js';

function logAppReady(levels: number): void {
	if (!(window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__) {
		return;
	}

	console.log('[app] app_ready', { levels });
}

async function bootstrap(): Promise<void> {
	(window as Window & { __API_BASE__?: string; __WEB_APP_MODE__?: boolean; __APP_DEBUG__?: boolean }).__API_BASE__ =
		'/api/v2';
	(window as Window & { __WEB_APP_MODE__?: boolean }).__WEB_APP_MODE__ = true;
	(window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__ = false;

	const api = new ApiClient('/api/v2');
	const store = new AppStore();
	const loginModal = new LoginModal(api, store);
	const appWindow = window as Window & {
		__openLoginModal?: () => void;
		__onLoginSuccess?: () => void;
		setUserContext?: (ctx: Record<string, unknown>) => void;
		refreshPersonalCenterTrigger?: () => Promise<void> | void;
		logoutUser?: () => void;
	};

	const userBar = document.getElementById('user-bar');
	const loginEntryBtn = document.getElementById('login-entry-btn');
	userBar?.setAttribute('style', 'display:none');

	function syncViewerUserState(): void {
		const currentUser = store.getState().user;
		if (currentUser && !currentUser.guest) {
			appWindow.setUserContext?.(currentUser as unknown as Record<string, unknown>);
			return;
		}
		appWindow.setUserContext?.({ guest: true });
		appWindow.refreshPersonalCenterTrigger?.();
	}

	void restoreSession(api, store).finally(() => {
		syncViewerUserState();
	});

	appWindow.__openLoginModal = () => loginModal.open();
	loginEntryBtn?.addEventListener('click', () => loginModal.open());
	appWindow.__onLoginSuccess = () => {
		syncViewerUserState();
	};

	try {
		await loadExams(api, store);
	} catch (error) {
		console.error('[main] loadExams failed, fallback to viewer bootstrap fetch:', error);
	}
	await bootViewerApp();
	syncViewerUserState();

	const viewerLogout = appWindow.logoutUser;
	appWindow.logoutUser = async () => {
		const currentUser = store.getState().user;
		const token = !currentUser.guest ? currentUser.token : '';
		viewerLogout?.();
		if (token) {
			try {
				await api.logout(token);
			} catch (error) {
				console.warn('[main] backend logout failed:', error);
			}
		}
		clearSession(store);
		syncViewerUserState();
	};

	logAppReady(Object.keys(store.getState().examsByLevel).length);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		void bootstrap();
	});
} else {
	void bootstrap();
}
