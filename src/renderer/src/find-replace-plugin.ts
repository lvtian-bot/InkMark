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

        if (transaction.docChanged) return DecorationSet.empty;
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

  if (activeMatch && isValidTextMatch(activeMatch, view.state.doc.content.size)) {
    transaction = transaction
      .setSelection(TextSelection.create(view.state.doc, activeMatch.from, activeMatch.to))
      .scrollIntoView();
  }

  view.dispatch(transaction.setMeta('addToHistory', false));
}
