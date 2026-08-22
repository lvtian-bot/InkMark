# InkMark

[![Quality](https://github.com/lvtian-bot/InkMark/actions/workflows/quality.yml/badge.svg)](https://github.com/lvtian-bot/InkMark/actions/workflows/quality.yml)
[![Release](https://github.com/lvtian-bot/InkMark/actions/workflows/release.yml/badge.svg)](https://github.com/lvtian-bot/InkMark/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](./LICENSE)

InkMark 是一个桌面端 Markdown 编辑器，用于打开、阅读和编辑本地 `.md` 文件。

## 功能

- 排版编辑与源码模式（CodeMirror）切换
- 多标签页、多文件打开、最近文件与文档大纲
- 查找与替换、格式工具栏及常用 Markdown 操作
- 支持 CommonMark 与常用 GFM 语法（表格、任务列表等）
- 支持本地图片粘贴与拖入，图片保存至文档关联目录
- 浅色/深色主题、字体与启动页设置
- 监听外部文件变化，支持未保存冲突提示
- 直接保存为标准 Markdown 文件

## 下载与安装

1. 打开 [GitHub Releases](https://github.com/lvtian-bot/InkMark/releases/latest)。
2. 下载最新版本的 `.exe` 安装包运行安装。
3. 启动 InkMark 打开本地 `.md` 文件，或将其设为 Markdown 文件的默认打开方式。

## 基本使用

- 在开始页新建文档、打开文件或访问最近文件。
- 使用顶部工具栏完成标题、强调、列表、代码块、链接和表格等常用编辑操作。
- 使用状态栏或快捷键（`Ctrl+/`）切换源码模式与大纲，或打开设置面板调整主题与字体。
- 当外部程序修改当前文件且本地有未保存内容时，InkMark 会提示处理冲突。

## 格式说明

- **排版模式会规范化 Markdown 标记符号**：在排版模式下保存时，语义相同的符号可能会被统一（例如无序列表统一为 `-`）。如需完全保留特定原始符号，可使用源码模式编辑。

## 本地开发

本项目的代码与工程实现由 AI Agent 完成，项目发起者负责产品需求与体验把关。

项目使用 npm 管理依赖，持续集成环境使用 Node.js 24。

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run check
```

构建 Windows 安装包：

```bash
npm run build:win
```

## 问题反馈

如遇问题或建议，欢迎提交 [GitHub Issues](https://github.com/lvtian-bot/InkMark/issues)。

## 技术栈

- Electron、React、TypeScript
- Milkdown（Markdown 编辑核心）
- CodeMirror 6（源码模式）
- electron-vite（构建工具）
- Zustand（状态管理）

## 协议

[MIT License](./LICENSE)
