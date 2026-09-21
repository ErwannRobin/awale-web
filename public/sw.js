// Offline support for a game that has no server to talk to anyway.
//
// Vite hashes asset filenames, so there is no fixed precache list to hardcode.
// Instead: cache the app shell on install, then cache-first every same-origin
// GET as it is fetched. Because asset URLs change on every deploy, a stale
// entry is never served for new code — the new build asks for new URLs.
// Navigations fall back to the cached shell so a cold offline start works.

const CACHE = 'awale-v1';

// The seed sample pack. Precached so a cold offline start still has sound, and
// versioned in its path because these names are fixed: a new pack is v2, never
// new bytes at an old URL. Keep in step with PACK_DIR in src/lib/sound.ts.
// Each name is listed as both .wav and .mp3 — the pack can mix formats per
// clip (sound.ts tries .wav then .mp3), and whichever one doesn't exist is a
// missing entry, tolerated the same as a build shipped with no pack at all.
const SOUND_NAMES = [
  'drop-1', 'drop-2', 'drop-3', 'drop-4', 'drop-5', 'drop-6', 'drop-many',
  'drop-seeds-1', 'drop-seeds-2', 'drop-seeds-3', 'drop-seeds-4',
  'scoop-1', 'scoop-2', 'tap-1', 'victory-1', 'lost-1', 'djembe-loop',
];
const SOUNDS = SOUND_NAMES.flatMap(name => [`/sounds/v1/${name}.wav`, `/sounds/v1/${name}.mp3`]);

const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  ...SOUNDS,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing shell file must not fail the whole install.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a fresh deploy is picked up, cache as backup.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then(hit => hit || caches.match('/'))),
    );
    return;
  }

  // Assets: cache first — their URLs are content-hashed, so a hit is never stale.
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});
