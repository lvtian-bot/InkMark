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

import { useStore } from './stores/useStore';

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

// remark-stringify 的 html 节点最小类型。只用 value 字段，避免引入 mdast 传递依赖。
interface HtmlMdastNode {
  value?: unknown;
}

/// 丢弃 Milkdown `preserveEmptyLine` 特性注入的 `<br />` 空行占位（仅序列化方向）。
///
/// 背景：commonmark 预设的 paragraph 序列化 runner 在遇到空段落时（列表回车产生的
/// 空列表项、或文档中的空行），会注入 mdast `html` 节点 `<br />` 作占位，以便重新
/// 解析时还原空行。但序列化方向只走 `remark.stringify`、不运行负责清理的
/// `remark-preserve-empty-line` 插件（它只在解析方向生效），于是 `<br />` 直接落进
/// 保存的文件，污染纯 Markdown 文本（用户看到的就是 `* <br />`）。
///
/// 处理：把值为 `<br />`/`<br>`/`<br/>` 的 html 节点输出为空，其余 html 原样保留。
/// 安全性：用户手写的 `<br />` 在解析阶段已被 `remark-preserve-empty-line` 删除，
/// 不会进入 ProseMirror 文档，所以序列化层遇到的 `<br />` 必来自该特性注入，丢弃它
/// 不影响任何用户内容。代价是所见即所得里多按回车产生的「多余空行」不再被强行保留，
/// 回归标准 Markdown 行为（多余空行折叠为正常段落分隔）。
export function dropBrPlaceholderHandler(node: HtmlMdastNode | undefined): string {
  const value = typeof node?.value === 'string' ? node.value : '';
  return /^<br\s*\/?>$/i.test(value) ? '' : value;
}

/// 序列化硬换行（break）时的处理函数。
///
/// 在宽松换行模式（strictLineBreaks: false，Obsidian 默认）下，段内换行直接输出单字符 '\n'，
/// 保持 Markdown 文本干净，不注入多余的反斜杠或行尾空格。
/// 在严格换行模式（strictLineBreaks: true）下，遵循 mdast-util-to-markdown 的标准行为输出 '\\\n'。
export function breakHandler(
  _node: unknown,
  _parent: unknown,
  _state: unknown,
  _info: unknown,
): string {
  const strict = useStore.getState().strictLineBreaks;
  return strict ? '\\\n' : '\n';
}
