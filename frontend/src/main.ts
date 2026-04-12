import { ApiClient } from './api/client.js';
import type { CurrentUser } from './api/dto.js';
import { Tracker } from './analytics/tracker.js';
import { loadExams } from './features/exams.js';
import { bootViewerApp } from './features/viewerBootstrap.js';
import { restoreSession, clearSession } from './features/session.js';
import { AppStore } from './state/store.js';
import { LoginModal } from './features/login.js';

async function bootstrap(): Promise<void> {
	(window as Window & { __API_BASE__?: string; __WEB_APP_MODE__?: boolean; __APP_DEBUG__?: boolean }).__API_BASE__ =
		'/api/v2';
	(window as Window & { __WEB_APP_MODE__?: boolean }).__WEB_APP_MODE__ = true;
	(window as Window & { __APP_DEBUG__?: boolean }).__APP_DEBUG__ = false;

	const api = new ApiClient('/api/v2');
	const store = new AppStore();
	await restoreSession(api, store);

	// --- User bar wiring ---
	const loginModal = new LoginModal(api, store);
	(window as Window & { __openLoginModal?: () => void }).__openLoginModal = () => loginModal.open();

	const loginEntryBtn = document.getElementById('login-entry-btn');
	const userInfoBar   = document.getElementById('user-info-bar');
	const userDisplay   = document.getElementById('user-display');
	const logoutBtn     = document.getElementById('logout-btn');

	function refreshUserBar(): void {
		const state = store.getState();
		const loggedIn = !state.user.guest && state.user.user_id;
		if (loggedIn) {
			loginEntryBtn?.setAttribute('style', 'display:none');
			if (userInfoBar) userInfoBar.style.display = '';
			if (userDisplay) {
				const currentUser = state.user as CurrentUser;
				userDisplay.textContent = currentUser.display_name || currentUser.username || '';
			}
		} else {
			if (loginEntryBtn) loginEntryBtn.style.display = '';
			userInfoBar?.setAttribute('style', 'display:none');
		}
	}

	function toViewerUserContext(user: CurrentUser): Record<string, unknown> {
		return {
			id: user.user_id,
			userId: user.user_id,
			username: user.username,
			displayName: user.display_name || user.displayName || user.username,
			roles: user.roles,
			roleIds: user.role_ids,
			email: user.email,
			avatar: user.avatar_url || user.avatar || null,
			lastLoginAt: user.last_active_at || user.lastLoginAt || '',
			status: user.status,
			balance: user.balance,
			scopeType: user.scope_type,
			scopeId: user.scope_id,
			organizationType: user.organization_type,
			plan: user.plan,
			planStatus: user.plan_status,
			planExpiresAt: user.plan_expires_at,
			subscription: user.subscription,
			permissions: user.permissions,
			accessibleLevels: user.accessible_levels,
			guest: false
		};
	}

	refreshUserBar();
	loginEntryBtn?.addEventListener('click', () => loginModal.open());

	try {
		await loadExams(api, store);
	} catch (error) {
		console.error('[main] loadExams failed, fallback to viewer bootstrap fetch:', error);
	}
	await bootViewerApp();

	const viewerLogout = window.logoutUser;
	const viewerSetUserContext = window.setUserContext;
	const syncViewerContext = (): void => {
		const currentUser = store.getState().user;
		if (currentUser.guest) {
			viewerLogout?.();
			return;
		}
		viewerSetUserContext?.(toViewerUserContext(currentUser));
		window.refreshPersonalCenterTrigger?.();
	};

	const handleLogout = (): void => {
		clearSession(store);
		refreshUserBar();
		viewerLogout?.();
		window.refreshPersonalCenterTrigger?.();
	};

	logoutBtn?.addEventListener('click', handleLogout);
	window.logoutUser = handleLogout;
	store.subscribe(() => {
		refreshUserBar();
		syncViewerContext();
	});
	syncViewerContext();

	(window as Window & { __onLoginSuccess?: () => void }).__onLoginSuccess = () => {
		refreshUserBar();
		syncViewerContext();
	};

	Tracker.log('app_ready', { levels: Object.keys(store.getState().examsByLevel).length });
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		void bootstrap();
	});
} else {
	void bootstrap();
}
