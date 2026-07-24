# 构建概要

## 项目状态

项目已迁移到 `C:\mdviewer`（ASCII-only路径，避免中文字符编译问题）。

## 构建流程（Android）

1. **修改 Rust lib.rs** — 嵌入 frontend 资源路径（`application/frontend`）
2. **`tauri.conf.json`** — 设 `build.frontendDist = "../frontend"`，`android.overridePathCheck = true`
3. **Windows 符号链接问题** — Rust 编译成功，但 `BuildTask.kt` 创建符号链接失败
4. **手动复制 .so** — 从 `build/rust/.../libmdviewer.so` → `jniLibs/arm64-v8a/`
5. **修改 BuildTask.kt** — 跳过 Rust 构建步骤（已预编译 .so）
6. **`gradlew assembleRelease`** — 构建成功，生成的 APK 在 `app/build/outputs/apk/release/`
7. **APK 签名** — 使用 `apksigner` 签名后安装

## 当前问题

**"打开文件"按钮点击无反应** — 用户在空状态界面点击按钮（红色框区域）无任何反馈。

### 可能原因
- Tauri 对话框 (`window.__TAURI__.dialog.open()`) 在 Android 上可能未正确初始化
- 需要检查 `tauri-plugin-dialog` 是否在 Rust 端正确注册
- `tauri-plugin-fs` 的 `read_file` 命令也可能有问题
