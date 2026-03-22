import { AppStore } from '../state/store.js';

const USER_KEY = 'exam_v2_user';
const TOKEN_KEY = 'exam_v2_token';

export function restoreSession(store: AppStore): void {
	try {
		const raw = localStorage.getItem(USER_KEY);
		if (!raw) return;
		const user = JSON.parse(raw) as { user_id?: string; username?: string; token?: string };
		store.setState({ user: { ...user, guest: false } });
	} catch {
		// ignore invalid local cache
	}
}

export function persistSession(payload: unknown): void {
	localStorage.setItem(USER_KEY, JSON.stringify(payload));
	const token = (payload as { token?: string }).token ?? '';
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession(store: AppStore): void {
	localStorage.removeItem(USER_KEY);
	localStorage.removeItem(TOKEN_KEY);
	store.setState({ user: { guest: true } });
}
