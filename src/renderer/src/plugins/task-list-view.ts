import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { t } from '../i18n';

const taskListCheckboxKey = new PluginKey('inkmark-task-checkbox');

/// 为每个 GFM 任务列表项（`list_item` 且 `checked != null`）在段落行首插入一个真实
/// 的 checkbox（widget decoration），替代此前的 CSS `::before` 伪元素 + 点击坐标
/// 判定 hack。点击 checkbox 由全局 click handler 反推所属 `list_item` 位置并 toggle
/// `checked`。
///
/// 这里刻意**不**覆盖 `list_item` 的 NodeView：`list_item` 是容器节点，NodeView 要
/// 重新安排 `contentDOM`，会破坏 `<li><p>` 的标准 DOM 结构和既有列表 CSS；widget
/// decoration 是 ProseMirror 给「节点旁加只读装饰 UI」的标准手段，最小改动、最稳。
///
/// checkbox 插在段落内部第一个字符位置（`pos + 2`），与原来的 `p::before` 伪元素一样
/// 处于行内行首，可直接复用 inline-block + vertical-align 的对齐方式。
export const taskListCheckboxPlugin = $prose(() => {
  return new Plugin({
    key: taskListCheckboxKey,
    props: {
      decorations(state) {
        let decos: Decoration[] | null = null;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'list_item' && node.attrs.checked != null) {
            decos ??= [];
            const checked = node.attrs.checked as boolean;
            const liPos = pos;
            decos.push(
              Decoration.widget(
                pos + 2,
                () => {
                  const box = document.createElement('span');
                  box.className = 'task-checkbox';
                  box.dataset.checked = String(checked);
                  box.dataset.liPos = String(liPos);
                  box.setAttribute('role', 'checkbox');
                  box.setAttribute('aria-checked', String(checked));
                  box.setAttribute('aria-label', t('task.toggleDone'));
                  box.contentEditable = 'false';
                  return box;
                },
                { side: -1 },
              ),
            );
          }
          // 继续遍历子节点，让嵌套的任务项也能拿到自己的 checkbox。
          return true;
        });
        return decos ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
      },
      handleDOMEvents: {
        click(view, event) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          const box = target.closest<HTMLElement>('.task-checkbox');
          if (!box) return false;
          const liPosStr = box.dataset.liPos;
          if (liPosStr == null) return false;
          const liPos = Number(liPosStr);
          if (!Number.isFinite(liPos)) return false;

          const node = view.state.doc.nodeAt(liPos);
          // 节点可能已被编辑改变；不是任务项时放行，交默认处理。
          if (!node || node.type.name !== 'list_item' || node.attrs.checked == null) return false;
          const tr = view.state.tr.setNodeMarkup(liPos, undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          });
          view.dispatch(tr);
          return true;
        },
      },
    },
  });
});
