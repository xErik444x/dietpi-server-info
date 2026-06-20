const CACHE = 'panel-admin-v9';
const ASSETS = [
	'/',
	'/style.css',
	'/app.js',
	'/manifest.json',
	'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,500;0,700;1,300&display=swap',
	'https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT6RDJ.woff2',
];

self.addEventListener('install', (e) => {
	e.waitUntil(
		caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
	self.clients.claim();
});

self.addEventListener('fetch', (e) => {
	// Don't cache the API
	if (e.request.url.includes('/api/')) return;

	e.respondWith(
		caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
			if (res.ok && res.type === 'basic') {
				const clone = res.clone();
				caches.open(CACHE).then((c) => c.put(e.request, clone));
			}
			return res;
		}))
	);
});
