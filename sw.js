// Service worker : jeu jouable hors ligne.
// Stratégie « réseau d'abord » pour nos fichiers (les mises à jour arrivent
// dès qu'on est en ligne), repli sur le cache hors ligne. Les polices Google
// sont mises en cache à la volée.
const VERSION = 'jde-v3';
const CORE = [
  './',
  'index.html',
  'styles.css',
  'lobby.css',
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
  'src/core/dmath.js',
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
  'src/ui/elements.js',
  'src/ui/portraits.js',
  'src/ui/sheets.js',
  'src/ui/towerbar.js',
  'src/ui/wavepreview.js',
  'src/ui/overlay.js',
  'src/ui/debug.js',
  'src/ui/lobby.js',
  'src/net/mqtt.js',
  'src/net/lobby.js',
  'src/net/lockstep.js',
  'src/net/coop.js',
  'src/render/glyphs.js',
  'src/render/barriers.js',
  'src/render/construction.js',
  'src/ui/commands.js',
  'data/rules.js',
  'data/elements.js',
  'data/towers.js',
  'data/enemies.js',
  'data/combos.js',
  'data/worlds.js',
];

// Les niveaux sont découverts dans data/worlds.js : ajouter un niveau ne
// demande pas de modifier ce fichier (ni à l'installation, ni ensuite : voir fetch).
function levelPaths(txt) {
  const ids = [];
  for (const m of txt.matchAll(/levels:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) ids.push(`data/levels/${q[1]}.js`);
  }
  return ids;
}

async function levelFiles() {
  try {
    return levelPaths(await (await fetch('data/worlds.js', { cache: 'no-store' })).text());
  } catch {
    return [];
  }
}

// Un worlds.js plus récent que l'installation peut annoncer de nouveaux niveaux
// (sw.js inchangé, donc pas de réinstallation) : on met en cache ceux qui manquent.
async function cacheNewLevels(cache, res) {
  try {
    for (const f of levelPaths(await res.text())) {
      if (!(await cache.match(f))) await cache.add(new Request(f, { cache: 'reload' })).catch(() => {});
    }
  } catch {
    /* hors ligne ou réponse illisible : on réessaiera au prochain lancement */
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
          if (res.ok) {
            cache.put(req, res.clone());
            if (url.pathname.endsWith('/data/worlds.js')) event.waitUntil(cacheNewLevels(cache, res.clone()));
          }
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
