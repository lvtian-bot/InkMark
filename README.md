# InkMark

[![Quality](https://github.com/lvtian-bot/InkMark/actions/workflows/quality.yml/badge.svg)](https://github.com/lvtian-bot/InkMark/actions/workflows/quality.yml)
[![Release](https://github.com/lvtian-bot/InkMark/actions/workflows/release.yml/badge.svg)](https://github.com/lvtian-bot/InkMark/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](./LICENSE)

InkMark 是一个面向本地 `.md` 文件的所见即所得 Markdown 桌面编辑器，用于查看、编辑和管理日常 Markdown 文档，也适合与 AI 工具协同处理同一批本地文件。

## 核心功能

- 所见即所得编辑与 CodeMirror 源码模式
- 多标签页、多文件打开、最近文件和文档大纲
- 查找替换、固定格式工具栏和常用 Markdown 编辑操作
- CommonMark 与常用 GFM 语法，包括表格和任务列表
- 本地图片粘贴与拖入，图片随文档保存到独立资源目录
- 亮色/暗色界面、内容主题、字体和启动页设置
- 监听外部文件变化；干净文档自动刷新，未保存文档提供差异审阅和冲突选择
- 保存为标准 Markdown 文件，不引入私有文档格式

## 下载与安装

当前发行版提供 Windows 安装包：

1. 打开 [GitHub Releases](https://github.com/lvtian-bot/InkMark/releases/latest)。
2. 下载最新版本的 `.exe` 安装包并完成安装。
3. 启动 InkMark 后打开本地 `.md` 或 `.markdown` 文件；安装后也可以将 InkMark 设为 Markdown 文件的默认打开方式。

macOS 和 Linux 暂无正式发行包。

## 基本使用

- 在开始页新建文档、打开文件或访问最近文件。
- 使用顶部工具栏完成标题、强调、列表、代码块、链接和表格等常用编辑操作。
- 使用状态栏切换源码模式和大纲，并打开设置面板调整主题、字体、工具栏宽度、大纲和启动页。
- 与 AI 或其他工具同时修改文件时，InkMark 会检测外部变化，并在存在未保存内容时提示处理冲突。

### 快捷键

| 快捷键       | 功能         |
| ------------ | ------------ |
| Ctrl+T       | 新建标签页   |
| Ctrl+O       | 打开文件     |
| Ctrl+W       | 关闭标签页   |
| Ctrl+S       | 保存         |
| Ctrl+Shift+S | 另存为       |
| Ctrl+F       | 查找         |
| Ctrl+H       | 查找与替换   |
| Ctrl+,       | 打开设置     |
| Ctrl+/       | 切换源码模式 |
| Alt+E        | 切换源码模式 |

## 已知限制与产品边界

- **所见即所得模式会统一 Markdown 标记符号**：保存时，语义相同的原始写法可能被规范化。例如无序列表的 `-`、`*`、`+` 会统一为 `-`，加粗和斜体也会按固定风格重新生成。源码模式不经过所见即所得序列化，可以原样保留标记符号。
- 当前不建设知识库、双向链接、数据库视图或插件生态；文件树仅用于普通文件浏览和操作。
- 当前不提供 HTML、PDF 或富文本导出，也不以复杂排版和专业出版为目标。

完整定位与边界见 [`docs/product-positioning.md`](docs/product-positioning.md)。

## AI Agent 驱动开发

InkMark 的全部代码与工程实现均由 AI Agent 完成。项目发起者不具备软件开发能力，不负责代码实现或具体工程设计；主要负责提出产品目标、描述使用场景、反馈实际体验并确定功能取舍。

代码、架构、测试、调试、构建和工程维护由 Agent 负责。Agent 根据现有代码、平台限制、依赖能力和长期维护成本判断技术可行性；当 Electron、Tauri 等重大技术路线会影响支持平台、性能、安装分发或长期维护时，由 Agent 讲清方案差异并给出建议，项目发起者确认路线。具体工程实现由 Agent 自主负责。

## 本地开发

项目使用 npm 管理依赖，持续集成环境使用 Node.js 24。

```bash
npm install
npm run dev
```

提交代码前运行完整质量检查：

```bash
npm run check
```

该命令依次执行 ESLint、TypeScript 类型检查、Vitest、Prettier 检查和生产构建。构建 Windows 安装包：

```bash
npm run build:win
```

安装包输出到 `dist/`。当前进度与待办见 [`docs/TODO.md`](docs/TODO.md)。

正式版本通过版本标签触发 GitHub Actions 自动打包和发布。完整步骤、本地安装包留存要求及自动发布机制见 [`docs/release.md`](docs/release.md)。Markdown 兼容性清单用于核心编辑链路的专项验证，不要求每次发布都执行完整人工回归。

## 问题反馈

可以通过 [GitHub Issues](https://github.com/lvtian-bot/InkMark/issues) 反馈问题。请尽量说明触发操作、实际结果、预期结果，以及问题是否可以稳定复现；界面问题可附截图。

## 技术栈

- Electron、React 与 TypeScript
- Milkdown（所见即所得 Markdown 编辑器）
- CodeMirror 6（源码模式）
- electron-vite（构建工具）
- Zustand（状态管理）

## 致谢

InkMark 基于众多开源项目构建，感谢所有依赖库的贡献者。完整依赖列表见 [package.json](./package.json)。

## 协议

[MIT License](./LICENSE)
