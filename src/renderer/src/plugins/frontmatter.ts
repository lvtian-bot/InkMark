import { $view, $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';

// frontmatter(YAML 元信息块)的所见即所得渲染。
//
// 文档开头的 `---` 包裹块由 remark-frontmatter 解析为 mdast 的 `yaml` 节点,
// 这里把它映射到一个 atom 类型的 frontmatter 节点:YAML 原文存在节点属性上,
// NodeView 渲染成带 `---` 边界的可编辑文本区(Typora 式),编辑时实时写回属性,
// 序列化时还原为 mdast `yaml` 节点交由 remark-frontmatter 输出。
//
// remark-frontmatter 只识别文档开头的 frontmatter;正文里的 `---` 仍由 remark
// 当作 thematicBreak(thematic_break),不受本插件影响。

// remark-frontmatter 的 options 必须显式给出 type('yaml')。$remark 未传 options 时
// 默认注入空对象 {},会被 remark-frontmatter 当成"缺 type 的 matter 配置"在 freeze
// 时抛 Missing `type` in matter,导致整个 Milkdown processor 构建失败、文档打不开。
// 'yaml' 等价于默认的 `---` 包裹块。
const remarkFrontmatterPlugin = $remark('remark-frontmatter', () => remarkFrontmatter, 'yaml');

const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  group: 'block',
  atom: true,
  content: '',
  // 禁止 NodeSelection:frontmatter 由 NodeView(textarea)自管编辑,无需被整体选中。
  // 若允许选中,加载内容、切换标签或模式切换后,光标一旦压在它上面就触发选中高亮,
  // 反复出现扎眼的描边框。selectable:false 让 ProseMirror 永远跳过它落点到正文。
  selectable: false,
  attrs: {
    value: { default: '' },
  },
  // toDOM/parseDOM 在 NodeView 之外提供 DOM 往返能力(如 ProseMirror 内部复制
  // 粘贴),把原文放在 data-value 上保持对称;NodeView 负责实际可视渲染。
  parseDOM: [
    {
      tag: 'div[data-type="frontmatter"]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => ['div', { 'data-type': 'frontmatter', 'data-value': node.attrs.value }],
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value ?? '' });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.attrs.value);
    },
  },
}));

const frontmatterView = $view(frontmatterSchema.node, () => (node, view, getPos) => {
  let value = node.attrs.value as string;

  const dom = document.createElement('div');
  dom.className = 'frontmatter';
  dom.setAttribute('data-type', 'frontmatter');

  const startDelimiter = document.createElement('div');
  startDelimiter.className = 'frontmatter-delimiter';
  startDelimiter.textContent = '---';

  const editor = document.createElement('textarea');
  editor.className = 'frontmatter-editor';
  editor.value = value;
  editor.rows = 1;
  editor.spellcheck = false;
  editor.placeholder = 'frontmatter (YAML)';
  editor.setAttribute('aria-label', 'Frontmatter');

  const endDelimiter = document.createElement('div');
  endDelimiter.className = 'frontmatter-delimiter';
  endDelimiter.textContent = '---';

  dom.append(startDelimiter, editor, endDelimiter);

  const autoResize = (): void => {
    editor.style.height = 'auto';
    const h = editor.scrollHeight;
    // dom 未插入文档时 scrollHeight 为 0,此时不覆盖默认高度(rows=1),
    // 等下一帧重算。避免把高度钉死在 0,导致 frontmatter 中间内容区被压没。
    if (h > 0) editor.style.height = `${h}px`;
  };
  autoResize();
  // NodeView 的 dom 在返回后才被 ProseMirror 插入文档,scrollHeight 那时才正确;
  // 下一帧重算一次,撑开到内容实际高度。
  requestAnimationFrame(autoResize);

  // 输入即把文本写回节点属性,确保文档脏状态、字数与序列化都拿到最新值;
  // 本地 value 与节点同步后,ProseMirror 回调 update 时不会再回写 textarea,避免光标跳动。
  const commit = (): void => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    if (editor.value === value) return;
    value = editor.value;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { value });
    view.dispatch(tr);
  };

  editor.addEventListener('input', () => {
    autoResize();
    commit();
  });

  return {
    dom,
    update: (newNode) => {
      if (newNode.type !== node.type) return false;
      const next = newNode.attrs.value as string;
      if (next === value) return true;
      value = next;
      if (editor.value !== next) {
        editor.value = next;
        autoResize();
      }
      return true;
    },
    // textarea 自管键盘输入,ProseMirror 不拦截;DOM 变化也由本视图处理。
    stopEvent: () => true,
    ignoreMutation: () => true,
    destroy: () => {
      editor.removeEventListener('input', autoResize);
    },
  };
});

// $remark 与 $nodeSchema 返回的是 [ctx, plugin] 元组,展开成扁平的插件列表,
// 让 Editor 的 .use() 能逐个注册(remark 插件、schema ctx、schema node、NodeView)。
export const frontmatter = [...remarkFrontmatterPlugin, ...frontmatterSchema, frontmatterView];
