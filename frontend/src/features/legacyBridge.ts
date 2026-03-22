export async function bootLegacyViewer(): Promise<void> {
	const w = window as Window & { __LEGACY_BOOTED__?: boolean };
	if (w.__LEGACY_BOOTED__) return;
	w.__LEGACY_BOOTED__ = true;
	await new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = '/static/app/legacy/loader.js';
		script.async = false;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('load /static/app/legacy/loader.js failed'));
		document.head.appendChild(script);
	});
}
