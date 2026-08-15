# 主题与样式分层

InkMark 的样式分外壳与内容两层管理。本文记录当前结构、历史坑和改动时应遵守的约定，改样式前先读一遍。

## 总体结构

外壳样式（标签栏、工具栏、大纲、状态栏、弹窗等）由 `styles/` 下各自文件管理，颜色统一走 `global.css` 的 CSS 变量，暗色主题由 `[data-theme='dark']` 覆盖。标签栏背景单独用 `--tab-bar-bg`（亮色为淡蓝 `#e4eefa`，暗色复用 `--bg-secondary`），不与其它外壳共用变量。

内容样式（Markdown 正文排版）由"内容主题"决定，目前两套，通过 store 的 `contentTheme` 切换，容器类名为 `.editor-container theme-{inkmark|github}`：

- **InkMark 主题**：`editor.css` 中 `.editor-container.theme-inkmark` 作用域的一段自有样式。
- **GitHub 主题**：复用官方 `github-markdown-css` 包，按亮/暗以 `<link>` 运行时加载（`Editor.tsx` 的主题 effect），并给内容根节点加 `markdown-body` 类才生效。

## nord 基础主题的现状

编辑器基于 Milkdown，其内置主题包 `@milkdown/theme-nord` 曾作为"基础层"常驻，现在的处理是：

- **插件保留**（`nord(ctx)`）。它给根节点加 `prose` / `milkdown-theme-nord` 类名，目前仅作标记，不产生样式。
- **视觉样式表不再加载**（不 import `@milkdown/theme-nord/style.css`）。原因：它常驻生效，反复压过内容主题——表格深色外框加阴影、用 `!important` 强加过大的单元格内边距、表格拉满 100% 宽度。备用主题不该站在前台。
- 它原先提供的少量**编辑器功能性样式**已收归 `editor.css`：选中节点描边（`.ProseMirror-selectednode`）、可拖拽节点的文字选择、表格横向滚动容器（`.tableWrapper`）。

为什么不是"降低优先级当备用"：CSS 级联层（`@layer`）能让层内普通样式输给层外，但 `!important` 的优先级在层内是**反转**的——层内 `!important` 赢层外一切，而 nord 恰好在单元格内边距上用了 `!important`，关进层里它照样赢。直接改 node_modules 也不行，`npm install` / 升级会整体覆盖。所以最终选择视觉层根本不加载。

## 根节点选择器

`<Milkdown />` 渲染的根节点**没有** `.milkdown` 这个类，稳定标识是属性 `data-milkdown-root`（`prose` / `milkdown-theme-nord` 类名来自 nord 插件）。历史上内容限宽居中和 `markdown-body` 挂载两处选择器都挂在 `.milkdown` 上，从未生效，导致 GitHub 主题整体失效、内容限宽失效、表格被压满窗口。凡是 targeting 内容根节点的样式或 JS 查询，一律挂 `[data-milkdown-root]`。

## 改颜色时的同步点

- 右上角窗口按钮区（最小化/最大化/关闭）由系统 `titleBarOverlay` 原生绘制，颜色与窗口启动底色（`backgroundColor`）统一由主进程 `chromeColorsFor(themeId)` 提供，`createWindow` 初始值与 `theme:syncThemeId` 处理器两处都从这里取值。改标签栏或启动底色只改这一个函数，否则右上角色差或启动闪错色。启动底色取主题内容区底色（浅色纯白、深色 `#1e1e2e`），不是标签栏淡蓝——整窗闪标签栏色对白色主体是显眼的异物色块。
- 上次使用的主题由 `theme:syncThemeId` 落盘到 userData 的 `theme.json`，`app.whenReady` 里恢复：首帧前窗口底色、`nativeTheme` 与主题菜单勾选与上次一致；渲染进程设置加载后的 `theme:syncThemeId` 仍是最终真值。
- GitHub 主题亮/暗对应 `github-markdown-light.css` / `github-markdown-dark.css` 两个 `?url` 资源，由 effect 随 `theme` 切换。

## 后续改动约定

- 不改 node_modules 里的第三方样式；覆盖与收归一律放自己的 CSS，用 `.editor-container.theme-*` 等作用域选择器提特异性。
- 新增 Markdown 元素的样式补进两个内容主题各自的作用域，不重新引入全局基础视觉层。
- 我们自己的样式目前不用 `!important`；将来若需要对抗第三方的 `!important`，先考虑能否通过不加载对应样式表解决，而不是对轰。
