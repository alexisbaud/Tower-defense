// Service worker : jeu jouable hors ligne.
// Stratégie « réseau d'abord » pour nos fichiers (les mises à jour arrivent
// dès qu'on est en ligne), repli sur le cache hors ligne. Les polices Google
// sont mises en cache à la volée.
const VERSION = 'jde-v1';
const CORE = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/main.js',
  'src/data.js',
  'src/save.js',
  'src/audio/sound.js',
  'src/core/game.js',
  'src/core/grid.js',
  'src/core/flowfield.js',
  'src/core/combos.js',
  'src/core/rng.js',
  'src/render/renderer.js',
  'src/render/brush.js',
  'src/render/paper.js',
  'src/render/terrain.js',
  'src/render/towers.js',
  'src/render/enemies.js',
  'src/render/combos.js',
  'src/render/fx.js',
  'src/ui/hud.js',
  'src/ui/input.js',
  'src/ui/rewind.js',
  'src/ui/tutorial.js',
  'src/ui/screens.js',
  'data/rules.js',
  'data/towers.js',
  'data/enemies.js',
  'data/combos.js',
  'data/worlds.js',
];

// Les niveaux sont découverts dans data/worlds.js : ajouter un niveau ne
// demande pas de modifier ce fichier.
async function levelFiles() {
  try {
    const txt = await (await fetch('data/worlds.js', { cache: 'no-store' })).text();
    const ids = [];
    for (const m of txt.matchAll(/levels:\s*\[([^\]]*)\]/g)) {
      for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) ids.push(`data/levels/${q[1]}.js`);
    }
    return ids;
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      const files = [...CORE, ...(await levelFiles())];
      // addAll échoue en bloc : on ajoute un par un pour tolérer un fichier manquant.
      await Promise.all(files.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          const hit = await cache.match(req, { ignoreSearch: true });
          if (hit) return hit;
          if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
          return Response.error();
        }
      })(),
    );
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION + '-fonts');
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })(),
    );
  }
});
