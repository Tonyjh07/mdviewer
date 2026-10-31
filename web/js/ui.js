// ---- sidebar tabs ----
function switchSidebarTab(tab) {
  $$('.sidebar-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === tab));
  $$('.sidebar-panel').forEach(p => p.classList.toggle('active', p.id.replace('Panel','') === tab));
  saveSession(loadSession() || {});
}

// ---- url fetch ----
let urlLoadSeq = 0;

function fetchUrl(url) {
  if (!url) return;
  // GitHub blob → raw.githubusercontent.com
  url = url.replace(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/blob\//i, 'https://raw.githubusercontent.com/$1/');
  const seq = ++urlLoadSeq;
  document.getElementById('loading').classList.add('show');
  fetch(url)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(text => { if (seq !== urlLoadSeq) return; let name = (url.split('/').pop() || url).split('?')[0].split('#')[0]; try { name = decodeURIComponent(name); } catch {} let docUrl = url; try { docUrl = new URL(url, location.href).href; } catch {} setDocSource({ kind: 'url', docUrl }); state.docFiles = null; render(text, name); closeUrl(); saveSession({ type: 'url', url, name }); })
    .catch(e => { if (seq === urlLoadSeq) alert('获取失败: ' + e.message); })
    .finally(() => { if (seq === urlLoadSeq) document.getElementById('loading').classList.remove('show'); });
}

// ---- font size adjustment ----
function adjustFontSize(delta) {
  const s = state.settings;
  const current = s.fontSize || 16;
  const max = +(document.getElementById('fontSizeRange').max || 48);
  const min = +(document.getElementById('fontSizeRange').min || 12);
  const next = Math.max(min, Math.min(max, current + delta));
  if (next !== current) { s.fontSize = next; saveSettings(); applySettings(); }
}

let capturingShortcut = null;

// ---- sidebar toggle ----
let sidebarVisible = false;
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  document.getElementById('sidebar').classList.toggle('open', sidebarVisible);
  document.getElementById('sidebarBtn').classList.toggle('active', sidebarVisible);
  saveSession(loadSession() || {});
}

// ---- settings panel ----
function openSettings() { document.getElementById('settingsOverlay').classList.add('open'); }
function closeSettings() { document.getElementById('settingsOverlay').classList.remove('open'); capturingShortcut = null; }
function openUrl() {
  document.getElementById('urlOverlay').classList.add('open');
  document.getElementById('urlInput').value = '';
  setTimeout(() => document.getElementById('urlInput').focus(), 100);
}
function closeUrl() { document.getElementById('urlOverlay').classList.remove('open'); }

