// 오프라인 실행용 캐시. 파일을 바꾸면 VERSION을 올린다
var VERSION = 'v1';
var FILES = [
  './', 'index.html', 'app.js', 'bpm-core.js', 'capture-worklet.js', 'manifest.webmanifest',
  'fonts/big-shoulders-800.woff', 'assets/keepawake.mp4',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 네트워크 우선, 실패하면 캐시 (업데이트가 바로 반영되도록)
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || e.request.headers.has('range')) return;
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});
