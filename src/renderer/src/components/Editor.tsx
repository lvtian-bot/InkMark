import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  hardbreakFilterNodes,
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
import { TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model';
import { editorHandle } from '../editor-ref';
import { readScrollTop, writeScrollTop } from '../editor-scroll';
import { isValidTextMatch, type TextMatch } from '../find-replace';
import { findTextMatchesInDocument } from '../find-replace-doc';
import { findReplacePlugin, setFindDecorations } from '../find-replace-plugin';
import {
  addTableLine as applyAddTableLine,
  deleteTableLine as applyDeleteTableLine,
} from '../plugins/table-edit';
import { wrapInTaskListCommand, taskList } from '../plugins/task-list';
import { listKeymap } from '../plugins/list-keymap';
import { frontmatter } from '../plugins/frontmatter';
import { listMarker, listMarkerHandler } from '../plugins/list-marker';
import { breaks } from '../plugins/breaks';
import { cellBrRemark, cellAwareHardbreak } from '../plugins/table-cell-breaks';
import { tableEnterKeymap } from '../plugins/table-enter-keymap';
import { linkGesture } from '../plugins/link-gesture';
import { pickLinkHrefFromClick, isFollowLinkCombo, shouldHintFollowLink } from '../document-link';
import { expandToLinkBounds } from '../link-selection';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { selectAppTheme, selectContentTheme, useStore } from '../stores/useStore';
import { useI18n } from '../i18n';
import '../styles/editor.css';
import '../styles/prism.css';
import '../styles/themes/github.css';
import githubLightUrl from 'github-markdown-css/github-markdown-light.css?url';
import githubDarkUrl from 'github-markdown-css/github-markdown-dark.css?url';
import {
  markdownStringifyOverrides,
  dropBrPlaceholderHandler,
  breakHandler,
} from '../markdown-stringify-options';

const GITHUB_LINK_ID = 'inkmark-github-theme';

interface EditorProps {
  onDocChange: (doc: unknown) => void;
  onDocInit: (doc: unknown) => void;
  /** 点击文档内链接时回调（href 为链接的原始地址）。 */
  onFollowLink: (href: string) => void;
}

/** 右键目标上下文：决定菜单在基础组之外追加哪些条目。 */
type EditorMenuTarget =
  | { kind: 'table' }
  | { kind: 'link'; href: string; pos: number }
  | { kind: 'code'; text: string }
  | { kind: 'text' };

interface MenuSnapshot {
  /** 区分先后两次菜单，让异步剪贴板查询只更新当前这一份条目。 */
  seq: number;
  left: number;
  top: number;
  /** 打开菜单瞬间构造完成；渲染期只读，不再重算。 */
  entries: ContextMenuItem[];
}

export function Editor({ onDocChange, onDocInit, onFollowLink }: EditorProps) {
  const { t } = useI18n();
  const onDocChangeRef = useRef(onDocChange);
  const onDocInitRef = useRef(onDocInit);
  const onFollowLinkRef = useRef(onFollowLink);
  useEffect(() => {
    onDocChangeRef.current = onDocChange;
    onDocInitRef.current = onDocInit;
    onFollowLinkRef.current = onFollowLink;
  }, [onDocChange, onDocInit, onFollowLink]);
  const armedRef = useRef(false);
  const syncedDocRef = useRef<ProseNode | null>(null);
  const contentTheme = useStore(selectContentTheme);
  const theme = useStore(selectAppTheme);
  const strictLineBreaks = useStore((s) => s.strictLineBreaks);
  const initialStrictRef = useRef(strictLineBreaks);
  const [contextMenu, setContextMenu] = useState<MenuSnapshot | null>(null);
  const menuSeqRef = useRef(0);

  // 链接跳转（与源码模式同一手势）：Ctrl/Cmd+点击跟随链接（文档链接开标签、
  // 外链交系统），普通点击不拦截，保留光标放进链接内编辑的默认行为。
  const handleEditorClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const href = pickLinkHrefFromClick(event.target);
    if (!href) return;
    if (!isFollowLinkCombo(event, window.inkmark.platform)) return;
    event.preventDefault();
    onFollowLinkRef.current(href);
  };

  // 悬停提示：按住跳转组合键扫过链接时让链接显示手指，与「此时点击会跳转」
  // 对应；平时保持文本竖线。类名挂在容器上，由 CSS 作用于其内所有链接。
  const handleEditorMouseMove = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.currentTarget.classList.toggle(
      'is-link-follow-hint',
      shouldHintFollowLink(event.target, event, window.inkmark.platform),
    );
  };

  const handleEditorMouseLeave = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.currentTarget.classList.remove('is-link-follow-hint');
  };

  const runRemoveLink = (pos: number): void => {
    try {
      const instance = get();
      if (!instance) return;
      const view = instance.ctx.get(editorViewCtx);
      const linkType = view.state.schema.marks.link;
      const range = expandToLinkBounds(view.state.doc, pos, linkType);
      if (!range) return;
      view.dispatch(view.state.tr.removeMark(range.from, range.to, linkType));
    } catch (e) {
      console.error('removeLink error:', e);
    }
  };

  const runTableContextMenuOp = (
    op:
      | { kind: 'add-row' | 'add-col'; position: 'before' | 'after' }
      | { kind: 'delete-row' | 'delete-col' },
  ): void => {
    const handle = editorHandle.current;
    if (!handle) return;

    if (op.kind === 'add-row' || op.kind === 'add-col') {
      handle.addTableLine(op.kind === 'add-row' ? 'row' : 'col', op.position);
    } else {
      handle.deleteTableLine(op.kind === 'delete-row' ? 'row' : 'col');
    }
  };

  // 菜单条目只在打开菜单的事件处理器里构造（渲染期仅读取构造结果）：
  // 剪切/粘贴等动作作用于仍持有焦点的编辑器，剪贴板可粘贴性异步确认前先置灰。
  // 所有菜单一律平铺：目标专属操作在前（表格行列入/链接/代码块），剪贴板组在后。
  const buildMenuEntries = (
    target: EditorMenuTarget,
    hasSelection: boolean,
    clipboardHasText: boolean,
  ): ContextMenuItem[] => {
    const exec = (action: Parameters<typeof window.inkmark.execClipboardCommand>[0]) => () =>
      void window.inkmark.execClipboardCommand(action);
    const entries: ContextMenuItem[] = [];

    if (target.kind === 'table') {
      // 删表不需要专门条目：删除行删到最后一行数据时会自动删除整张表。
      entries.push(
        {
          label: t('toolbar.tableAddRowAbove'),
          onSelect: () => runTableContextMenuOp({ kind: 'add-row', position: 'before' }),
        },
        {
          label: t('toolbar.tableAddRowBelow'),
          onSelect: () => runTableContextMenuOp({ kind: 'add-row', position: 'after' }),
        },
        {
          label: t('toolbar.tableAddColLeft'),
          onSelect: () => runTableContextMenuOp({ kind: 'add-col', position: 'before' }),
        },
        {
          label: t('toolbar.tableAddColRight'),
          onSelect: () => runTableContextMenuOp({ kind: 'add-col', position: 'after' }),
        },
        {
          label: t('toolbar.tableDeleteRow'),
          onSelect: () => runTableContextMenuOp({ kind: 'delete-row' }),
        },
        {
          label: t('toolbar.tableDeleteCol'),
          onSelect: () => runTableContextMenuOp({ kind: 'delete-col' }),
        },
      );
    } else if (target.kind === 'link') {
      entries.push(
        { label: t('contextMenu.openLink'), onSelect: () => onFollowLink(target.href) },
        {
          label: t('contextMenu.copyLinkAddress'),
          onSelect: () => void window.inkmark.copyText(target.href),
        },
        { label: t('contextMenu.removeLink'), onSelect: () => runRemoveLink(target.pos) },
      );
    } else if (target.kind === 'code') {
      entries.push({
        label: t('contextMenu.copyCodeBlock'),
        onSelect: () => void window.inkmark.copyText(target.text),
      });
    }

    entries.push(
      { label: t('menu.cut'), disabled: !hasSelection, onSelect: exec('cut') },
      { label: t('menu.copy'), disabled: !hasSelection, onSelect: exec('copy') },
      { label: t('menu.paste'), disabled: !clipboardHasText, onSelect: exec('paste') },
      {
        label: t('menu.pasteAsPlainText'),
        disabled: !clipboardHasText,
        onSelect: exec('pasteAndMatchStyle'),
      },
      { label: t('menu.selectAll'), onSelect: exec('selectAll') },
    );
    return entries;
  };

  // 打开菜单前采样选区状态并构造条目；剪贴板查询异步返回后只刷新当前这份的粘贴项。
  const openContextMenu = (
    target: EditorMenuTarget,
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    const instance = get();
    const view = instance ? instance.ctx.get(editorViewCtx) : null;
    const hasSelection = view ? !view.state.selection.empty : false;

    const seq = menuSeqRef.current + 1;
    menuSeqRef.current = seq;
    setContextMenu({
      seq,
      left: event.clientX,
      top: event.clientY,
      entries: buildMenuEntries(target, hasSelection, false),
    });
    void window.inkmark.clipboardHasText().then((has) => {
      setContextMenu((prev) =>
        prev && prev.seq === seq
          ? { ...prev, entries: buildMenuEntries(target, hasSelection, has) }
          : prev,
      );
    });
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.context-menu')) return;
    event.preventDefault();

    const instance = get();
    const view = instance ? instance.ctx.get(editorViewCtx) : null;
    if (!view) return;

    // 表格：右键点在已有选区内时保留选区（此时剪切/复制可用，表格操作作用于
    // 选区所在行列）；点在选区外才把光标移到点击处，按新位置定位行列。
    const cell = target?.closest('td, th');
    if (cell && cell.closest('.ProseMirror')) {
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (coords) {
        const { from, to } = view.state.selection;
        const clickInSelection = from !== to && coords.pos >= from && coords.pos <= to;
        if (!clickInSelection) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos))),
          );
        }
        openContextMenu({ kind: 'table' }, event);
        return;
      }
    }

    // 链接：记录点击处的文档位置，「移除链接」按它扩展出完整链接范围。
    const href = pickLinkHrefFromClick(target);
    if (href) {
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      openContextMenu({ kind: 'link', href, pos: coords?.pos ?? 0 }, event);
      return;
    }

    // 代码块：整块复制时取渲染后的纯文本。
    const pre = target?.closest('pre');
    if (pre) {
      openContextMenu({ kind: 'code', text: pre.textContent ?? '' }, event);
      return;
    }

    openContextMenu({ kind: 'text' }, event);
  };

  useEditor((root) => {
    return (
      MilkdownEditor.make()
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
            // 注入 break 处理器：宽松换行模式下输出干净的 '\n'，严格换行模式下输出 '\\\n'。
            handlers: {
              ...options.handlers,
              list: listMarkerHandler,
              html: dropBrPlaceholderHandler,
              break: breakHandler,
            },
          }));
          // 允许在表格单元格内插入硬换行（格内换行以 <br> 落盘，见 plugins/table-cell-breaks）。
          // Milkdown 默认把 table 与 code_block 都列入硬换行禁插名单，这里只放开表格；
          // 代码块内仍禁止。
          ctx.update(hardbreakFilterNodes.key, (nodes) => nodes.filter((name) => name !== 'table'));
        })
        .config((ctx) => {
          const manager = ctx.get(listenerCtx);
          manager.updated((ctx, doc) => {
            if (!armedRef.current || useStore.getState().viewMode !== 'wysiwyg') return;
            // listener 会延迟 200ms 上报。切换/加载后的旧事务不能反写当前正文，
            // 已程序加载或上报过的正文也无需再次序列化。
            const currentDoc = ctx.get(editorViewCtx).state.doc;
            if (!doc.eq(currentDoc) || syncedDocRef.current?.eq(doc)) return;
            syncedDocRef.current = doc;
            onDocChangeRef.current(doc);
          });
        })
        .use((ctx) => {
          // theme-nord 把 nord 的类型声明为 (ctx) => void，与 MilkdownPlugin
          // 期望的返回值不匹配，这里包一层使其符合插件类型
          nord(ctx);
          return () => {};
        })
        // 单元格内 <br> 的解析插件必须先于 commonmark：remark 变换按注册顺序执行，
        // 要赶在 preserve-empty-line 删除 <br> 之前抢救（见 plugins/table-cell-breaks）。
        .use(cellBrRemark)
        .use(commonmark)
        .use(gfm)
        .use(frontmatter)
        .use(taskList)
        .use(listKeymap)
        .use(listMarker)
        .use(breaks)
        // 覆盖 commonmark 的 hardbreak 序列化：单元格内换行输出 <br>（upsertById
        // 按 id 替换同名 schema 条目，因此必须在 commonmark 之后注册）。
        .use(cellAwareHardbreak)
        .use(tableEnterKeymap)
        .use(linkGesture)
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
        .use(prism)
    );
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
      getPendingMarkdown: () => {
        const doc = ed.ctx.get(editorViewCtx).state.doc;
        if (syncedDocRef.current?.eq(doc)) return null;
        // 查询本身不消费待同步状态；调用方确认同步前仍可再次取得正文。
        return ed.ctx.get(serializerCtx)(doc);
      },
      getSelectedMarkdown: () => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const selection = view.state.selection;
          if (selection.empty) return '';
          const slice = selection.content();
          const docNode = view.state.schema.nodes.doc.create(null, slice.content);
          const serializer = ed.ctx.get(serializerCtx);
          const md = serializer(docNode) ?? '';
          return md.replace(/\n+$/, '');
        } catch (e) {
          console.error('getSelectedMarkdown error:', e);
          return '';
        }
      },
      setMarkdown: (md: string) => {
        try {
          ed.action(replaceAllAction(md, true));
          const view = ed.ctx.get(editorViewCtx);
          syncedDocRef.current = view.state.doc;
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
          syncedDocRef.current = view.state.doc;
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
      deleteLine: () => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const { $from, $to } = view.state.selection;

          // 删除单元 = 光标所在文本块（源码里的一「行」）；位于列表项内时升级为
          // 整个列表项。表格单元格内的段落不删，避免破坏表格结构。
          const unitAt = (pos: ResolvedPos): { start: number; end: number } | null => {
            for (let d = 1; d <= pos.depth; d++) {
              const name = pos.node(d).type.name;
              if (name === 'table' || name === 'table_row' || name === 'table_cell') {
                return null;
              }
            }
            const parentDepth =
              pos.depth >= 2 && pos.node(pos.depth - 1).type.name === 'list_item'
                ? pos.depth - 1
                : pos.depth;
            return { start: pos.before(parentDepth), end: pos.after(parentDepth) };
          };

          // 选区两端各自计算删除单元，统一删掉覆盖的区间（跨选多块时一起删）。
          const fromUnit = unitAt($from);
          const toUnit = unitAt($to);
          if (!fromUnit || !toUnit) return;
          const start = Math.min(fromUnit.start, toUnit.start);
          const end = Math.max(fromUnit.end, toUnit.end);
          if (start >= end) return;
          view.dispatch(view.state.tr.delete(start, end).scrollIntoView());
        } catch (e) {
          console.error('deleteLine error:', e);
        }
      },
      addTableLine: (kind, position) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const tr = applyAddTableLine(view.state, ed.ctx, kind, position);
          if (tr) view.dispatch(tr);
        } catch (e) {
          console.error('addTableLine error:', e);
        }
      },
      deleteTableLine: (kind) => {
        try {
          const view = ed.ctx.get(editorViewCtx);
          const tr = applyDeleteTableLine(view.state, kind);
          if (tr) view.dispatch(tr);
        } catch (e) {
          console.error('deleteTableLine error:', e);
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
          // 跳转：把激活匹配滚入正文可视区。不依赖 ProseMirror 的 scrollIntoView()——
          // 本项目正文滚动容器是外层 .editor-container，内置滚动在该布局下不可靠
          // （大纲跳转同样采用手动滚动）。仅当匹配落在安全区外才滚动，避免在视口内抖动。
          const activeMatch = matches[activeIndex];
          if (activeMatch && isValidTextMatch(activeMatch, view.state.doc.content.size)) {
            const container = document.querySelector('.editor-container') as HTMLElement | null;
            if (container) {
              const containerTop = container.getBoundingClientRect().top;
              const relativeTop = view.coordsAtPos(activeMatch.from).top - containerTop;
              // 顶部留白避开浮动查找栏（top:52 + 高度）与标题栏；底部留一点呼吸空间。
              const topMargin = 110;
              const bottomMargin = 24;
              const safeBottom = container.clientHeight - bottomMargin;
              if (relativeTop < topMargin || relativeTop > safeBottom) {
                container.scrollTop += relativeTop - topMargin;
              }
            }
          }
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

    syncedDocRef.current = ed.ctx.get(editorViewCtx).state.doc;
    armedRef.current = true;

    // 打开已有文档不抢焦点(避免光标压在 frontmatter 上、也尊重"打开以阅读为主");
    // 仅新建文档(filePath 为空)自动聚焦,便于立即开始输入。
    if (!activeTab?.filePath) {
      requestAnimationFrame(() => {
        editorHandle.current?.focus();
      });
    }

    return () => {
      armedRef.current = false;
      syncedDocRef.current = null;
      editorHandle.current = null;
    };
  }, [loading, get]);

  // 严格换行开关：设置变化时重新解析当前文档（跳过初始挂载）。
  useEffect(() => {
    if (loading || !armedRef.current) return;
    if (initialStrictRef.current === strictLineBreaks) return;
    initialStrictRef.current = strictLineBreaks;
    const ed = get();
    if (!ed) return;
    const state = useStore.getState();
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    if (activeTab && activeTab.sourceContent) {
      editorHandle.current?.setMarkdown(activeTab.sourceContent);
    }
  }, [loading, get, strictLineBreaks]);

  return (
    <div
      className={`editor-container theme-${contentTheme}`}
      onContextMenu={handleContextMenu}
      onClick={handleEditorClick}
      onMouseMove={handleEditorMouseMove}
      onMouseLeave={handleEditorMouseLeave}
    >
      <Milkdown />
      {contextMenu && (
        <ContextMenu
          left={contextMenu.left}
          top={contextMenu.top}
          items={contextMenu.entries}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
