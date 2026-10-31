// ---- file loading ----
let fileLoadSeq = 0;

function loadFile(file) {
  if (!file || !file.name.match(/\.(md|markdown|mdown)$/i)) {
    alert('请选择 .md 文件');
    return;
  }
  const seq = ++fileLoadSeq;
  const reader = new FileReader();
  reader.onload = e => {
    if (seq === fileLoadSeq) {
      render(e.target.result, file.name);
      saveSession(loadSession() || {});
    }
  };
  reader.readAsText(file);
}

// ---- folder support (tree) ----
function readDirRecursive(entry, basePath, isRoot) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file(f => {
        const relPath = basePath ? basePath + '/' + entry.name : entry.name;
        resolve([{ file: f, relPath }]);
      }, () => resolve([]));
      return;
    }
    const reader = entry.createReader();
    const all = [];
    function readBatch() {
      reader.readEntries(entries => {
        if (entries.length) { all.push(...entries); readBatch(); return; }
        const prefix = isRoot ? '' : (basePath ? basePath + '/' + entry.name : entry.name);
        Promise.all(all.map(e => readDirRecursive(e, prefix, false))).then(r => resolve(r.flat()), () => resolve([]));
      }, () => resolve([]));
    }
    readBatch();
  });
}

function loadFolder(files, folderPath) {
  const mdFiles = [];
  for (const f of files) {
    const file = f.file || f;
    const name = f.name || file.name;
    const relPath = f.relPath || f.rel_path || (f.file && (f.file.webkitRelativePath || f.file.name)) || file.webkitRelativePath || file.name || name;
    if (name && name.match(/\.(md|markdown|mdown)$/i)) {
      const entry = { name, relPath };
      if (f.fullPath) entry.fullPath = f.fullPath;
      else if (f.full_path) entry.fullPath = f.full_path;
      else if (f.__scopedFolderId) { entry.__scopedFolderId = f.__scopedFolderId; }
      else if (file && !f.file) entry.file = file;
      else if (f.file) entry.file = f.file;
      mdFiles.push(entry);
    }
  }
  if (!mdFiles.length) { alert('文件夹中未找到 .md 文件'); return; }

  mdFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  state.folderFiles = mdFiles;
  state.folderPath = folderPath || '';

  document.getElementById('noFolderMsg').style.display = 'none';
  renderFileTree();

  if (!sidebarVisible) toggleSidebar();
  switchSidebarTab('files');

  loadFolderFileByRel(state.folderFiles[0].relPath);
  const firstFile = state.folderFiles[0];
  if (isDesktopTauri && folderPath) {
    saveSession({ type: 'tauri', folderPath, activeRelPath: state.folderFiles[0].relPath });
  } else if (firstFile && firstFile.__scopedFolderId) {
    saveSession({ type: 'scoped', folderId: firstFile.__scopedFolderId, folderName: folderPath, activeRelPath: state.folderFiles[0].relPath });
  } else {
    saveSession(loadSession() || {});
  }
}

function renderFileTree() {
  const container = document.getElementById('fileTree');
  container.style.display = '';
  container.innerHTML = '';
  const root = { children: {}, files: [] };
  for (const item of state.folderFiles) {
    const parts = item.relPath.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) node.children[parts[i]] = { children: {}, files: [] };
      node = node.children[parts[i]];
    }
    node.files.push(item);
  }
  renderTreeNode(root, container, 0);
}

function renderTreeNode(node, parentEl, depth) {
  const dirNames = Object.keys(node.children).sort();
  const sortedFiles = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const name of dirNames) {
    const dir = node.children[name];
    const row = document.createElement('div');
    const header = document.createElement('button');
    header.className = 'tree-dir-header';
    header.style.paddingLeft = (depth * 16 + 8) + 'px';
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow';
    arrow.textContent = '+';
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = name;
    header.append(arrow, label);
    row.appendChild(header);

    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    childWrap.style.display = 'none';

    header.addEventListener('click', () => {
      const isOpen = childWrap.style.display !== 'none';
      childWrap.style.display = isOpen ? 'none' : '';
      arrow.textContent = isOpen ? '+' : '-';
    });

    renderTreeNode(dir, childWrap, depth + 1);
    row.appendChild(childWrap);
    parentEl.appendChild(row);
  }

  for (const item of sortedFiles) {
    const btn = document.createElement('button');
    btn.className = 'tree-file';
    btn.style.paddingLeft = (depth * 16 + 28) + 'px';
    btn.dataset.rel = item.relPath;
    btn.innerHTML = `<span class="tree-label">${item.name}</span>`;
    if (item.relPath === activeRelPath) btn.classList.add('active');
    btn.addEventListener('click', () => loadFolderFileByRel(item.relPath));
    parentEl.appendChild(btn);
  }
}

let activeRelPath = '';
let loadSeq = 0;

function loadFolderFileByRel(relPath) {
  const idx = state.folderFiles.findIndex(f => f.relPath === relPath);
  if (idx === -1) return;
  activeRelPath = relPath;
  const item = state.folderFiles[idx];

  document.querySelectorAll('#fileTree .tree-file').forEach(el => {
    el.classList.toggle('active', el.dataset.rel === relPath);
  });

  if (item.__scopedFolderId) {
    const seq = ++loadSeq;
    window.__TAURI__.core.invoke('plugin:scoped-storage|read_text_file', {
      req: { folderId: item.__scopedFolderId, path: item.relPath }
    }).then(result => {
      if (seq !== loadSeq) return;
      if (result && result.contents) render(result.contents, item.relPath);
    }).catch(() => {});
  } else if ((item.fullPath || item.full_path) && (isDesktopTauri || window.__TAURI__)) {
    const seq = ++loadSeq;
    const path = item.fullPath || item.full_path;
    (path.startsWith('content://') ? window.__TAURI__.fs.readTextFile(path) : window.__TAURI__.core.invoke('read_file', { path })).then(data => {
      if (seq !== loadSeq) return;
      if (data) {
        if (typeof data === 'string') render(data, item.relPath);
        else render(data.content, item.relPath);
      }
    }).catch(() => {});
  } else if (item.file) {
    const seq = ++loadSeq;
    const reader = new FileReader();
    reader.onload = e => {
      if (seq !== loadSeq) return;
      render(e.target.result, item.relPath);
    };
    reader.readAsText(item.file);
  }

  if (isDesktopTauri && state.folderPath) {
    saveSession({ type: 'tauri', folderPath: state.folderPath, activeRelPath: relPath });
  } else if (window.__TAURI__ && item.__scopedFolderId) {
    saveSession({ type: 'scoped', folderId: item.__scopedFolderId, folderName: state.folderPath, activeRelPath: relPath });
  } else {
    saveSession(loadSession() || {});
  }
}

