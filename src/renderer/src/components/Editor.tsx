import { useRef, useEffect } from 'react';
import { useEditor, useInstance, Milkdown } from '@milkdown/react';
import {
  Editor as MilkdownEditor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  remarkStringifyOptionsCtx,
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
import { Decoration } from '@milkdown/kit/prose/view';
import { storeLocalImages } from '../image-upload';
import { imageView } from '../plugins/image-view';
import {
  getMarkdown as getMarkdownAction,
  replaceAll as replaceAllAction,
  callCommand,
} from '@milkdown/kit/utils';
import {
  TextSelection,
  type EditorState as ProseMirrorEditorState,
} from '@milkdown/kit/prose/state';
import { editorHandle } from '../editor-ref';
import { readScrollTop, writeScrollTop } from '../editor-scroll';
import { findLiteralMatches, isValidTextMatch, type TextMatch } from '../find-replace';
import { findReplacePlugin, setFindDecorations } from '../find-replace-plugin';
import { wrapInTaskListCommand, taskList } from '../plugins/task-list';
import { frontmatter } from '../plugins/frontmatter';
import { listMarker, listMarkerHandler } from '../plugins/list-marker';
import { blockMarkerReveal } from '../plugins/block-marker-reveal';
import { selectAppTheme, selectContentTheme, useStore } from '../stores/useStore';
import '../styles/editor.css';
import '../styles/prism.css';
import '../styles/themes/github.css';
import githubLightUrl from 'github-markdown-css/github-markdown-light.css?url';
import githubDarkUrl from 'github-markdown-css/github-markdown-dark.css?url';
import {
  markdownStringifyOverrides,
  dropBrPlaceholderHandler,
} from '../markdown-stringify-options';

const GITHUB_LINK_ID = 'inkmark-github-theme';

function findTextMatchesInDocument(doc: ProseMirrorEditorState['doc'], query: string): TextMatch[] {
  if (!query) return [];

  const matches: TextMatch[] = [];

  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;

    let segmentText = '';
    let positions: number[] = [];
    let expectedNextPos: number | null = null;

    const flushSegment = (): void => {
      for (const match of findLiteralMatches(segmentText, query)) {
        const from = positions[match.from];
        const lastPosition = positions[match.to - 1];
        if (from !== undefined && lastPosition !== undefined) {
          matches.push({ from, to: lastPosition + 1 });
        }
      }
      segmentText = '';
      positions = [];
      expectedNextPos = null;
    };

    block.descendants((child, relativePos) => {
      if (!child.isText || !child.text) return true;

      const absolutePos = blockPos + 1 + relativePos;
      if (expectedNextPos !== null && absolutePos !== expectedNextPos) flushSegment();

      segmentText += child.text;
      for (let index = 0; index < child.text.length; index += 1) {
        positions.push(absolutePos + index);
      }
      expectedNextPos = absolutePos + child.nodeSize;
      return false;
    });

    flushSegment();
    return false;
  });

  return matches;
}

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
  const contentTheme = useStore(selectContentTheme);
  const theme = useStore(selectAppTheme);

  useEditor((root) => {
    return MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, '');
        // 与默认的 handlers/encode 合并，不能覆盖，否则会丢掉 Milkdown 内置的序列化处理器。
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          ...markdownStringifyOverrides,
          // 注入自定义 list 处理器：按节点保留的 bullet 字符输出（见 plugins/list-marker）。
          // 注入 html 处理器：丢弃 preserveEmptyLine 特性注入的 <br /> 空行占位，
          // 避免空列表项等空段落保存成 `* <br />` 污染 Markdown 文本（见 markdown-stringify-options）。
          handlers: {
            ...options.handlers,
            list: listMarkerHandler,
            html: dropBrPlaceholderHandler,
          },
        }));
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
      .use(frontmatter)
      .use(taskList)
      .use(listMarker)
      .use(blockMarkerReveal)
      .use(history)
      .use(listener)
      .use(findReplacePlugin)
      .use(block)
      .use(clipboard)
      .config((ctx) => {
        ctx.set(uploadConfig.key, {
          enableHtmlFileUploader: true,
          uploadWidgetFactory: (pos, spec) => {
            const widgetDOM = document.createElement('span');
            widgetDOM.hidden = true;
            widgetDOM.setAttribute('aria-hidden', 'true');
            return Decoration.widget(pos, widgetDOM, spec);
          },
          uploader: storeLocalImages,
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
      skipFrontmatterIfSelected: () => {
        // 文档以 frontmatter 开头、且当前选区落在它上面时(如刚加载内容默认选在首节点),
        // 把光标移到 frontmatter 之后的正文,避免 atom 节点被选中产生扎眼高亮。
        // 仅在选区确实压在 frontmatter 上时移动,不破坏用户已在正文中的位置。
        try {
          const view = ed.ctx.get(editorViewCtx);
          const doc = view.state.doc;
          const first = doc.firstChild;
          if (!first || first.type.name !== 'frontmatter') return;
          const fmEnd = first.nodeSize;
          if (view.state.selection.from >= fmEnd) return;
          const pos = Math.min(fmEnd, doc.content.size);
          view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))));
        } catch {
          /* 选区调整失败时保持默认 */
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
        return readScrollTop(container);
      },
      setScrollTop: (top: number) => {
        const container = document.querySelector('.editor-container') as HTMLElement | null;
        writeScrollTop(container, top);
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
      findTextMatches: (query: string) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          return findTextMatchesInDocument(view.state.doc, query);
        } catch {
          return [];
        }
      },
      showTextMatches: (matches: readonly TextMatch[], activeIndex: number) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          setFindDecorations(view, matches, activeIndex);
        } catch (e) {
          console.error('showTextMatches error:', e);
        }
      },
      replaceTextMatch: (match: TextMatch, replacement: string) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const docSize = view.state.doc.content.size;
          if (!isValidTextMatch(match, docSize)) return false;
          view.dispatch(
            view.state.tr.insertText(replacement, match.from, match.to).scrollIntoView(),
          );
          return true;
        } catch (e) {
          console.error('replaceTextMatch error:', e);
          return false;
        }
      },
      replaceAllTextMatches: (matches: readonly TextMatch[], replacement: string) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          let transaction = view.state.tr;
          let replacementCount = 0;

          for (let index = matches.length - 1; index >= 0; index -= 1) {
            const match = matches[index];
            if (!isValidTextMatch(match, view.state.doc.content.size)) {
              continue;
            }
            transaction = transaction.insertText(replacement, match.from, match.to);
            replacementCount += 1;
          }

          if (replacementCount > 0) view.dispatch(transaction.scrollIntoView());
          return replacementCount;
        } catch (e) {
          console.error('replaceAllTextMatches error:', e);
          return 0;
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
      editorHandle.current?.skipFrontmatterIfSelected();
    }

    armedRef.current = true;

    // 打开已有文档不抢焦点(避免光标压在 frontmatter 上、也尊重"打开以阅读为主");
    // 仅新建文档(filePath 为空)自动聚焦,便于立即开始输入。
    if (!activeTab?.filePath) {
      requestAnimationFrame(() => {
        editorHandle.current?.focus();
      });
    }

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
