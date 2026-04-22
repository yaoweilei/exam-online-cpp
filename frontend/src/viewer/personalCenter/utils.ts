/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PCContext } from './types.js';

export function escapeHtml(v: unknown): string {
	return String(v).replace(/[&<>'"`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;', '`': '&#96;' }[c] || c));
}

export function svgToDataUri(svg: string): string {
	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readCount(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function deriveFallbackDisplayName(ctx: PCContext): string {
	const username = (ctx.username || '').trim();
	if (username) {
		return username;
	}
	const rawId = (ctx.id || '').trim();
	if (!rawId) {
		return '我的账号';
	}
	const normalized = rawId.replace(/^usr_/, '');
	return `用户${normalized.slice(0, 6)}`;
}

export function preferredDisplayName(ctx: PCContext): string {
	const explicit = (ctx.displayName || '').trim();
	if (explicit) {
		return explicit;
	}
	return deriveFallbackDisplayName(ctx);
}

export function triggerMonogram(ctx: PCContext): string {
	const text = preferredDisplayName(ctx).trim();
	if (!text) {
		return '我';
	}
	const [first = '我'] = Array.from(text);
	return /^[A-Za-z0-9]$/.test(first) ? first.toUpperCase() : first;
}
