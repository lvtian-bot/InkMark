import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import {
  detectBullet,
  detectBulletOrdered,
  bulletListInputAttrs,
  listMarkerAttacher,
  listMarkerHandler,
} from './list-marker';

// 模拟 InkMark 的序列化配置：全局 bullet 回落 '-'（项目约定），自定义 list handler
// 按节点保留的字符输出。这条流水线只覆盖 mdast 层（回捞 + handler），不经过
// ProseMirror 文档模型——attr 透传是机械的 openNode/attrs 读写，由类型与构建保证。
function roundtrip(md: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(listMarkerAttacher)
      .use(remarkStringify, { bullet: '-', handlers: { list: listMarkerHandler } })
      .processSync(md),
  );
}

describe('detectBullet', () => {
  it('识别无序 bullet 字符', () => {
    expect(detectBullet('- a', 0)).toBe('-');
    expect(detectBullet('* a', 0)).toBe('*');
    expect(detectBullet('+ a', 0)).toBe('+');
  });

  it('识别带前导空白的嵌套列表', () => {
    expect(detectBullet('  - a', 0)).toBe('-');
    expect(detectBullet('    * a', 0)).toBe('*');
  });

  it('非无序列表返回 undefined', () => {
    expect(detectBullet('plain', 0)).toBeUndefined();
    expect(detectBullet('1. a', 0)).toBeUndefined();
  });

  it('offset 无效时安全返回 undefined', () => {
    expect(detectBullet('- a', undefined)).toBeUndefined();
    expect(detectBullet('- a', -1)).toBeUndefined();
    expect(detectBullet('- a', 4)).toBeUndefined();
  });
});

describe('detectBulletOrdered', () => {
  it('识别有序标点', () => {
    expect(detectBulletOrdered('1. a', 0)).toBe('.');
    expect(detectBulletOrdered('1) a', 0)).toBe(')');
    expect(detectBulletOrdered('12. a', 0)).toBe('.');
    expect(detectBulletOrdered('  3) a', 0)).toBe(')');
  });

  it('非有序返回 undefined', () => {
    expect(detectBulletOrdered('- a', 0)).toBeUndefined();
  });
});

describe('list marker 往返保留', () => {
  it('保留无序 bullet *', () => {
    expect(roundtrip('* a\n* b')).toBe('* a\n* b\n');
  });

  it('保留无序 bullet +', () => {
    expect(roundtrip('+ a\n+ b')).toBe('+ a\n+ b\n');
  });

  it('无序默认 bullet - 不被改写', () => {
    expect(roundtrip('- a\n- b')).toBe('- a\n- b\n');
  });

  it('保留有序标点 )', () => {
    expect(roundtrip('1) a\n2) b')).toBe('1) a\n2) b\n');
  });

  it('有序默认标点 . 不被改写', () => {
    expect(roundtrip('1. a\n2. b')).toBe('1. a\n2. b\n');
  });

  it('保留嵌套子列表的 bullet', () => {
    const out = roundtrip('- a\n  * b\n  * c');
    expect(out).toContain('- a');
    expect(out).toContain('* b');
    expect(out).toContain('* c');
  });

  it('同一文档保留多种 bullet', () => {
    const out = roundtrip('* first\n\n+ second\n\n- third');
    expect(out).toContain('* first');
    expect(out).toContain('+ second');
    expect(out).toContain('- third');
  });
});

describe('bulletListInputAttrs', () => {
  it('记录敲入的标记字符', () => {
    expect(bulletListInputAttrs(['* ', '*'])).toEqual({ bullet: '*' });
    expect(bulletListInputAttrs(['+ ', '+'])).toEqual({ bullet: '+' });
    expect(bulletListInputAttrs(['- ', '-'])).toEqual({ bullet: '-' });
  });

  it('非法字符回落默认 -', () => {
    expect(bulletListInputAttrs(['x', 'x'])).toEqual({ bullet: '-' });
    expect(bulletListInputAttrs([''])).toEqual({ bullet: '-' });
  });
});
