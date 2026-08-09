# InkMark

一个所见即所得的 Markdown 桌面编辑器，打开本地 `.md` 文件即可查看和编辑。

## 开发方式

InkMark 的代码由 AI 编写。项目发起者负责提出产品需求、确定功能取舍和判断使用体验，不参与代码编写。

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

## 技术栈

- Electron 43 + React 18 + TypeScript 5
- Milkdown 7 (WYSIWYG Markdown 编辑器)
- electron-vite 5 (构建工具)
- Zustand 5 (状态管理)

## 致谢

InkMark 基于众多开源项目构建，感谢所有依赖库的贡献者。完整依赖列表见 [package.json](./package.json)。

## 协议

[MIT](./LICENSE)
