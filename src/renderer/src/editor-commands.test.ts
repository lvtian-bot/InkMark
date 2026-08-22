// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// editor-ref / source-editor-ref 是模块级单例容器，mock 成可注入的 { current }
// 以便用例内替换为记录调用的 stub；i18n 与确认弹窗同样 mock，隔离语言与对话框。
vi.mock('./editor-ref', () => ({ editorHandle: { current: null } }));
vi.mock('./source-editor-ref', () => ({ sourceEditorHandle: { current: null } }));
vi.mock('./i18n', () => ({ t: (key: string) => key }));
vi.mock('./confirm-dialog', () => ({
  promptDialog: vi.fn(async () => 'https://example.com'),
}));

import { runEditorCommand } from './editor-commands';
import { editorHandle } from './editor-ref';
import { sourceEditorHandle } from './source-editor-ref';
import { useStore } from './stores/useStore';

/// 记录一次源码编辑写入的新全文与最终选区，断言以此为准。
interface RecordedEdit {
  text: string;
  selection: { from: number; to: number };
}

function makeSourceHandle(
  text: string,
  from: number,
  to: number,
): {
  recorded: RecordedEdit[];
} {
  const recorded: RecordedEdit[] = [];
  sourceEditorHandle.current = {
    getValue: () => (recorded.length ? recorded[recorded.length - 1].text : text),
    getSelection: () => ({ from, to }),
    replaceRange: (_from: number, _to: number, value: string) => {
      recorded.push({ text: value, selection: { from: 0, to: 0 } });
    },
    setSelection: (selFrom: number, selTo: number) => {
      recorded[recorded.length - 1].selection = { from: selFrom, to: selTo };
    },
  } as unknown as typeof sourceEditorHandle.current;
  return { recorded };
}

const initialViewMode = useStore.getState().viewMode;

beforeEach(() => {
  useStore.setState({ viewMode: 'source' });
});

afterEach(() => {
  useStore.setState({ viewMode: initialViewMode });
  sourceEditorHandle.current = null;
  editorHandle.current = null;
  vi.clearAllMocks();
});

describe('runEditorCommand 源码模式：行内标记', () => {
  it('加粗包裹选中文本', () => {
    const { recorded } = makeSourceHandle('plain text', 0, 11);
    runEditorCommand('bold');
    expect(recorded[0].text).toBe('**plain text**');
    // 与工具栏原行为一致：包裹后选区折叠到内容起始处
    expect(recorded[0].selection).toEqual({ from: 2, to: 2 });
  });

  it('已包裹时再执行去掉标记（切换语义）', () => {
    const { recorded } = makeSourceHandle('**plain text**', 2, 12);
    runEditorCommand('bold');
    expect(recorded[0].text).toBe('plain text');
    expect(recorded[0].selection).toEqual({ from: 0, to: 0 });
  });

  it('斜体与删除线使用各自标记', () => {
    let handle = makeSourceHandle('word', 0, 4);
    runEditorCommand('italic');
    expect(handle.recorded[0].text).toBe('*word*');

    handle = makeSourceHandle('word', 0, 4);
    runEditorCommand('strike');
    expect(handle.recorded[0].text).toBe('~~word~~');

    handle = makeSourceHandle('word', 0, 4);
    runEditorCommand('inlineCode');
    expect(handle.recorded[0].text).toBe('`word`');
  });
});

describe('runEditorCommand 源码模式：行级变换', () => {
  it('标题：普通行升级为二级标题，同级再执行则取消', () => {
    let handle = makeSourceHandle('title', 0, 0);
    runEditorCommand('heading2');
    expect(handle.recorded[0].text).toBe('## title');

    handle = makeSourceHandle('## title', 3, 3);
    runEditorCommand('heading2');
    expect(handle.recorded[0].text).toBe('title');
  });

  it('标题：不同级别之间切换', () => {
    const handle = makeSourceHandle('## title', 3, 3);
    runEditorCommand('heading3');
    expect(handle.recorded[0].text).toBe('### title');
  });

  it('无序列表：加前缀与去前缀', () => {
    let handle = makeSourceHandle('item', 0, 0);
    runEditorCommand('bulletList');
    expect(handle.recorded[0].text).toBe('- item');

    handle = makeSourceHandle('- item', 2, 2);
    runEditorCommand('bulletList');
    expect(handle.recorded[0].text).toBe('item');
  });

  it('任务列表：普通行转为待办', () => {
    const handle = makeSourceHandle('item', 0, 0);
    runEditorCommand('taskList');
    expect(handle.recorded[0].text).toBe('- [ ] item');
  });

  it('代码块：行首插入围栏并把光标放进代码体', () => {
    const handle = makeSourceHandle('after', 0, 0);
    runEditorCommand('codeBlock');
    expect(handle.recorded[0].text).toBe('```\n\n```\nafter');
    expect(handle.recorded[0].selection).toEqual({ from: 4, to: 4 });
  });

  it('代码块：前一行非空行时先补换行', () => {
    const handle = makeSourceHandle('prev\nafter', 5, 5);
    runEditorCommand('codeBlock');
    expect(handle.recorded[0].text).toBe('prev\n```\n\n```\nafter');
    expect(handle.recorded[0].selection).toEqual({ from: 9, to: 9 });
  });

  it('表格：行首插入模板（i18n mock 直接返回 key）', () => {
    const handle = makeSourceHandle('tail', 0, 0);
    runEditorCommand('table');
    expect(handle.recorded[0].text).toBe('toolbar.tableTemplatetail');
  });

  it('删除整行透传给源码编辑器的 deleteLine 命令', () => {
    const calls: string[] = [];
    sourceEditorHandle.current = {
      deleteLine: () => calls.push('deleteLine'),
    } as unknown as typeof sourceEditorHandle.current;
    runEditorCommand('deleteLine');
    expect(calls).toEqual(['deleteLine']);
  });

  it('链接：弹窗取地址后生成 [文本](地址)，选区落在链接文本上', async () => {
    const { recorded } = makeSourceHandle('site', 0, 4);
    runEditorCommand('link');
    await vi.waitFor(() => {
      expect(recorded.length).toBe(1);
    });
    expect(recorded[0].text).toBe('[site](https://example.com)');
    expect(recorded[0].selection).toEqual({ from: 1, to: 5 });
  });
});

describe('runEditorCommand 所见即所得模式', () => {
  beforeEach(() => {
    useStore.setState({ viewMode: 'wysiwyg' });
  });

  it('格式动作分发到对应 Milkdown 命令句柄方法', () => {
    const calls: string[] = [];
    editorHandle.current = new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === 'toggleBold' || prop === 'toggleItalic' || prop === 'toggleStrike') {
            return () => calls.push(prop);
          }
          return undefined;
        },
      },
    ) as unknown as typeof editorHandle.current;

    runEditorCommand('bold');
    runEditorCommand('italic');
    runEditorCommand('strike');
    expect(calls).toEqual(['toggleBold', 'toggleItalic', 'toggleStrike']);
  });

  it('标题分发 wrapHeading 并带正确级别', () => {
    const calls: [string, unknown[]][] = [];
    editorHandle.current = {
      wrapHeading: (level: number) => calls.push(['wrapHeading', [level]]),
    } as unknown as typeof editorHandle.current;

    runEditorCommand('heading3');
    expect(calls).toEqual([['wrapHeading', [3]]]);
  });

  it('删除整行分发到命令句柄的 deleteLine', () => {
    const calls: string[] = [];
    editorHandle.current = {
      deleteLine: () => calls.push('deleteLine'),
    } as unknown as typeof editorHandle.current;

    runEditorCommand('deleteLine');
    expect(calls).toEqual(['deleteLine']);
  });
});
