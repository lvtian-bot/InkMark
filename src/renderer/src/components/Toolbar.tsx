import { Bold, CircleCheck, Code, Code2, Italic, Link2, List, Redo2, Strikethrough, Table, Undo2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle, type SourceSelection } from '../source-editor-ref';
import { promptDialog } from '../confirm-dialog';
import '../styles/toolbar.css';

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
      selection: { from: from - before.length, to: to - before.length },
    };
  }
  return {
    text: text.slice(0, from) + before + selected + after + text.slice(to),
    selection: { from: from + before.length, to: to + before.length },
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
      selection: { from: Math.max(lineStart, from - prefix.length), to: Math.max(lineStart, from - prefix.length) },
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

export function Toolbar() {
  const viewMode = useStore((s) => s.viewMode);
  const toolbarWidth = useStore((s) => s.toolbarWidth);
  const isWysiwyg = viewMode === 'wysiwyg';

  const handleUndo = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.undo();
    } else {
      sourceEditorHandle.current?.focus();
      sourceEditorHandle.current?.undo();
    }
  };

  const handleRedo = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.redo();
    } else {
      sourceEditorHandle.current?.focus();
      sourceEditorHandle.current?.redo();
    }
  };

  const handleBold = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleBold();
    } else {
      const edit = wrapSelection('**', '**');
      if (edit) applySourceEdit(edit);
    }
  };

  const handleItalic = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleItalic();
    } else {
      const edit = wrapSelection('*', '*');
      if (edit) applySourceEdit(edit);
    }
  };

  const handleHeading = (level: number): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapHeading(level);
    } else {
      const edit = setHeadingLevel(level);
      if (edit) applySourceEdit(edit);
    }
  };

  const handleStrike = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleStrike();
    } else {
      const edit = wrapSelection('~~', '~~');
      if (edit) applySourceEdit(edit);
    }
  };

  const handleInlineCode = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleInlineCode();
    } else {
      const edit = wrapSelection('`', '`');
      if (edit) applySourceEdit(edit);
    }
  };

  const handleBulletList = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapBulletList();
    } else {
      const edit = toggleLinePrefix('- ');
      if (edit) applySourceEdit(edit);
    }
  };

  const handleTaskList = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapTaskList();
    } else {
      const edit = toggleTaskPrefix();
      if (edit) applySourceEdit(edit);
    }
  };

  const handleCodeBlock = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.insertCodeBlock();
    } else {
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
  };

  const handleLink = async (): Promise<void> => {
    const href = await promptDialog('插入链接', '请输入链接地址：', {
      placeholder: 'https://',
      confirmLabel: '插入',
    });
    if (!href) return;
    if (isWysiwyg) {
      editorHandle.current?.insertLink(href);
    } else {
      const handle = sourceEditorHandle.current;
      if (!handle) return;
      const text = handle.getValue();
      const { from, to } = handle.getSelection();
      const selected = text.slice(from, to) || '链接文本';
      const insert = `[${selected}](${href})`;
      applySourceEdit({
        text: text.slice(0, from) + insert + text.slice(to),
        selection: { from: from + 1, to: from + 1 + selected.length },
      });
    }
  };

  const handleTable = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.insertTable();
    } else {
      const handle = sourceEditorHandle.current;
      if (!handle) return;
      const text = handle.getValue();
      const { from } = handle.getSelection();
      const lineStart = text.lastIndexOf('\n', from - 1) + 1;
      const needsNewline = lineStart > 0 && text[lineStart - 1] !== '\n';
      const prefix = needsNewline ? '\n' : '';
      const table = prefix + '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
      applySourceEdit({
        text: text.slice(0, lineStart) + table + text.slice(lineStart),
        selection: { from: lineStart + table.length, to: lineStart + table.length },
      });
    }
  };

  return (
    <div className={`toolbar toolbar-width-${toolbarWidth}`}>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleUndo} title="撤销 (Ctrl+Z)">
          <Undo2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleRedo} title="重做 (Ctrl+Y)">
          <Redo2 size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleBold} title="加粗 (Ctrl+B)">
          <Bold size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleItalic} title="斜体 (Ctrl+I)">
          <Italic size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleStrike} title="删除线">
          <Strikethrough size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleInlineCode} title="行内代码">
          <Code size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(1)}
          title="一级标题"
        >
          H1
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(2)}
          title="二级标题"
        >
          H2
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(3)}
          title="三级标题"
        >
          H3
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleBulletList} title="无序列表">
          <List size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleTaskList} title="待办任务">
          <CircleCheck size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleCodeBlock} title="代码块">
          <Code2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleLink} title="链接">
          <Link2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleTable} title="表格">
          <Table size={16} />
        </button>
      </div>
    </div>
  );
}
