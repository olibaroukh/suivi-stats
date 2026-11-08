/* Séminaire franchisés : la page s'ouvre même sans réseau (wifi du séminaire).
 * Réseau d'abord, copie locale en secours. Les données passent par l'appli (pas par ce fichier). */
const CACHE = 'seminaire-v1';
const FICHIERS = ['./', './index.html', './sem.css', './sem.js', './manifest.webmanifest', '../assets/logo-optical-center.png', '../assets/icone-192.png', '../lib/xlsx.full.min.js',
  '../assets/fonts/montserrat-latin-400-normal.woff2', '../assets/fonts/montserrat-latin-600-normal.woff2', '../assets/fonts/montserrat-latin-700-normal.woff2', '../assets/fonts/montserrat-latin-800-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const cle = u.pathname.endsWith('sem.js') ? new Request(u.origin + u.pathname) : e.request;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(cle, c)); } return r; })
    .catch(() => caches.match(cle, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
