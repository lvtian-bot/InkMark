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
- 监听外部文件变化，支持重新加载或逐项审阅外部改动
- 支持将当前文档导出为独立 HTML 或 PDF
- 直接保存为标准 Markdown 文件

## 下载与安装

1. 打开 [GitHub Releases](https://github.com/lvtian-bot/InkMark/releases/latest)。
2. 下载最新版本的 `.exe` 安装包运行安装。
3. 启动 InkMark 打开本地 `.md` 文件，或将其设为 Markdown 文件的默认打开方式。

## 基本使用

- 在开始页新建文档、打开文件或访问最近文件。
- 使用顶部工具栏完成标题、强调、列表、代码块、链接和表格等常用编辑操作。
- 使用状态栏或快捷键切换源码模式和大纲；默认 `Ctrl+E` 切换源码模式、`Ctrl+Shift+L` 切换大纲，快捷键可在设置中修改。
- 当外部程序修改当前文件时，选择「重新加载」可直接使用磁盘版本，选择「逐项审阅」可在源码模式中逐块接受或拒绝改动。本地有未保存内容时，先在冲突提示中选择处理方式。审阅期间外部再次发生的改动不会并入本轮；保存时如果原文件已变化，需将审阅结果另存为新文件。
- 在「文件」→「导出」中选择「导出 HTML」或「导出 PDF」，再选择保存位置。HTML 是带样式的独立文件；PDF 按 A4 页面输出。审阅仍有待决改动时，需先处理完待决改动，才能导出。

## 格式说明

- **列表标记的保存**：排版模式会保留从文件读取的无序列表标记（`-`、`*`、`+`）和有序列表标点（`.`、`)`）。没有可保留的原始标记时，保存会回落到等价的默认标记（无序 `-`、有序 `.`）。
- **未保存文档的相对图片**：导出时如果文档尚未保存，图片相对路径可能无法定位；先保存文档可以让导出流程解析文档目录中的本地图片。

## 技术架构

项目的整体技术分层、数据流和模块入口见 [docs/技术架构.md](docs/技术架构.md)。

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
