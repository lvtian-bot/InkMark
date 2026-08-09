import { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import { selectAppTheme, selectContentTheme, useStore } from '../stores/useStore';
import { sourceEditorHandle } from '../source-editor-ref';
import '../styles/source-editor.css';

interface SourceEditorProps {
  onChange: () => void;
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

export function SourceEditor({ onChange }: SourceEditorProps) {
  const contentTheme = useStore(selectContentTheme);
  const theme = useStore(selectAppTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // 抑制标记：setValue / replaceRangeQuiet 等程序化写入不应触发 onChange。
  const suppressRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 创建 CodeMirror 实例（只创建一次）。
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const updateListener = EditorView.updateListener.of((vu) => {
      if (vu.docChanged && !suppressRef.current) {
        onChangeRef.current();
      }
    });

    const state = EditorState.create({
      doc: '',
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(fadedMarksHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    sourceEditorHandle.current = {
      getValue: () => view.state.doc.toString(),
      setValue: (value) => {
        suppressRef.current = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
        suppressRef.current = false;
      },
      focus: () => view.focus(),
      getSelection: () => ({
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
      }),
      setSelection: (from, to) => {
        view.dispatch({ selection: { anchor: from, head: to } });
        view.focus();
      },
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
      undo: () => undo(view),
      redo: () => redo(view),
    };

    return () => {
      view.destroy();
      viewRef.current = null;
      sourceEditorHandle.current = null;
    };
  }, []);

  return (
    <div
      className={`source-container theme-${contentTheme} cm-theme-${theme}`}
      ref={hostRef}
    />
  );
}
