import { deleteCharBackwardStrict } from '@codemirror/commands';
import { EditorSelection, Prec } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { keymap, type Command } from '@codemirror/view';

// Markdown 自带的退格会改写列表前缀，普通退格还会一次删除整级缩进。
// 源码视图始终只删除左边一个字符，选中文字时遵循编辑器的选区删除规则。
export const sourceBackspaceKeymap = Prec.highest(
  keymap.of([{ key: 'Backspace', run: deleteCharBackwardStrict, preventDefault: true }]),
);

/** 在空的 Markdown 列表项末尾按回车，退出当前层级。 */
const exitEmptyListItem: Command = ({ state, dispatch }) => {
  const { main, ranges } = state.selection;
  if (!main.empty || ranges.length !== 1 || state.readOnly) return false;
  const line = state.doc.lineAt(main.head);
  const prefix = /^([ \t]*)(?:[-+*]|\d+[.)])([ \t]+)/.exec(line.text);
  if (!prefix) return false;
  const markStart = line.from + prefix[1].length;
  const tree = ensureSyntaxTree(state, line.to, 40);
  const mark = tree?.resolveInner(markStart + 1, -1);
  const item = mark?.parent;
  if (mark?.name !== 'ListMark' || mark.from !== markStart || item?.name !== 'ListItem')
    return false;
  const markerEnd = line.from + prefix[0].length;
  const taskPrefix = /^\[[ xX]\](?:[ \t]+|$)/.exec(line.text.slice(prefix[0].length));
  const bodyStart = markerEnd + (taskPrefix?.[0].length ?? 0);
  const caret = main.head;
  if (caret !== line.to || bodyStart !== line.to) return false;

  let parent = item.parent;
  while (parent && parent.name !== 'ListItem') parent = parent.parent;
  const parentIndent = parent ? parent.from - state.doc.lineAt(parent.from).from : 0;
  const unindent = parent ? prefix[1].length - parentIndent : prefix[0].length;
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : '';
  const insert = !parent && previous ? '\n' : '';
  const remove = parent ? Math.max(0, unindent) : bodyStart - line.from;
  const changes = [{ from: line.from, to: line.from + remove, insert }];

  // 按相同层级移动子项、续行与代码块，保留正文内部相对缩进。
  for (let pos = line.to + 1; pos < item.to;) {
    const child = state.doc.lineAt(pos);
    const indent = /^[ \t]*/.exec(child.text)?.[0].length ?? 0;
    if (indent && unindent > 0)
      changes.push({ from: pos, to: pos + Math.min(indent, unindent), insert: '' });
    pos = child.to + 1;
  }
  // 段落之后的 2. 等有序标记需要一个空行才能开始新的列表。
  if (
    !parent &&
    line.number < state.doc.lines &&
    /^\s*\d+[.)][ \t]/.test(state.doc.line(line.number + 1).text)
  ) {
    changes.push({ from: line.to, to: line.to, insert: '\n' });
    changes.sort((a, b) => a.from - b.from);
  }
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(parent ? caret - remove : line.from + insert.length),
      userEvent: 'input',
    }),
  );
  return true;
};

export const sourceListKeymap = Prec.highest(keymap.of([{ key: 'Enter', run: exitEmptyListItem }]));
