// ---- event binding ----
function init() {
  // File open
  document.getElementById('openBtn').addEventListener('click', async () => {
    if (isDesktopTauri) {
      const path = await window.__TAURI__.dialog.open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }]
      });
      if (path) {
        const data = await window.__TAURI__.core.invoke('read_file', { path });
        if (data) { setDocSource({ kind: 'file', docPath: data.path || path }); render(data.content, data.name); saveSession({ type: 'tauri', name: data.name, path }); }
      }
    } else {
      document.getElementById('fileInput').click();
    }
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  // Folder open
  async function pickFolder() {
    function toast(msg) {
      const t = document.createElement('div');
      t.textContent = msg;
      Object.assign(t.style, { position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)', background:'var(--panel-bg)', color:'var(--text)', padding:'10px 20px', borderRadius:'8px', boxShadow:'0 2px 12px var(--panel-shadow)', zIndex:'999', fontSize:'13px', border:'1px solid var(--border)' });
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }
    // 1) Scoped-storage plugin (Android SAF via pickFolder + readDir)
    if (window.__TAURI__ && isAndroid) {
      toast('正在打开文件夹选择器…');
      try {
        const folder = await window.__TAURI__.core.invoke('plugin:scoped-storage|pick_folder', {});
        const handle = folder && (folder.folder || folder);
        if (handle && handle.id) {
          toast('正在扫描文件夹…');
          const mdFiles = await scanScopedFolder(handle.id);
          if (mdFiles.length) {
            for (const f of mdFiles) f.__scopedFolderId = handle.id;
            loadFolder(mdFiles, handle.name || '');
            return;
          }
          toast('文件夹中没有 .md 文件');
          return;
        }
        return;
      } catch (e) {
        const msg = (e && e.message) || (e && e.code) || String(e);
        console.error('Scoped storage:', e);
        if (!msg.includes('CANCELLED') && !msg.includes('cancelled')) {
          toast('文件夹选择失败: ' + msg);
        }
        return;
      }
    }
    // 2) Tauri dialog + fs.readDir (desktop only)
    if (window.__TAURI__ && isDesktopTauri) {
      try {
        const dirPath = await window.__TAURI__.dialog.open({ directory: true });
        if (dirPath) {
          const entries = await window.__TAURI__.fs.readDir(dirPath, { recursive: true });
          const mdFiles = entries.filter(e => !e.children && /\.(md|markdown|mdown)$/i.test(e.name));
          if (mdFiles.length) {
            const mapped = mdFiles.map(e => ({ name: e.name, relPath: e.path.replace(/^.*[/\\]/, ''), fullPath: e.path }));
            const folderName = dirPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || dirPath;
            loadFolder(mapped, folderName);
            return;
          }
          toast('文件夹中没有 .md 文件');
          return;
        }
        return;
      } catch (e) { console.error('Tauri folder:', e); }
    }
    // 3) showDirectoryPicker (recursive traversal)
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker();
        const entries = [];
        async function walkDir(handle, prefix) {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const file = await entry.getFile();
              const relPath = prefix ? prefix + '/' + entry.name : entry.name;
              entries.push({ file, name: entry.name, rel_path: relPath });
            } else if (entry.kind === 'directory') {
              const newPrefix = prefix ? prefix + '/' + entry.name : entry.name;
              await walkDir(entry, newPrefix);
            }
          }
        }
        await walkDir(dir, '');
        if (entries.length) { loadFolder(entries, dir.name); return; }
      } catch (e) { if (e.name !== 'AbortError') console.error('showDirectoryPicker:', e); }
    }
    // 4) webkitdirectory fallback
    const fi = document.getElementById('folderInput');
    fi.click();
    setTimeout(() => { if (!fi.files.length) toast('文件夹选择不可用，请使用 URL 导入'); }, 1200);
  }

  async function scanScopedFolder(folderId, basePath = '', maxDepth = 10) {
    const res = await window.__TAURI__.core.invoke('plugin:scoped-storage|read_dir', {
      req: { folderId, path: basePath || undefined }
    });
    const raw = res && (Array.isArray(res) ? res : res.entries);
    const entries = Array.isArray(raw) ? raw : [];
    const files = [];
    for (const entry of entries) {
      if (entry.isFile && /\.(md|markdown|mdown)$/i.test(entry.name)) {
        files.push({ name: entry.name, relPath: entry.path });
      } else if (entry.isDir && maxDepth > 1) {
        const sub = await scanScopedFolder(folderId, entry.path, maxDepth - 1);
        files.push(...sub);
        if (files.length >= 2000) break;
      }
    }
    return files;
  }
  document.getElementById('folderBtn').addEventListener('click', pickFolder);
  document.getElementById('folderInput').addEventListener('change', e => {
    if (e.target.files.length) loadFolder(e.target.files);
    e.target.value = '';
  });

  // Drag and drop (binding only to outer element, one listener only)
  const dropzoneEl = document.getElementById('dropzone');
  const content = document.getElementById('content');
  let dragCounter = 0;
  content.addEventListener('dragenter', e => {
    e.preventDefault();
    if (++dragCounter === 1) dropzoneEl.classList.add('drag-over');
  });
  content.addEventListener('dragleave', e => {
    e.preventDefault();
    if (--dragCounter === 0) dropzoneEl.classList.remove('drag-over');
  });
  content.addEventListener('dragover', e => e.preventDefault());
  content.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    dropzoneEl.classList.remove('drag-over');
    const dt = e.dataTransfer;
    const droppedFiles = Array.from(dt.files);
    const entry = dt.items && dt.items[0] && dt.items[0].webkitGetAsEntry && dt.items[0].webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      readDirRecursive(entry, '', true).then(files => {
        if (files.length) loadFolder(files);
        else alert('无法直接读取拖入的文件夹，请使用"导入文件夹"按钮打开。');
      });
    } else {
      const file = droppedFiles[0];
      if (file) {
        loadFile(file);
        // WebView2 可能提供非标准的 file.path
        if (isDesktopTauri && file.path && file.name.match(/\.(md|markdown|mdown)$/i)) {
          saveSession({ type: 'tauri', name: file.name, path: file.path });
        }
      }
    }
  });

  // URL
  document.getElementById('urlBtn').addEventListener('click', openUrl);
  document.getElementById('closeUrlBtn').addEventListener('click', closeUrl);
  document.getElementById('urlFetchBtn').addEventListener('click', () => fetchUrl(document.getElementById('urlInput').value.trim()));
  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') fetchUrl(e.target.value.trim());
    if (e.key === 'Escape') closeUrl();
  });

  // Sidebar toggle
  document.getElementById('sidebarBtn').addEventListener('click', toggleSidebar);
  // Sidebar tabs
  $$('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => switchSidebarTab(tab.dataset.panel));
  });

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
  document.getElementById('urlOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeUrl(); });

  // Theme buttons
  $$('#themeGroup .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.value;
      if (btn.dataset.value !== 'custom') delete state.settings.customColors;
      saveSettings();
      applySettings();
    });
  });

  // Custom color inputs
  ['cBg','cText','cHeading','cLink','cCodeBg','cBorder'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      if (!state.settings.customColors) state.settings.customColors = {};
      const map = { cBg:'bg', cText:'text', cHeading:'heading', cLink:'link', cCodeBg:'codeBg', cBorder:'border' };
      state.settings.customColors[map[id]] = e.target.value;
      saveSettings();
      applySettings();
    });
  });

  $$('#codeThemeGroup .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => { state.settings.codeTheme = btn.dataset.value; saveSettings(); applySettings(); });
  });
  $$('#fontFamilyGroup .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => { state.settings.fontFamily = btn.dataset.value; saveSettings(); applySettings(); });
  });
  $$('#widthGroup .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => { state.settings.contentWidth = btn.dataset.value; saveSettings(); applySettings(); });
  });

  // Always show toolbar checkbox
  document.getElementById('alwaysToolbarCb').addEventListener('change', e => {
    state.settings.alwaysShowToolbar = e.target.checked;
    if (e.target.checked) {
      document.getElementById('toolbar').classList.remove('hide');
      document.getElementById('sidebar').classList.remove('full');
    }
    saveSettings();
  });

  // Sliders
  document.getElementById('fontSizeRange').addEventListener('input', e => {
    state.settings.fontSize = +e.target.value; saveSettings(); applySettings();
  });
  document.getElementById('lineHeightRange').addEventListener('input', e => {
    state.settings.lineHeight = +e.target.value; saveSettings(); applySettings();
  });
  document.getElementById('sidebarFontSizeRange').addEventListener('input', e => {
    state.settings.sidebarFontSize = +e.target.value; saveSettings(); applySettings();
  });

  // Swap tabs checkbox
  document.getElementById('swapTabsCb').addEventListener('change', e => {
    state.settings.swapSidebarTabs = e.target.checked; saveSettings(); applySettings();
  });

  // Swipe sidebar checkbox
  document.getElementById('swipeSidebarCb').addEventListener('change', e => {
    state.settings.swipeSidebar = e.target.checked; saveSettings();
  });

  // Save session checkbox
  document.getElementById('saveSessionCb').addEventListener('change', e => {
    state.settings.saveSession = e.target.checked; saveSettings();
  });

  // Auto dark mode checkbox
  document.getElementById('autoDarkCb').addEventListener('change', e => {
    state.settings.autoDarkMode = e.target.checked; saveSettings(); applySettings();
  });

  // Auto-detect LaTeX checkbox
  document.getElementById('autoDetectLatexCb').addEventListener('change', e => {
    state.settings.autoDetectLatex = e.target.checked; saveSettings();
  });

  // Scroll: hide toolbar on down, show on up (desktop only)
  let lastScrollY = 0;
  window.addEventListener('scroll', () => {
    if (window.innerWidth <= 768) return;
    if (state.settings.alwaysShowToolbar) return;
    const sy = window.scrollY;
    if (sy > lastScrollY && sy > 48) {
      document.getElementById('toolbar').classList.add('hide');
      document.getElementById('sidebar').classList.add('full');
    } else if (sy < lastScrollY) {
      document.getElementById('toolbar').classList.remove('hide');
      document.getElementById('sidebar').classList.remove('full');
    }
    lastScrollY = sy;
  }, { passive: true });

  // Keyboard shortcuts (configurable via settings)
  document.addEventListener('keydown', e => {
    // If capturing a shortcut in settings, handle that first
    if (capturingShortcut) {
      e.preventDefault();
      if (e.key === 'Escape') { capturingShortcut = null; renderShortcutList(); return; }
if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
          const cap = capturingShortcut;
          const newS = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey };
          const defS = DEFAULT_SHORTCUTS[cap];
          const isDefault = defS && Object.keys(defS).every(k => defS[k] === newS[k]);
          capturingShortcut = null;
          if (isDefault) {
            if (state.settings.shortcuts) delete state.settings.shortcuts[cap];
          } else {
            if (!state.settings.shortcuts) state.settings.shortcuts = {};
            state.settings.shortcuts[cap] = newS;
          }
          saveSettings();
          renderShortcutList();
          return;
    }
    const shortcuts = getShortcuts();
    for (const [action, s] of Object.entries(shortcuts)) {
      if (shortcutMatch(e, s)) {
        e.preventDefault();
        switch (action) {
          case 'openFile': isDesktopTauri ? document.getElementById('openBtn').click() : document.getElementById('fileInput').click(); break;
          case 'openFolder': isDesktopTauri ? document.getElementById('folderBtn').click() : document.getElementById('folderInput').click(); break;
          case 'toggleSidebar': toggleSidebar(); break;
          case 'openUrl': openUrl(); break;
          case 'openSettings': openSettings(); break;
          case 'increaseFontSize': adjustFontSize(1); break;
          case 'decreaseFontSize': adjustFontSize(-1); break;
          case 'closePanels': closeSettings(); closeUrl(); break;
        }
        return;
      }
    }
  });

  // Android: 固定顶栏 + 侧栏 Drawer 遮罩 + 二级菜单
  if (isAndroid) {
    document.documentElement.classList.add('android');
    state.settings.alwaysShowToolbar = true;
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    document.getElementById('sidebar').after(overlay);
    overlay.addEventListener('click', () => { if (sidebarVisible) toggleSidebar(); });

    // Remove toolbar buttons, show only menu
    ['openBtn','folderBtn','sidebarBtn','urlBtn','settingsBtn'].forEach(id => document.getElementById(id).style.display = 'none');
    document.querySelector('.github-icon').style.display = 'none';
    document.getElementById('menuBtn').style.display = '';
    // fileName 居中
    document.getElementById('fileName').style.textAlign = 'center';

    // Mobile action sheet
    const mobileSheet = document.getElementById('mobileSheet');
    document.getElementById('menuBtn').addEventListener('click', () => mobileSheet.classList.toggle('open'));
    function handleMobileAction(action) {
      if (action === 'openFile') { document.getElementById('fileInput').click(); }
      else if (action === 'openFolder') pickFolder();
      else if (action === 'url') openUrl();
      else if (action === 'sidebar') toggleSidebar();
      else if (action === 'settings') openSettings();
      else if (action === 'github') { if (window.__TAURI__) window.__TAURI__.opener.openUrl('https://github.com/Tonyjh07/mdviewer'); else window.open('https://github.com/Tonyjh07/mdviewer', '_blank'); }
    }
    mobileSheet.querySelectorAll('.mobile-sheet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mobileSheet.classList.remove('open');
        handleMobileAction(btn.dataset.action);
      });
    });
    // Welcome screen action buttons
    document.querySelectorAll('.android-welcome .action-item').forEach(btn => {
      btn.addEventListener('click', () => handleMobileAction(btn.dataset.action));
    });
    // Close sheet on content tap
    document.getElementById('content').addEventListener('click', () => {
      if (mobileSheet.classList.contains('open')) mobileSheet.classList.remove('open');
    });
    // Close sheet on Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mobileSheet.classList.contains('open')) mobileSheet.classList.remove('open');
    });

    // 侧栏手势：左边缘向右滑动切换侧栏
    let swipeStartX = 0, swipeStartY = 0;
    document.addEventListener('touchstart', e => {
      if (e.touches.length === 1) { swipeStartX = e.touches[0].clientX; swipeStartY = e.touches[0].clientY; }
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (state.settings.swipeSidebar === false) return;
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - swipeStartX;
      const dy = e.changedTouches[0].clientY - swipeStartY;
      if (Math.abs(dy) > 120) return;
      const sb = document.getElementById('sidebar');
      const touchX = e.changedTouches[0].clientX;
      // 侧栏已打开：在侧栏上左滑，或在遮罩上任意方向滑动→关闭
      if (sb.classList.contains('open')) {
        if (dx < -30) { toggleSidebar(); }
        else if (touchX > 280 && Math.abs(dx) > 30) { toggleSidebar(); }
      } else {
        // 侧栏关闭：左侧边缘右滑→打开
        if (dx > 30 && swipeStartX < window.innerWidth / 3) toggleSidebar();
      }
    }, { passive: true });
  }

  // Font-size based zoom for content only
  const contentInner = document.getElementById('content-inner');

  applySettings();
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false });
  }

  // Auto dark mode: listen for system color scheme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.autoDarkMode) applySettings();
  });

  function setContentFontSize(pct) {
    const ci = contentInner;
    if (!ci) return;
    const scrollEl = document.scrollingElement || document.documentElement;
    // 记忆视口顶部锚元素及其旧位置（跳过 sticky toolbar）
    let anchor = null, oldTop = 0;
    const tb = document.getElementById('toolbar');
    const y = tb ? tb.offsetHeight + 1 : 1;
    const topEl = document.elementFromPoint(scrollEl.clientWidth / 2, y);
    if (topEl && ci.contains(topEl)) {
      anchor = topEl;
      oldTop = anchor.getBoundingClientRect().top;
    }
    ci.style.fontSize = pct === 100 ? '' : pct + '%';
    requestAnimationFrame(() => {
      if (anchor) {
        const newTop = anchor.getBoundingClientRect().top;
        scrollEl.scrollTop += newTop - oldTop;
      }
    });
  }
  let pinchDist = 0, pinchFs = 100, lastTap = 0;
  contentInner.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinchDist = dist(e.touches); pinchFs = state.settings.contentFontSize || 100; }
  }, { passive: true });
  contentInner.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const zoom = Math.round(Math.min(300, Math.max(50, pinchFs * (dist(e.touches) / pinchDist))));
    state.settings.contentFontSize = zoom;
    setContentFontSize(zoom);
    saveSettings();
    applyZoomBtn();
  }, { passive: false });
  contentInner.addEventListener('touchend', e => {
    if (e.changedTouches.length === 1 && e.changedTouches[0].screenX < 60) return;
    if (e.touches.length) return;
    const now = Date.now();
    if (now - lastTap < 300 && (state.settings.contentFontSize || 100) !== 100) { resetZoom(); }
    lastTap = now;
  });
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  function resetZoom() { state.settings.contentFontSize = 100; setContentFontSize(100); saveSettings(); applyZoomBtn(); }
  function applyZoomBtn() {
    const fs = state.settings.contentFontSize || 100;
    zoomResetBtn.textContent = fs + '%';
    zoomResetBtn.style.display = fs === 100 ? 'none' : '';
  }
  const zoomResetBtn = document.createElement('button');
  zoomResetBtn.id = 'zoomResetBtn';
  Object.assign(zoomResetBtn.style, { position:'fixed', bottom:'16px', right:'16px', zIndex:'999', padding:'6px 12px', fontSize:'13px', border:'1px solid var(--border)', borderRadius:'20px', background:'var(--toolbar-bg)', color:'var(--text)', cursor:'pointer', display:'none', boxShadow:'0 2px 8px var(--panel-shadow)' });
  zoomResetBtn.addEventListener('click', resetZoom);
  document.body.appendChild(zoomResetBtn);

  // Service Worker 只服务于浏览器版的离线缓存。
  // Tauri 桌面/移动端的资源已经内嵌在安装包里，注册 SW 毫无意义，
  // 而且 sw.js 是 cache-first —— 重新构建后仍会返回旧脚本，表现为“改了但没生效”。
  if ('serviceWorker' in navigator) {
    if (window.__TAURI__) {
      // 清理历史上被注册过的 SW 与其缓存（老版本没有这层判断）
      navigator.serviceWorker.getRegistrations()
        .then(rs => Promise.all(rs.map(r => r.unregister())))
        .catch(() => {});
      if (window.caches) {
        caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {});
      }
    } else {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // 内容区链接点击统一处理（页内锚点 / 跨文件路径 / 外链）
  // 注意：必须用 getAttribute('href') 拿原始值。
  // link.href 是浏览器解析后的绝对地址，在 Tauri 下锚点会变成
  // http://tauri.localhost/#标题，被误判成外链而调用 opener.openUrl。
  document.getElementById('content-body').addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = (link.getAttribute('href') || '').trim();
    if (!href) return;

    // 1) 页内锚点
    if (href.startsWith('#')) {
      e.preventDefault();
      const found = jumpToAnchor(href.slice(1));
      link.classList.toggle('anchor-missing', !found);
      return;
    }

    // 2) 外链（http/https/mailto/tel）：交给浏览器或系统默认程序
    if (/^(?:https?:|mailto:|tel:)/i.test(href)) {
      if (window.__TAURI__ && window.__TAURI__.opener) {
        // Ctrl/Cmd/Shift + 点击保留浏览器默认行为（新标签页打开）
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        window.__TAURI__.opener.openUrl(href).catch(() => {});
      }
      return;
    }

    // 3) 其它协议（ftp:、ws: 等）：不支持，提示用户
    // 注意：scheme 至少 2 个字符，单字母的是 Windows 盘符（C:/...），属于本地路径
    const scheme = (href.match(/^([a-z][a-z0-9+.\-]+):/i) || [])[1];
    if (scheme && scheme.toLowerCase() !== 'file') {
      e.preventDefault();
      showToast('暂不支持的链接协议：' + scheme + ':');
      return;
    }

    // 4) 本地路径链接（相对 / 绝对 / file://）：跨文件跳转
    e.preventDefault();
    openLocalDocLink(href);
  });

  initImageLightbox();

  // Desktop Tauri: drag-drop, native session restore, CLI arg
  if (isDesktopTauri) {
    async function handleTauriDrop(paths) {
      const mdPaths = paths.filter(p => /\.(md|markdown|mdown)$/i.test(p));
      if (paths.length === 1 && mdPaths.length === 0) {
        try {
          const isDir = await window.__TAURI__.core.invoke('is_dir', { path: paths[0] });
          if (isDir) {
            const fd = await window.__TAURI__.core.invoke('scan_folder', { path: paths[0] });
            if (fd.files && fd.files.length) { loadFolder(fd.files, paths[0]); return; }
          }
        } catch {}
      }
      if (mdPaths.length) {
        try {
          const data = await window.__TAURI__.core.invoke('read_file', { path: mdPaths[0] });
          if (data) { setDocSource({ kind: 'file', docPath: data.path || mdPaths[0] }); render(data.content, data.name); saveSession({ type: 'tauri', name: data.name, path: mdPaths[0] }); }
        } catch {}
      }
    }
    try {
      const { getCurrentWebview } = window.__TAURI__.webview;
      if (getCurrentWebview) {
        getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          const dz = document.getElementById('dropzone');
          if (p.type === 'over') { dz.classList.add('drag-over'); return; }
          if (p.type === 'leave') { dz.classList.remove('drag-over'); return; }
          if (p.type !== 'drop') return;
          dz.classList.remove('drag-over');
          const paths = p.paths;
          if (!paths || !paths.length) return;
          handleTauriDrop(paths);
        }).catch(() => {});
      }
    } catch (_e) {}
    }

    async function restoreScopedSession(session) {
      const toastEl = showToast('正在恢复上次的会话…', 0);
      try {
        // 验证 folder ID 是否仍有效（scoped-storage 持久化 handle）
        const handles = await window.__TAURI__.core.invoke('plugin:scoped-storage|list_folders', {});
        const list = handles && (handles.folders || handles.handles || (Array.isArray(handles) ? handles : null));
        if (!list) { dismissToast(toastEl); clearSession(); return; }
        const arr = Array.isArray(list) ? list : [];
        const match = arr.find(h => h.id === session.folderId);
        if (!match) { dismissToast(toastEl); clearSession(); return; }
        const mdFiles = await scanScopedFolder(match.id);
        if (mdFiles.length) {
          for (const f of mdFiles) f.__scopedFolderId = match.id;
          loadFolder(mdFiles, match.name || session.folderName || '');
          if (session.activeRelPath && mdFiles.some(f => f.relPath === session.activeRelPath)) {
            loadFolderFileByRel(session.activeRelPath);
          }
        } else { clearSession(); }
        dismissToast(toastEl);
      } catch { dismissToast(toastEl); clearSession(); }
    }

    const session = loadSession();
    restoreSidebarSession(session);
    if (isDesktopTauri) {
      async function restoreTauriSession() {
        if (session && session.type === 'tauri') {
          if (session.path) {
            try {
              const d = await window.__TAURI__.core.invoke('read_file', { path: session.path });
              if (d) { setDocSource({ kind: 'file', docPath: d.path || session.path }); render(d.content, d.name); saveSession({ type: 'tauri', name: d.name, path: d.path }); }
            } catch { clearSession(); }
          } else if (session.folderPath) {
            const toastEl = showToast('正在恢复上次的会话…', 0);
            try {
              const fd = await window.__TAURI__.core.invoke('scan_folder', { path: session.folderPath });
              if (fd.files && fd.files.length) {
                loadFolder(fd.files, session.folderPath);
                if (session.activeRelPath && fd.files.some(f => (f.rel_path) === session.activeRelPath)) {
                  loadFolderFileByRel(session.activeRelPath);
                }
              }
              dismissToast(toastEl);
            } catch { dismissToast(toastEl); clearSession(); }
          }
        }
      }
      window.__TAURI__.core.invoke('get_initial_file').then(data => {
        if (data) {
          setDocSource({ kind: 'file', docPath: data.path });
          render(data.content, data.name);
          saveSession({ type: 'tauri', name: data.name, path: data.path });
        } else {
          restoreTauriSession();
        }
      }).catch(() => restoreTauriSession());
    } else {
      if (session && session.type === 'scoped' && window.__TAURI__) {
        restoreScopedSession(session);
      } else if (session && session.type === 'url') {
        fetchUrl(session.url);
      }
    }
  // URL query parameter: ?url=... (优先级高于会话)
  const qUrl = new URLSearchParams(location.search).get('url');
  if (qUrl) setTimeout(() => fetchUrl(qUrl), 0);
}

document.addEventListener('DOMContentLoaded', init);
