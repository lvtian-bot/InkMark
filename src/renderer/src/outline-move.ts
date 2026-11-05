import { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { useStore, selectViewMode } from './stores/useStore';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle } from './source-editor-ref';
import { extractSourceHeadings } from './source-document';
import {
  computeSectionRanges,
  expandToLineStart,
  hasUnclosedFence,
  hasSafeSectionBoundaries,
  hasStableLinkDefinitions,
  isSectionAncestor,
  moveSection,
  type DropAnchor,
  type OutlineSection,
} from './outline-sections';

/**
 * 大纲拖动移动章节的编辑器接入层。
 *
 * 两种编辑模式的正文来源不同：
 * - 源码模式直接读 CodeMirror 的当前文档（含尚未同步到 store 的输入）；
 * - 所见即所得模式的 `Heading.pos` 是 ProseMirror 节点位置，与源码字符偏移不是同一坐标系，
 *   因此先取序列化后的 Markdown 文本，在文本坐标上计算搬移结果，再整篇写回编辑器。
 *   写回走可撤销的整篇替换，保留撤销历史。
 */
export function moveOutlineSection(fromIndex: number, anchor: DropAnchor): boolean {
  const context = readMoveContext();
  if (!context) return false;
  if (isSectionAncestor(context.headings, fromIndex, anchor.index)) return false;
  if (!hasSafeSectionBoundaries(context.doc, context.ranges, fromIndex, anchor)) return false;
  // 未闭合的代码围栏会延续到文末；把末尾章节搬到中间会让后续章节被吞进代码块，
  // 静默改变未移动内容的结构，因此这类文档暂不支持拖动搬移。
  if (hasUnclosedFence(context.doc, 0)) return false;

  const result = moveSection(context.doc, context.ranges, fromIndex, anchor);
  if (!result || !hasStableLinkDefinitions(context.doc, result.content)) return false;
  context.apply(result.content);
  return true;
}

interface MoveContext {
  doc: string;
  headings: ReadonlyArray<{ pos: number; level: number }>;
  ranges: OutlineSection[];
  apply: (next: string) => void;
}

/**
 * 当前文档是否允许大纲拖动搬移。
 * 未闭合的代码围栏会延续到文末，搬移会让后续章节被吞进代码块，此时禁止拖动。
 */
export function canMoveOutlineSection(): boolean {
  const context = readMoveContext();
  return context !== null && !hasUnclosedFence(context.doc, 0);
}

/** 预览落点时执行与实际搬移相同的结构安全检查。 */
export function canDropOutlineSection(fromIndex: number, anchor: DropAnchor): boolean {
  const context = readMoveContext();
  if (
    !context ||
    hasUnclosedFence(context.doc, 0) ||
    isSectionAncestor(context.headings, fromIndex, anchor.index) ||
    !hasSafeSectionBoundaries(context.doc, context.ranges, fromIndex, anchor)
  )
    return false;
  const result = moveSection(context.doc, context.ranges, fromIndex, anchor);
  return result !== null && hasStableLinkDefinitions(context.doc, result.content);
}

/** 读取当前编辑模式下用于计算的正文、章节区间与写回方式；无法安全计算时返回 null。 */
function readMoveContext(): MoveContext | null {
  const state = useStore.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return null;

  if (selectViewMode(state) === 'source') {
    const handle = sourceEditorHandle.current;
    if (!handle) return null;
    const editorState: EditorState = handle.getEditorState();
    if (editorState.facet(EditorState.readOnly)) return null;
    const doc = editorState.doc.toString();
    const headings = extractSourceHeadings(editorState);
    return {
      doc,
      headings,
      ranges: computeSectionRanges(doc, headings),
      apply: (next) => handle.replaceDocumentUndoable(next),
    };
  }

  const handle = editorHandle.current;
  if (!handle) return null;
  // 存在尚未上报的编辑时以编辑器当前内容为准，避免用陈旧正文覆盖用户刚输入的内容。
  const doc = handle.getPendingMarkdown() ?? handle.getMarkdown() ?? tab.sourceContent;
  if (!doc) return null;
  // 大纲里的标题与文本中解析出的标题必须一一对应，否则序号会错位、搬错章节。
  const headings = headingsFromMarkdown(doc);
  if (
    tab.outline.length !== headings.length ||
    headings.some((heading, index) => heading.level !== tab.outline[index].level)
  )
    return null;
  return {
    doc,
    headings,
    ranges: computeSectionRanges(doc, headings),
    apply: (next) => handle.replaceDocumentUndoable(next),
  };
}

/**
 * 从 Markdown 文本中提取标题位置，用于所见即所得模式的章节区间计算。
 *
 * 判定需要与大纲数据源（`hooks/useOutline.ts` 遍历 ProseMirror 全部后代）保持一致，
 * 否则标题数量不等会导致拒绝移动：
 * - 跳过 YAML frontmatter；
 * - 用编辑器的 Markdown 解析器识别标题，包括引用、列表等容器内的标题。
 */
export function headingsFromMarkdown(doc: string): Array<{ pos: number; level: number }> {
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(doc);
  const start = frontmatter ? frontmatter[0].length : 0;
  const headings: Array<{ pos: number; level: number }> = [];
  markdownLanguage.parser.parse(doc.slice(start)).iterate({
    enter(node) {
      const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
      if (match)
        headings.push({ pos: expandToLineStart(doc, start + node.from), level: Number(match[1]) });
    },
  });
  return headings;
}
