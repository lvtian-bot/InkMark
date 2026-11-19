import { describe, expect, it } from 'vitest';
import { toggleSourceMark } from './source-inline-format';

describe('源码格式与原文字选区', () => {
  it('跨已有加粗边界时合并已有标记', () => {
    const src = 'some **bold text** on the line';
    const change = toggleSourceMark(src, src.indexOf('text'), src.length, '**');
    expect(change.text).toBe('some **bold text on the line**');
    expect(change.text.slice(change.selection.from, change.selection.to)).toBe('text on the line');
  });
  it('局部取消加粗时保留左右文字的样式', () => {
    expect(toggleSourceMark('**前中后**', 3, 4, '**').text).toBe('**前**中**后**');
  });
  it('连续设置粗体和斜体时保留选中文字', () => {
    const bold = toggleSourceMark('重点', 0, 2, '**');
    const italic = toggleSourceMark(bold.text, bold.selection.from, bold.selection.to, '*');
    expect(italic.text).toBe('***重点***');
    const reset = toggleSourceMark(italic.text, italic.selection.from, italic.selection.to, '*');
    expect(reset.text).toBe('**重点**');
    expect(italic.text.slice(italic.selection.from, italic.selection.to)).toBe('重点');
  });
  it('行内代码使用足够长的反引号', () => {
    const result = toggleSourceMark('a`b', 0, 3, '`');
    expect(result.text).toBe('``a`b``');
  });

  it('跨段加粗分别包裹各段正文，保留列表结构', () => {
    const text = '- 甲\n- 乙\n\n## 小结';
    expect(toggleSourceMark(text, 2, text.length, '**').text).toBe(
      '- **甲**\n- **乙**\n\n## **小结**',
    );
  });
});
