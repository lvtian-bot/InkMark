import { describe, it, expect } from 'vitest';
import { locateSourceTable, splitTableRow, joinTableRow, editSourceTable } from './table-edit';

/// 覆盖源码模式（纯文本）表格的增删行列与删表。表格固定为 3 列 4 行：
/// 表头 + 分隔行 + 两行数据。光标位置用唯一子串定位，保证落在目标单元格内。
const NL = '\n';

const TABLE = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join(NL);

describe('splitTableRow / joinTableRow', () => {
  it('拆分一行表格为单元格', () => {
    expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('拆分时去掉单元格两侧空白', () => {
    expect(splitTableRow('|  a  |b| c |')).toEqual(['a', 'b', 'c']);
  });

  it('拼回一行表格', () => {
    expect(joinTableRow(['a', 'b', 'c'])).toBe('| a | b | c |');
  });
});

describe('locateSourceTable', () => {
  it('定位连续表格行的起止（含）', () => {
    expect(locateSourceTable(TABLE.split(NL), 2)).toEqual({ start: 0, end: 3 });
  });

  it('光标不在表格行时返回 null', () => {
    expect(locateSourceTable(['hello', 'world'], 0)).toBeNull();
  });

  it('单行 |...| 不构成表格', () => {
    expect(locateSourceTable(['| a |', 'text'], 0)).toBeNull();
  });
});

describe('editSourceTable 增删行', () => {
  const cell2 = TABLE.indexOf('| 2 |') + 2; // 指向字符 2：第 3 行第 2 列
  const cellA = TABLE.indexOf('| a |') + 2; // 指向字符 a：表头行
  const sep = TABLE.indexOf('| --- |') + 2; // 指向分隔行

  it('数据行下方插空行', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'add-row', position: 'after' })).toBe(
      ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '|  |  |  |', '| 4 | 5 | 6 |'].join(
        NL,
      ),
    );
  });

  it('数据行上方插空行', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'add-row', position: 'before' })).toBe(
      ['| a | b | c |', '| --- | --- | --- |', '|  |  |  |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join(
        NL,
      ),
    );
  });

  it('表头上方插行时退化为第一数据行（保持表头+分隔在最前）', () => {
    expect(editSourceTable(TABLE, cellA, { kind: 'add-row', position: 'before' })).toBe(
      ['| a | b | c |', '| --- | --- | --- |', '|  |  |  |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join(
        NL,
      ),
    );
  });

  it('删除光标所在数据行', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'delete-row' })).toBe(
      ['| a | b | c |', '| --- | --- | --- |', '| 4 | 5 | 6 |'].join(NL),
    );
  });

  it('删除最后一行数据后保留表头+分隔', () => {
    const small = ['| a |', '| --- |', '| 1 |'].join(NL);
    expect(editSourceTable(small, small.indexOf('1'), { kind: 'delete-row' })).toBe(
      ['| a |', '| --- |'].join(NL),
    );
  });

  it('表头行不可删', () => {
    expect(editSourceTable(TABLE, cellA, { kind: 'delete-row' })).toBeNull();
  });

  it('分隔行不可删', () => {
    expect(editSourceTable(TABLE, sep, { kind: 'delete-row' })).toBeNull();
  });
});

describe('editSourceTable 增删列', () => {
  const cell2 = TABLE.indexOf('| 2 |') + 2; // 第 2 列

  it('在光标列右侧插空列', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'add-col', position: 'after' })).toBe(
      ['| a | b |  | c |', '| --- | --- |  | --- |', '| 1 | 2 |  | 3 |', '| 4 | 5 |  | 6 |'].join(
        NL,
      ),
    );
  });

  it('在光标列左侧插空列', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'add-col', position: 'before' })).toBe(
      ['| a |  | b | c |', '| --- |  | --- | --- |', '| 1 |  | 2 | 3 |', '| 4 |  | 5 | 6 |'].join(
        NL,
      ),
    );
  });

  it('删除光标所在列', () => {
    expect(editSourceTable(TABLE, cell2, { kind: 'delete-col' })).toBe(
      ['| a | c |', '| --- | --- |', '| 1 | 3 |', '| 4 | 6 |'].join(NL),
    );
  });

  it('单列表格不可再删列', () => {
    const one = ['| a |', '| --- |', '| 1 |'].join(NL);
    expect(editSourceTable(one, one.indexOf('a'), { kind: 'delete-col' })).toBeNull();
  });
});

describe('editSourceTable 删表与边界', () => {
  it('删除整表（保留前后文本）', () => {
    const text = ['para', '| a | b |', '| --- | --- |', '| 1 | 2 |', 'end'].join(NL);
    expect(editSourceTable(text, text.indexOf('1'), { kind: 'delete-table' })).toBe(
      ['para', 'end'].join(NL),
    );
  });

  it('光标不在表格内返回 null', () => {
    expect(editSourceTable('hello world', 3, { kind: 'add-row', position: 'after' })).toBeNull();
  });
});
