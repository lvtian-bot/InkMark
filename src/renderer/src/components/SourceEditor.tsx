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
import { useStore } from '../stores/useStore';
import { sourceEditorHandle } from '../source-editor-ref';
import '../styles/source-editor.css';

interface SourceEditorProps {
  onChange: () => void;
}

// iA Writer 风格的标记淡化：把 Markdown 语法标记（# * ` - > [] 等）渲染成
// 较淡的颜色，正文保持正常对比度。只淡化标记，不改变正文字号/字体（无衬线）。
const fadedMarksHighlight = HighlightStyle.define([
  // 标题标记 # ## ###
  { tag: tags.heading1, class: 'cm-mark-faded' },
  { tag: tags.heading2, class: 'cm-mark-faded' },
  { tag: tags.heading3, class: 'cm-mark-faded' },
  { tag: tags.heading4, class: 'cm-mark-faded' },
  { tag: tags.heading5, class: 'cm-mark-faded' },
  { tag: tags.heading6, class: 'cm-mark-faded' },
 // 强调标记 * _ ** **
  { tag: tags.emphasis, class: 'cm-mark-faded' },
  { tag: tags.strong, class: 'cm-mark-faded' },
 { tag: tags.strikethrough, class: 'cm-mark-faded' },
  // 行内代码 ` `
  { tag: tags.monospace, class: 'cm-mark-faded' },
  // 链接/图片 [ ] ( )
  { tag: tags.link, class: 'cm-mark-faded' },
  { tag: tags.url, class: 'cm-mark-faded' },
  // 列表与任务标记 - * + []
  { tag: tags.list, class: 'cm-mark-faded' },
  // 引用 >
  { tag: tags.quote, class: 'cm-mark-faded' },
  // 分隔线 ---
  { tag: tags.separator, class: 'cm-mark-faded' },
]);

export function SourceEditor({ onChange }: SourceEditorProps) {
  const contentTheme = useStore((s) => s.contentTheme);
  const theme = useStore((s) => s.theme);
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
        syntaxHighlighting(fadedMarksHighlight, { fallback: true }),
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
