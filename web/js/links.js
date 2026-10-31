// ---- 页内锚点解析与跳转 ----

const HEADING_SELECTOR = '#content-body h1, #content-body h2, #content-body h3, #content-body h4, #content-body h5, #content-body h6';

// 与 render.js 生成 id 的规则保持一致（保留中文）
function slugifyHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'heading';
}

// GitHub 风格 slug：去掉标点，空格转连字符
function githubSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 把任意写法的锚点（#标题 / #Title / #%E6%A0%87%E9%A2%98 / #标题-1）解析成元素
function findAnchorTarget(raw) {
  if (!raw) return null;
  let id = String(raw);
  try { id = decodeURIComponent(id); } catch { /* 非法转义，保持原样 */ }
  id = id.replace(/^#/, '').trim();
  if (!id) return null;

  const body = document.getElementById('content-body');
  if (!body) return null;

  // 1) 精确 id / name
  let el = document.getElementById(id);
  if (el) return el;
  el = document.getElementsByName(id)[0];
  if (el) return el;

  // 2) 常见 slug 变体
  for (const candidate of [slugifyHeading(id), githubSlug(id), id.toLowerCase()]) {
    if (!candidate) continue;
    el = document.getElementById(candidate);
    if (el) return el;
  }

  // 3) 退化为标题文本匹配（大小写 / 标点不敏感）
  const want = githubSlug(id);
  if (!want) return null;
  for (const h of $$(HEADING_SELECTOR, body)) {
    const text = (h.dataset.headingText || h.textContent || '').trim();
    if (githubSlug(text) === want) return h;
  }
  return null;
}

function anchorScrollOffset() {
  const tb = document.getElementById('toolbar');
  if (!tb || tb.classList.contains('hide')) return 12;
  return tb.offsetHeight + 12;
}

function flashAnchor(el) {
  if (!el || !/^H[1-6]$/.test(el.tagName)) return;
  el.classList.remove('anchor-flash');
  // 强制重排以便重复点击也能重放动画
  void el.offsetWidth;
  el.classList.add('anchor-flash');
  setTimeout(() => el.classList.remove('anchor-flash'), 1500);
}

function scrollToTarget(target, instant) {
  const smooth = instant ? 'auto' : 'smooth';
  if (/^H[1-6]$/.test(target.tagName)) {
    // 标题走 scrollIntoView，偏移量交给 CSS scroll-margin-top
    target.scrollIntoView({ behavior: smooth, block: 'start' });
  } else {
    const y = target.getBoundingClientRect().top + window.scrollY - anchorScrollOffset();
    window.scrollTo({ top: Math.max(0, y), behavior: smooth });
  }
  flashAnchor(target);
}

function syncHash(raw) {
  const hash = '#' + raw;
  if (window.location.hash === hash) return;
  try { history.pushState(null, '', hash); }
  catch { try { window.location.hash = hash; } catch { /* Tauri 自定义协议下可能不可写，忽略 */ } }
}

// 返回是否成功定位
function jumpToAnchor(raw, opts) {
  const instant = !!(opts && opts.instant);
  const target = findAnchorTarget(raw);
  if (!target) return false;
  scrollToTarget(target, instant);
  if (!(opts && opts.skipHash)) syncHash(decodeURIComponentSafe(raw));
  return true;
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// 浏览器后退/前进时同步滚动位置
window.addEventListener('popstate', () => {
  if (!window.location.hash) return;
  jumpToAnchor(window.location.hash.slice(1), { instant: true, skipHash: true });
});
