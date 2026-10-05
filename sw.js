// OFFBOOK service worker — caches the app shell for offline launch.
// Network-first so updates land immediately; cache is the offline fallback.
const CACHE = 'offbook-v51';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
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
  const url = new URL(req.url);
  // Never cache API calls (OpenAI dialogue parsing needs the network anyway).
  if (url.hostname.includes('openai.com')) return;
  // "Network-first" only actually reaches the network if the fetch() call
  // itself skips the browser's own HTTP cache — it doesn't by default, and
  // GitHub Pages sends index.html with a 10-minute max-age, so a plain
  // fetch(req) here could silently hand back a stale shell without ever
  // making a real request. The shell (the one file that changes on every
  // deploy) gets cache:'no-store' to force a real check every time; other
  // assets (icons, manifest — effectively static) keep normal caching.
  const isShell = url.origin === location.origin && (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  e.respondWith(
    fetch(req, isShell ? {cache:'no-store'} : {})
      .then(res => {
        if (url.origin === location.origin && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
