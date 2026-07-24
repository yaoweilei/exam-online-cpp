/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as adventurerNeutral from '@dicebear/adventurer-neutral';
import * as avataaars from '@dicebear/avataaars';
import * as avataaarsNeutral from '@dicebear/avataaars-neutral';
import * as bigEars from '@dicebear/big-ears';
import * as bigEarsNeutral from '@dicebear/big-ears-neutral';
import * as bigSmile from '@dicebear/big-smile';
import * as bottts from '@dicebear/bottts';
import * as botttsNeutral from '@dicebear/bottts-neutral';
import * as croodles from '@dicebear/croodles';
import * as croodlesNeutral from '@dicebear/croodles-neutral';
import * as dylan from '@dicebear/dylan';
import * as funEmoji from '@dicebear/fun-emoji';
import * as lorelei from '@dicebear/lorelei';
import * as loreleiNeutral from '@dicebear/lorelei-neutral';
import * as micah from '@dicebear/micah';
import * as miniavs from '@dicebear/miniavs';
import * as notionists from '@dicebear/notionists';
import * as notionistsNeutral from '@dicebear/notionists-neutral';
import * as openPeeps from '@dicebear/open-peeps';
import * as personas from '@dicebear/personas';
import * as pixelArt from '@dicebear/pixel-art';
import * as thumbs from '@dicebear/thumbs';
import * as toonHead from '@dicebear/toon-head';
import type { AvatarPreset } from './types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface StyleInfo {
	key: string;
	displayName: string;
	style: Record<string, unknown>;
	thumbnail: string;
}

export interface ControlDef {
	key: string;
	label: string;
	type: 'select' | 'toggle' | 'color';
	options?: string[];
	defaultValue?: string | boolean | null;
	parentKey?: string; // for toggles, the component they control
}

export interface TabDef {
	id: string;
	label: string;
	controls: ControlDef[];
}

export interface EditorState {
	styleKey: string;
	seed: string;
	options: Record<string, string | boolean | null>;
}

/* ------------------------------------------------------------------ */
/*  Style registry                                                    */
/* ------------------------------------------------------------------ */

const ALL_STYLES: Record<string, Record<string, unknown>> = {
	adventurer, adventurerNeutral, avataaars, avataaarsNeutral,
	bigEars, bigEarsNeutral, bigSmile, bottts, botttsNeutral,
	croodles, croodlesNeutral, dylan, funEmoji,
	lorelei, loreleiNeutral, micah, miniavs,
	notionists, notionistsNeutral, openPeeps, personas, pixelArt,
	thumbs, toonHead,
};

const STYLE_DISPLAY_NAMES: Record<string, string> = {
	adventurer: 'Adventurer', adventurerNeutral: 'Adventurer N',
	avataaars: 'Avataaars', avataaarsNeutral: 'Avataaars N',
	bigEars: 'Big Ears', bigEarsNeutral: 'Big Ears N',
	bigSmile: 'Big Smile', bottts: 'Bottts', botttsNeutral: 'Bottts N',
	croodles: 'Croodles', croodlesNeutral: 'Croodles N',
	dylan: 'Dylan', funEmoji: 'Fun Emoji',
	lorelei: 'Lorelei', loreleiNeutral: 'Lorelei N',
	micah: 'Micah', miniavs: 'Mini Avs',
	notionists: 'Notionists', notionistsNeutral: 'Notionists N',
	openPeeps: 'Open Peeps', personas: 'Personas',
	pixelArt: 'Pixel Art',
	thumbs: 'Thumbs', toonHead: 'Toon Head',
};

let styleRegistry: StyleInfo[] | null = null;

export function buildStyleRegistry(): StyleInfo[] {
	if (styleRegistry) return styleRegistry;
	styleRegistry = Object.keys(ALL_STYLES).map((key) => {
		const style = ALL_STYLES[key];
		return {
			key,
			displayName: STYLE_DISPLAY_NAMES[key] || key,
			style,
			thumbnail: createAvatar(style as any, { seed: 'preview' }).toDataUri(),
		};
	});
	return styleRegistry;
}

export function getStyleByKey(key: string): Record<string, unknown> | undefined {
	return ALL_STYLES[key];
}

/* ------------------------------------------------------------------ */
/*  Schema parsing → TabDef[]                                         */
/* ------------------------------------------------------------------ */

const FACE_KEYS = new Set(['hair', 'eyes', 'mouth', 'nose', 'head', 'base', 'eyebrows', 'eye', 'eyebrow']);
const ACC_KEYS = new Set(['glasses', 'beard', 'earrings', 'freckles', 'accessories', 'features', 'hairAccessories']);

export function parseStyleSchema(style: Record<string, unknown>): TabDef[] {
	const schema = (style as any)?.schema;
	if (!schema?.properties) {
		return [{ id: 'basic', label: '基础', controls: [] }];
	}

	const props = schema.properties as Record<string, any>;
	const faceControls: ControlDef[] = [];
	const colorControls: ControlDef[] = [];
	const accControls: ControlDef[] = [];
	const handled = new Set<string>();

	// First pass: find all probability toggles and their parent keys
	const probs: Record<string, string> = {};
	for (const key of Object.keys(props)) {
		const m = key.match(/^(.*)Probability$/);
		if (m) probs[m[1]] = key;
	}

	for (const [key, prop] of Object.entries(props)) {
		if (handled.has(key)) continue;

		// Color properties
		if (key.endsWith('Color') || key.endsWith('colour')) {
			const items = prop.items || {};
			if (items.pattern?.includes('hex') || items.pattern?.includes('[a-fA-F0-9]')) {
				const parent = key.replace(/Color$/i, '').replace(/colour$/i, '');
				colorControls.push({
					key,
					label: labelForKey(key, parent),
					type: 'color',
					defaultValue: (prop.default?.[0] || '000000'),
				});
				handled.add(key);
				continue;
			}
		}

		// Probability → toggle
		if (key.endsWith('Probability')) {
			const parent = key.replace(/Probability$/, '');
			handled.add(key);
			if (props[parent]) {
				accControls.push({
					key,
					label: labelForKey(key, parent),
					type: 'toggle',
					defaultValue: false,
					parentKey: parent,
				});
			}
			continue;
		}

		// Array with enum → select
		if (prop.type === 'array' && prop.items?.enum) {
			const parent = key;
			const tab = assignTab(key, FACE_KEYS, ACC_KEYS);
			const target = tab === 'acc' ? accControls : faceControls;
			// If there's a linked probability toggle, skip the array — toggle handles it
			if (probs[key]) {
				// The toggle will control it
				continue;
			}
			target.push({
				key,
				label: labelForKey(key, ''),
				type: 'select',
				options: prop.items.enum,
				defaultValue: null, // null = random
			});
			handled.add(key);
			continue;
		}
	}

	const tabs: TabDef[] = [];
	if (faceControls.length > 0) tabs.push({ id: 'face', label: '面部', controls: faceControls });
	if (colorControls.length > 0) tabs.push({ id: 'colors', label: '颜色', controls: colorControls });
	if (accControls.length > 0) tabs.push({ id: 'acc', label: '配饰', controls: accControls });
	return tabs;
}

function assignTab(key: string, face: Set<string>, acc: Set<string>): 'face' | 'acc' {
	if (face.has(key)) return 'face';
	if (acc.has(key)) return 'acc';
	// Guess by prefix
	for (const f of face) if (key.startsWith(f)) return 'face';
	for (const a of acc) if (key.startsWith(a)) return 'acc';
	return 'face';
}

function labelForKey(key: string, parent: string): string {
	const enLabels: Record<string, string> = {
		hair: '发型', eyes: '眼睛', mouth: '嘴巴', nose: '鼻子',
		head: '头型', base: '基础', eyebrows: '眉毛', eyebrow: '眉毛',
		glasses: '眼镜', beard: '胡须', earrings: '耳环', freckles: '雀斑',
		features: '特征', hairAccessories: '发饰', accessories: '配饰',
		hairColor: '发色', skinColor: '肤色', eyesColor: '眼色',
		mouthColor: '唇色', glassesColor: '镜框色', beardColor: '胡须色',
		earringsColor: '耳环色', eyebrowsColor: '眉色', frecklesColor: '雀斑色',
		noseColor: '鼻色', hairAccessoriesColor: '发饰色',
		hairProbability: '发型出现', glassesProbability: '眼镜开关',
		beardProbability: '胡须开关', earringsProbability: '耳环开关',
		frecklesProbability: '雀斑开关', featuresProbability: '特征开关',
		hairAccessoriesProbability: '发饰开关',
	};
	return enLabels[key] || enLabels[parent] || key;
}

/* ------------------------------------------------------------------ */
/*  LORELEI-specific editor (for backward compat with current editor) */
/* ------------------------------------------------------------------ */

export interface AvatarEditorOptions {
	seed: string;
	hair: string | null;
	eyes: string | null;
	mouth: string | null;
	glasses: string | null;
	beard: string | null;
	hairColor: string;
	skinColor: string;
}

const HAIR_COLORS = [
	'000000', '2d1c0a', '4a2c1a', '6c4545', '7a4a3a',
	'8b4513', 'a55742', 'c46b3f', 'd99b5a', 'e8c48a',
	'f4e3c6', '1a1a2e', 'e05a5a', '2980b9', '27ae60',
	'f1c40f', 'c0392b', '8e44ad',
];
const SKIN_COLORS = [
	'f8d5c0', 'fce8d2', 'f0c8a0', 'e0ac80',
	'd4a574', 'c68e62', 'b57d52', 'a06b42',
	'8a5a35', '6a4526', '4a2c1a', 'dbb88e',
];
const HAIR_VARIANTS = Array.from({length: 48}, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const EYE_VARIANTS   = Array.from({length: 24}, (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const MOUTH_VARIANTS = [
	...Array.from({length: 18}, (_, i) => `happy${String(i + 1).padStart(2, '0')}`),
	...Array.from({length: 9},  (_, i) => `sad${String(i + 1).padStart(2, '0')}`),
];
const GLASS_VARIANTS = Array.from({length: 5},  (_, i) => `variant${String(i + 1).padStart(2, '0')}`);
const BEARD_VARIANTS = ['variant01', 'variant02'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function generateRandomSeed(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 12; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
	return result;
}

export function randomEditorOptions(): AvatarEditorOptions {
	return {
		seed:      generateRandomSeed(),
		hair:      pick(HAIR_VARIANTS),
		eyes:      pick(EYE_VARIANTS),
		mouth:     pick(MOUTH_VARIANTS),
		glasses:   Math.random() < 0.3 ? pick(GLASS_VARIANTS) : null,
		beard:     Math.random() < 0.2 ? pick(BEARD_VARIANTS) : null,
		hairColor: pick(HAIR_COLORS),
		skinColor: pick(SKIN_COLORS),
	};
}

export function optionsToAvatarUrl(options: AvatarEditorOptions): string {
	const opts: Record<string, unknown> = { seed: options.seed };
	if (options.hair !== null) opts.hair = [options.hair];
	if (options.eyes !== null) opts.eyes = [options.eyes];
	if (options.mouth !== null) opts.mouth = [options.mouth];
	if (options.glasses !== null) { opts.glasses = [options.glasses]; opts.glassesProbability = 100; }
	else { opts.glassesProbability = 0; }
	if (options.beard !== null) { opts.beard = [options.beard]; opts.beardProbability = 100; }
	else { opts.beardProbability = 0; }
	opts.hairColor = [options.hairColor];
	opts.skinColor = [options.skinColor];
	return createAvatar(lorelei as any, opts).toDataUri();
}

/* ------------------------------------------------------------------ */
/*  Multi-style avatar builder                                        */
/* ------------------------------------------------------------------ */

export function buildAvatarUrl(editorState: EditorState): string {
	const style = ALL_STYLES[editorState.styleKey];
	if (!style) return '';
	const opts: Record<string, unknown> = { seed: editorState.seed };
	const schema = (style as any)?.schema;
	const props: Record<string, any> = schema?.properties || {};

	for (const [key, value] of Object.entries(editorState.options)) {
		const prop = props[key];
		if (!prop) continue;
		if (key.endsWith('Probability')) {
			opts[key] = value ? 100 : 0;
		} else if (prop.type === 'array') {
			const items = prop.items || {};
			if (items.pattern?.includes('hex') || items.pattern?.includes('[a-fA-F0-9]')) {
				opts[key] = [value ?? prop.default?.[0] ?? '000000'];
			} else if (items.enum) {
				opts[key] = value ? [value] : undefined;
			}
		}
	}
	return createAvatar(style as any, opts).toDataUri();
}

/** Randomize all options for a given style */
export function randomizeEditorState(styleKey: string): EditorState {
	const style = ALL_STYLES[styleKey];
	const tabs = parseStyleSchema(style);
	const options: Record<string, string | boolean | null> = {};
	for (const tab of tabs) {
		for (const ctrl of tab.controls) {
			if (ctrl.type === 'toggle') {
				options[ctrl.key] = Math.random() < 0.3; // 30% chance on
			} else if (ctrl.type === 'select') {
				const opts = ctrl.options || [];
				options[ctrl.key] = Math.random() < 0.85 ? pick(opts) : null;
			} else if (ctrl.type === 'color') {
				options[ctrl.key] = ctrl.defaultValue as string;
			}
		}
	}
	return { styleKey, seed: generateRandomSeed(), options };
}

export function getHairVariants(): string[]        { return HAIR_VARIANTS; }
export function getEyeVariants(): string[]          { return EYE_VARIANTS; }
export function getMouthVariants(): string[]        { return MOUTH_VARIANTS; }
export function getGlassVariants(): string[]        { return GLASS_VARIANTS; }
export function getBeardVariants(): string[]        { return BEARD_VARIANTS; }
export function getHairColors(): string[]           { return HAIR_COLORS; }
export function getSkinColors(): string[]           { return SKIN_COLORS; }
export function getVariantLabel(v: string): string {
	if (v.startsWith('happy')) return `开心 ${v.replace('happy', '')}`;
	if (v.startsWith('sad'))   return `难过 ${v.replace('sad', '')}`;
	if (v.startsWith('variant')) return `样式 ${v.replace('variant', '')}`;
	return v;
}

/* ------------------------------------------------------------------ */
/*  Presets (unchanged)                                               */
/* ------------------------------------------------------------------ */

interface RolePreset {
	id: string;
	label: string;
	role: string;
	seed: string;
}

const ROLE_PRESETS: RolePreset[] = [
	{ id: 'ava-01', label: '元气少女', role: '活力', seed: 'Mochi' },
	{ id: 'ava-02', label: '短发酷哥', role: '清爽', seed: 'Bamboo' },
	{ id: 'ava-03', label: '温柔卷发', role: '亲和', seed: 'Honey' },
	{ id: 'ava-04', label: '眼镜学霸', role: '知识', seed: 'Splash' },
	{ id: 'ava-05', label: '马尾女孩', role: '阳光', seed: 'Nova' },
	{ id: 'ava-06', label: '辫子少年', role: '机灵', seed: 'Ember' },
	{ id: 'ava-07', label: '丸子头', role: '可爱', seed: 'Twilight' },
	{ id: 'ava-08', label: '长发御姐', role: '优雅', seed: 'Merlin' },
	{ id: 'ava-09', label: '刺头少年', role: '个性', seed: 'Zephyr' },
	{ id: 'ava-10', label: '双马尾', role: '甜美', seed: 'Frosty' },
	{ id: 'ava-11', label: '侧分短发', role: '干练', seed: 'Cotton' },
	{ id: 'ava-12', label: '贝雷帽', role: '文艺', seed: 'Luna' },
	{ id: 'ava-13', label: '棒球帽', role: '运动', seed: 'Simba' },
	{ id: 'ava-14', label: '麻花辫', role: '田园', seed: 'Maple' },
	{ id: 'ava-15', label: '大背头', role: '自信', seed: 'Athena' },
	{ id: 'ava-16', label: '披肩长发', role: '温婉', seed: 'Willow' },
	{ id: 'ava-17', label: '碎盖头', role: '慵懒', seed: 'Whisper' },
	{ id: 'ava-18', label: '半边辫', role: '俏皮', seed: 'Pixel' },
	{ id: 'ava-19', label: '羊毛卷', role: '复古', seed: 'Meadow' },
	{ id: 'ava-20', label: '寸头', role: '硬朗', seed: 'Cedar' },
	{ id: 'ava-21', label: '公主头', role: '优雅', seed: 'Rosie' },
	{ id: 'ava-22', label: '刘海短发', role: '清新', seed: 'Jasmine' },
	{ id: 'ava-23', label: '黑长直', role: '文静', seed: 'Sakura' },
	{ id: 'ava-24', label: '爆炸头', role: '嘻哈', seed: 'Rhythm' },
	{ id: 'ava-25', label: '高马尾', role: '飒爽', seed: 'Storm' },
	{ id: 'ava-26', label: '大胡子', role: '狂野', seed: 'Timber' },
	{ id: 'ava-27', label: '波波头', role: '俏丽', seed: 'Pepper' },
	{ id: 'ava-28', label: '鸡冠头', role: '摇滚', seed: 'Raven' },
	{ id: 'ava-29', label: '丸子双髻', role: '萌系', seed: 'Pebble' },
	{ id: 'ava-30', label: '长辫', role: '古典', seed: 'Amber' },
	{ id: 'ava-31', label: '微卷中分', role: '知性', seed: 'Iris' },
	{ id: 'ava-32', label: '圆寸', role: '阳光', seed: 'Blaze' },
	{ id: 'ava-33', label: '蝴蝶结', role: '少女', seed: 'Cherry' },
	{ id: 'ava-34', label: '脏辫', role: '个性', seed: 'Rumble' },
	{ id: 'ava-35', label: '发带运动', role: '活力', seed: 'Dash' },
	{ id: 'ava-36', label: '侧扎小辫', role: '可爱', seed: 'Tulip' },
	{ id: 'ava-37', label: '书卷气质', role: '文艺', seed: 'Quill' },
	{ id: 'ava-38', label: '花环装饰', role: '自然', seed: 'Fern' },
	{ id: 'ava-39', label: '英伦礼帽', role: '绅士', seed: 'Winston' },
	{ id: 'ava-40', label: '围巾女孩', role: '温暖', seed: 'Puffy' },
	{ id: 'ava-41', label: '连帽衫', role: '休闲', seed: 'Cozy' },
	{ id: 'ava-42', label: '耳钉酷盖', role: '痞帅', seed: 'Jett' },
];

export function buildAvatarPresets(): AvatarPreset[] {
	return [
		{ id: 'default', label: '默认', role: '系统', avatarUrl: '' },
		...ROLE_PRESETS.map(({ id, label, role, seed }) => ({
			id,
			label,
			role,
			avatarUrl: createAvatar(lorelei as any, { seed }).toDataUri(),
		})),
	];
}
