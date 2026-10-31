function render(markdown, name) {
  const contentBody = document.getElementById('content-body');
  const dropzone = document.getElementById('dropzone');
  const loading = document.getElementById('loading');
  const androidWelcome = document.querySelector('.android-welcome');

  if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
  releaseBlobUrls();

  if (!markdown) {
    contentBody.innerHTML = '';
    dropzone.style.display = '';
    if (androidWelcome) androidWelcome.style.display = '';
    document.getElementById('fileName').textContent = '';
    rebuildToc([]);
    return;
  }

  loading.classList.add('show');
  renderTimeout = setTimeout(() => {
    renderTimeout = null;
    try {
      dropzone.style.display = 'none';
      if (androidWelcome) androidWelcome.style.display = 'none';
      const { text, blocks } = protectMath(extractHeadingIds(markdown));
      let html = marked.parse(text);
      html = html.replace(/\x00M_(\d+)\x00/g, (_, idx) => {
        const b = blocks[+idx];
        if (!b) return '';
        try {
          const latex = normalizeMathLatex(b.e);
          return katex.renderToString(latex, {
            displayMode: !!b.d,
            throwOnError: false,
            macros: { '\\cdotp': '\\cdot' }
          });
        }
        catch { return b.d ? `<div class="math-error">${b.e}</div>` : `<span class="math-error">${b.e}</span>`; }
      });
      contentBody.innerHTML = html;
      document.getElementById('fileName').textContent = name || '';

      contentBody.querySelectorAll('pre code').forEach(block => {
        if (block.classList.contains('language-mermaid')) return;
        hljs.highlightElement(block);
      });

      if (typeof mermaid !== 'undefined') {
        contentBody.querySelectorAll('pre code.language-mermaid').forEach(block => {
          const code = block.textContent;
          const pre = block.parentElement;
          const div = document.createElement('div');
          div.className = 'mermaid';
          div.textContent = code;
          pre.parentElement.replaceChild(div, pre);
        });
        try { mermaid.run({ querySelector: '.mermaid' }); } catch (e) { console.warn('mermaid error:', e); }
      }

      addHeadingAnchors();
      hydrateImages(contentBody);
      rebuildToc(headingsList());
      if (window.location.hash) {
        const hash = window.location.hash.slice(1);
        setTimeout(() => jumpToAnchor(hash, { instant: true, skipHash: true }), 100);
      }
    } catch (e) {
      contentBody.innerHTML = `<div style="color:#c00;padding:40px;text-align:center">渲染错误: ${e.message}</div>`;
    }
    loading.classList.remove('show');
  }, 50);
}

function addHeadingAnchors() {
  const ci = document.getElementById('content-body');
  const slugs = new Set();
  ci.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    // 支持 ## 标题 {#custom-id}：extractHeadingIds 留下的临时标记
    const marker = h.querySelector('a[data-anchor-id]');
    const explicitId = marker ? (marker.getAttribute('data-anchor-id') || '').trim() : '';
    if (marker) marker.remove();

    const text = h.textContent.replace(/\s+/g, ' ').trim();
    let slug = explicitId || slugifyHeading(text);
    if (!explicitId) {
      if (slugs.has(slug)) { let i = 2; while (slugs.has(slug + '-' + i)) i++; slug += '-' + i; }
    }
    slugs.add(slug);
    h.id = slug;
    h.dataset.headingText = text;
    const a = document.createElement('a');
    a.className = 'heading-anchor'; a.href = '#' + slug; a.textContent = '#';
    a.title = '锚点链接';
    h.insertBefore(a, h.firstChild);
  });
}

function headingsList() {
  return Array.from(document.getElementById('content-body').querySelectorAll('h1, h2, h3'));
}

let tocObserver = null;
function rebuildToc(headings) {
  const panel = document.getElementById('tocPanel');
  panel.innerHTML = '';
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
  if (!headings.length) return;
  headings.forEach(h => {
    if (!h.id) return;
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.dataset.headingText || h.textContent.trim();
    a.className = 'toc-' + h.tagName.toLowerCase();
    a.addEventListener('click', e => {
      e.preventDefault();
      jumpToAnchor(h.id);
    });
    panel.appendChild(a);
  });
  tocObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        panel.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        const active = panel.querySelector(`a[href="#${entry.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { threshold: 0 });
  headings.forEach(h => tocObserver.observe(h));
}

