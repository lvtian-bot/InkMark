// Milkdown 序列化 Markdown 时的标记风格，集中管理以便将来平滑升级。
//
// 现状（缓解阶段）：
//   remark-stringify 的默认无序列表 bullet 是 '*'，会与项目 Prettier 风格（'-'）
//   以及 GitHub/markdownlint 主流约定冲突——用户在所见即所得模式保存后，文档里的
//   '-' 会被统一改写成 '*'。这里把默认 bullet 钉成 '-'，消除最常见的冲突源。
//
// 根治方向（见 docs/TODO.md「所见即所得模式下保留原始 Markdown 标记符号」）：
//   当前只能输出固定标记，无法逐项保留用户输入的 '-'/'*'/'+'。根治需要在
//   bullet_list 节点 schema 中保存原始标记属性，序列化时按属性还原。
//   到那时，本模块会从「提供固定风格」改为「按节点动态计算风格」，
//   Editor.tsx 的消费代码（注入点）无需改动。
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

// bullet 用 '-'，对齐 Prettier 与 GitHub 主流约定；
// emphasis/strong 用 '*'，与 Prettier 默认一致，避免保存后改写用户输入。
export const markdownStringifyOverrides: MarkdownStringifyOverrides = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
};
