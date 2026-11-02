// Service Worker —— 仅供浏览器版（CF Pages）做离线缓存。
//
// Tauri 桌面/移动端不要用它：资源已经内嵌在安装包里，离线缓存毫无意义，
// 而且 cache-first 会让「重新构建 + 重装」之后仍然加载旧脚本，表现为改动不生效。
// 因此下面带一段自毁逻辑：一旦在 Tauri 环境下运行，注销自身、清空缓存并刷新页面。
// 这段代码必须留在 sw.js 里（而不是只写在 init.js），因为旧 SW 连 index.html
// 都会被缓存，新加在 init.js 里的判断根本没有机会执行。

const CACHE = 'mdviewer-v7';
const URLS = [
  './',
  './app.css',
  './js/core.js',
  './js/theme.js',
  './js/markdown.js',
  './js/links.js',
  './js/media.js',
  './js/render.js',
  './js/file.js',
  './js/nav.js',
  './js/ui.js',
  './js/init.js',
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

// Tauri（桌面 + Android）的页面源固定为 http://tauri.localhost
const IS_TAURI = self.location.hostname === 'tauri.localhost';

if (IS_TAURI) {
  // ---- 自毁：注销 SW、清空所有缓存、刷新受控页面 ----
  self.addEventListener('install', () => self.skipWaiting());

  self.addEventListener('activate', e => {
    e.waitUntil((async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch (_) {}
      try { await self.registration.unregister(); } catch (_) {}
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const c of clients) { try { c.navigate(c.url); } catch (_) {} }
      } catch (_) {}
    })());
  });

  // 万一还没卸载成功，先直通网络，别再喂缓存
  self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));
} else {
  // ---- 浏览器版：正常离线缓存 ----
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
}
