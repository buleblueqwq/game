// NEON ARCADE Service Worker —— 离线缓存：安装期预缓存外壳，运行期 stale-while-revalidate
// 游戏模块按需缓存，首次访问后整站可离线运行。
const CACHE = 'neon-arcade-v1';
const SHELL = [
  './',
  './index.html',
  './styles/app.css',
  './src/shell/main.js',
  './src/shell/catalog.js',
  './src/shell/player.js',
  './assets/icon.svg',
  './assets/og.svg',
  './assets/manifest.webmanifest'
];
// 核心库按需缓存（体积大，单独列出以便调试）
const LIBS = [
  './vendor/three.module.min.js',
  './vendor/matter.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([...SHELL, ...LIBS]).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 不拦截跨域

  // 导航请求：网络优先，回退缓存（保证拿到最新 HTML）
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // 静态资源：stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
