# mdviewer

**A single-file Markdown reader** — zero build, double-click to use.

## Project Overview

mdviewer is a zero-dependency Markdown viewer delivered as a single HTML file (`mdviewer.html`). It renders Markdown with LaTeX formulas (KaTeX), syntax highlighting (highlight.js), and Mermaid diagrams entirely client-side via CDN-loaded libraries. An optional Tauri v2 wrapper provides desktop features (native file dialogs, file associations, session persistence).

| Aspect | Detail |
|--------|--------|
| Language | JavaScript (vanilla, no framework), Rust (Tauri backend) |
| Build | None for browser; `build.ps1` for Tauri desktop packaging |
| CDN Libs | marked 15.0.12, KaTeX 0.16.11, highlight.js 11.9.0, Mermaid 11.16.0 |
| License | MIT |

## File Structure

```
mdviewer/
├── mdviewer.html               # Single-file application (CSS + HTML + JS inline)
├── build.ps1                    # Tauri desktop build script (PowerShell)
├── build.bat                    # Build launcher (calls build.ps1)
├── application/                 # Tauri v2 desktop wrapper
│   ├── frontend/index.html      # Copy of mdviewer.html
│   ├── src-tauri/
│   │   ├── src/main.rs          # Desktop entry point
│   │   ├── src/lib.rs           # 4 Tauri commands (get_initial_file, read_file, scan_folder, is_dir)
│   │   ├── Cargo.toml           # Rust deps (tauri 2, serde, walkdir)
│   │   ├── tauri.conf.json      # Window, bundle, file association config
│   │   └── capabilities/default.json
│   └── mdviewer.wxs             # WiX v7 MSI installer source
├── README.md                    # Chinese docs
└── AGENT.md                     # This file
```

## Coding Conventions

### JavaScript (mdviewer.html)

**DOM shorthands** — always use these:
```javascript
const $ = (s, ctx) => (ctx || document).querySelector(s);
const $$ = (s, ctx) => Array.from((ctx || document).querySelectorAll(s));
```

**State management** — single global object, no class instances:
```javascript
const state = {
  fileName: '',
  folderFiles: [],
  folderPath: '',
  settings: loadSettings()
};
```

**Settings persistence** — always via `localStorage`:
```javascript
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('mdviewer-settings')) || {}; }
  catch { return {}; }
}
function saveSettings() {
  localStorage.setItem('mdviewer-settings', JSON.stringify(state.settings));
}
```

**Session persistence** — last opened file/folder:
```javascript
function saveSession(data) { ... localStorage.setItem('mdviewer-session', JSON.stringify(data)); ... }
function loadSession() { ... return JSON.parse(localStorage.getItem('mdviewer-session')) ... }
function clearSession() { localStorage.removeItem('mdviewer-session'); }
```

**Cancellation pattern** — use monotonically incrementing sequence counters to discard stale async results:
```javascript
let fileLoadSeq = 0;
function loadFile(file) {
  const seq = ++fileLoadSeq;
  reader.onload = e => {
    if (seq === fileLoadSeq) { render(...); }
  };
}
```
Apply this for: `fileLoadSeq`, `loadSeq` (folder files), `urlLoadSeq`.

**Event binding** — all wired in `init()` (called on `DOMContentLoaded`):
```javascript
function init() {
  document.getElementById('openBtn').addEventListener('click', async () => { ... });
  // ... all event listeners
}
document.addEventListener('DOMContentLoaded', init);
```

**Tauri IPC branching** — check `window.__TAURI__` before calling native APIs:
```javascript
if (window.__TAURI__) {
  const data = await window.__TAURI__.core.invoke('read_file', { path });
} else {
  // fallback to browser FileReader / fetch
}
```

**CSS theming** — 9 preset themes via `[data-theme="..."]` attribute on `<html>`:
```css
:root { --bg: #fff; --text: #1a1a2e; ... }
[data-theme="dark"] { --bg: #0f0f23; --text: #d4d4e8; ... }
```
All visual styling uses CSS custom properties. No hardcoded colors outside `:root` / theme blocks.

**Settings → CSS flow**: `state.settings` → `applySettings()` → set CSS properties on `document.documentElement`.

**Markdown render pipeline** (order matters):
```
protectMath() → marked.parse() → replace placeholders with KaTeX →
highlight.js on <pre><code> → Mermaid on .language-mermaid →
addHeadingAnchors() → rebuildToc()
```

**Code style rules:**
- No semicolons omitted (all statements end with `;`)
- Single quotes for strings
- `===` / `!==` always (no loose equality)
- Arrow functions for callbacks
- `async/await` for Tauri IPC; `.then/.catch` for fetch/FileReader
- `try { ... } catch { ... }` without binding unused error variable (`catch {}`)
- Template literals only when interpolating; otherwise single-quoted strings
- `const` by default, `let` only for reassignment, never `var`
- `Set-Content`/`Copy-Item` (PowerShell), `std::fs` (Rust), no platform-specific path hacks

### Rust (Tauri backend)

**Command pattern** — each Tauri command is a `#[tauri::command] fn` returning `Result<T, String>`:
```rust
#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(FileData { content, name, path })
}
```

**Serialization** — `#[derive(Serialize)]` structs for response types:
```rust
#[derive(Serialize)]
struct FileData { content: String, name: String, path: String }
```

**Error handling** — convert errors to `String` with `.map_err(|e| e.to_string())?`.

### Build Scripts (PowerShell)

**`build.ps1` conventions:**
- `$ErrorActionPreference = "Stop"` at top
- `Write-Host "==> Step ..." -ForegroundColor Cyan` for section headers
- `Write-Host "    result" -ForegroundColor Green` for success output
- Path resolution via `Split-Path -Parent $MyInvocation.MyCommand.Path`
- `Push-Location`/`Pop-Location` for directory-scoped operations
- `Test-Path` before optional steps (e.g., WiX availability check)

## Development Workflow

### Browser (no build)
1. Edit `mdviewer.html` directly
2. Open in browser (double-click or live-reload)
3. All CDN libs load on demand

### Desktop (Tauri)
1. Edit `mdviewer.html`, then sync: `Copy-Item mdviewer.html application/frontend/index.html`
2. Dev: `cd application/src-tauri; cargo tauri dev`
3. Build: `.\build.bat` or `.\build.ps1` (auto-increments patch version, syncs frontend, compiles, generates NSIS/MSI)

### Keeping frontend in sync
The Tauri frontend (`application/frontend/index.html`) is a copy of `mdviewer.html`. After any HTML change:
```powershell
Copy-Item mdviewer.html application/frontend/index.html -Force
```
Build scripts do this automatically.

## Environment & Dependencies

| Dependency | Version | Source |
|------------|---------|--------|
| marked | 15.0.12 | CDN (jsdelivr) |
| KaTeX | 0.16.11 | CDN (jsdelivr) |
| highlight.js | 11.9.0 | CDN (jsdelivr) |
| Mermaid | 11.16.0 | CDN (jsdelivr) |
| Tauri | 2 | Cargo |
| Rust | edition 2021 | rustc |
| serde / serde_json | 1 | Cargo |
| walkdir | 2 | Cargo |

No npm, no bundler, no build step for the browser version.

## Conventions Summary

| Rule | Standard |
|------|----------|
| Indentation | 2 spaces (HTML/JS) |
| Quotes | Single quotes for JS strings |
| Variable declaration | `const` default, `let` for reassignment |
| DOM queries | `$()` / `$$()` shorthands |
| State | Single `state` object |
| Persistence | `localStorage` with `load*`/`save*`/`clear*` pattern |
| Async cancellation | Monotonic sequence counter guard |
| Tauri branching | `if (window.__TAURI__) { ... } else { browser fallback }` |
| CSS theming | `[data-theme]` attribute + CSS custom properties |
| Settings → CSS | `applySettings()` sets variables on `document.documentElement` |
| Error handling | `try { ... } catch {}` (unused error var omitted) |
| Build versioning | Auto-increment patch in `Cargo.toml` + `tauri.conf.json` |
| HTML lang | `zh-CN` |
