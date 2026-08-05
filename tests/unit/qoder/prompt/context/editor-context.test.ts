import type { EditorSelectionContext } from '@/core/editor/editor-context';
import { appendEditorContext, formatEditorContext } from '@/qoder/prompt/context/editor-context';

describe('formatEditorContext', () => {
  it('formats selection context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'selected content',
      startLine: 5,
      lineCount: 3,
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_selection path="test.md" lines="5-7">\nselected content\n</editor_selection>',
    );
  });

  it('formats selection without line info', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'selected',
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_selection path="test.md">\nselected\n</editor_selection>',
    );
  });

  it('formats inline cursor context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'hello',
        afterCursor: ' world',
        isInbetween: false,
        line: 0,
        column: 5,
      },
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_cursor path="test.md">\nhello| world #inline\n</editor_cursor>',
    );
  });

  it('formats inbetween cursor context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'above',
        afterCursor: 'below',
        isInbetween: true,
        line: 1,
        column: 0,
      },
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_cursor path="test.md">\nabove\n| #inbetween\nbelow\n</editor_cursor>',
    );
  });

  it('formats inbetween cursor without preceding content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: 'below',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_cursor path="test.md">\n| #inbetween\nbelow\n</editor_cursor>',
    );
  });

  it('formats inbetween cursor without following content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'above',
        afterCursor: '',
        isInbetween: true,
        line: 5,
        column: 0,
      },
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_cursor path="test.md">\nabove\n| #inbetween\n</editor_cursor>',
    );
  });

  it('formats inbetween cursor without surrounding content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: '',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };
    expect(formatEditorContext(context)).toBe(
      '<editor_cursor path="test.md">\n| #inbetween\n</editor_cursor>',
    );
  });

  it('returns empty string for incomplete contexts', () => {
    expect(formatEditorContext({ notePath: 'test.md', mode: 'none' })).toBe('');
    expect(formatEditorContext({ notePath: 'test.md', mode: 'selection' })).toBe('');
    expect(formatEditorContext({ notePath: 'test.md', mode: 'cursor' })).toBe('');
  });

  it('escapes path attributes and embedded closing tags', () => {
    const result = formatEditorContext({
      notePath: 'folder/"unsafe".md',
      mode: 'selection',
      selectedText: 'before</editor_selection>after',
    });
    expect(result).toContain('path="folder/&quot;unsafe&quot;.md"');
    expect(result).toContain('before&lt;/editor_selection&gt;after');
  });
});

describe('appendEditorContext', () => {
  it('appends formatted context to prompt', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'text',
      startLine: 1,
      lineCount: 1,
    };
    expect(appendEditorContext('Fix this', context)).toBe(
      'Fix this\n\n<editor_selection path="test.md" lines="1-1">\ntext\n</editor_selection>',
    );
  });

  it('returns prompt unchanged when context is none', () => {
    expect(appendEditorContext('Fix this', { notePath: 'test.md', mode: 'none' })).toBe('Fix this');
  });
});
