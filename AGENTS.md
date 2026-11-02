# AGENTS.md

mdviewer 的硬性约定。只收录改代码时**必须遵守**的约束；功能与用法见 README.md。

## 前端结构
- `web/` 是零构建前端，浏览器版与 Tauri 共用同一份：`tauri.conf.json` 的 `frontendDist` 指向 `../../web`，不要新增复制/同步步骤。
- 脚本必须是经典 `<script>`：不加 `type="module"`、不引入打包器、不用 `import`，否则 `file://` 双击打开会因 CORS 失效。加载顺序固定 `core → theme → markdown → links → media → render → file → nav → ui → init`。
- 新增 JS 文件必须同时改两处：`web/index.html` 的 script 顺序、`web/sw.js` 的 `URLS`。
- 颜色一律用 CSS 变量；不要在组件样式里写字面色值（主题切换依赖 `[data-theme]` 上的变量）。
- `#sidebar` 内 `.sidebar-panel` 的 `min-height: 0` 是面板能滚动的关键，不要删。

## 链接处理
- 判断链接类型一律读 `link.getAttribute('href')` 原始值，不要用 `link.href`：Tauri 下 `#标题` 会被解析成 `http://tauri.localhost/#标题`，从而被误判为外链交给系统浏览器。
- `#content-body` 只允许挂**一个** click 监听器：同一元素上多个监听器的 `preventDefault()` 互不阻断。
- 链接渲染器不要给非 `http(s)` 链接加 `target="_blank"`。
- 协议识别要求 scheme ≥2 个字符（单字母是 Windows 盘符 `C:/`）；`file:` 按本地路径处理。
- 跨文件跳转必须在 `setDocSource()` **之前**调用 `pushNavSnapshot()`；`loadFile` / `loadFolder` / `loadFolderFileByRel` / `fetchUrl` / Tauri 拖放等"打开新根文档"的入口必须调用 `clearNavHistory()`。
- 恢复滚动位置用 `window.scrollTo({behavior:'instant'})`：`html` 上有 `scroll-behavior: smooth`。
- `render()` 入口必须**同步**赋值 `state.currentMarkdown` / `state.currentName`，返回栈快照依赖它，不能挪进 `setTimeout`。
- Rust `resolve_doc_path` 必须返回正斜杠路径，前端全部按 `/` 拼接与比较。

## Service Worker
- 不要在 Tauri 里注册 SW：`http://tauri.localhost` 是 secure context 会注册成功，而 `sw.js` 是 cache-first，会让重新构建的包继续加载旧脚本。注册处必须保留 `!window.__TAURI__` 判断。
- `web/sw.js` 的 Tauri 自毁分支（识别 `tauri.localhost` → 清全部 cache → `unregister()` → 刷新客户端）不得删除。
- 改动 `web/` 下任何文件后，把 `sw.js` 的 `CACHE` 版本号 +1，否则浏览器版用户拿不到更新。

## 构建与验证
- 发版走 `build.ps1`（默认 bump，`-NoBump` 保持版本）。它会同步 `Cargo.toml`、`tauri.conf.json`、`web/index.html` 三处版本号，不要手改其中任意一处。Android 包用 `-Android`。
- 改动 Rust 侧逻辑后必须 `cargo test --lib` 全绿。
- Android 构建必须由 `cargo tauri android build` 驱动，不要直接跑 `gen/android/gradlew`：Gradle 的 `rustBuild*` 任务会调 `cargo tauri android android-studio-script`，该子命令依赖 CLI 侧启动的 WebSocket。
- `gen/android/buildSrc/build.gradle.kts` 的阿里云镜像不能删。只有 `google()` 时国内会卡在直连 `dl.google.com` 且无任何报错。
- 后台构建命令的输出不要接 `| tail`：管道缓冲区塞满会静默卡死，重定向到文件。
- 安卓图标用 `application/scripts/gen_android_icons.py` 生成（满铺方形 + 居中 `m`），不要改用 `tauri icon`：后者会连桌面端/网页的圆形图标一起改掉，而安卓启动器的圆角矩形遮罩会把圆形图裁掉字脚。
- 脚本里调用 `cargo` 时要把 stderr 交给 `cmd` 重定向（`& cmd /c "cargo ... 2>&1"`）：PowerShell 5.1 在 `$ErrorActionPreference='Stop'` 下会把 cargo 的 `Info ...` 当成终止性错误，构建刚起步就假失败。
