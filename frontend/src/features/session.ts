import type { ApiClient } from '../api/client.js';
import type { CurrentUser, MeContext } from '../api/dto.js';
import { AppStore } from '../state/store.js';

const USER_KEY = 'exam_v2_user';
const TOKEN_KEY = 'exam_v2_token';
const DEVICE_ID_KEY = 'exam_v2_device_id';
const DEVICE_INFO_KEY = 'exam_v2_device_info';
const REFERRAL_CODE_KEY = 'exam_v2_referral_code';

function generateDeviceId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `dev_${crypto.randomUUID()}`;
	}
	return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateDeviceId(): string {
	const existing = localStorage.getItem(DEVICE_ID_KEY) ?? '';
	if (existing) {
		return existing;
	}
	const next = generateDeviceId();
	localStorage.setItem(DEVICE_ID_KEY, next);
	return next;
}

function readPlatform(): string {
	const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
	return nav.userAgentData?.platform || nav.platform || 'unknown';
}

function recordDeviceActivity(userId = ''): void {
	try {
		const raw = localStorage.getItem(DEVICE_INFO_KEY);
		const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		const now = new Date().toISOString();
		const deviceId = getOrCreateDeviceId();
		const screenLabel = typeof window !== 'undefined' && window.screen ? `${window.screen.width}x${window.screen.height}` : 'unknown';
		const linkedUserId = userId || (typeof existing.linked_user_id === 'string' ? existing.linked_user_id : '');
		localStorage.setItem(
			DEVICE_INFO_KEY,
			JSON.stringify({
				device_id: deviceId,
				linked_user_id: linkedUserId,
				first_seen_at: typeof existing.first_seen_at === 'string' ? existing.first_seen_at : now,
				last_seen_at: now,
				user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
				platform: typeof navigator !== 'undefined' ? readPlatform() : 'unknown',
				language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
				screen: screenLabel,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
			})
		);
	} catch {
		// Ignore storage failures and keep login flow unaffected.
	}
}

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
		recordDeviceActivity();
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
	const rawUser = user as CurrentUser & Record<string, unknown>;
	const linkedUserId =
		(typeof rawUser.user_id === 'string' && rawUser.user_id) ||
		(typeof rawUser.id === 'string' && rawUser.id) ||
		'';
	localStorage.setItem(USER_KEY, JSON.stringify(user));
	localStorage.setItem(TOKEN_KEY, user.token);
	recordDeviceActivity(linkedUserId);
}

export function clearSession(store: AppStore): void {
	recordDeviceActivity();
	localStorage.removeItem(USER_KEY);
	localStorage.removeItem(TOKEN_KEY);
	store.setState({ user: { guest: true } });
}

export function captureReferralCodeFromUrl(): string {
	try {
		const params = new URLSearchParams(window.location.search);
		const raw = (params.get('ref') || params.get('referral_code') || '').trim();
		const normalized = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
		if (!normalized) {
			return '';
		}
		localStorage.setItem(REFERRAL_CODE_KEY, normalized);
		return normalized;
	} catch {
		return '';
	}
}

export function readPendingReferralCode(): string {
	try {
		return (localStorage.getItem(REFERRAL_CODE_KEY) || '').trim().toUpperCase();
	} catch {
		return '';
	}
}

export function clearPendingReferralCode(): void {
	try {
		localStorage.removeItem(REFERRAL_CODE_KEY);
	} catch {
		// Ignore storage failures and keep auth flow unaffected.
	}
}
