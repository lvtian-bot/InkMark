// 工具栏格式命令的双模式实现：所见即所得走 Milkdown 命令句柄，源码模式走纯文本变换。
// 工具栏按钮与自定义快捷键共用此入口，保证两条触发路径行为一致。
// 撤销/重做/保存不在此列：撤销/重做沿用编辑器库默认，保存走应用功能快捷键链路。

import type { EditorShortcutAction } from '../../shared/shortcuts';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle, type SourceSelection } from './source-editor-ref';
import { promptDialog } from './confirm-dialog';
import { t } from './i18n';
import { useStore } from './stores/useStore';

/// 源码模式下的编辑结果：新全文 + 新选区。辅助函数只产出这份结果，
/// 统一由 applySourceEdit 落盘到 CodeMirror，保持「计算-写入」分离。
interface SourceEdit {
  text: string;
  selection: SourceSelection;
}

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

function wrapSelection(before: string, after: string): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const { from, to } = handle.getSelection();
  const selected = text.slice(from, to);

  const beforeCtx = text.slice(Math.max(0, from - before.length), from);
  const afterCtx = text.slice(to, Math.min(text.length, to + after.length));

  if (beforeCtx === before && afterCtx === after) {
    // 已包裹 → 去掉标记
    return {
      text: text.slice(0, from - before.length) + selected + text.slice(to + after.length),
      selection: { from: from - before.length, to: from - before.length },
    };
  }
  return {
    text: text.slice(0, from) + before + selected + after + text.slice(to),
    selection: { from: from + before.length, to: from + before.length },
  };
}

function toggleLinePrefix(prefix: string): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const { from } = handle.getSelection();
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', from);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  if (line.startsWith(prefix)) {
    const newLine = line.slice(prefix.length);
    return {
      text: text.slice(0, lineStart) + newLine + text.slice(lineEndPos),
      selection: {
        from: Math.max(lineStart, from - prefix.length),
        to: Math.max(lineStart, from - prefix.length),
      },
    };
  }
  return {
    text: text.slice(0, lineStart) + prefix + line + text.slice(lineEndPos),
    selection: { from: from + prefix.length, to: from + prefix.length },
  };
}

function setHeadingLevel(level: number): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const { from } = handle.getSelection();
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', from);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  const match = line.match(/^(#{1,6})\s(.*)$/);
  const currentLevel = match ? match[1].length : 0;
  const body = match ? match[2] : line;

  const newLine = currentLevel === level ? body : `${'#'.repeat(level)} ${body}`;
  const delta = newLine.length - line.length;
  return {
    text: text.slice(0, lineStart) + newLine + text.slice(lineEndPos),
    selection: { from: Math.max(lineStart, from + delta), to: Math.max(lineStart, from + delta) },
  };
}

function toggleTaskPrefix(): SourceEdit | null {
  const handle = sourceEditorHandle.current;
  if (!handle) return null;
  const text = handle.getValue();
  const { from } = handle.getSelection();
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', from);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  const taskMatch = line.match(/^(\s*)([-*+])\s\[[ xX]\]\s(.*)$/);
  if (taskMatch) {
    const newLine = `${taskMatch[1]}${taskMatch[2]} ${taskMatch[3]}`;
    const delta = lineStart + taskMatch[1].length + 2;
    const newSel = Math.min(Math.max(from - 4, delta), lineStart + newLine.length);
    return {
      text: text.slice(0, lineStart) + newLine + text.slice(lineEndPos),
      selection: { from: newSel, to: newSel },
    };
  }

  const listMatch = line.match(/^(\s*)([-*+])\s(.*)$/);
  if (listMatch) {
    const newLine = `${listMatch[1]}${listMatch[2]} [ ] ${listMatch[3]}`;
    return {
      text: text.slice(0, lineStart) + newLine + text.slice(lineEndPos),
      selection: { from: from + 4, to: from + 4 },
    };
  }

  const newLine = `- [ ] ${line}`;
  return {
    text: text.slice(0, lineStart) + newLine + text.slice(lineEndPos),
    selection: { from: from + 6, to: from + 6 },
  };
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
  if (useStore.getState().viewMode === 'wysiwyg') {
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

const SOURCE_MARK_ACTIONS: Partial<Record<EditorShortcutAction, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  inlineCode: ['`', '`'],
};

/** 执行一个工具栏格式命令，按当前编辑模式分发。链接命令会弹出地址输入框。 */
export function runEditorCommand(action: EditorShortcutAction): void {
  const isWysiwyg = useStore.getState().viewMode === 'wysiwyg';
  const mark = SOURCE_MARK_ACTIONS[action];

  if (mark) {
    if (isWysiwyg) {
      if (action === 'bold') editorHandle.current?.toggleBold();
      else if (action === 'italic') editorHandle.current?.toggleItalic();
      else if (action === 'strike') editorHandle.current?.toggleStrike();
      else editorHandle.current?.toggleInlineCode();
    } else {
      const edit = wrapSelection(mark[0], mark[1]);
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
    case 'deleteLine':
      sourceEditorHandle.current?.deleteLine();
      return;
  }
}
