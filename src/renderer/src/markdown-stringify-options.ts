// Milkdown 序列化 Markdown 时的标记风格，集中管理以便将来平滑升级。
//
// 作用：为 remark-stringify 提供标记风格的「回落默认值」。
//
// 现状（列表/强调已实现按节点保留，见 plugins/list-marker）：
//   - 列表的 bullet（-/*/+）与有序标点（./)）已按节点逐项保留：从文件加载的列表
//     保存后字符不变。这里的 bullet:'-' 只在「没有保留信息」时回落——即工具栏/快捷键
//     新建的列表、或无 position 可回捞的粘贴内容所用的默认字符。
//   - 加粗（**/__）、斜体（*/_）由 Milkdown 内置 remarkMarker 端到端保留，这里的
//     emphasis/strong:'*' 同样只是新建 mark 的回落默认。
//
// 用法：这些字段需与 remarkStringifyOptionsCtx 的默认值（handlers/encode）合并，
// 不能整体覆盖，否则会丢掉 Milkdown 内置的 handlers。详见 Editor.tsx 中的注入。

// remark-stringify 支持的标记风格子集，字段名与 mdast-util-to-markdown 一致。
// 类型也与之一致：bullet 只能是 '*'/'+'/'-'，emphasis/strong 只能是 '*'/'_'。
// 只声明我们要覆盖的字段，其余交给默认值。
export interface MarkdownStringifyOverrides {
  bullet?: '*' | '+' | '-';
  emphasis?: '*' | '_';
  strong?: '*' | '_';
}

// bullet 用 '-'（对齐 Prettier 与 GitHub 主流约定）作为新建/回落的默认字符；
// emphasis/strong 用 '*' 与 Prettier 默认一致。实际保存时按节点保留的标记优先。
export const markdownStringifyOverrides: MarkdownStringifyOverrides = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
};
