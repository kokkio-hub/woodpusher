// Woodpusher's service worker: it makes the site installable as an app and lets it open without a
// connection (Stockfish, puzzles, openings and reviews all run in the browser). Online play, accounts
// and the username look-up still need the server, so /api and /socket.io always go to the network.
// tools/build-front.mjs fills in the version and the list of files; a new build is a new version,
// which replaces the cached copy of the site.
const VERSION = "d5a2521f28";
const CACHE = 'woodpusher-' + VERSION;
const PRECACHE = ["/","/app.js?v=f6b3254666","/data.js?v=f6b3254666","/look.js?v=f6b3254666","/chess.js?v=f6b3254666","/fonts/fonts.css?v=f6b3254666","/favicon.svg?v=f6b3254666","/stockfish.js","/stockfish.wasm","/manifest.webmanifest","/privacy.html","/fonts/carlito-latin-400-italic.woff2","/fonts/carlito-latin-400-normal.woff2","/fonts/carlito-latin-700-italic.woff2","/fonts/carlito-latin-700-normal.woff2","/fonts/outfit-latin-400-normal.woff2","/fonts/outfit-latin-500-normal.woff2","/fonts/outfit-latin-600-normal.woff2","/fonts/outfit-latin-700-normal.woff2","/fonts/share-tech-mono-latin-400-normal.woff2","/icons/apple-touch-icon.png","/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-192.png","/icons/icon-maskable-512.png","/icons/icon.svg","/books/abdusattorov.json?v=f6b3254666","/books/carlsen.json?v=f6b3254666","/books/caruana.json?v=f6b3254666","/books/firouzja.json?v=f6b3254666","/books/keymer.json?v=f6b3254666","/books/nakamura.json?v=f6b3254666","/books/praggnanandhaa.json?v=f6b3254666","/books/sindarov.json?v=f6b3254666","/books/so.json?v=f6b3254666","/books/weiyi.json?v=f6b3254666"];
const NETWORK_ONLY = /^\/(api|socket\.io)\/|^\/(sw\.js|healthz)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('woodpusher-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NETWORK_ONLY.test(url.pathname)) return;
  if (req.mode === 'navigate') e.respondWith(page(req, url));
  else e.respondWith(file(req));
});

// Pages: the newest from the network, so a deploy shows up straight away; the cached copy when offline
// or when the network takes too long. Every app address (/, /game/…, /@/…) is the same page.
async function page(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.pathname === '/privacy.html' ? '/privacy.html' : '/';
  const net = fetch(req).then((res) => {
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) cache.put(key, res.clone());
    return res;
  });
  const cached = await cache.match(key);
  if (!cached) return net.catch(() => Response.error());
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 4000));
  return Promise.race([net.catch(() => cached), slow]);
}
// Everything else: from the cache when it is there (the page loads files by version, so a cached file
// never goes stale), otherwise from the network, keeping a copy for next time.
async function file(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && !req.headers.has('range')) cache.put(req, res.clone());
    return res;
  } catch (e) { return Response.error(); }
}
