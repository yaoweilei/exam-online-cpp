import type { ApiClient } from '../api/client.js';
import type { CurrentUser, MeContext } from '../api/dto.js';
import { AppStore } from '../state/store.js';

const USER_KEY = 'exam_v2_user';
const TOKEN_KEY = 'exam_v2_token';

export function buildCurrentUser(context: MeContext, token: string): CurrentUser {
	return {
		...context.user,
		guest: false,
		token,
		profile: context.profile,
		membership: context.membership,
		permissions: context.permissions,
		session_expires_at: context.session.expires_at ?? '',
		subscription: context.subscription
	};
}

export async function restoreSession(api: ApiClient, store: AppStore): Promise<void> {
	try {
		const token = localStorage.getItem(TOKEN_KEY) ?? '';
		if (!token) return;

		const context = (await api.getMeContext(token)) as MeContext;
		const user = buildCurrentUser(context, token);
		persistSession(user);
		store.setState({ user });
	} catch {
		clearSession(store);
	}
}

export function persistSession(user: CurrentUser): void {
	localStorage.setItem(USER_KEY, JSON.stringify(user));
	localStorage.setItem(TOKEN_KEY, user.token);
}

export function clearSession(store: AppStore): void {
	localStorage.removeItem(USER_KEY);
	localStorage.removeItem(TOKEN_KEY);
	store.setState({ user: { guest: true } });
}
