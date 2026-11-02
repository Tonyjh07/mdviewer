// ---- 跨文件链接：相对 / 绝对路径跳转 ----
//
// 支持四种文档来源（见 media.js 的 state.docSource）：
//   'file'   桌面端打开的单个 .md（有绝对路径）
//   'folder' 桌面端打开的文件夹（有绝对路径）/ 浏览器文件夹模式（只有相对路径）
//   'scoped' Android SAF 打开的文件夹（只有相对路径）
//   'url'    通过 URL 导入的远程 Markdown
//
// 另外支持跨文档锚点：other.md#章节 —— 目标文档渲染完成后再定位。

const MD_FILE_RE = /\.(md|markdown|mdown)$/i;

// 把 "path#fragment" 拆成路径与锚点部分
function splitLinkFragment(href) {
  const s = String(href == null ? '' : href);
  const i = s.indexOf('#');
  if (i === -1) return { path: s, fragment: '' };
  return { path: s.slice(0, i), fragment: s.slice(i + 1) };
}

// 取路径末段的文件名
function fileNameOf(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

// 清除当前地址里的 #fragment（避免上一份文档的锚点影响新文档）
function clearHash() {
  if (!window.location.hash) return;
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch { try { history.replaceState(null, '', location.pathname); } catch { /* 忽略 */ } }
}

// 渲染目标文档；带锚点时在渲染完成（标题 id 已生成）后跳转
function navigateToDoc(content, name, fragment) {
  clearHash();
  if (!fragment) { render(content, name); return; }
  render(content, name, {
    afterRender: () => {
      const found = jumpToAnchor(fragment, { instant: true });
      if (!found) showToast('未在目标文档中找到锚点：#' + fragment);
    }
  });
}

// ---- 跨文件跳转的返回栈 ----
//
// 跳进 a.md → sub/b.md 之后，只能靠目标文档自己写了「返回上级」链接才回得去；
// 大多数文档不会写。这里在每次跨文件跳转前把当前现场压栈，右下角 FAB 出栈还原，
// 支持连续撤销。
//
// 只记录跨文件跳转：页内锚点（#章节）不换文档，不进栈。
const NAV_HISTORY_MAX = 30;
const navHistory = [];

let navBackBtn = null;

function initNavBackButton() {
  if (navBackBtn) return navBackBtn;
  const btn = document.createElement('button');
  btn.id = 'navBackBtn';
  btn.type = 'button';
  btn.innerHTML = '<span class="nav-back-arrow">↩</span><span class="nav-back-text">返回</span><span class="nav-back-count"></span>';
  btn.addEventListener('click', undoNav);
  // 右键清空：连续翻了很多层时不用点十几次
  btn.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!navHistory.length) return;
    clearNavHistory();
    showToast('已清除返回记录');
  });
  document.body.appendChild(btn);
  navBackBtn = btn;
  updateNavBackBtn();
  return btn;
}

function updateNavBackBtn() {
  if (!navBackBtn) return;
  const n = navHistory.length;
  navBackBtn.classList.toggle('show', n > 0);
  const badge = navBackBtn.querySelector('.nav-back-count');
  if (badge) badge.textContent = n > 1 ? String(n) : '';
  navBackBtn.title = n > 1
    ? `返回上一个文档（还剩 ${n} 步，右键清除记录）`
    : '返回上一个文档';
}

// 记录跳转前的现场。读不到正文时不记（例如从空状态出发）
function pushNavSnapshot() {
  if (!state.currentMarkdown) return false;
  const ds = docSource();
  navHistory.push({
    markdown: state.currentMarkdown,
    name: state.currentName || '',
    docSource: ds ? Object.assign({}, ds) : { kind: 'none' },
    scrollY: window.scrollY || 0,
    activeRelPath: typeof activeRelPath === 'string' ? activeRelPath : '',
    folderPath: state.folderPath || ''
  });
  if (navHistory.length > NAV_HISTORY_MAX) navHistory.shift();
  updateNavBackBtn();
  return true;
}

function clearNavHistory() {
  navHistory.length = 0;
  updateNavBackBtn();
}

// 出栈并还原：正文、基准位置、文件树高亮、滚动位置
function undoNav() {
  const snap = navHistory.pop();
  if (!snap) return;
  setDocSource(snap.docSource);
  state.folderPath = snap.folderPath || '';
  clearHash();
  if (snap.activeRelPath) highlightTreeFile(snap.activeRelPath);
  render(snap.markdown, snap.name, {
    afterRender: () => {
      if (!snap.scrollY) return;
      // html 上是 scroll-behavior: smooth，跨文档恢复位置必须用 instant，
      // 否则会看到一段长长的滚动动画
      const restore = () => window.scrollTo({ top: snap.scrollY, behavior: 'instant' });
      restore();
      // 图片（blob URL）解码后高度会变，补一帧再校正一次
      requestAnimationFrame(restore);
    }
  });
  updateNavBackBtn();
}

// 用 FileReader 读取文本文件
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(String(e.target.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.readAsText(file);
  });
}

// 在浏览器文件夹模式（state.docFiles）里按相对路径找文件
// 返回 { rel, file } 或 null
function lookupRelFile(src, docRelPath) {
  const map = state.docFiles;
  if (!map || !map.size) return null;
  const clean = normalizeRel(decodeURIComponentSafe(src));
  if (!clean) return null;

  // 1) 相对当前文档目录 2) 相对文件夹根目录
  for (const rel of [joinRel(relDir(docRelPath || ''), clean), clean]) {
    const hit = map.get(rel.toLowerCase());
    if (hit) return { rel, file: hit };
  }

  // 3) 兜底：按路径后缀匹配（唯一命中才算，避免同名文件串号）
  const suffix = '/' + clean.toLowerCase();
  let found = null;
  for (const [key, value] of map) {
    if (key === clean.toLowerCase() || key.endsWith(suffix)) {
      if (found) return null;
      found = { rel: key, file: value };
    }
  }
  return found;
}

// 桌面端：把绝对路径匹配到已打开的文件夹树条目（用于同步高亮）
function findFolderEntryByPath(absPath) {
  const norm = String(absPath || '').replace(/\\/g, '/').toLowerCase();
  for (const item of state.folderFiles || []) {
    const full = item.fullPath || item.full_path || '';
    if (!full) continue;
    if (String(full).replace(/\\/g, '/').toLowerCase() === norm) return item;
  }
  return null;
}

// 同步侧栏文件树的高亮项
function highlightTreeFile(relPath) {
  if (!relPath) return;
  activeRelPath = relPath;
  document.querySelectorAll('#fileTree .tree-file').forEach(el => {
    el.classList.toggle('active', el.dataset.rel === relPath);
  });
}

// 用系统默认程序打开本地非 Markdown 文件
async function openPathWithSystem(absPath) {
  try {
    if (window.__TAURI__ && window.__TAURI__.opener && window.__TAURI__.opener.openPath) {
      await window.__TAURI__.opener.openPath(absPath);
      return true;
    }
  } catch (e) {
    console.warn('[mdviewer] openPath failed:', absPath, e);
  }
  showToast('无法用系统默认程序打开该文件');
  return false;
}

// 判断远程响应是否按 Markdown 文本处理
function looksLikeMarkdown(res, url) {
  const ct = (res.headers && res.headers.get('content-type')) || '';
  if (/^text\//i.test(ct) || /markdown|json/i.test(ct)) return true;
  if (MD_FILE_RE.test((url || '').split('?')[0].split('#')[0])) return true;
  return false;
}

// ---- 主入口：处理本地路径链接 ----
async function openLocalDocLink(rawHref) {
  const ds = docSource();
  const { path: rawPath, fragment } = splitLinkFragment(rawHref);
  const link = rawPath.trim();
  if (!link) {
    if (fragment) jumpToAnchor(fragment);
    return;
  }

  try {
    // 1) URL 导入：相对链接相对于当前 Markdown 的地址
    if (ds.kind === 'url' && ds.docUrl) {
      let target;
      try { target = new URL(link, ds.docUrl); }
      catch { showToast('无法解析该链接：' + link); return; }
      if (!/^https?:$/i.test(target.protocol)) { showToast('暂不支持的链接协议：' + target.protocol); return; }
      const res = await fetch(target.href);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!looksLikeMarkdown(res, target.href)) { showToast('该链接不是 Markdown 文档'); return; }
      const text = await res.text();
      const name = decodeURIComponentSafe(fileNameOf(target.pathname)) || 'index.md';
      pushNavSnapshot();
      state.docFiles = null;
      setDocSource({ kind: 'url', docUrl: target.href });
      navigateToDoc(text, name, fragment);
      saveSession({ type: 'url', url: target.href, name });
      return;
    }

    // 2) Android SAF：路径相对于所选文件夹根目录
    if (ds.kind === 'scoped' && ds.folderId) {
      const rel = joinRel(relDir(ds.relPath || ''), decodeURIComponentSafe(link));
      if (!rel) { showToast('无效的链接：' + link); return; }
      if (!MD_FILE_RE.test(rel)) { showToast('移动端暂不支持打开非 Markdown 文件'); return; }
      const result = await window.__TAURI__.core.invoke('plugin:scoped-storage|read_text_file', {
        req: { folderId: ds.folderId, path: rel }
      });
      if (!result || !result.contents) { showToast('无法读取：' + rel); return; }
      pushNavSnapshot();
      setDocSource({ kind: 'scoped', folderId: ds.folderId, relPath: rel });
      navigateToDoc(result.contents, rel, fragment);
      return;
    }

    // 3) 桌面 Tauri：用 Rust 侧解析出绝对路径（支持 .. 、盘符、file:// 、%20）
    if ((ds.kind === 'file' || ds.kind === 'folder') && ds.docPath && window.__TAURI__) {
      let abs;
      try {
        abs = await window.__TAURI__.core.invoke('resolve_doc_path', { base: ds.docPath, link });
      } catch (e) {
        showToast('无法解析路径：' + link);
        return;
      }
      if (!abs) { showToast('无法解析路径：' + link); return; }

      if (!MD_FILE_RE.test(abs)) {
        openPathWithSystem(abs);
        return;
      }

      const data = await window.__TAURI__.core.invoke('read_file', { path: abs });
      if (!data || typeof data.content !== 'string') { showToast('无法读取：' + abs); return; }

      const entry = findFolderEntryByPath(abs);
      if (entry) {
        // 目标在已打开的文件夹树内：同步高亮并保持文件夹上下文
        pushNavSnapshot();
        highlightTreeFile(entry.relPath);
        setDocSource({ kind: 'folder', docPath: abs, relPath: entry.relPath });
        navigateToDoc(data.content, entry.relPath, fragment);
        if (isDesktopTauri && state.folderPath) {
          saveSession({ type: 'tauri', folderPath: state.folderPath, activeRelPath: entry.relPath });
        }
      } else {
        pushNavSnapshot();
        setDocSource({ kind: 'file', docPath: abs });
        navigateToDoc(data.content, data.name || fileNameOf(abs), fragment);
        if (isDesktopTauri) saveSession({ type: 'tauri', name: data.name, path: abs });
      }
      return;
    }

    // 4) 浏览器文件夹模式：只能访问已加载的 File 列表
    if (ds.kind === 'folder') {
      const hit = lookupRelFile(link, ds.relPath || '');
      if (!hit) { showToast('在当前文件夹中找不到：' + link); return; }
      if (!MD_FILE_RE.test(hit.file.name || hit.rel)) {
        showToast('浏览器模式下暂不支持打开非 Markdown 文件');
        return;
      }
      const text = await readFileAsText(hit.file);
      pushNavSnapshot();
      setDocSource({ kind: 'folder', relPath: hit.rel });
      highlightTreeFile(hit.rel);
      navigateToDoc(text, hit.rel, fragment);
      return;
    }

    // 5) 没有基准文档：相对路径无从解析
    showToast('无法确定该相对链接的基准目录，请先打开所在文件夹');
  } catch (e) {
    console.error('[mdviewer] openLocalDocLink failed:', link, e);
    showToast('打开失败：' + ((e && e.message) || e));
  }
}
