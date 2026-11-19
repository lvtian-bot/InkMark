import { $command } from '@milkdown/kit/utils';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseNode, NodeType } from '@milkdown/kit/prose/model';
import {
  bulletListSchema,
  headingSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
} from '@milkdown/kit/preset/commonmark';

interface SelectedTextBlock {
  readonly node: ProseNode;
  readonly pos: number;
}

interface SelectedListItem {
  readonly node: ProseNode;
  readonly pos: number;
}

function selectedTextBlocks(state: EditorState): SelectedTextBlock[] {
  const { selection } = state;
  if (selection.empty) {
    return selection.$from.parent.isTextblock
      ? [{ node: selection.$from.parent, pos: selection.$from.before(selection.$from.depth) }]
      : [];
  }

  const blocks: SelectedTextBlock[] = [];
  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return;
    // A selection ending exactly at the next block's content start does not
    // include that block. `nodesBetween` still visits the boundary node.
    const contentFrom = pos + 1;
    const contentTo = pos + node.nodeSize - 1;
    if (selection.from < contentTo && selection.to > contentFrom) {
      blocks.push({ node, pos });
    }
  });
  return blocks;
}

function listItemForBlock(
  state: EditorState,
  block: SelectedTextBlock,
  listItemType: NodeType,
): SelectedListItem | null {
  const $block = state.doc.resolve(block.pos + 1);
  for (let depth = $block.depth; depth > 0; depth -= 1) {
    if ($block.node(depth).type === listItemType) {
      return { node: $block.node(depth), pos: $block.before(depth) };
    }
  }
  return null;
}

function listTypeForBlock(
  state: EditorState,
  block: SelectedTextBlock,
  listItemType: NodeType,
): NodeType | null {
  const $block = state.doc.resolve(block.pos + 1);
  for (let depth = $block.depth; depth > 0; depth -= 1) {
    const node = $block.node(depth);
    if (node.type === listItemType) continue;
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
      return node.type;
    }
  }
  return null;
}

function canReplaceBlock(state: EditorState, block: SelectedTextBlock, type: NodeType): boolean {
  const $block = state.doc.resolve(block.pos);
  const index = $block.index();
  return $block.parent.canReplaceWith(index, index + 1, type);
}

function selectedListItems(state: EditorState, listItemType: NodeType): SelectedListItem[] {
  const unique = new Map<number, SelectedListItem>();
  for (const block of selectedTextBlocks(state)) {
    const item = listItemForBlock(state, block, listItemType);
    if (item) unique.set(item.pos, item);
  }
  return [...unique.values()].sort((left, right) => right.pos - left.pos);
}

function scopeStateToBlocks(state: EditorState, blocks: readonly SelectedTextBlock[]): EditorState {
  const last = blocks[blocks.length - 1];
  if (!last) return state;
  const end = last.pos + last.node.nodeSize - 1;
  // A selection inside the last block already gives ProseMirror the block
  // range it needs. Only trim a selection that runs into the next block's
  // boundary. Extending an ordinary caret/selection to the block end would
  // make the next typed characters replace the rest of the paragraph.
  if (state.selection.to <= end) return state;
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, state.selection.from, end)),
  );
}

function runWithOriginalSelection(
  originalState: EditorState,
  operationState: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
): boolean {
  if (!dispatch) return command(operationState);
  return command(operationState, (tr) => {
    tr.setSelection(originalState.selection.map(tr.doc, tr.mapping));
    dispatch(tr.scrollIntoView());
  });
}

function appendTransactionSteps(target: Transaction, source: Transaction): void {
  for (const step of source.steps) target.step(step);
}

function toggleList(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  listItemType: NodeType,
  listType: NodeType,
): boolean {
  const blocks = selectedTextBlocks(state);
  const items = selectedListItems(state, listItemType);
  const allInTargetList =
    blocks.length > 0 &&
    items.length > 0 &&
    blocks.every((block) => listTypeForBlock(state, block, listItemType) === listType);

  const scopedState = scopeStateToBlocks(state, blocks);
  if (allInTargetList) {
    return runWithOriginalSelection(state, scopedState, dispatch, (nextState, nextDispatch) =>
      liftListItem(listItemType)(nextState, nextDispatch),
    );
  }

  return runWithOriginalSelection(state, scopedState, dispatch, (nextState, nextDispatch) =>
    wrapInList(listType)(nextState, nextDispatch),
  );
}

export const toggleBulletListCommand = $command(
  'ToggleBulletList',
  (ctx) => () => (state: EditorState, dispatch?: (tr: Transaction) => void) =>
    toggleList(state, dispatch, listItemSchema.type(ctx), bulletListSchema.type(ctx)),
);

export const toggleOrderedListCommand = $command(
  'ToggleOrderedList',
  (ctx) => () => (state: EditorState, dispatch?: (tr: Transaction) => void) =>
    toggleList(state, dispatch, listItemSchema.type(ctx), orderedListSchema.type(ctx)),
);

export const toggleHeadingCommand = $command('ToggleHeading', (ctx) => (level?: number) => {
  const headingType = headingSchema.type(ctx);
  const paragraphType = paragraphSchema.type(ctx);
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const candidates = selectedTextBlocks(state).filter(
      ({ node }) => node.type === headingType || node.type === paragraphType,
    );
    if (candidates.length === 0) return false;
    const targetLevel = level ?? 1;
    const removeHeading = candidates.every(
      ({ node }) => node.type === headingType && node.attrs.level === targetLevel,
    );
    const targetType = targetLevel < 1 || removeHeading ? paragraphType : headingType;
    const blocks = candidates.filter((block) => canReplaceBlock(state, block, targetType));
    if (blocks.length === 0) return false;
    const tr = state.tr;
    for (const block of blocks) {
      if (targetLevel < 1 || removeHeading) tr.setNodeMarkup(block.pos, paragraphType, {});
      else tr.setNodeMarkup(block.pos, headingType, { level: targetLevel });
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
});

export const toggleTaskListCommand = $command(
  'ToggleTaskList',
  (ctx) => () => (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const listItemType = listItemSchema.type(ctx);
    const bulletType = bulletListSchema.type(ctx);
    const blocks = selectedTextBlocks(state);
    const items = selectedListItems(state, listItemType);
    const ordinaryBlocks = blocks
      .filter((block) => !listItemForBlock(state, block, listItemType))
      .sort((left, right) => right.pos - left.pos);
    if (items.length === 0 && ordinaryBlocks.length === 0) return false;
    if (!dispatch) return true;

    const allTasks = items.length > 0 && items.every((item) => item.node.attrs.checked != null);
    const hasOrdinaryBlocks = ordinaryBlocks.length > 0;
    const clearTasks = allTasks && !hasOrdinaryBlocks;
    const combined = state.tr;
    let workingState = state;

    if (items.length > 0) {
      const status = workingState.tr;
      for (const item of items) {
        // A mixed selection keeps existing task states. Regular list items
        // become unchecked tasks, and ordinary paragraphs are handled below.
        if (clearTasks || item.node.attrs.checked == null) {
          status.setNodeMarkup(item.pos, undefined, {
            ...item.node.attrs,
            checked: clearTasks ? null : false,
          });
        }
      }
      if (status.steps.length > 0) {
        appendTransactionSteps(combined, status);
        workingState = workingState.apply(status);
      }
    }

    for (const block of ordinaryBlocks) {
      const end = block.pos + block.node.nodeSize - 1;
      const scoped = workingState.apply(
        workingState.tr.setSelection(TextSelection.create(workingState.doc, block.pos + 1, end)),
      );
      const wrapCapture: { value: Transaction | null } = { value: null };
      const wrapped = wrapInList(bulletType)(scoped, (tr: Transaction) => {
        wrapCapture.value = tr;
      });
      if (!wrapped || !wrapCapture.value) continue;
      const wrapTransaction: Transaction = wrapCapture.value;

      const wrappedState = scoped.apply(wrapTransaction);
      for (const item of selectedListItems(wrappedState, listItemType)) {
        wrapTransaction.setNodeMarkup(item.pos, undefined, {
          ...item.node.attrs,
          checked: false,
        });
      }
      appendTransactionSteps(combined, wrapTransaction);
      workingState = workingState.apply(wrapTransaction);
    }

    if (combined.steps.length === 0) return false;
    dispatch(combined.scrollIntoView());
    return true;
  },
);
