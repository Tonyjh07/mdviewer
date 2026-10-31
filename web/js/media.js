// ---- 图片渲染：相对路径解析 + 失败占位 + 灯箱 ----

// 当前文档的“基准位置”，用于把 markdown 里的相对路径解析成可加载的地址。
// kind: 'none' | 'url' | 'file' | 'folder' | 'scoped'
function setDocSource(src) {
  state.docSource = Object.assign({ kind: 'none' }, src || {});
}

function docSource() {
  return state.docSource || { kind: 'none' };
}

// 已经自带协议（http/https/data/blob/file/content）或协议相对的双斜杠地址，交给浏览器直接加载
function isDirectSrc(src) {
  return /^(?:[a-z][a-z0-9+.\-]*:|\/\/)/i.test(src);
}

// ---- 相对路径工具 ----
function normalizeRel(p) {
  const out = [];
  for (const seg of String(p).replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

function relDir(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/');
}

function joinRel(dir, rel) {
  return normalizeRel(dir ? dir + '/' + rel : rel);
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff'
};

function mimeFromPath(p) {
  const m = String(p).toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return (m && MIME_BY_EXT[m[1]]) || 'application/octet-stream';
}

function releaseBlobUrls() {
  if (!state.docBlobUrls || !state.docBlobUrls.length) return;
  for (const url of state.docBlobUrls) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
  state.docBlobUrls = [];
}

function blobUrlFromBytes(bytes, path) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const url = URL.createObjectURL(new Blob([u8], { type: mimeFromPath(path) }));
    state.docBlobUrls.push(url);
    return url;
  } catch {
    return null;
  }
}

// 在“文件夹模式”下按相对路径查找图片文件（File 对象）
function lookupFolderFile(src, docRelPath) {
  const map = state.docFiles;
  if (!map || !map.size) return null;
  const clean = normalizeRel(src);
  if (!clean) return null;
  const direct = joinRel(relDir(docRelPath || ''), clean).toLowerCase();
  const bare = clean.toLowerCase();

  let file = map.get(direct);
  if (file) return file;
  file = map.get(bare);
  if (file) return file;

  // 兜底：按路径后缀匹配（唯一命中才算，避免同名图片串号）
  const suffix = '/' + bare;
  let hit = null;
  for (const [key, value] of map) {
    if (key === bare || key.endsWith(suffix)) {
      if (hit) return null;
      hit = value;
    }
  }
  return hit;
}

// 把相对路径解析成可直接加载的地址；无法解析时返回 null
async function resolveLocalImage(src) {
  const ds = docSource();

  // 1) URL 导入：相对图片相对于该 Markdown 的地址
  if (ds.kind === 'url' && ds.docUrl) {
    try { return new URL(src, ds.docUrl).href; } catch { return null; }
  }

  // 2) 桌面 Tauri：按 md 文件所在目录读取本地图片
  if ((ds.kind === 'file' || ds.kind === 'folder') && ds.docPath && window.__TAURI__ && isDesktopTauri) {
    const base = relDir(String(ds.docPath).replace(/\\/g, '/'));
    try {
      const dataUrl = await window.__TAURI__.core.invoke('read_image', { base, rel: src });
      if (dataUrl) return dataUrl;
    } catch (e) {
      console.warn('[mdviewer] read_image failed:', src, e);
    }
    return null;
  }

  // 3) Android SAF（scoped-storage）：按文件夹内的相对路径读取字节
  if (ds.kind === 'scoped' && ds.folderId && window.__TAURI__) {
    const path = joinRel(relDir(ds.relPath || ''), src);
    try {
      const res = await window.__TAURI__.core.invoke('plugin:scoped-storage|read_file', {
        req: { folderId: ds.folderId, path }
      });
      if (res && res.data) return blobUrlFromBytes(res.data, src);
    } catch (e) {
      console.warn('[mdviewer] scoped read_file failed:', path, e);
    }
    return null;
  }

  // 4) 浏览器文件夹模式：从已加载的 File 列表里取
  const f = lookupFolderFile(src, ds.relPath || '');
  if (f) {
    try {
      const url = URL.createObjectURL(f);
      state.docBlobUrls.push(url);
      return url;
    } catch { return null; }
  }
  return null;
}

function imageFallbackHint() {
  const ds = docSource();
  if (ds.kind === 'none') return '双击打开单个 .md 时无法读取同目录图片，请用「文件夹」打开所在目录，或改用 https 图片链接';
  if (ds.kind === 'url') return '该图片地址无法访问';
  if (ds.kind === 'file') return '无法从磁盘读取该图片，请确认文件是否存在';
  if (ds.kind === 'folder') return ds.docPath ? '无法从磁盘读取该图片，请确认文件是否存在' : '当前文件夹中未找到这张图片';
  if (ds.kind === 'scoped') return '无法从所选文件夹读取该图片';
  return '';
}

function replaceWithImageFallback(img, raw, message) {
  if (!img || img.dataset.imgReplaced) return;
  img.dataset.imgReplaced = '1';
  const alt = (img.getAttribute('alt') || '').trim();
  const box = document.createElement('div');
  box.className = 'img-fallback';

  const title = document.createElement('div');
  title.className = 'img-fallback-title';
  title.textContent = message || (alt ? `图片无法加载：${alt}` : '图片无法加载');
  box.appendChild(title);

  if (raw) {
    const code = document.createElement('code');
    code.textContent = raw;
    box.appendChild(code);
  }

  const hint = document.createElement('div');
  hint.className = 'img-fallback-hint';
  hint.textContent = imageFallbackHint();
  box.appendChild(hint);

  img.replaceWith(box);
}

// 渲染完成后处理内容区所有图片
function hydrateImages(root) {
  if (!root) return;
  root.querySelectorAll('img').forEach(img => {
    if (img.dataset.imgHydrated) return;
    img.dataset.imgHydrated = '1';

    const raw = (img.getAttribute('src') || '').trim();
    if (!raw) { replaceWithImageFallback(img, '', '图片缺少地址'); return; }

    img.classList.add('img-zoomable');
    img.addEventListener('error', () => replaceWithImageFallback(img, raw), { once: true });

    if (isDirectSrc(raw)) return;

    // 相对路径：先摘掉 src，避免浏览器直接请求页面所在目录造成 404
    img.removeAttribute('src');
    resolveLocalImage(raw)
      .then(url => {
        if (url) img.setAttribute('src', url);
        else replaceWithImageFallback(img, raw);
      })
      .catch(() => replaceWithImageFallback(img, raw));
  });
}

// ---- 图片灯箱 ----
let lightboxEl = null;

function initImageLightbox() {
  if (lightboxEl) return;
  lightboxEl = document.createElement('div');
  lightboxEl.id = 'imgLightbox';
  const big = document.createElement('img');
  big.alt = '';
  const hint = document.createElement('div');
  hint.className = 'lightbox-hint';
  hint.textContent = '点击任意位置关闭';
  lightboxEl.append(big, hint);
  lightboxEl.addEventListener('click', () => closeLightbox());
  document.body.appendChild(lightboxEl);

  const body = document.getElementById('content-body');
  if (!body) return;
  body.addEventListener('click', e => {
    if (e.target.closest('a')) return; // 图片链接优先走链接逻辑
    const img = e.target.closest('img');
    if (!img || !img.getAttribute('src') || img.dataset.imgFailed) return;
    e.preventDefault();
    big.src = img.currentSrc || img.src;
    big.alt = img.alt || '';
    lightboxEl.classList.add('open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
}

function closeLightbox() {
  if (!lightboxEl) return;
  lightboxEl.classList.remove('open');
  lightboxEl.querySelector('img').removeAttribute('src');
}
