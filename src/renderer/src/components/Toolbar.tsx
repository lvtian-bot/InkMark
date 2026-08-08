import { type RefObject } from 'react';
import { Bold, CircleCheck, Code, Code2, Italic, Link2, List, Redo2, Strikethrough, Table, Undo2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { editorHandle } from '../editor-ref';
import { promptDialog } from '../confirm-dialog';
import '../styles/toolbar.css';

interface ToolbarProps {
  sourceRef: RefObject<HTMLTextAreaElement>;
}

function updateTextareaValue(
  textarea: HTMLTextAreaElement,
  newValue: string,
  selStart: number,
  selEnd: number,
): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  nativeSetter.call(textarea, newValue);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.setSelectionRange(selStart, selEnd);
  textarea.focus();
}

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.slice(start, end);

  const beforeCtx = text.slice(Math.max(0, start - before.length), start);
  const afterCtx = text.slice(end, Math.min(text.length, end + after.length));

  if (beforeCtx === before && afterCtx === after) {
    const newValue =
      text.slice(0, start - before.length) + selected + text.slice(end + after.length);
    updateTextareaValue(textarea, newValue, start - before.length, end - before.length);
  } else {
    const newValue = text.slice(0, start) + before + selected + after + text.slice(end);
    updateTextareaValue(textarea, newValue, start + before.length, end + before.length);
  }
}

function toggleLinePrefix(textarea: HTMLTextAreaElement, prefix: string): void {
  const start = textarea.selectionStart;
  const text = textarea.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', start);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  if (line.startsWith(prefix)) {
    const newLine = line.slice(prefix.length);
    const newValue = text.slice(0, lineStart) + newLine + text.slice(lineEndPos);
    const newStart = Math.max(lineStart, start - prefix.length);
    updateTextareaValue(textarea, newValue, newStart, newStart);
  } else {
    const newValue = text.slice(0, lineStart) + prefix + line + text.slice(lineEndPos);
    updateTextareaValue(textarea, newValue, start + prefix.length, start + prefix.length);
  }
}

function setHeadingLevel(textarea: HTMLTextAreaElement, level: number): void {
  const start = textarea.selectionStart;
  const text = textarea.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', start);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  const match = line.match(/^(#{1,6})\s(.*)$/);
  const currentLevel = match ? match[1].length : 0;
  const body = match ? match[2] : line;

  const newLine = currentLevel === level ? body : `${'#'.repeat(level)} ${body}`;
  const newValue = text.slice(0, lineStart) + newLine + text.slice(lineEndPos);
  const newStart = Math.max(lineStart, start + (newLine.length - line.length));
  updateTextareaValue(textarea, newValue, newStart, newStart);
}

function toggleTaskPrefix(textarea: HTMLTextAreaElement): void {
  const start = textarea.selectionStart;
  const text = textarea.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', start);
  const lineEndPos = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, lineEndPos);

  // Already a task list item – remove the [ ] / [x] to make it a regular list item
  const taskMatch = line.match(/^(\s*)([-*+])\s\[[ xX]\]\s(.*)$/);
  if (taskMatch) {
    const newLine = `${taskMatch[1]}${taskMatch[2]} ${taskMatch[3]}`;
    const newValue = text.slice(0, lineStart) + newLine + text.slice(lineEndPos);
    const delta = lineStart + taskMatch[1].length + 2; // after "- "
    const newSel = Math.min(Math.max(start - 4, delta), lineStart + newLine.length);
    updateTextareaValue(textarea, newValue, newSel, newSel);
    return;
  }

  // Regular list item – add [ ] to make it a task
  const listMatch = line.match(/^(\s*)([-*+])\s(.*)$/);
  if (listMatch) {
    const newLine = `${listMatch[1]}${listMatch[2]} [ ] ${listMatch[3]}`;
    const newValue = text.slice(0, lineStart) + newLine + text.slice(lineEndPos);
    const newSel = start + 4; // added "[ ] "
    updateTextareaValue(textarea, newValue, newSel, newSel);
    return;
  }

  // Not a list – add "- [ ] " prefix
  const newLine = `- [ ] ${line}`;
  const newValue = text.slice(0, lineStart) + newLine + text.slice(lineEndPos);
  const newSel = start + 6;
  updateTextareaValue(textarea, newValue, newSel, newSel);
}

export function Toolbar({ sourceRef }: ToolbarProps) {
  const viewMode = useStore((s) => s.viewMode);
  const isWysiwyg = viewMode === 'wysiwyg';

  const handleUndo = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.undo();
    } else if (sourceRef.current) {
      sourceRef.current.focus();
      document.execCommand('undo');
    }
  };

  const handleRedo = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.redo();
    } else if (sourceRef.current) {
      sourceRef.current.focus();
      document.execCommand('redo');
    }
  };

  const handleBold = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleBold();
    } else if (sourceRef.current) {
      wrapSelection(sourceRef.current, '**', '**');
    }
  };

  const handleItalic = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleItalic();
    } else if (sourceRef.current) {
      wrapSelection(sourceRef.current, '*', '*');
    }
  };

  const handleHeading = (level: number): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapHeading(level);
    } else if (sourceRef.current) {
      setHeadingLevel(sourceRef.current, level);
    }
  };

  const handleStrike = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleStrike();
    } else if (sourceRef.current) {
      wrapSelection(sourceRef.current, '~~', '~~');
    }
  };

  const handleInlineCode = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.toggleInlineCode();
    } else if (sourceRef.current) {
      wrapSelection(sourceRef.current, '`', '`');
    }
  };

  const handleBulletList = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapBulletList();
    } else if (sourceRef.current) {
      toggleLinePrefix(sourceRef.current, '- ');
    }
  };

  const handleTaskList = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapTaskList();
    } else if (sourceRef.current) {
      toggleTaskPrefix(sourceRef.current);
    }
  };

  const handleCodeBlock = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.insertCodeBlock();
    } else if (sourceRef.current) {
      const ta = sourceRef.current;
      const start = ta.selectionStart;
      const text = ta.value;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const needsNewline = lineStart > 0 && text[lineStart - 1] !== '\n';
      const prefix = needsNewline ? '\n' : '';
      const block = prefix + '```\n\n```\n';
      const newValue = text.slice(0, lineStart) + block + text.slice(lineStart);
      const cursorPos = lineStart + prefix.length + 4;
      updateTextareaValue(ta, newValue, cursorPos, cursorPos);
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
    } else if (sourceRef.current) {
      const ta = sourceRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const selected = text.slice(start, end) || '链接文本';
      const insert = '[' + selected + '](' + href + ')';
      updateTextareaValue(ta, text.slice(0, start) + insert + text.slice(end), start + 1, start + 1 + selected.length);
    }
  };

  const handleTable = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.insertTable();
    } else if (sourceRef.current) {
      const ta = sourceRef.current;
      const start = ta.selectionStart;
      const text = ta.value;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const needsNewline = lineStart > 0 && text[lineStart - 1] !== '\n';
      const prefix = needsNewline ? '\n' : '';
      const table = prefix + '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
      const newValue = text.slice(0, lineStart) + table + text.slice(lineStart);
      const cursorPos = lineStart + table.length;
      updateTextareaValue(ta, newValue, cursorPos, cursorPos);
    }
  };

  return (
    <div className="toolbar">
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
