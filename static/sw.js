// 业务功能 14：PWA Service Worker
// 缓存策略：
//   - 页面导航：网络优先，避免旧 HTML 壳与新版模块不兼容
//   - 静态资源（/static/*、/resource/*、/manifest.webmanifest）：网络优先，离线回退缓存
//   - API 请求（/api/*）：网络优先，离线时返回缓存（若有）
//   - 其他：仅网络
//
// 版本号变更后，新 SW 会清理旧缓存

const CACHE_VERSION = 'v2-2026-07-30-renewal-delivery';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const ALL_CACHES = [STATIC_CACHE, API_CACHE];

// 安装：预缓存核心壳
const PRECACHE_URLS = [
	'/',
	'/manifest.webmanifest',
	'/static/style.css?v=20260730-renewal-delivery',
	'/static/app/main.js?v=20260730-renewal-delivery'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)))
		).then(() => self.clients.claim())
	);
});

// 让前端可主动卸载 SW（功能开关关闭时）
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	} else if (event.data && event.data.type === 'UNREGISTER') {
		self.registration.unregister().then(() =>
			caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
		);
	}
});

function isStatic(url) {
	return (
		url.pathname === '/manifest.webmanifest' ||
		url.pathname.startsWith('/static/') ||
		url.pathname.startsWith('/resource/')
	);
}

function isApi(url) {
	return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	if (req.mode === 'navigate' || url.pathname === '/') {
		// 页面壳必须优先使用网络版本；离线时才回退缓存。
		// 否则旧 HTML 可能引用已删除的模块，导致应用在 SW 更新前无法启动。
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res && res.status === 200) {
						const clone = res.clone();
						caches.open(STATIC_CACHE).then((cache) => cache.put('/', clone)).catch(() => {});
					}
					return res;
				})
				.catch(async () => {
					const cache = await caches.open(STATIC_CACHE);
					const cached = await cache.match('/');
					return cached || Response.error();
				})
		);
		return;
	}

	if (isStatic(url)) {
		// 未使用内容哈希的 ES 模块依赖不能返回旧版本，否则入口脚本
		// 和子模块可能不兼容。在线时使用网络版本，离线时回退缓存。
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res && res.status === 200) {
						const clone = res.clone();
						caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
					}
					return res;
				})
				.catch(async () => {
					const cache = await caches.open(STATIC_CACHE);
					const cached = await cache.match(req);
					return cached || Response.error();
				})
		);
		return;
	}

	if (isApi(url)) {
		// 网络优先；只缓存 GET 200，并在离线时回退
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res && res.status === 200) {
						const clone = res.clone();
						caches.open(API_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
					}
					return res;
				})
				.catch(async () => {
					const cache = await caches.open(API_CACHE);
					const cached = await cache.match(req);
					if (cached) return cached;
					return new Response(JSON.stringify({ error: { code: 'OFFLINE', message: '离线且无缓存' } }), {
						status: 503,
						headers: { 'Content-Type': 'application/json; charset=utf-8' }
					});
				})
		);
	}
});
