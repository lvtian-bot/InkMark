# 所见即所得模式：标记浮现（Live Preview）

## 需求

所见即所得模式下，光标不在的块显示为渲染后的样式（大标题、引用块、列表）；光标进入某个块时，该块的 Markdown 标记符号（`#`、`>`、`-`、` ``` ` 等）**浮现出来并可直接编辑**；光标移走后恢复渲染态。参照 Typora 的实时预览（Live Preview）模式。

对应 [`docs/TODO.md`](./TODO.md)「体验与界面」分类下「所见即所得模式：光标进入段落后，相应的标记浮现，并可编辑」。

产品定位与边界见 [`product-positioning.md`](./product-positioning.md)：InkMark 与 Typora 同类，编辑能力以「完整、稳定、好用」为目标，不追求重型写作辅助。

## 范围（本阶段：块级）

先做**块级标记浮现**：标题（`#`）、引用（`>`）、无序列表（`-`/`*`/`+`）、有序列表（`1.`/`1)`）、代码块（fence）。这些是用户最常遇到的块，实现路径相对清晰。

**行级标记浮现**（加粗 `**`、斜体 `*`、行内代码、链接 `[]()`）**暂不做**：它要在已渲染的富文本中间凭空插入标记符号，光标边界、嵌套 marks、中文输入法兼容都有坑，风险高、投入产出比低。待块级稳定后单独评估。

## 技术基础（已完成 / 待补）

- `src/renderer/src/plugins/list-marker.ts` 已让文档模型记住列表的原始标记字符（`bullet_list.bullet`、`ordered_list.bulletOrdered`）。块级浮现显示列表标记时，字符来自这里。
- 标题层级 `heading.level` 已在 schema；浮现用 atx 形式（`#` × level）表示。注意 setext 标题（`===`/`---`）的标记风格未保留，会以 atx 形式浮现。
- **代码块 fence 字符（` ``` ` vs `~~~`）和长度尚未保留**——与列表 bullet 原先同样的问题。若要精确浮现用户的 fence 风格，需补一个类似 `list-marker` 的保留工作；否则代码块浮现统一显示 ` ``` `。

## 设计方向（新会话细化）

每个目标块类型实现一个 NodeView，内部按焦点状态切换两种渲染：

- **失焦（渲染态）**：富文本样式（h1、blockquote、ul、pre）。
- **聚焦（源码态）**：显示标记字符 + 正文，标记可编辑。

关键接缝：Milkdown 的 `$view(nodeSchema, factory)`。项目已有 `plugins/frontmatter.ts`、`plugins/image-view.ts`、`plugins/task-list-view.ts` 三个自定义 NodeView 可参照；其中 frontmatter 就是「失焦渲染边界、聚焦编辑原文」的同类范式。

## 待确认的产品决策（新会话先与用户对齐）

1. **触发方式**：光标进入块即自动浮现（建议，参照 Typora），还是需要额外操作？
2. **可编辑程度**：用户能否直接改标记本身（如 `#`->`##`、`-`->`*`）？需求原文是「并可编辑」，建议支持；但要评估改动如何安全写回文档模型（列表已有 `bullet` 属性可写，标题改 level、引用加/减 `>` 前缀）。
3. **首批块类型与优先级**：标题、列表、引用、代码块，先做哪几个？建议标题 + 列表（最常见）先行。
4. **标记的视觉**：浮现的标记字符样式（灰色淡化、等宽字体）。可参照源码模式 `cm-mark-faded` 的淡化风格（`styles/source-editor.css`）。

### 已确认的决策（2026-08-13）

1. **触发方式**：光标进入块即自动浮现，移走恢复渲染态。
2. **可编辑程度**：Typora 全体验。实际交付方式为「装饰浮现 + 起始位置键势编辑」：
   - 标题：正文起始处按 `#` 升一级（最多 6）、Backspace 降一级（level 1 退化为普通段落）。
   - 列表 / 引用：退出与样式切换沿用既有工具栏与 inputRule；不在本插件改写列表 Backspace 行为（避免重蹈任务列表属性串台的覆辙）。
   - **唯一差距**：光标无法「停在 `##` 字形之间」。这是为覆盖引用/列表容器而做的统一取舍；后续若要极致标题体验，可单独给标题做 NodeView 升级。
3. **首批块类型**：标题、引用、列表（无序 + 有序）。代码块 fence 本阶段不做（需先补 fence 字符保留，单独评估）。
4. **标记视觉**：淡化灰（`var(--text-tertiary)`）+ 等宽（`var(--font-mono)`），对齐源码模式 `cm-mark-faded`。

### 实现要点（2026-08-13）

- 新增 `plugins/block-marker-reveal.ts`（`$prose` 插件），在 `Editor.tsx` 于 `.use(listMarker)` 之后注册。
- 装饰方案（非 NodeView）：`Decoration.widget` 在聚焦块行首注入 `contentEditable=false` 的 `.block-marker` span；列表额外用 `Decoration.node` 加 `reveal-list` 类抑制原生 `disc`/`decimal`。
- 标记字符来源：列表取 `list-marker` 保留的 `bullet`/`bulletOrdered` 属性；标题用 atx 形式 `#`×level；引用固定 `>`。
- 键势优先级：Milkdown 把所有 `.use()` 插件排在 `createInputRules`/`createKeymap` 之前，因此 `handleTextInput`/`handleKeyDown` 天然先于内置 inputRule 与 base keymap，无需额外抢优先级。
- IME 守卫：`view.composing` / `event.isComposing` / `keyCode===229` 期间一律放行。
- 测试：`block-marker-reveal.test.ts`（纯函数）+ `block-marker.integration.test.ts`（happy-dom 真实 Milkdown 往返，含 parse->serialize 不污染、列表标记取自属性、任务列表 checkbox 共存）。

## 风险与回归

- 撤销历史、复制粘贴、格式工具栏命令（如加粗）在源码态的行为。
- 光标跨块移动时的切换闪烁。
- 中文输入法（IME）在源码态的兼容。
- 列表嵌套、任务列表（`- [ ]`）与浮现的叠加；与 `list-marker`、`task-list` 插件的协同。
- 块级 NodeView 切换不能破坏现有列表 CSS（`li > p` 结构）与 frontmatter 渲染。
- 回归入口：[`markdown-compatibility.md`](./markdown-compatibility.md) 的块级样例（标题、引用、列表、代码块、嵌套）。
