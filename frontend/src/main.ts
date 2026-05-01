import { ApiClient } from './api/client.js';
import { loadExams } from './features/exams.js';
import { bootViewerApp } from './features/viewerBootstrap.js';
import { restoreSession, clearSession, captureReferralCodeFromUrl } from './features/session.js';
import { AppStore } from './state/store.js';
import { LoginModal } from './features/login.js';
import { refreshFeatureFlags, clearFeatureFlags } from './features/featureFlags.js';
import { initPwa, ensurePwaRegistration } from './features/pwa.js';

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
	captureReferralCodeFromUrl();

	// 业务功能 14：尽早初始化 PWA（捕获 beforeinstallprompt 与默认注册）
	initPwa();

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

	function syncViewerUserState(): void {
		const currentUser = store.getState().user;
		if (currentUser && !currentUser.guest) {
			appWindow.setUserContext?.(currentUser as unknown as Record<string, unknown>);
			// 登录后异步拉取功能开关，注入到 window.__FEATURE_FLAGS__
			void refreshFeatureFlags(api).then(() => ensurePwaRegistration());
			return;
		}
		// 注销 / guest：清空功能开关缓存（前端按默认开启对待）
		clearFeatureFlags();
		void ensurePwaRegistration();
		appWindow.setUserContext?.({ guest: true });
		appWindow.refreshPersonalCenterTrigger?.();
	}

	void restoreSession(api, store).finally(() => {
		syncViewerUserState();
	});

	appWindow.__openLoginModal = () => loginModal.open();
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
