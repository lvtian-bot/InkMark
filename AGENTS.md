# InkMark 项目规范

## 工作纪律

### 核心铁律

- 不要为以后留下技术债，不要给以后留坑，不要为了实现短期的功能，给以后留大坑。

### 工作规范

- 项目待办记录在 `docs/TODO.md`，开始开发前先读它。每完成一项就将对应条目勾选为 [x]，不要删除；新增需求时追加到末尾，保持文件与实际进度一致。
- 并行任务中，边界明确且可独立验收的实现、文档和检查默认交给 `luna_worker`；涉及跨模块设计、复杂状态或高风险判断时使用默认代理。Luna 缺少上下文时提供自包含任务说明，不因上下文继承方式受限而退回默认代理；主代理负责最终审查、整合与验收。

### 沟通规范

用户提出的需求分两类，区别对待：

- **产品功能**（想要什么效果、什么体验）是沟通重点——主动确认边界、场景与优先级，确认清楚再动手。
- **技术方案**（顺带提的实现思路、架构选择）只供探讨，不当作执行指令；除非用户明确要求按某个方案做，否则按自己的专业判断选最优解，并在落地前简要说明理由。

与维护者讨论问题（bug、风险、审查意见）时，先用场景说明影响，不要堆代码：

- 先讲清楚三件事：用户做什么操作会触发、触发后的实际后果是什么、这个场景是日常普遍的还是极端少见的。
- 描述问题时避免罗列函数名、变量名和内部实现概念；用界面和用户可见的行为来表述（例如"标题栏显示文件名，但编辑区是空白的"）。
- 场景和影响讲清楚之后，再给出具体的代码位置和修复方案。

### 产品边界

- 只支持 Markdown 标准语法。下划线、文字颜色、高亮等没有 Markdown 语法的格式不硬加，不往文档里插 HTML 标签。

InkMark 是一个所见即所得的 Markdown 桌面编辑器，基于 Electron 43、React 18 与 Milkdown 7，使用 electron-vite 构建。

## 项目结构与模块组织

仓库采用 electron-vite 标准的三进程布局：

- `src/main/index.ts` — Electron 主进程（窗口生命周期、文件关联、窗口状态持久化）。
- `src/preload/index.ts` — 预加载脚本，向渲染进程暴露安全的 IPC 桥接。
- `src/renderer/` — 由 Vite 提供的 React 界面。
  - `components/` — `Editor`、`Outline`、`TitleBar`（PascalCase 命名）。
  - `hooks/` — `useFile`、`useOutline`、`useTheme`（统一 `use` 前缀）。
  - `stores/useStore.ts` — 全局状态（Zustand）。
  - `styles/` — 就近放置的纯 CSS（`global.css`、`editor.css`、`outline.css`）。
  - `types/index.ts` — 共享的 TypeScript 类型定义。
- `build/` — 打包资源（应用/文件图标）。`out/` 为 Vite 构建产物，`dist/` 为打包后的应用。

## 待办与进度

项目待办记录在 `docs/TODO.md`。开始开发前先读它，了解当前进度和接下来要做的功能。

## 构建、测试与开发命令

```bash
npm install        # 安装依赖，使用 npm，不要用 pnpm
npm run dev        # 启动 electron-vite 开发模式，支持热重载
npm run build      # 生产构建，输出到 out/
npm run preview    # 预览生产构建
npm run build:win  # 构建并打包 Windows NSIS 安装包到 dist/
npm run lint       # ESLint 代码检查
npm run lint:fix   # ESLint 自动修复
npm run format     # Prettier 格式化全部文件
npm run format:check  # Prettier 检查格式（不写入）
```

目前尚未配置测试套件，没有测试运行器。

## 代码风格与命名约定

- `tsconfig.node.json` 与 `tsconfig.web.json` 均开启 TypeScript `strict` 模式，避免使用 `any` 和未检查的类型断言。
- 2 空格缩进，单引号，语句末尾加分号。
- React 组件用 PascalCase；自定义 Hook 用 camelCase 并以 `use` 开头。
- 样式统一放在 `src/renderer/src/styles/` 下，使用纯 CSS，不要引入 CSS-in-JS 方案。
- 主进程/预加载代码运行在 Node 环境，渲染进程代码运行在 DOM/React 环境，二者使用各自的 tsconfig。

## 测试规范

当前没有测试框架。新增测试时优先选用 Vitest（与 Vite 工具链匹配），测试文件以 `*.test.ts(x)` 形式与源码就近放置，并在声明覆盖率前先添加 `npm test` 脚本。

## 提交与 Pull Request 规范

- 遵循现有的 Conventional Commits 风格：`feat:`、`fix:`、`chore:`、`docs:`（如 `feat: resizable/toggleable outline`）。
- 标题使用祈使句，长度不超过 72 个字符。
- PR 提交到 `main` 分支，包含简要说明以及界面/窗口行为的必要手动验证步骤。
