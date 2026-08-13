import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { paragraphSchema } from '@milkdown/kit/preset/commonmark';

/// 所见即所得模式下的「块级标记浮现」（参照 Typora Live Preview）。
///
/// 光标进入标题 / 引用 / 列表（无序 + 有序）时，该块的 Markdown 标记字符（`#`、`>`、
/// `-`/`*`/`+`、`1.`/`1)`）以淡化等宽字体浮现；光标移走后自然恢复渲染态。装饰只是当前
/// 选区的纯函数，无副作用、不入撤销历史。
///
/// 列表标记字符来自 `list-marker` 插件已在节点属性上保留的 `bullet` / `bulletOrdered`；
/// 标题用 atx 形式（`#` × level）。本阶段只做块级；行级（加粗/斜体）单独评估。
///
/// 「可编辑」的交付方式：浮现让用户看清结构；标题正文起始处按 `#` 升一级、Backspace 降
/// 一级（level 1 退化为普通段落）。列表 / 引用的退出与样式切换沿用既有工具栏与 inputRule，
/// 不在本插件改写列表 Backspace 行为（避免重蹈任务列表属性串台的覆辙）。

const blockMarkerKey = new PluginKey<boolean>('inkmark-block-marker-reveal');

/// 设置开关变化时调用：向编辑器派发带 meta 的空事务，插件 state 更新 `enabled`，
/// 触发装饰重算。不设 `addToHistory`，开关切换不污染撤销历史。
export function setBlockMarkerReveal(view: EditorView, enabled: boolean): void {
  const tr = view.state.tr.setMeta(blockMarkerKey, enabled).setMeta('addToHistory', false);
  view.dispatch(tr);
}

// ---- ProseMirror ResolvedPos / Node 的最小结构投影 ----
//
// Milkdown 的 kit 入口未稳定导出 `ResolvedPos`（见 task-list.ts 同款处理）。真实
// ResolvedPos / Node 在结构上兼容这些接口，作为 decoration 计算的最小契约。

interface NodeLike {
  readonly type: { name: string };
  readonly attrs: Record<string, unknown>;
  readonly nodeSize: number;
  forEach(fn: (node: NodeLike, offset: number, index: number) => void): void;
}

interface ResolvedPosLike {
  readonly depth: number;
  readonly parentOffset: number;
  readonly parent: NodeLike;
  node(depth: number): NodeLike;
  before(depth: number): number;
  start(depth: number): number;
}

interface SelectionLike {
  readonly $from: ResolvedPosLike;
  readonly $to: ResolvedPosLike;
}

// ---- 纯函数（导出供单测） ----

/// 标题浮现标记：level 个 `#` 加一个空格。level 钳制到 1..6。
export function headingMarker(level: number): string {
  const clamped = Math.min(Math.max(level, 1), 6);
  return '#'.repeat(clamped) + ' ';
}

/// 无序列表项浮现标记：`bullet` + 空格（bullet 形如 `-`/`*`/`+`）。
export function unorderedListItemMarker(bullet: string): string {
  return `${bullet} `;
}

/// 有序列表项浮现标记：`(start + itemIndex)` + 标点 + 空格（标点 `.` 或 `)`）。
export function orderedListItemMarker(
  start: number,
  punctuation: string,
  itemIndex: number,
): string {
  return `${start + itemIndex}${punctuation} `;
}

/// 判定光标是否在「标题正文起始」（用于键势拦截）。传入结构化最小输入，便于单测。
export function isAtHeadingTextStart(input: {
  parentOffset: number;
  parentTypeName: string;
}): boolean {
  return input.parentOffset === 0 && input.parentTypeName === 'heading';
}

/// 创建淡化标记 span（widget decoration 用）。
function markerEl(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'block-marker';
  el.textContent = text;
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/// 把列表子树里每个非任务项的标记 widget 加进 decos，并对每个列表节点加 `reveal-list`
/// 类（抑制原生 disc / decimal，避免与字符标记重叠）。递归处理嵌套子列表。
///
/// 任务项（`checked != null`）已有 checkbox（见 task-list-view），跳过字符标记避免叠加。
function revealList(
  listNode: NodeLike,
  listPos: number,
  decos: Decoration[],
  seen: Set<string>,
): void {
  const listId = `reveal-list:${listPos}`;
  if (!seen.has(listId)) {
    seen.add(listId);
    decos.push(Decoration.node(listPos, listPos + listNode.nodeSize, { class: 'reveal-list' }));
  }

  const isOrdered = listNode.type.name === 'ordered_list';
  const start = (listNode.attrs.order as number | undefined) ?? 1;
  const bulletOrdered =
    typeof listNode.attrs.bulletOrdered === 'string' ? listNode.attrs.bulletOrdered : '.';
  const bullet = typeof listNode.attrs.bullet === 'string' ? listNode.attrs.bullet : '-';

  listNode.forEach((item, itemOffset, itemIndex) => {
    const itemPos = listPos + 1 + itemOffset;
    const isTask = item.attrs.checked != null;
    // 段落首字符位置 = 列表项开标签 + 段落开标签（与 task-list-view 的 pos+2 一致）。
    const textStart = itemPos + 2;

    if (!isTask) {
      const itemId = `list-marker:${textStart}`;
      if (!seen.has(itemId)) {
        seen.add(itemId);
        const marker = isOrdered
          ? orderedListItemMarker(start, bulletOrdered, itemIndex)
          : unorderedListItemMarker(bullet);
        decos.push(Decoration.widget(textStart, () => markerEl(marker), { side: -1 }));
      }
    }

    // 递归：列表项里的子列表同样浮现其标记。
    item.forEach((child, childOffset) => {
      const childName = child.type.name;
      if (childName === 'bullet_list' || childName === 'ordered_list') {
        revealList(child, itemPos + 1 + childOffset, decos, seen);
      }
    });
  });
}

/// 由选区计算块级标记装饰。处理 `$from` 与 `$to` 两端（覆盖跨块选区），按 pos+类型去重。
export function buildBlockMarkerDecorations(sel: SelectionLike): Decoration[] {
  const decos: Decoration[] = [];
  const seen = new Set<string>();

  // 选区两端可能相同（折叠光标），用 seen 去重避免重复装饰。
  const ends: ResolvedPosLike[] = sel.$from === sel.$to ? [sel.$from] : [sel.$from, sel.$to];

  for (const $pos of ends) {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      const pos = $pos.before(depth);
      const name = node.type.name;

      if (name === 'heading') {
        const id = `heading:${pos}`;
        if (!seen.has(id)) {
          seen.add(id);
          const level = (node.attrs.level as number | undefined) ?? 1;
          decos.push(
            Decoration.widget($pos.start(depth), () => markerEl(headingMarker(level)), {
              side: -1,
            }),
          );
        }
      } else if (name === 'blockquote') {
        const id = `blockquote:${pos}`;
        if (!seen.has(id)) {
          seen.add(id);
          // 引用每个直接子块（段落 / 标题 / 列表 …）行首放一个 `>`。
          node.forEach((child, localOffset) => {
            const childPos = pos + 1 + localOffset;
            decos.push(Decoration.widget(childPos + 1, () => markerEl('> '), { side: -1 }));
          });
        }
      } else if (name === 'bullet_list' || name === 'ordered_list') {
        revealList(node, pos, decos, seen);
      }
    }
  }

  return decos;
}

/// 块级标记浮现 + 标题键势编辑插件。
///
/// 注册顺序：放在 `.use(listMarker)` 之后即可。装饰与其它插件的装饰自动合并（与顺序无关）；
/// 键势方面，Milkdown 把所有 `.use()` 插件排在 `createInputRules` / `createKeymap` 之前，
/// 因此这里的 `handleTextInput`（`#` 升级）与 `handleKeyDown`（Backspace 降级）天然先于
/// 内置 inputRule 与 base keymap（`joinTextblockBackward`）执行，无需额外抢优先级。
export const blockMarkerReveal = $prose((ctx) => {
  const paragraphType = paragraphSchema.type(ctx);

  return new Plugin<boolean>({
    key: blockMarkerKey,
    state: {
      // 默认关闭，与设置项 blockMarkerReveal 默认值一致；由 setBlockMarkerReveal 开启。
      init: () => false,
      apply: (tr, prev) => {
        const next = tr.getMeta(blockMarkerKey);
        return typeof next === 'boolean' ? next : prev;
      },
    },
    props: {
      decorations(state) {
        if (!blockMarkerKey.getState(state)) return DecorationSet.empty;
        const decos = buildBlockMarkerDecorations(state.selection);
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
      },

      // 标题正文起始处按 `#` -> 升一级（最多 6）。IME 组合中放行。开关关闭时放行。
      handleTextInput(view, from, to, text) {
        if (!blockMarkerKey.getState(view.state)) return false;
        if (view.composing) return false;
        if (text !== '#') return false;
        if (from !== to) return false;

        const $pos = view.state.doc.resolve(from);
        if (
          !isAtHeadingTextStart({
            parentOffset: $pos.parentOffset,
            parentTypeName: $pos.parent.type.name,
          })
        ) {
          return false;
        }
        const level = ($pos.parent.attrs.level as number | undefined) ?? 1;
        if (level >= 6) return false;

        const tr = view.state.tr.setNodeMarkup($pos.before($pos.depth), undefined, {
          level: level + 1,
        });
        view.dispatch(tr);
        return true;
      },

      // 标题正文起始处 Backspace -> 降一级；level 1 时退化为普通段落。开关关闭时放行。
      handleKeyDown(view, event) {
        if (!blockMarkerKey.getState(view.state)) return false;
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        if (event.key !== 'Backspace') return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        const { selection } = view.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if (
          !isAtHeadingTextStart({
            parentOffset: $from.parentOffset,
            parentTypeName: $from.parent.type.name,
          })
        ) {
          return false;
        }

        const level = ($from.parent.attrs.level as number | undefined) ?? 1;
        const headingPos = $from.before($from.depth);
        const tr =
          level > 1
            ? view.state.tr.setNodeMarkup(headingPos, undefined, { level: level - 1 })
            : view.state.tr.setNodeMarkup(headingPos, paragraphType);
        view.dispatch(tr);
        return true;
      },
    },
  });
});
