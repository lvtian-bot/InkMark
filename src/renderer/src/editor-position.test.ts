import { describe, expect, it } from 'vitest';
import { readTabScrollTop, scrollPositionField, scrollPositionUpdate } from './editor-position';

describe('editor position mapping', () => {
  const tab = { wysiwygScrollTop: 120, sourceScrollTop: 48 };

  it('把编辑模式映射到独立的位置字段', () => {
    expect(scrollPositionField('wysiwyg')).toBe('wysiwygScrollTop');
    expect(scrollPositionField('source')).toBe('sourceScrollTop');
    expect(readTabScrollTop(tab, 'wysiwyg')).toBe(120);
    expect(readTabScrollTop(tab, 'source')).toBe(48);
  });

  it('只生成目标模式的位置更新', () => {
    expect(scrollPositionUpdate('wysiwyg', 240)).toEqual({ wysiwygScrollTop: 240 });
    expect(scrollPositionUpdate('source', -8)).toEqual({ sourceScrollTop: 0 });
  });
});
