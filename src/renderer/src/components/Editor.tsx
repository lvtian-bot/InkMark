import { useRef, useEffect } from 'react';
import { useEditor, Milkdown } from '@milkdown/react';
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { nord } from '@milkdown/theme-nord';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { block } from '@milkdown/plugin-block';
import { clipboard } from '@milkdown/plugin-clipboard';
import { upload } from '@milkdown/plugin-upload';
import { prism } from '@milkdown/plugin-prism';
import {
  getMarkdown as getMarkdownAction,
  replaceAll as replaceAllAction,
  callCommand,
} from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/kit/prose/state';
import { editorHandle } from '../editor-ref';
import { useStore } from '../stores/useStore';
import '../styles/editor.css';
import '../styles/prism.css';
import '../styles/themes/github.css';
import '@milkdown/theme-nord/style.css';
import githubLightUrl from 'github-markdown-css/github-markdown-light.css?url';
import githubDarkUrl from 'github-markdown-css/github-markdown-dark.css?url';

const GITHUB_LINK_ID = 'inkmark-github-theme';

interface EditorProps {
  onDocChange: (doc: unknown) => void;
}

export function Editor({ onDocChange }: EditorProps) {
  const onDocChangeRef = useRef(onDocChange);
  useEffect(() => {
    onDocChangeRef.current = onDocChange;
  }, [onDocChange]);
  const armedRef = useRef(false);
  const contentTheme = useStore((s) => s.contentTheme);
  const theme = useStore((s) => s.theme);

  const { loading, get } = useEditor((root) => {
    return MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, '');
      })
      .config((ctx) => {
        const manager = ctx.get(listenerCtx);
        manager.updated((_ctx, doc) => {
          if (!armedRef.current) return;
          onDocChangeRef.current(doc);
        });
      })
      .use((ctx) => {
        // theme-nord 把 nord 的类型声明为 (ctx) => void，与 MilkdownPlugin
        // 期望的返回值不匹配，这里包一层使其符合插件类型
        nord(ctx);
        return () => {};
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(block)
      .use(clipboard)
      .use(upload)
      .use(prism);
  }, []);

  useEffect(() => {
    let link = document.getElementById(GITHUB_LINK_ID) as HTMLLinkElement | null;

    if (contentTheme === 'github') {
      const href = theme === 'dark' ? githubDarkUrl : githubLightUrl;
      if (!link) {
        link = document.createElement('link');
        link.id = GITHUB_LINK_ID;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = href;
    } else if (link) {
      link.remove();
    }

    const milkdown = document.querySelector('.editor-container .milkdown');
    if (milkdown) {
      if (contentTheme === 'github') {
        milkdown.classList.add('markdown-body');
      } else {
        milkdown.classList.remove('markdown-body');
      }
    }
  }, [contentTheme, theme, loading]);

  useEffect(() => {
    if (loading) return;

    const ed = get();
    if (!ed) return;

    editorHandle.current = {
      getMarkdown: () => {
        try {
          return ed.action(getMarkdownAction()) ?? '';
        } catch {
          return '';
        }
      },
      setMarkdown: (md: string) => {
        try {
          ed.action(replaceAllAction(md, true));
          const view = ed.ctx.get(editorViewCtx);
          onDocChangeRef.current(view.state.doc);
        } catch (e) {
          console.error('setMarkdown error:', e);
        }
      },
      getEditorState: () => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          return view.state;
        } catch {
          return null;
        }
      },
      setEditorState: (state) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          view.updateState(state);
        } catch (e) {
          console.error('setEditorState error:', e);
        }
      },
      getMarkdownFromState: (state) => {
        try {
          const serializer = ed.ctx.get(serializerCtx);
          return serializer(state.doc) ?? '';
        } catch {
          return '';
        }
      },
      scrollToPos: (pos: number) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const doc = view.state.doc;
          const safePos = Math.min(Math.max(0, pos), doc.content.size);
          const sel = TextSelection.near(doc.resolve(safePos));
          view.dispatch(view.state.tr.setSelection(sel));
          view.focus();

          const container = document.querySelector('.editor-container') as HTMLElement | null;
          if (container) {
            const offset = 80;
            const delta =
              view.coordsAtPos(safePos).top - container.getBoundingClientRect().top - offset;
            container.scrollTop += delta;
          }
        } catch (e) {
          console.error('scrollToPos error:', e);
        }
      },
      getScrollContainer: () => {
        return document.querySelector('.editor-container') as HTMLElement | null;
      },
      getScrollTop: () => {
        const container = document.querySelector('.editor-container') as HTMLElement | null;
        return container?.scrollTop ?? 0;
      },
      setScrollTop: (top: number) => {
        const container = document.querySelector('.editor-container') as HTMLElement | null;
        if (container) container.scrollTop = top;
      },
      undo: () => {
        try {
          ed.action(callCommand(undoCommand.key));
        } catch (e) {
          console.error('undo error:', e);
        }
      },
      redo: () => {
        try {
          ed.action(callCommand(redoCommand.key));
        } catch (e) {
          console.error('redo error:', e);
        }
      },
      toggleBold: () => {
        try {
          ed.action(callCommand(toggleStrongCommand.key));
        } catch (e) {
          console.error('toggleBold error:', e);
        }
      },
      toggleItalic: () => {
        try {
          ed.action(callCommand(toggleEmphasisCommand.key));
        } catch (e) {
          console.error('toggleItalic error:', e);
        }
      },
      wrapHeading: (level: number) => {
        try {
          ed.action(callCommand(wrapInHeadingCommand.key, level));
        } catch (e) {
          console.error('wrapHeading error:', e);
        }
      },
      wrapBulletList: () => {
        try {
          ed.action(callCommand(wrapInBulletListCommand.key));
        } catch (e) {
          console.error('wrapBulletList error:', e);
        }
      },
      wrapOrderedList: () => {
        try {
          ed.action(callCommand(wrapInOrderedListCommand.key));
        } catch (e) {
          console.error('wrapOrderedList error:', e);
        }
      },
      focus: () => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          view.focus();
        } catch {
          /* focus may fail */
        }
      },
    };

    // Sync editor with active tab content (handles cold-start file open race)
    const state = useStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (activeTab && activeTab.sourceContent) {
      ed.action(replaceAllAction(activeTab.sourceContent, true));
    }

    armedRef.current = true;

    requestAnimationFrame(() => {
      editorHandle.current?.focus();
    });

    return () => {
      editorHandle.current = null;
    };
  }, [loading, get]);

  return (
    <div className={`editor-container theme-${contentTheme}`}>
      <Milkdown />
    </div>
  );
}
