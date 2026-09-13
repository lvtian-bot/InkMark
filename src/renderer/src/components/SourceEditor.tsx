import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  defaultKeymap,
  deleteLine as deleteLineCommand,
  history,
  historyKeymap,
  redo,
  undo,
} from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import { selectAppTheme, selectContentTheme, useStore } from '../stores/useStore';
import { sourceEditorHandle } from '../source-editor-ref';
import { useI18n } from '../i18n';
import { readScrollTop, writeScrollTop } from '../editor-scroll';
import {
  acceptAllReviewChunks,
  createReviewExtension,
  getReviewChunks,
  rejectAllReviewChunks,
  setReviewChunks,
} from '../review/review-extension';
import { drainQueuedReviewChunks } from '../review/review-store';
import { findLinkHrefAtPos } from '../source-link';
import { isFollowLinkCombo } from '../document-link';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import '../styles/source-editor.css';

interface SourceEditorProps {
  onChange: (state: EditorState) => void;
  /** 未决审阅块数量变化时上报（React 侧据此驱动工具条与角标）。 */
  onReviewCountChange?: (count: number, content: string) => void;
  onSingleReviewComplete?: (content: string) => void;
  /** Ctrl/Cmd+点击链接时回调（href 为链接的原始地址）。 */
  onFollowLink: (href: string) => void;
}

// iA Writer 风格：语法符号淡化成装饰色，正文按语义加粗/强调，结构清晰、内容突出。
// 语法符号（# * ` > []() - 等）在 @lezer/markdown 中统一标为 tags.processingInstruction，
// 文字内容则标为 heading/strong/emphasis/link/monospace/quote 等，两者要分开处理。
const fadedMarksHighlight = HighlightStyle.define([
  // 语法符号：淡化为装饰色，让正文更突出
  { tag: tags.processingInstruction, class: 'cm-mark-faded' },

  // 标题文字：加粗、保持正文色，层级一眼可读
  { tag: tags.heading1, class: 'cm-md-heading' },
  { tag: tags.heading2, class: 'cm-md-heading' },
  { tag: tags.heading3, class: 'cm-md-heading' },
  { tag: tags.heading4, class: 'cm-md-heading' },
  { tag: tags.heading5, class: 'cm-md-heading' },
  { tag: tags.heading6, class: 'cm-md-heading' },

  // 强调
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-emphasis' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },

  // 行内代码
  { tag: tags.monospace, class: 'cm-md-code' },

  // 链接：显示文字用强调色，原始地址用次级色稍退后
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.url, class: 'cm-md-url' },

  // 引用
  { tag: tags.quote, class: 'cm-md-quote' },

  // 分隔线
  { tag: tags.contentSeparator, class: 'cm-md-sep' },
  // 列表项文字（tags.list）保持正文色，不加样式
]);

export function SourceEditor({
  onChange,
  onReviewCountChange,
  onSingleReviewComplete,
  onFollowLink,
}: SourceEditorProps) {
  const contentTheme = useStore(selectContentTheme);
  const theme = useStore(selectAppTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // 抑制标记：setValue / replaceRangeQuiet 等程序化写入不应触发 onChange。
  const suppressRef = useRef(false);
  // 审阅扩展的回调容器：扩展只创建一次，回调通过同一对象热替换。
  const reviewCallbacksRef = useRef<{
    onCountChange?: (count: number, content: string) => void;
    onSingleDecisionComplete?: (content: string) => void;
  }>({});
  // 链接跳转回调容器：与审阅回调同理，扩展内经它取最新回调。
  const followLinkRef = useRef(onFollowLink);
  // 右键菜单状态：条目在打开菜单的事件处理器里一次性构造，渲染期仅读取。
  const [contextMenu, setContextMenu] = useState<{
    seq: number;
    left: number;
    top: number;
    items: ContextMenuItem[];
  } | null>(null);
  const menuSeqRef = useRef(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    followLinkRef.current = onFollowLink;
  }, [onFollowLink]);

  useEffect(() => {
    reviewCallbacksRef.current.onCountChange = onReviewCountChange;
    reviewCallbacksRef.current.onSingleDecisionComplete = onSingleReviewComplete;
  }, [onReviewCountChange, onSingleReviewComplete]);

  // 创建 CodeMirror 实例（只创建一次）。
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((vu) => {
      if (vu.docChanged && !suppressRef.current) {
        onChangeRef.current(vu.state);
      }
    });

    const createState = (doc: string) =>
      EditorState.create({
        doc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(fadedMarksHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          updateListener,
          EditorView.domEventHandlers({
            // 与所见即所得模式同一手势：Ctrl/Cmd+点击跟随链接；普通点击承担
            // 光标定位，Shift/Alt 组合按编辑意图处理，不触发跳转。
            mousedown: (event, view) => {
              if (event.button !== 0) return false;
              if (!isFollowLinkCombo(event, window.inkmark.platform)) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              const href = findLinkHrefAtPos(view.state, pos);
              if (!href) return false;
              event.preventDefault();
              followLinkRef.current(href);
              return true;
            },
          }),
          ...createReviewExtension(reviewCallbacksRef.current),
        ],
      });

    // 懒加载下挂载可能晚于 App 的模式/标签切换 effect（它们经 sourceEditorHandle 注入内容，
    // 句柄未就绪时会跳过），因此挂载时从当前标签 sourceContent 初始化；急切挂载时该值
    // 恒为空串，行为不变。
    const { tabs, activeTabId: initialTabId } = useStore.getState();
    const initialDoc = tabs.find((tab) => tab.id === initialTabId)?.sourceContent ?? '';

    const state = createState(initialDoc);

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    sourceEditorHandle.current = {
      getValue: () => view.state.doc.toString(),
      getEditorState: () => view.state,
      setEditorState: (state) => view.setState(state),
      setValue: (value) => {
        suppressRef.current = true;
        view.setState(createState(value));
        suppressRef.current = false;
      },
      focus: () => view.focus(),
      getSelection: () => ({
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      }),
      getSelectedText: () => {
        const { from, to } = view.state.selection.main;
        if (from === to) return '';
        return view.state.sliceDoc(from, to);
      },
      setSelection: (from, to) => {
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
        view.focus();
      },
      getScrollTop: () => readScrollTop(view.scrollDOM),
      setScrollTop: (top) => writeScrollTop(view.scrollDOM, top),
      replaceRange: (from, to, text) => {
        suppressRef.current = false;
        view.dispatch(
          view.state.update({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: 'input',
          }),
        );
        view.focus();
      },
      replaceRangeQuiet: (from, to, text) => {
        suppressRef.current = true;
        view.dispatch(
          view.state.update({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: 'input',
          }),
        );
        suppressRef.current = false;
      },
      notifyChange: () => onChangeRef.current(view.state),
      undo: () => undo(view),
      redo: () => redo(view),
      deleteLine: () => {
        deleteLineCommand(view);
        view.focus();
      },
      applyReviewChunks: (chunks) => {
        view.dispatch({ effects: setReviewChunks.of(chunks) });
      },
      getReviewChunks: () => getReviewChunks(view.state),
      acceptAllReviewChunks: () => {
        acceptAllReviewChunks(view);
      },
      rejectAllReviewChunks: () => {
        rejectAllReviewChunks(view);
      },
    };

    // 懒加载挂载完成：此时 App 的标签/模式切换 effect 可能已经跑过而句柄未就绪，
    // 补一次待注入审阅块的排空。
    drainQueuedReviewChunks(useStore.getState().activeTabId);

    return () => {
      view.destroy();
      viewRef.current = null;
      sourceEditorHandle.current = null;
    };
  }, []);

  const { t } = useI18n();

  // 与所见即所得模式一致的剪贴板基础组；源码模式下链接/代码块是纯文本
  // 语法，没有对应的上下文组。条目只在打开菜单时构造，渲染期仅读取。
  const buildEntries = (hasSelection: boolean, clipboardHasText: boolean): ContextMenuItem[] => {
    const exec = (action: Parameters<typeof window.inkmark.execClipboardCommand>[0]) => () =>
      void window.inkmark.execClipboardCommand(action);
    return [
      { label: t('menu.cut'), disabled: !hasSelection, onSelect: exec('cut') },
      { label: t('menu.copy'), disabled: !hasSelection, onSelect: exec('copy') },
      { label: t('menu.paste'), disabled: !clipboardHasText, onSelect: exec('paste') },
      {
        label: t('menu.pasteAsPlainText'),
        disabled: !clipboardHasText,
        onSelect: exec('pasteAndMatchStyle'),
      },
      { label: t('menu.selectAll'), onSelect: exec('selectAll') },
    ];
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const view = viewRef.current;
    if (!view) return;
    event.preventDefault();

    const { from, to } = view.state.selection.main;
    const hasSelection = from !== to;

    const seq = menuSeqRef.current + 1;
    menuSeqRef.current = seq;
    setContextMenu({
      seq,
      left: event.clientX,
      top: event.clientY,
      items: buildEntries(hasSelection, false),
    });
    void window.inkmark.clipboardHasText().then((has) => {
      setContextMenu((prev) =>
        prev && prev.seq === seq ? { ...prev, items: buildEntries(hasSelection, has) } : prev,
      );
    });
  };

  return (
    <>
      <div
        className={`source-container theme-${contentTheme} cm-theme-${theme}`}
        ref={hostRef}
        onContextMenu={handleContextMenu}
      />
      {contextMenu && (
        <ContextMenu
          left={contextMenu.left}
          top={contextMenu.top}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
