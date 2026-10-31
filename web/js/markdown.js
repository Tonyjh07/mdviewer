// ---- marked configuration ----
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const linkRenderer = {
  link(token) {
    const { href, title, text, tokens } = token;
    return `<a href="${escHtml(href)}"${title ? ` title="${escHtml(title)}"` : ''} target="_blank" rel="noopener noreferrer">${escHtml(text)}</a>`;
  },
  image(token) {
    const { href, title, text } = token;
    return `<img src="${escHtml(href)}" alt="${escHtml(text || '')}"${title ? ` title="${escHtml(title)}"` : ''} loading="lazy">`;
  }
};
marked.use({ renderer: linkRenderer, gfm: true, breaks: false });

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

