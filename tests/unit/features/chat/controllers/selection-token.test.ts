import {
  appendSelectionToken,
  basename,
  buildBrowserSelectionToken,
  buildCanvasSelectionToken,
  buildEditorSelectionToken,
  removeSelectionToken,
  type SelectionTokenInput,
  truncateLabel,
} from '@/features/chat/controllers/selection-token';

function createInput(value = ''): SelectionTokenInput & { dispatched: number } {
  const input = {
    value,
    dispatched: 0,
    dispatchEvent: jest.fn(() => {
      input.dispatched += 1;
      return true;
    }),
  };
  return input as unknown as SelectionTokenInput & { dispatched: number };
}

describe('buildEditorSelectionToken', () => {
  it('emits a range fragment for multi-line selections', () => {
    expect(buildEditorSelectionToken('notes/a.md', 10, 15)).toBe('@notes/a.md#L10-15');
  });

  it('emits a single-line fragment when start and end match', () => {
    expect(buildEditorSelectionToken('notes/a.md', 7, 7)).toBe('@notes/a.md#L7');
  });

  it('omits the fragment when the start line is unknown', () => {
    expect(buildEditorSelectionToken('notes/a.md')).toBe('@notes/a.md');
  });
});

describe('buildBrowserSelectionToken', () => {
  it('encodes the title', () => {
    expect(buildBrowserSelectionToken('Two Sum')).toBe(`@browser:${encodeURIComponent('Two Sum')}`);
  });

  it('truncates long titles to 80 characters', () => {
    const token = buildBrowserSelectionToken('a'.repeat(120));
    expect(decodeURIComponent(token.slice('@browser:'.length))).toBe('a'.repeat(80));
  });
});

describe('buildCanvasSelectionToken', () => {
  it('encodes the canvas path', () => {
    expect(buildCanvasSelectionToken('boards/my canvas.canvas'))
      .toBe(`@canvas:${encodeURIComponent('boards/my canvas.canvas')}`);
  });
});

describe('basename / truncateLabel', () => {
  it('returns the last path segment', () => {
    expect(basename('a/b/c.md')).toBe('c.md');
  });

  it('truncates labels with an ellipsis', () => {
    expect(truncateLabel('a'.repeat(30))).toBe(`${'a'.repeat(20)}…`);
  });
});

describe('appendSelectionToken', () => {
  it('appends with a single separating space and dispatches input', () => {
    const input = createInput('hello');
    appendSelectionToken(input, '@notes/a.md#L1');
    expect(input.value).toBe('hello @notes/a.md#L1');
    expect(input.dispatched).toBe(1);
  });

  it('trims trailing whitespace before appending', () => {
    const input = createInput('hello   \n');
    appendSelectionToken(input, '@t');
    expect(input.value).toBe('hello @t');
  });

  it('does not add a leading space to an empty input', () => {
    const input = createInput('');
    appendSelectionToken(input, '@t');
    expect(input.value).toBe('@t');
  });

  it('is idempotent when the token already exists', () => {
    const input = createInput('hello @t');
    appendSelectionToken(input, '@t');
    expect(input.value).toBe('hello @t');
    expect(input.dispatched).toBe(0);
  });
});

describe('removeSelectionToken', () => {
  it('removes a trailing token and trims the leftover space', () => {
    const input = createInput('hello @t');
    removeSelectionToken(input, '@t');
    expect(input.value).toBe('hello');
    expect(input.dispatched).toBe(1);
  });

  it('collapses the double space left by a mid-text token', () => {
    const input = createInput('a @t b');
    removeSelectionToken(input, '@t');
    expect(input.value).toBe('a b');
  });

  it('is a no-op when the token is absent', () => {
    const input = createInput('hello');
    removeSelectionToken(input, '@t');
    expect(input.value).toBe('hello');
    expect(input.dispatched).toBe(0);
  });
});
