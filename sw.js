// Réseau d'abord, cache en secours : l'appli reste consultable sans réseau
// avec les dernières données chargées (les fonds de carte ne sont pas mis en cache).
const CACHE = 'chasse-wallonie';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || (url.origin !== location.origin && url.hostname !== 'unpkg.com')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // revalide toujours : pas de mélange d'anciennes et nouvelles versions
      .then((r) => {
        if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        return r.clone();
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
