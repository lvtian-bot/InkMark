import { ChevronLeft, ChevronRight, FolderTree, Settings, TableOfContents } from 'lucide-react';
import { useI18n } from '../i18n';
import { useStore } from '../stores/useStore';
import '../styles/status-bar.css';

interface StatusBarProps {
  onOpenSettings: () => void;
}

interface PanelToggleProps {
  visible: boolean;
  side: 'left' | 'right';
  icon: React.ReactNode;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}

/**
 * 面板开关按钮。图标逻辑统一:收起时显示功能图标(提示"点这里打开"),
 * 展开时显示指向收起方向的箭头——左面板显示 <,右面板显示 >。
 * 大纲用 TableOfContents(横线目录),文件树用 Files(叠放文档),
 * 一个是线一个是块,缩到 14px 也不会混淆。
 */
function PanelToggle({ visible, side, icon, onToggle, showLabel, hideLabel }: PanelToggleProps) {
  return (
    <button
      className="status-toggle-btn"
      onClick={onToggle}
      title={visible ? hideLabel : showLabel}
      aria-label={visible ? hideLabel : showLabel}
    >
      {visible ? side === 'left' ? <ChevronLeft size={14} /> : <ChevronRight size={14} /> : icon}
    </button>
  );
}

export function StatusBar({ onOpenSettings }: StatusBarProps) {
  const { t } = useI18n();
  const wordCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.wordCount ?? 0);
  const charCount = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.charCount ?? 0);
  const outlineVisible = useStore((s) => s.outlineVisible);
  const setOutlineVisible = useStore((s) => s.setOutlineVisible);
  const fileTreeVisible = useStore((s) => s.fileTreeVisible);
  const setFileTreeVisible = useStore((s) => s.setFileTreeVisible);
  const panelLayout = useStore((s) => s.panelLayout);
  const toggleViewMode = useStore((s) => s.toggleViewMode);

  const outlineSide = panelLayout === 'outline-left' ? 'left' : 'right';
  const fileTreeSide = panelLayout === 'outline-left' ? 'right' : 'left';

  const outlineToggle = (
    <PanelToggle
      visible={outlineVisible}
      side={outlineSide}
      icon={<TableOfContents size={14} />}
      onToggle={() => setOutlineVisible(!outlineVisible)}
      showLabel={t('statusBar.showOutline')}
      hideLabel={t('statusBar.hideOutline')}
    />
  );
  const fileTreeToggle = (
    <PanelToggle
      visible={fileTreeVisible}
      side={fileTreeSide}
      icon={<FolderTree size={14} />}
      onToggle={() => setFileTreeVisible(!fileTreeVisible)}
      showLabel={t('statusBar.showFileTree')}
      hideLabel={t('statusBar.hideFileTree')}
    />
  );

  return (
    <footer className="status-bar">
      <div className="status-left">
        {/* 左侧面板的开关紧跟窗口左缘 */}
        {outlineSide === 'left' && outlineToggle}
        {fileTreeSide === 'left' && fileTreeToggle}
        <button
          className="status-mode-btn"
          onClick={toggleViewMode}
          title={t('statusBar.sourceMode')}
        >
          {t('statusBar.source')}
        </button>
        <button
          className="status-toggle-btn"
          type="button"
          onClick={onOpenSettings}
          title={t('statusBar.settings')}
          aria-label={t('statusBar.settings')}
        >
          <Settings size={14} />
        </button>
      </div>
      <div className="status-right">
        <div className="status-counts">
          <span className="status-item">{t('statusBar.wordCount', { wordCount })}</span>
          <span className="status-item">{t('statusBar.charCount', { charCount })}</span>
        </div>
        {/* 右侧面板的开关紧跟窗口右缘 */}
        {outlineSide === 'right' && outlineToggle}
        {fileTreeSide === 'right' && fileTreeToggle}
      </div>
    </footer>
  );
}
