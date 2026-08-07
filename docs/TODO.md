# InkMark 待办

## 待开发

- [x] 多标签页
- [x] 源码模式
- [ ] 预览模式：标题标记浮现（光标进入式）
  - 现状：WYSIWYG 视图中标题的 `#` 标记不显示，编辑时无法直观感知标题级别。
  - 目标：光标进入标题行时浮现对应数量的 `#`，移出后隐藏（类似 Typora）。
  - 方案：自定义 heading NodeView，监听选区判断光标是否在节点内，动态插入/移除 `#` 前缀，并处理键盘交互（退格降级、方向键跨标记等）。
  - 复杂度：中等偏上。Milkdown 无现成插件，需自行实现 NodeView 并打磨交互。
  - 备选：鼠标悬停（hover）即显示，不涉及选区与键盘，成本更低，可作轻量替代。
- [ ] 最近文件
- [ ] 查找与替换
  - 源码模式如升级为 CodeMirror 6 可同时获得查找替换能力
- [ ] 导出 HTML / PDF
- [ ] 设置面板
  - 配置存储统一：当前主题/大纲宽度在 localStorage，窗口状态在 window-state.json，应合并到 userData/settings.json
- [ ] 文件树工作区
  - 开发时一并收敛数据源：sourceContent 作为唯一权威内容，切 tab 始终从 sourceContent 反序列化（setMarkdown），EditorState cache 降级为只恢复 selection 和 scroll。原因：文件树带 watcher 后外部文件变更成为高频操作，当前 App.tsx 的 switchingRef/prevTabIdRef/viewModeRef 手动编排三处真源（sourceContent / editorStateCache / DOM）容易漏同步步骤。
- [ ] 图片本地存储
- [ ] 数学公式与图表（KaTeX / Mermaid）
- [x] 固定格式工具栏（加粗/斜体/标题/列表等，常驻编辑区顶部）
- [ ] 可选自动保存（默认关闭）
- [ ] 多文件同时打开
  - 现状：在资源管理器里选中多个 .md 文件一次性用 InkMark 打开，只会打开第一个；应用内的"打开"对话框也只能单选。
  - 多标签页已支持，改动点在两处：启动参数解析和打开对话框允许多选。

## 代码质量与架构

- [x] 文件安全：保存前 mtime 比对 + 冲突提示 + 原子写入（temp + rename）
- [x] 数据模型收敛：删除 store 顶层镜像字段（filePath/fileName/isDirty/outline/wordCount/charCount），改为从 tabs + activeTabId 派生
- [x] EditorState cache 失效：openFile/openFilePath 重用 tab 时清除缓存，防止与 sourceContent 脱同步
- [x] useFile 返回对象 useMemo 稳定化：消除菜单注册和拖放 effect 的反复重注册
- [x] ESLint + Prettier 工具链：flat config 三环境分区，修复 ref 渲染期间更新等 lint 问题
- [x] 冷启动文件竞态修复：双击 .md 打开应用时编辑器可能未初始化完，文件内容存入 store 但未显示；Editor 初始化后从 sourceContent 恢复，setMarkdown 返回是否生效以避免 suppressDirtyRef 误抑制
- [ ] preload sandbox 开启（sandbox: true，preload 未使用任何 Node API）
- [ ] 字数统计 debounce，避免长文档每次 doc change 全量正则计算
- [ ] store 单元测试（Vitest，优先覆盖 tab 增删切换逻辑）
- [ ] 冷启动竞态残留：双击文件冷启动打开后，大纲和字数统计不同步
  - 现状：此场景下编辑器初始化完成后会补载文件内容，但这次补载不会触发正常的内容更新流程，大纲面板保持空白、字数保持 0，直到用户第一次编辑才刷新。
- [ ] 错误反馈：文件操作失败时没有任何提示
  - 现状：保存失败（如文件被设为只读、磁盘已满）时按保存毫无反应；打开文件失败（如文件已被删除）时同样无提示。用户无从知道操作没成功。
  - 方案：在保存/打开的调用处捕获错误，用现有的应用内确认弹窗提示。
- [ ] 外部修改检测延伸：目前只在按下保存的那一刻检查
  - 现状：编辑期间文件被其他程序修改，用户一直不会察觉，直到按保存才看到冲突弹窗。
  - 方案：窗口重新获得焦点时重新检查文件的最后修改时间，发现外部修改就询问是否重载。

## 暂不需要

- [ ] 版本快照
- [ ] 自动更新
- [ ] 专注模式
