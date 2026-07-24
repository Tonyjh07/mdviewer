# mdviewer Desktop & Mobile

基于 [Tauri v2](https://v2.tauri.app/) 的 mdviewer 桌面 + Android 应用包装。

## 前置条件

- [Rust](https://rustup.rs/) 1.70+
- Windows: WebView2（Windows 10+ 已内置）
- macOS: 无额外依赖
- Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential`
- Android: Android Studio, Android SDK 34+, NDK 26+, Java 17+

## 开发

```sh
cd src-tauri
cargo tauri dev          # 桌面开发
cargo tauri android dev  # Android 开发（需连接设备或模拟器）
```

启动后会自动编译并打开 mdviewer 桌面窗口，支持热重载。

## 构建

```sh
cd src-tauri
cargo tauri build                 # 桌面安装包
cargo tauri android build --apk   # Android APK
```

构建产物位于：

- **桌面**: `src-tauri/target/release/bundle/`
  - **Windows**: NSIS 安装包（`.exe`）
  - **macOS**: `.dmg`
  - **Linux**: `.deb` / `.AppImage`
- **Android**: `src-tauri/gen/android/app/build/outputs/apk/`

## Android 特性

- **文件夹浏览** — 通过 `tauri-plugin-scoped-storage` 使用 SAF 选择目录，持久化 handle ID，重启后自动恢复
- **文件打开** — 通过 `tauri-plugin-dialog` + 浏览器 FileReader 读取 `.md` 文件
- **触摸交互** — 双指缩放、侧栏滑动、双击重置、安全区域适配

## 更新前端

`application/frontend/index.html` 是 `mdviewer.html` 的副本。每当根目录的 `mdviewer.html` 更新后，需同步：

```sh
cp ../mdviewer.html frontend/index.html
```

## 项目结构

```
application/
├── frontend/
│   └── index.html               # 前端页面（mdviewer.html 副本）
└── src-tauri/
    ├── Cargo.toml               # Rust 依赖（含 tauri-plugin-scoped-storage）
    ├── tauri.conf.json          # Tauri 配置（窗口大小、标题、Android 标识符等）
    ├── icons/                   # 应用图标（各平台）
    ├── capabilities/            # 权限配置（opener, dialog, scoped-storage）
    └── src/
        ├── lib.rs               # 库入口 + 命令
        └── main.rs              # 桌面入口
```
