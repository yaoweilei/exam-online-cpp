/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AvatarPreset, AvatarSeed } from './types.js';
import { svgToDataUri } from './utils.js';

export function renderAccessory(kind: AvatarSeed['accessory'], accent: string, line: string): string {
	const bubble = (inner: string) =>
		`<g transform="translate(62 58)">
			<circle cx="10" cy="10" r="9.8" fill="#fff"/>
			<circle cx="10" cy="10" r="8.7" fill="none" stroke="${accent}" stroke-width="1.7"/>
			${inner}
		</g>`;

	switch (kind) {
		case 'glasses':
			return `<g fill="none" stroke="${line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="40.5" cy="46" r="4.3"/>
				<circle cx="55.5" cy="46" r="4.3"/>
				<path d="M44.8 46h6.4"/>
			</g>`;
		case 'badge':
			return bubble(`<circle cx="10" cy="8.2" r="2.6" fill="none" stroke="${accent}" stroke-width="1.5"/><path d="M7.5 13 9.2 10.5 10 12.5 10.8 10.5 12.5 13" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
		case 'star':
			return bubble(`<path d="M10 4.1 11.9 7.8 16 8.3 13 11 13.9 15.1 10 13 6.1 15.1 7 11 4 8.3 8.1 7.8Z" fill="${accent}"/>`);
		case 'book':
			return bubble(`<g fill="none" stroke="${accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 6.4h4.9a2 2 0 0 1 2 2v5H7.5a2.1 2.1 0 0 0-2.3 2.1Z"/><path d="M14.8 6.4H10a2 2 0 0 0-2 2v7.1a2.1 2.1 0 0 1 2.3-2.1h4.5Z"/></g>`);
		case 'bolt':
			return bubble(`<path d="M11.2 3.9 7.2 9.6h3.2l-1.7 6.1 5.6-7.3h-3.1Z" fill="${accent}"/>`);
		case 'leaf':
			return bubble(`<g fill="none" stroke="${accent}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M14.9 5.4c-5.3 0-8.5 3.5-8.5 8.1 0 1 .2 1.9.5 2.7 5.2-.2 9.2-4.1 9.5-9.2-.4-.1-1-.2-1.5-.2Z"/><path d="M7.1 15.5c2-2 4.5-4 7.2-5.6"/></g>`);
		case 'ribbon':
			return `<g fill="none" stroke="${accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M34.5 24.5c1.8 0 3.1 1.1 3.1 2.8 0 1.5-.8 2.8-2.9 4.3"/><path d="M61.5 24.5c-1.8 0-3.1 1.1-3.1 2.8 0 1.5.8 2.8 2.9 4.3"/></g>`;
		case 'none':
		default:
			return '';
	}
}

export function renderHair(kind: AvatarSeed['hairStyle'], color: string): string {
	switch (kind) {
		case 'part':
			return `<path d="M30.4 39c.7-11.7 8.5-20 18.2-20 8.2 0 15.9 5.9 18.5 16.3-5.7-3.3-11.4-4.6-16.6-4.6l-3.3 4.4-1.7-4.4c-4.6.5-9.2 3-15.1 8.3Z" fill="${color}"/>`;
		case 'bob':
			return `<path d="M28.8 36.8c1-11.3 8.8-19.2 19.2-19.2 10.9 0 19.1 8.1 19.6 19.5-1 4.8-3.1 8-6 10-2.8-5.6-7.4-8.2-13.5-8.2-6.2 0-10.9 2.7-13.9 8.3-3.7-2.3-5.1-5.8-5.4-10.4Z" fill="${color}"/>`;
		case 'buzz':
			return `<path d="M31.6 38c2.9-9.7 10.4-15.3 17.5-15.3 9.1 0 16 5.9 18.1 15.6-6.1-2.5-12.1-3.7-18-3.7-5.9 0-11.9 1.2-17.6 3.4Z" fill="${color}"/>`;
		case 'wave':
			return `<path d="M27.8 39c1.3-11.7 9.7-20.1 20.3-20.1 9.1 0 16.9 6.2 19.8 16.5-4.4-3-7.7-4.4-10.9-4.4-4.1 0-7.4 1.5-10.1 4.3-2.7-1.7-5.1-2.4-7.6-2.4-3.8 0-7.2 1.8-11.5 6.1Z" fill="${color}"/>`;
		case 'cap':
			return `<path d="M28.2 37.2c3.7-9.8 11.5-15.7 21.3-15.7 8.2 0 15.3 3.9 20 10.1L29 37.8Z" fill="${color}"/><path d="M28.8 37.8h41.6c-2 4.7-6.7 7.2-13.8 7.2H40.1c-5.8 0-9.6-2.3-11.3-7.2Z" fill="${color}" opacity="0.95"/>`;
		case 'short':
		default:
			return `<path d="M30.2 39c.6-11.1 8.4-19.4 18.5-19.4 10.7 0 18.4 7.9 19 19.2-4.8-4.9-10.8-7-18.6-7-7.1 0-13.3 2.2-18.9 7.2Z" fill="${color}"/>`;
	}
}

export function buildAvatarSvg(seed: AvatarSeed): string {
	const gradientId = `bg-${seed.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
	const shirtId = `shirt-${seed.id}`.replace(/[^a-zA-Z0-9_-]/g, '');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${seed.label}">
		<defs>
			<linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="#ffffff"/>
				<stop offset="100%" stop-color="${seed.palette.bg}"/>
			</linearGradient>
			<linearGradient id="${shirtId}" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="${seed.palette.shirt}"/>
				<stop offset="100%" stop-color="${seed.palette.accent}"/>
			</linearGradient>
		</defs>
		<rect width="96" height="96" rx="24" fill="url(#${gradientId})"/>
		<circle cx="78" cy="18" r="11" fill="${seed.palette.accent}" opacity="0.1"/>
		<circle cx="18" cy="77" r="14" fill="${seed.palette.accent}" opacity="0.08"/>
		<path d="M14 96c3-17.8 16-31.4 34-31.4S79 78.2 82 96" fill="url(#${shirtId})"/>
		<path d="M30 96c2.2-10.8 9.2-17.2 18-17.2s15.8 6.4 18 17.2" fill="${seed.palette.shirt}" opacity="0.88"/>
		<path d="M42 57h12v11.2a6 6 0 0 1-12 0Z" fill="${seed.palette.skin}"/>
		<circle cx="31.2" cy="43.8" r="3.3" fill="${seed.palette.skin}" opacity="0.92"/>
		<circle cx="64.8" cy="43.8" r="3.3" fill="${seed.palette.skin}" opacity="0.92"/>
		<circle cx="48" cy="42.4" r="18.8" fill="${seed.palette.skin}"/>
		${renderHair(seed.hairStyle, seed.palette.hair)}
		<path d="M37.6 41.3c1-.8 2.2-1.2 3.5-1.2 1.1 0 2.3.4 3.5 1.2" fill="none" stroke="${seed.palette.line}" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
		<path d="M51.4 41.3c1-.8 2.2-1.2 3.5-1.2 1.1 0 2.3.4 3.5 1.2" fill="none" stroke="${seed.palette.line}" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
		<ellipse cx="40.6" cy="46.1" rx="1.9" ry="2.1" fill="${seed.palette.line}"/>
		<ellipse cx="55.4" cy="46.1" rx="1.9" ry="2.1" fill="${seed.palette.line}"/>
		<path d="M48 46.8v3.5" fill="none" stroke="${seed.palette.line}" stroke-width="1.4" stroke-linecap="round" opacity="0.45"/>
		<path d="M42.8 53.1c1.9 2.3 4 3.1 5.2 3.1 1.4 0 3.4-.8 5.2-3.1" fill="none" stroke="${seed.palette.line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
		<circle cx="37.2" cy="50.8" r="2.1" fill="${seed.palette.accent}" opacity="0.12"/>
		<circle cx="58.8" cy="50.8" r="2.1" fill="${seed.palette.accent}" opacity="0.12"/>
		${renderAccessory(seed.accessory, seed.palette.accent, seed.palette.line)}
	</svg>`;
}

export function buildEmojiAvatarSvg(label: string, emoji: string, background: string, accent: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${label}">
		<rect width="96" height="96" rx="24" fill="${background}"/>
		<circle cx="76" cy="20" r="10" fill="${accent}" opacity="0.14"/>
		<circle cx="18" cy="78" r="14" fill="${accent}" opacity="0.1"/>
		<rect x="12" y="12" width="72" height="72" rx="22" fill="#fff" opacity="0.82"/>
		<text x="48" y="55" text-anchor="middle" font-size="36" font-family="'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
	</svg>`;
}

export function buildAvatarPresets(): AvatarPreset[] {
	const presets = [
		{ id: 'student-female', label: '女学生', role: '学生', emoji: '👩‍🎓', background: '#eef4ff', accent: '#5b7cf1' },
		{ id: 'student-male', label: '男学生', role: '学生', emoji: '👨‍🎓', background: '#edf7ff', accent: '#4e8dda' },
		{ id: 'teacher-female', label: '女教师', role: '教师', emoji: '👩‍🏫', background: '#fff3ea', accent: '#cb8c4a' },
		{ id: 'teacher-male', label: '男教师', role: '教师', emoji: '👨‍🏫', background: '#fff6e7', accent: '#b98743' },
		{ id: 'admin-female', label: '女管理员', role: '管理员', emoji: '👩‍💼', background: '#f4f1ff', accent: '#7f6ad6' },
		{ id: 'admin-male', label: '男管理员', role: '管理员', emoji: '👨‍💼', background: '#eff4f8', accent: '#71839a' },
		{ id: 'reviewer', label: '阅卷员', role: '阅卷', emoji: '🧑‍⚖️', background: '#fff0f6', accent: '#c86b93' },
		{ id: 'superadmin', label: '超级管理员', role: '超管', emoji: '👑', background: '#fff8e9', accent: '#cf9622' }
	];

	return [
		{ id: 'default', label: '默认', role: '系统', avatarUrl: '' },
		...presets.map((preset) => ({
			id: preset.id,
			label: preset.label,
			role: preset.role,
			avatarUrl: svgToDataUri(buildEmojiAvatarSvg(preset.label, preset.emoji, preset.background, preset.accent))
		}))
	];
}
