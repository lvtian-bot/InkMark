import type { EditorState } from '@codemirror/state';
import { useStore, selectViewMode } from './stores/useStore';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle } from './source-editor-ref';
import { extractSourceHeadings } from './source-document';
import {
  computeSectionRanges,
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

  const result = moveSection(context.doc, context.ranges, fromIndex, anchor);
  if (!result) return false;
  context.apply(result.content);
  return true;
}

interface MoveContext {
  doc: string;
  headings: ReadonlyArray<{ pos: number; level: number }>;
  ranges: OutlineSection[];
  apply: (next: string) => void;
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
  if (tab.outline.length !== headings.length) return null;
  return {
    doc,
    headings,
    ranges: computeSectionRanges(doc, headings),
    apply: (next) => handle.replaceDocumentUndoable(next),
  };
}

/**
 * 从 Markdown 文本中提取标题位置，用于所见即所得模式的章节区间计算。
 * 判定与 `source-document.ts` 的源码大纲保持一致：跳过 YAML frontmatter，
 * 识别 ATX 与 setext 标题；围栏代码块内的 `#` 不算标题。
 */
export function headingsFromMarkdown(doc: string): Array<{ pos: number; level: number }> {
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(doc);
  const start = frontmatter ? frontmatter[0].length : 0;
  const headings: Array<{ pos: number; level: number }> = [];
  let fence: string | null = null;
  // 上一个非空普通行起点：setext 标题的位置记在它的行首。
  let previousParagraphStart: number | null = null;

  let offset = start;
  for (const line of doc.slice(start).split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const content = line.replace(/\r$/, '');

    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(content);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1][0];
        previousParagraphStart = null;
      } else if (fence === fenceMatch[1][0]) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    const atx = /^\s{0,3}(#{1,6})(?:[ \t]+|$)/.exec(content);
    if (atx) {
      headings.push({ pos: lineStart, level: atx[1].length });
      previousParagraphStart = null;
      continue;
    }

    // setext 标题：上一行普通文本下跟一行 === 或 ---。
    if (/^\s{0,3}(=+|-+)\s*$/.test(content) && previousParagraphStart !== null) {
      headings.push({
        pos: previousParagraphStart,
        level: content.trim().startsWith('=') ? 1 : 2,
      });
      previousParagraphStart = null;
      continue;
    }

    previousParagraphStart = content.trim() !== '' ? lineStart : null;
  }

  return headings.sort((a, b) => a.pos - b.pos);
}
