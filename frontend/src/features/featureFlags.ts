/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

// 功能开关前端运行时（横切基础设施）
// ------------------------------------------------------------------------------------
// 设计目标：
//   - 登录后调用 refreshFeatureFlags() 拉取一次 → 写入 window.__FEATURE_FLAGS__
//   - 任何 UI 都可同步调用 isFeatureEnabled('key') 决定是否渲染入口
//   - 未登录或拉取失败时按"默认启用"处理（避免功能完全消失，登录后自动恢复正确状态）
//   - 注销时调用 clearFeatureFlags() 清空缓存

import type { ApiClient } from '../api/client.js';

export interface FeatureFlagsApi {
	getMyFeatureFlags(): Promise<unknown>;
}

export async function refreshFeatureFlags(api: FeatureFlagsApi | ApiClient): Promise<void> {
	try {
		const resp = await api.getMyFeatureFlags();
		const data = resp as { data?: { flags?: Record<string, FeatureFlagState> } } | null;
		const flags = data?.data?.flags;
		if (flags && typeof flags === 'object') {
			(window as Window & { __FEATURE_FLAGS__?: Record<string, FeatureFlagState> })
				.__FEATURE_FLAGS__ = flags;
			return;
		}
	} catch (err) {
		// 拉取失败：保留旧值，避免开关闪烁
		console.warn('[featureFlags] refresh failed', err);
	}
}

export function clearFeatureFlags(): void {
	const w = window as Window & { __FEATURE_FLAGS__?: Record<string, FeatureFlagState> };
	w.__FEATURE_FLAGS__ = undefined;
}

/**
 * 同步判定某个 flag 是否开启
 *   - 未拉取 / 未登录：返回 defaultIfMissing（默认 true，保持现状）
 *   - 已拉取：以后端解析结果为准
 */
export function isFeatureEnabled(key: string, defaultIfMissing = true): boolean {
	const flags = (window as Window & { __FEATURE_FLAGS__?: Record<string, FeatureFlagState> })
		.__FEATURE_FLAGS__;
	if (!flags || !flags[key]) {
		return defaultIfMissing;
	}
	return Boolean(flags[key].enabled);
}

// 暴露到全局，便于个人中心 / 各 Manager 同步判断
(window as Window & {
	isFeatureEnabled?: typeof isFeatureEnabled;
	refreshFeatureFlags?: (api: FeatureFlagsApi) => Promise<void>;
	clearFeatureFlags?: () => void;
}).isFeatureEnabled = isFeatureEnabled;
(window as Window & {
	refreshFeatureFlags?: (api: FeatureFlagsApi) => Promise<void>;
}).refreshFeatureFlags = refreshFeatureFlags as (api: FeatureFlagsApi) => Promise<void>;
(window as Window & { clearFeatureFlags?: () => void }).clearFeatureFlags = clearFeatureFlags;
