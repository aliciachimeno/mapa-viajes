// Service worker: guarda la app para que abra rápido y funcione sin conexión.
// Si cambias el código, sube el número de versión para forzar la actualización.
const CACHE = 'mapa-viajes-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const cacheable =
    u.origin === location.origin ||
    u.host === 'unpkg.com' ||
    u.host === 'fonts.googleapis.com' ||
    u.host === 'fonts.gstatic.com';
  if (!cacheable) return; // los mosaicos del mapa y las búsquedas van directos a la red

  // Responde desde la caché y la actualiza en segundo plano
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: u.origin === location.origin });
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(net.catch(() => {}));
      return hit;
    }
    return net;
  })());
});
