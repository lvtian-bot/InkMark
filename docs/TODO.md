# InkMark 待办

产品出发点、定位与边界见 [product-positioning.md](./product-positioning.md)。

## 待开发

未完成项使用“高 / 中 / 低”标明优先度；同一优先度按列表顺序处理。

* [x] 多标签页
* [x] 源码模式
* [x] 状态栏加一个设置按钮；主题调整到视图下面；
  * 已实现：状态栏新增设置按钮（⚙）打开设置弹窗，新增界面主题（浅色/深色）快捷切换按钮（☀/🌙），内容主题仍保留在设置弹窗中。
* [x] 最近文件
* [x] 文件实时监听与 AI 协同编辑（v0.0.4）
  * 已实现：持续监听所有已打开文件；干净标签页自动刷新，存在未保存修改时提示选择；区分自身保存与外部写入，并处理重复事件、文件删除或移动及多标签订阅释放。
  * 保留窗口 focus / visibilitychange 时的 mtime 检查作为监听异常时的兜底。
* [x] 查找与替换（v0.0.4）
  * 已完成：Ctrl+F / Ctrl+H 打开；所见即所得与源码模式均支持上一处、下一处、匹配计数、替换当前和全部替换。
  * 所见即所得模式使用编辑器原生事务，替换可正常撤销并进入文件脏状态；切换标签、模式或内容变化时自动刷新结果。
* [x] Markdown 兼容性清单与回归样例（v0.0.4）
  * 已完成：固定样例覆盖标题、段落、引用、链接、图片、代码、表格、普通列表、任务列表、嵌套结构和 GFM 语法。
  * 回归步骤与通过标准见 [markdown-compatibility.md](./markdown-compatibility.md)。
* [x] 设置面板（v0.0.4）
  * 已完成：集中定义设置模型和默认值，统一存储界面主题、内容主题、大纲显示与宽度；旧 localStorage 配置自动迁移。
  * 已提供可扩展的设置对话框，后续新增配置时继续在统一设置模型中扩展。
* [x] 自定义关于窗口（v0.0.4）
  * 显示规范的产品名称与当前版本号，并适配亮色/暗色主题
* [x] 图片本地存储（v0.0.4）
  * 已完成：粘贴或拖入图片时统一复制到 `${filename}.assets/` 目录，并插入标准 Markdown 相对路径；未保存文档会先提示保存。
  * 支持 PNG、JPEG、GIF、WebP 和 SVG，自动处理安全文件名与重名；非法图片、过大图片和写入失败会显示明确提示。
  * 本地图片通过受控的 `inkmark-local://` 令牌协议显示；切换标签或另存为改变文档路径后会重新解析相对路径。
* [x] 固定格式工具栏（加粗/斜体/标题/列表等，常驻编辑区顶部）
* [x] 待办任务渲染（GFM task list 复选框 + 点击切换 + 工具栏按钮）
* [x] 多文件同时打开（v0.0.4）
  * 现状：在资源管理器里选中多个 .md 文件一次性用 InkMark 打开，只会打开第一个；应用内的"打开"对话框也只能单选。
  * 多标签页已支持，改动点在两处：启动参数解析和打开对话框允许多选。
* [x] 工具栏按钮补齐（v0.0.4）
  * 已完成：代码块、链接、表格三个按钮，WYSIWYG 与源码模式双适配。
* [x] 源码模式升级为 CodeMirror 6（v0.0.5）
  * 已完成：原生 textarea 替换为 CodeMirror 6，Markdown 标记符号淡化（iA Writer 风格，`.cm-mark-faded`）、代码块语法高亮（按需加载各语言）、查找替换与工具栏全部迁移到 CodeMirror。
  * 引入 `SourceEditorHandle` 接口（getValue/setValue/focus/getSelection/setSelection/replaceRange/replaceRangeQuiet/undo/redo），App、useFile、useFindReplace、Toolbar 全部通过该句柄访问源码编辑器，不再依赖裸 textarea ref。
  * 字体保持无衬线（var(--font-family)），不追求等宽对齐；亮/暗主题适配。
  * 后续：作为标题标记浮现（live preview）的底座，标记浮现可直接在 CodeMirror 装饰层实现，无需在 Milkdown 上另做 NodeView。
* [ ] 预览模式：标题标记浮现（光标进入式）（优先度：低）
* [ ] 文件树工作区（优先度：中）
  * 边界：只做类似 Typora 的文件夹浏览、文件切换和基础文件操作，不引入知识库、双向链接、标签系统或数据库视图。
  * 开发时一并收敛数据源：sourceContent 作为唯一权威内容，切 tab 始终从 sourceContent 反序列化（setMarkdown），EditorState cache 降级为只恢复 selection 和 scroll。原因：文件树带 watcher 后外部文件变更成为高频操作，当前 App.tsx 的 switchingRef/prevTabIdRef/viewModeRef 手动编排三处真源（sourceContent / editorStateCache / DOM）容易漏同步步骤。

## 代码质量与架构

* [x] 文件安全：保存前 mtime 比对 + 冲突提示 + 原子写入（temp + rename）
* [x] 数据模型收敛：删除 store 顶层镜像字段（filePath/fileName/isDirty/outline/wordCount/charCount），改为从 tabs + activeTabId 派生
* [x] EditorState cache 失效：openFile/openFilePath 重用 tab 时清除缓存，防止与 sourceContent 脱同步
* [x] useFile 返回对象 useMemo 稳定化：消除菜单注册和拖放 effect 的反复重注册
* [x] ESLint + Prettier 工具链：flat config 三环境分区，修复 ref 渲染期间更新等 lint 问题
* [x] 冷启动文件竞态修复：双击 .md 打开应用时编辑器可能未初始化完，文件内容存入 store 但未显示；Editor 初始化后从 sourceContent 恢复，setMarkdown 返回是否生效以避免 suppressDirtyRef 误抑制
* [ ] preload sandbox 开启（sandbox: true，preload 未使用任何 Node API）（优先度：中）
* [x] 字数统计 debounce，避免长文档每次 doc change 全量正则计算
* [ ] store 单元测试（Vitest，优先覆盖 tab 增删切换逻辑）（优先度：中）
* [x] 冷启动竞态残留：双击文件冷启动打开后，大纲和字数统计不同步
  * 现状：此场景下编辑器初始化完成后会补载文件内容，但这次补载不会触发正常的内容更新流程，大纲面板保持空白、字数保持 0，直到用户第一次编辑才刷新。
* [x] 错误反馈：文件操作失败时没有任何提示
  * 现状：保存失败（如文件被设为只读、磁盘已满）时按保存毫无反应；打开文件失败（如文件已被删除）时同样无提示。用户无从知道操作没成功。
  * 方案：在保存/打开的调用处捕获错误，用现有的应用内确认弹窗提示。
* [x] 外部修改检测延伸：目前只在按下保存的那一刻检查
  * 已实现：窗口 focus / visibilitychange 时遍历所有打开的标签页比对 mtime；干净标签页静默重载，有未保存改动时弹窗询问"重载 / 保留我的改动"。
  * 现状：编辑期间文件被其他程序修改，用户一直不会察觉，直到按保存才看到冲突弹窗。
  * 方案：窗口重新获得焦点时重新检查文件的最后修改时间，发现外部修改就询问是否重载。

##

## 技术债 / 待排期

* [ ] 任务列表渲染方案重构（稳定的任务项 NodeView / 原生复选框）
  * 现状：当前用 `li/p::before` 伪元素、负缩进和点击插件模拟复选框。功能可用，但布局依赖固定 gutter 和 Milkdown 生成的 DOM 结构，字号、行高、换行或主题调整时容易出现复选框与文字错位、勾选符号不可见等回归。
  * 目标：把任务项的复选框渲染放到稳定的编辑器扩展接口中，使复选框与文字自然参与布局，并统一处理点击切换、键盘操作和无障碍语义。
  * 方案：评估并实现自定义 `list_item` NodeView（复选框使用独立的 `contenteditable=false` 控件，正文通过 `contentDOM` 保持 ProseMirror 编辑能力）；同时保留普通无序/有序列表项行为，避免继续在 CSS 伪元素方案上叠加定位补丁。
  * 排期触发：新增键盘切换、无障碍支持，或再次调整编辑器排版导致任务列表回归时优先处理。

***

## 暂不需要

* [ ] 导出 HTML / PDF / 富文本
* [ ] 版本快照
* [ ] 自动更新
* [ ] 专注模式
* [ ] 可选自动保存（默认关闭）
* [ ] 数学公式与图表（KaTeX / Mermaid）
