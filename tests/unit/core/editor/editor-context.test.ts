import {
  buildCursorContext,
  findNearestNonEmptyLine,
} from '@/core/editor/editor-context';

function makeGetLine(lines: string[]): (line: number) => string {
  return (line: number) => lines[line] ?? '';
}

describe('findNearestNonEmptyLine', () => {
  const lines = ['first', '', 'third', '', 'fifth'];
  const getLine = makeGetLine(lines);

  it('finds nearest non-empty line before', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 1, 'before')).toBe('first');
  });

  it('finds nearest non-empty line after', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 1, 'after')).toBe('third');
  });

  it('skips multiple empty lines before', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 3, 'before')).toBe('third');
  });

  it('skips multiple empty lines after', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 3, 'after')).toBe('fifth');
  });

  it('returns empty string when no non-empty line exists before', () => {
    const emptyLines = ['', '', 'content'];
    expect(findNearestNonEmptyLine(makeGetLine(emptyLines), emptyLines.length, 0, 'before')).toBe('');
  });

  it('returns empty string when no non-empty line exists after', () => {
    const emptyLines = ['content', '', ''];
    expect(findNearestNonEmptyLine(makeGetLine(emptyLines), emptyLines.length, 2, 'after')).toBe('');
  });

  it('skips whitespace-only lines', () => {
    const lines = ['content', '   ', '  \t  ', 'found'];
    expect(findNearestNonEmptyLine(makeGetLine(lines), lines.length, 0, 'after')).toBe('found');
  });
});

describe('buildCursorContext', () => {
  it('splits line at cursor position', () => {
    const lines = ['hello world'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 5);
    expect(result.beforeCursor).toBe('hello');
    expect(result.afterCursor).toBe(' world');
    expect(result.isInbetween).toBe(false);
    expect(result.line).toBe(0);
    expect(result.column).toBe(5);
  });

  it('cursor at start of line', () => {
    const lines = ['', 'next line'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 0);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('');
    expect(result.afterCursor).toBe('next line');
  });

  it('cursor on empty line between content', () => {
    const lines = ['above', '', 'below'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 1, 0);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('above');
    expect(result.afterCursor).toBe('below');
  });

  it('cursor on whitespace-only line', () => {
    const lines = ['above', '   ', 'below'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 1, 1);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('above');
    expect(result.afterCursor).toBe('below');
  });

  it('cursor at end of non-empty line is not inbetween', () => {
    const lines = ['hello'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 5);
    expect(result.isInbetween).toBe(false);
    expect(result.beforeCursor).toBe('hello');
    expect(result.afterCursor).toBe('');
  });

  it('cursor in middle of word', () => {
    const lines = ['function test() {}'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 8);
    expect(result.beforeCursor).toBe('function');
    expect(result.afterCursor).toBe(' test() {}');
    expect(result.isInbetween).toBe(false);
  });
});
