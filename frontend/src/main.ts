import { ApiClient } from './api/client.js';
import { loadExams } from './features/exams.js';
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
	const viewerBootstrapUrl = new URL(
		'./features/viewerBootstrap.js?v=20261002-practice-close-v1',
		import.meta.url
	).href;
	const { bootViewerApp } = await import(viewerBootstrapUrl) as typeof import('./features/viewerBootstrap.js');
	(window as Window & { __API_BASE__?: string; __WEB_APP_MODE__?: boolean; __APP_DEBUG__?: boolean }).__API_BASE__ =
		'/api/v1';
	(window as Window & { __WEB_APP_MODE__?: boolean }).__WEB_APP_MODE__ = true;
	(window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__ = false;
	captureReferralCodeFromUrl();

	// 业务功能 14：尽早初始化 PWA（捕获 beforeinstallprompt 与默认注册）
	initPwa();

	const api = new ApiClient('/api/v1');
	const store = new AppStore();
	const loginModal = new LoginModal(api, store);
	const appWindow = window as Window & {
		__openLoginModal?: () => void;
		__onLoginSuccess?: () => void;
		setUserContext?: (ctx: Record<string, unknown>) => void;
		refreshPersonalCenterTrigger?: () => Promise<void> | void;
		logoutUser?: () => void;
		UserContextManager?: { getInstance: () => { setUserContext: (ctx: Record<string, unknown>) => void } };
	};
	function applyUserContext(context: Record<string, unknown>): void {
		if (appWindow.setUserContext) appWindow.setUserContext(context);
		else appWindow.UserContextManager?.getInstance().setUserContext(context);
	}

	function syncViewerUserState(): void {
		const currentUser = store.getState().user;
		if (currentUser && !currentUser.guest) {
			applyUserContext(currentUser as unknown as Record<string, unknown>);
			// 登录后异步拉取功能开关，注入到 window.__FEATURE_FLAGS__
			void refreshFeatureFlags(api).then(() => ensurePwaRegistration());
			return;
		}
		// 注销 / guest：清空功能开关缓存（前端按默认开启对待）
		clearFeatureFlags();
		void ensurePwaRegistration();
		applyUserContext({ guest: true });
		appWindow.refreshPersonalCenterTrigger?.();
	}

	const sessionReady = restoreSession(api, store).finally(() => {
		syncViewerUserState();
	});
	window.addEventListener('examViewerReady', syncViewerUserState, { once: true });

	appWindow.__openLoginModal = () => loginModal.open();
	appWindow.__onLoginSuccess = () => {
		syncViewerUserState();
	};

	// Fetch the exam directory while the viewer modules are downloading. On a
	// cold LAN visit this removes an entire serial network phase from startup.
	const examsReady = loadExams(api, store).catch((error) => {
		console.error('[main] loadExams failed, fallback to viewer bootstrap fetch:', error);
	});
	await bootViewerApp(examsReady);
	await sessionReady;
	syncViewerUserState();
	const guestWelcomeUrl = new URL('./features/guestWelcome.js?v=20261002-guest-record-quota-v1', import.meta.url).href;
	const { initGuestWelcome } = await import(guestWelcomeUrl) as typeof import('./features/guestWelcome.js');
	initGuestWelcome(api, store, () => loginModal.open());
	const learningShellUrl = new URL('./features/learningShell.js?v=20261002-tablet-three-columns-v1', import.meta.url).href;
	const { initLearningShell } = await import(learningShellUrl) as typeof import('./features/learningShell.js');
	initLearningShell(store);

	const viewerLogout = appWindow.logoutUser;
	appWindow.logoutUser = async () => {
		const currentUser = store.getState().user;
		const wasAuthenticated = !currentUser.guest;
		const token = wasAuthenticated && currentUser.token
			? currentUser.token
			: '__cookie_session__';
		if (wasAuthenticated) {
			try {
				await api.logout(token);
			} catch (error) {
				console.warn('[main] backend logout failed:', error);
			}
		}
		viewerLogout?.();
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
