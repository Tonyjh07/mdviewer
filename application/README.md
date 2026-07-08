# mdviewer Desktop

基于 [Tauri v2](https://v2.tauri.app/) 的 mdviewer 桌面应用包装。

## 前置条件

- [Rust](https://rustup.rs/) 1.70+
- Windows: WebView2（Windows 10+ 已内置）
- macOS: 无额外依赖
- Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential`

## 开发

```sh
cd src-tauri
cargo tauri dev
```

启动后会自动编译并打开 mdviewer 桌面窗口，支持热重载。

## 构建

```sh
cd src-tauri
cargo tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`，包括：

- **Windows**: `.msi` 安装包和 `.exe`
- **macOS**: `.dmg`
- **Linux**: `.deb` / `.AppImage`

## 更新前端

`application/index.html` 是 `mdviewer.html` 的副本。每当根目录的 `mdviewer.html` 更新后，需同步：

```sh
cp ../mdviewer.html index.html
```

## 项目结构

```
application/
├── index.html         # 前端页面（mdviewer.html 副本）
└── src-tauri/
    ├── Cargo.toml     # Rust 依赖
    ├── tauri.conf.json # Tauri 配置（窗口大小、标题等）
    ├── icons/         # 应用图标（各平台）
    ├── capabilities/  # 权限配置
    └── src/
        ├── lib.rs     # 库入口
        └── main.rs    # 桌面入口
```
