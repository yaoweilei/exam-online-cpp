import { Tracker } from '../analytics/tracker.js';

export async function bootLegacyViewer() {
	// 保持现有布局与渲染系统，使用新状态层提供的 __EXAMS_BY_LEVEL__ 数据。
	if (window.__LEGACY_BOOTED__) return;
	window.__LEGACY_BOOTED__ = true;
	Tracker.log('legacy_boot_start');
	await new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = '/static/app/legacy/loader.js';
		script.async = false;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
	Tracker.log('legacy_boot_done');
}
