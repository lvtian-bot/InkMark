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
import { sourceEditorHandle } from '../source-editor-ref';
import { runEditorCommand } from '../editor-commands';
import {
  DEFAULT_EDITOR_SHORTCUT_MAP,
  formatComboForDisplay,
  toDisplayPlatform,
  type ShortcutCombo,
} from '../../../shared/shortcuts';
import { useI18n } from '../i18n';
import '../styles/toolbar.css';

interface ToolbarProps {
  onSave: () => void;
}

export function Toolbar({ onSave }: ToolbarProps) {
  const viewMode = useStore((s) => s.viewMode);
  const toolbarWidth = useStore((s) => s.toolbarWidth);
  const saveShortcut = useStore((s) => s.shortcuts.save);
  // HMR 下 store 可能仍是新增字段前的旧状态，缺 editorShortcuts，兜底用默认值
  const editorShortcuts = useStore((s) => s.editorShortcuts) ?? DEFAULT_EDITOR_SHORTCUT_MAP;
  const displayPlatform = toDisplayPlatform(window.inkmark.platform);
  const isWysiwyg = viewMode === 'wysiwyg';
  const { t } = useI18n();

  // 悬停提示：已设置快捷键时附加键位，未设置时只显示功能名。
  const titleWithShortcut = (label: string, combo?: ShortcutCombo): string =>
    combo ? `${label} (${formatComboForDisplay(combo, displayPlatform)})` : label;

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
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('bold')}
          title={titleWithShortcut(t('toolbar.bold'), editorShortcuts.bold)}
        >
          <Bold size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('italic')}
          title={titleWithShortcut(t('toolbar.italic'), editorShortcuts.italic)}
        >
          <Italic size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('strike')}
          title={titleWithShortcut(t('toolbar.strikethrough'), editorShortcuts.strike)}
        >
          <Strikethrough size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('inlineCode')}
          title={titleWithShortcut(t('toolbar.inlineCode'), editorShortcuts.inlineCode)}
        >
          <Code size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => runEditorCommand('heading1')}
          title={titleWithShortcut(t('toolbar.heading1'), editorShortcuts.heading1)}
        >
          H1
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => runEditorCommand('heading2')}
          title={titleWithShortcut(t('toolbar.heading2'), editorShortcuts.heading2)}
        >
          H2
        </button>
        <button
          className="toolbar-btn toolbar-heading"
          onClick={() => runEditorCommand('heading3')}
          title={titleWithShortcut(t('toolbar.heading3'), editorShortcuts.heading3)}
        >
          H3
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('bulletList')}
          title={titleWithShortcut(t('toolbar.bulletList'), editorShortcuts.bulletList)}
        >
          <List size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('taskList')}
          title={titleWithShortcut(t('toolbar.taskList'), editorShortcuts.taskList)}
        >
          <CircleCheck size={16} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('codeBlock')}
          title={titleWithShortcut(t('toolbar.codeBlock'), editorShortcuts.codeBlock)}
        >
          <Code2 size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('link')}
          title={titleWithShortcut(t('toolbar.link'), editorShortcuts.link)}
        >
          <Link2 size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => runEditorCommand('table')}
          title={titleWithShortcut(t('toolbar.table'), editorShortcuts.table)}
        >
          <Table size={16} />
        </button>
      </div>
      <div className="toolbar-group toolbar-group-end">
        <button
          className="toolbar-btn"
          onClick={onSave}
          title={titleWithShortcut(t('toolbar.save'), saveShortcut)}
        >
          <Save size={16} />
        </button>
      </div>
    </div>
  );
}
