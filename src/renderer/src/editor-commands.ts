// 工具栏格式命令的双模式实现：所见即所得走 Milkdown 命令句柄，源码模式走纯文本变换。
// 工具栏按钮与自定义快捷键共用此入口，保证两条触发路径行为一致。
// 撤销/重做/保存不在此列：撤销/重做沿用编辑器库默认，保存走应用功能快捷键链路。

import type { EditorShortcutAction } from '../../shared/shortcuts';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle, type SourceSelection } from './source-editor-ref';
import { promptDialog } from './confirm-dialog';
import { formatDate, formatDateTime } from './datetime-format';
import { t } from './i18n';
import { selectViewMode, tabDocumentPath, useStore } from './stores/useStore';
import { resolveDocumentKind } from '../../shared/openable-document';
import { toggleSourceMark } from './source-inline-format';

/// 源码模式下的编辑结果：新全文 + 新选区。辅助函数只产出这份结果，
/// 统一由 applySourceEdit 落盘到 CodeMirror，保持「计算-写入」分离。
interface SourceEdit {
  text: string;
  selection: SourceSelection;
}

interface SourceLine {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

interface LineChange extends SourceLine {
  readonly replacement: string;
}

interface ListPrefix {
  readonly indent: string;
  readonly marker: string;
  readonly body: string;
}

const listPrefixPattern = /^([ \t]*)([-+*]|\d+[.)])([ \t]+)(.*)$/;
const taskPrefixPattern = /^(\[[ xX]\])([ \t]+)(.*)$/;
const headingPrefixPattern = /^([ \t]*)(#{1,6})([ \t]+)(.*)$/;

/// 把一次源码编辑写入编辑器并定位光标。用 quiet 写入（工具栏操作由
/// React onChange 链路之外的 dispatch 触发，但仍要让 useFile 感知到改动），
/// 因此这里用 replaceRange（会触发 updateListener → onChange）。
function applySourceEdit(edit: SourceEdit): void {
  const handle = sourceEditorHandle.current;
  if (!handle) return;
  const oldLen = handle.getValue().length;
  handle.replaceRange(0, oldLen, edit.text);
  handle.setSelection(edit.selection.from, edit.selection.to);
}

function lineStartAt(text: string, position: number): number {
  return position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1;
}

function lineEndAt(text: string, position: number): number {
  const end = text.indexOf('\n', position);
  return end === -1 ? text.length : end;
}

function selectedLines(text: string, from: number, to: number): SourceLine[] {
  const start = lineStartAt(text, from);
  // A selection ending at a line start does not include the following line.
  const endPosition = to > from && to > 0 && lineStartAt(text, to) === to ? to - 1 : to;
  const endStart = lineStartAt(text, endPosition);
  const lines: SourceLine[] = [];
  for (let position = start; position <= endStart;) {
    const end = lineEndAt(text, position);
    lines.push({ from: position, to: end, text: text.slice(position, end) });
    if (end >= text.length) break;
    position = end + 1;
  }
  return lines;
}

function parseListPrefix(line: string): ListPrefix | null {
  const match = listPrefixPattern.exec(line);
  if (!match) return null;
  return { indent: match[1], marker: match[2], body: match[4] };
}

function parseTaskPrefix(list: ListPrefix): { checked: boolean; body: string } | null {
  const match = taskPrefixPattern.exec(list.body);
  if (!match) return null;
  return { checked: match[1].toLowerCase() === '[x]', body: match[3] };
}

function mapPosition(position: number, changes: readonly LineChange[]): number {
  let delta = 0;
  for (const change of changes) {
    if (position < change.from) return position + delta;
    if (position <= change.to) {
      const oldOffset = position - change.from;
      const oldText = change.text;
      const newText = change.replacement;
      let suffixLength = 0;
      while (
        suffixLength < oldText.length &&
        suffixLength < newText.length &&
        oldText[oldText.length - suffixLength - 1] === newText[newText.length - suffixLength - 1]
      ) {
        suffixLength += 1;
      }
      const oldPrefixLength = oldText.length - suffixLength;
      const newPrefixLength = newText.length - suffixLength;
      const newOffset =
        oldOffset <= oldPrefixLength
          ? Math.min(oldOffset, newPrefixLength)
          : newPrefixLength + oldOffset - oldPrefixLength;
      return change.from + delta + Math.min(newOffset, newText.length);
    }
    delta += change.replacement.length - (change.to - change.from);
  }
  return position + delta;
}

function applyLineChanges(
  text: string,
  from: number,
  to: number,
  changes: readonly LineChange[],
): SourceEdit {
  let result = '';
  let cursor = 0;
  for (const change of changes) {
    result += text.slice(cursor, change.from) + change.replacement;
    cursor = change.to;
  }
  result += text.slice(cursor);
  return {
    text: result,
    selection: { from: mapPosition(from, changes), to: mapPosition(to, changes) },
  };
}

function wrapSelection(marker: string): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const { from, to } = handle.getSelection();
  return toggleSourceMark(text, from, to, marker);
}

function toggleLinePrefix(prefix: string): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const selection = handle.getSelection();
  const lines = selectedLines(text, selection.from, selection.to);
  const nonEmpty = lines.filter((line) => line.text.trim() !== '');
  const allUnordered = nonEmpty.every((line) => {
    const parsed = parseListPrefix(line.text);
    return parsed?.marker.length === 1;
  });
  const changes: LineChange[] = lines.map((line) => {
    if (!line.text.trim()) {
      if (nonEmpty.length === 0) {
        const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
        return { ...line, replacement: `${indent}${prefix}` };
      }
      return { ...line, replacement: line.text };
    }
    const parsed = parseListPrefix(line.text);
    if (allUnordered && parsed) {
      const separator =
        line.from > 0 && text.slice(lineStartAt(text, line.from - 1), line.from - 1).length > 0
          ? '\n'
          : '';
      const task = parseTaskPrefix(parsed);
      return {
        ...line,
        replacement: `${separator}${task ? task.body : parsed.body}`,
      };
    }
    if (parsed) {
      return { ...line, replacement: `${parsed.indent}${prefix}${parsed.body}` };
    }
    const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
    return { ...line, replacement: `${indent}${prefix}${line.text.slice(indent.length)}` };
  });
  return applyLineChanges(text, selection.from, selection.to, changes);
}

function setHeadingLevel(level: number): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const selection = handle.getSelection();
  const lines = selectedLines(text, selection.from, selection.to);
  const nonEmpty = lines.filter((line) => line.text.trim() !== '');
  if (nonEmpty.length === 0) {
    if (selection.from !== selection.to) return null;
    const line = lines[0];
    const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
    const replacement = `${indent}${'#'.repeat(level)} `;
    const nextText = text.slice(0, line.from) + replacement + text.slice(line.to);
    const cursor = line.from + replacement.length;
    return { text: nextText, selection: { from: cursor, to: cursor } };
  }
  const allTargetHeadings = nonEmpty.every((line) => {
    const match = headingPrefixPattern.exec(line.text);
    return match?.[2].length === level;
  });
  const changes: LineChange[] = lines.map((line) => {
    if (!line.text.trim()) return { ...line, replacement: line.text };
    const match = headingPrefixPattern.exec(line.text);
    const indent = match?.[1] ?? line.text.match(/^[ \t]*/)?.[0] ?? '';
    const body = match?.[4] ?? line.text.slice(indent.length);
    if (match && match[2].length === level && !allTargetHeadings) {
      return { ...line, replacement: line.text };
    }
    const replacement =
      allTargetHeadings && match ? `${indent}${body}` : `${indent}${'#'.repeat(level)} ${body}`;
    return { ...line, replacement };
  });
  return applyLineChanges(text, selection.from, selection.to, changes);
}

function toggleTaskPrefix(): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const selection = handle.getSelection();
  const lines = selectedLines(text, selection.from, selection.to);
  const nonEmpty = lines.filter((line) => line.text.trim() !== '');
  const allTasks =
    nonEmpty.length > 0 &&
    nonEmpty.every((line) => {
      const parsed = parseListPrefix(line.text);
      return parsed != null && parseTaskPrefix(parsed) != null;
    });
  const changes: LineChange[] = lines.map((line) => {
    if (!line.text.trim()) {
      if (nonEmpty.length === 0) {
        const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
        return { ...line, replacement: `${indent}- [ ] ` };
      }
      return { ...line, replacement: line.text };
    }
    const parsed = parseListPrefix(line.text);
    if (!parsed) {
      const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
      return { ...line, replacement: `${indent}- [ ] ${line.text.slice(indent.length)}` };
    }
    const task = parseTaskPrefix(parsed);
    if (allTasks && task)
      return { ...line, replacement: `${parsed.indent}${parsed.marker} ${task.body}` };
    if (task) return { ...line, replacement: line.text };
    return { ...line, replacement: `${parsed.indent}${parsed.marker} [ ] ${parsed.body}` };
  });
  return applyLineChanges(text, selection.from, selection.to, changes);
}

function insertSourceCodeBlock(): void {
  const handle = sourceEditorHandle.current;
  if (!handle) return;
  const text = handle.getValue();
  const { from } = handle.getSelection();
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const needsNewline = lineStart > 0 && text[lineStart - 1] !== '\n';
  const prefix = needsNewline ? '\n' : '';
  const block = prefix + '```\n\n```\n';
  applySourceEdit({
    text: text.slice(0, lineStart) + block + text.slice(lineStart),
    selection: { from: lineStart + prefix.length + 4, to: lineStart + prefix.length + 4 },
  });
}

async function insertLink(): Promise<void> {
  const href = await promptDialog(t('toolbar.insertLinkTitle'), t('toolbar.insertLinkPrompt'), {
    placeholder: 'https://',
    confirmLabel: t('toolbar.insertLinkConfirm'),
  });
  if (!href) return;
  if (selectViewMode(useStore.getState()) === 'wysiwyg') {
    editorHandle.current?.insertLink(href);
  } else {
    const handle = sourceEditorHandle.current;
    if (!handle) return;
    const text = handle.getValue();
    const { from, to } = handle.getSelection();
    const selected = text.slice(from, to) || t('toolbar.linkText');
    const insert = `[${selected}](${href})`;
    applySourceEdit({
      text: text.slice(0, from) + insert + text.slice(to),
      selection: { from: from + 1, to: from + 1 + selected.length },
    });
  }
}

function insertSourceTable(): void {
  const handle = sourceEditorHandle.current;
  if (!handle) return;
  const text = handle.getValue();
  const { from } = handle.getSelection();
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const needsNewline = lineStart > 0 && text[lineStart - 1] !== '\n';
  const prefix = needsNewline ? '\n' : '';
  const table = prefix + t('toolbar.tableTemplate');
  applySourceEdit({
    text: text.slice(0, lineStart) + table + text.slice(lineStart),
    selection: { from: lineStart + table.length, to: lineStart + table.length },
  });
}

/// 在光标处插入纯文本：所见即所得走命令句柄；源码模式直接替换选区，
/// 光标落位由 replaceRange 自带（落在插入文本之后），不再整篇重写。
function insertPlainText(text: string): void {
  if (selectViewMode(useStore.getState()) === 'wysiwyg') {
    editorHandle.current?.insertText(text);
    return;
  }
  const handle = sourceEditorHandle.current;
  if (!handle) return;
  const { from, to } = handle.getSelection();
  handle.replaceRange(from, to, text);
}

const SOURCE_MARK_ACTIONS: Partial<Record<EditorShortcutAction, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  inlineCode: ['`', '`'],
};

// 纯 Markdown 格式操作：纯文本/代码文件没有对应语义。插入日期与删除行
// 有独立的纯文本实现，不受文本标签限制。
const MARKDOWN_ONLY_ACTIONS = new Set<EditorShortcutAction>([
  'bold',
  'italic',
  'strike',
  'inlineCode',
  'heading1',
  'heading2',
  'heading3',
  'bulletList',
  'taskList',
  'codeBlock',
  'link',
  'table',
]);

/** 执行一个工具栏格式命令，按当前编辑模式分发。链接命令会弹出地址输入框。 */
export function runEditorCommand(action: EditorShortcutAction): void {
  const state = useStore.getState();
  const activeTab = state.tabs.find((item) => item.id === state.activeTabId);
  // 纯文本/代码文件没有 Markdown 格式操作：工具栏按钮已隐藏，快捷键在此拦下。
  if (
    activeTab &&
    resolveDocumentKind(tabDocumentPath(activeTab)) === 'text' &&
    MARKDOWN_ONLY_ACTIONS.has(action)
  ) {
    return;
  }
  const isWysiwyg = selectViewMode(state) === 'wysiwyg';
  const mark = SOURCE_MARK_ACTIONS[action];

  if (mark) {
    if (isWysiwyg) {
      if (action === 'bold') editorHandle.current?.toggleBold();
      else if (action === 'italic') editorHandle.current?.toggleItalic();
      else if (action === 'strike') editorHandle.current?.toggleStrike();
      else editorHandle.current?.toggleInlineCode();
    } else {
      const edit = wrapSelection(mark[0]);
      if (edit) applySourceEdit(edit);
    }
    return;
  }

  if (isWysiwyg) {
    switch (action) {
      case 'heading1':
        editorHandle.current?.wrapHeading(1);
        return;
      case 'heading2':
        editorHandle.current?.wrapHeading(2);
        return;
      case 'heading3':
        editorHandle.current?.wrapHeading(3);
        return;
      case 'bulletList':
        editorHandle.current?.wrapBulletList();
        return;
      case 'taskList':
        editorHandle.current?.wrapTaskList();
        return;
      case 'codeBlock':
        editorHandle.current?.insertCodeBlock();
        return;
      case 'link':
        void insertLink();
        return;
      case 'table':
        editorHandle.current?.insertTable();
        return;
      case 'insertDate':
        insertPlainText(formatDate(new Date()));
        return;
      case 'insertDateTime':
        insertPlainText(formatDateTime(new Date()));
        return;
      case 'deleteLine':
        editorHandle.current?.deleteLine();
        return;
    }
    return;
  }

  switch (action) {
    case 'heading1':
    case 'heading2':
    case 'heading3': {
      const edit = setHeadingLevel(Number(action.slice(-1)));
      if (edit) applySourceEdit(edit);
      return;
    }
    case 'bulletList': {
      const edit = toggleLinePrefix('- ');
      if (edit) applySourceEdit(edit);
      return;
    }
    case 'taskList': {
      const edit = toggleTaskPrefix();
      if (edit) applySourceEdit(edit);
      return;
    }
    case 'codeBlock':
      insertSourceCodeBlock();
      return;
    case 'link':
      void insertLink();
      return;
    case 'table':
      insertSourceTable();
      return;
    case 'insertDate':
      insertPlainText(formatDate(new Date()));
      return;
    case 'insertDateTime':
      insertPlainText(formatDateTime(new Date()));
      return;
    case 'deleteLine':
      sourceEditorHandle.current?.deleteLine();
      return;
  }
}
