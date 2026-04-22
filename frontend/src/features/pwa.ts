// 业务功能 14：PWA 注册与控制
//   - 在 bootstrap 后调用 ensurePwaRegistration()：根据 window.isFeatureEnabled('pwa') 注册或卸载 SW
//   - 监听 beforeinstallprompt：缓存 deferred prompt，供 personalCenter 「安装到桌面」按钮调用
//   - 暴露 window.installPwa() / window.canInstallPwa() / window.isPwaActive()

interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let registered = false;

function isFeatureOn(): boolean {
	const fn = (window as unknown as { isFeatureEnabled?: (key: string, fallback?: boolean) => boolean })
		.isFeatureEnabled;
	return fn ? fn('pwa', true) : true;
}

async function registerSw(): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	try {
		await navigator.serviceWorker.register('/sw.js', { scope: '/' });
		registered = true;
	} catch (err) {
		console.warn('[pwa] SW 注册失败:', err);
	}
}

async function unregisterSw(): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	try {
		const regs = await navigator.serviceWorker.getRegistrations();
		for (const reg of regs) {
			// 通知 SW 自行清理缓存后再 unregister
			reg.active?.postMessage({ type: 'UNREGISTER' });
			await reg.unregister();
		}
		registered = false;
	} catch (err) {
		console.warn('[pwa] SW 卸载失败:', err);
	}
}

export async function ensurePwaRegistration(): Promise<void> {
	if (isFeatureOn()) {
		if (!registered) await registerSw();
	} else {
		if (registered) await unregisterSw();
	}
}

export function initPwa(): void {
	// 捕获安装提示（必须尽早注册）
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
	});
	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
	});

	// 暴露给 personalCenter 使用
	const w = window as unknown as {
		canInstallPwa?: () => boolean;
		isPwaActive?: () => boolean;
		installPwa?: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
		ensurePwaRegistration?: () => Promise<void>;
	};
	w.canInstallPwa = () => deferredPrompt !== null && isFeatureOn();
	w.isPwaActive = () => registered;
	w.installPwa = async () => {
		if (!deferredPrompt || !isFeatureOn()) return 'unavailable';
		await deferredPrompt.prompt();
		const choice = await deferredPrompt.userChoice;
		deferredPrompt = null;
		return choice.outcome;
	};
	w.ensurePwaRegistration = ensurePwaRegistration;

	// 首次启动尝试注册（功能默认开启时；登录后 syncViewerUserState 还会再调用一次同步开关）
	void ensurePwaRegistration();
}
