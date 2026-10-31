const $ = (s, ctx) => (ctx || document).querySelector(s);
const $$ = (s, ctx) => Array.from((ctx || document).querySelectorAll(s));

// ---- theme palette definitions ----
const THEMES = {
  light:       { bg:'#fff', text:'#1a1a2e', heading:'#111', link:'#3451b2', codeBg:'#f4f4f8', border:'#e2e2e2' },
  dark:        { bg:'#0f0f23', text:'#d4d4e8', heading:'#eee', link:'#7ba0f0', codeBg:'#1a1a35', border:'#2a2a45' },
  sepia:       { bg:'#faf0e6', text:'#3b3228', heading:'#2a2218', link:'#7a4a2a', codeBg:'#efe4d0', border:'#d8cdbc' },
  nord:        { bg:'#eceff4', text:'#2e3440', heading:'#2e3440', link:'#5e81ac', codeBg:'#e5e9f0', border:'#d8dee9' },
  gruvbox:     { bg:'#fbf1c7', text:'#3c3836', heading:'#1d2021', link:'#98971a', codeBg:'#efe0b0', border:'#d5c4a1' },
  monokai:     { bg:'#272822', text:'#f8f8f2', heading:'#f8f8f2', link:'#a6e22e', codeBg:'#1e1f1c', border:'#3e3d32' },
  solarized:   { bg:'#fdf6e3', text:'#586e75', heading:'#073642', link:'#268bd2', codeBg:'#eee8d5', border:'#eee8d5' },
  'solarized-dark': { bg:'#002b36', text:'#839496', heading:'#eee8d5', link:'#268bd2', codeBg:'#00313d', border:'#073642' }
};

// ---- state ----
const state = {
  fileName: '',
  folderFiles: [],       // Array<{file, name, relPath, fullPath}>
  folderPath: '',        // Tauri: 已打开文件夹的路径
  docFiles: null,        // Map<normalizedRelPath, File>：文件夹模式下所有文件（用于解析相对图片）
  docBlobUrls: [],       // 已创建的 blob URL，重渲染前释放
  docSource: { kind: 'none' }, // 当前文档基准位置，见 media.js
  settings: loadSettings()
};
const isAndroid = /Android/i.test(navigator.userAgent);
const isDesktopTauri = window.__TAURI__ && !isAndroid;

// ---- 全局提示条 ----
function showToast(msg, duration) {
  if (duration === undefined) duration = 2500;
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, { position:'fixed', bottom:'60px', right:'16px', zIndex:'999', padding:'8px 14px', fontSize:'12px', borderRadius:'8px', background:'var(--panel-bg)', color:'var(--text)', boxShadow:'0 2px 10px var(--panel-shadow)', border:'1px solid var(--border)', maxWidth:'260px', lineHeight:'1.4', opacity:'0', transition:'opacity .25s ease' });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  if (duration > 0) setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, duration);
  return t;
}

function dismissToast(el) { if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); } }

// ---- settings persistence ----
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('mdviewer-settings')) || {}; }
  catch { return {}; }
}
function saveSettings() {
  localStorage.setItem('mdviewer-settings', JSON.stringify(state.settings));
}

// ---- session persistence (last opened file) ----
function saveSession(data) {
  if (state.settings.saveSession === false) return;
  data.sidebarVisible = sidebarVisible;
  const activeTabEl = document.querySelector('.sidebar-tab.active');
  data.activeTab = activeTabEl ? activeTabEl.dataset.panel : 'toc';
  try { localStorage.setItem('mdviewer-session', JSON.stringify(data)); } catch {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('mdviewer-session')) || null; } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem('mdviewer-session'); } catch {}
}
function restoreSidebarSession(session) {
  if (!session) return;
  if (session.sidebarVisible) {
    sidebarVisible = true;
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBtn').classList.add('active');
  }
  if (session.activeTab) {
    $$('.sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === session.activeTab));
    $$('.sidebar-panel').forEach(p => p.classList.toggle('active', p.id.replace('Panel','') === session.activeTab));
  }
}

// ---- keyboard shortcuts ----
const SHORTCUT_ACTIONS = [
  { id: 'openFile', label: '打开文件', default: 'Ctrl+O' },
  { id: 'openFolder', label: '打开文件夹', default: 'Ctrl+Shift+O' },
  { id: 'toggleSidebar', label: '切换侧栏', default: 'Ctrl+B' },
  { id: 'openUrl', label: '打开 URL', default: 'Ctrl+U' },
  { id: 'openSettings', label: '打开选项', default: 'Ctrl+,' },
  { id: 'increaseFontSize', label: '增大字号', default: 'Ctrl+=' },
  { id: 'decreaseFontSize', label: '减小字号', default: 'Ctrl+-' },
  { id: 'closePanels', label: '关闭面板', default: 'Esc' },
];
const DEFAULT_SHORTCUTS = {
  openFile: { key: 'o', ctrl: true, shift: false, meta: false, alt: false },
  openFolder: { key: 'o', ctrl: true, shift: true, meta: false, alt: false },
  toggleSidebar: { key: 'b', ctrl: true, shift: false, meta: false, alt: false },
  openUrl: { key: 'u', ctrl: true, shift: false, meta: false, alt: false },
  openSettings: { key: ',', ctrl: true, shift: false, meta: false, alt: false },
  increaseFontSize: { key: '=', ctrl: true, shift: false, meta: false, alt: false },
  decreaseFontSize: { key: '-', ctrl: true, shift: false, meta: false, alt: false },
  closePanels: { key: 'Escape', ctrl: false, shift: false, meta: false, alt: false },
};
function getShortcuts() {
  return { ...DEFAULT_SHORTCUTS, ...(state.settings.shortcuts || {}) };
}
function shortcutDisplay(s) {
  const parts = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.meta) parts.push('Cmd');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  const k = s.key === ',' ? ',' : s.key === '-' ? '-' : s.key === '=' ? '=' : s.key === 'Escape' ? 'Esc' : s.key.toUpperCase();
  parts.push(k);
  return parts.join('+');
}
function shortcutMatch(e, s) {
  return e.key.toLowerCase() === s.key.toLowerCase() &&
    e.ctrlKey === !!s.ctrl && e.metaKey === !!s.meta &&
    e.shiftKey === !!s.shift && e.altKey === !!s.alt;
}

