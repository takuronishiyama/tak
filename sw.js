/* =========================================================
   Service Worker — オフラインでも遊べるようにする
   ホーム画面に追加したあとは、通信なしで起動できる
   ========================================================= */
const CACHE = 'gp-monogatari-v105';
const SHELL = [
  './',
  './index.html',
  './assets/style.css',
  './src/sound.js',
  './src/fx.js',
  './src/data.js',
  './src/geom.js',
  './src/state.js',
  './src/race.js',
  './src/raceview.js',
  './src/base.js',
  './src/paddock.js',
  './src/grid.js',
  './src/interior.js',
  './src/ui.js',
  './src/main.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 自分自身のファイルはキャッシュ優先。外部（フォント）は取れなければ諦める
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        // 裏で更新しておく
        fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
