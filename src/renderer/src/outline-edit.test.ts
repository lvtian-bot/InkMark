import { describe, expect, it } from 'vitest';
import { editOutlineSection, type OutlineAction } from './outline-edit';

function edit(doc: string, index: number, action: OutlineAction): string | null {
  return editOutlineSection(doc, index, action);
}

describe('大纲删除章节', () => {
  it('删除章节时保留相邻章节和标题前正文', () => {
    const doc = ['文档说明', '', '# A', '', 'a', '', '# B', '', 'b', '', '# C', '', 'c'].join('\n');
    expect(edit(doc, 1, 'delete')).toBe(
      ['文档说明', '', '# A', '', 'a', '', '# C', '', 'c'].join('\n'),
    );
  });

  it('删除首章时保留 YAML frontmatter', () => {
    const doc = ['---', 'title: demo', '---', '', '# A', '', 'a', '', '# B', '', 'b'].join('\n');
    expect(edit(doc, 0, 'delete')).toBe(
      ['---', 'title: demo', '---', '', '# B', '', 'b'].join('\n'),
    );
  });

  it('CRLF 文档删除章节后保留换行格式', () => {
    const eol = '\r\n';
    const doc = ['# A', '', 'a', '', '# B', '', 'b', '', '# C', '', 'c'].join(eol);
    expect(edit(doc, 1, 'delete')).toBe(['# A', '', 'a', '', '# C', '', 'c'].join(eol));
  });

  it('删除唯一章节后正文为空', () => {
    expect(edit('# A\n\na', 0, 'delete')).toBe('');
  });

  it('代码围栏中的假标题不参与章节删除', () => {
    const doc = ['# A', '', 'a', '', '```md', '# Fake', '```', '', '# B', '', 'b'].join('\n');
    expect(edit(doc, 1, 'delete')).toBe(
      ['# A', '', 'a', '', '```md', '# Fake', '```', '', ''].join('\n'),
    );
  });

  it('删除容器内标题时拒绝切开列表或引用结构', () => {
    const doc = ['# A', '', '> ## Nested', '', '> body', '', '# B', '', 'b'].join('\n');
    expect(edit(doc, 1, 'delete')).toBeNull();
  });

  it('删除含有引用定义的章节时拒绝破坏其他章节的引用', () => {
    const doc = ['# A', '', '[topic]: /a', '', '# B', '', '[read][topic]'].join('\n');
    expect(edit(doc, 0, 'delete')).toBeNull();
  });
});

describe('大纲章节升级和降级', () => {
  it('降级整章及其子标题一级', () => {
    const doc = ['# A', '', '## A1', '', '### A1a', '', '# B', '', 'b'].join('\n');
    expect(edit(doc, 0, 'demote')).toBe(
      ['## A', '', '### A1', '', '#### A1a', '', '# B', '', 'b'].join('\n'),
    );
  });

  it('升级子章时连同子树一起升级一级', () => {
    const doc = ['# A', '', '## A1', '', '### A1a', '', '# B', '', 'b'].join('\n');
    expect(edit(doc, 1, 'promote')).toBe(
      ['# A', '', '# A1', '', '## A1a', '', '# B', '', 'b'].join('\n'),
    );
  });

  it('一级标题不能继续升级, 六级标题不能继续降级', () => {
    expect(edit('# A\n\n## B', 0, 'promote')).toBeNull();
    expect(edit('##### A\n\n###### B', 1, 'demote')).toBeNull();
  });

  it('子树中存在六级标题时拒绝继续降级', () => {
    const doc = ['# A', '', '##### A5', '', '###### A6', '', '# B'].join('\n');
    expect(edit(doc, 0, 'demote')).toBeNull();
  });

  it('保留 ATX 空标题和闭合井号', () => {
    const empty = ['#', '', '# B'].join('\n');
    expect(edit(empty, 0, 'demote')).toBe(['##', '', '# B'].join('\n'));

    const closed = ['# A', '', '# Title ###', '', '# B'].join('\n');
    expect(edit(closed, 1, 'demote')).toBe(['# A', '', '## Title ###', '', '# B'].join('\n'));
  });

  it('单行 Setext 标题可以在一二级之间升级降级', () => {
    const h1 = ['Title', '===', '', '# B'].join('\n');
    expect(edit(h1, 0, 'demote')).toBe(['Title', '---', '', '# B'].join('\n'));

    const h2 = ['Subtitle', '---', '', '# B'].join('\n');
    expect(edit(h2, 0, 'promote')).toBe(['Subtitle', '===', '', '# B'].join('\n'));
  });

  it('Setext 标题跨到三级时转换为单行 ATX', () => {
    const doc = ['Title', '---', '', '# B'].join('\n');
    expect(edit(doc, 0, 'demote')).toBe(['### Title', '', '# B'].join('\n'));
  });

  it('多行 Setext 标题无法安全转换到三级时拒绝操作', () => {
    const doc = ['Title', 'continued', '---', '', '# B'].join('\n');
    expect(edit(doc, 0, 'demote')).toBeNull();
  });
});
