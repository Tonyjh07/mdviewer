const CACHE = 'mdviewer-v1';
const URLS = [
  './',
  './mdviewer.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/stackoverflow-light.min.css',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/stackoverflow-dark.min.css',
  'https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const u = e.request.url;
  if (u.startsWith('chrome-extension://') || u.startsWith('ws://') || u.startsWith('wss://')) return;
  if (u.includes('cdn.jsdelivr.net')) {
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => { const r = res.clone(); caches.open(CACHE).then(c => c.put(e.request, r)); return res; })));
  } else {
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
  }
});
