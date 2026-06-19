// 业务功能 14：PWA Service Worker
// 缓存策略：
//   - 静态资源（/static/*、/resource/*、/、/manifest.webmanifest）：stale-while-revalidate
//   - API 请求（/api/*）：网络优先，离线时返回缓存（若有）
//   - 其他：仅网络
//
// 版本号变更后，新 SW 会清理旧缓存

const CACHE_VERSION = 'v2-2026-06-19-login';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const ALL_CACHES = [STATIC_CACHE, API_CACHE];

// 安装：预缓存核心壳
const PRECACHE_URLS = [
	'/',
	'/manifest.webmanifest',
	'/static/style.css?v=20260619-login3',
	'/static/app/main.js'
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
		url.pathname === '/' ||
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

	if (isStatic(url)) {
		// stale-while-revalidate
		event.respondWith(
			caches.open(STATIC_CACHE).then(async (cache) => {
				const cached = await cache.match(req);
				const network = fetch(req)
					.then((res) => {
						if (res && res.status === 200) cache.put(req, res.clone());
						return res;
					})
					.catch(() => cached);
				return cached || network;
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
