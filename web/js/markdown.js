// ---- marked configuration ----
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 保留链接文字里的行内格式（加粗 / 行内代码等）
function renderInline(renderer, token) {
  if (renderer && renderer.parser && token.tokens) {
    try { return renderer.parser.parseInline(token.tokens); } catch { /* 回退到纯文本 */ }
  }
  return escHtml(token.text || '');
}

const linkRenderer = {
  link(token) {
    const href = token.href || '';
    const title = token.title ? ` title="${escHtml(token.title)}"` : '';
    const text = renderInline(this, token);
    // 页内锚点和相对链接不能加 target=_blank，否则 [#小节] 会整页跳走
    const isExternal = /^https?:\/\//i.test(href);
    const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    // 页内锚点 / 跨文件路径链接分别加不同的 class，便于区分与样式
    // scheme 至少 2 个字符，单字母的是 Windows 盘符（C:/...），属于本地路径
    const scheme = (href.match(/^([a-z][a-z0-9+.\-]+):/i) || [])[1];
    const isLocalFile = href && !isExternal && (!scheme || scheme.toLowerCase() === 'file');
    let cls = '';
    if (/^#/.test(href)) cls = ' class="anchor-link"';
    else if (isLocalFile) cls = ' class="file-link"';
    return `<a href="${escHtml(href)}"${title}${cls}${attrs}>${text}</a>`;
  },
  image(token) {
    const { href, title, text } = token;
    return `<img src="${escHtml(href || '')}" alt="${escHtml(text || '')}"${title ? ` title="${escHtml(title)}"` : ''} loading="lazy" decoding="async">`;
  }
};
marked.use({ renderer: linkRenderer, gfm: true, breaks: false });

// ---- 支持标题自定义锚点：## 标题 {#custom-id} ----
// 转成一个临时标记元素，随后由 addHeadingAnchors 取走并删除
function extractHeadingIds(md) {
  const parts = String(md).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // 围栏代码块内不处理
    return part.replace(
      /^(#{1,6}[ \t]+[^\n]*?)[ \t]*\{#([^}\s]+)\}[ \t]*$/gm,
      (_, head, id) => `${head} <a data-anchor-id="${escHtml(id)}"></a>`
    );
  }).join('');
}

// ---- preprocess math before markdown parsing (handles nesting reliably) ----
function protectMath(md) {
  const blocks = [];
  // Split by fenced code blocks to avoid matching $ inside them
  const parts = md.split(/(```[\s\S]*?```)/);
  const processed = parts.map((part, i) => {
    if (i % 2 === 1) return part; // code block — leave as-is
    let t = part;
    // Auto-detect bare LaTeX (no delimiters) when setting is on
    if (state.settings.autoDetectLatex) {
      // Split by CJK characters; non-CJK segments containing \command become math
      t = t.replace(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g, (seg) => {
        if (!/\\[a-zA-Z]/.test(seg)) return seg;
        seg = seg.trim();
        if (!seg) return seg;
        // If the segment already starts/ends with $ or $$, leave it alone
        if (/^\$/.test(seg) || /\$$/.test(seg)) return seg;
        return '$' + seg + '$';
      });
    }
    // block math $$...$$ and \[...\]
    t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, e) => { const id = `\x00M_${blocks.length}\x00`; blocks.push({ d:1, e:e.trim() }); return id; });
    t = t.replace(/\\\[([\s\S]+?)\\\]/g, (_, e) => { const id = `\x00M_${blocks.length}\x00`; blocks.push({ d:1, e:e.trim() }); return id; });
    // inline math $...$ (multiline, but not inside code blocks — already protected above)
    t = t.replace(/\$([\s\S]+?)\$/g, (_, e) => { const id = `\x00M_${blocks.length}\x00`; blocks.push({ d:0, e:e.trim() }); return id; });
    // inline math \(...\)
    t = t.replace(/\\\((.+?)\\\)/g, (_, e) => { const id = `\x00M_${blocks.length}\x00`; blocks.push({ d:0, e:e.trim() }); return id; });
    // protect standalone \cdot and \cdotp used in regular text
    t = t.replace(/\\(?:cdot|cdotp)(?=$|[^\w])/g, () => {
      const id = `\x00M_${blocks.length}\x00`;
      blocks.push({ d:0, e:'\\cdot' });
      return id;
    });
    return t;
  });
  return { text: processed.join(''), blocks };
}

// ---- render pipeline ----
let renderTimeout = null;

function normalizeMathLatex(latex) {
  // Handle \cdot, \cdotp and Unicode · within \text{} by splitting them out
  // E.g., \text{N\cdotm} becomes \text{N}\cdot\text{m}
  // and  \text{kg·m} becomes \text{kg}\cdot\text{m}
  let result = latex;
  
  // Handle LaTeX commands: \cdot and \cdotp
  result = result.replace(/\\text\{([^}]*?)(\\cdot|\\cdotp)([^}]*)\}/g, (match, before, cmd, after) => {
    const cdot = '\\cdot';
    const beforePart = before ? `\\text{${before}}` : '';
    const afterPart = after ? `\\text{${after}}` : '';
    return beforePart + cdot + afterPart;
  });
  
  // Handle Unicode middle dot: · (U+00B7) and · (U+22C5)
  result = result.replace(/\\text\{([^}]*?)(·|\u00B7)([^}]*)\}/g, (match, before, dot, after) => {
    const beforePart = before ? `\\text{${before}}` : '';
    const afterPart = after ? `\\text{${after}}` : '';
    return beforePart + '\\cdot' + afterPart;
  });
  
  // Replace remaining standalone \cdot and \cdotp with ·
  result = result
    .replace(/\\cdotp/g, '·')
    .replace(/\\cdot/g, '·')
    .replace(/\u00B7/g, '·');
    
  return result;
}

