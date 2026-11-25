import { EditorViewReady, InitReady, prosePluginsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

const docChangeListenerKey = new PluginKey('INKMARK_DOC_CHANGE_LISTENER');

/**
 * 轻量文档变更监听插件，替代 `@milkdown/plugin-listener`。
 * 上游插件会在每次 `EditorState.create` 初始化时无条件序列化整篇文档，
 * 导致大文件打开和切标签产生不必要的全量序列化开销。本插件仅追踪文档变更并防抖上报。
 */
export function createDocChangeListener(
  onUpdated: (ctx: Ctx, doc: ProseNode) => void,
  delayMs = 200,
): MilkdownPlugin {
  return (ctx) => async () => {
    await ctx.wait(InitReady);

    let prevDoc: ProseNode | null = null;
    let latestDoc: ProseNode | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cancelTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const flush = (): void => {
      timer = null;
      if (!latestDoc) return;
      const doc = latestDoc;
      latestDoc = null;
      if (prevDoc && !prevDoc.eq(doc)) {
        prevDoc = doc;
        onUpdated(ctx, doc);
      } else {
        prevDoc = doc;
      }
    };

    const plugin = new Plugin({
      key: docChangeListenerKey,
      view: () => ({
        destroy: () => {
          cancelTimer();
          latestDoc = null;
        },
      }),
      state: {
        init: (_, instance) => {
          cancelTimer();
          latestDoc = null;
          prevDoc = instance.doc;
          return null;
        },
        apply: (tr, value) => {
          if (!(tr.docChanged || tr.storedMarksSet) || tr.getMeta('addToHistory') === false) {
            return value;
          }
          latestDoc = tr.doc;
          cancelTimer();
          timer = setTimeout(flush, delayMs);
          return value;
        },
      },
    });

    ctx.update(prosePluginsCtx, (prev) => [...prev, plugin]);
    await ctx.wait(EditorViewReady);
  };
}
