import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { isValidTextMatch, type TextMatch } from './find-replace';

interface FindDecorationUpdate {
  activeIndex: number;
  matches: readonly TextMatch[];
}

const findDecorationKey = new PluginKey<DecorationSet>('inkmark-find-replace');

export const findReplacePlugin = $prose(() => {
  return new Plugin<DecorationSet>({
    key: findDecorationKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, decorations) => {
        const update = transaction.getMeta(findDecorationKey) as FindDecorationUpdate | undefined;
        if (update) {
          const nextDecorations = update.matches
            .filter((match) => isValidTextMatch(match, transaction.doc.content.size))
            .map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class:
                  index === update.activeIndex
                    ? 'inkmark-find-match is-active'
                    : 'inkmark-find-match',
              }),
            );
          return DecorationSet.create(transaction.doc, nextDecorations);
        }

        // 文档改动时让装饰随 mapping 自动迁移（位置被删则自动移除），保持高亮可见；
        // 精确匹配由 useFindReplace 的 refresh() 在内容变化后重算。这里不再整片清空，
        // 否则编辑期间会出现“计数仍在、高亮全部消失”的窗口。
        return decorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations: (state) => findDecorationKey.getState(state) ?? DecorationSet.empty,
    },
  });
});

export function setFindDecorations(
  view: EditorView,
  matches: readonly TextMatch[],
  activeIndex: number,
): void {
  let transaction = view.state.tr.setMeta(findDecorationKey, { matches, activeIndex });
  const activeMatch = matches[activeIndex];

  // 仅设置选区（编辑器获焦时可见），不在此处滚动：滚动由调用方 showTextMatches
  // 针对外层 .editor-container 手动完成，因为 ProseMirror 的 scrollIntoView 在本布局下不可靠。
  if (activeMatch && isValidTextMatch(activeMatch, view.state.doc.content.size)) {
    transaction = transaction.setSelection(
      TextSelection.create(view.state.doc, activeMatch.from, activeMatch.to),
    );
  }

  view.dispatch(transaction.setMeta('addToHistory', false));
}
