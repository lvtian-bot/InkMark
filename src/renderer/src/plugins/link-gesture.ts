import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isFollowLinkCombo } from '../document-link';

/// Ctrl/Cmd+单击被定义为全应用统一的「跟随链接」手势，而 ProseMirror 内置了
/// 另一个同键位手势：「修饰键单击 = 选中整个块节点」（selectClickedNode，配合
/// 块拖拽）。两者同时触发时，点击链接跳转的一瞬间段落被标记为节点选中，
/// 套上 `ProseMirror-selectednode` 的蓝色描边；该选中态随编辑器状态进入标签
/// 缓存，切回标签后描边依然可见。
/// 这里注册 handleClick 声明修饰键单击已由编辑器处理，让 ProseMirror 不再执行
/// 内置的块选中；块的整选与拖拽仍由左侧块把手承担，不受影响。
export function linkGestureClickHandler(
  _view: EditorView,
  _pos: number,
  event: MouseEvent,
): boolean {
  return isFollowLinkCombo(event, window.inkmark.platform);
}

const linkGestureKey = new PluginKey('inkmark-link-gesture');

export const linkGesture = $prose(() => {
  return new Plugin({
    key: linkGestureKey,
    props: {
      handleClick: linkGestureClickHandler,
    },
  });
});
