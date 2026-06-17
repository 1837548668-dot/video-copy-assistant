const CACHE_NAME = 'video-copy-static-v6';
const SHARE_CACHE = 'video-copy-share';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.html',
  './app.js?v=20260617-fix6',
  './styles.css',
  './manifest.webmanifest',
  './assets/product-preview.svg',
  './assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('video-copy-static-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/app.html')) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const file = formData.get('video');
  const title = formData.get('title') || 'shared-video';

  if (file && file.size) {
    const cache = await caches.open(SHARE_CACHE);
    const headers = new Headers({
      'content-type': file.type || 'video/mp4',
      'x-file-name': file.name || `${title}.mp4`
    });
    await cache.put('shared-file', new Response(file, { headers }));
  }

  return Response.redirect('./app.html?shared=1', 303);
}
