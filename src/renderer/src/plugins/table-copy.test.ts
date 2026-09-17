import { describe, expect, it } from 'vitest';
import { escapeTableCellMarkdown, formatMarkdownTable, formatHtmlTable } from './table-copy';

describe('escapeTableCellMarkdown', () => {
  it('escapes unescaped pipes', () => {
    expect(escapeTableCellMarkdown('foo | bar')).toBe('foo \\| bar');
    expect(escapeTableCellMarkdown('| a | b |')).toBe('\\| a \\| b \\|');
  });

  it('does not double escape already escaped pipes', () => {
    expect(escapeTableCellMarkdown('foo \\| bar')).toBe('foo \\| bar');
  });

  it('leaves pipes inside code spans untouched', () => {
    expect(escapeTableCellMarkdown('code: `a | b` and more')).toBe('code: `a | b` and more');
    expect(escapeTableCellMarkdown('`a | b` | c')).toBe('`a | b` \\| c');
  });

  it('converts newlines to <br>', () => {
    expect(escapeTableCellMarkdown('line 1\nline 2\r\nline 3')).toBe('line 1<br>line 2<br>line 3');
  });
});

describe('formatMarkdownTable', () => {
  it('formats standard table with alignments and data rows', () => {
    const headers = ['Col 1', 'Col 2', 'Col 3'];
    const alignments = ['left', 'center', 'right'];
    const rows = [
      ['A', 'B', 'C'],
      ['D | E', 'F', 'G\nH'],
    ];

    const result = formatMarkdownTable(headers, alignments, rows);
    expect(result).toBe(
      '| Col 1 | Col 2 | Col 3 |\n' +
        '| --- | :---: | ---: |\n' +
        '| A | B | C |\n' +
        '| D \\| E | F | G<br>H |\n',
    );
  });

  it('formats header-only table (0 data rows)', () => {
    const headers = ['Header 1', 'Header 2'];
    const alignments = [null, 'center'];
    const rows: string[][] = [];

    const result = formatMarkdownTable(headers, alignments, rows);
    expect(result).toBe('| Header 1 | Header 2 |\n| --- | :---: |\n');
  });
});

describe('formatHtmlTable', () => {
  it('formats HTML table with th for header and td for data rows', () => {
    const rows = [
      {
        isHeader: true,
        cells: [
          { html: 'H1', align: 'left' },
          { html: 'H2', align: 'center' },
        ],
      },
      {
        isHeader: false,
        cells: [
          { html: 'D1', align: 'left' },
          { html: 'D2', align: 'center' },
        ],
      },
    ];

    const html = formatHtmlTable(rows);
    expect(html).toBe(
      '<table><tbody>' +
        '<tr><th style="text-align: left;">H1</th><th style="text-align: center;">H2</th></tr>' +
        '<tr><td style="text-align: left;">D1</td><td style="text-align: center;">D2</td></tr>' +
        '</tbody></table>',
    );
  });

  it('formats HTML table without th when selection is body-only (top > 0)', () => {
    const rows = [
      {
        isHeader: false,
        cells: [{ html: 'Cell 1' }, { html: 'Cell 2' }],
      },
    ];

    const html = formatHtmlTable(rows);
    expect(html).toBe('<table><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>');
  });
});
