import { type RefObject } from 'react';
import { useStore } from '../stores/useStore';
import { editorHandle } from '../editor-ref';
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

  const handleHeading = (): void => {
    if (isWysiwyg) {
      editorHandle.current?.wrapHeading(1);
    } else if (sourceRef.current) {
      toggleLinePrefix(sourceRef.current, '# ');
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

  return (
    <div className="toolbar">
      <button className="toolbar-btn" onClick={handleUndo} title={'\u64a4\u9500 (Ctrl+Z)'}>
        {'\u21B6'}
      </button>
      <button className="toolbar-btn" onClick={handleRedo} title={'\u91cd\u505a (Ctrl+Y)'}>
        {'\u21B7'}
      </button>
      <div className="toolbar-separator" />
      <button
        className="toolbar-btn toolbar-bold"
        onClick={handleBold}
        title={'\u52a0\u7c97 (Ctrl+B)'}
      >
        {'B'}
      </button>
      <button
        className="toolbar-btn toolbar-italic"
        onClick={handleItalic}
        title={'\u659c\u4f53 (Ctrl+I)'}
      >
        {'I'}
      </button>
      <button className="toolbar-btn" onClick={handleHeading} title={'\u6807\u9898'}>
        {'H'}
      </button>
      <button className="toolbar-btn" onClick={handleBulletList} title={'\u65e0\u5e8f\u5217\u8868'}>
        {'\u2022'}
      </button>
      <button className="toolbar-btn" onClick={handleTaskList} title={'\u5f85\u529e\u4efb\u52a1'}>
        {'\u2611'}
      </button>
    </div>
  );
}
