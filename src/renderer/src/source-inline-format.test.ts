import { markdownLanguage } from '@codemirror/lang-markdown';
import { describe, expect, it, vi } from 'vitest';
import { toggleSourceMark } from './source-inline-format';

describe('源码格式与原文字选区', () => {
  it.each(['**', '*', '~~', '`'])('跨段用同一次操作统一格式 %s，第二次整体取消', (marker) => {
    const original = marker + '甲' + marker + '\n\n乙';
    const added = toggleSourceMark(original, 0, original.length, marker);
    expect(added.text).toBe(marker + '甲' + marker + '\n\n' + marker + '乙' + marker);
    const removed = toggleSourceMark(added.text, added.selection.from, added.selection.to, marker);
    expect(removed.text).toBe('甲\n\n乙');
  });
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

  it('在已有加粗文字中设置行内代码时保留外层加粗标记', () => {
    const text = '**word**';
    const result = toggleSourceMark(text, 2, 6, '`');
    expect(result.text).toBe('**`word`**');
    expect(result.text.slice(result.selection.from, result.selection.to)).toBe('word');
    const removed = toggleSourceMark(result.text, result.selection.from, result.selection.to, '`');
    expect(removed.text).toBe('**word**');
    expect(removed.text.slice(removed.selection.from, removed.selection.to)).toBe('word');
  });

  it('跨段加粗分别包裹各段正文，保留列表结构', () => {
    const text = '- 甲\n- 乙\n\n## 小结';
    expect(toggleSourceMark(text, 2, text.length, '**').text).toBe(
      '- **甲**\n- **乙**\n\n## **小结**',
    );
  });

  it('跨任务和正文统一加粗时保留复选框和已有标记写法', () => {
    const text = '- [x] __甲__\n- [ ] 乙\n\n丙';
    const change = toggleSourceMark(text, 0, text.length, '**');
    expect(change.text).toBe('- [x] __甲__\n- [ ] **乙**\n\n**丙**');
  });

  it('全选带收尾井号的 ATX 标题和正文时保留标题结构', () => {
    const text = '## 标题 ##\n\n正文';
    expect(toggleSourceMark(text, 0, text.length, '**').text).toBe('## **标题** ##\n\n**正文**');
  });

  it('引文内跨行取消已有加粗时不重复插入星号', () => {
    const text = '> **foo\n> bar**';
    const result = toggleSourceMark(text, text.indexOf('foo'), text.indexOf('bar') + 3, '**');
    expect(result.text).toBe('> foo\n> bar');
    expect(result.text.slice(result.selection.from, result.selection.to)).toBe('foo\n> bar');
  });

  it('全选多段时只解析一次完整文档', () => {
    const text = Array.from({ length: 1000 }, (_, index) => `第${index}段`).join('\n\n');
    const parseSpy = vi.spyOn(markdownLanguage.parser, 'parse');
    try {
      const result = toggleSourceMark(text, 0, text.length, '**');
      expect(result.text).toContain('**第0段**');
      expect(result.text).toContain('**第19段**');
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
  });
});
