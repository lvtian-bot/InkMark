# InkMark

一个 Markdown 编辑器，打开 .md 文件直接编辑，所见即所得。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run build:win
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+N | 新建文件 |
| Ctrl+O | 打开文件 |
| Ctrl+S | 保存 |
| Ctrl+Shift+S | 另存为 |
| Ctrl+Shift+T | 切换明暗主题 |

## 技术栈

- Electron 43 + React 18 + TypeScript 5
- Milkdown 7 (WYSIWYG Markdown 编辑器)
- electron-vite 5 (构建工具)
- Zustand 5 (状态管理)

## 致谢

InkMark 基于众多开源项目构建，感谢所有依赖库的贡献者。完整依赖列表见 [package.json](./package.json)。

## 协议

[MIT](./LICENSE)
