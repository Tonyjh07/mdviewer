// ---- theme application ----
function applySettings() {
  const s = state.settings;
  const root = document.documentElement;

  // Auto dark mode: override theme when using light/dark
  let theme = s.theme || 'light';
  if (s.autoDarkMode && (theme === 'light' || theme === 'dark')) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.dataset.theme = theme;

  // Custom colors override
  if (s.theme === 'custom' && s.customColors) {
    const c = s.customColors;
    root.style.setProperty('--bg', c.bg || '#fff');
    root.style.setProperty('--text', c.text || '#1a1a2e');
    root.style.setProperty('--heading', c.heading || '#111');
    root.style.setProperty('--link', c.link || '#3451b2');
    root.style.setProperty('--code-bg', c.codeBg || '#f4f4f8');
    root.style.setProperty('--border', c.border || '#e2e2e2');
  }

  const sizes = { narrow: '580px', medium: '720px', wide: '900px', full: '100%' };
  root.style.setProperty('--content-width', sizes[s.contentWidth] || '720px');

  const fonts = {
    sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif`,
    serif: `'Georgia', 'Noto Serif SC', 'Source Han Serif SC', serif`,
    mono: `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, 'Noto Sans Mono CJK SC', monospace`
  };
  document.body.style.fontFamily = fonts[s.fontFamily] || fonts.sans;
  document.body.style.fontSize = (s.fontSize || 16) + 'px';
  root.style.setProperty('--lh', s.lineHeight || 1.75);
  const ci = document.getElementById('content-inner');
  if (ci) {
    const fs = s.contentFontSize || 100;
    ci.style.fontSize = fs === 100 ? '' : fs + '%';
  }
  root.style.setProperty('--sidebar-font-size', (s.sidebarFontSize || 13) + 'px');

  // Swap sidebar tabs
  const tabsContainer = document.querySelector('.sidebar-tabs');
  const tabs = tabsContainer.querySelectorAll('.sidebar-tab');
  if (s.swapSidebarTabs && tabs.length === 2 && tabs[0].dataset.panel !== 'toc') {
    tabsContainer.appendChild(tabs[0]);
  } else if (!s.swapSidebarTabs && tabs.length === 2 && tabs[0].dataset.panel !== 'files') {
    tabsContainer.appendChild(tabs[0]);
  }

  applyCodeTheme(s.codeTheme || 'auto');
  syncSettingUI();
  syncCustomColorInputs();
  if (typeof applyZoomBtn === 'function') applyZoomBtn();
}

function applyCodeTheme(mode) {
  const overall = state.settings.theme || 'light';
  const effective = mode === 'auto' ? (overall === 'dark' || overall === 'monokai' || overall === 'solarized-dark' ? 'dark' : 'light') : mode;
  const link = document.getElementById('hljs-theme');
  link.href = effective === 'dark'
    ? 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css'
    : 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/stackoverflow-light.min.css';
}

function resetShortcut(id) {
  if (state.settings.shortcuts) delete state.settings.shortcuts[id];
  saveSettings();
  renderShortcutList();
}
function renderShortcutList() {
  const container = document.getElementById('shortcutList');
  if (!container) return;
  const shortcuts = getShortcuts();
  container.innerHTML = SHORTCUT_ACTIONS.map(a => {
    const s = shortcuts[a.id];
    const display = s ? shortcutDisplay(s) : a.default;
    const isCustom = state.settings.shortcuts && a.id in state.settings.shortcuts;
    const resetBtn = isCustom ? `<button class="shortcut-reset" data-action="${a.id}">重置</button>` : '';
    return `<div class="shortcut-row"><span>${a.label}</span><div style="display:flex;gap:4px;align-items:center">${resetBtn}<button class="shortcut-btn" data-action="${a.id}">${display}</button></div></div>`;
  }).join('');
  container.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      capturingShortcut = btn.dataset.action;
      renderShortcutList();
      const el = container.querySelector(`[data-action="${capturingShortcut}"]`);
      if (el) { el.textContent = '按下按键...'; el.classList.add('capturing'); }
    });
  });
  container.querySelectorAll('.shortcut-reset').forEach(btn => {
    btn.addEventListener('click', () => resetShortcut(btn.dataset.action));
  });
}

function syncSettingUI() {
  const s = state.settings;
  const theme = s.theme || 'light';
  $$('#themeGroup .opt-btn').forEach(b => b.classList.toggle('active', b.dataset.value === theme));
  const isCustom = theme === 'custom';
  document.getElementById('customColorsGroup').style.display = isCustom ? '' : 'none';
  $$('#codeThemeGroup .opt-btn').forEach(b => b.classList.toggle('active', b.dataset.value === (s.codeTheme || 'auto')));
  $$('#fontFamilyGroup .opt-btn').forEach(b => b.classList.toggle('active', b.dataset.value === (s.fontFamily || 'sans')));
  $$('#widthGroup .opt-btn').forEach(b => b.classList.toggle('active', b.dataset.value === (s.contentWidth || 'medium')));
  document.getElementById('fontSizeRange').value = s.fontSize || 16;
  document.getElementById('fontSizeValue').textContent = (s.fontSize || 16) + 'px';
  document.getElementById('lineHeightRange').value = s.lineHeight || 1.75;
  document.getElementById('lineHeightValue').textContent = s.lineHeight || 1.75;
  document.getElementById('sidebarFontSizeRange').value = s.sidebarFontSize || 13;
  document.getElementById('sidebarFontSizeValue').textContent = (s.sidebarFontSize || 13) + 'px';
  document.getElementById('alwaysToolbarCb').checked = !!s.alwaysShowToolbar;
  document.getElementById('swapTabsCb').checked = !!s.swapSidebarTabs;
  document.getElementById('swipeSidebarCb').checked = s.swipeSidebar !== false;
  document.getElementById('saveSessionCb').checked = s.saveSession !== false;
  document.getElementById('autoDarkCb').checked = !!s.autoDarkMode;
  document.getElementById('autoDetectLatexCb').checked = !!s.autoDetectLatex;
  renderShortcutList();
}

function syncCustomColorInputs() {
  const c = state.settings.customColors || THEMES.light;
  document.getElementById('cBg').value = c.bg || '#fff';
  document.getElementById('cText').value = c.text || '#1a1a2e';
  document.getElementById('cHeading').value = c.heading || '#111';
  document.getElementById('cLink').value = c.link || '#3451b2';
  document.getElementById('cCodeBg').value = c.codeBg || '#f4f4f8';
  document.getElementById('cBorder').value = c.border || '#e2e2e2';
}

