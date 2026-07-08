# mdviewer

一个单文件的 Markdown 阅读器，零构建、双击即用。支持 LaTeX 公式渲染、代码高亮、Mermaid 图表、主题切换与目录导航。可选 Tauri 桌面应用包装。

## 快速开始

直接双击 `mdviewer.html` 在浏览器中打开即可使用。无需安装、无需构建、无需服务端。

## 使用方式

### 打开文件
- 点击工具栏 **「打开」** 按钮选择 `.md` 文件
- 或将文件/文件夹拖入窗口
- 快捷键 `Ctrl+O`（macOS: `Cmd+O`）

### 打开文件夹
- 点击 **「文件夹」** 按钮选择目录，自动扫描所有 `.md` 文件
- 或直接拖入文件夹
- 侧栏「文件」页签以树形结构展示目录和文件，点击切换

### URL 导入
- 点击 **「URL」** 输入远程 Markdown 文件的直链地址
- 支持 raw.githubusercontent.com 等公开源

### 侧栏
点击 **「侧栏」** 打开/关闭左侧面板，包含两个页签：
- **文件** — 打开文件夹后显示树形文件列表
- **目录** — 自动从文档标题生成，滚动时高亮当前章节

### 选项
点击 **「选项」** 打开设置面板：

| 选项 | 说明 |
|------|------|
| 主题 | 浅色 / 深色 / 护眼 / Nord / Gruvbox / Monokai / Solarized / Solarized Dark / 自定义 |
| 自定义颜色 | 自定义主题下可独立调整背景、文字、标题、链接、代码背景、边框颜色 |
| 代码高亮 | 自动跟随 / 强制浅色 / 强制深色 |
| 字号 | 13–24px 滑块 |
| 行高 | 1.3–2.2 滑块 |
| 字体 | 无衬线 / 衬线 / 等宽 |
| 内容宽度 | 窄 / 中 / 宽 / 全宽 |
| 永不隐藏顶栏 | 勾选后顶栏始终显示，不随滚动自动隐藏 |

## 支持的语法

### Markdown
- 标题（`#` ~ `######`）
- 粗体、斜体、删除线
- 有序/无序列表
- 链接、图片（自动懒加载）
- 引用块
- 表格（斑马条纹）
- 水平线
- 内联代码 / 围栏代码块（自动语法高亮，支持 190+ 语言）

### LaTeX 公式
支持四种定界符，适用于行内公式和独占公式：

| 定界符 | 类型 | 示例 |
|--------|------|------|
| `$...$` | 行内 | `$E=mc^2$` |
| `$$...$$` | 独占 | `$$\sum_{n=1}^\infty \frac{1}{n^2}$$` |
| `\(...\)` | 行内 | `\( \vec{F} = m\vec{a} \)` |
| `\[...\]` | 独占 | `\[ \int_a^b f(x)\,dx \]` |

> `$` 后跟空白（如 `$ x^2 $`）也能正常识别，但会被视为行内公式。

### Mermaid 图表
- ```` ```mermaid ```` 代码块自动渲染为 Mermaid 图表
- 支持流程图、时序图、甘特图、类图等

### 其他渲染特性
- 标题自动生成锚点，鼠标悬停显示 `#` 链接
- 链接默认在新标签页打开（`target="_blank"`）
- 代码块圆角阴影
- 打印时自动隐藏工具栏和侧栏

## 桌面应用 (Tauri)

`application/` 目录包含 Tauri v2 桌面包装，支持 Windows / macOS / Linux。

### 开发

```sh
cd application/src-tauri
cargo tauri dev
```

### 构建安装包

```sh
cd application/src-tauri
cargo tauri build
```

Windows 下生成 NSIS 安装包（`.exe`），位于 `target/release/bundle/nsis/`。

### 更新前端

`application/frontend/index.html` 是 `mdviewer.html` 的副本，改动后需同步：

```sh
cp mdviewer.html application/frontend/index.html
```

## 技术栈

全部由 CDN 引入，单文件内联，无打包构建步骤。

| 库 | 用途 | 版本（锁定） |
|----|------|-------------|
| [marked](https://marked.js.org/) | Markdown 解析 | 15.0.12 |
| [KaTeX](https://katex.org/) | LaTeX 公式渲染 | 0.16.11 |
| [highlight.js](https://highlightjs.org/) | 代码语法高亮 | 11.9.0 |
| [Mermaid](https://mermaid.js.org/) | 图表渲染 | 11.16.0 |

## 界面布局

```
┌──────────────────────────────────────┐
│  mdviewer     [打开] [文件夹] [URL] … │ ← 顶栏（滚动时可隐藏，上滑恢复）
├────────┬─────────────────────────────┤
│        │                             │
│ 侧栏   │       Markdown 内容         │
│ 文件   │       (居中阅读区域)         │
│ 目录   │                             │
│        │                             │
└────────┴─────────────────────────────┘
```

- 侧栏：`position: sticky; top: 0; height: 100vh`，独立滑动
- 顶栏：上滑滑入，下滑滑出，支持「永不隐藏」选项
- 内容区：居中，最大宽度可调

## 兼容性

支持所有现代浏览器（Chrome、Edge、Firefox、Safari）。文件夹拖放功能在 Chrome/Edge (WebView2) 下体验最佳。

## 文件结构

```
mdviewer/
├── mdviewer.html                    # 单文件应用（所有 CSS/JS 内联）
├── application/                     # Tauri 桌面应用包装
│   ├── frontend/index.html          # 前端页面（mdviewer.html 副本）
│   └── src-tauri/                   # Rust + Tauri 源码
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── icons/                   # 应用图标
│       ├── capabilities/            # 权限配置
│       └── src/                     # Rust 入口
└── README.md                        # 本文件
```

## License

MIT
