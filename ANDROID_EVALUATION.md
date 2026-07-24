# mdviewer Android 端可行性评估报告

> 分支：`feature/android-evaluation`
> 日期：2026-07-23

---

## 1. 项目概况

mdviewer 是一个单文件的 Markdown 阅读器，核心为 `mdviewer.html`（约 1278 行），零构建即可在浏览器中运行。已通过 Tauri v2 提供 Windows/macOS/Linux 桌面端支持。

---

## 2. 技术栈分析

| 层面 | 技术 | 对 Android 端的影响 |
|------|------|-------------------|
| 前端语言 | 原生 JavaScript（无框架） | **利好** — 无框架迁移成本，可直接在 WebView 运行 |
| 样式 | CSS3 自定义属性 + 9 套主题 | **利好** — 已有 `@media (max-width: 768px)` 响应式断点 |
| CDN 库 | marked, KaTeX, highlight.js, Mermaid | **利好** — 均可运行于 Android WebView |
| 持久化 | localStorage | **利好** — Android WebView 原生支持 |
| 桌面包装 | Tauri v2 (Rust) | **利好** — Tauri v2 原生支持 Android 构建目标 |
| 文件系统 | Tauri 插件 / 浏览器 File API | **需适配** — Android 使用 Storage Access Framework (SAF) |

### 判据：高可行性

**核心结论：该项目非常适宜移植到 Android 平台，主要得益于无框架的纯前端架构和 Tauri v2 的移动端支持。**

---

## 3. 现有基础——已就绪的部分

### 3.1 Tauri 移动端入口已配置

`application/src-tauri/src/lib.rs` 已存在：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { ... }
```

### 3.2 Android 图标资源已存在

`application/src-tauri/icons/android/` 目录已包含完整的 mipmap 资源：

- `mipmap-xxxhdpi`
- `mipmap-xxhdpi`
- `mipmap-xhdpi`
- `mipmap-hdpi`
- `mipmap-mdpi`
- `playstore-icon.png`

### 3.3 前端代码已有平台分支逻辑

```javascript
if (window.__TAURI__) {
  // 走 Tauri IPC
} else {
  // 浏览器降级（fetch / FileReader / drag-drop DOM API）
}
```

### 3.4 CSS 已有移动端响应式设计

```css
@media (max-width: 768px) { ... }
@media (max-width: 480px) { ... }
```

---

## 4. 需要适配的方面

### 4.1 文件系统访问（核心改造点）

| 当前方案 | Android 方案 |
|---------|-------------|
| `tauri-plugin-dialog` (桌面) | `tauri-plugin-dialog` 在 Android 上支持 SAF |
| `FileReader` (浏览器) | WebView 中可用，但需通过 `input[type=file]` 触发 |
| `webkitGetAsEntry` (拖放文件夹) | Android 上不可用，需使用 SAF 的 `Intent` 或 Document Tree URI |

**建议方案：**
- 文件选择：通过 `input[type=file]` 或 Tauri `dialog` 插件（Android SAF）实现
- 文件夹扫描：通过 SAF Document Tree URI + `DocumentFile` API，或在 Tauri 中编写 Rust 命令利用 `android_content_uri` 相关 API
- 拖放：Android 上不支持拖放，改用工具栏按钮操作

### 4.2 工具栏自适应

- 桌面端顶栏在滚动时自动隐藏/显示
- Android 端应改为固定显示，或将菜单移至底部导航栏
- 对触控交互优化按钮尺寸（至少 48px 触控目标）

### 4.3 侧栏交互

- 桌面端侧栏为 `position: sticky`
- Android 端应改为全屏覆盖式抽屉（Drawer）或底部面板

### 4.4 配置项

- 更新 `tauri.conf.json` 添加 Android 构建配置
- 更新 `Cargo.toml` 确认移动端编译兼容性
- 添加 `AndroidManifest.xml` 配置（Tauri 生成）

---

## 5. 开发计划

### Phase 1: 环境搭建与 Tauri 移动端初始化（1-2 天）

1. 安装 Tauri Android 开发依赖（Android Studio、Android SDK、NDK、rustup targets）
2. 运行 `cargo tauri android init` 初始化 Android 项目
3. 验证 `cargo tauri android dev` 能在模拟器/真机运行
4. 确认 `tauri.conf.json` 中 App Identifier 适配 Android（当前为 `com.mdviewer.desktop`）

### Phase 2: 文件系统适配（2-3 天）

1. 实现 Android 文件选择器（对接 SAF）
2. 实现 Android 文件夹扫描（递归遍历 Document Tree）
3. 实现 URL 导入（当前已有 `fetch` 方案，Android 上无需改动）
4. 禁用拖放功能，添加 Android 端触控替代方案

### Phase 3: UI 适配（2-3 天）

1. 侧栏改为 Drawer 风格
2. 顶栏适配移动端布局（固定或底部导航）
3. 触控交互优化（按钮大小、手势支持、滚动优化）
4. 全面测试所有 CSS 断点

### Phase 4: 构建与发布（1-2 天）

1. 配置 Android 打包（APK / AAB）
2. 测试在不同屏幕尺寸和 Android 版本上的兼容性
3. 生成签名密钥并配置签名
4. 构建发布版 APK/AAB

**预估总工期：6-10 天**

---

## 6. 技术风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| WebView 版本差异 | 部分旧设备可能不支持 ES2020+ | 通过 Babel 转译或维持 Chrome 70+ 要求 |
| CDN 离线不可用 | 首次加载失败 | 将 CDN 库打包为本地资源（Tauri 的 `bundle` 机制） |
| SAF 文件夹递归扫描性能 | 含大量文件的目录可能卡顿 | 加入懒加载 / 分页扫描 |
| 第三方库的 Touch 兼容性 | Mermaid 触控交互可能异常 | 针对触摸事件做专门测试 |
| `marked` / `KaTeX` 的 WebView 兼容性 | 已知在各 WebView 上表现一致，风险低 | 在 Android 8+ 系统 WebView 上验证 |

---

## 7. 结论

| 维度 | 评估 |
|------|------|
| 技术可行性 | **高** — 纯前端 + Tauri v2 架构天然适合移动端 |
| 适配工作量 | **中等** — 主要集中在文件系统适配和 UI 触控优化 |
| 维护成本 | **低** — 核心渲染逻辑无需改动，仅平台适配层需要维护 |
| 风险等级 | **低** — Tauri v2 已有成熟的 Android 支持，上游生态稳定 |

**建议立即启动 Android 端开发。** 当前 `feature/android-evaluation` 分支已创建，可作为开发基础分支。

---

## 8. 参考资源

- [Tauri v2 移动端文档](https://v2.tauri.app/start/mobile/)
- [Tauri Android 集成指南](https://v2.tauri.app/develop/mobile/android/)
- [Android Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider)
- [Tauri 插件：dialog](https://v2.tauri.app/plugin/dialog/)
