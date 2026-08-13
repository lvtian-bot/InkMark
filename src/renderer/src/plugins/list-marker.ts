import { $remark } from '@milkdown/kit/utils';
import { bulletListSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark';

/// 所见即所得模式下保留列表的原始 Markdown 标记符号。
///
/// 背景：remark-parse 解析时会把无序列表的 `-`/`*`/`+` 和有序列表的 `1.`/`1)` 标点
/// 归一化丢弃，mdast 的 `list` 节点只保留 `ordered`/`start`。于是序列化时只能按全局
/// 固定字符输出（InkMark 默认无序 `-`、有序 `.`），用户原文的 `*` 或 `1)` 保存后变了样。
///
/// 思路（对齐 Milkdown 内置的 strong/emphasis `remarkMarker` 范式，三步缺一不可）：
///   1. remark 插件：解析后，按 mdast 节点的 `position.start.offset` 回到原始 Markdown
///      串里取出标记字符，写回 `node.bullet`（无序）/`node.bulletOrdered`（有序）。
///      mdast 本身不存这些字符，只能靠 position+offset 回捞。
///   2. extendSchema：给 `bullet_list`/`ordered_list` 各加一个标记属性，解析 runner 把
///      mdast 的字符读进 ProseMirror 节点属性，序列化 runner 再把它写回 mdast。
///      这一步保证信息能穿过 ProseMirror 文档模型这个中转。
///   3. 自定义 `list` 序列化处理器：内置 handler 只读全局 `options.bullet`、忽略节点上的
///      字符，必须替换它，改为优先读 `node.bullet`/`node.bulletOrdered`，回落到全局默认。
///
/// 加粗 `**`/`__`、斜体 `*`/`_` 已由 Milkdown 内置机制端到端保留，本插件不再处理。

// ---- mdast 最小类型 ----
//
// 字段除 type 外均可选，且 ordered/start/spread/options.* 允许 null，以便结构兼容 mdast
// 标准类型（Root/List/State 的这些字段都含 null）。不引入 @types/mdast 这个传递依赖。

interface MdastPosition {
  start?: { offset?: number };
}

interface MdastNode {
  type: string;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  bullet?: string;
  bulletOrdered?: string;
  children?: MdastNode[];
  position?: MdastPosition;
}

interface VFileLike {
  value?: unknown;
}

// 递归遍历，对所有 `list` 节点执行回调（含嵌套子列表）。不依赖 unist-util-visit。
function forEachList(root: MdastNode, fn: (node: MdastNode) => void): void {
  if (root.type === 'list') fn(root);
  for (const child of root.children ?? []) forEachList(child, fn);
}

// ---- 标记字符检测（纯函数，便于单测） ----

// 无序列表行首：允许前导空白（嵌套缩进），取首个 -/*/+，其后须是空白或行尾。
const BULLET_RE = /^\s*([-*+])(?:[ \t]|$)/;
// 有序列表行首：跳过数字，取标点 . 或 )。
const ORDERED_RE = /^\s*\d+([.)])(?:[ \t]|$)/;

/// 从原始 Markdown 串的指定偏移处检测无序 bullet 字符；检测不到返回 undefined。
export function detectBullet(source: string, offset: number | undefined): string | undefined {
  if (offset == null || offset < 0 || offset > source.length) return undefined;
  return source.slice(offset).match(BULLET_RE)?.[1];
}

/// 从原始 Markdown 串的指定偏移处检测有序标点（`.` 或 `)`）；检测不到返回 undefined。
export function detectBulletOrdered(
  source: string,
  offset: number | undefined,
): string | undefined {
  if (offset == null || offset < 0 || offset > source.length) return undefined;
  return source.slice(offset).match(ORDERED_RE)?.[1];
}

// ---- 1. remark 插件：回捞标记字符到 mdast ----

/// transformer：遍历 mdast，按 position offset 把标记字符写回 list 节点。
export function listMarkerTransformer(tree: MdastNode, file: VFileLike): void {
  const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');
  forEachList(tree, (node) => {
    const offset = node.position?.start?.offset;
    if (node.ordered) {
      const marker = detectBulletOrdered(source, offset);
      if (marker) node.bulletOrdered = marker;
    } else {
      const marker = detectBullet(source, offset);
      if (marker) node.bullet = marker;
    }
  });
}

// unified.use 期望 attacher（调用后返回 transformer），这里包一层。
// 导出供单测直接接入 unified 流水线，不依赖 Milkdown ctx。
export const listMarkerAttacher = () => listMarkerTransformer;

const remarkListMarker = $remark('remarkListMarker', () => listMarkerAttacher);

// ---- 2. extendSchema：给列表节点加标记属性并改 runner ----

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

// bullet_list：新增 `bullet` 属性，默认 '-'（对齐项目固定风格），解析时读 mdast、
// 序列化时写回 mdast。其余 schema 字段（content/group/parseDOM/toDOM）保留原样。
const bulletListMarkerSchema = bulletListSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, bullet: { default: '-', validate: 'string' } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state
          .openNode(type, { spread: node.spread ?? false, bullet: pickString(node.bullet, '-') })
          .next(node.children)
          .closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state
          .openNode('list', undefined, {
            ordered: false,
            spread: node.attrs.spread,
            bullet: node.attrs.bullet,
          })
          .next(node.content)
          .closeNode();
      },
    },
  };
});

// ordered_list：新增 `bulletOrdered` 属性，默认 '.'，保留原有的 order/spread 逻辑。
const orderedListMarkerSchema = orderedListSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, bulletOrdered: { default: '.', validate: 'string' } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state
          .openNode(type, {
            spread: node.spread ?? false,
            order: node.start ?? 1,
            bulletOrdered: pickString(node.bulletOrdered, '.'),
          })
          .next(node.children)
          .closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state
          .openNode('list', undefined, {
            ordered: true,
            start: node.attrs.order ?? 1,
            spread: node.attrs.spread,
            bulletOrdered: node.attrs.bulletOrdered,
          })
          .next(node.content)
          .closeNode();
      },
    },
  };
});

// ---- 3. 自定义 list 序列化处理器 ----
//
// 语义忠实对齐 mdast-util-to-markdown@2.1.2 的 handle/list.js，唯一改动：bullet/标点的
// 取值优先读节点上的 `node.bullet`/`node.bulletOrdered`，回落到全局 `options.*`（默认无序
// `*`、有序 `.`）。内置 handler 完全不读节点上的字符，所以必须替换。
//
// `useDifferentMarker` 分支（避免与分隔线 `---`/`***` 拼成一个大的 thematic break）是
// 序列化正确性的关键，必须原样保留。

interface MdastListItemChild {
  type: string;
  children?: MdastListItemChild[];
}

interface MdastListItemLike {
  type: string;
  children?: MdastListItemChild[];
}

interface MdastListSerializeNode {
  ordered?: boolean | null;
  bullet?: string;
  bulletOrdered?: string;
  children?: MdastListItemLike[];
}

interface SerializeState {
  enter(type: string): () => void;
  bulletCurrent: string | undefined;
  bulletLastUsed: string | undefined;
  stack: string[];
  indexStack: number[];
  options: {
    bullet?: string | null;
    bulletOther?: string | null;
    bulletOrdered?: string | null;
    rule?: string | null;
  };
  containerFlow(node: unknown, info: unknown): string;
}

/// 自定义 list 序列化处理器。导出供单测与 remarkStringifyOptionsCtx 注入共用。
export function listMarkerHandler(
  node: MdastListSerializeNode,
  parent: unknown,
  state: SerializeState,
  info: unknown,
): string {
  const exit = state.enter('list');
  const bulletCurrent = state.bulletCurrent;

  let bullet: string;
  let bulletOther: string;

  if (node.ordered) {
    bullet = node.bulletOrdered ?? state.options.bulletOrdered ?? '.';
    if (bullet !== '.' && bullet !== ')') bullet = '.';
    bulletOther = bullet === '.' ? ')' : '.';
  } else {
    bullet = node.bullet ?? state.options.bullet ?? '*';
    if (bullet !== '*' && bullet !== '+' && bullet !== '-') bullet = '*';
    // bulletOther 必须与实际 bullet 不同，否则 useDifferentMarker 切换无意义。
    bulletOther = state.options.bulletOther ?? (bullet === '*' ? '-' : '*');
    if (bulletOther === bullet) bulletOther = bullet === '*' ? '-' : '*';
  }

  // 当父级也是列表且刚用过同样的 bullet 时，换一个标记避免视觉歧义。
  let useDifferentMarker =
    parent != null && state.bulletLastUsed ? bullet === state.bulletLastUsed : false;

  if (!node.ordered) {
    const firstListItem = node.children?.[0];

    // 两个嵌套列表的空首项直接相邻时，同样标记会和分隔线歧义，须切换：
    //   * - *   （会变成一个大的 thematic break）
    if (
      (bullet === '*' || bullet === '-') &&
      firstListItem &&
      (!firstListItem.children || !firstListItem.children[0]) &&
      state.stack[state.stack.length - 1] === 'list' &&
      state.stack[state.stack.length - 2] === 'listItem' &&
      state.stack[state.stack.length - 3] === 'list' &&
      state.stack[state.stack.length - 4] === 'listItem' &&
      state.indexStack[state.indexStack.length - 1] === 0 &&
      state.indexStack[state.indexStack.length - 2] === 0 &&
      state.indexStack[state.indexStack.length - 3] === 0
    ) {
      useDifferentMarker = true;
    }

    // 列表项以分隔线开头时，同样标记会拼成 thematic break，须切换：
    //   * ---
    const rule = state.options.rule ?? '*';
    if (rule === bullet && firstListItem) {
      for (const item of node.children ?? []) {
        if (item?.children?.[0]?.type === 'thematicBreak') {
          useDifferentMarker = true;
          break;
        }
      }
    }
  }

  if (useDifferentMarker) bullet = bulletOther;

  state.bulletCurrent = bullet;
  const value = state.containerFlow(node, info);
  state.bulletLastUsed = bullet;
  state.bulletCurrent = bulletCurrent;
  exit();
  return value;
}

// ---- 导出 ----

// $remark 与 extendSchema 返回 [ctx, plugin] 元组，展开成扁平插件列表供 Editor.use 注册。
// 注册顺序须在 commonmark 之后，靠 upsertById 覆盖原 bullet_list/ordered_list schema。
export const listMarker = [
  ...remarkListMarker,
  ...bulletListMarkerSchema,
  ...orderedListMarkerSchema,
];
