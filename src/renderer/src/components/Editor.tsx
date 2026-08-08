import { useRef, useEffect } from 'react';
import { useEditor, useInstance, Milkdown } from '@milkdown/react';
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
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  toggleLinkCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand, createTable } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { nord } from '@milkdown/theme-nord';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { block } from '@milkdown/plugin-block';
import { clipboard } from '@milkdown/plugin-clipboard';
import { upload, uploadConfig } from '@milkdown/plugin-upload';
import { prism } from '@milkdown/plugin-prism';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import { Decoration } from '@milkdown/kit/prose/view';
import { imageView } from '../plugins/image-view';
import { preprocessObsidianImages, postprocessObsidianImages } from '../plugins/obsidian-image';
import {
  getMarkdown as getMarkdownAction,
  replaceAll as replaceAllAction,
  callCommand,
} from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/kit/prose/state';
import { editorHandle } from '../editor-ref';
import { wrapInTaskListCommand, taskList } from '../plugins/task-list';
import { useStore } from '../stores/useStore';
import '../styles/editor.css';
import '../styles/prism.css';
import '../styles/themes/github.css';
import githubLightUrl from 'github-markdown-css/github-markdown-light.css?url';
import githubDarkUrl from 'github-markdown-css/github-markdown-dark.css?url';

const GITHUB_LINK_ID = 'inkmark-github-theme';

interface EditorProps {
  onDocChange: (doc: unknown) => void;
  onDocInit: (doc: unknown) => void;
}

export function Editor({ onDocChange, onDocInit }: EditorProps) {
  const onDocChangeRef = useRef(onDocChange);
  const onDocInitRef = useRef(onDocInit);
  useEffect(() => {
    onDocChangeRef.current = onDocChange;
    onDocInitRef.current = onDocInit;
  }, [onDocChange, onDocInit]);
  const armedRef = useRef(false);
  const contentTheme = useStore((s) => s.contentTheme);
  const theme = useStore((s) => s.theme);

  useEditor((root) => {
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
      .use(taskList)
      .use(history)
      .use(listener)
      .use(block)
      .use(clipboard)
      .config((ctx) => {
        ctx.set(uploadConfig.key, {
          enableHtmlFileUploader: true,
          uploadWidgetFactory: (pos, spec) => {
            const widgetDOM = document.createElement('span');
            widgetDOM.textContent = '正在保存图片...';
            return Decoration.widget(pos, widgetDOM, spec);
          },
          uploader: async (files, schema) => {
            const state = useStore.getState();
            const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
            const mdPath = activeTab?.filePath ?? null;

            const nodes: Node[] = [];
            for (let i = 0; i < files.length; i++) {
              const file = files.item(i);
              if (!file || !file.type.includes('image')) continue;

              let src: string;
              const electronFile = file as File & { path?: string };
              if (electronFile.path) {
                if (mdPath) {
                  const mdDir = window.inkmark.dirnamePath(mdPath);
                  src = window.inkmark.relativePath(mdDir, electronFile.path).replace(/\\/g, '/');
                } else {
                  src = electronFile.path;
                }
              } else if (mdPath) {
                const buffer = await file.arrayBuffer();
                const result = await window.inkmark.saveImage(buffer, file.name, mdPath);
                src = result.path;
              } else {
                src = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.addEventListener('load', () => resolve(reader.result as string), false);
                  reader.readAsDataURL(file);
                });
              }

              const imageNode = schema.nodes.image.createAndFill({ src, alt: file.name });
              if (imageNode) nodes.push(imageNode);
            }
            return Fragment.from(nodes);
          },
        });
      })
      .use(upload)
      .use(imageView)
      .use(prism);
  }, []);

  // 不用 useEditor 返回的 get：它每次渲染都是新函数，放进下方 effect 依赖会导致
  // effect 每次渲染重跑，冷启动回填逻辑会用陈旧的 sourceContent 覆盖用户刚输入的内容。
  // useInstance 的 get 是稳定引用，effect 只在编辑器就绪时执行一次。
  const [loading, get] = useInstance();

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

    const milkdown = document.querySelector('.editor-container [data-milkdown-root]');
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
          const md = ed.action(getMarkdownAction()) ?? '';
          return postprocessObsidianImages(md);
        } catch {
          return '';
        }
      },
      setMarkdown: (md: string) => {
        try {
          const processed = preprocessObsidianImages(md);
          ed.action(replaceAllAction(processed, true));
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
          const md = serializer(state.doc) ?? '';
          return postprocessObsidianImages(md);
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
            // 落点比大纲高亮判定线（容器顶 +80）高 4px，确保点击后目标标题立即进入高亮区
            const offset = 76;
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
      toggleStrike: () => {
        try {
          ed.action(callCommand(toggleStrikethroughCommand.key));
        } catch (e) {
          console.error('toggleStrike error:', e);
        }
      },
      toggleInlineCode: () => {
        try {
          ed.action(callCommand(toggleInlineCodeCommand.key));
        } catch (e) {
          console.error('toggleInlineCode error:', e);
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
      wrapTaskList: () => {
        try {
          ed.action(callCommand(wrapInTaskListCommand.key));
        } catch (e) {
          console.error('wrapTaskList error:', e);
        }
      },
      insertCodeBlock: () => {
        try {
          ed.action(callCommand(createCodeBlockCommand.key));
        } catch (e) {
          console.error('insertCodeBlock error:', e);
        }
      },
      insertLink: (href: string, title?: string) => {
        try {
          ed.action(callCommand(toggleLinkCommand.key, { href, title }));
        } catch (e) {
          console.error('insertLink error:', e);
        }
      },
      insertTable: () => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const table = createTable(ed.ctx, 3, 3);
          view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
          view.focus();
        } catch (e) {
          console.error('insertTable error:', e);
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
      const view = ed.ctx.get(editorViewCtx);
      onDocInitRef.current(view.state.doc);
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
