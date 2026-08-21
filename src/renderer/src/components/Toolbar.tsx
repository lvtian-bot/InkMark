import {
  Bold,
  CircleCheck,
  Code,
  Code2,
  Italic,
  Link2,
  List,
  Redo2,
  Save,
  Strikethrough,
  Table,
  Undo2,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { editorHandle } from '../editor-ref';
import { sourceEditorHandle, type SourceSelection } from '../source-editor-ref';
import { promptDialog } from '../confirm-dialog';
import { useI18n } from '../i18n';
import { formatComboForDisplay, toDisplayPlatform } from '../../../shared/shortcuts';
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

interface ToolbarProps {
  onSave: () => void;
}

export function Toolbar({ onSave }: ToolbarProps) {
  const viewMode = useStore((s) => s.viewMode);
  const toolbarWidth = useStore((s) => s.toolbarWidth);
  const saveShortcut = useStore((s) => s.shortcuts.save);
  const displayPlatform = toDisplayPlatform(window.inkmark.platform);
  const isWysiwyg = viewMode === 'wysiwyg';
  const { t } = useI18n();

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
    const href = await promptDialog(t('toolbar.insertLinkTitle'), t('toolbar.insertLinkPrompt'), {
      placeholder: 'https://',
      confirmLabel: t('toolbar.insertLinkConfirm'),
    });
    if (!href) return;
    if (isWysiwyg) {
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
      const table = prefix + t('toolbar.tableTemplate');
      applySourceEdit({
        text: text.slice(0, lineStart) + table + text.slice(lineStart),
        selection: { from: lineStart + table.length, to: lineStart + table.length },
      });
    }
  };

  return (
    <div className={`toolbar toolbar-width-${toolbarWidth}`}>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleUndo} title={t('toolbar.undo')}>
          <Undo2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleRedo} title={t('toolbar.redo')}>
          <Redo2 size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleBold} title={t('toolbar.bold')}>
          <Bold size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleItalic} title={t('toolbar.italic')}>
          <Italic size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleStrike} title={t('toolbar.strikethrough')}>
          <Strikethrough size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleInlineCode} title={t('toolbar.inlineCode')}>
          <Code size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(1)}
          title={t('toolbar.heading1')}
        >
          H1
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(2)}
          title={t('toolbar.heading2')}
        >
          H2
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => handleHeading(3)}
          title={t('toolbar.heading3')}
        >
          H3
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleBulletList} title={t('toolbar.bulletList')}>
          <List size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleTaskList} title={t('toolbar.taskList')}>
          <CircleCheck size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleCodeBlock} title={t('toolbar.codeBlock')}>
          <Code2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleLink} title={t('toolbar.link')}>
          <Link2 size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleTable} title={t('toolbar.table')}>
          <Table size={16} />
        </button>
      </div>
      <div className="toolbar-group toolbar-group-end">
        <button
          className="toolbar-btn"
          onClick={onSave}
          title={t('toolbar.save', {
            shortcut: formatComboForDisplay(saveShortcut, displayPlatform),
          })}
        >
          <Save size={16} />
        </button>
      </div>
    </div>
  );
}
